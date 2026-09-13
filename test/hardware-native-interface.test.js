'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadNativeInput } = require('../src/hardware/native-input');
const { createArchitecture } = require('../src/hardware/architecture');
const { hash, stable } = require('../src/hardware/json');
const { layout } = require('../media/hardware-layout');
const { validateMembership, validateGeometry } = require('../experiments/hardware/g4-fix/oracle/geometry.cjs');
const { createRun } = require('../experiments/hardware/g6/run.cjs');

const repeatedInterfaces = `package RepeatedInterfaces;
interface Leaf;
    method Action put(Bit#(8) value);
    method Bit#(8) get;
endinterface
interface Branch;
    interface Leaf requests;
    interface Leaf responses;
endinterface
interface Tree;
    interface Branch left;
    interface Branch right;
endinterface
module mkBranch(Branch);
endmodule
module mkTree(Tree);
    Branch first <- mkBranch;
    Branch second <- mkBranch;
endmodule
endpackage
`;

function sceneFor(query, rootInstanceId) {
    const entry = query.getCatalogEntry();
    return query.getScene({ buildId: entry.buildId, snapshotId: entry.snapshotId,
        queryGeneration: 1, ...(rootInstanceId ? { rootInstanceId } : {}) }).scene;
}

test('public source projection keeps repeated nested interfaces separate by occurrence and full parent path', async t => {
    const directory = createRun('interface-source-fixture');
    await fs.writeFile(path.join(directory, 'RepeatedInterfaces.bsv'), repeatedInterfaces);
    t.diagnostic(`Synthetic source-only fixture; no compiler evidence: ${directory}`);
    const input = await loadNativeInput({ sourceRoot: directory });
    const architecture = createArchitecture({ analysis: input.analysis });
    const original = stable(input.analysis), contacts = stable(architecture.contacts);
    const query = input.catalog[0], scene = sceneFor(query);
    assert.equal(scene.shell.label, 'mkTree');
    assert.deepEqual(scene.children.map(child => child.label), ['first', 'second']);
    assert.ok(scene.interfaceGroups.every(group => group.interfacePath.length <= 1));
    const visibleOwners = new Set([scene.shell.id, ...scene.children.map(child => child.id)]);
    const leaves = Object.values(architecture.contacts).filter(group => group.category === 'Interface'
        && group.declaredType === 'Leaf' && visibleOwners.has(group.ownerId));
    assert.equal(leaves.length, 8);
    for (const group of leaves) {
        const parent = input.sourceModel.endpoints.find(endpoint => endpoint.id === group.id);
        const expected = input.sourceModel.endpoints.filter(endpoint => endpoint.kind === 'method-endpoint'
            && endpoint.ownerInstanceId === parent.ownerInstanceId
            && endpoint.interfacePath.length === parent.interfacePath.length + 1
            && parent.interfacePath.every((part, index) => endpoint.interfacePath[index] === part));
        assert.equal(expected.length, 2);
        const entry = query.getCatalogEntry();
        const inspected = query.getScene({ buildId: entry.buildId, snapshotId: entry.snapshotId,
            rootInstanceId: scene.shell.id, queryGeneration: 1, selectedEntityId: group.id });
        assert.deepEqual(inspected.scene.inspector.interfaceMembers.map(member => member.id), expected.map(endpoint => endpoint.id),
            `${parent.ownerInstanceId}:${parent.interfacePath.join('.')}`);
    }
    assert.deepEqual(validateMembership(scene, { architecture }).findings, []);
    for (const child of scene.children) {
        assert.deepEqual(validateMembership(sceneFor(query, child.id), { architecture }).findings, []);
    }
    assert.equal(stable(input.analysis), original);
    assert.equal(stable(architecture.contacts), contacts);
    assert.equal(await fs.readFile(path.join(directory, 'RepeatedInterfaces.bsv'), 'utf8'), repeatedInterfaces);
});

test('actual workspace source membership and selected Memory root geometry agree with independent canonical authority',
    { skip: !process.env.G6_INTERFACE_SOURCE_ROOT && 'External actual-workspace input is supplied in the G6 workspace lane' }, async t => {
        const input = await loadNativeInput({ sourceRoot: process.env.G6_INTERFACE_SOURCE_ROOT });
        const architecture = createArchitecture({ analysis: input.analysis });
        const original = hash(stable(input.analysis)), rows = [];
        for (const query of input.catalog) {
            const overall = sceneFor(query);
            for (const scene of [overall, ...overall.children.map(child => sceneFor(query, child.id))]) {
                const membership = validateMembership(scene, { architecture });
                assert.deepEqual(membership.findings, [], scene.shell.label);
                const geometries = scene === overall && scene.shell.label === 'mkAquaMemorySubsystem'
                    ? [{ width: 512, height: 466 }, { width: 1140, height: 677 }].map(size => {
                        const geometry = layout(scene, size), result = validateGeometry(scene, geometry);
                        assert.deepEqual(result.findings, [], scene.shell.label);
                        return { size, result, nodes: geometry.nodes.length, contacts: geometry.contacts.length,
                            routes: geometry.routes.length, foldedLabels: geometry.labels.filter(label => label.foldedReason).length };
                    }) : [];
                rows.push({ ownerId: scene.ownerInstanceId, label: scene.shell.label, sceneId: scene.id,
                    contacts: scene.contacts.length, groups: scene.interfaceGroups.map(group => ({ id: group.id,
                        ownerId: group.ownerId, interfacePath: group.interfacePath, memberContactIds: group.memberContactIds })), membership, geometries });
            }
        }
        assert.equal(rows.filter(row => row.geometries.length === 2).length, 1, 'The explicit Memory root must be present');
        for (const source of input.sources) assert.equal(hash(await fs.readFile(source.path, 'utf8')), source.revision);
        assert.equal(hash(stable(input.analysis)), original);
        const directory = createRun('interface-workspace');
        await fs.writeFile(path.join(directory, 'membership.json'), JSON.stringify({ sourceOnly: true, compilerExecuted: false,
            inputSummary: input.summary, analysisHash: original, rows }, null, 2) + '\n');
        t.diagnostic(`Read-only actual source membership evidence: ${directory}`);
    });
