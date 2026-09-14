'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const hardware = require('../src/hardware');
const correspondence = require('../src/hardware/correspondence');
const { hash, stable } = require('../src/hardware/json');
const { createSceneQuery } = require('../src/hardware/scene-query');

async function directory() {
    const runs = path.resolve(__dirname, '../.build/hardware/runs');
    await fs.mkdir(runs, { recursive: true });
    const output = path.join(await fs.mkdtemp(path.join(runs, 'g6-native-scene-')), 'g6');
    await fs.mkdir(output); return output;
}
async function sourceCase(text) {
    const output = await directory(), file = path.join(output, 'Input.bsv');
    await fs.writeFile(file, text);
    const registry = hardware.createArtifactRegistry({ artifactRoots: [output], sourceRoots: [output] });
    const source = { pathRef: 'Input.bsv', contentHash: hash(text), revision: hash(text) };
    await registry.registerSource({ ...source, path: file, capture: true });
    const analysis = await correspondence.attachCorrespondence({ registry, sources: [source] });
    return { analysis, query: createSceneQuery({ buildId: 'source-input', label: 'Source input', analysis }) };
}
function request(query, extra = {}) {
    const entry = query.getCatalogEntry();
    return { buildId: entry.buildId, snapshotId: entry.snapshotId, queryGeneration: 1, ...extra };
}

test('native source-only scene uses genuine source analysis and preserves null hardware scope', async () => {
    const text = await fs.readFile(path.resolve(__dirname, '../experiments/hardware/fixtures/Connected.bsv'), 'utf8');
    const { analysis, query } = await sourceCase(text), original = stable(analysis);
    const overall = query.getScene(request(query)).scene;
    assert.equal(overall.sceneKind, 'bsv');
    assert.equal(overall.snapshotId, null);
    assert.equal(overall.presentationIdentity, `source-model-${analysis.sourceModelIdentity}`);
    assert.deepEqual(overall.children.map(c => c.label), ['left', 'right']);
    assert.equal(overall.provenance.artifact, null);
    assert.equal(overall.capabilities.methodPortConnectivity, false);
    assert.equal(overall.implementationContext.contextOccurrenceId, null);
    const left = overall.children[0], inside = query.getScene(request(query, { rootInstanceId: left.id })).scene;
    assert.equal(inside.shell.id, left.id);
    assert.ok(inside.contacts.some(c => c.label === 'put'));
    assert.ok(inside.contacts.some(c => c.label === 'get'));
    const state = inside.storages[0];
    const selected = query.getScene(request(query, { rootInstanceId: left.id, selectedEntityId: state.id })).scene;
    assert.equal(selected.inspector.implementationAction, null);
    const context = query.getAnalysisContext('stock');
    const result = await query.analyze({ kind: 'state-accesses', analysisId: context.analysisId,
        snapshotId: null, implementationProvider: 'stock', queryGeneration: 2, ownerInstanceId: left.id,
        implementationOccurrenceId: null, seed: { entityId: state.id }, scope: { kind: 'source-only', rootOccurrenceId: null } });
    assert.equal(result.status, 'complete');
    assert.equal(result.readers.length, 1); assert.equal(result.writers.length, 1);
    for (const ref of result.sourceRefs) assert.equal(query.getSource(ref).text, text.slice(ref.range.start, ref.range.end));
    assert.throws(() => query.getScene(request(query, { sceneKind: 'rtl' })), { code: 'UNAVAILABLE' });
    assert.throws(() => query.getScene(request(query, { snapshotId: 'foreign' })), { code: 'SNAPSHOT_MISMATCH' });
    assert.equal(stable(analysis), original);
});

test('multiple independent source roots require explicit selection and never create cross-root wires', async () => {
    const { analysis, query } = await sourceCase('package Multi;\nmodule mkOne(Empty); endmodule\nmodule mkTwo(Empty); endmodule\nendpackage\n');
    const roots = query.getRootCandidates();
    assert.deepEqual(roots.map(r => r.label), ['mkOne', 'mkTwo']);
    assert.equal(query.getCatalogEntry().rootInstanceId, null);
    assert.throws(() => query.getScene(request(query)), { code: 'AMBIGUOUS_ROOT' });
    for (const root of roots) {
        const scene = query.getScene(request(query, { rootInstanceId: root.id })).scene;
        assert.equal(scene.shell.id, root.id); assert.equal(scene.children.length, 0); assert.equal(scene.connections.length, 0);
    }
    const explicit = createSceneQuery({ buildId: 'source-input', label: 'Source input', analysis, defaultRootInstanceId: roots[1].id });
    assert.equal(explicit.getScene(request(explicit)).scene.shell.id, roots[1].id);
    assert.throws(() => createSceneQuery({ buildId: 'bad', label: 'Bad', analysis, defaultRootInstanceId: 'foreign' }), { code: 'INVALID_INPUT' });
});

