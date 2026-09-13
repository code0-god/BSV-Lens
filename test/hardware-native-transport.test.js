'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTransport } = require('../media/hardware-native');

function harness() {
    const sent = [], states = [];
    let receive, detached = false;
    const transport = createTransport({ expectedBuildId: 'build-a', postMessage: message => sent.push(message),
        listen: handler => { receive = handler; return () => { detached = true; }; }, setState: value => states.push(value) });
    const identity = { protocol: 1, panelId: 'panel-a', sessionId: 'session-a', buildId: 'build-a', generation: 0 };
    const welcome = overrides => receive({ ...identity, kind: 'event', action: 'welcome', payload: { catalog: [] }, ...overrides });
    const reply = (message, overrides = {}) => receive({ ...message, kind: 'response', status: 'ok', payload: { result: true }, ...overrides });
    return { transport, sent, states, identity, welcome, reply, receive: message => receive(message), detached: () => detached };
}

test('native requests wait for validated installed build and retain registered snapshot identity', async () => {
    const h = harness(), result = h.transport.request('scene', { buildId: 'registered-build', intent: { sceneKind: 'bsv' } });
    assert.equal(h.sent.length, 1); assert.equal(h.sent[0].action, 'hello');
    h.transport.setSnapshot('snapshot-a'); h.welcome(); await h.transport.ready;
    const request = h.sent[1];
    assert.equal(request.snapshotId, 'snapshot-a'); assert.equal(request.buildId, 'build-a');
    assert.equal(request.payload.buildId, 'registered-build');
    let settled = false; result.then(() => { settled = true; });
    for (const invalid of [{ panelId: 'foreign' }, { sessionId: 'foreign' }, { buildId: 'foreign' },
        { protocol: 2 }, { generation: 1 }, { snapshotId: 'foreign' }, { action: 'source' }]) h.reply(request, invalid);
    await Promise.resolve(); assert.equal(settled, false);
    h.reply(request); assert.deepEqual(await result, { result: true }); h.transport.dispose();
});

test('build/protocol mismatch prevents native requests and ignores a later replacement welcome', async () => {
    for (const mismatch of [{ buildId: 'old-build' }, { protocol: 2 }, { generation: -1 }]) {
        const h = harness(); const result = h.transport.request('catalog');
        h.welcome(mismatch); await assert.rejects(result, { code: 'BUILD_MISMATCH' });
        h.welcome(); await assert.rejects(h.transport.request('catalog'), { code: 'BUILD_MISMATCH' });
        assert.equal(h.sent.length, 1); h.transport.dispose();
    }
});

test('hello error response rejects bootstrap instead of leaving readiness pending', async () => {
    const h = harness(), result = h.transport.request('catalog');
    h.receive({ ...h.sent[0], kind: 'response', status: 'invalid', error: { code: 'BUILD_MISMATCH', message: 'Loaded assets differ' } });
    await assert.rejects(result, { code: 'BUILD_MISMATCH', message: 'Loaded assets differ' });
    h.welcome(); assert.equal(h.transport.identity(), null); h.transport.dispose();
});

test('limited error rejects while a real limited result retains its payload', async () => {
    const h = harness(); h.welcome();
    const oversized = h.transport.request('source', {}); await Promise.resolve();
    h.reply(h.sent.at(-1), { status: 'limited', payload: undefined, error: { code: 'LIMIT_EXCEEDED', message: 'Source result too large' } });
    await assert.rejects(oversized, { code: 'LIMIT_EXCEEDED' });
    const bounded = h.transport.request('analysis', {}); await Promise.resolve();
    h.reply(h.sent.at(-1), { status: 'limited', payload: { status: 'limited', frontier: ['budget'] } });
    assert.deepEqual(await bounded, { status: 'limited', frontier: ['budget'] }); h.transport.dispose();
});

test('cancel settles immediately and rejects a late response without publishing', async () => {
    const h = harness(); h.welcome();
    const controller = new AbortController(), result = h.transport.request('analysis', { query: {} }, { signal: controller.signal });
    await h.transport.ready; const request = h.sent[1]; controller.abort();
    await assert.rejects(result, { code: 'CANCELLED' });
    assert.equal(h.sent[2].action, 'cancel'); assert.equal(h.sent[2].payload.targetRequestId, request.requestId);
    h.reply(request); h.transport.dispose();
});

