'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { semanticState, assertExport, assertAnchor, assertKoreanDesignLabel, assertKoreanWord } = require('./native-responsive.cjs');

function state() {
    return { current: { buildId: 'build', snapshotId: null, rootInstanceId: 'root', ownerInstanceId: 'child',
        sceneKind: 'bsv', provider: 'stock', implementationContext: { contextOccurrenceId: null },
        selectedEntityId: 'state', selectedRelationId: null, viewport: { x: 1, y: 2, scale: 1 },
        analysis: { request: { kind: 'state-accesses', scope: { kind: 'source-only' } }, result: { queryId: 'query', readers: ['read'], writers: ['write'] } } },
    scene: { snapshotId: null, sourceRevision: 'revision', projection: { kind: 'bsv-overview', canonicalRelationIds: ['one', 'two'],
        foldedRelationIds: ['two'] }, connections: [{ id: 'summary', members: [{ id: 'one' }], memberRelationIds: ['one'] }] },
    geometry: { routing: { deferred: [{ id: 'summary', reason: 'test-injected' }] } }, history: { back: [1], forward: [] } };
}

test('responsive identity allows presentation changes and rejects source/query/history drift', () => {
    const before = state(), after = structuredClone(before);
    after.current.viewport.x = 42; after.current.disclosureState = { analysis: { disclosures: { source: true } } };
    assert.deepEqual(semanticState(after), semanticState(before));
    for (const change of [copy => { copy.scene.sourceRevision = 'other'; }, copy => { copy.current.analysis.result.readers = []; },
        copy => { copy.current.ownerInstanceId = 'sibling'; }, copy => { copy.history.back.push(2); }]) {
        const changed = structuredClone(before); change(changed); assert.notDeepEqual(semanticState(changed), semanticState(before));
    }
});

test('saved SVG oracle requires exact source projection and original relation membership', () => {
    const current = state(), metadata = { snapshotId: null, ownerInstanceId: 'child', sourceRevision: 'revision',
        displayScope: 'BSV overview at intrinsic scale 1; deferred routes listed separately', projection: current.scene.projection,
        routing: current.geometry.routing, connections: current.scene.connections };
    assert.doesNotThrow(() => assertExport(metadata, current));
    for (const change of [copy => { copy.sourceRevision = 'stale'; }, copy => { copy.projection.foldedRelationIds = []; },
        copy => { copy.connections[0].memberRelationIds = ['foreign']; }, copy => { copy.routing.deferred = []; },
        copy => { copy.displayScope = 'BSV overview complete topology'; }]) {
        const changed = structuredClone(metadata); change(changed); assert.throws(() => assertExport(changed, current));
    }
});

test('anchor oracle rejects silent Fit, changed selection and center-relative displacement', () => {
    const before = { id: 'state', scale: 1.5, offset: { x: 23, y: -18 } };
    assert.doesNotThrow(() => assertAnchor(before, structuredClone(before)));
    for (const change of [copy => { copy.id = 'other'; }, copy => { copy.scale = 0.5; },
        copy => { copy.offset.x += 1; }, copy => { copy.offset.y -= 10; }]) {
        const changed = structuredClone(before); change(changed); assert.throws(() => assertAnchor(before, changed));
    }
});

test('Korean design label oracle rejects a split text range, missing glyph or clipping despite a large container', () => {
    const label = { text: '설계', effectiveFont: 11, lineRects: [{ width: 22, height: 16 }],
        glyphs: [{ text: '설', visible: true }, { text: '계', visible: true }], containerHeight: 100 };
    assert.doesNotThrow(() => assertKoreanDesignLabel(label));
    for (const change of [copy => { copy.lineRects.push({ width: 11, height: 16 }); }, copy => { copy.glyphs.pop(); },
        copy => { copy.glyphs[1].visible = false; }, copy => { copy.effectiveFont = 4; }]) {
        const changed = structuredClone(label); change(changed); assert.throws(() => assertKoreanDesignLabel(changed));
    }
});

test('continuation caption word fails when any Korean syllable moves to a second line', () => {
    const label = { text: '이어지는', effectiveFont: 10, lineRects: [{ y: 10, height: 15 }],
        glyphs: [...'이어지는'].map(text => ({ text, visible: true })) };
    assert.doesNotThrow(() => assertKoreanWord(label, '이어지는'));
    const split = structuredClone(label); split.lineRects.push({ y: 25, height: 15 });
    assert.throws(() => assertKoreanWord(split, '이어지는'), /wraps across lines/);
});
