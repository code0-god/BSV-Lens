'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { EventEmitter, once } = require('node:events');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
const { loadOriginCase } = require('../experiments/hardware/g3/origin-query');
const { createSceneQuery } = require('../src/hardware/scene-query');
const { createNavigation, visitKey } = require('../media/hardware-navigation');
const { layout, fitViewport } = require('../media/hardware-layout');

const bounded = { timeout: 60000 };
const frame = ({ current, scene, geometry }) => ({ current, scene, geometry });
const saved = state => ({ ...frame(state), history: state.history });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const event = (emitter, name) => once(emitter, name, { signal: AbortSignal.timeout(10000) });
let fixture;
async function captured() {
    fixture ||= (async () => {
        const [stock, originCase] = await Promise.all([loadCapturedCase('A'), loadOriginCase('A')]);
        const sourceBindings = stock.request.sources.map(source => ({ sourcePathRef: source.pathRef, sourceRevision: source.revision,
            originPathRef: originCase.request.files.find(f => f.kind === 'source' && f.contentHash === source.contentHash).pathRef,
            originRevision: source.revision }));
        return { stock, originCase, query: createSceneQuery({ buildId: 'A', label: 'A',
            importResult: stock.request.importResult, analysis: stock.analysis, originCase, sourceBindings }) };
    })();
    return fixture;
}

// Only the analysis transport/envelope is controlled. Scene Query, canonical
// occurrence/port/bit IDs, source records and nondegenerate routed geometry are real G4.
// This is not a synthetic connectivity or source-analysis oracle.
function envelope(h, request) {
    const model = request.implementationProvider === 'instrumented'
        ? h.originCase.request.importResult.implementation : h.stock.request.importResult.implementation;
    const entity = model.entities[request.seed.entityId];
    const bits = entity?.bits || (model.bits[request.seed.entityId] ? [request.seed.entityId] : request.seed.bitIds);
    const indices = request.seed.indices || (request.seed.slice
        ? Array.from({ length: request.seed.slice.end - request.seed.slice.start }, (_, i) => i + request.seed.slice.start)
        : bits.map((_, i) => i));
    const seed = { entityId: entity?.id || null, occurrenceId: request.implementationOccurrenceId,
        positions: indices.map((index, position) => ({ position, index, bitId: bits[index], entityId: entity?.id || null })) };
    const context = { analysisId: h.stock.analysis.id, snapshotId: model.snapshot.id, modelId: model.id,
        implementationProvider: request.implementationProvider, providerIdentity: model.snapshot.providerIdentity,
        stage: model.snapshot.stage ?? null, sourceModelIdentity: h.stock.analysis.sourceModelIdentity,
        freshness: model.snapshot.freshness || 'fresh' };
    const identity = { context, seed, kind: request.kind, scope: request.scope, direction: request.direction ?? null,
        semanticsProfile: request.semanticsProfile ?? null, ownerInstanceId: request.ownerInstanceId, limits: request.limits || {} };
    const queryId = `analysis-query-${digest(identity)}`;
    return { schemaVersion: 1, id: `analysis-result-${digest({ queryId, seed })}`, queryId,
        kind: request.kind, status: 'complete', availability: 'available', completeness: 'complete', context, seed,
        scope: request.scope, direction: request.direction ?? null, semanticsProfile: request.semanticsProfile ?? null,
        objects: [...new Set(seed.positions.map(p => p.bitId))].map(id => ({ id, entityId: id,
            occurrenceId: request.implementationOccurrenceId, snapshotId: request.snapshotId, kind: 'implementation' })),
        relations: [], boundaries: [], frontier: [], sourceRefs: [], evidenceRefs: [], candidates: [], limits: request.limits || {},
        request: { queryGeneration: request.queryGeneration, snapshotId: request.snapshotId }, metrics: { elapsedMs: 1 } };
}
async function harness({ rtl = true, analysis = true } = {}) {
    const f = await captured(), entry = f.query.getCatalogEntry();
    const h = { ...f, calls: [], sceneCalls: [], commits: [], statuses: [], events: new EventEmitter(), corruptGeometry: false,
        queryHook: null, sceneHook: null, size: { width: 1100, height: 650 } };
    h.nav = createNavigation({ getSize: () => h.size, fitViewport,
        layoutScene(scene, size) { const value = layout(scene, size); if (h.corruptGeometry) value.routes[0].segments[0][2] = NaN; return value; },
        queryScene(request, options) { h.sceneCalls.push(request); return h.sceneHook ? h.sceneHook(request, options) : f.query.getScene(request); },
        ...(analysis ? { queryAnalysis(request, options) {
            h.calls.push(request); return h.queryHook ? h.queryHook(request, options) : Promise.resolve(envelope(h, request));
        } } : {}),
        onCommit(state, previous, metadata) { h.commits.push({ state, previous, metadata }); },
        onStatus(state) { h.statuses.push(state); h.events.emit('status', state); }
    });
    assert.equal(await h.nav.navigate({ buildId: entry.buildId, snapshotId: entry.snapshotId,
        rootInstanceId: entry.rootInstanceId, ownerInstanceId: entry.rootInstanceId, sceneKind: 'bsv' }), true);
    if (rtl) assert.equal(await h.nav.navigate({ sceneKind: 'rtl', implementationProvider: 'stock' }), true);
    return h;
}
function input(h, extra = {}) {
    const context = h.nav.getState().current.implementationContext;
    const model = context.provider === 'stock' ? h.stock.request.importResult.implementation : h.originCase.request.importResult.implementation;
    const port = Object.values(model.ports).find(p => p.occurrenceId === context.contextOccurrenceId && p.bits.length >= 3);
    assert.ok(port, 'real ordered vector in selected RTL context');
    return { kind: 'same-net', seed: { entityId: port.id, indices: [0, 2, 1, 2] },
        scope: { kind: 'design', rootOccurrenceId: context.rootOccurrenceId }, ...extra };
}
function queue(h) {
    const requests = new EventEmitter();
    h.queryHook = (request, options) => new Promise((resolve, reject) => {
        requests.emit('request', { request, ...options, reject, respond: changes => resolve({ ...envelope(h, request), ...changes }) });
    });
    return requests;
}
async function start(h, requests, value = input(h)) {
    const requested = event(requests, 'request');
    const promise = h.nav.analyze(value);
    return { promise, ...(await requested)[0] };
}
function child(h, label) {
    const state = h.nav.getState(), id = state.scene.children.find(item => item.label === label).id;
    return { implementationContext: { snapshotId: state.current.snapshotId, contextOccurrenceId: id } };
}

