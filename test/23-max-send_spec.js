'use strict';
const assert = require('assert');
const path = require('path');
const helper = require('node-red-node-test-helper');
helper.init(require.resolve('node-red'));
const { install: installPuppeteerStub } = require('./helpers/stub-puppeteer');
const { installFetch, jsonRes, bytesRes } = require('./helpers/patch-fetch');

const NODES_DIR = path.join(__dirname, '..');
function fresh(file) {
    delete require.cache[require.resolve(`${NODES_DIR}/${file}`)];
    return require(`${NODES_DIR}/${file}`)
}

const wsConfigNode = fresh('max-ws-config.js');
const panelNode = fresh('max-panel.js'); // нужен только чтобы у конфига не было warn «no panels»

const sleep = ms => new Promise(r => setTimeout(r, ms));

function until(fn, ms = 10000, what = 'условие') {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function tick() {
            let v;
            try { v = fn(); } catch (e) { return reject(e) }
            if (v) return resolve(v);
            if (Date.now() - start > ms) return reject(new Error('не дождались: ' + what));
            setTimeout(tick, 50)
        })()
    })
}

function captureStatuses(node) {
    const statuses = [];
    const orig = node.status.bind(node);
    node.status = s => { statuses.push(s); orig(s) }
    return statuses
}
const lastStatus = st => st[st.length - 1];
const waitLastStatus = (st, pred, ms) => until(() => st.length && pred(lastStatus(st)) && lastStatus(st), ms, 'статус узла');

const USERS = [{ userId: '12345', token: 'TOK-A' }, { userId: '222', token: 'TOK-B' }];

function makeFlow({ users = USERS, scrshot = false, canvasctrl = false, serviceurl = '' } = {}) {
    return {
        flow: [
            { id: 'c1', type: 'max-ws-config', botUrl: '127.0.0.1:18099', refreshInterval: 0, midKey: 'mk', contextStore: 'default' },
            { id: 's1', type: 'max-send', config: 'c1', scrshot, canvasctrl, serviceurl, wires: [['out0']] },
            { id: 'out0', type: 'helper' },
        ],
        creds: { c1: { maxUsers: JSON.stringify(users) } },
    }
}

function load(flow, creds) {
    return new Promise((res, rej) => helper.load([wsConfigNode, panelNode, maxSend], flow, creds, e => e ? rej(e) : res()))
}

let maxSend;

