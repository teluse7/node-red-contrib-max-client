module.exports = function (RED) {
    "use strict";
  //const WebSocket = require("ws");
    const WebSocket = require("./max-ws-pool");
    const https = require("https");

    function MaxWsConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.botUrl = (config.botUrl || "").trim().replace(/^https?:\/\//, "").replace(/^http?:\/\//, "").replace(/^wss?:\/\//, "");
        node.refreshInterval = parseInt(config.refreshInterval, 10);
        if (isNaN(node.refreshInterval) || node.refreshInterval <= 0) {
            node.refreshInterval = 28800;
            node.warn(RED._("max-ws-config.log.invalidInterval"));            
        }
        node.midKey = config.midKey || "max_panel_mid";
        node.contextStore = (config.contextStore && config.contextStore !== "default") ? config.contextStore : "default";

        node.panels = [];
        RED.nodes.eachNode(function(panelNode) {
            if (panelNode.type !== "max-panel") return;
            if (panelNode.config === node.id) node.panels.push(panelNode)
        });

        // ── Users ──
        node.users = [];
        try {
            let usersRaw = (node.credentials && node.credentials.maxUsers) || "";
            if (usersRaw) {
                let parsed = JSON.parse(usersRaw);
                if (Array.isArray(parsed)) node.users = parsed
            }
        } catch (e) {
            node.error(RED._("max-ws-config.log.parseUsersError") + e.message)
        }

        node.wsUrl = "wss://" + node.botUrl + "/ws/updates";
        node.apiUrl = "https://" + node.botUrl + "/messages";

        node.activePanelName = null;

        node.listeners = new Set();
        node.connections = new Map();

        let shouldReconnect = false;
        let isClosed = false;

        node.getMid = (userId) => {
            let key = node.midKey + "_" + userId;
            try {
                if (node.contextStore && node.contextStore !== "default") 
                    return node.context().global.get(key, node.contextStore) || null;
                return node.context().global.get(key) || null
            } catch (e) { return null }
        }

        node.setMid = (userId, mid) => {
            let key = node.midKey + "_" + userId;
            try {
                if (node.contextStore && node.contextStore !== "default") 
                    node.context().global.set(key, mid, node.contextStore)
                else node.context().global.set(key, mid)
            } catch (e) {
                node.error(RED._("max-ws-config.log.listenerError") + e.message)
            }
        }

        // ── HTTP request ──
        function httpReq(token, user, method, body) {
            return new Promise((resolve, reject) => {
                const url = new URL(node.apiUrl);
                const options = {
                    hostname: url.hostname,
                    path: url.pathname,
                    method: method,
                    headers: {
                        "Authorization": token,
                        "Content-Type": "application/json"
                    }
                };
                if (method === "DELETE" && body) 
                    options.path += "?message_id=" + encodeURIComponent(body)
                else if (method === "POST" && body)
                    options.path += "?user_id=" + user.match(/^(?:\+)?([a-zA-Z0-9а-яА-Я_-]{1,6})/)[1];
                const req = https.request(options, (res) => {
                    let data = "";
                    res.on("data", (chunk) => data += chunk);
                    res.on("end", () => {
                        try { resolve(JSON.parse(data)) }
                        catch (e) { resolve(data) }
                    })
                });
                req.on("error", reject);
                if (method === "POST" && body) req.write(body);
                req.end()
            })
        }

        node.findDefaultPanelName = () => node.panels.find(p => p.isActiveByDefault)?.panelName ?? null;

        node.findPanelNode = (panelName) => node.panels.find(p => p.panelName === panelName);

        node.getPanelTitle = () => node.findPanelNode(node.activePanelName)?.panelName ?? 
            "\u041f\u0430\u043d\u0435\u043b\u044c \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f";

        node.resetToDefaultPanel = () => node.findDefaultPanelName() && 
            (node.findPanelNode(node.activePanelName = node.findDefaultPanelName()) || 
                 node.warn(RED._("max-ws-config.log.defaultPanelNotFound") + node.activePanelName));

        node.switchPanel = (panelName, userId) => {
            node.activePanelName = panelName;

            if (userId) {
                // Find userId in node.users
                const user = node.users.find(u => u.userId === userId);
                if (user) node.sendPanelToUser(user)
                    .catch(err => node.warn(RED._("max-ws-config.log.sendPanelUserError") + userId + ": " + err.message))
                else node.warn(RED._("max-ws-config.log.userNotFound") + userId)
            } else node.sendPanel()
                .catch(err => node.warn(RED._("max-ws-config.log.sendPanelAllError") + err.message))
        }

        // ── Collect buttons for active panel only ──
        node.collectButtons = () => {
            const buttons = [];
            for (const listener of node.listeners) {
                if (!listener.buttonText || !listener.buttonPayload) continue; 
                var panelNode = RED.nodes.getNode(listener.targetPanel);
                if (!panelNode) continue; 
                if (panelNode.panelName === node.activePanelName) 
                    buttons.push({
                        type: "callback",
                        text: listener.buttonText,
                        payload: listener.buttonPayload
                    })
            }
            const perRow = buttons.length >= 10 ? 4 : 3;
            const rows = [];
            for (let i = 0; i < buttons.length; i += perRow) 
                rows.push(buttons.slice(i, i + perRow));
            return rows
        }

        node.pCallbacks = new Set();
        node.addToQueue = (callbackId) => {
            if (node.pCallbacks.size >= 100) node.pCallbacks.delete(node.pCallbacks.values().next().value);
            node.pCallbacks.add(callbackId)
        } 
        
        // ── Send panel to user ──
        node.sendPanelToUser = async function (user) {
            if (!node.botUrl || !user.userId || !node.activePanelName) return;

            const oldMid = node.getMid(user.userId);
            if (oldMid) {
                try { await httpReq(user.token, user.userId, "DELETE", oldMid) }
                catch (e) { node.warn(RED._("max-ws-config.log.deleteMidError") + e.message) }
            }

            const buttonRows = node.collectButtons();
            
            if (buttonRows.length === 0 || buttonRows.every(row => row.length === 0)) {
                node.log(RED._("max-ws-config.log.noButtons") + node.activePanelName + RED._("max-ws-config.log.noButtonsUser") + user.userId + RED._("max-ws-config.log.noButtonsSkip"));
                return
            }

            const title = node.getPanelTitle();
            const payload = JSON.stringify({
                text: title,
                attachments: [{
                    type: "inline_keyboard",
                    payload: { buttons: buttonRows }
                }]
            });

            try {
                const resp = await httpReq(user.token, user.userId, "POST", payload);
                if (resp && resp.message && resp.message.body && resp.message.body.mid) {
                    node.setMid(user.userId, resp.message.body.mid);
                    node.broadcastStatus({ type: "panel_sent" })
                }
            } catch (e) { node.warn(RED._("max-ws-config.log.panelError") + " " + e.message) }
        }

        // ── Send panel to all users ──
        node.sendPanel = async function () {
            for (const user of node.users) 
                await node.sendPanelToUser(user)
        }

        let refreshTimer = null;
        function startRefreshTimer() {
            if (refreshTimer) clearInterval(refreshTimer); 
            
            if (node.refreshInterval > 0) 
                refreshTimer = setInterval(() => {
                    node.resetToDefaultPanel();
                    node.sendPanel()
                        .catch(err => node.warn(RED._("max-ws-config.log.refreshError") + err.message))
                }, node.refreshInterval * 1000)
        }
        
        // Start and deploy
        async function sendPanelsOnStart() {
            try {
                node.resetToDefaultPanel();
                await new Promise(resolve => setTimeout(resolve, 2000)); 
                await node.sendPanel()
            } catch (err) {
                node.warn(RED._("max-ws-config.log.startSendError") + err.message)
            }
        }

        node.init = async function() {
            await sendPanelsOnStart();
            startRefreshTimer()
        }
        
        node.on("deploy", async function() {
            node.log(RED._("max-ws-config.log.deployRestart"));
            await sendPanelsOnStart();
            startRefreshTimer(); 
            node.log(RED._("max-ws-config.log.timerRestarted") + node.refreshInterval + RED._("max-ws-config.log.timerRestartedValue"))
        });
        
        node.init();

        const isOpenable = (ws) => [WebSocket.OPEN, WebSocket.CONNECTING].includes(ws.readyState);
 
        function ensureConnected(conn, attempt = -1) {
            if (!shouldReconnect || isClosed || !node.botUrl) return;
            if (!conn || !conn.user) return;

            if (conn.ws && isOpenable(conn.ws)) {
                node.log(RED._("max-ws-config.log.alreadyConnected") + conn.user.userId); 
                return 
            }

            const maxAttempts = 100;
            if (attempt > maxAttempts) return;

            const delay = Math.min(2000 * (2 ** (attempt - 1)), 120000);

            setTimeout(() => {
                if (!shouldReconnect || isClosed) return;

                conn.wasOpen = false;

                try {
                    const ws = new WebSocket(node.wsUrl, {
                        headers: { Authorization: conn.user.token },
                        handshakeTimeout: 10000
                    });
                    conn.ws = ws;
                    
                    ws.on("open", () => {
                        conn.wasOpen = true; 
                        node.broadcastStatus({ type: "connected" })
                    });
                    
                    ws.on("message", (data) => handleMessage(data, conn));
                    
                    ws.on("close", () => {
                        node.broadcastStatus({ type: "disconnected" });
                        if (conn.wasOpen) ensureConnected(conn);
                        conn.wasOpen = false  
                    }); 
                    
                    ws.on("error", (err) => {
                        node.error(RED._("max-ws-config.log.wsError") + " " + err.message);
                        if (!conn.wasOpen) ensureConnected(conn, attempt + 1)
                    })
                } catch (e) {
                    node.error(RED._("max-ws-config.log.wsError") + " " + e.message);
                    ensureConnected(conn, attempt + 1)
                } 
            }, delay)
        }

        function handleMessage(data, conn) {
            if (data.length === 0) return;
    
            try { 
                let parsed;
                try {
                    parsed = JSON.parse(data.toString())
                } catch (parseError) {
                    node.warn(RED._("max-ws-config.log.parseJSONerror") + parseError.message);
                    return
                }
            
                let userId = conn.user.userId;
    
                if (Array.isArray(parsed)) 
                    parsed.forEach(item => {
                        try { processEvent(item, userId) } 
                        catch (e) { node.warn(RED._("max-ws-config.log.arrayItemError") + e.message) }
                    })
                else if (typeof parsed === 'object' && parsed !== null) 
                    try { 
                        if (parsed.type === "closed" && parsed.reason === "server shutting down") {
                            node.warn(RED._("max-ws-config.log.serverShutdown") + " " + parsed.reason);
                            if (conn.ws.readyState === WebSocket.OPEN) conn.ws.close();
                            return
                        }
                        processEvent(parsed, userId) 
                    } 
                    catch (e) { node.warn(RED._("max-ws-config.log.objectError") + e.message) }
                else node.warn(RED._("max-ws-config.log.invalidFormat"))
            } catch (e) { 
                node.warn(RED._("max-ws-config.log.criticalError") + e.message) 
            }            
        }

        function processEvent(event, userId) {
            if (!event || 
                !event.callback || 
                !event.callback.payload) {
                node.warn(RED._("max-ws-config.log.invalidEvent"));
                return
            }
            
            //bug
            const callbackId = event.callback.callback_id;
            if (node.pCallbacks.has(callbackId)) return;
        
            if (event.error) return;
        
            const enrichEvent = (evt) => {
                if (!evt.user && userId) evt.user = userId;
                return evt
            }
        
            node.broadcastEvent(enrichEvent(event));
            node.addToQueue(callbackId)
        }

        // ── WebSocket connect ──
        node.connectUser = (user) => {
            if (!node.botUrl || !user.userId || !user.token) return;

            let conn;
            node.connections.set(user.userId, conn = node.connections.get(user.userId) ?? { user, ws: null });

            node.log(RED._("max-ws-config.status.connecting") + " " + node.wsUrl + " (user: " + user.userId + ")");

            ensureConnected(conn)
        }

        node.connectAll = () => {
            for (const user of node.users) {
                const conn = node.connections.get(user.userId);
                if (conn && conn.ws && isOpenable(conn.ws)) {
                    node.log(RED._("max-ws-config.log.alreadyConnected") + user.userId);
                    continue; 
                }
                node.connectUser(user)
            }
        }

        node.disconnectAll = () => {
            for (const [userId, conn] of node.connections) 
                if (conn.ws) try { conn.ws.close() } catch (e) {} 
            node.connections.clear()
        }

        // ── Listeners ──
        node.addListener = (listenerNode) => {
            node.listeners.add(listenerNode);
            let allConnected = true;
            let anyConnected = false;
            for (const [userId, conn] of node.connections) 
                if (conn.ws && conn.ws.readyState === WebSocket.OPEN) anyConnected = true 
                else allConnected = false;
            
            if (allConnected && node.connections.size > 0) 
                listenerNode.onMaxStatus({ type: "connected" })
            else if (anyConnected) 
                listenerNode.onMaxStatus({ type: "partial" })
            else 
                listenerNode.onMaxStatus({ type: "disconnected" })
        }

        node.removeListener = (listenerNode) => node.listeners.delete(listenerNode);

        // ── Broadcast event ──
        node.broadcastEvent = (event) => {
            const actionId = event.callback && event.callback.payload
                ? event.callback.payload
                : (event.payload || null);

            for (const listener of node.listeners) 
                try { if (actionId && listener.buttonPayload === actionId) listener.onMaxEvent(event) } 
                catch (e) { node.error(RED._("max-ws-config.log.listenerError") + " " + e.message) }
        }

        // ── Broadcast status ──
        node.broadcastStatus = (status) => {
            let connected = 0;
            let total = node.users.length;
            for (const [userId, conn] of node.connections) 
                if (conn.ws && conn.ws.readyState === WebSocket.OPEN) connected++;

            let aggregated;
            if (status.type === "panel_sent") 
                aggregated = { type: "panel_sent" }
            else if (connected === total && total > 0) 
                aggregated = { type: "connected" }
            else if (connected > 0) 
                aggregated = { type: "partial", connected: connected, total: total }
            else 
                aggregated = { type: "disconnected" };

            for (const listener of node.listeners) 
                try { listener.onMaxStatus(aggregated) }
                catch (e) { node.error(RED._("max-ws-config.log.statusListenerError") + " " + e.message) }
        }

        if (node.panels.length === 0) 
            node.warn(RED._("max-ws-config.log.noPanels"))
        else { 
            shouldReconnect = true;
            node.connectAll()
        }

        node.on("close", (done) => {
            isClosed = true;
            shouldReconnect = false;
            node.disconnectAll();
            done()
        }) 
    }

    RED.nodes.registerType("max-ws-config", MaxWsConfigNode, {
        credentials: { maxUsers: {} }
    })
}