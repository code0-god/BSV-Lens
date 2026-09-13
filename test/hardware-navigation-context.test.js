'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createCatalog, createServer } = require('../experiments/hardware/g4/server');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
const { loadOriginCase } = require('../experiments/hardware/g3/origin-query');
const { createNavigation, visitKey } = require('../media/hardware-navigation');
const { layout, fitViewport } = require('../media/hardware-layout');
const catalog = createCatalog();
const size = { width: 1100, height: 650 };
const bounded = { timeout: 60000 };
const frame = ({ current, scene, geometry }) => ({ current, scene, geometry });
const at = (scene, label) => scene.children.find(item => item.label === label);
const entryIntent = entry => ({ buildId: entry.buildId, snapshotId: entry.snapshotId,
    rootInstanceId: entry.rootInstanceId, ownerInstanceId: entry.rootInstanceId, sceneKind: 'bsv' });

async function harness(buildId = 'A') {
    const query = (await catalog).find(item => item.getCatalogEntry().buildId === buildId);
    const entry = query.getCatalogEntry(), calls = [], commits = [], events = new EventEmitter();
    let layouts = 0, queryHook = null, corruptGeometry = false;
    const navigation = createNavigation({ getSize: () => size, fitViewport,
        layoutScene(scene, dimensions) {
            layouts++;
            const result = layout(scene, dimensions);
            if (corruptGeometry) result.bounds.width = NaN;
            return result;
        },
        queryScene(intent, options) {
            calls.push(intent);
            return queryHook ? queryHook(intent, options) : query.getScene(intent);
        },
        onCommit(state, previous, metadata) { commits.push({ state, previous, metadata }); },
        onStatus(state) { events.emit('status', state); }
    });
    assert.equal(await navigation.navigate(entryIntent(entry)), true);
    return { nav: navigation, query, entry, calls, commits, events,
        get layouts() { return layouts; }, set queryHook(value) { queryHook = value; },
        set corruptGeometry(value) { corruptGeometry = value; } };
}
async function rtl(h, provider = 'stock') {
    assert.equal(await h.nav.navigate({ sceneKind: 'rtl', implementationProvider: provider }), true);
    return h.nav.getState();
}
function childIntent(state, id, legacy = false) {
    return { sceneKind: 'rtl', implementationContext: { ...state.current.implementationContext,
        contextOccurrenceId: id, ...(legacy ? { implementationOccurrenceId: id } : {}) },
    selectedEntityId: null, selectedRelationId: null };
}
function direct(h, extra) {
    const state = h.nav.getState(), current = state.current;
    return h.query.getScene({ buildId: current.buildId, snapshotId: current.snapshotId,
        queryGeneration: state.queryGeneration + 1, rootInstanceId: current.rootInstanceId,
        ownerInstanceId: current.ownerInstanceId, implementationProvider: current.provider, ...extra });
}

// The catalog uses genuine immutable G2 imports and G3 analyses of the captured
// A/B/C builds. No synthetic implementation owner or definition is substituted.
test('N01 A direct root-to-left query equals navigation with the SAME BSV owner', bounded, async () => {
    const h = await harness(), before = await rtl(h);
    const left = at(before.scene, 'left'), intent = childIntent(before, left.id, true);
    const expected = direct(h, intent).scene;
    assert.equal(expected.shell.id, left.id);
    assert.equal(await h.nav.navigate(intent), true);
    const after = h.nav.getState(), context = after.current.implementationContext;
    assert.deepEqual(after.scene, structuredClone(expected));
    assert.equal(after.current.ownerInstanceId, before.current.ownerInstanceId);
    assert.equal(after.current.rootInstanceId, before.current.rootInstanceId);
    assert.deepEqual(after.current.sourceContext, before.current.sourceContext);
    assert.equal(context.contextOccurrenceId, left.id);
    assert.equal(context.implementationOccurrenceId, before.current.implementationContext.implementationOccurrenceId);
    assert.notEqual(context.implementationOccurrenceId, left.id, 'request cannot invent BSV provenance');
    assert.deepEqual(context.occurrencePath, ['mkConnected', 'left']);
    assert.equal(context.parentOccurrenceId, before.scene.shell.id);
    assert.equal(context.rootOccurrenceId, before.scene.shell.id);
    assert.equal(after.history.back.length, before.history.back.length + 1);
});