test('G5 transaction records full detached result/request and restores seed/source/detail/viewport without queries', bounded, async () => {
    const h = await harness();
    assert.ok(h.nav.getState().geometry.routes.some(route => route.segments.length > 1));
    const sourceRef = h.nav.getState().scene.sourceContext.sourceRefs[0] || h.stock.analysis.sourceModel.sourceDocuments[0];
    h.nav.patchCurrent({ sourceContext: { ...h.nav.getState().current.sourceContext, callSiteId: h.stock.analysis.sourceModel.expressions[0].id,
        drawer: { reference: sourceRef, open: true } }, disclosureState: { readers: true, pins: true }, activePanel: 'source' });
    h.nav.setViewport({ x: 37, y: -19, scale: 1.4 });
    const before = frame(h.nav.getState()), request = input(h), originalInput = structuredClone(request);
    assert.equal(await h.nav.analyze(request), true);
    const analyzed = frame(h.nav.getState()), stored = analyzed.current.analysis;
    assert.equal(h.commits.at(-1).metadata.reason, 'analyze');
    assert.deepEqual(stored.result, envelope(h, h.calls[0]));
    assert.deepEqual(stored.request, h.calls[0]);
    assert.deepEqual(stored.result.seed.positions.map(p => p.index), [0, 2, 1, 2]);
    assert.deepEqual(analyzed.scene, before.scene, 'analysis is not G2/G3 scene truth');
    assert.deepEqual(analyzed.current.sourceContext, before.current.sourceContext);
    assert.deepEqual(analyzed.current.viewport, before.current.viewport);
    assert.deepEqual(h.nav.getState().history.back.at(-1), before);
    assert.deepEqual(request, originalInput);
    request.seed.indices.reverse(); stored.result.seed.positions[0].bitId = 'foreign'; stored.request.seed.indices[0] = 99;
    const valid = frame(h.nav.getState());
    assert.notEqual(valid.current.analysis.result.seed.positions[0].bitId, 'foreign');
    const queryCount = h.calls.length, sceneCount = h.sceneCalls.length;
    assert.equal(h.nav.back(), true); assert.deepEqual(frame(h.nav.getState()), before);
    assert.equal(h.nav.forward(), true); assert.deepEqual(frame(h.nav.getState()), valid);
    assert.equal(h.calls.length, queryCount); assert.equal(h.sceneCalls.length, sceneCount);
});

