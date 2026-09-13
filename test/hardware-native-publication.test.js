'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHardwareSession } = require('../src/panel/hardware-session');
const { HardwareProtocol } = require('../src/panel/hardware-protocol');
const { PROTOCOL } = require('../src/panel/hardware-build');
const { createNavigation } = require('../media/hardware-navigation');
const { layout, fitViewport } = require('../media/hardware-layout');

async function fixture(t) {
    const directory = path.resolve(__dirname, '../.build/hardware/runs'); await fs.mkdir(directory, { recursive: true });
    const root = path.join(await fs.mkdtemp(path.join(directory, 'g6-native-publication-')), 'g6'); await fs.mkdir(root);
    const source = name => `package ${name}; interface Value; method Bit#(8) get; endinterface
module mk${name}(Value); Reg#(Bit#(8)) state <- mkReg(0);
rule advance; state <= state + 1; endrule method Bit#(8) get = state; endmodule
module mkOther${name}(Empty); endmodule endpackage`;
    const roots = [];
    for (const name of ['Before', 'After', 'Empty']) {
        const folder = path.join(root, name); await fs.mkdir(folder); roots.push(folder);
        if (name !== 'Empty') await fs.writeFile(path.join(folder, `${name}.bsv`), source(name));
    }
    let sourceRoot = roots[0], sequence = 0, revision = 0, session, failedLayoutOwner = null;
    const messages = [], saved = [];
    const protocol = new HardwareProtocol({ build: { buildId: 'publication-test' }, send: message => messages.push(message),
        dispatch: (...args) => session.dispatch(...args), welcome: () => ({ catalog: [] }) });
    session = createHardwareSession({ protocol, chooseInput: async () => ({ sourceRoot }), selectBuild: entries => entries[0].buildId,
        openSource: async () => {}, exportSvg: async () => {}, saveState: async state => saved.push(state) });
    await protocol.receive({ protocol: PROTOCOL, panelId: null, sessionId: null, buildId: 'publication-test', requestId: 'hello',
        generation: 0, snapshotId: null, action: 'hello', payload: { expectedBuildId: 'publication-test', expectedProtocol: PROTOCOL } });
    async function request(action, payload = {}) {
        if (action === 'persist' && payload.revision === undefined) payload = { ...payload, revision: ++revision };
        const requestId = `publication-${++sequence}`;
        await protocol.receive({ ...protocol.identity(), requestId, snapshotId: null, action, payload });
        return messages.find(message => message.requestId === requestId);
    }
    async function result(action, payload) {
        const reply = await request(action, payload);
        if (reply.status !== 'ok') throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
        return reply.payload;
    }
    const nav = createNavigation({ getSize: () => ({ width: 1140, height: 677 }), layoutScene: (scene, size) => {
        if (scene.ownerInstanceId === failedLayoutOwner) throw Object.assign(new Error('Explicit layout-failure regression'), { code: 'ROUTING_BLOCKED' });
        return layout(scene, size);
    }, fitViewport,
        queryScene: intent => result('scene', { buildId: intent.buildId, intent }),
        queryAnalysis: query => result('analysis', { buildId: nav.getState().current.buildId, query }) });
    async function commit() {
        const current = nav.getState().current;
        const view = Object.fromEntries(['buildId', 'snapshotId', 'sourceRevision', 'sceneKind', 'provider', 'rootInstanceId', 'ownerInstanceId',
            'selectedEntityId', 'selectedRelationId', 'viewport', 'activePanel'].map(key => [key, current[key]]));
        return result('persist', { state: { schema: 1, view } });
    }
    async function enter(entry) {
        const entered = await nav.navigate({ buildId: entry.buildId, snapshotId: entry.snapshotId, implementationProvider: 'stock', sceneKind: 'bsv',
            rootInstanceId: entry.rootInstanceId, ownerInstanceId: entry.rootInstanceId, selectedEntityId: null,
            selectedRelationId: null, disclosureState: {}, sourceContext: null, implementationContext: null }, { reason: 'build' });
        if (!nav.getState().error) await commit();
        return entered;
    }
    t.after(async () => { await protocol.dispose(); await session.dispose(); });
    t.diagnostic(`native publication inputs: ${root}`);
    return { root, roots, session, protocol, request, result, nav, enter, commit, saved,
        failLayout: owner => { failedLayoutOwner = owner; },
        choose: folder => { sourceRoot = folder; },
        async register() { assert.equal((await request('choose-source')).status, 'ok'); return session.getCatalog(); } };
}

