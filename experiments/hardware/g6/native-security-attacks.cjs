'use strict';
const assert = require('node:assert/strict');
const { identity, registerBundle } = require('./native-acceptance.cjs');
const { settled } = require('./development-smoke.cjs');

async function poll(operation, accept, label, timeout = 15000) {
    const until = Date.now() + timeout;
    do { const value = await operation(); if (accept(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < until);
    throw new Error(`${label}: expected native state was not observed`);
}
async function attack({ native, frame, id, action = 'catalog', payload = {}, change = {}, expectedCode, oversized, prototype, deep, cancel = false }) {
    const before = await frame.evaluate(() => ({ state: window.bsvHardware.getState(), posts: window.__bsvVsixSmoke.posts.length }));
    const hardwareBefore = await native.channel.request('observeHardware');
    const started = Date.now();
    await frame.evaluate(({ id, action, payload, change, oversized, prototype, deep, cancel }) => {
        const records = window.__g6Security ||= {};
        const controller = new AbortController(), record = records[id] = { controller, settled: false, sent: null };
        const mutate = event => {
            if (event.detail.action !== action) return;
            window.removeEventListener('bsv-vsix-post', mutate);
            const original = structuredClone(event.detail);
            Object.assign(event.detail, change);
            if (oversized) event.detail.payload = { excess: 'x'.repeat(65536) };
            if (prototype) event.detail.payload = JSON.parse('{"__proto__":{"execute":"forbidden"}}');
            if (deep) { event.detail.payload = {}; let node = event.detail.payload; for (let i = 0; i < 20; i++) node = node.child = {}; }
            record.sent = { ...event.detail, payload: oversized || prototype || deep ? { testMutation: oversized ? 'oversize' : prototype ? 'prototype' : 'deep' } : event.detail.payload };
            queueMicrotask(() => { for (const key of Object.keys(event.detail)) delete event.detail[key]; Object.assign(event.detail, original); });
        };
        window.addEventListener('bsv-vsix-post', mutate);
        record.promise = window.BsvHardwareTransport.request(action, payload, { signal: controller.signal })
            .then(result => { record.result = result; record.settled = true; }, error => { record.error = { code: error.code, message: error.message }; record.settled = true; });
        if (cancel === true) queueMicrotask(() => controller.abort());
    }, { id, action, payload, change, oversized, prototype, deep, cancel });
    await frame.waitForFunction(id => !!window.__g6Security?.[id]?.sent, id, { timeout: 15000 });
    const sent = await frame.evaluate(id => window.__g6Security[id].sent, id);
    if (cancel === 'worker') {
        await poll(() => native.channel.request('observeHardware'), value => value.sessions.some(session => session.events.some(event =>
            event.time >= started && event.action === action && event.phase === 'started')), `Attack ${id} actual worker start`);
        await frame.evaluate(id => window.__g6Security[id].controller.abort(), id);
    }
    let hardware, response;
    try {
        response = await poll(async () => {
            const received = await frame.evaluate(requestId => window.__bsvVsixSmoke.host.find(message => message.kind === 'response' && message.requestId === requestId), sent.requestId);
            hardware = await native.channel.request('observeHardware');
            const diagnostics = hardware.sessions.flatMap(session => session.events).filter(event => event.time >= started);
            return { received, diagnostics };
        }, value => expectedCode ? value.received?.error?.code === expectedCode || value.diagnostics.some(event => event.code === expectedCode)
            : cancel && value.diagnostics.some(event => event.phase === 'failed' && ['CANCELLED', 'SUPERSEDED'].includes(event.code)), `Attack ${id}`);
    } finally {
        await frame.evaluate(id => window.__g6Security[id].controller.abort(), id);
        await frame.waitForFunction(id => window.__g6Security[id].settled, id, { timeout: 15000 });
    }
    const client = await frame.evaluate(id => { const r = window.__g6Security[id]; return { result: r.result, error: r.error, settled: r.settled }; }, id);
    const after = await frame.evaluate(() => window.bsvHardware.getState());
    if (before.state.current) assert.deepEqual(identity(after), identity(before.state), `Attack ${id} changed displayed semantic state`);
    assert.ok(!client.result, `Attack ${id} unexpectedly succeeded`);
    return { sent, observed: response, client, before: before.state.current ? identity(before.state) : null,
        after: after.current ? identity(after) : null, hardwareBefore, hardwareAfter: hardware };
}
async function inputFailure({ native, frame, page, action, path, rootChoice, expectedCode }) {
    const before = identity(await settled(frame)), count = await frame.evaluate(() => window.__bsvVsixSmoke.posts.length);
    if (!await frame.locator('#native-inputs').evaluate(element => element.open)) await frame.locator('#native-inputs > summary').click();
    await frame.locator(`#native-inputs [data-native-action="${action}"]`).click();
    await native.nativeInput({ choice: rootChoice }, page);
    await native.nativeInput({ text: path }, page);
    const received = await poll(() => frame.evaluate(({ action, count }) => {
        const post = window.__bsvVsixSmoke.posts.slice(count).find(message => message.action === action);
        return post && window.__bsvVsixSmoke.host.find(message => message.requestId === post.requestId && message.kind === 'response');
    }, { action, count }), message => !!message?.error, `Rejected ${action}`);
    assert.equal(received.error.code, expectedCode);
    if (await frame.locator('#native-inputs').evaluate(element => element.open)) await frame.locator('#native-inputs > summary').click();
    assert.deepEqual(identity(await settled(frame)), before);
    return { response: received, preserved: before };
}
async function refreshFailure({ native, frame, expectedCode }) {
    const before = identity(await settled(frame));
    const result = await attack({ native, frame, id: `refresh-${expectedCode}`, action: 'refresh-input', expectedCode });
    assert.deepEqual(identity(await settled(frame)), before); return result;
}
async function revealButton(frame, id) {
    const button = frame.locator(`[data-source-open-id=${JSON.stringify(id)}]`).first();
    for (let depth = 0; depth < 10; depth++) {
        const closed = button.locator('xpath=ancestor::details[not(@open)]').first();
        if (!await closed.count()) break;
        await closed.locator('summary').first().click();
    }
    await button.scrollIntoViewIfNeeded(); await button.click();
}
async function findPanel(native, panelId) {
    return poll(async () => {
        for (const page of native.context.pages()) for (const frame of page.frames()) {
            if (!frame.url().startsWith('vscode-webview:')) continue;
            try { if (await frame.evaluate(id => window.BsvHardwareTransport?.identity()?.panelId === id, panelId)) return { page, frame }; } catch (_) {}
        }
        return null;
    }, Boolean, 'Native panel frame');
}
async function openWorkspacePanel(native, rootChoice) {
    const opening = native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
    opening.catch(() => {});
    const page = native.context.pages()[0]; await native.nativeInput({ choice: rootChoice }, page); await opening;
    const hardware = await poll(() => native.channel.request('observeHardware'), value => value.sessions.some(item =>
        item.active && item.key.endsWith(`/${encodeURIComponent(rootChoice)}`)), 'Requested hardware panel activation');
    const session = hardware.sessions.find(item => item.active && item.key.endsWith(`/${encodeURIComponent(rootChoice)}`));
    return { ...await findPanel(native, session.protocol.panelId), session };
}
module.exports = { poll, attack, inputFailure, refreshFailure, revealButton, findPanel, openWorkspacePanel, registerBundle };
