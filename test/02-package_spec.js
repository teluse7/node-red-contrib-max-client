'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const TYPES = ['max-ws-config', 'max-panel', 'max-control', 'max-switch', 'max-send'];

describe('02. package.json', function () {
    it('валиден: имя, версия, main-поля', function () {
        assert.ok(pkg.name, 'нет name');
        assert.ok(/^\d+\.\d+\.\d+/.test(pkg.version || ''), 'нет корректной version');
        assert.ok(pkg.description, 'нет description')
    });

    it('в node-red.nodes перечислены существующие файлы', function () {
        const nodes = pkg['node-red']?.nodes;
        assert.ok(nodes && typeof nodes === 'object', 'нет секции node-red.nodes');
    
        for (const filePath of Object.values(nodes)) {
            assert.ok(fs.existsSync(path.join(ROOT, filePath)), 
                `файл "${filePath}" из node-red.nodes не найден`)
        }
    });

    it('все .js файлы узлов перечислены в node-red.nodes', function () {
        const listedFiles = new Set(Object.values(pkg['node-red'].nodes));
    
        for (const type of TYPES) {
            const expectedFile = `${type}.js`;
            assert.ok(listedFiles.has(expectedFile), 
                `файл узла ${expectedFile} не перечислен в node-red.nodes`)
        }
    });    

    it('ws и puppeteer указаны в dependencies (не только devDependencies)', function () {
        const deps = pkg.dependencies || {};
        assert.ok(deps.ws, 'ws должен быть в dependencies');
        assert.ok(deps.puppeteer, 'puppeteer должен быть в dependencies')
    });

    it('есть скрипт test', function () {
        assert.ok(pkg.scripts && pkg.scripts.test, 'нет scripts.test')
    })
});
