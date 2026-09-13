'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createNavigation, visitKey } = require('../media/hardware-navigation');
const { layout, fitViewport } = require('../media/hardware-layout');
const viewRuntime = require('../media/hardware-view');
const { stateValue, intentFor } = require('../src/panel/hardware-state');

async function harness(canvas = { width: 512, height: 479 }, count = 1) {
    const h = { canvas }, viewport = { x: -285.33333333333337, y: -154.90000000000003, scale: 1.288888888888889 };
    h.nav = createNavigation({ getSize: () => h.canvas, layoutScene: layout, fitViewport,
        queryScene: request => ({ requestSnapshotId: request.snapshotId, queryGeneration: request.queryGeneration,
            scene: { id: 'scene', snapshotId: 'snapshot', buildId: 'build', provider: 'stock', sceneKind: 'bsv', sourceRevision: 'revision',
                rootInstanceId: 'root', ownerInstanceId: 'root', occurrencePath: ['root'], breadcrumb: [],
                shell: { id: 'root', label: 'Root', kind: 'module-occurrence' }, children: [], contacts: [], connections: [],
                storages: Array.from({ length: count }, (_, index) => ({ id: `state${index}`, label: `state${index}`, kind: 'storage' })),
                selection: { selectedEntityId: request.selectedEntityId, selectedRelationId: null },
                disclosureState: request.disclosureState || {}, sourceContext: null, implementationContext: null, activePanel: 'inspector' } }) });
    await h.nav.navigate({ buildId: 'build', snapshotId: 'snapshot', sceneKind: 'bsv', implementationProvider: 'stock',
        rootInstanceId: 'root', ownerInstanceId: 'root', selectedEntityId: `state${count - 1}`, viewport });
    assert.equal(h.nav.getState().error, null);
    h.saved = () => {
        const current = h.nav.getState().current, frame = h.nav.getViewportFrame();
        return { ...Object.fromEntries(['buildId', 'snapshotId', 'sourceRevision', 'sceneKind', 'provider', 'rootInstanceId', 'ownerInstanceId',
            'selectedEntityId', 'selectedRelationId', 'viewport', 'activePanel'].map(key => [key, current[key]])),
        viewportSize: frame.viewportSize, viewportAnchor: frame.viewportAnchor };
    };
    return h;
}
test('native viewport metadata is bounded optional version-one state and never enters a scene intent', async () => {
    const h = await harness(), view = h.saved();
    const saved = stateValue({ schema: 1, view });
    assert.deepEqual({ ...saved.view.viewportSize }, { width: 512, height: 479 });
    assert.deepEqual({ ...saved.view.viewportAnchor }, view.viewportAnchor);
    const intent = intentFor(saved.view);
    assert.equal(Object.hasOwn(intent, 'viewportSize'), false); assert.equal(Object.hasOwn(intent, 'viewportAnchor'), false);
    assert.equal(visitKey(view), visitKey({ ...view, viewportSize: { width: 900, height: 700 }, viewportAnchor: { x: 0, y: 0 } }));
    const { viewportSize, viewportAnchor, ...legacy } = view;
    assert.doesNotThrow(() => stateValue({ schema: 1, view: legacy }));
    for (const patch of [
        { viewportSize: { width: 0, height: 479 } }, { viewportSize: { width: 512.5, height: 479 } },
        { viewportSize: { width: 65537, height: 479 } }, { viewportSize: { width: 512, height: -1 } },
        { viewportSize: { width: 512, height: 479, css: 'foreign' } }, { viewportSize: null }, { viewportAnchor: null },
        { viewportAnchor: { x: Infinity, y: 1 } }, { viewportAnchor: { x: 1e9 + 1, y: 0 } },
        { viewportAnchor: { x: 0, y: 0, source: 'foreign' } }, { viewport: null }
    ]) assert.throws(() => stateValue({ schema: 1, view: { ...view, ...patch } }));
});
test('restart restores the saved canvas anchor regardless of a five-pixel startup canvas difference', async () => {
    const before = await harness(), saved = before.saved(), raw = await harness({ width: 512, height: 484 });
    raw.canvas = { width: 512, height: 505 }; raw.nav.resize();
    assert.equal(raw.nav.getState().current.viewport.y, saved.viewport.y + 10.5, 'Unadapted legacy restore reproduces the observed defect');
    for (const initialHeight of [479, 484, 505]) {
        const restarted = await harness({ width: 512, height: initialHeight });
        restarted.nav.setViewport(viewRuntime.restoreNativeViewport(saved, restarted.nav.getViewportFrame()));
        restarted.canvas = { width: 512, height: 505 }; restarted.nav.resize();
        assert.deepEqual(restarted.nav.getState().current.viewport, { ...saved.viewport, y: saved.viewport.y + 13 });
        assert.equal(restarted.nav.getState().history.back.length, 0);
    }
    assert.deepEqual(viewRuntime.restoreNativeViewport(saved, before.nav.getViewportFrame()), saved.viewport);
});
test('restart uses the same selected anchor compensation as normal resize when geometry reflows', async () => {
    const original = await harness({ width: 512, height: 479 }, 3), saved = original.saved();
    original.canvas = { width: 1500, height: 479 }; original.nav.resize();
    const restarted = await harness({ width: 1500, height: 479 }, 3), frame = restarted.nav.getViewportFrame();
    assert.notDeepEqual(frame.viewportAnchor, saved.viewportAnchor);
    assert.deepEqual(viewRuntime.restoreNativeViewport(saved, frame), original.nav.getState().current.viewport);
    const { viewportSize, viewportAnchor, ...legacy } = saved;
    assert.deepEqual(viewRuntime.restoreNativeViewport(legacy, frame), saved.viewport,
        'State without frame metadata preserves raw coordinates rather than inventing an old canvas size');
});
test('persisted viewport frame stays paired with measured geometry while a DOM resize is awaiting delivery', async () => {
    const h = await harness(), original = h.nav.getViewportFrame();
    const source = fs.readFileSync(require.resolve('../media/hardware-view'), 'utf8');
    const start = source.indexOf('    function persistableState()'), end = source.indexOf('\n    async function revealNative', start);
    const capture = vm.runInNewContext(source.slice(start, end) + '\npersistableState', { navigation: h.nav });
    h.canvas = { width: 1500, height: 700 };
    const saved = JSON.parse(JSON.stringify(capture()));
    assert.deepEqual(saved.view.viewportSize, { width: 512, height: 479 });
    assert.deepEqual(saved.view.viewportAnchor, original.viewportAnchor);
    assert.equal(Object.hasOwn(saved.view, 'revision'), false); assert.equal(Object.hasOwn(saved.view, 'intent'), false);
    original.viewportSize.width = 3; original.viewportAnchor.x = -999;
    assert.deepEqual(h.nav.getViewportFrame().viewportSize, { width: 512, height: 479 });
    assert.notEqual(h.nav.getViewportFrame().viewportAnchor.x, -999);
    h.nav.setViewport({ ...h.nav.getState().current.viewport, x: 8 }, { fit: 'manual' });
    const manual = h.nav.getViewportFrame(); assert.equal(manual.revision, 1);
    h.nav.resize(); const resized = h.nav.getViewportFrame();
    assert.equal(resized.revision, manual.revision); assert.deepEqual(resized.intent, manual.intent);
    assert.deepEqual(JSON.parse(JSON.stringify(capture())).view.viewportSize, h.canvas);
});
test('saved canvas metadata changes are presentation publication and do not create navigation visits', async () => {
    const h = await harness(), sent = [], saved = h.saved();
    let delivered;
    const secondDelivery = new Promise(resolve => { delivered = resolve; });
    const publication = viewRuntime.createNativePublication({ navigation: h.nav, generation: () => 1,
        send: async value => { sent.push(value); if (sent.length === 2) delivered(); return { status: 'saved' }; } });
    await publication.publish({ schema: 1, view: saved }, { immediate: true });
    const update = publication.publish({ schema: 1, view: { ...saved, viewportSize: { width: 512, height: 505 }, viewportAnchor: { x: 421, y: 306 } } });
    assert.equal(sent.length, 1, 'Canvas metadata alone must not trigger an immediate semantic publication');
    await update; await secondDelivery; assert.equal(sent.length, 2); assert.equal(h.nav.getState().history.back.length, 0);
});

