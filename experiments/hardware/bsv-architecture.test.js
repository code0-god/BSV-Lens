'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { parseBsvFile } = require('../../src/architecture/parser');
const Adapter = require('./bsv-architecture');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function parsed(name) {
    const uri = `experiments/hardware/fixtures/${name}.bsv`;
    return parseBsvFile(fs.readFileSync(uri, 'utf8'), { uri, relativePath: uri });
}

test('real source seam: left is mkStage with declared state, typed put/get and no rule/child module', () => {
    const view = Adapter.buildBsvArchitecture({ parsedFiles: [parsed('Connected')] });
    const root = view.roots[0];
    const left = Adapter.getChildren(view, root).find(item => item.name === 'left');
    assert.equal(left.definitionId, 'def:Connected:mkStage');
    assert.deepEqual(Adapter.getChildren(view, left.id), []);
    const [state] = Adapter.getStorage(view, left.id);
    assert.equal(state.name, 'state');
    assert.equal(state.declaredType, 'Reg#(Bit#(8))');
    assert.deepEqual(Adapter.getBehavior(view, left.id).map(item => [item.kind, item.name]),
        [['method', 'put'], ['method', 'get']]);
    const ports = Adapter.getPorts(view, left.id).filter(item => item.kind === 'method-boundary');
    assert.deepEqual(ports.map(item => [item.name, item.methodKind, item.arguments, item.result]), [
        ['put', 'Action', [{ name: 'value', type: 'Bit#(8)' }], { status: 'none', type: null }],
        ['get', 'Value', [], { status: 'typed', type: 'Bit#(8)' }]
    ]);
    const write = Adapter.getRelations(view, left.id).find(item => item.kind === 'state-write');
    assert.equal(write.sourceEvidence[0].text, 'state <= value + 1;');
    assert.equal(write.sourceEvidence[0].sha256, hash('state <= value + 1;'));
});


const { buildSemanticModel } = require('../../src/architecture/semantic/model');
const { createCatalog } = require('./prototype/server');
const catalog = createCatalog();
const views = new Map();
function real(key) {
    if (!views.has(key)) views.set(key, Adapter.buildFromCatalog(catalog.find(build => build.key === key)));
    return views.get(key);
}
function source(text, entrypoints) {
    const uri = 'test-source.bsv';
    const parsedFiles = [parseBsvFile(text, { uri, relativePath: uri })];
    const semanticModel = buildSemanticModel(parsedFiles, entrypoints ? { entrypoints } : {});
    return Adapter.buildBsvArchitecture({ parsedFiles, semanticModel });
}
function at(view, path) { return Object.values(view.occurrences).find(item => item.path === path); }
function method(view, owner, name) { return Adapter.getPorts(view, owner.id).find(item => item.kind === 'method-boundary' && item.name === name); }
function all(view) { return ['occurrences', 'storage', 'boundaries', 'behaviors', 'relations'].flatMap(key => Object.values(view[key])); }

