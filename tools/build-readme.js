// tools/build-readme.js
// Сборка README.md из help-блоков узлов Node-RED
// (<script type="text/html" или "text/x-red" data-help-name="..."> в .html)
// Запуск: node tools/build-readme.js   •   внешних зависимостей нет
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const HTML_DIR = path.join(SRC, 'locales', 'en-US');   // ← где лежат html

// ─── Порядок секций в README ───
// type должен совпадать с data-help-name в соответствующем html-файле.
const NODES = [
    { type: 'max-send',      file: 'max-send.html' },
    { type: 'max-ws-config', file: 'max-ws-config.html' },
    { type: 'max-panel',     file: 'max-panel.html' },    // ← проверьте реальный тип
    { type: 'max-control',   file: 'max-control.html' },
    { type: 'max-switch',    file: 'max-switch.html' },
];

// ─── Статическая шапка пакета — рукописная, генератор её не трогает ───
const HEADER = `node-red-contrib-max-client
===================

Install
-------

Version 1.x of this node is usually installed by default by Node-RED.
As long as you have at least version 0.19.x of Node-RED you can install the new version
by using the \`Menu - Manage Palette\` option, or running the following command in your
Node-RED user directory - typically \`~/.node-red\`

        cd ~/.node-red
        npm i node-red-contrib-max-client

Usage
-----

The package provides nodes for the MAX messenger:
- \`max-ws-config\` — WebSocket connection and panel management
- \`max-panel\` — control panel configuration
- \`max-control\` — panel buttons
- \`max-switch\` — panel switching
- \`max-send\` — message sending with optional page screenshots

`;

// ─── Инлайновый HTML → markdown ───
function inlineToMd(s) {
    return s
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
        .replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, '**$1**')
        .replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, '*$1*')
        .replace(/<span[^>]*>\s*([^<]*?)\s*<\/span>/gi, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
}

// ─── <dl class="message-properties"> → «- **Термин** (required) — описание» ───
function dlToList(html) {
    return html.replace(/<dl[^>]*>([\s\S]*?)<\/dl>/gi, (all, inner) => {
        const items = [];
        const dtRe = /<dt[^>]*>([\s\S]*?)<\/dt>([\s\S]*?)(?=<dt[^>]*>|$)/gi;
        let m;
        while ((m = dtRe.exec(inner)) !== null) {
            // <span class="required">required</span> → «(required)»
            const term = inlineToMd(m[1].replace(/<span[^>]*>\s*([^<]*?)\s*<\/span>/gi, '($1)'));
            const defs = [...m[2].matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/gi)]
                .map(x => inlineToMd(x[1]))
                .filter(Boolean);
            if (!term) continue;
            let item = '- **' + term + '**';
            if (defs[0]) item += ' — ' + defs[0];
            if (defs.length > 1) item += '\n  ' + defs.slice(1).join('\n  ');
            items.push(item);
        }
        return '\n' + items.join('\n') + '\n';
    });
}

// ─── Help-блок → markdown ───
function helpToMarkdown(block) {
    const html = dlToList(block);
    const out = [];
    let pos = 0;
    let para = [];

    const flushPara = () => {
        const raw = para.join(' ');
        if (raw.trim()) {
            const lines = [];
            for (const l of raw.split('\n')) {
                const ls = l.replace(/\s+/g, ' ').trim();
                if (!ls) continue;
                // продолжения dd сохраняют отступ ровно в два пробела
                lines.push(l.startsWith('  ') ? '  ' + ls : ls);
            }
            if (lines.length) out.push(lines.join('\n'));
        }
        para = [];
    };

    const blockRe = /<h3[^>]*>([\s\S]*?)<\/h3>|<p[^>]*>([\s\S]*?)<\/p>|<ul[^>]*>([\s\S]*?)<\/ul>/gi;
    let m;
    while ((m = blockRe.exec(html)) !== null) {
        para.push(html.slice(pos, m.index));
        pos = blockRe.lastIndex;
        if (m[1] !== undefined) {                     // <h3>
            flushPara();
            out.push('### ' + inlineToMd(m[1]));
        } else if (m[2] !== undefined) {              // <p>
            flushPara();
            out.push(inlineToMd(m[2]).replace(/\s+/g, ' '));
        } else {                                      // <ul>
            flushPara();
            const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
            let li;
            while ((li = liRe.exec(m[3])) !== null) {
                const item = inlineToMd(li[1]).replace(/\s+/g, ' ');
                if (item) out.push('- ' + item);
            }
        }
    }
    para.push(html.slice(pos));
    flushPara();

    return out.join('\n');
}

// пустые строки вокруг списков и заголовков
function tidy(md) {
    const lines = md.split('\n');
    const res = [];
    const isList = l => l.startsWith('- ') || l.startsWith('  ');
    for (const line of lines) {
        const prev = res[res.length - 1];
        if (prev === undefined) { res.push(line); continue; }
        const prevList = isList(prev), curList = isList(line);
        if (curList && !prevList && prev.trim()) res.push('');
        else if (!curList && prevList && line.trim() && !line.startsWith('###')) res.push('');
        else if (line.startsWith('###') && prev.trim()) res.push('');
        res.push(line);
    }
    return res.join('\n');
}

// ─── Разрез markdown на Usage / Input / Output ───
// Usage — список именованных кусков { name, text } в порядке появления;
// заголовки кроме Input/Output (Settings, Statuses, ...) сохраняются жирными.
function toSections(md) {
    const usage = [];
    const input = [];
    const output = [];
    let current = { dest: usage, name: null, lines: [] };

    const flush = () => {
        const text = current.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        if (!text) return;
        if (current.dest === usage) current.dest.push({ name: current.name, text });
        else current.dest.push(text);
    };

    for (const line of md.split('\n')) {
        const h = line.match(/^###\s+(.+?)\s*$/);
        if (h) {
            flush();
            const name = h[1];
            const low = name.toLowerCase();
            current = /^inputs?$/.test(low) ? { dest: input,  name, lines: [] }
                    : /^outputs?$/.test(low) ? { dest: output, name, lines: [] }
                    : { dest: usage, name, lines: [] };
            continue;
        }
        current.lines.push(line);
    }
    flush();

    const clean = a => a.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { usage, input: clean(input), output: clean(output) };
}

// ─── Извлечение help-блока по data-help-name (text/html и text/x-red) ───
function extractHelp(file, type) {
    const html = fs.readFileSync(path.join(HTML_DIR, file), 'utf8');
    const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (new RegExp('data-help-name\\s*=\\s*["\']' + type + '["\']').test(m[1])) {
            return m[2].trim();
        }
    }
    throw new Error('help-блок data-help-name="' + type + '" не найден в ' + file);
}

// ─── Секция узла по шаблону: Usage (с именованными секциями) → Input → Output ───
function buildNodeSection(node) {
    const md = tidy(helpToMarkdown(extractHelp(node.file, node.type)));
    const s = toSections(md);
    let out = '### ' + node.type;
    for (const u of s.usage) {
        out += '\n\n' + (u.name ? '**' + u.name + '**\n' + u.text : u.text);
    }
    if (s.input)  out += '\n\n### Input\n\n' + s.input;
    if (s.output) out += '\n\n### Output\n\n' + s.output;
    return out;
}

// ─── Сборка и запись ───
const readme = HEADER + NODES.map(buildNodeSection).join('\n\n') + '\n';

fs.writeFileSync(path.join(SRC, 'README.md'), readme);
console.log('README.md собран: шапка + ' + NODES.length + ' секций узлов');
