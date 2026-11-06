'use strict';
const { patchModule } = require('./patch-require');

function createStubPuppeteer(overrides = {}) {
    const page = {
        url: () => 'https://example.com/final',
        emulateTimezone: async () => {},
        emulate: async () => {},
        goto: async () => {},
        waitForFunction: async () => {},
        waitForSelector: async () => {},
        evaluate: async () => true,
        screenshot: async () => Buffer.from('fake-jpeg'),
        ...(overrides.page || {})
    }
    const browser = { newPage: async () => page, close: async () => {}, ...(overrides.browser || {}) };
    return { devices: { 'iPhone 13': { name: 'iPhone 13' } }, launch: async () => browser, ...(overrides.root || {}) }
}

function install(overrides) {
    const stub = createStubPuppeteer(overrides);
    return { stub, restore: patchModule('puppeteer', stub) }
}

module.exports = { install, createStubPuppeteer }