for (const [key, counts] of [['A', [3, 2, 6, 6]], ['B', [1, 2, 2, 5]], ['C', [7, 4, 14, 10]]]) {
    test(`${key}: real preserved catalog produces canonical source identities and independently checked exact slices`, () => {
        const build = catalog.find(item => item.key === key);
        assert.equal(build.status, 'ready');
        const before = JSON.stringify(build.model);
        const view = real(key);
        assert.equal(JSON.stringify(build.model), before);
        assert.equal(view.snapshotId, build.model.snapshot.id);
        assert.deepEqual([Object.keys(view.occurrences).length, Object.keys(view.storage).length,
            Object.values(view.boundaries).filter(item => item.kind === 'method-boundary').length, Object.keys(view.behaviors).length], counts);
        assert.equal(Object.keys(view).includes('nodes'), false);
        assert.equal(Object.keys(view).includes('edges'), false);
        const ids = new Set();
        const sourceIds = new Set([...view.sourceModel.sourceReferences.map(item => item.id),
            ...view.sourceModel.statements.map(item => item.id), ...view.sourceSupplements.map(item => item.id)]);
        for (const item of all(view)) {
            assert.ok(!ids.has(item.id)); ids.add(item.id);
            assert.notEqual(item.id, item.definitionId);
            assert.ok(sourceIds.has(item.definitionId), `${item.kind} definition anchor ${item.definitionId}`);
            assert.ok(view.occurrences[item.ownerOccurrenceId]);
            for (const evidence of [...item.sourceEvidence, ...(item.explicitPredicate?.sourceEvidence || []),
                ...(item.bodyPathConditions || []).flatMap(condition => condition.sourceEvidence)]) {
                const original = build.sourceFiles.get(evidence.pathRef);
                assert.equal(hash(original.text), evidence.revision);
                const lines = original.text.split('\n');
                const range = evidence.sourceRange;
                const offset = (line, col) => lines.slice(0, line).reduce((n, text) => n + text.length + 1, 0) + col;
                assert.deepEqual(evidence.range, { start: offset(range.line, range.column), end: offset(range.endLine, range.endColumn) });
                assert.equal(original.text.slice(evidence.range.start, evidence.range.end), evidence.text);
                assert.equal(hash(evidence.text), evidence.sha256);
            }
        }
        assert.ok(Adapter.validateBsvArchitecture(JSON.parse(JSON.stringify(view))));
        const metadata = JSON.parse(fs.readFileSync(`docs/hardware/evidence/toolchain/${key}/bluetcl.json`, 'utf8'));
        for (const item of all(view)) for (const ref of item.compilerConfirmation.evidence) {
            assert.equal(hash(fs.readFileSync(ref.pathRef)), ref.hash);
            let record = metadata;
            for (const token of ref.pointer.slice(1).split('/')) record = record[token];
            assert.ok(record);
        }
    });
}

test('constant returns never fabricate a call or payload wiring from constructor/type/method names', () => {
    const view = source(`package Negative;
interface Port; method Bit#(8) get; endinterface
module mkLeaf(Port); method Bit#(8) get = 7; endmodule
module mkWrapper#(Port same)(Port); method Bit#(8) get = 42; endmodule
module mkTop(Port);
  Port same <- mkLeaf;
  Port wrapper <- mkWrapper(same);
  method Bit#(8) get = 9;
endmodule
endpackage`);
    const relations = Object.values(view.relations);
    assert.equal(relations.filter(item => item.kind === 'constructor-binding').length, 1);
    assert.deepEqual(relations.filter(item => ['invocation', 'argument-flow', 'result-flow'].includes(item.kind)), []);
    assert.ok(relations[0].sourceEvidence[0].text.includes('mkWrapper(same)'));
});

test('real constructor actual-to-formal call resolves only in its owner occurrence/root', () => {
    const view = source(`package Scoped;
interface Port; method Bit#(8) get; endinterface
module mkLeaf(Port); method Bit#(8) get = 7; endmodule
module mkWrapper#(Port inputPort)(Port); method Bit#(8) get = inputPort.get; endmodule
module mkFirst(Port); Port data <- mkLeaf; Port wrapper <- mkWrapper(data); method Bit#(8) get = wrapper.get; endmodule
module mkSecond(Port); Port data <- mkLeaf; Port wrapper <- mkWrapper(data); method Bit#(8) get = wrapper.get; endmodule
endpackage`);
    assert.equal(view.roots.length, 2);
    const first = at(view, 'mkFirst'), second = at(view, 'mkSecond');
    const data1 = Adapter.getChildren(view, first.id).find(item => item.name === 'data');
    const data2 = Adapter.getChildren(view, second.id).find(item => item.name === 'data');
    assert.equal(data1.definitionId, data2.definitionId);
    assert.notEqual(data1.id, data2.id);
    const wrapper = at(view, 'mkFirst.wrapper');
    const call = Adapter.getRelations(view, wrapper.id).find(item => item.kind === 'invocation');
    assert.equal(view.boundaries[call.toId].ownerOccurrenceId, data1.id);
    const mutated = structuredClone(view);
    mutated.relations[call.id].toId = method(view, data2, 'get').id;
    assert.throws(() => Adapter.validateBsvArchitecture(mutated), /Cross-root/);
});

