'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
const { loadOriginCase } = require('../experiments/hardware/g3/origin-query');
const { createSceneQuery } = require('../src/hardware/scene-query');
const { createNavigation } = require('../media/hardware-navigation');
const { layout, fitViewport } = require('../media/hardware-layout');

let fixture;
async function harness() {
    fixture ||= Promise.all([loadCapturedCase('A'), loadOriginCase('A')]);
    const [stock, originCase] = await fixture;
    const sourceBindings = stock.request.sources.map(source => ({
        sourcePathRef: source.pathRef, sourceRevision: source.revision,
        originPathRef: originCase.request.files.find(f => f.kind === 'source' && f.contentHash === source.revision).pathRef,
        originRevision: source.revision
    }));
    const query = createSceneQuery({ buildId: 'A', label: 'A',
        importResult: stock.request.importResult, analysis: stock.analysis, originCase, sourceBindings });
    const h = { query, source: stock.analysis.sourceModel, mutate: null };
    h.nav = createNavigation({
        queryScene: input => query.getScene(input),
        queryAnalysis: async (input, options) => {
            const result = structuredClone(await query.analyze(input, options));
            h.mutate?.(result);
            return result;
        },
        resolveAnalysisTarget: input => query.revealAnalysisTarget(input),
        layoutScene: layout, fitViewport, getSize: () => ({ width: 1100, height: 650 })
    });
    const entry = query.getCatalogEntry();
    const owner = h.source.instances.find(i => i.path === 'mkConnected.left');
    assert.equal(await h.nav.navigate({ buildId: entry.buildId, snapshotId: entry.snapshotId,
        ownerInstanceId: owner.id, rootInstanceId: owner.id, sceneKind: 'bsv' }), true);
    h.owner = owner;
    h.input = (kind, entityId, extra = {}) => ({
        kind, seed: { entityId },
        scope: { kind: 'design', rootOccurrenceId: h.nav.getState().current.implementationContext.rootOccurrenceId },
        ...extra
    });
    return h;
}
const frame = ({ current, scene, geometry }) => ({ current, scene, geometry });

test('G5 real source results commit through navigation and preserve complete source/RTL roundtrips', { timeout: 60000 }, async () => {
    const h = await harness(), storage = h.nav.getState().scene.storages[0];
    const request = h.input('state-accesses', storage.id);
    assert.equal(await h.nav.analyze(request), true, JSON.stringify(h.nav.getState().error));
    const result = h.nav.getState().current.analysis.result;
    assert.deepEqual(result.scope, request.scope);
    assert.equal(result.direction, null);
    assert.equal(result.semanticsProfile, null);
    assert.equal(result.code.storage.id, storage.id);
    assert.ok(result.readers.length && result.writers.length);
    h.nav.patchCurrent({ activePanel: 'source', disclosureState: { readers: true },
        sourceContext: { ...h.nav.getState().current.sourceContext, codeDetail: result.sourceRefs[0] } });
    h.nav.setViewport({ x: 27, y: -19, scale: 1.3 });
    const original = frame(h.nav.getState()), historyLength = h.nav.getState().history.back.length;
    assert.equal(await h.nav.analyze(request), false);
    assert.equal(h.nav.getState().outcome.status, 'unchanged');
    assert.equal(h.nav.getState().history.back.length, historyLength);
    assert.deepEqual(frame(h.nav.getState()), original);
    const behavior = h.source.stateBehaviors.find(b => b.ownerInstanceId === h.owner.id && b.name === 'put');
    assert.equal(await h.nav.analyze(h.input('behavior', behavior.id)), true, JSON.stringify(h.nav.getState().error));
    const code = frame(h.nav.getState());
    assert.ok(code.current.analysis.result.sourceRefs.some(r => r.text === 'value + 1'));
    assert.equal(await h.nav.navigate({ sceneKind: 'rtl', implementationProvider: 'instrumented' }), true);
    assert.equal(h.nav.back(), true); assert.deepEqual(frame(h.nav.getState()), code);
    assert.equal(h.nav.back(), true); assert.deepEqual(frame(h.nav.getState()), original);
    assert.equal(h.nav.forward(), true); assert.deepEqual(frame(h.nav.getState()), code);
});

test('G5 verified current source is accepted while stale responses preserve the previous analysis', { timeout: 60000 }, async () => {
    const h = await harness(), behavior = h.source.stateBehaviors.find(b => b.ownerInstanceId === h.owner.id && b.name === 'put');
    const request = h.input('behavior', behavior.id, { mode: 'build' });
    assert.equal(await h.nav.analyze(request), true, JSON.stringify(h.nav.getState().error));
    assert.equal(await h.nav.analyze({ ...request, mode: 'current-source' }), true, JSON.stringify(h.nav.getState().error));
    assert.equal(h.nav.getState().current.analysis.result.code.freshness.status, 'current');
    assert.equal(h.nav.getState().current.analysis.result.code.sourceMode, 'current-source');
    const before = frame(h.nav.getState()), history = h.nav.getState().history;
    h.mutate = result => { result.status = 'stale'; };
    assert.equal(await h.nav.analyze({ ...request, mode: 'current-source' }), false);
    assert.equal(h.nav.getState().outcome.status, 'stale');
    assert.deepEqual(frame(h.nav.getState()), before);
    assert.deepEqual(h.nav.getState().history, history);
});

test('G5 analysis source references open only after public query registration with unchanged bytes and range', { timeout: 60000 }, async () => {
    const h = await harness(), behavior = h.source.stateBehaviors.find(b => b.ownerInstanceId === h.owner.id && b.name === 'put');
    const state = h.nav.getState().current;
    const result = await h.query.analyze({ ...h.input('behavior', behavior.id),
        analysisId: h.query.getAnalysisContext().analysisId, snapshotId: state.snapshotId,
        implementationProvider: 'stock', ownerInstanceId: h.owner.id,
        implementationOccurrenceId: state.implementationContext.contextOccurrenceId, queryGeneration: 1 });
    for (const ref of result.sourceRefs) {
        const opened = h.query.getSource(ref);
        assert.equal(opened.text, ref.text);
        assert.equal(opened.readOnly, true);
        assert.throws(() => h.query.getSource({ ...ref, range: { ...ref.range, end: ref.range.end + 1 } }), { code: 'INVALID_RANGE' });
        assert.throws(() => h.query.getSource({ ...ref, revision: '0'.repeat(64) }), { code: 'SOURCE_REVISION_MISMATCH' });
    }
    assert.throws(() => h.query.getSource({ ...result.sourceRefs[0], id: 'unregistered-source' }), { code: 'INVALID_RANGE' });
});

test('G5 source revision and source mode response echoes cannot overwrite a valid analysis', { timeout: 60000 }, async () => {
    const h = await harness(), behavior = h.source.stateBehaviors.find(b => b.ownerInstanceId === h.owner.id && b.name === 'put');
    const request = h.input('behavior', behavior.id, { mode: 'build',
        seed: { entityId: behavior.id, sourceRevision: h.source.sourceDocuments[0].revision } });
    assert.equal(await h.nav.analyze(request), true, JSON.stringify(h.nav.getState().error));
    const before = frame(h.nav.getState());
    for (const mutate of [r => { r.seed.sourceRevision = '0'.repeat(64); },
        r => { r.code.sourceMode = 'current-source'; }]) {
        h.mutate = mutate;
        assert.equal(await h.nav.analyze(request), false);
        assert.equal(h.nav.getState().outcome.code, 'INVALID_ANALYSIS_RESULT');
        assert.deepEqual(frame(h.nav.getState()), before);
    }
});