test('N02 resolved repeats avoid history, commits and redundant layout; detail still queries', bounded, async () => {
    const h = await harness(), root = await rtl(h);
    await h.nav.navigate(childIntent(root, at(root.scene, 'left').id));
    h.nav.setViewport({ x: 21, y: 34, scale: 1.2 });
    const before = frame(h.nav.getState()), layouts = h.layouts, commits = h.commits.length;
    const key = visitKey(before.current);
    for (const intent of [{}, { implementationContext: { snapshotId: before.current.snapshotId,
        contextOccurrenceId: before.scene.shell.id } }]) {
        assert.equal(await h.nav.navigate(intent), false);
        assert.equal(h.nav.getState().outcome.status, 'unchanged');
    }
    assert.equal(h.layouts, layouts);
    assert.equal(h.commits.length, commits);
    assert.deepEqual(frame(h.nav.getState()), before);
    assert.equal(visitKey({ ...before.current, sceneId: 'presentation-only', queryGeneration: 999,
        selectedEntityId: 'detail', selectedRelationId: 'detail', disclosureState: { rtlSignals: true },
        viewport: { x: 0, y: 0, scale: 2 }, activePanel: 'source' }), key);
    const calls = h.calls.length, history = h.nav.getState().history.back.length;
    assert.equal(await h.nav.select(before.scene.shell.id), true);
    assert.equal(h.calls.length, calls + 1);
    assert.equal(h.nav.getState().scene.inspector.id, `inspector:${before.scene.shell.id}`);
    assert.equal(h.layouts, layouts);
    assert.equal(h.nav.getState().history.back.length, history);
    assert.equal(visitKey(h.nav.getState().current), key);
    assert.deepEqual(h.nav.getState().current.viewport, before.current.viewport);
    assert.equal(await h.nav.navigate({ disclosureState: { rtlSignals: true } }), true);
    assert.equal(h.nav.getState().history.back.length, history);
});

test('N03 Back/Forward restore exact shell/path/provider/selection/disclosure/viewport without queries', bounded, async () => {
    const h = await harness(), root = await rtl(h);
    h.nav.setViewport({ x: 13, y: -27, scale: 0.9 });
    const rootFrame = frame(h.nav.getState());
    await h.nav.navigate(childIntent(root, at(root.scene, 'left').id));
    await h.nav.select(h.nav.getState().scene.contacts[0].id);
    await h.nav.navigate({ disclosureState: { pins: true }, activePanel: 'implementation' });
    h.nav.setViewport({ x: -31, y: 46, scale: 1.1 });
    const leftFrame = frame(h.nav.getState());
    await h.nav.navigate({ implementationProvider: 'instrumented' });
    const instrumented = frame(h.nav.getState()), calls = h.calls.length, layouts = h.layouts;
    assert.equal(h.nav.back(), true); assert.deepEqual(frame(h.nav.getState()), leftFrame);
    assert.equal(h.nav.back(), true); assert.deepEqual(frame(h.nav.getState()), rootFrame);
    assert.equal(h.nav.forward(), true); assert.deepEqual(frame(h.nav.getState()), leftFrame);
    assert.equal(h.nav.forward(), true); assert.deepEqual(frame(h.nav.getState()), instrumented);
    assert.equal(h.calls.length, calls); assert.equal(h.layouts, layouts);
});

