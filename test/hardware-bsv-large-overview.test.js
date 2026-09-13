'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadNativeInput } = require('../src/hardware/native-input');
const { createArchitecture } = require('../src/hardware/architecture');
const { stable } = require('../src/hardware/json');
const { layout, ROUTING_LIMITS } = require('../media/hardware-layout');
const { createNavigation } = require('../media/hardware-navigation');
const { validateGeometry, validateMembership } = require('../experiments/hardware/g4-fix/oracle/geometry.cjs');

test('large source overview preserves every storage and fact, discloses selected state connections and restores Back', async () => {
    const directory = await fs.mkdtemp(path.resolve('.build/hardware/runs/g6-large-overview-test-'));
    const source = `package Many;
interface Port; method Action put(Bit#(8) value); method Bit#(8) get; endinterface
module mkUnit(Port); method Action put(Bit#(8) value); noAction; endmethod method Bit#(8) get = 1; endmodule
module mkMany(Empty);
Port left <- mkUnit; Port right <- mkUnit;
${Array.from({ length: 165 }, (_, i) => `Reg#(Bit#(8)) state${i} <- mkReg(0); rule update${i}; state${i} <= state${i} + 1; endrule`).join('\n')}
rule transfer; left.put(right.get); endrule
endmodule endpackage`;
    await fs.writeFile(path.join(directory, 'Many.bsv'), source);
    const input = await loadNativeInput({ sourceRoot: directory }), query = input.catalog[0];
    const entry = query.getCatalogEntry(), original = stable(input.analysis), architecture = createArchitecture({ analysis: input.analysis });
    const base = { buildId: entry.buildId, snapshotId: entry.snapshotId, rootInstanceId: entry.rootInstanceId,
        queryGeneration: 0, sceneKind: 'bsv' };
    const overview = query.getScene(base).scene, storage = overview.storages[5];
    assert.equal(overview.storages.length, 165);
    assert.equal(overview.projection.stateRelations.mode, 'on-selection');
    assert.ok(overview.connections.some(connection => connection.relationFamily === 'invoke'));
    assert.ok(overview.connections.some(connection => connection.relationFamily === 'return'));
    assert.equal(overview.connections.some(connection => /^state-/.test(connection.relationFamily)), false);
    assert.equal(overview.projection.stateRelations.foldedRelationIds.length, 330);
    assert.ok(overview.inspector.relationMembers.some(member => member.fromId === storage.id || member.toId === storage.id));
    const selected = query.getScene({ ...base, selectedEntityId: storage.id }).scene;
    const stateConnections = selected.connections.filter(connection => /^state-/.test(connection.relationFamily));
    assert.deepEqual(stateConnections.map(connection => connection.relationFamily).sort(), ['state-read', 'state-write']);
    assert.ok(stateConnections.every(connection => connection.endpointIds.includes(storage.id)));
    assert.equal(selected.projection.stateRelations.foldedRelationIds.length, 328);
    for (const scene of [overview, selected]) {
        assert.equal(validateMembership(scene, { architecture }).valid, true);
        for (const size of [{ width: 1000, height: 700 }, { width: 420, height: 650 }]) {
            const geometry = layout(scene, size), check = validateGeometry(scene, geometry);
            const storageBoxes = geometry.nodes.filter(node => scene.storages.some(storage => storage.id === node.id));
            for (const child of scene.children) {
                const primary = geometry.nodes.find(node => node.id === child.id);
                assert.ok(primary.width >= storageBoxes[0].width * 4, 'Primary module bodies must outrank storage glyphs');
                assert.ok(primary.y + primary.height < Math.min(...storageBoxes.map(box => box.y)));
            }
            assert.equal(geometry.routing.status, 'complete');
            assert.equal(check.valid, true, JSON.stringify(check.findings));
            assert.ok(Math.max(geometry.bounds.width, geometry.bounds.height) <= ROUTING_LIMITS.maxDimension);
        }
    }
    assert.deepEqual(layout(selected, { width: 1000, height: 700 }).nodes, layout(overview, { width: 1000, height: 700 }).nodes);
    for (const family of ['invoke', 'return', 'state-read', 'state-write']) {
        const copy = structuredClone(selected), connection = copy.connections.find(item => item.relationFamily === family);
        copy.connections = copy.connections.filter(item => item !== connection);
        copy.projection.summaryRelationIds = copy.projection.summaryRelationIds.filter(id => !connection.memberRelationIds.includes(id));
        copy.projection.foldedRelationIds.push(...connection.memberRelationIds);
        assert.equal(validateMembership(copy, { architecture }).valid, false, `${family} cannot be silently folded`);
    }
    const stale = structuredClone(overview); stale.projection.sourceRevision = 'foreign';
    assert.equal(validateMembership(stale, { architecture }).valid, false);
    const small = query.getScene({ ...base, ownerInstanceId: overview.children[0].id }).scene;
    assert.equal(small.projection.stateRelations, undefined);
    const inappropriate = structuredClone(small); inappropriate.projection.stateRelations = { mode: 'on-selection', selectedId: null, foldedRelationIds: [] };
    assert.equal(validateMembership(inappropriate, { architecture }).valid, false);
    const memberId = selected.connections.find(connection => connection.relationFamily === 'state-write').memberRelationIds[0];
    const relation = query.getScene({ ...base, selectedRelationId: memberId }).scene;
    assert.ok(relation.connections.some(connection => connection.memberRelationIds.includes(memberId)));
    const summaryId = stateConnections.find(connection => connection.relationFamily === 'state-write').id;
    const summary = query.getScene({ ...base, selectedRelationId: summaryId }).scene;
    assert.ok(summary.connections.some(connection => connection.id === summaryId));
    assert.deepEqual(summary.connections.map(connection => connection.id), selected.connections.map(connection => connection.id));
    assert.equal(validateMembership(summary, { architecture }).valid, true);
    assert.ok(summary.inspector.sourceRefs.length);
    const sourceRef = summary.inspector.sourceRefs[0], opened = query.getSource(sourceRef);
    assert.equal(opened.text, sourceRef.text);
    const nav = createNavigation({ getSize: () => ({ width: 1000, height: 700 }),
        queryScene: request => query.getScene(request), layoutScene: layout, fitViewport: () => ({ x: 0, y: 0, scale: 0.1 }) });
    assert.equal(await nav.navigate(base), true);
    nav.setViewport({ x: 90, y: 60, scale: 0.7 });
    assert.equal(await nav.select(storage.id), true);
    const saved = nav.getState();
    assert.equal(saved.history.back.length, 0);
    assert.deepEqual(saved.current.viewport, { x: 90, y: 60, scale: 0.7 });
    assert.equal(await nav.select(summaryId, { relation: true }), true);
    const summarySaved = nav.getState();
    assert.equal(await nav.navigate({ ownerInstanceId: overview.children[0].id, selectedEntityId: null }), true);
    assert.equal(nav.back(), true);
    assert.deepEqual(nav.getState().current, summarySaved.current);
    assert.deepEqual(nav.getState().scene, summarySaved.scene);
    assert.deepEqual(nav.getState().geometry, summarySaved.geometry);
    assert.equal(stable(input.analysis), original);
});
