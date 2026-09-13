'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fitViewport } = require('../media/hardware-layout');
const { nativeCommittedStatus, fitNativeInitialViewport } = require('../media/hardware-view');
const { translate } = require('../media/hardware-strings');

test('first native overview fits the committed canvas and remeasured geometry without changing its visit', () => {
    // Presentation dimensions reproduce the observed pending-header/committed-header transition.
    const before = { bounds: { x: 0, y: 0, width: 2136, height: 936 } };
    const after = { bounds: { x: 0, y: 0, width: 1608, height: 1500 } };
    const current = { buildId: 'implementation', selectedEntityId: null, selectedRelationId: null,
        analysis: null, disclosureState: {}, viewport: fitViewport(before, { width: 264, height: 87 }) };
    const state = { current, geometry: before, pending: false, error: null, queryGeneration: 4, history: { back: ['source'] } };
    let resizes = 0;
    const navigation = { getState: () => state, resize(notify) { assert.equal(notify, false); resizes++; state.geometry = after; return true; },
        setViewport(viewport, presentation) { current.viewport = viewport; current.disclosureState.presentation = presentation; } };
    assert.equal(fitNativeInitialViewport(navigation, { buildId: current.buildId, queryGeneration: 4 }, () => ({ width: 264, height: 188 }), fitViewport), true);
    assert.equal(resizes, 1);
    assert.deepEqual(current.viewport, fitViewport(after, { width: 264, height: 188 }));
    assert.ok(current.viewport.scale > 0.08);
    assert.equal(state.queryGeneration, 4); assert.deepEqual(state.history, { back: ['source'] });
    assert.equal(current.analysis, null); assert.equal(current.selectedEntityId, null);
});

test('first-fit completion cannot replace a newer manual, selected, analyzing, failed or foreign view', () => {
    const current = { buildId: 'current', disclosureState: {} };
    for (const change of [{ current: { ...current, buildId: 'other' } }, { queryGeneration: 5 }, { pending: true }, { error: new Error('rejected') },
        { current: { ...current, selectedEntityId: 'node' } }, { current: { ...current, selectedRelationId: 'net' } },
        { current: { ...current, analysis: { result: 'exact-query-result' } } },
        ...['manual', 'selection'].map(fit => ({ current: { ...current, disclosureState: { presentation: { fit } } } }))]) {
        const state = { current, queryGeneration: 4, ...change };
        assert.equal(fitNativeInitialViewport({ getState: () => state,
            resize() { assert.fail('must retain user view'); } }, { buildId: 'current', queryGeneration: 4 }, () => assert.fail(), fitViewport), false);
    }
});

test('committed input status describes available inputs while keeping progress and stale evidence intact', () => {
    const pending = { inputStatus: 'artifact-only', message: 'Updated sources are ready. Opening the current module…',
        summary: { inputIdentity: 'verified-input' }, notice: { status: 'stale', message: 'Captured previous result' } };
    const committed = nativeCommittedStatus(pending, key => translate('en', key));
    assert.equal(committed.message, 'RTL result connected. BSV source correspondence is not attached.');
    assert.match(pending.message, /Opening/); assert.equal(committed.summary, pending.summary); assert.equal(committed.notice, pending.notice);
    assert.equal(nativeCommittedStatus(pending, key => translate('ko', key)).message,
        'RTL 결과가 연결됐습니다. BSV 원문 대응은 연결되지 않았습니다.');
    const failure = { message: 'Registered source changed', status: 'stale' };
    assert.equal(nativeCommittedStatus(failure, key => key), failure);
});