test('N04 repeated BSV definition left/right retain distinct source owners and RTL anchors', bounded, async () => {
    const h = await harness(), source = h.nav.getState().scene;
    const left = at(source, 'left'), right = at(source, 'right');
    assert.equal(left.definitionId, right.definitionId);
    const visits = [];
    for (const item of [left, right]) {
        assert.equal(await h.nav.navigate({ sceneKind: 'bsv', implementationProvider: 'stock',
            rootInstanceId: item.id, ownerInstanceId: item.id }), true);
        visits.push((await rtl(h)).current);
    }
    assert.notEqual(visitKey(visits[0]), visitKey(visits[1]));
    assert.notEqual(visits[0].ownerInstanceId, visits[1].ownerInstanceId);
    assert.notEqual(visits[0].implementationContext.implementationOccurrenceId, visits[1].implementationContext.implementationOccurrenceId);
});

test('N05 same RTL definition left/right differ under one BSV owner; Up/breadcrumb follow G2', bounded, async () => {
    const h = await harness(), root = await rtl(h);
    const model = (await loadCapturedCase('A')).request.importResult.implementation;
    const left = at(root.scene, 'left'), right = at(root.scene, 'right');
    assert.equal(model.occurrences[left.id].definitionId, model.occurrences[right.id].definitionId);
    await h.nav.navigate(childIntent(root, left.id));
    const leftVisit = h.nav.getState().current;
    assert.deepEqual(h.nav.getState().scene.breadcrumb.map(item => item.id), [root.scene.shell.id, left.id]);
    assert.equal(await h.nav.up(), true);
    assert.equal(h.nav.getState().scene.shell.id, model.occurrences[left.id].parentId);
    await h.nav.navigate(childIntent(h.nav.getState(), right.id));
    assert.notEqual(visitKey(h.nav.getState().current), visitKey(leftVisit));
    assert.equal(h.nav.getState().current.ownerInstanceId, leftVisit.ownerInstanceId);
    assert.equal(await h.nav.breadcrumb(root.scene.shell.id), true);
    const before = frame(h.nav.getState()), history = h.nav.getState().history.back.length;
    assert.equal(await h.nav.up(), false);
    assert.equal(h.nav.getState().outcome.status, 'blocked');
    assert.equal(h.nav.getState().outcome.code, 'RTL_ROOT');
    assert.deepEqual(frame(h.nav.getState()), before);
    assert.equal(h.nav.getState().history.back.length, history);
    assert.equal(await h.nav.returnBsv(), true);
    assert.equal(h.nav.getState().current.sceneKind, 'bsv');
});

test('N06 real stock/instrumented snapshots and supplied stages; foreign or contradictory targets fail', bounded, async () => {
    const h = await harness(), source = h.nav.getState().scene;
    const left = at(source, 'left');
    await h.nav.navigate({ rootInstanceId: left.id, ownerInstanceId: left.id });
    const stock = await rtl(h), instrumented = await rtl(h, 'instrumented');
    assert.equal(h.calls.at(-1).implementationContext, null, 'provider switch clears inherited locator');
    for (const [state, model] of [[stock, (await loadCapturedCase('A')).request.importResult.implementation],
        [instrumented, (await loadOriginCase('A')).request.importResult.implementation]]) {
        const context = state.current.implementationContext, occurrence = model.occurrences[state.scene.shell.id];
        assert.equal(context.snapshotId, model.snapshot.id);
        assert.equal(context.stage, model.snapshot.stage);
        assert.equal(context.providerIdentity, model.snapshot.providerIdentity);
        assert.equal(context.modelId, model.id);
        assert.deepEqual(context.occurrencePath, occurrence.path);
        assert.equal(context.parentOccurrenceId, occurrence.parentId);
        assert.equal(state.current.ownerInstanceId, left.id);
    }
    assert.notEqual(stock.current.snapshotId, instrumented.current.snapshotId);
    assert.notEqual(visitKey(stock.current), visitKey(instrumented.current));
    const before = frame(h.nav.getState());
    for (const implementationContext of [stock.current.implementationContext,
        { ...instrumented.current.implementationContext, snapshotId: 'foreign' },
        { ...instrumented.current.implementationContext, provider: 'stock' },
        { ...instrumented.current.implementationContext, stage: 'invented' },
        { ...instrumented.current.implementationContext, contextOccurrenceId: 'foreign' },
        { ...instrumented.current.implementationContext, implementationOccurrenceId: 'foreign' }]) {
        assert.equal(await h.nav.navigate({ implementationContext }), false);
        assert.equal(h.nav.getState().outcome.status, 'unresolved');
        assert.deepEqual(frame(h.nav.getState()), before);
    }
    assert.throws(() => direct(h, { sceneKind: 'rtl', rootInstanceId: instrumented.current.implementationContext.rootOccurrenceId,
        implementationContext: instrumented.current.implementationContext }), { code: 'INVALID_INPUT' });
    assert.equal(await h.nav.navigate({ implementationProvider: 'stock' }), true);
    assert.equal(h.calls.at(-1).implementationContext, null);
    assert.equal(h.nav.getState().scene.shell.id, stock.scene.shell.id);
});