test('source module families expose dimensions and an honest symbolic element scope', async () => {
    const text = `package Families;
interface ChildIfc;
endinterface
module mkChild(ChildIfc);
  Reg#(Bool) active <- mkReg(False);
endmodule
module mkTop#(numeric type n)(Empty);
  Vector#(n, Vector#(2, ChildIfc)) elements <- replicateM(replicateM(mkChild));
endmodule
endpackage
`;
    const { query } = await sourceCase(text);
    const overall = query.getScene(request(query)).scene;
    const family = overall.children.find((item) => item.label === 'elements');
    assert.equal(family.family.kind, 'module-family');
    assert.equal(family.secondaryLabel, 'mkChild · n × 2');
    const selected = query.getScene(request(query, { selectedEntityId: family.id })).scene;
    const section = selected.inspector.sections.find((item) => item.id === 'family');
    assert.deepEqual(section.fields.map(({ label, value }) => [label, value]), [
        ['Kind', 'Module family'],
        ['Dimensions', 'n × 2'],
        ['Element type', 'ChildIfc'],
        ['Element count', 'Symbolic'],
        ['Element scope', 'Symbolic element; concrete index unavailable'],
        ['Element identity', 'elements[*][*]'],
        ['Index domain', '[0, n) symbolic × [0, 2)']
    ]);
    const inside = query.getScene(request(query, { rootInstanceId: family.id })).scene;
    assert.deepEqual(inside.projection.familyScope, {
        familyInstanceId: family.id,
        kind: 'symbolic-element',
        dimensions: ['n', '2'],
        indexDomains: [
            { expression: 'n', status: 'symbolic', min: 0, maxExclusive: null },
            { expression: '2', status: 'concrete', min: 0, maxExclusive: 2 }
        ],
        selectedIndices: null,
        elementIdentity: `${family.id}[*][*]`,
        elementLabel: 'elements[*][*]',
        elementType: 'ChildIfc'
    });
    assert.equal(inside.shell.label, 'elements[*][*]');
    assert.equal(inside.breadcrumb.at(-1).label, 'elements[*][*]');
    assert.throws(() => query.getScene(request(query, { rootInstanceId: family.id,
        disclosureState: { presentation: { familyElementIndices: [0, 0] } } })), { code: 'INVALID_INPUT' });
    assert.deepEqual(inside.storages.map((item) => item.label), ['active']);
});

test('exact repeated module families select bounded elements without changing canonical ownership', async () => {
    const text = `package Families;
interface ChildIfc;
endinterface
module mkChild(ChildIfc);
  Reg#(Bool) active <- mkReg(False);
endmodule
module mkTop(Empty);
  Vector#(2, Vector#(3, ChildIfc)) elements <- replicateM(replicateM(mkChild));
endmodule
endpackage
`;
    const { query } = await sourceCase(text);
    const overall = query.getScene(request(query)).scene;
    const family = overall.children.find(item => item.label === 'elements');
    const disclosureState = { presentation: { familyElementIndices: [1, 2] } };
    const element = query.getScene(request(query, { rootInstanceId: family.id, disclosureState })).scene;
    assert.equal(element.ownerInstanceId, family.id);
    assert.equal(element.shell.id, family.id);
    assert.equal(element.shell.label, 'elements[1][2]');
    assert.equal(element.projection.familyScope.kind, 'indexed-representative');
    assert.equal(element.projection.familyScope.elementIdentity, `${family.id}[1][2]`);
    assert.deepEqual(element.projection.familyScope.selectedIndices, [1, 2]);
    assert.deepEqual(JSON.parse(JSON.stringify(element.disclosureState)), disclosureState);
    assert.throws(() => query.getScene(request(query, { rootInstanceId: family.id,
        disclosureState: { presentation: { familyElementIndices: [2, 0] } } })), { code: 'INVALID_INPUT' });
});

