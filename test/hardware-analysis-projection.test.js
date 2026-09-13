'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalog } = require('../experiments/hardware/g4/server');
const { seedChoices, seedInput, projectAnalysis, revealIntent } = require('../media/hardware-analysis');
const { layout } = require('../media/hardware-layout');
let catalog;
async function fixture(build = 'A') {
    catalog ||= createCatalog();
    const query = (await catalog).find(q => q.getCatalogEntry().buildId === build), entry = query.getCatalogEntry();
    const intent = { buildId: build, snapshotId: entry.snapshotId, ownerInstanceId: entry.rootInstanceId,
        rootInstanceId: entry.rootInstanceId, sceneKind: 'rtl', implementationProvider: 'stock', queryGeneration: 1 };
    return { query, intent, scene: query.getScene(intent).scene };
}
async function resultFor(f, choice, positions, kind = 'same-net', scope = 'design') {
    const c = f.scene.implementationContext;
    return f.query.analyze({ kind, analysisId: f.scene.provenance.analysisId, snapshotId: c.snapshotId,
        implementationProvider: c.provider, implementationOccurrenceId: c.contextOccurrenceId,
        ownerInstanceId: f.scene.ownerInstanceId, seed: seedInput(choice, positions),
        scope: { kind: scope, rootOccurrenceId: scope === 'design' ? c.rootOccurrenceId : c.contextOccurrenceId }, queryGeneration: 1 });
}
test('parent contact seed maps exact recorded pin positions; order and repeats survive product query', { timeout: 60000 }, async () => {
    const f = await fixture(), child = f.scene.children.find(c => c.label === 'left');
    const contact = f.scene.contacts.find(c => c.ownerId === child.id && c.label === 'get');
    const choice = seedChoices(f.scene, contact.id)[0];
    const members = f.scene.connections.flatMap(c => c.incidences.filter(i => i.contactId === contact.id).flatMap(i => i.members));
    assert.equal(choice.entityId, members[0].endpointId);
    assert.notEqual(choice.entityId, contact.id);
    assert.deepEqual(choice.positions.map(p => p.bitId), contact.bits.map((bit, index) => members.find(m => m.contactIndex === index && m.formalBitId === bit).bitId));
    assert.deepEqual(choice.positions.map(p => p.mapping), contact.bits.map((bit, index) => members.find(m => m.contactIndex === index && m.formalBitId === bit)));
    const seed = seedInput(choice, [0, 2, 1, 2]);
    assert.deepEqual(seed, { entityId: members[0].endpointId, indices: [0, 2, 1, 2] });
    const result = await resultFor(f, choice, [0, 2, 1, 2]);
    assert.deepEqual(result.groups.map(g => g.seed.bitId), [0, 2, 1, 2].map(i => choice.positions[i].bitId));
    assert.deepEqual(result.groups.map(g => g.seed.index), [0, 2, 1, 2]);
    const projection = projectAnalysis(f.scene, result);
    assert.ok(projection.contacts.find(c => c.id === contact.id && c.seed && c.boundary));
    assert.ok(projection.references.some(r => r.visibility === 'off-scene'));
    assert.equal(projection.counts.returned, result.objects.length);
    assert.equal(projection.counts.returned, projection.counts.visible + projection.counts.hidden + projection.counts.offScene);
    for (const ref of projection.references.filter(r => r.visibility === 'off-scene')) {
        const intent = revealIntent(f.scene, ref);
        assert.equal(intent.ownerInstanceId, f.scene.ownerInstanceId);
        const revealed = f.query.getScene({ ...f.intent, ...intent }).scene;
        assert.equal(revealed.implementationContext.contextOccurrenceId, ref.occurrenceId);
        assert.equal(revealed.selection.selectedEntityId, ref.entityId);
    }
});
test('open actual never seeds a foreign formal; explicit child reveal permits formal analysis', { timeout: 60000 }, async () => {
    const f = await fixture(), child = f.scene.children.find(c => c.label === 'left');
    const contact = f.scene.contacts.find(c => c.ownerId === child.id && c.label === 'RDY_get');
    assert.equal(f.scene.connections.some(c => c.incidences.some(i => i.contactId === contact.id)), false);
    const choice = seedChoices(f.scene, contact.id)[0];
    assert.equal(choice.status, 'unconnected');
    assert.throws(() => seedInput(choice, [0]), /unconnected/i);
    const intent = revealIntent(f.scene, choice.reveal);
    const entered = { ...f, scene: f.query.getScene({ ...f.intent, ...intent }).scene };
    const formal = seedChoices(entered.scene, contact.id)[0];
    const result = await resultFor(entered, formal, [0]);
    assert.equal(result.seed.entityId, contact.id);
    assert.equal(result.seed.occurrenceId, child.id);
});
test('ordered connection vectors and positional slice values are not display identities', { timeout: 60000 }, async () => {
    for (const build of ['A', 'B', 'C']) {
        const f = await fixture(build), connection = f.scene.connections.find(c => c.bits.length >= 3);
        const choice = seedChoices(f.scene, connection.id)[0], seed = seedInput(choice, [2, 0, 2]);
        assert.deepEqual(seed, { occurrenceId: f.scene.shell.id, bitIds: [connection.bits[2], connection.bits[0], connection.bits[2]] });
        const result = await resultFor(f, choice, [2, 0, 2]);
        assert.deepEqual(result.seed.positions.map(p => p.bitId), seed.bitIds);
        assert.throws(() => seedInput(choice, []));
        assert.throws(() => seedInput(choice, [choice.positions.length]));
        const bit = result.seed.positions[0].bitId;
        assert.deepEqual(seedInput(seedChoices(f.scene, bit)[0], [0]), { entityId: bit, indices: [0] });
        const alias = f.scene.aliases.find(a => a.bits.length > 2);
        assert.deepEqual(seedInput(seedChoices(f.scene, alias.id)[0], [2, 0, 2]), { entityId: alias.id, indices: [2, 0, 2] });
        const original = JSON.stringify(f.scene), geometry = layout(f.scene, { width: 1100, height: 650 });
        const projection = projectAnalysis(f.scene, result, []);
        assert.equal(projection.counts.visible, 0);
        assert.ok(projection.counts.hidden > 0);
        assert.equal(JSON.stringify(f.scene), original);
        assert.deepEqual(layout(f.scene, { width: 1100, height: 650 }), geometry);
        assert.ok(projection.routes.every(r => geometry.routes.some(g => g.id === r.id)));
        assert.ok(projection.contacts.every(r => geometry.contacts.some(g => g.id === r.id)));
        assert.ok(projection.nodes.every(r => geometry.nodes.some(g => g.id === r.id)));
    }
});
test('cells expose real pins; B read driver projection excludes unrelated add output', { timeout: 60000 }, async () => {
    const f = await fixture('B'), contact = f.scene.contacts.find(c => c.ownerId === f.scene.shell.id && c.label === 'read');
    const result = await resultFor(f, seedChoices(f.scene, contact.id)[0], [0], 'drivers-loads');
    const driver = result.groups[0].drivers[0], pin = f.scene.contacts.find(c => c.id === driver.entityId);
    const choices = seedChoices(f.scene, pin.ownerId);
    assert.deepEqual(choices.map(c => c.entityId), f.scene.contacts.filter(c => c.ownerId === pin.ownerId).map(c => c.id));
    const projection = projectAnalysis(f.scene, result);
    assert.ok(projection.contacts.find(c => c.id === pin.id && c.result));
    const add = f.scene.children.find(c => c.type === '$add');
    const output = f.scene.contacts.find(c => c.ownerId === add.id && c.label === 'Y');
    assert.equal(projection.contacts.find(c => c.id === output.id).result, false);
});
test('cross-source electrical results do not invent another BSV owner for Reveal', { timeout: 60000 }, async () => {
    const f = await fixture(), bsv = f.query.getScene({ ...f.intent, sceneKind: 'bsv' }).scene;
    const owner = bsv.children.find(c => c.label === 'left');
    const scene = f.query.getScene({ ...f.intent, ownerInstanceId: owner.id, rootInstanceId: owner.id }).scene;
    const contact = scene.contacts.find(c => c.ownerId === scene.shell.id && c.label === 'get');
    const result = await resultFor({ ...f, scene }, seedChoices(scene, contact.id)[0], [0]);
    const parentRef = result.objects.find(o => o.occurrenceId === scene.implementationContext.parentOccurrenceId);
    assert.ok(parentRef);
    assert.equal(revealIntent(scene, parentRef, result), null);
    const localRef = result.objects.find(o => o.occurrenceId === scene.shell.id);
    assert.equal(revealIntent(scene, localRef, result).ownerInstanceId, owner.id);
});
test('BSV choices use verified ordered-binding targets, never source labels as electrical seeds', { timeout: 60000 }, async () => {
    const f = await fixture(), bsv = f.query.getScene({ ...f.intent, sceneKind: 'bsv' }).scene;
    const contact = bsv.contacts.find(c => c.ownerId !== bsv.shell.id && c.label === 'get');
    const scene = f.query.getScene({ ...f.intent, sceneKind: 'bsv', selectedEntityId: contact.id }).scene;
    const choices = seedChoices(scene, contact.id), claims = scene.correspondence.stock.claims.filter(c => c.relationKind === 'ordered-port-binding');
    assert.deepEqual(choices.map(c => c.reveal.entityId), claims.map(c => c.tuple.target.entityId));
    assert.ok(choices.every(c => c.status === 'reveal'));
    for (const choice of choices) {
        assert.throws(() => seedInput(choice, [0]));
        const revealed = f.query.getScene({ ...f.intent, ...revealIntent(scene, choice.reveal) }).scene;
        assert.equal(revealed.selection.selectedEntityId, choice.reveal.entityId);
    }
});
test('real dependency results mark visited wires and sequential pin boundaries without new geometry', async () => {
    const f = await fixture('B');
    const cell = f.scene.children.find(item => item.type === '$pmux');
    const output = f.scene.contacts.find(item => item.ownerId === cell.id && item.label === 'Y');
    const context = f.scene.implementationContext;
    const result = await f.query.analyze({
        kind: 'dependencies', analysisId: f.scene.provenance.analysisId,
        snapshotId: context.snapshotId, implementationProvider: context.provider,
        implementationOccurrenceId: context.contextOccurrenceId, ownerInstanceId: f.scene.ownerInstanceId,
        seed: { entityId: output.id, indices: [0] },
        scope: { kind: 'design', rootOccurrenceId: context.rootOccurrenceId },
        direction: 'backward', semanticsProfile: 'yosys-0.68-structural-v1', queryGeneration: 1
    });
    const before = layout(f.scene, { width: 1100, height: 650 });
    const projection = projectAnalysis(f.scene, result);
    const visitedBits = new Set(result.objects.filter(item => ['signal-bit', 'constant'].includes(item.objectKind)).map(item => item.entityId));
    for (const route of f.scene.connections.filter(item => item.bits.some(bit => visitedBits.has(bit)))) {
        assert.equal(projection.routes.find(item => item.id === route.id).result, true);
    }
    const stopped = result.boundaries.filter(item => item.reason === 'sequential');
    assert.ok(stopped.length);
    for (const boundary of stopped) {
        assert.equal(projection.contacts.find(item => item.id === boundary.at.entityId).boundary, true);
        assert.equal(projection.nodes.find(item => item.id === boundary.cellId).boundary, true);
    }
    assert.deepEqual(layout(f.scene, { width: 1100, height: 650 }), before);
    assert.equal(result.sourceRefs.length, 0);
    assert.ok(result.relations.some(item => item.kind === 'control-dependency'));
});