test('N07 C 8/12 inlining retains containing-only anchors and actual parent, not invented RTL children', bounded, async () => {
    for (const [name, width] of [['narrow', 8], ['wide', 12]]) {
        const h = await harness('C'), wrapper = at(h.nav.getState().scene, name);
        await h.nav.navigate({ rootInstanceId: wrapper.id, ownerInstanceId: wrapper.id });
        const implementation = at(h.nav.getState().scene, 'implementation');
        await h.nav.navigate({ rootInstanceId: implementation.id, ownerInstanceId: implementation.id });
        const source = h.nav.getState().scene, storage = source.storages[0];
        assert.equal(source.contacts.find(item => item.label === 'get').result.type, `Bit#(${width})`);
        assert.equal(await h.nav.select(storage.id), true);
        const selectedSource = h.nav.getState().current.sourceContext;
        for (const provider of ['stock', 'instrumented']) {
            const state = await rtl(h, provider), context = state.current.implementationContext;
            assert.equal(context.implementationOccurrenceId, null);
            assert.equal(context.ownership, 'containing-only');
            assert.deepEqual(context.occurrencePath, ['mkReuse', name]);
            assert.equal(state.current.ownerInstanceId, implementation.id);
            assert.deepEqual(state.current.sourceContext, selectedSource);
            assert.equal(state.scene.children.some(item => item.label === 'implementation'), false);
            assert.equal(await h.nav.up(), true);
            assert.deepEqual(h.nav.getState().current.implementationContext.occurrencePath, ['mkReuse']);
            assert.equal(h.nav.getState().current.ownerInstanceId, implementation.id);
            assert.equal(h.nav.getState().current.sceneKind, 'rtl');
            assert.equal(await h.nav.returnBsv(), true);
            assert.equal(h.nav.getState().current.ownerInstanceId, implementation.id);
            assert.equal(h.nav.getState().current.selectedEntityId, storage.id);
        }
        assert.equal(await rtl(h, 'instrumented').then(() => h.nav.returnBsv(wrapper.id)), true);
        assert.equal(h.nav.getState().current.ownerInstanceId, wrapper.id);
    }
});

