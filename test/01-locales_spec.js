'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const H = require('./helpers/parse-html-node');

const NODES_DIR = path.join(__dirname, '..', 'nodes');
const LOCALES_DIR = path.join(NODES_DIR, 'locales');
const TYPES = ['max-ws-config', 'max-panel', 'max-control', 'max-switch', 'max-send'];

function flatten(obj, prefix = '') {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object') Object.assign(out, flatten(v, key))
        else out[key] = v
    }
    return out
}

describe('01. Файлы локалей', function () {
    let files = [];
    const locales = {};

    before(function () {
        if (!fs.existsSync(LOCALES_DIR)) { 
            this.skip(); 
            return 
        }
        files = fs.readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json'))
    });

    it('есть хотя бы один файл локали', function () { assert.ok(files.length >= 1) });

    it('JSON валиден во всех файлах', function () {
        for (const f of files) {
            locales[f] = flatten(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, f), 'utf8')))
        }
    });

    it('нет пустых значений', function () {
        for (const f of files) {
            for (const [k, v] of Object.entries(locales[f])) {
                assert.ok(v && String(v).trim(), `${f}: пустое значение для "${k}"`)
            }
        }
    });

    it('одинаковый набор ключей во всех языках', function () {
        if (files.length < 2) this.skip();
        const baseKeys = Object.keys(locales[files[0]]).sort();
        for (const f of files.slice(1)) {
            const keys = Object.keys(locales[f]).sort();
            const onlyInBase = baseKeys.filter(k => !keys.includes(k));
            const onlyHere = keys.filter(k => !baseKeys.includes(k));
            const diff = [];
            if (onlyInBase.length) diff.push(`нет в ${f}: ${onlyInBase.join(', ')}`);
            if (onlyHere.length) diff.push(`лишние в ${f}: ${onlyHere.join(', ')}`);
            assert.deepStrictEqual(keys, baseKeys,
                `${f}: ${keys.length} строк против ${baseKeys.length} в ${files[0]}. ${diff.join('; ')}`)
        }
    });

    it('все ключи data-i18n из .html есть в каждой локали', function () {
        for (const t of TYPES) {
            const src = fs.readFileSync(path.join(NODES_DIR, t + '.html'), 'utf8');
            for (const k of H.extractI18nKeys(src)) {
                for (const f of files) {
                    assert.ok(k in locales[f], `${t}.html: ключ "${k}" отсутствует в ${f}`)
                }
            }
        }
    });

    it('все ключи RED._() из .js есть в каждой локали', function () {
        for (const t of TYPES) {
            const src = fs.readFileSync(path.join(NODES_DIR, t + '.js'), 'utf8');
            for (const k of H.extractRedUnderscoreKeys(src)) {
                for (const f of files) {
                    assert.ok(k in locales[f], `${t}.js: ключ "${k}" отсутствует в ${f}`)
                }
            }
        }
    });

    it('все статусы-ключи из .js есть в каждой локали', function () {
        for (const t of TYPES) {
            const src = fs.readFileSync(path.join(NODES_DIR, t + '.js'), 'utf8');
            const re = /text:\s*["']([a-z][a-z0-9-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)["']/g;
            let m;
            while ((m = re.exec(src))) {
                for (const f of files) {
                    assert.ok(m[1] in locales[f], `${t}.js: статус-ключ "${m[1]}" отсутствует в ${f}`)
                }
            }
        }
    });

    it('динамические ключи статусов (с конкатенацией) — только предупреждение', function () {
        const warnings = [];
        for (const t of TYPES) {
            const src = fs.readFileSync(path.join(NODES_DIR, t + '.js'), 'utf8');
            const re = /["']([a-z-]+\.[\w-]+)\."\s*\+/g; // 'max-send.status.' + ...
            let m;
            while ((m = re.exec(src))) warnings.push(`${t}.js: динамический ключ "${m[1]}" + …`)
        }
        if (warnings.length) console.warn('   [warn] ' + warnings.join('; '))
    })
});