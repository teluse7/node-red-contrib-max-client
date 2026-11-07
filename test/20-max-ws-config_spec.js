'use strict';
const Module = require('module'); 
Module._load = Module._load || function() {};  // сброс возможного хука
delete require.cache[require.resolve('ws')];
delete require.cache[require.resolve(`${NODES_DIR}/max-ws-pool.js`)];

const assert = require('assert');
const path = require('path');
const helper = require('node-red-node-test-helper');
helper.init(require.resolve('node-red'));
const MockMax = require('./helpers/mock-max');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // мок с самоподписанным сертификатом

const NODES_DIR = path.join(__dirname, '..');
function fresh(file) {
    delete require.cache[require.resolve(`${NODES_DIR}/${file}`)];
    return require(`${NODES_DIR}/${file}`)
}
// пул должен быть свежим и с реальным ws (в 10-спеке он грузился с фейком)
delete require.cache[require.resolve(`${NODES_DIR}/max-ws-pool.js`)];

// ДИАГНОСТИКА: какой ws сейчас в кэше
const wsModule = require('ws');
console.log('[diag] WebSocketServer:', typeof wsModule.WebSocketServer,
    '| Server:', typeof wsModule.Server,
    '| путь:', require.resolve('ws'));

const wsConfigNode = fresh('max-ws-config.js');
const panelNode = fresh('max-panel.js');
const controlNode = fresh('max-control.js');

const PORT = 18081;
const USERS = [{ userId: '12345', token: 'TOK-A' }];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeControls(n) {
    return Array.from({ length: n }, (_, i) => ({ text: `Кнопка ${i + 1}`, payload: `act_${i + 1}` }))
}

function makeFlow({ controls = [], interval = 0, users = USERS, botUrl = `127.0.0.1:${PORT}` } = {}) {
    const flow = [
        { id: 'c1', type: 'max-ws-config', botUrl, refreshInterval: interval, midKey: 'mkey_test', contextStore: 'default' },
        { id: 'p1', type: 'max-panel', config: 'c1', panelName: 'Главная', isActiveByDefault: true },
        { id: 'p2', type: 'max-panel', config: 'c1', panelName: 'Освещение' },
        ...controls.map((c, i) => ({ id: `ctl${i}`, type: 'max-control', targetPanel: 'p1', buttonText: c.text, buttonPayload: c.payload, wires: [[`out${i}`]] })),
        ...controls.map((_, i) => ({ id: `out${i}`, type: 'helper' })),
    ];
    return { flow, creds: { c1: { maxUsers: JSON.stringify(users) } } }
}

function load(flow, creds) {
    return new Promise((res, rej) => helper.load([wsConfigNode, panelNode, controlNode], flow, creds, e => e ? rej(e) : res()))
}

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

