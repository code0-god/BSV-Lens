'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalog } = require('../experiments/hardware/g4/server');
const { createNavigation } = require('../media/hardware-navigation');
const Layout = require('../media/hardware-layout');

test('actual product analysis commits and restores through the existing scene navigation', async () => {
    const catalog = await createCatalog();
    const query = catalog.find(item => item.getCatalogEntry().buildId === 'A');
    const entry = query.getCatalogEntry();
    const navigation = createNavigation({
        queryScene: input => query.getScene(input),
        queryAnalysis: (input, options) => query.analyze(input, options),
        layoutScene: Layout.layout,
        fitViewport: Layout.fitViewport,
        getSize: () => ({ width: 1100, height: 650 })
    });
    assert.equal(await navigation.navigate({
        buildId: entry.buildId, snapshotId: entry.snapshotId, sceneKind: 'rtl',
        rootInstanceId: entry.rootInstanceId, ownerInstanceId: entry.rootInstanceId
    }), true);
    const initial = navigation.getState();
    const contact = initial.scene.contacts.find(item => item.ownerId === initial.scene.shell.id && item.bits.length);
    assert.ok(contact);
    const input = { kind: 'same-net', seed: { entityId: contact.id, indices: [0] },
        scope: { kind: 'design', rootOccurrenceId: initial.current.implementationContext.rootOccurrenceId } };
    assert.equal(await navigation.analyze(input), true, navigation.getState().error?.message);
    const analyzed = navigation.getState();
    assert.equal(analyzed.current.analysis.result.status, 'complete');
    assert.equal(analyzed.current.analysis.result.seed.positions[0].bitId, contact.bits[0]);
    assert.equal(analyzed.current.analysis.result.context.snapshotId, initial.current.implementationContext.snapshotId);
    assert.equal(analyzed.current.analysis.result.sourceRefs.length, 0);
    assert.equal(await navigation.analyze(input), false);
    assert.equal(navigation.getState().history.back.length, analyzed.history.back.length);
    assert.equal(navigation.back(), true);
    assert.deepEqual(navigation.getState().current, initial.current);
    assert.equal(navigation.forward(), true);
    assert.deepEqual(navigation.getState().current, analyzed.current);
});
