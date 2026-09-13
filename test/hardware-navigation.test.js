'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createNavigation, visitKey } = require('../media/hardware-navigation');

// Explicit occurrence fixtures exercise controller policy, not model inference.
const paths = {
    system: ['system'],
    producer: ['system', 'producer'],
    consumer: ['system', 'consumer'],
    worker: ['system', 'producer', 'worker']
};
function sceneFor(intent, changes = {}) {
    const owner = intent.ownerInstanceId || 'system';
    const actual = intent.sceneKind === 'rtl' ? intent.implementationContext?.contextOccurrenceId || `rtl:${owner}` : owner;
    const actualPath = intent.sceneKind === 'rtl' ? paths[actual.slice(4)] : paths[owner];
    const sourceBreadcrumb = paths[owner].map(id => ({ id, label: id }));
    return {
        id: `scene:${owner}:${intent.queryGeneration}`,
        snapshotId: intent.sceneKind === 'rtl' ? 'implementation-snapshot' : 'source-snapshot',
        sourceRevision: 'revision:verified', sceneKind: intent.sceneKind,
        provenance: { buildId: intent.buildId },
        rootInstanceId: owner,
        ownerInstanceId: owner, occurrencePath: paths[owner].join('.'),
        shell: { id: actual }, children: [], storages: [{ id: `${owner}:state` }],
        contacts: [{ id: `${owner}:put` }], connections: [{ id: `${owner}:flow` }],
        header: { label: owner }, sourceBreadcrumb,
        breadcrumb: intent.sceneKind === 'rtl' ? actualPath.map(id => ({ id: `rtl:${id}`, label: id })) : sourceBreadcrumb,
        selection: { selectedEntityId: intent.selectedEntityId, selectedRelationId: intent.selectedRelationId },
        sourceContext: { ownerInstanceId: owner, sourceRefs: [] }, disclosureState: intent.disclosureState,
        implementationContext: { provider: intent.implementationProvider || 'stock',
            snapshotId: intent.sceneKind === 'rtl' ? 'implementation-snapshot' : 'source-snapshot',
            implementationOccurrenceId: `rtl:${owner}`,
            rootOccurrenceId: intent.sceneKind === 'rtl' ? 'rtl:system' : 'system',
            parentOccurrenceId: actualPath.length > 1 ? `rtl:${actualPath.at(-2)}` : null,
            occurrencePath: actualPath, contextOccurrenceId: actual },
        ...changes
    };
}
function layout(scene, size) {
    return {
        bounds: { x: 0, y: 0, width: size.width, height: size.height },
        nodes: [{ id: scene.ownerInstanceId, x: 20, y: 20, width: 100, height: 80 },
            { id: `${scene.ownerInstanceId}:state`, x: size.width / 2, y: 50, width: 40, height: 30 }],
        contacts: [{ id: `${scene.ownerInstanceId}:put`, x: 20, y: 60 }],
        routes: [{ id: `${scene.ownerInstanceId}:flow`, path: 'M20,60H80', segments: [[20, 60, 80, 60]],
            junctions: [], labelX: 50, labelY: 54 }]
    };
}
function fit(geometry, size) {
    const scale = Math.min(size.width / geometry.bounds.width, size.height / geometry.bounds.height);
    return { x: -geometry.bounds.x * scale, y: -geometry.bounds.y * scale, scale };
}
function harness(overrides = {}) {
    let size = { width: 640, height: 480 };
    const calls = [], commits = [], statuses = [];
    const nav = createNavigation({
        queryScene: async intent => ({ requestSnapshotId: intent.snapshotId,
            queryGeneration: intent.queryGeneration, scene: sceneFor(intent) }),
        layoutScene: layout, getSize: () => size, fitViewport: fit,
        onCommit: (state, previous, metadata) => commits.push({ state, previous, metadata }),
        onStatus: state => statuses.push(state),
        ...overrides
    });
    return { nav, calls, commits, statuses, setSize: value => { size = value; } };
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function queued() {
    const requests = [];
    const h = harness({ queryScene(intent, { signal }) {
        const result = deferred();
        requests.push({ intent, signal, ...result,
            respond(changes = {}) { result.resolve({ requestSnapshotId: intent.snapshotId,
                queryGeneration: intent.queryGeneration, scene: sceneFor(intent), ...changes }); } });
        return result.promise;
    } });
    return { ...h, requests };
}
const enter = (nav, owner = 'system', extra = {}) => nav.navigate({
    buildId: 'build:verified', snapshotId: 'source-snapshot', rootInstanceId: owner,
    ownerInstanceId: owner, ...extra
});
const frame = state => ({ current: state.current, scene: state.scene, geometry: state.geometry });
const asyncOptions = { timeout: 2000 };

test('new-history ACK blocks semantic navigation while preserving viewport work and resolves pre/post-commit failures honestly', async () => {
    const { createNativePublication, nativeHistoryPending } = require('../media/hardware-view');
    for (const outcome of ['saved', 'COMMIT_REJECTED', 'COMMITTED_UNSAVED']) {
        let catalog = null, publication, rejectedMetadata;
        const requests = [], errors = [];
        const h = harness({ canStartIntent: () => !nativeHistoryPending(catalog, publication) });
        publication = createNativePublication({ navigation: h.nav, generation: () => 1,
            capture: () => ({ historyBuildIds: catalog?.options.newHistory ? [] : null,
                status: catalog?.options.newHistory ? { newHistory: true, selectedDesignId: 'registered-target' } : {} }),
            send: () => { const request = deferred(); requests.push(request); return request.promise; },
            restore: () => { catalog = null; }, onAccepted: () => { catalog = null; },
            onError: (error, metadata) => { errors.push(error.code); rejectedMetadata = metadata; } });
        for (const owner of ['system', 'producer']) {
            await enter(h.nav, owner);
            const pending = publication.publish({ schema: 1, view: h.nav.getState().current }, { immediate: true });
            requests.at(-1).resolve(); await pending;
        }
        const previous = h.nav.getState();
        catalog = { options: { newHistory: true } }; await enter(h.nav, 'consumer');
        const pending = publication.publish({ schema: 1, view: h.nav.getState().current }, { immediate: true });
        const candidate = h.nav.getState(); assert.equal(nativeHistoryPending(catalog, publication), true);
        assert.equal(h.nav.back(), false); assert.equal(h.nav.forward(), false);
        assert.equal(await enter(h.nav, 'producer'), false); assert.equal(await h.nav.select('consumer:state'), false);
        assert.equal(await h.nav.analyze({ kind: 'state-accesses' }), false); assert.equal(await h.nav.up(), false);
        assert.equal(h.nav.patchCurrent({ selectedEntityId: 'consumer:state' }), false);
        assert.equal(h.nav.getState().queryGeneration, candidate.queryGeneration);
        assert.deepEqual(h.nav.getState().history, candidate.history);
        h.nav.setViewport({ x: 12, y: 24, scale: 1.5 }); h.setSize({ width: 720, height: 480 }); h.nav.resize();
        assert.equal(h.nav.getState().queryGeneration, candidate.queryGeneration);
        if (outcome === 'saved') requests.at(-1).resolve();
        else requests.at(-1).reject(Object.assign(new Error(outcome), { code: outcome }));
        assert.equal(await pending, outcome !== 'COMMIT_REJECTED');
        assert.equal(nativeHistoryPending(catalog, publication), false);
        assert.equal(h.nav.getState().current.ownerInstanceId, outcome === 'COMMIT_REJECTED' ? 'producer' : 'consumer');
        assert.deepEqual(h.nav.getState().history, outcome === 'COMMIT_REJECTED' ? previous.history : { back: [], forward: [] });
        assert.deepEqual(errors, outcome === 'saved' ? [] : [outcome]);
        if (outcome === 'COMMIT_REJECTED') assert.deepEqual(rejectedMetadata.status, { newHistory: true, selectedDesignId: 'registered-target' });
    }
});

test('latest same-input source limitations survive an older pending publication ACK without navigation changes', async () => {
    const { createNativePublication, createNativeStatusOverlay, nativeSourceStatus } = require('../media/hardware-view');
    const overlay = createNativeStatusOverlay(), h = harness(), requests = [];
    const ready = { summary: { inputIdentity: 'input-a' }, discovery: { status: 'ready', analyzedFiles: 1, invalidationRevision: 1 } };
    overlay.observe(ready);
    const translate = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name]);
    let header, footer;
    const repaint = metadata => { const current = overlay.resolve(metadata.status);
        header = nativeSourceStatus(current.discovery, translate); footer = nativeSourceStatus(current.discovery, translate); };
    const publication = createNativePublication({ navigation: h.nav, generation: () => 1,
        capture: () => ({ status: structuredClone(ready) }), onAccepted: repaint,
        send: payload => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; } });
    await enter(h.nav); const before = h.nav.getState();
    const pending = publication.publish({ schema: 1, view: before.current }, { immediate: true });
    overlay.observe({ status: 'unchanged', inputIdentity: 'input-a', discovery: { ...ready.discovery, status: 'partial',
        invalidationRevision: 2, unanalysed: [{ path: 'Huge.bsv', reason: 'file-byte-limit' }] } });
    repaint({ status: ready }); assert.match(header, /Partial source inventory/);
    requests[0].resolve(); await pending;
    assert.match(header, /Partial source inventory/); assert.match(footer, /Partial source inventory/);
    assert.deepEqual(h.nav.getState(), before); assert.equal(requests.length, 1);
    overlay.observe(ready); assert.equal(overlay.resolve(ready).discovery.invalidationRevision, 2, 'Old Host metadata cannot replace the latest revision');
    overlay.observe({ inputIdentity: 'input-b', discovery: { status: 'ready', analyzedFiles: 12, invalidationRevision: 9 } });
    assert.equal(overlay.resolve(ready).discovery.analyzedFiles, 1, 'Another input must not change this view');
    overlay.observe({ inputIdentity: 'input-a', discovery: { status: 'ready', analyzedFiles: 1, invalidationRevision: 3,
        sourceIndexStatus: { status: 'limited', returnedEntries: 10, totalEntries: 14 } } });
    repaint({ status: ready }); assert.match(header, /Only 10 of 14 source designs/); assert.match(footer, /Partial source inventory/);
    overlay.retain(['input-a']); assert.deepEqual(overlay.resolve({ inputIdentity: 'input-b' }), { inputIdentity: 'input-b' });
    overlay.clear(); assert.deepEqual(overlay.resolve(ready), ready);
});