async function publicRestoreHarness() {
    const { loadNativeInput } = require('../src/hardware/native-input');
    const input = await loadNativeInput({ sourceRoot: path.resolve(__dirname, '../experiments/hardware/fixtures'),
        manifest: { version: 1, sources: [{ path: 'Connected.bsv' }] } });
    const query = input.catalog[0], entry = query.getCatalogEntry(), h = { held: null, hold: null, canvas: { width: 512, height: 479 } };
    function deliver(kind, result, signal) {
        return h.hold !== kind ? result : new Promise(resolve => {
            h.held = { signal, release() { h.hold = null; resolve(result); } }; h.started();
        });
    }
    h.nav = createNavigation({ getSize: () => h.canvas, layoutScene: layout, fitViewport,
        queryScene: (request, { signal }) => deliver('scene', query.getScene(request), signal),
        queryAnalysis: async (request, { signal }) => deliver('analysis', await query.analyze(request, { signal }), signal) });
    await h.nav.navigate({ buildId: entry.buildId, snapshotId: entry.snapshotId, sceneKind: 'bsv', implementationProvider: 'stock', rootInstanceId: entry.rootInstanceId });
    const left = h.nav.getState().scene.children.find(child => child.label === 'left');
    await h.nav.navigate({ ownerInstanceId: left.id });
    const state = h.nav.getState().scene.storages.find(item => item.label === 'state');
    await h.nav.select(state.id);
    const context = query.getAnalysisContext('stock');
    await h.nav.analyze({ kind: 'state-accesses', analysisId: context.analysisId, snapshotId: context.snapshotId,
        implementationProvider: 'stock', seed: { entityId: state.id, sourceRevision: h.nav.getState().current.sourceRevision },
        scope: { kind: 'source-only', rootOccurrenceId: null }, mode: 'build' });
    assert.equal(h.nav.getState().error, null); assert.equal(input.summary.compilerExecuted, false);
    const source = fs.readFileSync(require.resolve('../media/hardware-view'), 'utf8');
    const captureStart = source.indexOf('    function persistableState()'), captureEnd = source.indexOf('\n    async function revealNative', captureStart);
    const restoreStart = source.indexOf('    async function restoreNativeState('), restoreEnd = source.indexOf('\n    if (nativeTransport)', restoreStart);
    h.capture = vm.runInNewContext(source.slice(captureStart, captureEnd) + '\npersistableState', { navigation: h.nav });
    h.restore = vm.runInNewContext(source.slice(restoreStart, restoreEnd) + '\nrestoreNativeState',
        { navigation: h.nav, catalog: [entry], restoreNativeViewport: viewRuntime.restoreNativeViewport });
    h.entry = entry; return h;
}
test('manual pan during either restored scene or source-query delivery survives without cancelling the real query', async () => {
    for (const stage of ['scene', 'analysis']) {
        const h = await publicRestoreHarness();
        h.nav.setViewport(h.nav.getState().current.viewport, { fit: stage === 'scene' ? 'structure' : 'manual', selectionIds: [] });
        const saved = JSON.parse(JSON.stringify(h.capture()));
        if (stage === 'scene') saved.view.query = null;
        h.hold = stage;
        const started = new Promise(resolve => { h.started = resolve; });
        const restore = h.restore(saved, h.entry.buildId); await started;
        const prior = h.nav.getState(), manual = { x: prior.current.viewport.x + 33, y: prior.current.viewport.y + 44, scale: prior.current.viewport.scale * 1.1 };
        h.nav.setViewport(manual, { fit: 'manual', selectionIds: [] });
        assert.equal(h.held.signal.aborted, false); assert.equal(h.nav.getState().queryGeneration, prior.queryGeneration);
        h.held.release(); await restore;
        const after = h.nav.getState(); assert.equal(after.error, null);
        assert.deepEqual(after.current.viewport, manual); assert.equal(after.current.disclosureState.presentation.fit, 'manual');
        assert.equal(after.queryGeneration, prior.queryGeneration);
        assert.equal(after.current.ownerInstanceId, saved.view.ownerInstanceId); assert.equal(after.current.selectedEntityId, saved.view.selectedEntityId);
        if (stage === 'analysis') assert.equal(after.current.analysis.result.kind, 'state-accesses');
    }
});