test('G5 normalized duplicates ignore execution IDs/metrics; ordered seed, scope, direction and profile distinguish visits', bounded, async () => {
    const h = await harness();
    const first = input(h, { seed: { ...input(h).seed, indices: [0, 1, 2] } });
    await h.nav.analyze(first);
    const before = saved(h.nav.getState()), key = visitKey(before.current), commits = h.commits.length;
    h.queryHook = request => ({ ...envelope(h, request), metrics: { elapsedMs: 999 }, id: `result-execution-${request.queryGeneration}` });
    assert.equal(await h.nav.analyze({ ...first, seed: { entityId: first.seed.entityId, slice: { start: 0, end: 3 } } }), false);
    assert.equal(h.nav.getState().outcome.status, 'unchanged');
    assert.deepEqual(saved(h.nav.getState()), before); assert.equal(h.commits.length, commits);
    assert.equal(visitKey({ ...before.current, queryGeneration: 900, analysis: { ...before.current.analysis,
        request: { ...before.current.analysis.request, queryGeneration: 900 },
        result: { ...before.current.analysis.result, id: 'execution-only', metrics: { elapsedMs: 500 } } } }), key);
    const variants = [input(h), input(h, { scope: { kind: 'occurrence', rootOccurrenceId: h.nav.getState().scene.shell.id } }),
        input(h, { kind: 'dependencies', direction: 'backward', semanticsProfile: 'yosys-0.68-structural-v1' }),
        input(h, { kind: 'dependencies', direction: 'forward', semanticsProfile: 'yosys-0.68-structural-v1' })];
    const keys = new Set([key]);
    for (const request of variants) { assert.equal(await h.nav.analyze(request), true); keys.add(visitKey(h.nav.getState().current)); }
    assert.equal(keys.size, variants.length + 1);
    assert.equal(h.nav.getState().history.back.length, before.history.back.length + variants.length);
});

test('G5 progress/hover reads/viewport/selection do not create analysis visits or erase results/Forward', bounded, async () => {
    const h = await harness(); await h.nav.analyze(input(h));
    await h.nav.analyze(input(h, { kind: 'drivers-loads' })); h.nav.back();
    const stored = h.nav.getState().current.analysis, history = h.nav.getState().history;
    for (let hover = 0; hover < 3; hover++) h.nav.getState(); // Hover is renderer-local, not a navigation intent.
    h.nav.setViewport({ x: 12, y: 34, scale: 0.8 });
    assert.equal(await h.nav.select(h.nav.getState().scene.contacts[0].id), true);
    h.nav.patchCurrent({ disclosureState: { pins: true }, activePanel: 'inspector' });
    assert.deepEqual(h.nav.getState().current.analysis, stored);
    assert.deepEqual(h.nav.getState().history, history);
    assert.equal(Object.hasOwn(h.sceneCalls.at(-1), 'analysis'), false);
    const requests = queue(h), pending = await start(h, requests);
    const status = event(h.events, 'status'); pending.onProgress({ phase: 'ready', visited: 2 }); await status;
    h.nav.setViewport({ x: 55, y: -32, scale: 1.1 });
    assert.equal(pending.signal.aborted, false); assert.deepEqual(h.nav.getState().history, history);
    const abort = event(pending.signal, 'abort');
    assert.equal(await h.nav.select(h.nav.getState().scene.shell.id), true); await abort;
    const valid = h.nav.getState(); pending.respond(); assert.equal(await pending.promise, false);
    pending.onProgress({ phase: 'exited' }); assert.deepEqual(h.nav.getState(), valid);
});

test('G5 latest analysis, hierarchy and Back share one generation; stale A never overwrites B or its diagnostic', bounded, async () => {
    const h = await harness(), requests = queue(h);
    const first = await start(h, requests);
    const aborted = event(first.signal, 'abort');
    const second = await start(h, requests, input(h, { kind: 'drivers-loads' })); await aborted;
    assert.equal(second.request.queryGeneration, first.request.queryGeneration + 1);
    second.respond(); assert.equal(await second.promise, true);
    const analysisB = frame(h.nav.getState());
    assert.equal(await h.nav.navigate(child(h, 'left')), true);
    assert.equal(h.nav.getState().current.analysis, undefined);
    assert.equal(h.nav.back(), true); assert.deepEqual(frame(h.nav.getState()), analysisB);
    const restored = h.nav.getState(); first.respond(); assert.equal(await first.promise, false);
    first.onProgress({ phase: 'exited' }); assert.deepEqual(h.nav.getState(), restored);
});