test('stable Host stale and dirty notices survive metadata replay until a validated inventory update', () => {
    const { createNativeStatusOverlay } = require('../media/hardware-view');
    const overlay = createNativeStatusOverlay(), ready = { summary: { inputIdentity: 'input-a' },
        discovery: { status: 'ready', analyzedFiles: 1, dirtyDocuments: [], invalidationRevision: 0 } };
    overlay.observe(ready); overlay.observe({ status: 'dirty-source', message: 'Saved source is still shown.' }, 'input-a');
    assert.equal(overlay.resolve(ready).notice.status, 'dirty-source');
    overlay.observe({ status: 'stale', message: 'Previously captured source.' }, 'input-a');
    assert.equal(overlay.resolve(ready).notice.message, 'Previously captured source.');
    overlay.observe(ready); assert.equal(overlay.resolve(ready).notice.status, 'stale', 'Cached catalog metadata is not a new source read');
    assert.equal(overlay.resolve({ summary: { inputIdentity: 'input-b' } }).notice, undefined);
    overlay.observe({ inputIdentity: 'input-a', discovery: { ...ready.discovery, invalidationRevision: 1 } });
    assert.equal(overlay.resolve(ready).notice, null);
});

test('existing-session welcome metadata resolves later verified input status through the same build identity', () => {
    const { createNativeStatusOverlay } = require('../media/hardware-view');
    const overlay = createNativeStatusOverlay();
    const welcome = { selectedBuildId: 'build-a', discovery: { status: 'ready', analyzedFiles: 1, invalidationRevision: 0 } };
    overlay.observe(welcome);
    const partial = { status: 'partial', analyzedFiles: 1, invalidationRevision: 1, unanalysed: [{ path: 'Huge.bsv' }] };
    overlay.observe({ status: 'unchanged', inputIdentity: 'input-a', discovery: partial }, undefined, 'build-a');
    partial.status = 'ready';
    assert.equal(overlay.resolve(welcome).discovery.status, 'partial');
    overlay.observe({ inputIdentity: 'other-input', selectedBuildId: 'other-build', discovery: { status: 'ready', analyzedFiles: 100 } });
    assert.equal(overlay.resolve(welcome).discovery.analyzedFiles, 1);
});