describe('20. max-ws-config: соединение, панели, события', function () {
    let mock;
    before(async function () { 
        mock = new MockMax(PORT); 
        await mock.start() 
    });
    after(async function () { await mock.stop() });
    beforeEach(function () { 
        mock.messages = []; 
        mock.httpRequests = []; 
        mock.rejectTokens = []; 
    });
    afterEach(async function () { await helper.unload() });

    it('подключается по WSS с токеном в Authorization', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        await mock.waitForConnection('TOK-A')
    });

    it('отправляет панель по умолчанию адресатам (POST /messages)', async function () {
        const { flow, creds } = makeFlow({ controls: makeControls(1) });
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        const post = await mock.waitForHttp(r => r.method === 'POST' && r.path === '/messages');
        assert.strictEqual(post.query.user_id, '12345');
        const body = JSON.parse(post.body);
        assert.strictEqual(body.text, 'Главная');
        const btn = body.attachments[0].payload.buttons.flat();
        assert.ok(btn.some(b => b.type === 'callback' && b.text === 'Кнопка 1' && b.payload === 'act_1'))
    });

    it('нет кнопок — панель не отправляется', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        await sleep(3500); // 2 с задержка старта + запас
        assert.strictEqual(mock.httpRequests.filter(r => r.path === '/messages').length, 0)
    });

    it('событие кнопки доходит до max-control с полным payload', async function () {
        const { flow, creds } = makeFlow({ controls: makeControls(1) });
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        const received = new Promise(r => helper.getNode('out0').once('input', r));
        const event = { callback: { callback_id: 'cb-1', payload: 'act_1' } };
        mock.broadcast(event);
        const msg = await received;
        assert.strictEqual(msg.payload.action, 'act_1');
        assert.strictEqual(msg.payload.button, 'Кнопка 1');
        assert.strictEqual(msg.payload.user, '12345');
        assert.strictEqual(msg.topic, 'act_1');
        assert.deepStrictEqual(msg.raw, event)
    });

    it('событие с чужим payload не доходит ни до кого', async function () {
        const { flow, creds } = makeFlow({ controls: makeControls(1) });
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        let got = 0;
        helper.getNode('out0').on('input', () => got++);
        mock.broadcast({ callback: { callback_id: 'cb-x', payload: 'unknown_action' } });
        await sleep(800);
        assert.strictEqual(got, 0)
    });

    it('дубликат callback_id игнорируется', async function () {
        const { flow, creds } = makeFlow({ controls: makeControls(1) });
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        let got = 0;
        helper.getNode('out0').on('input', () => got++);
        const ev = { callback: { callback_id: 'cb-dup', payload: 'act_1' } };
        mock.broadcast(ev);
        await sleep(300);
        mock.broadcast(ev);
        await sleep(800);
        assert.strictEqual(got, 1)
    });

    it('событие с error игнорируется', async function () {
        const { flow, creds } = makeFlow({ controls: makeControls(1) });
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        let got = 0;
        helper.getNode('out0').on('input', () => got++);
        mock.broadcast({ callback: { callback_id: 'cb-e', payload: 'act_1' }, error: true });
        await sleep(800);
        assert.strictEqual(got, 0)
    });

    it('массив событий обрабатывается поэлементно', async function () {
        const { flow, creds } = makeFlow({ controls: makeControls(2) });
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        const got0 = new Promise(r => helper.getNode('out0').once('input', r));
        const got1 = new Promise(r => helper.getNode('out1').once('input', r));
        mock.broadcast([
            { callback: { callback_id: 'a', payload: 'act_1' } },
            { callback: { callback_id: 'b', payload: 'act_2' } },
        ]);
        const [m0, m1] = await Promise.all([got0, got1]);
        assert.strictEqual(m0.payload.action, 'act_1');
        assert.strictEqual(m1.payload.action, 'act_2')
    });

    it('раскладка: до 9 кнопок — по 3 в ряд', async function () {
        const { flow, creds } = makeFlow({ controls: makeControls(9) });
        await load(flow, creds);
        const post = await mock.waitForHttp(r => r.method === 'POST' && r.path === '/messages');
        const rows = JSON.parse(post.body).attachments[0].payload.buttons;
        assert.strictEqual(rows.length, 3);
        rows.forEach(row => assert.strictEqual(row.length, 3))
    });

    it('раскладка: 10 и более кнопок — по 4 в ряд', async function () {
        const { flow, creds } = makeFlow({ controls: makeControls(10) });
        await load(flow, creds);
        const post = await mock.waitForHttp(r => r.method === 'POST' && r.path === '/messages');
        const rows = JSON.parse(post.body).attachments[0].payload.buttons;
        assert.deepStrictEqual(rows.map(r => r.length), [4, 4, 2])
    });

    it('переключение панели: старое сообщение удаляется, новое отправляется', async function () {
        const { flow, creds } = makeFlow({ controls: makeControls(1) });
        await load(flow, creds);
        const first = await mock.waitForHttp(r => r.method === 'POST' && r.path === '/messages');
        helper.getNode('c1').switchPanel('Освещение');
        await mock.waitForHttp(r => r.method === 'DELETE' && r.query.message_id === first.resMid);
        await mock.waitForHttp(r => r.method === 'POST' && r.path === '/messages' && JSON.parse(r.body).text === 'Освещение')
    });

    it('обновление панели по таймеру (refreshInterval > 0)', async function () {
        const { flow, creds } = makeFlow({ controls: makeControls(1), interval: 1 });
        await load(flow, creds);
        await until(() => mock.httpRequests.filter(r => r.method === 'POST' && r.path === '/messages').length >= 2,
            9000, 'повторная отправка панели по таймеру')
    });

    it('URL нормализуется: https:// отсекается', async function () {
        const { flow, creds } = makeFlow({ botUrl: `https://127.0.0.1:${PORT}` });
        await load(flow, creds);
        assert.strictEqual(helper.getNode('c1').botUrl, `127.0.0.1:${PORT}`);
        await mock.waitForConnection('TOK-A')
    });

    it('невалидный интервал заменяется на 28800', async function () {
        const { flow, creds } = makeFlow({ interval: 'abc' });
        await load(flow, creds);
        assert.strictEqual(helper.getNode('c1').refreshInterval, 28800)
    });

    it('после разрыва переподключается', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        mock.closeAll();
        await until(() => !mock.connections.some(c => c.ws.readyState === 1), 5000, 'закрытие старого соединения');
        await mock.waitForConnection('TOK-A', 10000) // новое соединение
    });

    it('после unload соединения закрываются', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        await mock.waitForConnection('TOK-A');
        await helper.unload();
        await sleep(500);
        assert.ok(!mock.connections.some(c => c.ws.readyState === 1))
    })
});
