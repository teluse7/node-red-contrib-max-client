'use strict';

function findRegisterTypeBlocks(src) {
    const blocks = [];
    const re = /RED\.nodes\.registerType\s*["']([a-zA-Z0-9_-]+)["']\s*,/g;
    let m;
    while ((m = re.exec(src))) {
        const start = m.index + m[0].length;
        let depth = 0, inStr = null, i;
        for (i = start; i < src.length; i++) {
            const ch = src[i];
            if (inStr) { 
                if (ch === inStr && src[i - 1] !== '\\') inStr = null; 
                continue 
            }
            if (ch === '"' || ch === "'") inStr = ch
            else if (ch === '{' || ch === '(' || ch === '[') depth++
            else if (ch === '}' || ch === ')' || ch === ']') { 
                depth--; 
                if (depth < 0) break 
            }
        }
        blocks.push({ type: m[1], body: src.slice(start, i) })
    }
    return blocks
}

function extractObjectBlock(body, key) {
    const m = body.match(new RegExp('\\b' + key + '\\s*:\\s*\\{'));
    if (!m) return null;
    const open = body.indexOf('{', m.index);
    let depth = 0, inStr = null;
    for (let i = open; i < body.length; i++) {
        const ch = body[i];
        if (inStr) { 
            if (ch === inStr && body[i - 1] !== '\\') inStr = null; 
            continue
        }
        if (ch === '"' || ch === "'") inStr = ch
        else if (ch === '/' && body[i + 1] === '/') { 
            while (i < body.length && body[i] !== '\n') i++; 
            continue
        }
        else if (ch === '{') depth++
        else if (ch === '}') { 
            depth--; 
            if (depth === 0) return body.slice(open + 1, i) 
        }
    }
    return null
}

function topLevelKeys(objSrc) {
    const keys = [];
    let depth = 0, inStr = null, buf = '';
    for (let i = 0; i < objSrc.length; i++) {
        const ch = objSrc[i];
        if (inStr) { 
            if (ch === inStr && objSrc[i - 1] !== '\\') inStr = null; 
            continue
        }
        if (ch === '"' || ch === "'") { 
            inStr = ch; 
            continue
        }
        if (ch === '/' && objSrc[i + 1] === '/') { 
            while (i < objSrc.length && objSrc[i] !== '\n') i++; 
            continue
        }
        if (ch === '{' || ch === '(' || ch === '[') { 
            depth++; 
            continue
        }
        if (ch === '}' || ch === ')' || ch === ']') { 
            depth--; 
            continue
        }
        if (depth === 0) {
            if (ch === ':') {
                const key = buf.replace(/[\s,]/g, '');
                if (key) keys.push(key);
                buf = ''
            } else buf += ch
        }
    }
    return keys
}

function extractTemplate(src, templateName) {
    const start = src.indexOf('data-template-name="' + templateName + '"');
    if (start === -1) return null;
    const end = src.indexOf('</script>', start);
    return src.slice(start, end === -1 ? src.length : end)
}

function extractInputIds(tpl) {
    const ids = [];
    const re = /id="node-(?:input|config)-input-([a-zA-Z0-9_]+)"/g;
    let m;
    while ((m = re.exec(tpl))) ids.push(m[1]);
    return [...new Set(ids)]
}

function extractI18nKeys(tpl) {
    const keys = [];
    const re = /data-i18n[a-z-]*\s*=\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(tpl))) {
        let k = m[1];
        if (k.startsWith('[')) k = k.slice(k.indexOf(']') + 1);
        keys.push(k)
    }
    return [...new Set(keys)]
}

function extractRedUnderscoreKeys(src) {
    const keys = [];
    const re = /RED\._\(\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(src))) keys.push(m[1]);
    return [...new Set(keys)]
}

function findUnwrappedI18nKeys(src) {
    const issues = [];
    src.split('\n').forEach((line, idx) => {
        const re = /["']((?:max-[a-z0-9-]+)(?:\.[a-zA-Z0-9_-]+)+)["']/g;
        let m;
        while ((m = re.exec(line))) {
            if (/RED\._\(\s*$/.test(line.slice(0, m.index).trimEnd())) continue;
            issues.push({ line: idx + 1, key: m[1] })
        }
    });
    return issues
}

module.exports = {
    findRegisterTypeBlocks,
    extractObjectBlock,
    topLevelKeys,
    extractTemplate,
    extractInputIds,
    extractI18nKeys,
    extractRedUnderscoreKeys,
    findUnwrappedI18nKeys
}
