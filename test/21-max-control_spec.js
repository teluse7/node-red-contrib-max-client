'use strict';
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
delete require.cache[require.resolve(`${NODES_DIR}/max-ws-pool.js`)];

const wsConfigNode = fresh('max-ws-config.js');
const panelNode = fresh('max-panel.js');
const controlNode = fresh('max-control.js');

const PORT = 18181;
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

function makeFlow({ secondUser = false } = {}) {
    const users = [{ userId: '12345', token: 'TOK-A' }];
    if (secondUser) users.push({ userId: '222', token: 'TOK-B' });
    const flow = [
        { id: 'c1', type: 'max-ws-config', botUrl: `127.0.0.1:${PORT}`, refreshInterval: 0, midKey: 'mk', contextStore: 'default' },
        { id: 'p1', type: 'max-panel', config: 'c1', panelName: 'Главная', isActiveByDefault: true },
        { id: 'ctl0', type: 'max-control', targetPanel: 'p1', buttonText: 'Кнопка 1', buttonPayload: 'act_1', wires: [['out0']] },
        { id: 'out0', type: 'helper' },
    ];
    return { flow, creds: { c1: { maxUsers: JSON.stringify(users) } } }
}

function load(flow, creds) {
    return new Promise((res, rej) => helper.load([wsConfigNode, panelNode, controlNode], flow, creds, e => e ? rej(e) : res()))
}

describe('21. max-control: выход и статусы', function () {
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

    it('подключено — зелёная точка', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        const st = captureStatuses(helper.getNode('ctl0'));
        await mock.waitForConnection('TOK-A');
        await waitLastStatus(st, s => s.fill === 'green' && s.shape === 'dot', 10000)
    });

    it('partial: часть пользователей подключена — жёлтое кольцо N/M', async function () {
        const { flow, creds } = makeFlow({ secondUser: true });
        await load(flow, creds);
        const st = captureStatuses(helper.getNode('ctl0'));
        mock.rejectTokens = ['TOK-B'];
        await mock.waitForConnection('TOK-A');
        await waitLastStatus(st, s => s.fill === 'yellow' && /1\/2/.test(String(s.text)), 10000);
        mock.rejectTokens = []; // разрешаем второму переподключиться
        await mock.waitForConnection('TOK-B', 15000);
        await waitLastStatus(st, s => s.fill === 'green', 15000)
    });

    it('нажатие кнопки — синяя точка и правильный payload', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        const st = captureStatuses(helper.getNode('ctl0'));
        const received = new Promise(r => helper.getNode('out0').once('input', r));
        mock.broadcast({ callback: { callback_id: 'cb-9', payload: 'act_1' } });
        const msg = await received;
        assert.strictEqual(msg.payload.action, 'act_1');
        assert.strictEqual(msg.payload.button, 'Кнопка 1');
        assert.strictEqual(msg.payload.user, '12345');
        await waitLastStatus(st, s => s.fill === 'blue', 5000)
    });

    it('разрыв — красное кольцо', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        const st = captureStatuses(helper.getNode('ctl0'));
        mock.closeAll();
        await waitLastStatus(st, s => s.fill === 'red', 10000)
    })
});