test('late metadata cannot bind a different current build alias to its input record', () => {
    const { createNativeStatusOverlay } = require('../media/hardware-view');
    const overlay = createNativeStatusOverlay();
    const welcomeB = { selectedBuildId: 'build-b', discovery: { status: 'ready', analyzedFiles: 2, invalidationRevision: 0 } };
    const catalogA = { summary: { inputIdentity: 'input-a' }, catalog: [{ buildId: 'build-a' }],
        discovery: { status: 'ready', analyzedFiles: 10, invalidationRevision: 0 } };
    overlay.observe(welcomeB); overlay.observe(catalogA);
    overlay.observe({ status: 'unchanged', inputIdentity: 'input-a', discovery: { status: 'partial', analyzedFiles: 10, invalidationRevision: 1 } }, undefined, 'build-b');
    assert.equal(overlay.resolve(welcomeB).discovery.analyzedFiles, 2);
    assert.equal(overlay.resolve(welcomeB).discovery.status, 'ready');
    assert.equal(overlay.resolve(catalogA).discovery.status, 'partial');
    overlay.observe({ inputIdentity: 'input-b', discovery: welcomeB.discovery }, undefined, 'build-b');
    overlay.observe({ inputIdentity: 'foreign-input', selectedBuildId: 'build-b', discovery: { status: 'partial', analyzedFiles: 99 } });
    assert.equal(overlay.resolve(welcomeB).inputIdentity, 'input-b');
    assert.equal(overlay.resolve(welcomeB).discovery.analyzedFiles, 2);
});

test('native rejection restores the last acknowledged full history and viewport, including replaced history', async () => {
    const { createNativePublication } = require('../media/hardware-view');
    const h = harness(), requests = [];
    const publication = createNativePublication({ navigation: h.nav, generation: () => 1,
        send: payload => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; } });
    const saved = () => ({ schema: 1, view: h.nav.getState().current });
    await enter(h.nav); await enter(h.nav, 'producer'); await enter(h.nav, 'consumer'); h.nav.back();
    h.nav.setViewport({ x: 30, y: 45, scale: 1.3 });
    const accepted = h.nav.getState(), first = publication.publish(saved(), { immediate: true });
    requests[0].resolve(); await first;
    await enter(h.nav, 'worker', { selectedEntityId: 'worker:state' });
    const candidate = publication.publish(saved(), { immediate: true });
    requests[1].reject(Object.assign(new Error('Saved source changed'), { code: 'STALE_SOURCE' }));
    assert.equal(await candidate, false);
    const restored = h.nav.getState();
    assert.deepEqual(frame(restored), frame(accepted)); assert.deepEqual(restored.history, accepted.history);
    assert.equal(restored.operation.target.ownerInstanceId, 'worker'); assert.equal(restored.outcome.code, 'STALE_SOURCE');
    await h.nav.navigate({ ownerInstanceId: 'consumer' }, { replaceHistory: true, recordHistory: false });
    const refreshed = publication.publish(saved(), { immediate: true });
    requests[2].reject(Object.assign(new Error('Refresh changed again'), { code: 'STALE_SOURCE' })); await refreshed;
    assert.deepEqual(h.nav.getState().history, accepted.history);
});

