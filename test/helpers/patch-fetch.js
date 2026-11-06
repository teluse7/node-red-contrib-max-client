'use strict';

function installFetch(handler) {
    const calls = [];
    const fake = async (url, options = {}) => {
        const call = { url: String(url), options, body: options.body };
        calls.push(call);
        return handler(call)
    }
    const orig = global.fetch;
    global.fetch = fake;
    return { calls, restore: () => { global.fetch = orig } }
}

function jsonRes(obj, ok = true) {
    return { ok, status: ok ? 200 : 500, statusText: ok ? 'OK' : 'Error', json: async () => obj }
}

function bytesRes(buf, ok = true) {
    return { ok, status: ok ? 200 : 500, arrayBuffer: async () => buf }
}

module.exports = { installFetch, jsonRes, bytesRes }