test('unknown/composite methods retain arguments/results; ActionValue is not Action or no-payload', () => {
    const view = source(`package Types;
interface Types;
  method ActionValue#(Maybe#(Bit#(8))) transact(Bit#(8) address, Mystery payload);
  method Mystery mystery;
  method Action ping;
endinterface
module mkTypes(Types);
  method ActionValue#(Maybe#(Bit#(8))) transact(Bit#(8) address, Mystery payload); return tagged Invalid; endmethod
  method Mystery mystery = ?;
  method Action ping; noAction; endmethod
endmodule
endpackage`);
    const owner = at(view, 'mkTypes');
    const transaction = method(view, owner, 'transact'), unknown = method(view, owner, 'mystery');
    assert.equal(transaction.methodKind, 'ActionValue');
    assert.deepEqual(transaction.arguments, [{ name: 'address', type: 'Bit#(8)' }, { name: 'payload', type: 'Mystery' }]);
    assert.equal(transaction.result.type, 'Maybe#(Bit#(8))');
    assert.notEqual(unknown.payload.status, 'none');
    assert.notEqual(unknown.result.status, 'none');
    assert.equal(method(view, owner, 'ping').result.status, 'none');
    assert.ok(Adapter.getPorts(view, owner.id).every(item => !item.rtlSignals.length));
});

test('typed instantiation is contextual and generic inlined state declaration remains symbolic', () => {
    const view = real('C');
    const narrow = at(view, 'mkReuse.narrow'), wide = at(view, 'mkReuse.wide');
    const narrowImpl = Adapter.getChildren(view, narrow.id)[0], wideImpl = Adapter.getChildren(view, wide.id)[0];
    assert.equal(narrowImpl.definitionId, wideImpl.definitionId);
    assert.notEqual(narrowImpl.id, wideImpl.id);
    assert.equal(narrowImpl.declaredType, 'inferred');
    assert.deepEqual(Adapter.getBehavior(view, narrow.id), []);
    assert.deepEqual(Adapter.getBehavior(view, wide.id), []);
    assert.equal(method(view, narrow, 'get').result.type, 'Bit#(8)');
    assert.equal(method(view, wide, 'get').result.type, 'Bit#(12)');
    assert.equal(method(view, narrowImpl, 'get').result.type, 'Bit#(8)');
    assert.equal(method(view, wideImpl, 'get').result.type, 'Bit#(12)');
    const s8 = Adapter.getStorage(view, narrowImpl.id)[0], s12 = Adapter.getStorage(view, wideImpl.id)[0];
    assert.equal(s8.definitionId, s12.definitionId);
    assert.equal(s8.declaredType, 'Reg#(Bit#(width))');
    assert.equal(s12.declaredType, 'Reg#(Bit#(width))');
    assert.equal(s8.compilerType, 'Reg#(Bit#(8))');
    assert.equal(s12.compilerType, 'Reg#(Bit#(12))');
    assert.equal(Adapter.getRelations(view, narrow.id).filter(item => item.kind === 'forwarding').length, 1);
    assert.equal(Adapter.getRelations(view, wide.id).filter(item => item.kind === 'forwarding').length, 1);
    for (const impl of [narrowImpl, wideImpl]) {
        const context = Adapter.getRtlContext(view, impl.id);
        assert.equal(context.status, 'candidate');
        assert.equal(context.implementationOccurrenceId, null);
        assert.equal(context.contextOccurrenceId, Adapter.getRtlContext(view, impl.parentId).implementationOccurrenceId);
        assert.deepEqual(context.highlightEntityIds, []);
        assert.equal(impl.rtlCorrespondence.status, 'unmapped');
    }
    const low = at(view, 'mkReuse.low'), high = at(view, 'mkReuse.high');
    assert.equal(low.definitionId, high.definitionId);
    assert.deepEqual(low.constructorArguments, ['3']);
    assert.deepEqual(high.constructorArguments, ['9']);
    assert.notEqual(low.rtlContext.implementationOccurrenceId, high.rtlContext.implementationOccurrenceId);
    assert.equal(view.coverage.methodGeneratedPorts, 25);
});