test('only matching catalog generation invalidates old requests; status cannot change authority', async () => {
    const h = harness(); h.welcome(); const events = [];
    h.transport.subscribe((action, payload) => events.push({ action, payload }));
    const result = h.transport.request('source', { reference: { id: 'source-a' } }); await h.transport.ready;
    h.receive({ ...h.identity, kind: 'event', action: 'status', generation: 1, payload: {} });
    assert.equal(h.transport.identity().generation, 0);
    h.receive({ ...h.identity, kind: 'event', action: 'catalog', generation: 1, payload: { catalog: [] } });
    await assert.rejects(result, { code: 'STALE_RESPONSE' }); assert.equal(events.length, 1);
    const next = h.transport.request('catalog'); await Promise.resolve();
    assert.equal(h.sent.at(-1).generation, 1); h.reply(h.sent.at(-1)); await next; h.transport.dispose();
});

test('native actions and byte budgets reject hostile commands and bound SVG export separately', async () => {
    const h = harness(); h.welcome();
    await assert.rejects(h.transport.request('executeCommand', {}), { code: 'FORBIDDEN' });
    await assert.rejects(h.transport.request('scene', { text: 'x'.repeat(65536) }), { code: 'LIMIT_EXCEEDED' });
    await assert.rejects(h.transport.request('export-svg', { svg: 'x'.repeat(1048576) }), { code: 'LIMIT_EXCEEDED' });
    const exportRequest = h.transport.request('export-svg', { svg: '<svg>' + 'x'.repeat(70000) + '</svg>' });
    await Promise.resolve(); h.reply(h.sent.at(-1)); await exportRequest;
    h.transport.saveState({ schema: 1, view: null }); assert.deepEqual(h.states, [{ schema: 1, view: null }]);
    assert.throws(() => h.transport.saveState({ state: 'x'.repeat(16384) }), { code: 'STATE_LIMIT' });
    h.transport.dispose();
});

test('workspace discovery and design intents use the authenticated native transport', async () => {
    const h = harness(); h.welcome();
    for (const action of ['discover-workspace', 'choose-design', 'copy-diagnostics', 'open-settings']) {
        const payload = action === 'choose-design' ? { entryId: 'registered-entry' } : {};
        const result = h.transport.request(action, payload); result.catch(() => {});
        await Promise.resolve();
        const request = h.sent.at(-1);
        assert.equal(request.action, action);
        assert.equal(request.sessionId, h.identity.sessionId);
        assert.deepEqual(request.payload, payload);
        h.reply(request); await result;
    }
    await assert.rejects(h.transport.request('run-workspace-task'), { code: 'FORBIDDEN' });
    h.transport.dispose();
});

test('host error retains its status and dispose removes listeners and pending work', async () => {
    const h = harness(); h.welcome();
    const error = h.transport.request('source-open', {}); await Promise.resolve();
    h.reply(h.sent.at(-1), { status: 'stale', error: { message: 'Editor buffer changed', code: 'SOURCE_STALE' } });
    await assert.rejects(error, { message: 'Editor buffer changed', code: 'SOURCE_STALE' });
    const disposed = h.transport.request('analysis', {}); await Promise.resolve(); h.transport.dispose();
    await assert.rejects(disposed, { code: 'CANCELLED' }); assert.equal(h.detached(), true);
    await assert.rejects(h.transport.request('catalog'), { code: 'CANCELLED' });
});

test('native HTML uses packaged assets, nonce CSP and explicit input states', () => {
    const html = fs.readFileSync(path.join(__dirname, '../media/hardware-native.html'), 'utf8');
    assert.match(html, /Content-Security-Policy/);
    assert.equal((html.match(/<script nonce="\{\{nonce\}\}"/g) || []).length, 8);
    assert.doesNotMatch(html, /localhost|experiments\/|\/api\/|unsafe-eval|onClick=/i);
    for (const action of ['choose-source', 'choose-artifact', 'choose-manifest', 'choose-origin', 'refresh-input']) {
        assert.ok(html.includes(`data-native-action="${action}"`));
    }
    assert.ok(html.indexOf('{{hardware-native.js}}') < html.indexOf('{{hardware-view.js}}'));
});

