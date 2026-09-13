'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNavigation, visitKey } = require('../media/hardware-navigation');
function harness() {
    const h = { size: { width: 640, height: 480 }, pending: null };
    const scene = request => ({ id: `scene:${request.ownerInstanceId}`, snapshotId: 'snapshot', sceneKind: 'bsv',
        buildId: 'build', provider: 'stock', sourceRevision: 'revision', ownerInstanceId: request.ownerInstanceId,
        rootInstanceId: request.ownerInstanceId, occurrencePath: request.ownerInstanceId, breadcrumb: [],
        shell: { id: request.ownerInstanceId }, children: [], storages: [], contacts: [], connections: [],
        disclosureState: request.disclosureState, selection: { selectedEntityId: request.selectedEntityId, selectedRelationId: null } });
    h.nav = createNavigation({ getSize: () => h.size,
        layoutScene: value => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 },
            nodes: [{ id: value.shell.id, x: 20, y: 20, width: 400, height: 300 }], contacts: [], routes: [] }),
        fitViewport: () => ({ x: 30, y: 40, scale: 1 }),
        queryScene: (request, { signal }) => {
            const response = { scene: scene(request), requestSnapshotId: request.snapshotId, queryGeneration: request.queryGeneration };
            return h.hold ? new Promise(resolve => { h.pending = { signal, resolve: () => resolve(response) }; }) : response;
        } });
    h.enter = ownerInstanceId => h.nav.navigate({ buildId: 'build', snapshotId: 'snapshot', sceneKind: 'bsv', ownerInstanceId });
    return h;
}
test('presentation patches preserve pending queries and history; selection still cancels', async () => {
    const h = harness(); await h.enter('root'); const key = visitKey(h.nav.getState().current);
    h.hold = true; const request = h.enter('child');
    h.nav.patchCurrent({ disclosureState: { presentation: { fit: 'selection', inspectorOpen: false } }, activePanel: 'inspector' });
    h.nav.setViewport({ x: 17, y: 23, scale: 1.2 });
    assert.equal(h.pending.signal.aborted, false); assert.equal(h.nav.getState().pending, true);
    assert.equal(visitKey(h.nav.getState().current), key); assert.equal(h.nav.getState().history.back.length, 0);
    h.nav.patchCurrent({ selectedEntityId: 'root' }); assert.equal(h.pending.signal.aborted, true);
    h.pending.resolve(); assert.equal(await request, false);
});
test('Back adapts a saved selected anchor to changed canvas size without a new query', async () => {
    const h = harness(); await h.enter('root'); h.nav.patchCurrent({ selectedEntityId: 'root' });
    h.nav.setViewport({ x: 80, y: 60, scale: 1 });
    const before = h.nav.getState().current.viewport;
    await h.enter('child'); h.size = { width: 420, height: 360 }; h.nav.resize();
    assert.equal(h.nav.back(), true);
    const after = h.nav.getState();
    assert.equal(after.current.ownerInstanceId, 'root'); assert.equal(after.current.selectedEntityId, 'root');
    assert.equal(after.current.viewport.scale, before.scale);
    assert.equal(after.current.viewport.x, before.x + (420 - 640) / 2);
    assert.equal(after.current.viewport.y, before.y + (360 - 480) / 2);
});
