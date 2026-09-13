'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { HardwareProtocol } = require('../src/panel/hardware-protocol');
const { createTransport } = require('../media/hardware-native');
const { PROTOCOL } = require('../src/panel/hardware-build');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function bootstrap(change = {}) { return { protocol: PROTOCOL, panelId: null, sessionId: null, buildId: 'paired-build',
    requestId: 'hello', generation: 0, snapshotId: null, action: 'hello', payload: { expectedBuildId: 'paired-build', expectedProtocol: PROTOCOL }, ...change }; }
async function paired(t, dispatch) {
    const incoming = [], outgoing = [], operations = [], diagnostics = [];
    let receive;
    const host = new HardwareProtocol({ build: { buildId: 'paired-build' },
        send: value => { outgoing.push(value); receive(structuredClone(value)); }, diagnostic: value => diagnostics.push(value),
        dispatch, welcome: () => ({ inputStatus: 'no-input' }) });
    const client = createTransport({ expectedBuildId: 'paired-build', listen: callback => { receive = callback; return () => {}; },
        postMessage: value => { incoming.push(value); operations.push(host.receive(value)); } });
    await client.ready;
    t.after(async () => { client.dispose(); await host.dispose(); await Promise.all(operations); });
    return { host, client, incoming, outgoing, operations, diagnostics };
}

