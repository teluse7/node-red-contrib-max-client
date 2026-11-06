'use strict';

class FakeWS {
    constructor(url, options) {
        FakeWS.instances.push(this);
        this.url = url;
        this.options = options;
        this.readyState = FakeWS.CONNECTING;
        this.sent = [];
        this.listeners = {}
    }
    on(type, handler) { 
        (this.listeners[type] ??= []).push(handler);
        return this
    }
    send(data) {
        if (this.readyState !== FakeWS.OPEN) throw new Error('not open');
        this.sent.push(data)
    }
    close(code, reason) {
        if (this.readyState === FakeWS.CLOSED) return;
        this.readyState = FakeWS.CLOSED;
        (this.listeners.close || []).slice().forEach(h => h(code || 1005, reason || ''))
    }
    _open() { 
        this.readyState = FakeWS.OPEN;
        (this.listeners.open || []).slice().forEach(h => h())
    }
    _message(data) { (this.listeners.message || []).slice().forEach(h => h(data)) }
}

FakeWS.CONNECTING = 0; 
FakeWS.OPEN = 1; 
FakeWS.CLOSING = 2; 
FakeWS.CLOSED = 3;
FakeWS.reset = () => { FakeWS.instances = [] }

module.exports = FakeWS;