async function artifactCase() {
    const output = await directory();
    const leaf = { ports: { p: { direction: 'input', bits: [2, 3] } }, cells: {}, netnames: {} };
    const top = name => ({ ports: { p: { direction: 'input', bits: [2, 3] } }, cells: {
        [name]: { type: 'Leaf', connections: { p: [2, 3] }, port_directions: { p: 'input' }, parameters: {}, attributes: {} }
    }, netnames: { p: { bits: [2, 3] } } });
    await fs.writeFile(path.join(output, 'design.json'), JSON.stringify({ modules: { TopOne: top('left'), TopTwo: top('right'), Leaf: leaf } }));
    const registry = hardware.createArtifactRegistry({ artifactRoots: [output] });
    await registry.registerArtifact({ pathRef: 'design.json', path: path.join(output, 'design.json') });
    const importResult = await hardware.importArtifact({ registry, artifactRef: 'design.json' });
    return { importResult, query: createSceneQuery({ buildId: 'artifact-input', label: 'Artifact input', importResult }) };
}
test('native artifact-only scenes preserve actual RTL roots, ordered bits and null BSV owner', async () => {
    const { importResult, query } = await artifactCase(), original = stable(importResult);
    const roots = query.getRootCandidates();
    assert.equal(roots.length, 2); assert.ok(roots.every(r => r.sceneKind === 'rtl'));
    assert.equal(query.getCatalogEntry().rootInstanceId, null);
    assert.throws(() => query.getScene(request(query)), { code: 'AMBIGUOUS_ROOT' });
    for (const root of roots) {
        const scene = query.getScene(request(query, { rootInstanceId: root.id })).scene;
        assert.equal(scene.sceneKind, 'rtl'); assert.equal(scene.ownerInstanceId, null); assert.equal(scene.sourceContext, null);
        assert.equal(scene.shell.id, root.id); assert.equal(scene.sourceRevision, null);
        assert.equal(scene.capabilities.sourceRanges, false); assert.equal(scene.sourceBreadcrumb.length, 0);
        assert.equal(scene.implementationContext.contextOccurrenceId, root.id);
        assert.ok(scene.children.every(c => c.ownerInstanceId === null));
        const pin = scene.contacts.find(p => p.ownerId === root.id);
        assert.deepEqual(pin.rawBits, [2, 3]);
        const selected = query.getScene(request(query, { rootInstanceId: root.id, selectedEntityId: pin.id })).scene;
        assert.equal(selected.inspector.sourceRefs.length, 0);
        const context = query.getAnalysisContext('stock');
        const result = await query.analyze({ kind: 'same-net', analysisId: context.analysisId, snapshotId: context.snapshotId,
            implementationProvider: 'stock', queryGeneration: 3, ownerInstanceId: null, implementationOccurrenceId: root.id,
            seed: { entityId: pin.id, indices: [1, 0, 1] }, scope: { kind: 'subtree', rootOccurrenceId: root.id } });
        assert.deepEqual(result.seed.positions.map(p => p.index), [1, 0, 1]);
        const child = scene.children[0];
        const entered = query.getScene(request(query, { rootInstanceId: root.id,
            implementationContext: { snapshotId: context.snapshotId, contextOccurrenceId: child.id } })).scene;
        assert.equal(entered.shell.id, child.id); assert.equal(entered.implementationContext.parentOccurrenceId, root.id);
        assert.equal(entered.rootInstanceId, root.id);
        const childPort = importResult.implementation.occurrences[child.id].ports[0];
        const revealRequest = { buildId: 'artifact-input', snapshotId: context.snapshotId, queryGeneration: 4,
            implementationProvider: 'stock', rootInstanceId: root.id, ownerInstanceId: null,
            target: { entityId: childPort, occurrenceId: child.id, snapshotId: context.snapshotId, provider: 'stock' } };
        const reveal = query.revealAnalysisTarget(revealRequest);
        assert.equal(reveal.status, 'resolved'); assert.equal(reveal.intent.ownerInstanceId, null);
        assert.equal(query.getScene(reveal.intent).scene.selection.selectedEntityId, childPort);
        assert.throws(() => query.revealAnalysisTarget({ ...revealRequest, snapshotId: 'foreign' }), { code: 'SNAPSHOT_MISMATCH' });
        assert.throws(() => query.revealAnalysisTarget({ ...revealRequest, target: { ...revealRequest.target, provider: 'instrumented' } }), { code: 'INVALID_INPUT' });
        const other = roots.find(r => r.id !== root.id);
        assert.equal(query.revealAnalysisTarget({ ...revealRequest, rootInstanceId: other.id }).status, 'unavailable');
        assert.throws(() => query.getScene(request(query, { rootInstanceId: root.id, selectedEntityId: importResult.implementation.occurrences[other.id].ports[0] })), { code: 'INVALID_INPUT' });
        assert.throws(() => query.getScene(request(query, { rootInstanceId: root.id, ownerInstanceId: root.id })), { code: 'INVALID_INPUT' });
    }
    assert.throws(() => query.getScene(request(query, { sceneKind: 'bsv', rootInstanceId: roots[0].id })), { code: 'UNAVAILABLE' });
    assert.equal(stable(importResult), original);
});

