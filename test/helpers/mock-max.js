'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { WebSocketServer } = require('ws');

class MockMax {
    constructor(port) {
        this.port = port;
        this.messages = [];     // {token, data}
        this.httpRequests = []; // {method, path, query, body, auth, resMid}
        this.connections = [];  // {token, ws}
        this.rejectTokens = [];
        this.midCounter = 0
    }

    start() {
        console.log('[mock] Запуск сервера');
        const certDir = path.join(__dirname, '..', 'certs');
        const key = fs.readFileSync(path.join(certDir, 'key.pem'));
        const cert = fs.readFileSync(path.join(certDir, 'cert.pem'));
        return new Promise(resolve => {
            this.server = https.createServer({ key, cert }, (req, res) => this._handleHttp(req, res));

            // ——— ДИАГНОСТИКА: сюда попадают все отказы на уровне TLS и сокета ———
            this.server.on('tlsClientError', (err, tlsSocket) => {
                console.error('[mock-max] tlsClientError:', err.message)
            });
            this.server.on('clientError', (err, socket) => {
                console.error('[mock-max] clientError:', err.message)
            });
            this.server.on('error', (err) => {
                console.error('[mock-max] server error:', err.message)
            });

            this.wss = new WebSocketServer({ server: this.server });
            this.wss.on('error', (err) => console.error('[mock-max] wss error:', err.message));

            this.wss.on('connection', (ws, req) => {
                const token = req.headers.authorization;
                console.log('[mock-max] WS connected:', req.url, '| Authorization:', token);
                this.connections.push({ token, ws });
                if (this.rejectTokens.includes(token)) { try { ws.close() } catch (e) {} return }
                ws.on('message', data => this.messages.push({ token, data: data.toString() }))
            });

            this.server.listen(this.port, '127.0.0.1', () => {
                console.log('[mock-max] listening on https://127.0.0.1:' + this.port);
                resolve()
            })
        })
    }


    _handleHttp(req, res) {
        console.log('[mock-max] HTTP:', req.method, req.url);
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            console.log('[mock-max] HTTP:', req.method, req.url);
            const u = new URL(req.url, 'https://mock.local');
            const rec = {
                method: req.method,
                path: u.pathname,
                query: Object.fromEntries(u.searchParams),
                body,
                auth: req.headers.authorization
            };
            if (req.method === 'POST') rec.resMid = 'MID-' + (++this.midCounter);
            this.httpRequests.push(rec);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (req.method === 'POST') res.end(JSON.stringify({ message: { body: { mid: rec.resMid } } }))
            else res.end('{}')
        })
    }

    broadcast(obj) {
        const s = JSON.stringify(obj);
        for (const c of this.connections) {
            if (c.ws.readyState === 1) { try { c.ws.send(s) } catch (e) {} }
        }
    }

    closeAll() { for (const c of this.connections.slice()) { try { c.ws.close() } catch (e) {} } }

    waitForMessage(pred, timeout = 8000) { return this._waitFor(() => this.messages.find(pred), timeout, 'сообщение по WS') }
    waitForHttp(pred, timeout = 15000) { return this._waitFor(() => this.httpRequests.find(pred), timeout, 'HTTP-запрос') }
    waitForConnection(token, timeout = 10000) {
        return this._waitFor(() => this.connections.find(c => c.token === token && c.ws.readyState === 1), timeout, 'WS-соединение')
    }
    _waitFor(finder, timeout, what) {
        const start = Date.now();
        return new Promise((resolve, reject) => {
            const tick = () => {
                try {
                    const found = finder();
                    if (found) return resolve(found)
                } catch (e) { return reject(e) }
                if (Date.now() - start > timeout) return reject(new Error('mock-max: не дождались: ' + what));
                setTimeout(tick, 50)
            }
            tick()
        })
    }

    stop() {
        return new Promise(resolve => {
            this.closeAll();
            try { this.wss.close() } catch (e) {}
            try { this.server.close(() => resolve()) } catch (e) { resolve() }
        })
    }
}

module.exports = MockMax;
