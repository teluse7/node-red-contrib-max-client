'use strict';
const Module = require('module'); 
Module._load = Module._load || function() {};  // сброс возможного хука
delete require.cache[require.resolve('ws')];
delete require.cache[require.resolve('../max-ws-pool.js')];

const assert = require('assert');
const path = require('path');
const helper = require('node-red-node-test-helper');
helper.init(require.resolve('node-red'));
const MockMax = require('./helpers/mock-max');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const NODES_DIR = path.join(__dirname, '..');
function fresh(file) {
    delete require.cache[require.resolve(`${NODES_DIR}/${file}`)];
    return require(`${NODES_DIR}/${file}`)
}
delete require.cache[require.resolve('../max-ws-pool.js')];

const wsConfigNode = fresh('max-ws-config.js');
const panelNode = fresh('max-panel.js');
const switchNode = fresh('max-switch.js');

const PORT = 18281;
const USERS = [{ userId: '12345', token: 'TOK-A' }, { userId: '222', token: 'TOK-B' }];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function until(fn, ms = 10000, what = 'условие') {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function tick() {
            let v;
            try { v = fn() } catch (e) { return reject(e) }
            if (v) return resolve(v);
            if (Date.now() - start > ms) return reject(new Error('не дождались: ' + what));
            setTimeout(tick, 50)
        })()
    })
}

function captureStatuses(node) {
    const statuses = [];
    const orig = node.status.bind(node);
    node.status = s => { statuses.push(s); orig(s) };
    return statuses
}
const lastStatus = st => st[st.length - 1];
const waitLastStatus = (st, pred, ms) => until(() => st.length && pred(lastStatus(st)) && lastStatus(st), ms, 'статус узла');

function makeFlow() {
    const flow = [
        { id: 'c1', type: 'max-ws-config', botUrl: `127.0.0.1:${PORT}`, refreshInterval: 0, midKey: 'mk', contextStore: 'default' },
        { id: 'p1', type: 'max-panel', config: 'c1', panelName: 'Главная', isActiveByDefault: true },
        { id: 'p2', type: 'max-panel', config: 'c1', panelName: 'Освещение' },
        { id: 'sw1', type: 'max-switch', targetPanel: 'p2', wires: [] },
    ];
    return { flow, creds: { c1: { maxUsers: JSON.stringify(USERS) } } }
}

function load(flow, creds) {
    return new Promise((res, rej) => helper.load([wsConfigNode, panelNode, switchNode], flow, creds, e => e ? rej(e) : res()))
}

describe('22. max-switch: переключение панелей', function () {
    let mock;
    before(async function () { 
        mock = new MockMax(PORT); 
        await mock.start()
    });
    after(async function () { await mock.stop() });
    beforeEach(function () { 
        mock.messages = []; 
        mock.httpRequests = []; 
        mock.rejectTokens = []
    });
    afterEach(async function () { await helper.unload() });

    it('с payload.user переключает панель только для этого пользователя', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        helper.getNode('sw1').receive({ payload: { user: '12345' } });
        await mock.waitForHttp(r => r.method === 'DELETE');
        const post = await mock.waitForHttp(r => r.method === 'POST' && JSON.parse(r.body).text === 'Освещение');
        assert.strictEqual(post.query.user_id, '12345')
    });

    it('без payload.user переключает панель для всех', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        await mock.waitForConnection('TOK-B');
        helper.getNode('sw1').receive({ payload: {} });
        await until(() =>
            mock.httpRequests.filter(r => r.method === 'POST' && r.path === '/messages' && JSON.parse(r.body).text === 'Освещение').length >= 2,
            10000, 'POST для обоих пользователей')
    });

    it('неизвестный пользователь — warn и без отправки', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        const warns = [];
        helper.getNode('c1').warn = m => warns.push(m); // перехватываем warn конфига
        helper.getNode('sw1').receive({ payload: { user: 'nope' } });
        await sleep(1000);
        assert.strictEqual(mock.httpRequests.filter(r => r.method === 'POST' && r.path === '/messages').length, 0);
        assert.ok(warns.length >= 1, 'должно быть предупреждение о неизвестном пользователе')
    });

    it('после переключения — зелёная точка', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        const st = captureStatuses(helper.getNode('sw1'));
        helper.getNode('sw1').receive({ payload: {} });
        await waitLastStatus(st, s => s.fill === 'green', 10000)
    })
});
