'use strict';
const Module = require('module');

function patchModule(request, replacement) {
    const orig = Module._load;
    Module._load = function (req) {
        if (req === request) return replacement;
        return orig.apply(this, arguments)
    }
    let done = false;
    return function restore() { 
        if (!done) { 
            done = true; 
            Module._load = orig 
        } 
    }
}

module.exports = { patchModule }
