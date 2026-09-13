'use strict';

// Locally reconstructed from the supplied review findings. The original external
// review files were not supplied. This oracle never imports the product validator.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.env.G4_REVIEW_ROOT || path.join(__dirname, '../../../..'));
const { createCatalog } = require(path.join(root, 'experiments/hardware/g4/server.js'));
const { createNavigation } = require(path.join(root, 'media/hardware-navigation.js'));
const { layout, fitViewport } = require(path.join(root, 'media/hardware-layout.js'));
const catalog = createCatalog();
const size = { width: 1100, height: 650 };
const EPSILON = 1e-7;

function positiveOverlap(a, b) {
    const horizontalA = Math.abs(a[1] - a[3]) <= EPSILON;
    const horizontalB = Math.abs(b[1] - b[3]) <= EPSILON;
    if (horizontalA !== horizontalB) return 0;
    const axis = horizontalA ? 0 : 1;
    if (Math.abs(a[1 - axis] - b[1 - axis]) > EPSILON) return 0;
    return Math.max(0, Math.min(Math.max(a[axis], a[axis + 2]), Math.max(b[axis], b[axis + 2]))
        - Math.max(Math.min(a[axis], a[axis + 2]), Math.min(b[axis], b[axis + 2])));
}

test('RTL child occurrence entry is a distinct visit', async () => {
    const query = (await catalog).find(item => item.getCatalogEntry().buildId === 'A');
    const entry = query.getCatalogEntry();
    const navigation = createNavigation({ queryScene: async intent => query.getScene(intent),
        layoutScene: layout, getSize: () => size, fitViewport });
    assert.equal(await navigation.navigate({ ...entry, sceneKind: 'bsv', ownerInstanceId: entry.rootInstanceId }), true);
    assert.equal(await navigation.navigate({ sceneKind: 'rtl', implementationProvider: 'stock' }), true);
    const before = navigation.getState();
    const left = before.scene.children.find(item => item.label === 'left');
    assert.equal(left.interaction.kind, 'enter');
    const context = { ...before.current.implementationContext, contextOccurrenceId: left.id,
        implementationOccurrenceId: left.id };
    const intent = { sceneKind: 'rtl', implementationContext: context, selectedEntityId: null, selectedRelationId: null };
    const direct = query.getScene({ buildId: 'A', snapshotId: before.current.snapshotId, queryGeneration: before.queryGeneration + 1,
        rootInstanceId: before.current.rootInstanceId, ownerInstanceId: before.current.ownerInstanceId,
        implementationProvider: 'stock', ...intent });
    assert.equal(direct.scene.shell.id, left.id, 'The product query itself must resolve the real child');
    assert.equal(await navigation.navigate(intent), true, 'A resolved different RTL occurrence must commit');
    const after = navigation.getState();
    assert.equal(after.scene.shell.id, direct.scene.shell.id);
    assert.equal(after.current.ownerInstanceId, before.current.ownerInstanceId);
    assert.equal(after.history.back.length, before.history.back.length + 1);
});

test('Distinct integer nets have no coincident route segments', async () => {
    const query = (await catalog).find(item => item.getCatalogEntry().buildId === 'A');
    const entry = query.getCatalogEntry();
    const overall = query.getScene({ buildId: 'A', snapshotId: entry.snapshotId, queryGeneration: 1 }).scene;
    const left = overall.children.find(item => item.label === 'left');
    const inside = query.getScene({ buildId: 'A', snapshotId: entry.snapshotId, queryGeneration: 2,
        rootInstanceId: left.id, ownerInstanceId: left.id }).scene;
    const state = inside.storages.find(item => item.label === 'state');
    const scene = query.getScene({ buildId: 'A', snapshotId: entry.snapshotId, queryGeneration: 3,
        rootInstanceId: left.id, ownerInstanceId: left.id, selectedEntityId: state.id,
        sceneKind: 'rtl', implementationProvider: 'instrumented' }).scene;
    const geometry = layout(scene, size);
    const integer = scene.connections.filter(connection => connection.rawBits.every(bit => typeof bit === 'number'));
    const routes = new Map(geometry.routes.map(route => [route.id, route]));
    const overlaps = [];
    for (let i = 0; i < integer.length; i++) for (let j = i + 1; j < integer.length; j++) {
        const a = integer[i], b = integer[j];
        assert.ok(a.bits.every(bit => !b.bits.includes(bit)), 'This captured oracle compares distinct canonical bit groups');
        for (const segmentA of routes.get(a.id).segments) for (const segmentB of routes.get(b.id).segments) {
            const length = positiveOverlap(segmentA, segmentB);
            if (length > EPSILON) overlaps.push({ a: a.label, aBits: a.rawBits, b: b.label, bBits: b.rawBits,
                segmentA, segmentB, length });
        }
    }
    assert.deepEqual(overlaps, [], JSON.stringify(overlaps, null, 2));
});