test('explicit retained RTL entry preserves its design root and real hierarchy without building the parent scene', async () => {
    const { importResult, query } = await artifactCase(), original = stable(importResult);
    const roots = query.getRootCandidates(), candidates = query.getEntryCandidates();
    assert.equal(candidates.status, 'complete'); assert.equal(candidates.entries.length, 4);
    assert.deepEqual(candidates.entries.filter(entry => entry.isDesignRoot).map(entry => entry.id), roots.map(root => root.id));
    const child = candidates.entries.find(entry => !entry.isDesignRoot);
    assert.equal(child.parentId, child.designRootId);
    assert.deepEqual(child.path, importResult.implementation.occurrences[child.id].path);
    const selected = createSceneQuery({ buildId: 'selected-module', label: 'Selected module', importResult, defaultRootInstanceId: child.id });
    const entry = selected.getCatalogEntry(); assert.equal(entry.rootInstanceId, child.designRootId); assert.equal(entry.entryOccurrenceId, child.id);
    assert.deepEqual(selected.getRootCandidates(), roots);
    const scene = selected.getScene(request(selected, { rootInstanceId: entry.rootInstanceId })).scene;
    assert.equal(scene.shell.id, child.id); assert.equal(scene.ownerInstanceId, null);
    assert.equal(scene.implementationContext.rootOccurrenceId, child.designRootId);
    assert.equal(scene.implementationContext.parentOccurrenceId, child.parentId);
    assert.equal(scene.implementationContext.contextOccurrenceId, child.id);
    const up = selected.getScene(request(selected, { rootInstanceId: entry.rootInstanceId,
        implementationContext: { snapshotId: entry.snapshotId, contextOccurrenceId: child.parentId } })).scene;
    assert.equal(up.shell.id, child.parentId);
    const pin = scene.contacts.find(item => item.ownerId === child.id), context = selected.getAnalysisContext('stock');
    const queryInput = { kind: 'same-net', analysisId: context.analysisId, snapshotId: entry.snapshotId,
        implementationProvider: 'stock', queryGeneration: 2, ownerInstanceId: null, implementationOccurrenceId: child.id,
        seed: { entityId: pin.id, indices: [1, 0, 1] }, scope: { kind: 'subtree', rootOccurrenceId: child.designRootId } };
    const { metrics: selectedMetrics, ...selectedResult } = await selected.analyze(queryInput);
    const { metrics: originalMetrics, ...originalResult } = await query.analyze(queryInput);
    assert.deepEqual(selectedResult, originalResult);
    for (const field of ['visitedBits', 'visitedPins', 'visitedCells', 'visitedEdges', 'maxHierarchyDepth'])
        assert.equal(selectedMetrics[field], originalMetrics[field]);
    assert.throws(() => createSceneQuery({ buildId: 'foreign', label: 'Foreign', importResult, defaultRootInstanceId: 'foreign' }), { code: 'INVALID_INPUT' });
    assert.equal(stable(importResult), original);
});

test('native scenes reject missing models and untrusted serialized source analysis', async () => {
    assert.throws(() => createSceneQuery({ buildId: 'missing', label: 'Missing' }), { code: 'INVALID_INPUT' });
    const { analysis } = await sourceCase('package One; module mkOne(Empty); endmodule endpackage');
    assert.throws(() => createSceneQuery({ buildId: 'fake', label: 'Fake', analysis: structuredClone(analysis) }), { code: 'INVALID_INPUT' });
});