test('N08 controlled deferred real-query race and cancellation never replace newer state or diagnostic', bounded, async () => {
    const h = await harness(), root = await rtl(h), requests = new EventEmitter();
    h.queryHook = (intent, { signal }) => new Promise((resolve, reject) => {
        requests.emit('request', { intent, signal, resolve: () => resolve(h.query.getScene(intent)), reject });
    });
    const oldRequest = once(requests, 'request', { signal: AbortSignal.timeout(5000) });
    const old = h.nav.navigate(childIntent(root, at(root.scene, 'left').id));
    const [first] = await oldRequest;
    const aborted = once(first.signal, 'abort', { signal: AbortSignal.timeout(5000) });
    const newRequest = once(requests, 'request', { signal: AbortSignal.timeout(5000) });
    const latest = h.nav.navigate(childIntent(root, at(root.scene, 'right').id));
    await aborted;
    const [second] = await newRequest;
    second.resolve(); assert.equal(await latest, true);
    const newer = h.nav.getState();
    first.resolve(); assert.equal(await old, false);
    assert.deepEqual(h.nav.getState(), newer);
    const lateRequest = once(requests, 'request', { signal: AbortSignal.timeout(5000) });
    const late = h.nav.navigate(childIntent(root, at(root.scene, 'left').id));
    const [third] = await lateRequest;
    h.queryHook = null;
    assert.equal(await h.nav.navigate({}), false);
    const unchanged = h.nav.getState();
    assert.equal(unchanged.outcome.status, 'unchanged');
    third.reject(new Error('obsolete provider failure')); assert.equal(await late, false);
    assert.deepEqual(h.nav.getState(), unchanged);
    const empty = await harness();
    empty.queryHook = h.queryHook = (intent, { signal }) => new Promise(resolve => {
        requests.emit('request', { signal, resolve: () => resolve(empty.query.getScene(intent)) });
    });
    const cancelledRequest = once(requests, 'request', { signal: AbortSignal.timeout(5000) });
    const cancelled = empty.nav.navigate({ sceneKind: 'rtl' });
    const [last] = await cancelledRequest;
    assert.equal(empty.nav.back(), false);
    const cancelledState = empty.nav.getState();
    assert.equal(cancelledState.outcome.status, 'cancelled'); assert.equal(last.signal.aborted, true);
    last.resolve(); assert.equal(await cancelled, false);
    assert.deepEqual(empty.nav.getState(), cancelledState);
});

test('N09 failed query differs from unchanged; stale echoes and invalid geometry are atomic diagnostics', bounded, async () => {
    const h = await harness(), root = await rtl(h), before = frame(root);
    assert.equal(await h.nav.navigate({}), false);
    assert.equal(h.nav.getState().outcome.status, 'unchanged');
    h.queryHook = () => { throw new Error('provider unavailable'); };
    assert.equal(await h.nav.navigate({}), false);
    assert.equal(h.nav.getState().outcome.status, 'unresolved');
    assert.deepEqual(frame(h.nav.getState()), before);
    h.queryHook = intent => ({ ...h.query.getScene(intent), queryGeneration: intent.queryGeneration - 1 });
    assert.equal(await h.nav.navigate({}), false);
    assert.equal(h.nav.getState().outcome.status, 'stale');
    assert.deepEqual(frame(h.nav.getState()), before);
    h.queryHook = null;
    const history = h.nav.getState().history, commits = h.commits.length;
    h.corruptGeometry = true;
    assert.equal(await h.nav.navigate(childIntent(root, at(root.scene, 'left').id)), false);
    assert.equal(h.nav.getState().outcome.status, 'error');
    assert.deepEqual(frame(h.nav.getState()), before);
    assert.deepEqual(h.nav.getState().history, history);
    assert.equal(h.commits.length, commits);
    assert.ok(h.nav.getState().outcome.message.length <= 512);
});

test('N10 existing positive smoke and real HTTP scene surface remain valid', bounded, async t => {
    const server = await createServer({ catalog: await catalog });
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1'); await listening;
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const h = await harness(), root = await rtl(h), intent = childIntent(root, at(root.scene, 'left').id);
    const wire = { ...entryIntent(h.entry), ...intent, queryGeneration: 40, implementationProvider: 'stock' };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/scene?build=A&intent=${encodeURIComponent(JSON.stringify(wire))}`,
        { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(h.query.getScene(wire))));
    const smoke = await promisify(execFile)(process.execPath, ['experiments/hardware/g4-fix/positive-smoke.cjs'],
        { cwd: require('node:path').resolve(__dirname, '..'), timeout: 30000 });
    assert.equal(JSON.parse(smoke.stdout).status, 'pass');
});
