'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadNativeInput } = require('../src/hardware/native-input');
const { createArchitecture } = require('../src/hardware/architecture');
const { layout } = require('../media/hardware-layout');
const { validateGeometry, validateMembership } = require('../experiments/hardware/g4-fix/oracle/geometry.cjs');

test('a medium register-dominated source scene keeps memory and FIFO structure and relations primary', async () => {
    const directory = await fs.mkdtemp(path.resolve('.build/hardware/runs/g6-memory-priority-test-'));
    await fs.writeFile(path.join(directory, 'Medium.bsv'), `package Medium;
import BRAMCore::*; import FIFOF::*;
interface Unit; method Action put(Bit#(8) value); endinterface
module mkUnit(Unit); method Action put(Bit#(8) value); noAction; endmethod endmodule
module mkMedium(Empty);
Unit worker <- mkUnit;
BRAM_PORT#(Bit#(8), Bit#(8)) samples <- mkBRAMCore1(256, False);
${Array.from({ length: 18 }, (_, i) => `Reg#(Bit#(8)) count${i} <- mkReg(0); rule update${i}; count${i} <= count${i}+1; endrule`).join('\n')}
FIFOF#(Bit#(8)) pending <- mkFIFOF;
rule transfer; worker.put(pending.first); pending.deq; samples.put(True, 0, 1); endrule
endmodule endpackage`);
    const input = await loadNativeInput({ sourceRoot: directory }), query = input.catalog[0], entry = query.getCatalogEntry();
    const scene = query.getScene({ buildId: entry.buildId, snapshotId: entry.snapshotId, queryGeneration: 0, sceneKind: 'bsv' }).scene;
    const architecture = createArchitecture({ analysis: input.analysis });
    assert.equal(scene.storages.filter(storage => storage.primitiveKind === 'register').length, 18);
    assert.equal(scene.projection.stateRelations.mode, 'on-selection');
    const primaryStorage = scene.storages.filter(storage => ['memory', 'fifo'].includes(storage.primitiveKind));
    assert.deepEqual(primaryStorage.map(storage => storage.label), ['samples', 'pending']);
    const shown = new Set(scene.connections.flatMap(connection => connection.memberRelationIds));
    const primaryFacts = Object.values(architecture.relations).filter(relation => relation.ownerInstanceId === scene.shell.id
        && primaryStorage.some(storage => storage.id === relation.fromId || storage.id === relation.toId));
    assert.ok(primaryFacts.length > 0);
    assert.ok(primaryFacts.every(relation => shown.has(relation.id)));
    assert.equal(validateMembership(scene, { architecture }).valid, true);
    for (const size of [{ width: 396, height: 180 }, { width: 1000, height: 700 }]) {
        const geometry = layout(scene, size), registers = geometry.nodes.filter(node => scene.storages.some(storage => storage.id === node.id && storage.primitiveKind === 'register'));
        for (const item of [...scene.children, ...primaryStorage]) {
            const box = geometry.nodes.find(node => node.id === item.id);
            assert.ok(box.width > registers[0].width * 2);
            assert.ok(box.y + box.height < Math.min(...registers.map(node => node.y)));
        }
        assert.equal(geometry.routing.status, 'complete');
        assert.equal(validateGeometry(scene, geometry).valid, true);
    }
    const invalid = structuredClone(scene), victim = invalid.connections.find(connection => connection.memberRelationIds.includes(primaryFacts[0].id));
    invalid.connections = invalid.connections.filter(connection => connection.id !== victim.id);
    invalid.projection.summaryRelationIds = invalid.projection.summaryRelationIds.filter(id => !victim.memberRelationIds.includes(id));
    invalid.projection.foldedRelationIds.push(...victim.memberRelationIds);
    assert.equal(validateMembership(invalid, { architecture }).valid, false, 'Primary memory/FIFO facts cannot be silently folded');
});