test('native late failure cannot undo newer navigation; intermediate acknowledged frame remains rollback authority', async () => {
    const { createNativePublication } = require('../media/hardware-view');
    const h = harness(), requests = [];
    const publication = createNativePublication({ navigation: h.nav, generation: () => 1,
        send: payload => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; } });
    const saved = () => ({ schema: 1, view: h.nav.getState().current });
    await enter(h.nav); const a = publication.publish(saved(), { immediate: true }); requests[0].resolve(); await a;
    await enter(h.nav, 'producer'); const b = publication.publish(saved(), { immediate: true });
    const acknowledged = h.nav.getState(); await enter(h.nav, 'consumer');
    const c = publication.publish(saved(), { immediate: true }); requests[1].resolve(); await b;
    requests[2].reject(Object.assign(new Error('Latest candidate stale'), { code: 'STALE_SOURCE' })); await c;
    assert.deepEqual(frame(h.nav.getState()), frame(acknowledged));
    await enter(h.nav, 'worker'); const old = publication.publish(saved(), { immediate: true });
    await enter(h.nav, 'system'); requests[3].reject(Object.assign(new Error('Old result stale'), { code: 'STALE_SOURCE' })); await old;
    assert.equal(h.nav.getState().current.ownerInstanceId, 'system'); assert.equal(h.nav.getState().error, null);
});

test('native empty publication commits null explicitly and rejected empty publication restores previous history', async () => {
    const { createNativePublication } = require('../media/hardware-view');
    const h = harness(), requests = [], states = [];
    const publication = createNativePublication({ navigation: h.nav, generation: () => 1, saveState: value => states.push(value),
        send: payload => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; } });
    await enter(h.nav); await enter(h.nav, 'producer'); const accepted = h.nav.getState();
    const a = publication.publish({ schema: 1, view: accepted.current }, { immediate: true }); requests[0].resolve(); await a;
    h.nav.reset(); const empty = publication.publish({ schema: 1, view: null }, { immediate: true });
    assert.equal(requests[1].payload.state.view, null); assert.ok(requests[1].payload.revision > requests[0].payload.revision);
    requests[1].reject(Object.assign(new Error('Empty inventory changed'), { code: 'STALE_SOURCE' })); await empty;
    assert.deepEqual(frame(h.nav.getState()), frame(accepted)); assert.deepEqual(h.nav.getState().history, accepted.history);
    h.nav.reset(); const retry = publication.publish({ schema: 1, view: null }, { immediate: true }); requests[2].resolve(); await retry;
    assert.equal(h.nav.getState().current, null); assert.deepEqual(states.at(-1), { schema: 1, view: null });
});

test('native refresh keeps old history until ACK and prunes only obsolete builds while a newer intent is pending', async () => {
    const { createNativePublication } = require('../media/hardware-view');
    const h = queued(), requests = [];
    let refresh = false;
    const publication = createNativePublication({ navigation: h.nav, generation: () => 1,
        capture: () => ({ historyBuildIds: refresh ? ['build:new'] : null }),
        send: payload => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; } });
    const saved = () => ({ schema: 1, view: h.nav.getState().current });
    let task = enter(h.nav); h.requests[0].respond(); await task;
    task = enter(h.nav, 'producer'); h.requests[1].respond(); await task;
    const first = publication.publish(saved(), { immediate: true }); requests[0].resolve(); await first;
    const before = h.nav.getState().history;
    refresh = true;
    task = h.nav.navigate({ buildId: 'build:new', ownerInstanceId: 'system' }, { recordHistory: false });
    h.requests[2].respond(); await task;
    const candidate = publication.publish(saved(), { immediate: true });
    assert.deepEqual(h.nav.getState().history, before);
    task = h.nav.navigate({ ownerInstanceId: 'consumer' });
    requests[1].resolve(); await candidate;
    assert.equal(h.nav.getState().pending, true); assert.equal(h.requests[3].signal.aborted, false);
    assert.deepEqual(h.nav.getState().history, { back: [], forward: [] });
    h.requests[3].respond(); await task;
    assert.equal(h.nav.getState().current.ownerInstanceId, 'consumer');
    assert.equal(h.nav.getState().history.back[0].current.buildId, 'build:new');
});

test('native generation changes fence old replies and viewport/disclosure changes coalesce without cancelling source queries', async () => {
    const { createNativePublication } = require('../media/hardware-view');
    const h = harness(), requests = [], accepted = [];
    let generation = 1;
    const publication = createNativePublication({ navigation: h.nav, generation: () => generation,
        onAccepted: value => accepted.push(value), capture: () => ({ generation }),
        send: payload => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; } });
    const saved = () => ({ schema: 1, view: h.nav.getState().current });
    await enter(h.nav); const first = publication.publish(saved(), { immediate: true }); requests[0].resolve(); await first;
    const queryGeneration = h.nav.getState().queryGeneration;
    h.nav.patchCurrent({ disclosureState: { codeOpen: true } }); publication.publish(saved());
    h.nav.setViewport({ x: 14, y: 25, scale: 1.1 }); publication.publish(saved());
    assert.equal(requests.length, 1); assert.equal(h.nav.getState().queryGeneration, queryGeneration);
    publication.cancelScheduled();
    await enter(h.nav, 'producer'); const stale = publication.publish(saved(), { immediate: true });
    generation++; publication.reset({ retain: true });
    await enter(h.nav, 'consumer'); const latest = publication.publish(saved(), { immediate: true });
    requests[1].reject(Object.assign(new Error('Old session'), { code: 'STALE_SOURCE' })); await stale;
    assert.equal(h.nav.getState().current.ownerInstanceId, 'consumer');
    requests[2].resolve(); await latest;
    assert.equal(accepted.at(-1).generation, 2); assert.ok(requests[2].payload.revision > requests[1].payload.revision);
});

