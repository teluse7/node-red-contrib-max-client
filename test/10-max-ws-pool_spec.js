'use strict';
const assert = require('assert');
const { patchModule } = require('./helpers/patch-require');
const FakeWS = require('./helpers/fake-ws');

const POOL = require.resolve('../max-ws-pool.js');
let pool;

describe('10. max-ws-pool (юнит, с подменённым ws)', function () {
    before(function () {
        const restore = patchModule('ws', FakeWS);
        FakeWS.reset();
        delete require.cache[POOL];
        pool = require(POOL);
        restore();
        Module._load = orig
    });

    it('одинаковые url+token переиспользуют одно соединение', function () {
        FakeWS.reset();
        const a = new pool('wss://srv/ws', { headers: { Authorization: 'T' } });
        const b = new pool('wss://srv/ws', { headers: { Authorization: 'T' } });
        assert.strictEqual(FakeWS.instances.length, 1, 'должно быть одно реальное соединение');
        let openedA = false, openedB = false;
        a.on('open', () => openedA = true);
        b.on('open', () => openedB = true);
        FakeWS.instances[0]._open();
        assert.ok(openedA && openedB, 'оба подписчика должны получить open');
        a.send('hello');
        assert.deepStrictEqual(FakeWS.instances[0].sent, ['hello'])
    });

    it('разные токены дают разные соединения', function () {
        FakeWS.reset();
        new pool('wss://srv/ws', { headers: { Authorization: 'A' } });
        new pool('wss://srv/ws', { headers: { Authorization: 'B' } });
        assert.strictEqual(FakeWS.instances.length, 2)
    });

    it('без токена каждый вызов — отдельное соединение (fallback)', function () {
        FakeWS.reset();
        new pool('wss://srv/ws', {});
        new pool('wss://srv/ws', {});
        assert.strictEqual(FakeWS.instances.length, 2)
    });

    it('send до открытия бросает ошибку', function () {
        FakeWS.reset();
        const w = new pool('wss://srv/ws', { headers: { Authorization: 'E' } });
        assert.throws(() => w.send('x'))
    });

    it('сообщение рассылается всем подписчикам', function () {
        FakeWS.reset();
        const a = new pool('wss://srv/ws', { headers: { Authorization: 'M' } });
        const b = new pool('wss://srv/ws', { headers: { Authorization: 'M' } });
        let gotA = null, gotB = null;
        a.on('message', d => gotA = d);
        b.on('message', d => gotB = d);
        FakeWS.instances[0]._open();
        FakeWS.instances[0]._message('data-1');
        assert.strictEqual(gotA, 'data-1');
        assert.strictEqual(gotB, 'data-1')
    });

    it('после открытия включается пинг каждые 25 секунд', function () {
        FakeWS.reset();
        const timers = [];
        const origSI = global.setInterval;
        global.setInterval = function (fn, ms) { 
            const id = origSI(fn, ms); 
            timers.push({ fn, ms, id }); 
            return id 
        }
        try {
            new pool('wss://srv/ws', { headers: { Authorization: 'P' } });
            FakeWS.instances[0]._open();
            const ping = timers.find(t => t.ms === 25000);
            assert.ok(ping, 'таймер пинга 25000 мс не запущен');
            ping.fn();
            assert.deepStrictEqual(FakeWS.instances[0].sent, ['{"cmd":"ping"}']);
        } finally {
            global.setInterval = origSI;
            for (const t of timers) clearInterval(t.id)
        }
    });

    it('close одного подписчика закрывает всё соединение пула', function () {
        FakeWS.reset();
        const a = new pool('wss://srv/ws', { headers: { Authorization: 'C' } });
        const b = new pool('wss://srv/ws', { headers: { Authorization: 'C' } });
        let closedB = false;
        b.on('close', () => closedB = true);
        a.close();
        assert.strictEqual(FakeWS.instances[0].readyState, FakeWS.CLOSED);
        assert.ok(closedB, 'второй подписчик должен получить close');
        // пул очищен: новое соединение с тем же ключом создаёт новый сокет
        const count = FakeWS.instances.length;
        new pool('wss://srv/ws', { headers: { Authorization: 'C' } });
        assert.strictEqual(FakeWS.instances.length, count + 1)
    });

    it('close со стороны сервера уведомляет всех и очищает пул', function () {
        FakeWS.reset();
        const a = new pool('wss://srv/ws', { headers: { Authorization: 'S' } });
        let code = null;
        a.on('close', c => code = c.code);
        FakeWS.instances[0].close(1001, 'bye');
        assert.strictEqual(code, 1001);
        const count = FakeWS.instances.length;
        new pool('wss://srv/ws', { headers: { Authorization: 'S' } });
        assert.strictEqual(FakeWS.instances.length, count + 1)
    })
});