test('explicit predicates remain distinct from nested body conditions, including negated else paths', () => {
    const view = source(`package Paths;
interface Ports; method Action put(Bit#(8) x); endinterface
module mkPaths(Ports);
  Reg#(Bit#(8)) state <- mkReg(0);
  method Action put(Bit#(8) x) if (state < 7);
    if (x > 2) begin
      if (x < 6) state <= x;
      else state <= 6;
    end else state <= 0;
  endmethod
endmodule
endpackage`);
    const writes = Object.values(view.relations).filter(item => item.kind === 'state-write');
    assert.equal(writes.length, 3);
    assert.ok(writes.every(item => item.explicitPredicate.text === 'state < 7'));
    const byStatement = new Map(writes.map(item => [item.sourceEvidence[0].text, item]));
    assert.deepEqual(byStatement.get('state <= x;').bodyPathConditions.map(item => [item.text, item.polarity]), [['x > 2', true], ['x < 6', true]]);
    assert.deepEqual(byStatement.get('state <= 6;').bodyPathConditions.map(item => [item.text, item.polarity]), [['x > 2', true], ['x < 6', false]]);
    assert.deepEqual(byStatement.get('state <= 0;').bodyPathConditions.map(item => [item.text, item.polarity]), [['x > 2', false]]);
    const control = real('B');
    const decrement = Adapter.getBehavior(control, control.roots[0]).find(item => item.name === 'decrement');
    assert.equal(decrement.explicitPredicate.text, 'count > 0 && phase');
    assert.ok(Adapter.getRelations(control, decrement.id).every(item => item.bodyPathConditions.length === 0));
});

test('interface forwarding and subinterfaces remain typed boundaries, not fake child modules', () => {
    const view = source(`package Nested;
interface Port; method Bit#(8) get; endinterface
interface Outer; interface Port data; endinterface
module mkLeaf(Port); method Bit#(8) get = 1; endmodule
module mkOuter(Outer); Port child <- mkLeaf; interface data = child; endmodule
endpackage`);
    const root = view.roots[0];
    assert.equal(Adapter.getChildren(view, root).length, 1);
    assert.ok(Adapter.getPorts(view, root).some(item => item.kind === 'subinterface-boundary' && item.name === 'data'));
    const [forward] = Adapter.getRelations(view, root).filter(item => item.kind === 'forwarding');
    assert.equal(forward.sourceEvidence[0].text, 'interface data = child;');
    assert.equal(view.boundaries[forward.toId].name, 'data');
});

test('only declared storage is projected; functions/operations and unclassified cells never become modules', () => {
    const view = source(`package Storage;
interface Empty; endinterface
function Bit#(8) plusOne(Bit#(8) x); return x + 1; endfunction
module mkStorage(Empty);
  Reg#(Bit#(8)) state <- mkReg(0);
  FIFO#(Bit#(8)) queue <- mkFIFO;
  RegFile#(Bit#(8), Bit#(8)) memory <- mkRegFileFull;
  Wire#(Bit#(8)) wireValue <- mkWire;
  rule tick; state <= plusOne(state); endrule
endmodule
endpackage`);
    assert.equal(Object.keys(view.occurrences).length, 1);
    assert.deepEqual(Adapter.getStorage(view, view.roots[0]).map(item => item.primitiveKind), ['register', 'fifo', 'memory']);
    assert.equal(Adapter.getChildren(view, view.roots[0]).length, 0);
    assert.ok(view.sourceModel.definitions.some(item => item.kind === 'function-definition'));
    assert.ok(view.gaps.some(item => item.code === 'non-storage-primitive'));
});

test('compiler source/hash/occurrence mismatches never become name-only confirmations', () => {
    const build = catalog.find(item => item.key === 'A');
    const pathRef = 'docs/hardware/evidence/toolchain/A/bluetcl.json';
    const text = fs.readFileSync(pathRef, 'utf8');
    const options = { parsedFiles: [parsed('Connected')], compilerMetadata: text,
        compilerArtifact: { pathRef, hash: hash(text), sourceInputs: build.model.snapshot.sourceInputs } };
    assert.throws(() => Adapter.buildBsvArchitecture({ ...options, compilerMetadata: `${text} ` }), /hash mismatch/);
    assert.throws(() => Adapter.buildBsvArchitecture({ ...options,
        compilerArtifact: { ...options.compilerArtifact, sourceInputs: [] } }), /source revision/);
    const metadata = JSON.parse(text);
    metadata.hierarchy.find(item => item.Name === 'left').position = 'experiments/hardware/fixtures/Connected.bsv 21 10';
    const altered = JSON.stringify(metadata);
    const view = Adapter.buildBsvArchitecture({ ...options, compilerMetadata: altered,
        compilerArtifact: { ...options.compilerArtifact, hash: hash(altered) } });
    assert.equal(at(view, 'mkConnected.left').compilerConfirmation.status, 'source-only');
    assert.equal(Adapter.getStorage(view, at(view, 'mkConnected.left').id)[0].compilerConfirmation.status, 'source-only');
});