test('requested scene is separate from committed state and retry survives viewport/disclosure changes', asyncOptions, async () => {
    let rejectProducer = true;
    const h = harness({ layoutScene(scene, size) {
        if (scene.ownerInstanceId === 'producer' && rejectProducer)
            throw Object.assign(new Error('No orthogonal path: test-summary'), { code: 'ROUTING_BLOCKED' });
        return layout(scene, size);
    } });
    await enter(h.nav);
    const before = frame(h.nav.getState());
    assert.equal(await enter(h.nav, 'producer'), false);
    let failed = h.nav.getState();
    assert.equal(failed.operation.target.ownerInstanceId, 'producer');
    assert.equal(failed.current.ownerInstanceId, 'system');
    assert.deepEqual(frame(failed), before);
    h.nav.setViewport({ x: 10, y: 20, scale: 1 });
    h.nav.patchCurrent({ disclosureState: { capabilities: true } });
    h.setSize({ width: 700, height: 480 }); h.nav.resize();
    failed = h.nav.getState();
    assert.equal(failed.error.message, 'No orthogonal path: test-summary');
    assert.equal(failed.operation.target.ownerInstanceId, 'producer');
    assert.equal(failed.outcome.code, 'ROUTING_BLOCKED');
    assert.equal(failed.history.back.length, 0);
    rejectProducer = false;
    assert.equal(await h.nav.retry(), true);
    assert.equal(h.nav.getState().current.ownerInstanceId, 'producer');
    assert.equal(h.nav.getState().history.back.length, 1);
    assert.equal(h.nav.getState().error, null);
});

test('newer navigation clears obsolete requested target and late failure cannot replace it', asyncOptions, async () => {
    const h = queued();
    const first = enter(h.nav); h.requests[0].respond(); await first;
    const old = enter(h.nav, 'producer');
    assert.equal(h.nav.getState().operation.target.ownerInstanceId, 'producer');
    const latest = enter(h.nav, 'consumer'); h.requests[2].respond(); await latest;
    h.requests[1].reject(new Error('late routing failure')); await old;
    const state = h.nav.getState();
    assert.equal(state.current.ownerInstanceId, 'consumer');
    assert.equal(state.error, null);
    assert.equal(await h.nav.retry(), false);
    assert.equal(state.history.back.length, 1);
});

test('revision replacement clears old history only after candidate geometry commits', asyncOptions, async () => {
    const h = queued();
    let task = enter(h.nav); h.requests[0].respond(); await task;
    task = enter(h.nav, 'producer'); h.requests[1].respond(); await task;
    const before = h.nav.getState();
    task = h.nav.navigate({ ownerInstanceId: 'consumer' }, { recordHistory: false, replaceHistory: true, reason: 'refresh' });
    h.requests[2].reject(new Error('bad new revision')); await task;
    assert.deepEqual(h.nav.getState().history, before.history);
    assert.equal(h.nav.getState().current.ownerInstanceId, 'producer');
    task = h.nav.retry(); h.requests[3].respond(); await task;
    assert.equal(h.nav.getState().current.ownerInstanceId, 'consumer');
    assert.deepEqual(h.nav.getState().history, { back: [], forward: [] });
});

test('exports the same callable API in a browser without CommonJS', () => {
    const context = vm.createContext({ AbortController, structuredClone });
    vm.runInContext(fs.readFileSync(require.resolve('../media/hardware-navigation'), 'utf8'), context);
    assert.equal(typeof context.BsvHardwareNavigation.createNavigation, 'function');
    assert.equal(typeof context.BsvHardwareNavigation.visitKey, 'function');
    const nav = harness().nav;
    for (const method of ['navigate', 'select', 'back', 'forward', 'up', 'breadcrumb', 'patchCurrent', 'setViewport', 'resize', 'getState']) {
        assert.equal(typeof nav[method], 'function', method);
    }
    assert.deepEqual(nav.getState(), { current: null, scene: null, geometry: null,
        history: { back: [], forward: [] }, pending: false, error: null, outcome: null, queryGeneration: 0 });
});

test('first BSV visit publishes exactly once and only after complete validated geometry', asyncOptions, async () => {
    const h = queued();
    const pending = enter(h.nav);
    assert.equal(h.nav.getState().pending, true);
    assert.equal(h.nav.getState().current, null);
    assert.equal(h.commits.length, 0);
    const request = h.requests[0];
    assert.equal(request.intent.sceneKind, 'bsv');
    assert.equal(Object.hasOwn(request.intent, 'provider'), false);
    assert.equal(Object.hasOwn(request.intent, 'selection'), false);
    assert.equal(request.intent.implementationProvider, null);
    assert.equal(request.signal instanceof AbortSignal, true);
    request.respond();
    assert.equal(await pending, true);
    const state = h.nav.getState();
    assert.equal(h.commits.length, 1);
    assert.equal(h.commits[0].previous.current, null);
    assert.equal(h.commits[0].metadata.reason, 'navigate');
    assert.deepEqual(h.commits[0].state, state);
    assert.equal(state.pending, false);
    assert.equal(state.scene.shell.id, state.current.ownerInstanceId);
    assert.deepEqual(state.history, { back: [], forward: [] });
    for (const key of ['buildId', 'provider', 'snapshotId', 'sceneId', 'sceneKind', 'rootInstanceId',
        'ownerInstanceId', 'occurrencePath', 'selectedEntityId', 'selectedRelationId', 'sourceContext',
        'implementationContext', 'viewport', 'disclosureState', 'activePanel', 'queryGeneration']) {
        assert.ok(Object.hasOwn(state.current, key), key);
    }
});

