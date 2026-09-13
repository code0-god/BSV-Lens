'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('navigation seam: repeat entry is a no-op; breadcrumb clears focus; Back restores exact scene', () => {
    const { createNavigation } = require('./navigation');
    const model = { snapshot: { id: 'snapshot', stage: 'proc' }, occurrences: {
        top: { id: 'top', parentId: null, blackbox: false, cells: ['c'] },
        child: { id: 'child', parentId: 'top', blackbox: false, cells: ['leaf'] }
    } };
    const nav = createNavigation(model, { mode: 'rtl' });
    assert.equal(nav.enter('top'), true);
    assert.equal(nav.enter('top'), false);
    nav.inspect('wire');
    nav.viewport({ x: 17, y: 29, width: 900, height: 600 });
    nav.source({ hash: 'abc', range: [4, 8], text: 'actual source' });
    const previous = nav.snapshot();
    assert.equal(nav.enter('child'), true);
    assert.equal(nav.enter('child'), false);
    assert.equal(nav.state.selectedId, null);
    assert.equal(nav.back(), true);
    assert.deepEqual(nav.snapshot(), previous);
    assert.equal(nav.forward(), true);
    nav.inspect('leaf');
    nav.source({ hash: 'def', range: [11, 12] });
    const child = nav.snapshot();
    assert.equal(nav.go('top'), true);
    assert.equal(nav.state.selectedId, null);
    assert.equal(nav.state.source, null);
    assert.equal(nav.back(), true);
    assert.deepEqual(nav.snapshot(), child);
    assert.equal(nav.up(), true);
    assert.equal(nav.state.rootId, 'top');
    assert.equal(nav.up(), true);
    assert.equal(nav.state.rootId, null);
});