test('method result -> compiler port -> ordered boundary -> real net/pin chain is not leaf cause', () => {
    const view = real('A'), build = catalog.find(item => item.key === 'A');
    const left = at(view, 'mkConnected.left'), get = method(view, left, 'get');
    const signal = get.rtlSignals.find(item => item.role === 'result');
    assert.equal(signal.status, 'verified-port-net');
    assert.equal(signal.port, 'get');
    const port = build.model.ports[signal.implementationPortId];
    assert.deepEqual(signal.bitIds, port.bits);
    const child = build.model.occurrences[left.rtlContext.implementationOccurrenceId];
    const bindings = child.boundaries.map(id => build.model.boundaries[id]).filter(binding => binding.portId === port.id).sort((a, b) => a.index - b.index);
    assert.equal(bindings.length, 8);
    for (const [index, binding] of bindings.entries()) {
        assert.equal(binding.formalBitId, signal.bitIds[index]);
        const bit = build.model.bits[binding.actualBitId];
        const actualLeafPins = bit.endpoints.filter(endpoint => endpoint.kind === 'pin')
            .map(endpoint => build.model.pins[endpoint.entityId]).filter(pin => !build.model.cells[pin.cellId].childOccurrenceId);
        assert.ok(actualLeafPins.length > 0);
        for (const pin of actualLeafPins) assert.equal(pin.occurrenceId, child.parentId);
    }
    assert.equal(get.rtlCorrespondence.status, 'verified-port-contract');
    assert.equal(Adapter.getStorage(view, left.id)[0].rtlCorrespondence.status, 'unmapped');
    assert.equal(view.coverage.sourceExpressionLeafCauses, 0);
    assert.deepEqual(Adapter.getRtlContext(view, get.id).highlightEntityIds, get.rtlCorrespondence.entityIds);
});

test('serialized evidence validator rejects altered hash/range and duplicate occurrence identity', () => {
    const view = structuredClone(real('A'));
    const owner = at(view, 'mkConnected.left');
    view.occurrences[owner.id].sourceEvidence[0].text = 'invented';
    assert.throws(() => Adapter.validateBsvArchitecture(view), /Source evidence mismatch/);
    const duplicate = structuredClone(real('A'));
    const storage = Object.values(duplicate.storage)[0];
    storage.id = storage.definitionId;
    assert.throws(() => Adapter.validateBsvArchitecture(duplicate), /identity/);
});


test('incompatible declared instantiation and compiler specialization cannot silently replace source types', () => {
    const view = source(`package WrongType;
interface Port#(numeric type n); method Bit#(n) get; endinterface
module mkEight(Port#(8)); method Bit#(8) get = 1; endmodule
module mkTop(Port#(12)); Port#(12) child <- mkEight; method Bit#(12) get = 0; endmodule
endpackage`);
    const child = at(view, 'mkTop.child');
    assert.equal(child.typeResolutionStatus, 'mismatch');
    assert.equal(method(view, child, 'get').typeResolutionStatus, 'mismatch');
    const build = catalog.find(item => item.key === 'C');
    const pathRef = 'docs/hardware/evidence/toolchain/C/bluetcl.json';
    const metadata = JSON.parse(fs.readFileSync(pathRef, 'utf8'));
    metadata.hierarchy.find(item => item.Name === 'low').Interface = 'Reuse::Sample#(12)';
    const text = JSON.stringify(metadata);
    const altered = Adapter.buildBsvArchitecture({ parsedFiles: [parsed('Reuse')], compilerMetadata: text,
        compilerArtifact: { pathRef, hash: hash(text), sourceInputs: build.model.snapshot.sourceInputs } });
    const low = at(altered, 'mkReuse.low');
    assert.equal(method(altered, low, 'put').arguments[0].type, 'Bit#(8)');
    assert.equal(low.compilerConfirmation.status, 'conflict');
});

test('same-root endpoint substitution cannot turn a real source call into name-only wiring', () => {
    const view = structuredClone(real('A'));
    const root = at(view, 'mkConnected');
    const left = at(view, 'mkConnected.left'), right = at(view, 'mkConnected.right');
    const call = Adapter.getRelations(view, root.id).find(item => item.kind === 'invocation' && item.toId === method(view, left, 'put').id);
    view.relations[call.id].toId = method(view, right, 'put').id;
    assert.throws(() => Adapter.validateBsvArchitecture(view), /Canonical binding target/);
});