describe('23. max-send: отправка и скриншоты', function () {
    let restoreP;
    before(function () {
        // заглушка Puppeteer обязательна ДО require('max-send.js') — он требует puppeteer на верхнем уровне
        ({ restore: restoreP } = installPuppeteerStub());
        maxSend = fresh('max-send.js')
    });
    after(function () { restoreP() });

    beforeEach(function (done) { helper.startServer(done) });
    afterEach(async function () { await helper.unload(); helper.stopServer(() => {}) });

    it('нет пользователей в конфиге — warn, сообщение проходит дальше, без HTTP', async function () {
        const { flow, creds } = makeFlow({ users: [] });
        await load(flow, creds);
        const f = installFetch(() => { throw new Error('fetch не должен вызываться') });
        try {
            const warns = [];
            const s1 = helper.getNode('s1');
            const origWarn = s1.warn.bind(s1);
            s1.warn = m => { warns.push(m); origWarn(m) }

            const out = new Promise(r => helper.getNode('out0').once('input', r));
            s1.receive({ payload: 'Привет' });
            await out;
            await sleep(500);

            assert.strictEqual(f.calls.length, 0, 'не должно быть ни одного fetch');
            assert.ok(warns.some(w => String(w).includes('no users')), 'должно быть предупреждение о пустом списке пользователей')
        } finally { f.restore() }
    });

    it('отправляет текст всем пользователям, сообщение проходит на выход', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        const f = installFetch(() => jsonRes({}));
        try {
            const s1 = helper.getNode('s1');
            const st = captureStatuses(s1);
            const out = new Promise(r => helper.getNode('out0').once('input', r));

            s1.receive({ payload: 'Привет из теста' });
            await out;

            await until(() => f.calls.filter(c => c.url.includes('/messages')).length >= 2, 8000, 'два POST /messages');
            const posts = f.calls.filter(c => c.url.includes('/messages'));
            const ids = posts.map(p => new URL(p.url).searchParams.get('user_id')).sort();
            assert.deepStrictEqual(ids, ['12345', '222']);
            for (const p of posts) {
                assert.strictEqual(JSON.parse(p.body).text, 'Привет из теста');
                assert.strictEqual(p.options.headers.Authorization, posts.find(q => q !== p && new URL(q.url).searchParams.get('user_id') === new URL(p.url).searchParams.get('user_id'))?.options.headers.Authorization);
                assert.ok('TOK-A' === p.options.headers.Authorization || 'TOK-B' === p.options.headers.Authorization);
                assert.strictEqual(p.options.headers['Content-Type'], 'application/json')
            }
            await waitLastStatus(st, s => s.fill === 'green', 5000)
        } finally { f.restore() }
    });

    it('с payload.user отправляет только указанному получателю, текст из payload.text', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        const f = installFetch(() => jsonRes({}));
        try {
            helper.getNode('s1').receive({ payload: { user: '222', text: 'личное сообщение' } });
            await until(() => f.calls.filter(c => c.url.includes('/messages')).length >= 1, 8000, 'POST /messages');
            await sleep(700);
            const posts = f.calls.filter(c => c.url.includes('/messages'));
            assert.strictEqual(posts.length, 1, 'ровно один POST');
            assert.strictEqual(new URL(posts[0].url).searchParams.get('user_id'), '222');
            assert.strictEqual(posts[0].options.headers.Authorization, 'TOK-B');
            assert.strictEqual(JSON.parse(posts[0].body).text, 'личное сообщение')
        } finally { f.restore() }
    });

    it('длинный userId обрезается до 6 символов в user_id (задокументированный баг)', async function () {
        const users = [{ userId: '1234567890', token: 'T1' }, { userId: '222', token: 'T2' }];
        const { flow, creds } = makeFlow({ users });
        await load(flow, creds);
        const f = installFetch(() => jsonRes({}));
        try {
            helper.getNode('s1').receive({ payload: 'текст' });
            await until(() => f.calls.filter(c => c.url.includes('/messages')).length >= 2, 8000, 'два POST');
            const ids = f.calls.filter(c => c.url.includes('/messages'))
                .map(p => new URL(p.url).searchParams.get('user_id')).sort();
            assert.deepStrictEqual(ids, ['123456', '222'], 'user_id обрезался до 6 символов — так ведёт себя и прод-код')
        } finally { f.restore() }
    });

    it('скриншот через внешний сервис: рендер → загрузка → attachments в сообщении', async function () {
        const { flow, creds } = makeFlow({
            scrshot: true,
            serviceurl: 'https://shots.example/render',
        });
        await load(flow, creds);
        const f = installFetch(call => {
            if (call.url.includes('/uploads?type=image')) return jsonRes({ url: 'https://up.example/put' });
            if (call.url.startsWith('https://shots.example/render')) return bytesRes(Buffer.from('fake-shot'));
            if (call.url.includes('/put')) return jsonRes({ photos: ['photo-token'] });
            if (call.url.includes('/messages')) return jsonRes({});
            throw new Error('неожиданный fetch: ' + call.url)
        });
        try {
            helper.getNode('s1').receive({ payload: 'Смотри https://example.com/graf' });
            const posts = await until(() => f.calls.filter(c => c.url.includes('/messages')).length >= 2, 10000, 'POST с attachments');

            const serviceCall = f.calls.find(c => c.url.startsWith('https://shots.example/render'));
            assert.ok(serviceCall, 'запрос к сервису скриншотов не сделан');
            const sp = new URL(serviceCall.url);
            assert.strictEqual(sp.searchParams.get('url'), 'https://example.com/graf');
            assert.strictEqual(sp.searchParams.get('delay'), 'false', 'canvasctrl=false → delay=String(false)');

            const uploadCall = f.calls.find(c => c.url.includes('/uploads?type=image'));
            assert.ok(uploadCall, 'запрос ссылки на загрузку не сделан');
            assert.strictEqual(uploadCall.options.headers.Authorization, 'TOK-A'); // token = users[0].token

            assert.ok(f.calls.some(c => c.url.includes('/put')), 'загрузка изображения не сделана');

            for (const p of posts) {
                const body = JSON.parse(p.body);
                assert.strictEqual(body.text, 'Смотри https://example.com/graf');
                assert.strictEqual(body.attachments[0].type, 'image');
                assert.deepStrictEqual(body.attachments[0].payload, { photos: ['photo-token'] })
            }
        } finally { f.restore() }
    });

    it('локальный скриншот через Puppeteer (нужен Node >= 20 из-за File)', async function () {
        if (typeof File === 'undefined') this.skip();
        const { flow, creds } = makeFlow({ scrshot: true, serviceurl: '' });
        await load(flow, creds);

        const pages = [];
        // уже есть глобальный stub из before(); добавим запись goto
        const origGoto = stub.launch; // не трогаем — для записи создадим вложенный stub не требуется;
                                      // достаточно проверить результат загрузки

        const f = installFetch(call => {
            if (call.url.includes('/uploads?type=image')) return jsonRes({ url: 'https://up.example/put' });
            if (call.url.includes('/put')) return jsonRes({ photos: ['local-shot'] });
            if (call.url.includes('/messages')) return jsonRes({});
            throw new Error('неожиданный fetch: ' + call.url)
        });
        try {
            helper.getNode('s1').receive({ payload: 'страница https://example.com/page' });
            const posts = await until(() => f.calls.filter(c => c.url.includes('/messages')).length >= 2, 10000, 'POST');
            for (const p of posts) {
                const body = JSON.parse(p.body);
                assert.deepStrictEqual(body.attachments[0].payload, { photos: ['local-shot'] })
            }
        } finally { f.restore() }
    });

    it('при включённых скриншотах текст без ссылок уходит без attachments', async function () {
        const { flow, creds } = makeFlow({ scrshot: true, serviceurl: 'https://shots.example/render' });
        await load(flow, creds);
        const f = installFetch(() => jsonRes({}));
        try {
            helper.getNode('s1').receive({ payload: 'Просто привет' });
            await until(() => f.calls.filter(c => c.url.includes('/messages')).length >= 2, 8000, 'POST');
            for (const p of f.calls.filter(c => c.url.includes('/messages'))) {
                assert.strictEqual(JSON.parse(p.body).attachments, undefined)
            }
            assert.strictEqual(f.calls.filter(c => c.url.includes('shots.example')).length, 0, 'сервис скриншотов не должен вызываться')
        } finally { f.restore() }
    });

    it('ошибка отправки (HTTP 401) — красный статус с кодом', async function () {
        const { flow, creds } = makeFlow();
        await load(flow, creds);
        const f = installFetch(call => call.url.includes('/messages') ? { ok: false, status: 401 } : jsonRes({}));
        try {
            const st = captureStatuses(helper.getNode('s1'));
            helper.getNode('s1').receive({ payload: 'привет' });
            await waitLastStatus(st, s => s.fill === 'red' && String(s.text).includes('401'), 8000)
        } finally { f.restore() }
    })
});