test('paired native pipeline keeps legitimate pending request alive after foreign same-ID errors', async t => {
    const gate = deferred(); let calls = 0;
    const h = await paired(t, async () => { calls++; return gate.promise; });
    const pending = h.client.request('catalog'); let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; }); await tick();
    const original = h.incoming.at(-1);
    for (const foreign of [{ sessionId: 'old-session' }, { panelId: 'other-panel' }, { generation: 41 },
        { buildId: 'other-build' }, { protocol: PROTOCOL + 1 }]) {
        await h.host.receive({ ...original, ...foreign });
        const error = h.outgoing.at(-1);
        assert.equal(error.requestId, original.requestId);
        for (const [key, value] of Object.entries(foreign)) assert.equal(error[key], value);
        await tick(); assert.equal(settled, false);
    }
    assert.equal(calls, 1); gate.resolve({ status: 'transport-observation' });
    assert.deepEqual(await pending, { status: 'transport-observation' });
});
test('duplicate live and completed request IDs are ignored without cancelling or repeating original work', async t => {
    const gate = deferred(); let calls = 0;
    const h = await paired(t, async () => { calls++; return gate.promise; });
    const pending = h.client.request('catalog'); await tick();
    const request = h.incoming.at(-1), count = h.outgoing.length;
    await h.host.receive(request); assert.equal(h.outgoing.length, count); assert.equal(calls, 1);
    gate.resolve({ preserved: true }); assert.deepEqual(await pending, { preserved: true }); await tick();
    await h.host.receive(request); assert.equal(calls, 1);
    assert.equal(h.outgoing.length, count + 1);
    assert.equal(h.diagnostics.filter(row => row.reason === 'replayed-request').length, 2);
});
test('foreign bootstrap is rejected before cancellation or session reset', async t => {
    const gate = deferred(); let signal;
    const h = await paired(t, async (_action, _payload, ctx) => { signal = ctx.signal; return gate.promise; });
    const pending = h.client.request('catalog'); await tick(); const identity = h.host.identity();
    for (const changed of [{ panelId: 'other' }, { sessionId: identity.sessionId }, { generation: 1 },
        { snapshotId: 'foreign' }, { requestId: 'not-hello' }, { payload: { ...bootstrap().payload, execute: 'no' } }]) {
        await h.host.receive(bootstrap(changed)); assert.deepEqual(h.host.identity(), identity);
        assert.equal(signal.aborted, false); assert.equal(h.outgoing.at(-1).status, 'forbidden');
    }
    gate.resolve({ preserved: true }); assert.deepEqual(await pending, { preserved: true });
});
test('bootstrap build mismatch rejects actual transport readiness instead of hanging', async () => {
    let receive; const host = new HardwareProtocol({ build: { buildId: 'new-build' }, send: message => receive(message),
        dispatch: () => assert.fail('No dispatch before matching handshake'), welcome: () => ({}) });
    const client = createTransport({ expectedBuildId: 'old-build', listen: callback => { receive = callback; return () => {}; }, postMessage: message => host.receive(message) });
    await assert.rejects(client.ready, { code: 'BUILD_MISMATCH' });
    assert.equal(host.connected, false); client.dispose(); await host.dispose();
});
test('non-evicting 50000 request budget rejects new work and never reaccepts oldest ID', async () => {
    let calls = 0, last;
    const host = new HardwareProtocol({ build: { buildId: 'paired-build' }, send: message => { last = message; },
        dispatch: () => { calls++; return null; }, welcome: () => ({}) });
    await host.receive(bootstrap());
    const request = id => ({ ...host.identity(), requestId: `bounded-${id}`, snapshotId: null, action: 'catalog', payload: {} });
    for (let i = 0; i < 50000; i++) await host.receive(request(i));
    assert.equal(calls, 50000); assert.equal(host.seen.size, 50000); assert.equal(host.seen.has('bounded-0'), true);
    await host.receive(request(50000)); assert.equal(last.status, 'limited'); assert.equal(last.error.code, 'LIMIT_EXCEEDED');
    await host.receive(request(0)); assert.equal(calls, 50000); assert.equal(host.seen.size, 50000);
    await host.dispose();
});
test('actual cancellation aborts Host work and cannot publish a late successful response', async t => {
    const gate = deferred(); let signal;
    const h = await paired(t, async (_action, _payload, ctx) => { signal = ctx.signal; return gate.promise; });
    const controller = new AbortController(), pending = h.client.request('catalog', {}, { signal: controller.signal });
    const rejected = assert.rejects(pending, { code: 'CANCELLED' }); await tick();
    const request = h.incoming.at(-1); controller.abort(); await rejected; await tick(); assert.equal(signal.aborted, true);
    gate.resolve({ late: true }); await Promise.all(h.operations);
    assert.equal(h.outgoing.some(row => row.requestId === request.requestId && row.status === 'ok'), false);
    assert.equal(h.host.pending.size, 0);
});
test('input replacement responds at old generation before catalog event publishes new generation', async t => {
    let host;
    const h = await paired(t, async (_action, _payload, ctx) => {
        host.generation++; ctx.afterReply(() => host.event('catalog', { catalog: [] })); return { status: 'registered' };
    }); host = h.host;
    assert.deepEqual(await h.client.request('choose-source'), { status: 'registered' }); await tick();
    const reply = h.outgoing.findIndex(row => row.action === 'choose-source' && row.kind === 'response');
    const event = h.outgoing.findIndex(row => row.action === 'catalog' && row.kind === 'event');
    assert.ok(reply >= 0 && event > reply); assert.equal(h.outgoing[reply].generation, 0); assert.equal(h.outgoing[event].generation, 1);
    assert.equal(h.client.identity().generation, 1);
});
test('concurrent reset drops old welcome/error and dispose prevents later welcome', async () => {
    const first = deferred(), third = deferred(), sent = []; let welcomes = 0;
    const host = new HardwareProtocol({ build: { buildId: 'paired-build' }, send: message => sent.push(message), dispatch: () => null,
        welcome: () => ++welcomes === 1 ? first.promise : welcomes === 2 ? {} : third.promise });
    const old = host.receive(bootstrap()); await tick();
    await host.receive(bootstrap()); const session = host.sessionId;
    first.reject(new Error('Old welcome failed')); await old;
    assert.equal(sent.length, 1); assert.equal(sent[0].sessionId, session); assert.equal(sent[0].action, 'welcome');
    const pending = host.receive(bootstrap()); await tick(); await host.dispose(); third.resolve({ late: true }); await pending;
    assert.equal(sent.length, 1); assert.equal(host.pending.size, 0);
});
test('oversized/prototype/action payloads never reach Host dispatch; path error stays forbidden', async t => {
    let calls = 0;
    const h = await paired(t, () => { calls++; throw Object.assign(new Error('Registered path denied'), { code: 'PATH_DENIED' }); });
    const raw = { ...h.host.identity(), requestId: 'bad-1', snapshotId: null, action: 'catalog', payload: {} };
    await h.host.receive({ ...raw, action: 'executeCommand' }); assert.equal(h.outgoing.at(-1).status, 'forbidden');
    await h.host.receive({ ...raw, payload: { text: 'x'.repeat(65536) } });
    await h.host.receive({ ...raw, payload: JSON.parse('{"__proto__":{"execute":true}}') });
    assert.equal(calls, 0);
    await assert.rejects(h.client.request('source-open'), { code: 'PATH_DENIED' });
    assert.equal(calls, 1); assert.equal(h.outgoing.at(-1).status, 'forbidden');
});
test('dispose aborts pending work and suppresses its response and deferred publication', async t => {
    const gate = deferred(); let signal, published = false;
    const h = await paired(t, async (_action, _payload, ctx) => {
        signal = ctx.signal; ctx.afterReply(() => { published = true; }); return gate.promise;
    });
    const pending = h.client.request('catalog'), rejected = assert.rejects(pending, { code: 'CANCELLED' }); await tick();
    const before = h.outgoing.length, disposing = h.host.dispose(); await tick(); assert.equal(signal.aborted, true);
    h.client.dispose(); await rejected; gate.resolve({ late: true }); await disposing;
    assert.equal(h.outgoing.length, before); assert.equal(published, false); assert.equal(h.host.pending.size, 0);
});
test('Host response byte limit rejects oversized transport results', async t => {
    const h = await paired(t, () => ({ transportTestPayload: 'x'.repeat(8388608) }));
    await assert.rejects(h.client.request('catalog'), { code: 'LIMIT_EXCEEDED' });
    assert.equal(h.outgoing.at(-1).status, 'limited');
    assert.equal(h.outgoing.at(-1).payload, undefined);
});


test('native input failures retain their stale, ambiguous and unresolved meaning', () => {
    const { errorStatus } = require('../src/panel/hardware-protocol');
    for (const [code, status] of Object.entries({ ARTIFACT_HASH_MISMATCH: 'stale', AMBIGUOUS_ROOT: 'ambiguous',
        AMBIGUOUS_SOURCE: 'ambiguous', ENOENT: 'unresolved', ENOTDIR: 'unresolved', CONTRADICTION: 'invalid' })) {
        assert.equal(errorStatus(code), status);
    }
});