test('Back and Forward restore exact complete BSV/RTL visits and measured scenes without queries', asyncOptions, async () => {
    const h = harness();
    await enter(h.nav);
    await enter(h.nav, 'producer');
    await h.nav.select('producer:state');
    h.nav.patchCurrent({ sourceContext: { snapshotId: 'source-snapshot', revision: 'revision:verified', range: [7, 19], text: 'state <= payload;' },
        disclosureState: { behavior: { readers: true, writers: true }, signals: false }, activePanel: 'source' });
    h.nav.setViewport({ x: 41, y: -12, scale: 1.7 });
    const bsv = frame(h.nav.getState());
    const historyLength = h.nav.getState().history.back.length;
    await h.nav.navigate({ sceneKind: 'rtl', provider: 'instrumented', selectedEntityId: 'actual-cell',
        implementationContext: { path: ['actual-top'], contributors: ['actual-cell'] } });
    assert.equal(h.nav.getState().current.snapshotId, 'implementation-snapshot');
    h.nav.setViewport(fit(h.nav.getState().geometry, { width: 320, height: 240 }));
    await h.nav.select('unmapped-actual-cell');
    h.nav.patchCurrent({ disclosureState: { pins: true }, activePanel: 'implementation' });
    const rtl = frame(h.nav.getState());
    assert.equal(h.nav.getState().history.back.length, historyLength + 1);
    assert.equal(h.nav.back(), true);
    assert.deepEqual(frame(h.nav.getState()), bsv);
    assert.equal(h.nav.forward(), true);
    assert.deepEqual(frame(h.nav.getState()), rtl);
    h.nav.back();
    h.nav.back();
    assert.equal(h.nav.getState().current.ownerInstanceId, 'system');
    h.nav.forward();
    assert.deepEqual(frame(h.nav.getState()), bsv);
});

test('selection, relation, disclosure and viewport patches never add visits and cannot mutate saved visits', asyncOptions, async () => {
    const h = harness();
    await enter(h.nav);
    await h.nav.select('system:state');
    assert.equal(h.nav.getState().current.selectedEntityId, 'system:state');
    await h.nav.select('system:flow', { relation: true });
    assert.equal(h.nav.getState().current.selectedEntityId, null);
    assert.equal(h.nav.getState().current.selectedRelationId, 'system:flow');
    await h.nav.select(null);
    assert.equal(h.nav.getState().current.selectedRelationId, null);
    const changes = { disclosureState: { signals: true } };
    h.nav.patchCurrent(changes);
    changes.disclosureState.signals = false;
    const exposed = h.nav.getState();
    exposed.current.disclosureState.signals = false;
    exposed.geometry.nodes[0].x = NaN;
    exposed.history.back.push({});
    assert.equal(h.nav.getState().current.disclosureState.signals, true);
    assert.equal(h.nav.getState().geometry.nodes[0].x, 20);
    assert.deepEqual(h.nav.getState().history, { back: [], forward: [] });
    assert.equal(h.nav.patchCurrent({ ownerInstanceId: 'foreign' }), false);
    assert.match(h.nav.getState().error.message, /patch|ownerInstanceId/i);
    assert.equal(h.nav.getState().current.ownerInstanceId, 'system');
});

test('same-visit identity ignores generated scene IDs, viewport and generation but includes semantic identity', asyncOptions, async () => {
    const h = harness();
    await enter(h.nav, 'producer');
    await h.nav.select('producer:state');
    await h.nav.navigate({ activePanel: 'source', disclosureState: { writers: true, readers: false } });
    h.nav.setViewport({ x: 8, y: 21, scale: 2 });
    const before = frame(h.nav.getState());
    const key = visitKey(before.current);
    assert.equal(visitKey({ ...before.current, sceneId: 'regenerated', queryGeneration: 900,
        viewport: { x: 0, y: 0, scale: 1 }, disclosureState: { readers: true },
        selectedEntityId: 'other', selectedRelationId: 'other', activePanel: 'other' }), key);
    for (const changes of [{ snapshotId: 'other' }, { sceneKind: 'rtl' }, { rootInstanceId: 'other' },
        { ownerInstanceId: 'other' }, { sourceRevision: 'other' }, { provider: 'other' }, { buildId: 'other' }]) {
        assert.notEqual(visitKey({ ...before.current, ...changes }), key);
    }
    assert.equal(await enter(h.nav, 'producer'), false, 'repeat entry does not create a visit');
    assert.equal(await enter(h.nav, 'producer'), false, 'renderer repeat/double entry remains at the same owner');
    assert.deepEqual(frame(h.nav.getState()), before);
    assert.equal(h.nav.getState().history.back.length, 0);
});

test('Up and breadcrumbs use actual hierarchy rather than the previously visited sibling', asyncOptions, async () => {
    const h = harness();
    await enter(h.nav, 'consumer');
    await enter(h.nav, 'worker');
    assert.equal(await h.nav.up(), true);
    assert.equal(h.nav.getState().current.ownerInstanceId, 'producer');
    h.nav.back();
    assert.equal(h.nav.getState().current.ownerInstanceId, 'worker');
    assert.equal(await h.nav.breadcrumb('system'), true);
    assert.equal(h.nav.getState().current.ownerInstanceId, 'system');
    assert.equal(await h.nav.up(), false);
    assert.equal(await h.nav.breadcrumb('foreign'), false);
});

