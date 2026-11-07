const RealWebSocket = require('ws');

const poolConnections = new Map(); // key = `${url}:${token}`

/**
 * WebSocket emulation
 */
class WebSocketWrapper {
    constructor(conn) {
        this._conn = conn;
        this._events = {};
        this._closed = false;

        Object.defineProperty(this, 'readyState', { get: () => this._closed ? RealWebSocket.CLOSED : (this._conn?.ws?.readyState ?? RealWebSocket.CONNECTING) });
        Object.defineProperty(this, 'url', { get: () => this._conn.url });
        Object.defineProperty(this, 'protocol', { get: () => this._conn.protocol || '' })
    }

    _emit(type, data) { for (const fn of (this._events[type] ?? [])) try { fn(data) } catch {} }

    on(type, handler) { (this._events[type] ??= []).push(handler); return this }

    addEventListener(type, handler) { return this.on(type, handler) }

    send(data) {
        if (this._closed || this._conn.ws?.readyState !== RealWebSocket.OPEN) 
            throw new Error('WebSocketWrapper: connection not open');
        this._conn.ws.send(typeof data === 'object' ? JSON.stringify(data) : data)
    }

    close(code, reason) {
        if (this._closed) return;
        this._closed = true;

        const conn = this._conn;
        const idx = conn.subscribers.indexOf(this);
        if (idx !== -1) conn.subscribers.splice(idx, 1);
        
        const payload = { code: code || 1000, reason: reason || 'normal' }

        clearInterval(conn.pingTimer);
        conn.pingTimer = null;
        poolConnections.delete(conn.key);
        try { conn.ws.close() } catch (e) {}

        conn.subscribers.splice(0).forEach(w => w._closed || (w._closed = true, w._emit('close', payload)));
        this._emit('close', payload)
    }

    removeListener(type, handler) { this._events[type] = this._events[type]?.filter(h => h !== handler); return this }
}

/**
 * Main
 * `new require('ws')(...)`.
 */
class PooledWebSocket {
    constructor(url, options = {}) {
        // call new WebSocket(url, options)
        const token = options.headers?.Authorization;
        if (!token) return this._fallbackToReal(url, options);

        const key = `${url}:${token}`;
        let conn = poolConnections.get(key);

        if (conn &&
            [RealWebSocket.CLOSED, RealWebSocket.CLOSING].includes(conn.ws.readyState)) {
            clearInterval(conn.pingTimer);
            poolConnections.delete(key);
            conn = null
        }

        if (!conn) {
            const realWs = new RealWebSocket(url, {
                headers: options.headers,
                handshakeTimeout: options.handshakeTimeout || 10000
            });

            conn = { url, key, ws: realWs, pingTimer: null, subscribers: [] }
            poolConnections.set(key, conn);
            
            realWs.on('open', () => {
                conn.pingTimer = setInterval(() => realWs.readyState === RealWebSocket.OPEN && realWs.send('{"cmd":"ping"}'), 25000);
                // Broadcast to wrappers
                conn.subscribers.slice().forEach(w => w._emit('open', null))
            });

            realWs.on('message', (data) => conn.subscribers.slice().forEach(w => w._emit('message', data)));

            realWs.on('close', (code, reason) => {
                clearInterval(conn.pingTimer);
                conn.pingTimer = null;

                conn.subscribers.splice(0).forEach(w => w._closed || (w._closed = true, w._emit('close', { code, reason: reason ?? '' })));

                poolConnections.delete(key)
            });

            realWs.on('error', (err) => {
                console.error('[ws-pool] WS error:', err.message);
                conn.subscribers.slice().forEach(w => w._emit('error', err))
            })
        } 

        // Create wrapper, add subscribers
        const wrapper = new WebSocketWrapper(conn);
        conn.subscribers.push(wrapper);

        // If OPEN - emulate OPEN for wrapper
        if (conn.ws.readyState === RealWebSocket.OPEN && conn.pingTimer) wrapper._emit('open', null);

        // Copy 
        for (const prop of ['send', 'close', 'on', 'addEventListener', 'removeListener', 'readyState']) 
            Object.defineProperty(this, prop, {
                get: () => typeof wrapper[prop] === 'function' ? wrapper[prop].bind(wrapper) : wrapper[prop],
                configurable: true, 
                enumerable: true
            });

        this._wrapper = wrapper
    }

    /**
     * If no token
     */
    _fallbackToReal(url, options) {
        const realWs = new RealWebSocket(url, options);
        // Copy
        for (const prop of ['send', 'close', 'on', 'addEventListener', 'removeListener', 'readyState']) 
            Object.defineProperty(this, prop, {
                get: () => typeof realWs[prop] === 'function' ? realWs[prop].bind(realWs) : realWs[prop],
                configurable: true, 
                enumerable: true
            });
        
        this._wrapper = null
    }
}

PooledWebSocket.CONNECTING = RealWebSocket.CONNECTING;
PooledWebSocket.OPEN = RealWebSocket.OPEN;
PooledWebSocket.CLOSING = RealWebSocket.CLOSING;
PooledWebSocket.CLOSED = RealWebSocket.CLOSED;
// `const WebSocket = require('./max-ws-pool')` — the same `require('ws')`.
module.exports = PooledWebSocket;
