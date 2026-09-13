'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertViewportPreserved } = require('./native-history.cjs');
const before = { identity: { buildId: 'same', sceneId: 'same', owner: 'same', selected: null, relation: null },
    fit: 'structure', viewport: { x: 20, y: 100, scale: .8 }, drawable: { width: 396, height: 243 },
    frame: { size: { width: 396, height: 243 }, anchor: { x: 50, y: 100 } }, anchor: { x: 50, y: 100 } };
test('same drawable size rejects the observed erroneous 7.5px Back offset', () => {
    const after = structuredClone(before); after.viewport.y -= 7.5;
    assert.throws(() => assertViewportPreserved(before, after), /Same drawable size requires exact viewport preservation/);
    assert.equal(assertViewportPreserved(before, before).policy, 'same-size-exact');
});
test('actual banner resize preserves scale and geometry anchor rather than full Fit', () => {
    const after = structuredClone(before); after.drawable.height = after.frame.size.height = 228;
    after.anchor.y = after.frame.anchor.y = 120; after.viewport.y = 76.5;
    assert.equal(assertViewportPreserved(before, after).policy, 'observed-anchor-resize');
    after.viewport.scale = 1;
    assert.throws(() => assertViewportPreserved(before, after), /must not automatically Fit or zoom/);
});
test('stale canvas tracking and stale saved anchor cannot pass resize validation', () => {
    const stale = structuredClone(before); stale.drawable.height = 228;
    assert.throws(() => assertViewportPreserved(before, stale), /Navigation size must match the actual drawable SVG/);
    const wrong = structuredClone(before); wrong.frame.anchor.y += 10;
    assert.throws(() => assertViewportPreserved(before, wrong), /Saved viewport anchor must match/);
});