test('first source-only action uses explicit source-only query scope without a prior result', () => {
    const { sourceInput } = require('../media/hardware-analysis');
    const result = sourceInput({ snapshotId: null, ownerInstanceId: 'owner', implementationContext: {
        contextOccurrenceId: null, rootOccurrenceId: null } }, { kind: 'state-accesses', entityId: 'state' });
    assert.deepEqual(result.scope, { kind: 'source-only', rootOccurrenceId: null });
    assert.equal(result.implementationOccurrenceId, null);
    assert.equal(result.ownerInstanceId, 'owner');
    const attached = sourceInput({ snapshotId: 'snapshot', ownerInstanceId: 'owner', implementationContext: {
        contextOccurrenceId: 'actual', rootOccurrenceId: 'root' } }, { kind: 'state-accesses', entityId: 'state' });
    assert.deepEqual(attached.scope, { kind: 'design', rootOccurrenceId: 'root' });
    assert.equal(attached.implementationOccurrenceId, 'actual');
});

test('native source-only and artifact-only product queries survive navigation and analysis reveal', async () => {
    const { loadNativeInput } = require('../src/hardware/native-input');
    const { createNavigation } = require('../media/hardware-navigation');
    const { sourceInput } = require('../media/hardware-analysis');
    const layout = require('../media/hardware-layout');
    const runs = path.resolve(__dirname, '../.build/hardware/runs'); fs.mkdirSync(runs, { recursive: true });
    const directory = path.join(fs.mkdtempSync(path.join(runs, 'g6-native-navigation-')), 'g6'); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'Connected.bsv'), fs.readFileSync(path.resolve(__dirname, '../experiments/hardware/fixtures/Connected.bsv')));
    const source = await loadNativeInput({ sourceRoot: directory });
    function navigation(query) {
        return createNavigation({ getSize: () => ({ width: 1100, height: 700 }), layoutScene: layout.layout,
            fitViewport: layout.fitViewport, queryScene: intent => query.getScene(intent),
            queryAnalysis: request => query.analyze(request), resolveAnalysisTarget: request => query.revealAnalysisTarget(request) });
    }
    const query = source.catalog[0], entry = query.getCatalogEntry(), n = navigation(query);
    assert.equal(await n.navigate({ buildId: entry.buildId, snapshotId: null, sceneKind: 'bsv',
        rootInstanceId: entry.rootInstanceId, implementationProvider: 'stock' }), true, JSON.stringify(n.getState().error));
    const left = n.getState().scene.children.find(child => child.label === 'left');
    assert.equal(await n.navigate({ rootInstanceId: left.id }), true);
    const state = n.getState().scene.storages[0]; assert.equal(await n.select(state.id), true);
    const action = sourceInput(n.getState().scene, { kind: 'state-accesses', entityId: state.id });
    assert.equal(await n.analyze(action), true, JSON.stringify(n.getState().error));
    assert.equal(n.getState().current.analysis.result.writers.length, 1);
    assert.equal(n.back(), true); assert.equal(n.getState().current.snapshotId, null);
    const leaf = { ports: { p: { direction: 'input', bits: [2, 3] } }, cells: {}, netnames: {} };
    fs.writeFileSync(path.join(directory, 'design.json'), JSON.stringify({ modules: { Root: {
        attributes: { top: '1' }, ports: { p: { direction: 'input', bits: [2, 3] } }, netnames: {},
        cells: { child: { type: 'Leaf', connections: { p: [2, 3] }, port_directions: { p: 'input' } } } }, Leaf: leaf } }));
    const artifact = await loadNativeInput({ artifactRoot: directory, artifactPath: 'design.json' });
    const rtl = artifact.catalog[0], rtlEntry = rtl.getCatalogEntry(), r = navigation(rtl);
    assert.equal(await r.navigate({ buildId: rtlEntry.buildId, snapshotId: rtlEntry.snapshotId, sceneKind: 'rtl',
        rootInstanceId: rtlEntry.rootInstanceId, ownerInstanceId: null, implementationProvider: 'stock' }), true, JSON.stringify(r.getState().error));
    assert.equal(r.getState().current.sourceContext, null);
    const child = r.getState().scene.children[0];
    const childPort = artifact.importResult.implementation.occurrences[child.id].ports[0];
    assert.equal(await r.revealAnalysis({ entityId: childPort, occurrenceId: child.id, snapshotId: rtlEntry.snapshotId, provider: 'stock' }),
        true, JSON.stringify(r.getState().error));
    assert.equal(r.getState().current.implementationContext.contextOccurrenceId, child.id);
    assert.equal(r.getState().current.ownerInstanceId, null);
    assert.equal(await r.up(), true); assert.equal(r.getState().scene.shell.id, rtlEntry.rootInstanceId);
});