test('new input authority clears cached visits; same registered roots keep Back and dedup', async t => {
    const f = await fixture(t), entries = await f.register();
    await f.enter(entries[0]); await f.enter(entries[1]);
    const calls = f.session.getDiagnostics().counts.scene;
    assert.equal(f.nav.back(), true); assert.equal(f.nav.getState().current.buildId, entries[0].buildId);
    await f.commit(); assert.equal(f.session.getCurrent().buildId, entries[0].buildId);
    assert.equal(f.session.getDiagnostics().counts.scene, calls, 'Ordinary cached Back remains local');
    await f.enter(entries[0]); assert.equal(f.nav.getState().history.back.length, 0);
    f.choose(f.roots[1]); const replacement = await f.register();
    f.nav.reset?.(); await f.enter(replacement[0]);
    assert.equal(f.nav.back(), false); assert.equal(f.nav.getState().current.buildId, replacement[0].buildId);
    assert.equal((await f.request('scene', { buildId: entries[0].buildId, intent: {} })).status, 'forbidden');
    f.choose(f.roots[2]); assert.equal((await f.register()).length, 0);
    f.nav.reset?.();
    assert.equal(f.nav.getState().current, null); assert.equal(f.nav.getState().scene, null);
    assert.deepEqual(f.nav.getState().history, { back: [], forward: [] });
});

test('a queried scene remains a candidate until the displayed visit is committed', async t => {
    const f = await fixture(t), [entry] = await f.register();
    const response = await f.request('scene', { buildId: entry.buildId, intent: { buildId: entry.buildId,
        snapshotId: entry.snapshotId, queryGeneration: 1, sceneKind: 'bsv', rootInstanceId: entry.rootInstanceId } });
    assert.equal(response.status, 'ok');
    assert.equal(f.session.getCurrent(), null, 'A successful query does not prove that Webview layout committed');
});

test('failed child layout retains the displayed Host owner and selected source context', async t => {
    const f = await fixture(t), folder = path.join(f.root, 'Connected'); await fs.mkdir(folder);
    await fs.copyFile(path.resolve(__dirname, '../experiments/hardware/fixtures/Connected.bsv'), path.join(folder, 'Connected.bsv'));
    f.choose(folder); const [entry] = await f.register(); await f.enter(entry);
    const before = f.session.getCurrent(), displayed = f.nav.getState(), left = displayed.scene.children.find(item => item.label === 'left');
    f.failLayout(left.id);
    assert.equal(await f.enter({ ...entry, rootInstanceId: left.id }), false);
    assert.equal(f.nav.getState().outcome.code, 'ROUTING_BLOCKED');
    assert.deepEqual(f.session.getCurrent(), before);
    assert.equal(f.nav.getState().current.ownerInstanceId, before.ownerInstanceId);
    f.nav.resize(); assert.deepEqual(f.session.getCurrent(), before);
});

test('oversized scene response cannot replace the last delivered Host selection', async t => {
    const f = await fixture(t), [entry] = await f.register(); await f.enter(entry);
    const before = f.session.getCurrent(), query = f.session.getInput().catalog[0];
    const intent = { buildId: entry.buildId, snapshotId: null, queryGeneration: 2, sceneKind: 'bsv', rootInstanceId: entry.rootInstanceId,
        selectedEntityId: f.nav.getState().scene.storages[0].id };
    // Fault injection surrounds a real canonical result; no replacement scene or resolver.
    f.session.getInput().catalog[0] = { ...query, getScene: value => ({ ...query.getScene(value), transportLimitProbe: 'x'.repeat(8388608) }) };
    const rejected = await f.request('scene', { buildId: entry.buildId, intent });
    assert.equal(rejected.status, 'limited'); assert.equal(rejected.error.code, 'LIMIT_EXCEEDED');
    assert.deepEqual(f.session.getCurrent(), before);
});

test('oversized analysis is not authorized as a successfully delivered saved query', async t => {
    const f = await fixture(t), [entry] = await f.register(); await f.enter(entry);
    const before = f.session.getCurrent(), scene = f.nav.getState().scene, query = f.session.getInput().catalog[0], saves = f.saved.length;
    const context = query.getAnalysisContext('stock');
    const request = { kind: 'state-accesses', analysisId: context.analysisId, snapshotId: null, implementationProvider: 'stock',
        ownerInstanceId: scene.ownerInstanceId, implementationOccurrenceId: null,
        seed: { entityId: scene.storages[0].id, sourceRevision: scene.sourceRevision }, scope: { kind: 'source-only', rootOccurrenceId: null } };
    f.session.getInput().catalog[0] = { ...query, analyze: async (...args) => ({ ...await query.analyze(...args), transportLimitProbe: 'x'.repeat(8388608) }) };
    assert.equal((await f.request('analysis', { buildId: entry.buildId, query: { ...request, queryGeneration: 3 } })).status, 'limited');
    const view = Object.fromEntries(['buildId', 'snapshotId', 'sourceRevision', 'sceneKind', 'provider', 'rootInstanceId', 'ownerInstanceId',
        'selectedEntityId', 'selectedRelationId', 'activePanel'].map(key => [key, before[key]]));
    const persisted = await f.request('persist', { state: { schema: 1, view: { ...view, query: request } } });
    assert.equal(persisted.status, 'forbidden'); assert.equal(f.saved.length, saves); assert.deepEqual(f.session.getCurrent(), before);
});