test('newer navigation aborts its predecessor; late success and failure cannot overwrite a valid scene', asyncOptions, async () => {
    const h = queued();
    const initial = enter(h.nav);
    h.requests[0].respond(); await initial;
    const old = enter(h.nav, 'producer');
    const abort = new Promise(resolve => h.requests[1].signal.addEventListener('abort', resolve, { once: true }));
    const latest = enter(h.nav, 'consumer');
    await abort;
    h.requests[2].respond();
    assert.equal(await latest, true);
    const valid = h.nav.getState();
    h.requests[1].respond();
    assert.equal(await old, false);
    assert.deepEqual(h.nav.getState(), valid);
    const rejected = enter(h.nav, 'producer');
    const replacement = enter(h.nav, 'worker');
    h.requests[4].respond(); await replacement;
    const newer = h.nav.getState();
    h.requests[3].reject(new Error('obsolete provider failure'));
    assert.equal(await rejected, false);
    assert.deepEqual(h.nav.getState(), newer);
});

test('Back invalidates pending queries even with empty history or no committed scene', asyncOptions, async () => {
    const h = queued();
    const initial = enter(h.nav);
    assert.equal(h.nav.back(), false);
    assert.equal(h.requests[0].signal.aborted, true);
    h.requests[0].respond();
    assert.equal(await initial, false);
    assert.equal(h.nav.getState().current, null);
    const committed = enter(h.nav); h.requests[1].respond(); await committed;
    const before = frame(h.nav.getState());
    const pending = enter(h.nav, 'producer');
    assert.equal(h.nav.back(), false);
    assert.equal(h.nav.getState().pending, false);
    assert.equal(h.requests[2].signal.aborted, true);
    h.requests[2].respond();
    assert.equal(await pending, false);
    assert.deepEqual(frame(h.nav.getState()), before);
});

test('Back while a build is pending restores history and rejects the older response', asyncOptions, async () => {
    const h = queued();
    const initial = enter(h.nav); h.requests[0].respond(); await initial;
    h.nav.setViewport({ x: 99, y: -20, scale: 0.7 });
    const initialFrame = frame(h.nav.getState());
    const child = enter(h.nav, 'producer'); h.requests[1].respond(); await child;
    const pending = enter(h.nav, 'worker');
    assert.equal(h.nav.back(), true);
    assert.deepEqual(frame(h.nav.getState()), initialFrame);
    h.requests[2].respond();
    assert.equal(await pending, false);
    assert.deepEqual(frame(h.nav.getState()), initialFrame);
});

test('snapshot and generation echoes are mandatory; failures leave the complete scene and history intact', asyncOptions, async () => {
    const h = queued();
    const initial = enter(h.nav); h.requests[0].respond(); await initial;
    const before = frame(h.nav.getState());
    for (const changes of [{ requestSnapshotId: 'foreign' }, { queryGeneration: -1 }, { queryGeneration: undefined }]) {
        const pending = enter(h.nav, 'producer');
        h.requests.at(-1).respond(changes);
        assert.equal(await pending, false);
        assert.deepEqual(frame(h.nav.getState()), before);
        assert.equal(h.nav.getState().pending, false);
        assert.match(h.nav.getState().error.message, /snapshot|generation/i);
    }
    const failure = enter(h.nav, 'producer'); h.requests.at(-1).reject(new Error('provider unavailable'));
    assert.equal(await failure, false);
    assert.equal(h.nav.getState().error.message, 'provider unavailable');
    assert.deepEqual(frame(h.nav.getState()), before);
    assert.equal(h.nav.getState().history.back.length, 0);
});

test('invalid bounds, nodes, contacts, routes or viewport fail before any atomic commit', asyncOptions, async () => {
    const corruptions = [
        geometry => { geometry.bounds.width = 0; },
        geometry => { geometry.bounds.x = Infinity; },
        geometry => { geometry.nodes[0].height = -1; },
        geometry => { geometry.nodes[0].x = NaN; },
        geometry => { geometry.contacts[0].y = Infinity; },
        geometry => { geometry.routes[0].segments[0][2] = NaN; },
        geometry => { geometry.routes[0].segments = []; },
        geometry => { geometry.routes[0].junctions = [{ x: Infinity, y: 5 }]; },
        geometry => { geometry.routes[0].labelY = NaN; },
        geometry => { geometry.routes[0].path = 'MNaN,4'; },
        geometry => { geometry.nodes[0].x = geometry.bounds.width + 1; }
    ];
    for (const corrupt of corruptions) {
        let invalid = false;
        const h = harness({ layoutScene(scene, size) { const value = layout(scene, size); if (invalid) corrupt(value); return value; } });
        await enter(h.nav);
        const before = frame(h.nav.getState());
        invalid = true;
        assert.equal(await enter(h.nav, 'producer'), false);
        assert.deepEqual(frame(h.nav.getState()), before);
        assert.equal(h.commits.length, 1);
        assert.match(h.nav.getState().error.message, /geometry/i);
        assert.equal(h.nav.resize(), false);
        assert.deepEqual(frame(h.nav.getState()), before);
    }
    const h = harness({ fitViewport: () => ({ x: 0, y: 0, scale: NaN }) });
    assert.equal(await enter(h.nav), false);
    assert.equal(h.commits.length, 0);
});

