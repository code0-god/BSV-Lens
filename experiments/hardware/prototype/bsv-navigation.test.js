'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNavigation } = require('./navigation');
const hardware = { snapshot: { id: 'immutable', stage: 'actual-rtl' }, occurrences: {
    rtlTop: { id: 'rtlTop', parentId: null, cells: ['real-cell'] },
    rtlChild: { id: 'rtlChild', parentId: 'rtlTop', cells: ['real-leaf'] }
} };
const architecture = { occurrences: {
    top: { id: 'top', parentId: null }, child: { id: 'child', parentId: 'top' },
    inlined: { id: 'inlined', parentId: 'child' }
} };
test('BSV leaves enter; scene-kind transition retains owner, source, selection and viewport; Back restores distinct scenes', () => {
    const nav = createNavigation(hardware, { architecture });
    assert.equal(nav.state.sceneKind, 'bsv');
    assert.equal(nav.enter('top'), true);
    assert.equal(nav.enter('child'), true);
    assert.equal(nav.enter('child'), false);
    nav.inspect('put'); nav.state.rtlSignals = true; nav.inspect('get');
    assert.equal(nav.state.rtlSignals, false);
    nav.inspect('state'); nav.source({ hash: 'source-revision', range: [9, 10], text: 'state <= value + 1;' });
    nav.viewport({ x: 13, y: 29, width: 800, height: 600 });
    const bsv = nav.snapshot();
    assert.equal(nav.openRTL('child', 'rtlChild', ['real-leaf']), true);
    assert.equal(nav.state.sceneKind, 'rtl'); assert.equal(nav.state.ownerId, 'child');
    assert.equal(nav.state.rootId, 'rtlChild'); assert.equal(nav.state.selectedId, bsv.selectedId);
    assert.deepEqual(nav.state.source, bsv.source);
    assert.deepEqual(nav.state.bsvContext.viewport, bsv.viewport);
    assert.equal(nav.state.viewport, null, 'A new implementation scene needs its own measured viewport');
    assert.equal(nav.state.snapshotId, bsv.snapshotId);
    const length = nav.history.back.length;
    assert.equal(nav.openRTL('child', 'rtlChild', ['real-leaf']), false);
    assert.equal(nav.history.back.length, length);
    nav.viewport({ x: 90, y: 30, width: 1500, height: 900 }); nav.inspect('real-leaf');
    const rtl = nav.snapshot();
    assert.equal(nav.back(), true); assert.deepEqual(nav.snapshot(), bsv);
    assert.equal(nav.forward(), true); assert.deepEqual(nav.snapshot(), rtl);
    assert.equal(nav.returnBSV(), true); assert.deepEqual(nav.snapshot(), bsv);
    assert.equal(nav.back(), true); assert.deepEqual(nav.snapshot(), rtl);
    nav.returnBSV(); assert.equal(nav.up(), true); assert.equal(nav.state.rootId, 'top');
    nav.enter('child'); assert.equal(nav.enter('inlined'), true);
    assert.equal(nav.up(), true); assert.equal(nav.state.rootId, 'child');
});
test('RTL is explicit, old leaf/blackbox and source navigation semantics stay intact', () => {
    const nav = createNavigation(hardware, { mode: 'rtl', architecture });
    assert.equal(nav.state.sceneKind, 'rtl'); assert.equal(nav.enter('rtlTop'), true);
    assert.equal(nav.enter('child'), false);
    assert.throws(() => nav.openRTL('foreign', 'rtlChild', []), /Unknown BSV owner/);
});