test('G5 hierarchy/provider/patch invalidation waits for callback settlement and analysis also aborts a pending scene', bounded, async () => {
    for (const intent of ['hierarchy', 'provider', 'patch']) {
        const h = await harness(), requests = queue(h), pending = await start(h, requests);
        const aborted = event(pending.signal, 'abort'); let settled = false;
        pending.promise.then(() => { settled = true; });
        if (intent === 'hierarchy') await h.nav.navigate(child(h, 'left'));
        else if (intent === 'provider') await h.nav.navigate({ implementationProvider: 'instrumented' });
        else h.nav.patchCurrent({ selectedEntityId: h.nav.getState().scene.shell.id });
        await aborted; assert.equal(settled, false, 'abort signal is not worker exit/transport settlement');
        const valid = h.nav.getState(); pending.reject(Object.assign(new Error('worker exited after cancellation'), { code: 'CANCELLED' }));
        assert.equal(await pending.promise, false); assert.deepEqual(h.nav.getState(), valid);
    }
    const h = await harness(), requests = new EventEmitter();
    h.sceneHook = (request, { signal }) => new Promise(resolve => requests.emit('request', { signal, resolve: () => resolve(h.query.getScene(request)) }));
    const requested = event(requests, 'request'), navigating = h.nav.navigate(child(h, 'left')), [pending] = await requested;
    const aborted = event(pending.signal, 'abort'); assert.equal(await h.nav.analyze(input(h)), true); await aborted;
    const valid = h.nav.getState(); pending.resolve(); assert.equal(await navigating, false); assert.deepEqual(h.nav.getState(), valid);
});

test('G5 cancellation, failure and geometry rejection retain the complete last valid frame and history', bounded, async () => {
    const h = await harness(); await h.nav.analyze(input(h));
    const before = saved(h.nav.getState());
    for (const [code, status] of [['CANCELLED', 'cancelled'], ['UNAVAILABLE', 'unresolved']]) {
        h.queryHook = () => { throw Object.assign(new Error(code), { code }); };
        assert.equal(await h.nav.analyze(input(h, { kind: 'drivers-loads' })), false);
        assert.equal(h.nav.getState().outcome.status, status); assert.equal(h.nav.getState().outcome.code, code);
        assert.equal(h.nav.getState().pending, false); assert.deepEqual(saved(h.nav.getState()), before);
    }
    h.queryHook = null; h.corruptGeometry = true;
    assert.equal(await h.nav.analyze(input(h, { kind: 'drivers-loads' })), false);
    assert.equal(h.nav.getState().outcome.status, 'error'); assert.match(h.nav.getState().error.message, /geometry/i);
    assert.deepEqual(saved(h.nav.getState()), before);
    const empty = await harness({ rtl: false }), requests = queue(empty), pending = await start(empty, requests);
    const aborted = event(pending.signal, 'abort'); assert.equal(empty.nav.back(), false); await aborted;
    assert.equal(empty.nav.getState().outcome.status, 'cancelled');
    pending.respond(); assert.equal(await pending.promise, false);
});

test('G5 input context assertions reject before query; optional callback absence is diagnosed', bounded, async () => {
    const h = await harness(); await h.nav.analyze(input(h)); const before = saved(h.nav.getState()), count = h.calls.length;
    for (const changes of [{ snapshotId: 'foreign' }, { analysisId: 'foreign' }, { implementationProvider: 'instrumented' },
        { implementationOccurrenceId: h.nav.getState().scene.children.find(c => c.label === 'left').id },
        { ownerInstanceId: 'foreign' }, { stage: 'invented' }, { queryGeneration: -1 }, { analysis: {} }]) {
        assert.equal(await h.nav.analyze(input(h, changes)), false);
        assert.deepEqual(saved(h.nav.getState()), before); assert.equal(h.calls.length, count);
        assert.equal(h.nav.getState().pending, false); assert.ok(h.nav.getState().error);
    }
    const unavailable = await harness({ analysis: false });
    assert.equal(await unavailable.nav.analyze(input(unavailable)), false);
    assert.equal(unavailable.nav.getState().outcome.code, 'ANALYSIS_UNAVAILABLE');
});