test('resize during a pending query uses the latest dimensions and preserves the selected anchor', asyncOptions, async () => {
    const h = queued();
    const initial = enter(h.nav); h.requests[0].respond(); await initial;
    const selecting = h.nav.select('system:state');
    h.requests[1].respond(); await selecting;
    h.nav.setViewport({ x: 10, y: -15, scale: 1.5 });
    const before = h.nav.getState();
    const oldNode = before.geometry.nodes[1];
    const oldOffset = before.current.viewport.x + (oldNode.x + oldNode.width / 2) * 1.5 - 640 / 2;
    const pending = enter(h.nav, 'producer');
    h.setSize({ width: 920, height: 700 });
    assert.equal(h.nav.resize(), true);
    const resized = h.nav.getState();
    assert.equal(resized.pending, true);
    assert.equal(resized.current.ownerInstanceId, 'system');
    assert.equal(resized.current.selectedEntityId, 'system:state');
    const node = resized.geometry.nodes[1];
    assert.equal(resized.current.viewport.x + (node.x + node.width / 2) * 1.5 - 920 / 2, oldOffset);
    assert.equal(h.requests[2].signal.aborted, false);
    h.requests[2].respond();
    assert.equal(await pending, true);
    assert.equal(h.nav.getState().geometry.bounds.width, 920);
    assert.equal(h.nav.getState().geometry.bounds.height, 700);
    h.nav.back();
    assert.deepEqual(frame(h.nav.getState()), frame(resized));
});

test('resize preserves a failed query or child layout diagnostic while adapting the last valid scene', asyncOptions, async () => {
    for (const failurePhase of ['query', 'layout']) {
        let rejectChild = true, requests = 0;
        const failure = Object.assign(new Error(`Child ${failurePhase} failed`), { code: 'CHILD_UNAVAILABLE' });
        const h = harness({
            queryScene(intent) {
                requests++;
                if (rejectChild && intent.ownerInstanceId === 'producer' && failurePhase === 'query') throw failure;
                return { requestSnapshotId: intent.snapshotId, queryGeneration: intent.queryGeneration, scene: sceneFor(intent) };
            },
            layoutScene(scene, size) {
                if (rejectChild && scene.ownerInstanceId === 'producer' && failurePhase === 'layout') throw failure;
                return layout(scene, size);
            }
        });
        await enter(h.nav);
        await h.nav.select('system:state');
        h.nav.setViewport({ x: 10, y: -15, scale: 1.5 });
        assert.equal(await enter(h.nav, 'producer'), false);
        const before = h.nav.getState(), requestCount = requests;
        const nodeBefore = before.geometry.nodes[1];
        const anchorOffset = before.current.viewport.x + (nodeBefore.x + nodeBefore.width / 2) * 1.5 - 640 / 2;
        assert.equal(before.outcome.status, failurePhase === 'query' ? 'unresolved' : 'error');
        h.setSize({ width: 920, height: 700 });
        assert.equal(h.nav.resize(), true);
        const resized = h.nav.getState(), nodeAfter = resized.geometry.nodes[1];
        assert.deepEqual(resized.error, before.error);
        assert.deepEqual(resized.outcome, before.outcome);
        assert.equal(resized.current.ownerInstanceId, 'system');
        assert.equal(resized.current.queryGeneration, before.current.queryGeneration);
        assert.equal(resized.queryGeneration, before.queryGeneration);
        assert.deepEqual(resized.scene, before.scene);
        assert.deepEqual(resized.history, before.history);
        assert.equal(resized.geometry.bounds.width, 920);
        assert.equal(resized.geometry.bounds.height, 700);
        assert.equal(resized.current.viewport.x + (nodeAfter.x + nodeAfter.width / 2) * 1.5 - 920 / 2, anchorOffset);
        assert.equal(requests, requestCount);
        assert.equal(h.commits.at(-1).metadata.reason, 'resize');
        assert.deepEqual(h.commits.at(-1).state.error, before.error);
        assert.deepEqual(h.statuses.at(-1).outcome, before.outcome);
        h.nav.resize();
        assert.deepEqual(h.nav.getState().outcome, before.outcome);
        rejectChild = false;
        assert.equal(await enter(h.nav, 'producer'), true);
        const recovered = h.nav.getState();
        assert.equal(recovered.error, null);
        assert.equal(recovered.outcome.status, 'committed');
        assert.equal(recovered.current.ownerInstanceId, 'producer');
        assert.equal(recovered.history.back.length, 1);
    }
});

test('recordHistory false replaces a visit; a distinct branch clears Forward but local edits do not', asyncOptions, async () => {
    const h = harness();
    await enter(h.nav);
    await enter(h.nav, 'producer');
    h.nav.back();
    await h.nav.select('system:state');
    h.nav.setViewport({ x: 1, y: 2, scale: 1 });
    assert.equal(h.nav.getState().history.forward.length, 1);
    await h.nav.navigate({ ownerInstanceId: 'consumer' }, { recordHistory: false, reason: 'replace' });
    assert.equal(h.nav.getState().history.back.length, 0);
    assert.equal(h.nav.getState().history.forward.length, 0);
    assert.equal(h.commits.at(-1).metadata.reason, 'replace');
});
