'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { install: installPuppeteerStub } = require('./helpers/stub-puppeteer');
const H = require('./helpers/parse-html-node');

const NODES_DIR = path.join(__dirname, '..'); // поправьте, если узлы лежат не в nodes/

const NODES = [
    { type: 'max-ws-config', kind: 'config', icon: null, exceptions: ['contextStore'], credentials: ['maxUsers'] },
    { type: 'max-panel',     kind: 'config', icon: null, exceptions: [], credentials: [] },
    { type: 'max-control',   kind: 'node',   icon: 'bridge.svg',    exceptions: [], credentials: [], io: { inputs: 0, outputs: 1 } },
    { type: 'max-switch',    kind: 'node',   icon: 'switch.svg',    exceptions: [], credentials: [], io: { inputs: 1, outputs: 0 } },
    { type: 'max-send',      kind: 'node',   icon: 'max-icon.png',  exceptions: [], credentials: [], io: { inputs: 1, outputs: 1 } },
];

function stubRED(registrations) {
    return {
        nodes: {
            registerType: (type, ctor, opts) => registrations.set(type, { ctor, opts: opts || {} }),
            createNode: (node) => {
                node.context = () => ({ global: { get: () => null, set: () => {} } });
                node.on = () => {}; node.status = () => {}; node.send = () => {};
                node.error = () => {}; node.warn = () => {}; node.log = () => {};
            },
            getNode: () => null, eachNode: () => {}, eachConfig: () => {}
        },
        _: k => k
    }
}

describe('00. Регистрация узлов и консистентность .js ↔ .html', function () {
    const registrations = new Map();
    before(function () {
        const { restore } = installPuppeteerStub(); // max-send.js требует puppeteer на верхнем уровне
        for (const n of NODES) require(path.join(NODES_DIR, n.type + '.js'))(stubRED(registrations));
        restore()
    });

    it('набор типов в .js и .html совпадает', function () {
        const htmlTypes = new Set();
        for (const f of fs.readdirSync(NODES_DIR).filter(f => f.endsWith('.html'))) {
            for (const b of H.findRegisterTypeBlocks(fs.readFileSync(path.join(NODES_DIR, f), 'utf8'))) htmlTypes.add(b.type)
        }
        assert.deepStrictEqual([...htmlTypes].sort(), NODES.map(n => n.type).sort(), 'в .html зарегистрированы не те типы, что в .js')
    });

    for (const n of NODES) {
        describe(`узел ${n.type}`, function () {
            let htmlSrc, block, defaultsSrc, tpl;
            before(function () {
                htmlSrc = fs.readFileSync(path.join(NODES_DIR, n.type + '.html'), 'utf8');
                const blocks = H.findRegisterTypeBlocks(htmlSrc).filter(b => b.type === n.type);
                assert.strictEqual(blocks.length, 1, `registerType("${n.type}") должен встречаться в .html ровно один раз`);
                block = blocks[0];
                defaultsSrc = H.extractObjectBlock(block.body, 'defaults');
                tpl = H.extractTemplate(htmlSrc, n.type)
            });

            it('зарегистрирован в .js', function () { assert.ok(registrations.has(n.type)) });
            it('шаблон существует', function () { assert.ok(tpl !== null) });
            it('defaults объявлены в .html', function () { assert.ok(defaultsSrc !== null) });

            it('у каждого default-поля есть input в шаблоне', function () {
                const ids = H.extractInputIds(tpl);
                for (const k of H.topLevelKeys(defaultsSrc)) {
                    if (n.exceptions.includes(k)) continue;
                    assert.ok(ids.includes(k), `поле "${k}" не имеет input #node-${n.kind === 'config' ? 'config' : ''}-input-${k} в шаблоне`)
                }
            });

            it('у полей credentials есть input (можно скрытый)', function () {
                const ids = H.extractInputIds(tpl);
                for (const c of n.credentials) assert.ok(ids.includes(c), `нет input для credentials.${c}`)
            });

            if (n.credentials.length) {
                it('credentials объявлены в options регистрации', function () {
                    assert.deepStrictEqual(Object.keys(registrations.get(n.type).opts.credentials || {}), n.credentials);
                })
            }

            if (n.io) {
                it(`inputs=${n.io.inputs}, outputs=${n.io.outputs}`, function () {
                    assert.ok(new RegExp(`inputs:\\s*${n.io.inputs}`).test(block.body), 'inputs не совпадают');
                    assert.ok(new RegExp(`outputs:\\s*${n.io.outputs}`).test(block.body), 'outputs не совпадают')
                })
            }

            if (n.icon) {
                it(`иконка ${n.icon} существует`, function () {
                    assert.ok(fs.existsSync(path.join(NODES_DIR, n.icon)), `файл иконки ${n.icon} не найден`)
                })
            }

            it('ключи data-i18n из .html принадлежат пространству имён узла', function () {
                for (const k of H.extractI18nKeys(htmlSrc)) assert.ok(k.startsWith(n.type + '.'), `чужой ключ i18n: ${k}`)
            });

            it('ключи RED._() в .js принадлежат пространству имён узла', function () {
                const src = fs.readFileSync(path.join(NODES_DIR, n.type + '.js'), 'utf8');
                for (const k of H.extractRedUnderscoreKeys(src)) assert.ok(k.startsWith(n.type + '.'), `чужой ключ RED._: ${k}`)
            })
        })
    }
});