test('G5 result echoes/context/status/completeness reject atomically for stock and instrumented views', bounded, async () => {
    const h = await harness();
    for (const provider of ['stock', 'instrumented']) {
        if (provider === 'instrumented') await h.nav.navigate({ implementationProvider: provider });
        h.queryHook = null; await h.nav.analyze(input(h)); const before = saved(h.nav.getState());
        const mutations = [r => { r.request.queryGeneration--; }, r => { r.request.snapshotId = 'foreign'; },
            r => { delete r.request; }, r => { r.context.snapshotId = 'foreign'; }, r => { r.context.analysisId = 'foreign'; },
            r => { r.context.implementationProvider = provider === 'stock' ? 'instrumented' : 'stock'; },
            r => { r.context.stage = 'invented'; }, r => { r.context.modelId = 'foreign'; },
            r => { r.context.sourceModelIdentity = 'foreign'; }, r => { r.seed.occurrenceId = 'foreign'; },
            r => { r.context.ownerInstanceId = 'foreign'; }, r => { r.context.implementationOccurrenceId = 'foreign'; },
            r => { r.status = 'stale'; }, r => { r.context.freshness = 'stale'; }, r => { r.status = 'cancelled'; },
            r => { r.completeness = 'partial'; }, r => { r.availability = 'unavailable'; }, r => { r.kind = 'drivers-loads'; },
            r => { r.queryId = ''; }, r => { r.id = ''; }, r => { r.schemaVersion = 2; }, r => { r.objects = null; }];
        for (const mutate of mutations) {
            h.queryHook = request => { const result = envelope(h, request); mutate(result); return result; };
            assert.equal(await h.nav.analyze(input(h)), false);
            assert.deepEqual(saved(h.nav.getState()), before); assert.ok(h.nav.getState().error);
            assert.equal(h.nav.getState().pending, false);
        }
    }
});

test('G5 accepted partial/empty/unsupported/ambiguous outcomes retain opaque facts without increasing truth', bounded, async () => {
    const h = await harness(), before = structuredClone(h.nav.getState().scene.correspondence);
    for (const [status, completeness, availability] of [['partial', 'partial', 'available'], ['empty', 'complete', 'available'],
        ['unsupported', 'unknown', 'not-implemented'], ['ambiguous', 'unknown', 'available']]) {
        h.queryHook = request => ({ ...envelope(h, request), status, completeness, availability });
        assert.equal(await h.nav.analyze(input(h, { kind: status === 'partial' ? 'dependencies' : 'same-net' })), true);
        assert.equal(h.nav.getState().current.analysis.result.status, status);
        assert.deepEqual(h.nav.getState().scene.correspondence, before);
        h.nav.back();
    }
});

test('G5 explicit RTL entry preserves source analysis frame; root/left/right visit identity and actual Up survive', bounded, async () => {
    const h = await harness({ rtl: false });
    h.nav.patchCurrent({ activePanel: 'source', disclosureState: { readers: true }, sourceContext: {
        ...h.nav.getState().current.sourceContext, callSiteId: h.stock.analysis.sourceModel.expressions[0].id } });
    h.nav.setViewport({ x: 29, y: -18, scale: 1.3 }); await h.nav.analyze(input(h));
    const source = frame(h.nav.getState());
    assert.equal(await h.nav.navigate({ sceneKind: 'rtl' }), true);
    assert.equal(h.nav.getState().current.analysis, undefined);
    h.nav.back(); assert.deepEqual(frame(h.nav.getState()), source); h.nav.forward();
    const root = frame(h.nav.getState()); await h.nav.analyze(input(h));
    assert.equal(await h.nav.up(), false); assert.equal(h.nav.getState().outcome.code, 'RTL_ROOT');
    await h.nav.navigate(child(h, 'left')); await h.nav.analyze(input(h));
    const left = frame(h.nav.getState()); assert.equal(await h.nav.up(), true);
    assert.equal(h.nav.getState().scene.shell.id, root.scene.shell.id);
    await h.nav.navigate(child(h, 'right')); await h.nav.analyze(input(h));
    const right = frame(h.nav.getState());
    assert.equal(left.current.ownerInstanceId, right.current.ownerInstanceId);
    assert.notEqual(visitKey(left.current), visitKey(right.current));
    assert.notEqual(left.current.implementationContext.contextOccurrenceId, right.current.implementationContext.contextOccurrenceId);
    assert.equal(left.current.implementationContext.implementationOccurrenceId, root.current.implementationContext.implementationOccurrenceId);
    assert.equal(await h.nav.up(), true); assert.equal(h.nav.getState().scene.shell.id, root.scene.shell.id);
    h.nav.back(); assert.deepEqual(frame(h.nav.getState()), right);
});
