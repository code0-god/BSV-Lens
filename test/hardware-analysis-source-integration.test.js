'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const hardware = require('../src/hardware');
const stock = require('../src/hardware/correspondence');
const origin = require('../src/hardware/correspondence/origin');
const { buildSource } = require('../src/hardware/correspondence/source');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
const { loadOriginCase } = require('../experiments/hardware/g3/origin-query');
const oracle = require('../experiments/hardware/g5/source-reference.cjs');
const root = path.resolve(__dirname, '..');
const evidence = { schema: 'g5-source-integration-v1', cases: [], queries: [], mutations: [], documents: [] };
const cache = new Map(), originals = new Map();
const one = (items, predicate) => { const found = items.filter(predicate); assert.equal(found.length, 1); return found[0]; };
function raw(pathRef, revision) {
    const doc = oracle.document(pathRef, fs.readFileSync(path.join(root, pathRef)), revision);
    originals.set(pathRef, doc.revision); return doc;
}
const instance = (f, name) => one(f.model.instances, x => x.path === name);
const behavior = (f, owner, name) => one(f.model.stateBehaviors, x => x.ownerInstanceId === owner.id && x.name === name);
const endpoint = (f, owner, name) => one(f.model.endpoints, x => x.ownerInstanceId === owner.id && x.name === name);
// Product parsing is used only to build the SUBJECT and select its canonical IDs.
// No expected range, access set, condition, mapping or dependency is derived from it.
const record = (f, table, callable, text) => one(f.model[table], x => x.enclosingCallableId === callable && x.text === text);
async function fixture(key) {
    if (!cache.has(key)) cache.set(key, Promise.all([loadCapturedCase(key), loadOriginCase(key)]).then(([c, originCase]) => {
        const s = c.request.sources[0], doc = raw(s.pathRef, s.revision);
        const captured = one(originCase.request.files, x => x.kind === 'source' && path.basename(x.pathRef) === path.basename(doc.pathRef));
        const originDoc = raw(captured.pathRef, captured.contentHash); assert.deepEqual(doc.bytes, originDoc.bytes);
        const options = { importResult: c.request.importResult, analysis: c.analysis, originCase,
            sourceBindings: [{ sourcePathRef: doc.pathRef, sourceRevision: doc.revision, originPathRef: originDoc.pathRef, originRevision: originDoc.revision }] };
        return { key, ...options, request: c.request, doc, originDoc, model: c.analysis.sourceModel, api: hardware.createAnalysisQuery(options) };
    }));
    return cache.get(key);
}
function input(f, kind, entity, owner = null, extra = {}) {
    const provider = extra.implementationProvider || 'stock', context = f.api.getContext(provider);
    const model = (provider === 'stock' ? f.importResult : f.originCase?.request.importResult)?.implementation;
    // Only contextual IDs, not any expected semantics, are read from this join.
    const sourceContext = f.analysis?.correspondence.contexts.find(x => x.occurrenceId === owner?.id);
    const stockId = sourceContext?.contextOccurrenceId || sourceContext?.implementationOccurrenceId;
    const ownerPath = f.importResult?.implementation.occurrences[stockId]?.path;
    const occurrenceId = model ? one(Object.values(model.occurrences), x => JSON.stringify(x.path) === JSON.stringify(ownerPath)).id : null;
    return { kind, analysisId: context.analysisId, snapshotId: context.snapshotId, implementationProvider: provider,
        ownerInstanceId: owner?.id || null, implementationOccurrenceId: occurrenceId,
        seed: { entityId: entity.id, sourceRevision: f.doc.revision },
        scope: model ? { kind: 'design', rootOccurrenceId: model.roots[0] } : { kind: 'source-only', rootOccurrenceId: null },
        queryGeneration: 1, ...extra };
}
async function query(f, kind, entity, owner = null, extra = {}) {
    const request = input(f, kind, entity, owner, extra), result = await f.api.query(request);
    const name = `source-integration-query-${String(evidence.queries.length + 1).padStart(3, '0')}.json`;
    evidence.queries.push({ corpus: f.key, kind, entityId: entity.id, status: result.status, file: name });
    if (process.env.G5_OUTPUT_DIR) fs.writeFileSync(path.join(process.env.G5_OUTPUT_DIR, name), JSON.stringify({ input: request, result }, null, 2) + '\n', { flag: 'wx' });
    for (const ref of result.sourceRefs) oracle.assertSourceReference(ref, ref.pathRef === f.doc.pathRef ? f.doc : f.originDoc);
    return result;
}
function required(f, r, id, owner, text, within) {
    const expected = { pathRef: f.doc.pathRef, semanticId: id, ownerInstanceId: owner?.id || null, range: oracle.locate(f.doc, text, within) };
    oracle.assertSourceReferences(r.sourceRefs, [f.doc, ...(f.originDoc ? [f.originDoc] : [])], [expected]);
    return one(r.sourceRefs, x => x.pathRef === expected.pathRef && x.semanticId === id && x.ownerInstanceId === expected.ownerInstanceId);
}
function code(f, r, table, callable, text, within) {
    const item = one(r.code[table], x => x.enclosingCallableId === callable && x.text === text);
    oracle.assertCodeRecord(item, f.doc, oracle.locate(f.doc, text, within)); return item;
}
function mutation(name, code, action) { assert.throws(action, { code }); evidence.mutations.push({ name, code, status: 'rejected' }); }
function complete(name, requirements, domain) { evidence.cases.push({ name, requirements, domain, status: 'pass' }); }
function noCompilerSchedule(r) {
    assert.deepEqual(r.code.scheduling.compiler, { status: 'not-attached', relations: [] });
    assert.deepEqual(r.code.readiness, { status: 'not-attached', evidence: [] });
    assert.ok(r.code.scheduling.potentialDependencies.every(x => x.origin === 'source-heuristic' && x.confidence === 'potential'));
    assert.ok(r.relations.every(x => x.family === 'source'));
}

test('S01/S02/S07 actual A independently checks both storage owners, complete access sets and original RHS bytes', async () => {
    const f = await fixture('A'), span = oracle.section(f.doc, 'module mkStage(Stage);', 'endmodule');
    for (const name of ['left', 'right']) {
        const owner = instance(f, `mkConnected.${name}`), state = instance(f, `${owner.path}.state`);
        const r = await query(f, 'state-accesses', state, owner);
        assert.equal(r.status, 'complete');
        assert.deepEqual([r.code.storage.declaredType, r.code.storage.constructor, r.code.storage.defaultExpressions], ['Reg#(Bit#(8))', 'mkReg', ['0']]);
        assert.deepEqual(r.readers.map(x => [x.id, x.ownerInstanceId]), [[behavior(f, owner, 'get').id, owner.id]]);
        assert.deepEqual(r.writers.map(x => [x.id, x.ownerInstanceId]), [[behavior(f, owner, 'put').id, owner.id]]);
        assert.deepEqual(r.relations.map(x => [x.kind, x.from.entityId, x.to.entityId]).sort(), [
            ['read', state.id, behavior(f, owner, 'get').id], ['write', behavior(f, owner, 'put').id, state.id]]);
        required(f, r, state.id, owner, '\n   Reg#(Bit#(8)) state <- mkReg(0);', span);
        const statement = record(f, 'statements', 'def:Connected:mkStage.put', 'state <= value + 1;');
        required(f, r, statement.id, owner, 'state <= value + 1;', span);
        const put = await query(f, 'behavior', behavior(f, owner, 'put'), owner);
        const rhs = code(f, put, 'expressions', 'def:Connected:mkStage.put', 'value + 1', span);
        const ref = required(f, put, rhs.id, owner, 'value + 1', span);
        oracle.assertSignedConditions(put.conditions, { predicate: null, body: [] });
        const get = await query(f, 'behavior', behavior(f, owner, 'get'), owner);
        code(f, get, 'expressions', 'def:Connected:mkStage.get', 'state', oracle.locate(f.doc, 'method Bit#(8) get = state;', span));
        if (name === 'left') {
            const bad = structuredClone(ref), range = oracle.locate(f.doc, 'value', oracle.locate(f.doc, 'left.put(value);'));
            Object.assign(bad, { range: { ...range, text: 'value' }, text: 'value', sliceHash: oracle.sha256(Buffer.from('value')) });
            mutation('real-G5-self-consistent-caller-range-as-RHS', 'SOURCE_EXPECTED_POSITION', () => oracle.assertSourceReference(bad, f.doc, { range: oracle.locate(f.doc, 'value + 1', span) }));
            await assert.rejects(f.api.query(input(f, 'behavior', behavior(f, owner, 'put'), owner, { seed: { entityId: behavior(f, owner, 'put').id, sourceRevision: '0'.repeat(64) } })), { code: 'SOURCE_REVISION_MISMATCH' });
        }
    }
    complete('actual-A-storage', ['S01', 'S02', 'S07'], 'compiler-backed-A');
});

test('S01/S02/S08 actual B has exact guarded accesses, no body condition and missing scheduling is not no constraints', async () => {
    const f = await fixture('B'), owner = instance(f, 'mkControl');
    for (const [name, readers, writers, type, init] of [
        ['count', ['decrement', 'increment', 'inject', 'read'], ['decrement', 'increment', 'inject'], 'Bit#(8)', '0'],
        ['phase', ['decrement', 'tick'], ['tick'], 'Bool', 'False']
    ]) {
        const state = instance(f, `mkControl.${name}`), r = await query(f, 'state-accesses', state, owner);
        assert.deepEqual(r.readers.map(x => x.id).sort(), readers.map(n => behavior(f, owner, n).id).sort());
        assert.deepEqual(r.writers.map(x => x.id).sort(), writers.map(n => behavior(f, owner, n).id).sort());
        assert.ok([...r.readers, ...r.writers].every(x => x.ownerInstanceId === owner.id));
        required(f, r, state.id, owner, `\n   Reg#(${type}) ${name} <- mkReg(${init});`);
    }
    for (const [name, predicate, writes, reads, statement] of [
        ['tick', null, ['phase'], ['phase'], 'phase <= !phase;'],
        ['decrement', 'count > 0 && phase', ['count'], ['count', 'phase'], 'count <= count - 1;'],
        ['increment', 'count < 8', ['count'], ['count'], 'count <= count + 2;'],
        ['inject', 'count < 4', ['count'], ['count'], 'count <= value;'],
        ['read', null, [], ['count'], null]
    ]) {
        const b = behavior(f, owner, name), r = await query(f, 'behavior', b, owner);
        assert.deepEqual(r.code.behavior.reads, reads); assert.deepEqual(r.code.behavior.writes, writes);
        const p = predicate ? code(f, r, 'expressions', b.definitionId, predicate) : null;
        oracle.assertSignedConditions(r.conditions, { predicate: p ? { expressionId: p.id, evaluated: false } : null, body: [] });
        if (statement) code(f, r, 'statements', b.definitionId, statement);
        assert.deepEqual(r.code.assertions, []); noCompilerSchedule(r);
        // A shared count/phase dependency exists; an empty compiler list cannot mean no constraints.
        assert.ok(r.code.scheduling.potentialDependencies.length > 0);
        const corr = await query(f, 'correspondence', b, owner);
        oracle.assertClaims(corr.correspondence.origin.claims, origin.sourceToImplementation(f.originCase.analysis, { occurrencePath: ['mkControl'], contribution: 'known' }));
        assert.deepEqual(corr.correspondence.origin.claims, []);
    }
    complete('actual-B-guards-absence', ['S01', 'S02', 'S08', 'X02'], 'compiler-backed-B');
});

function expectedMethod(f, caller, consumer, producer, call, actual, producerExpression, calleeDefinition, calleeBehavior, producerBehavior) {
    return { resolution: 'exact', caller: { ownerInstanceId: caller.id, behaviorId: behavior(f, caller, 'put').id, definitionId: call.enclosingCallableId },
        consumer: { endpointId: endpoint(f, consumer, 'put').id, ownerInstanceId: consumer.id },
        callee: { ownerInstanceId: consumer.id, endpointId: endpoint(f, consumer, 'put').id, definitionId: calleeDefinition, behaviorId: calleeBehavior },
        actualToFormal: [{ actualExpressionId: actual.id, formalIndex: 0, formalName: 'value', ownerInstanceId: consumer.id }],
        producer: [{ endpointId: endpoint(f, producer, 'get').id, ownerInstanceId: producer.id, implementationBehaviorId: producerBehavior,
            expressionId: producerExpression.id, argumentExpressionId: actual.id, formalIndex: 0, resolution: 'exact' }],
        returnIds: [], returnAvailability: 'source-records', resultBindingId: null };
}
test('S03 actual A/C preserve caller, producer, consumer, actual/formal and canonical payload distinctions', async () => {
    for (const [key, top, consumerName, producerName, callText, actualText, calleeDefinition] of [
        ['A', 'mkConnected', 'right', 'left', 'right.put(left.get + value)', 'left.get + value', 'def:Connected:mkStage.put'],
        ['C', 'mkReuse', 'narrow', 'low', 'narrow.put(low.get)', 'low.get', null]
    ]) {
        const f = await fixture(key), caller = instance(f, top), consumer = instance(f, `${top}.${consumerName}`), producer = instance(f, `${top}.${producerName}`);
        const callable = key === 'A' ? 'def:Connected:mkConnected.put' : 'def:Reuse:mkReuse.put';
        const call = record(f, 'callSites', callable, callText), actual = record(f, 'expressions', callable, actualText);
        const producerExpression = record(f, 'expressions', callable, `${producerName}.get`);
        const r = await query(f, 'call-site', call, caller), m = one(r.callMappings, x => x.callSite.id === call.id);
        const expected = expectedMethod(f, caller, consumer, producer, call, actual, producerExpression, calleeDefinition,
            key === 'A' ? behavior(f, consumer, 'put').id : null, key === 'A' ? behavior(f, producer, 'get').id : null);
        // C preserves the generic interface contract; the existing resolver does
        // not establish a concrete method implementation from that contract.
        if (key === 'C') assert.equal(endpoint(f, producer, 'get').contractStatus, 'unresolved');
        oracle.assertCallContext(m, expected);
        oracle.assertCodeRecord(m.callSite, f.doc, oracle.locate(f.doc, callText));
        oracle.assertCodeRecord(m.actualToFormal[0].actual, f.doc, oracle.locate(f.doc, actualText, oracle.locate(f.doc, callText)));
        assert.deepEqual(m.actualToFormal[0].formal, { name: 'value', type: key === 'A' ? 'Bit#(8)' : 'Bit#(width)' });
        // Method contracts expose a type/name, not a fabricated formal source range.
        assert.equal(m.actualToFormal[0].formal.range, undefined);
        const header = oracle.locate(f.doc, key === 'A' ? 'method Action put(Bit#(8) value);' : 'method Action put(Bit#(width) value);',
            oracle.section(f.doc, key === 'A' ? 'interface Stage;' : 'interface Sample#(numeric type width);', 'endinterface'));
        assert.notDeepEqual(oracle.locate(f.doc, 'value', header), oracle.locate(f.doc, actualText, oracle.locate(f.doc, callText)));
        required(f, r, actual.id, caller, actualText, oracle.locate(f.doc, callText));
        const payloads = m.flows.filter(x => x.kind === 'payload');
        if (key === 'A') {
            assert.deepEqual(payloads, []);
            for (const [name, change] of [['caller-is-consumer', x => { x.caller.ownerInstanceId = consumer.id; }],
                ['producer-is-consumer', x => { x.producer[0].ownerInstanceId = consumer.id; }],
                ['wrong-formal-index', x => { x.actualToFormal[0].formalIndex = 1; }]]) {
                const bad = structuredClone(m); change(bad); mutation(`real-G5-${name}`, 'SOURCE_CALL_CONTEXT', () => oracle.assertCallContext(bad, expected));
            }
        } else {
            assert.equal(payloads.length, 1);
            oracle.assertPayload(payloads[0], { fromId: endpoint(f, producer, 'get').id, toId: endpoint(f, consumer, 'put').id,
                ownerInstanceId: caller.id, causeBehaviorId: behavior(f, caller, 'put').id, callSiteId: call.id,
                producerEndpointId: endpoint(f, producer, 'get').id, consumerEndpointId: endpoint(f, consumer, 'put').id,
                consumerArgumentIndex: 0, consumerArgumentName: 'value' });
        }
    }
    complete('actual-A-C-call-context', ['S03'], 'compiler-backed-A-C');
});

test('S01/X01/X02 actual C reused widths and biases retain original RHS with separate inlined owners', async () => {
    const f = await fixture('C'), refs = [];
    for (const [name, suffix, rhs, width, bias] of [['narrow', '.implementation', 'value + 1', '8', null],
        ['wide', '.implementation', 'value + 1', '12', null], ['low', '', 'value + bias', '8', '3'], ['high', '', 'value + bias', '8', '9']]) {
        const owner = instance(f, `mkReuse.${name}${suffix}`), b = behavior(f, owner, 'put');
        const r = await query(f, 'behavior', b, owner), span = oracle.section(f.doc, suffix ? 'module mkWidth(Sample#(width));' : 'module mkBiased#(parameter Bit#(8) bias)(Sample#(8));', 'endmodule');
        const expression = code(f, r, 'expressions', b.definitionId, rhs, span);
        refs.push(required(f, r, expression.id, owner, rhs, span));
        assert.equal(endpoint(f, owner, 'get').resultType, 'Bit#(width)');
        assert.equal(instance(f, `mkReuse.${name}`).type, `Sample#(${width})`);
        const model = f.importResult.implementation;
        const retained = one(Object.values(model.occurrences), o => o.path.join('.') === `mkReuse.${name}`);
        const get = one(retained.ports.map(id => model.ports[id]), p => p.name === 'get');
        assert.equal(get.bits.length, Number(width));
        if (bias) assert.deepEqual(r.code.owner.arguments, [bias]);
        const state = instance(f, `${owner.path}.state`), accesses = await query(f, 'state-accesses', state, owner);
        assert.deepEqual(accesses.readers.map(x => x.id), [behavior(f, owner, 'get').id]);
        assert.deepEqual(accesses.writers.map(x => x.id), [b.id]);
        required(f, accesses, state.id, owner, `\n   Reg#(Bit#(${suffix ? 'width' : '8'})) state <- mkReg(0);`, span);
        const corr = await query(f, 'correspondence', expression, owner);
        const direct = origin.sourceToImplementation(f.originCase.analysis, { occurrencePath: ['mkReuse', name], contribution: 'known' });
        const claims = direct.claims.filter(c => c.source.kind === 'rhs-binary');
        // The preserved capture covers mkWidth, not the parameterized mkBiased RHS.
        assert.equal(claims.length, suffix ? 1 : 0);
        oracle.assertClaims(corr.correspondence.origin.claims, { claims });
        for (const claim of claims) oracle.assertSourceReference(claim.source, f.originDoc, { range: oracle.locate(f.originDoc, rhs, span) });
        if (suffix) {
            const context = one(f.analysis.correspondence.contexts, c => c.occurrenceId === owner.id);
            assert.equal(context.implementationOccurrenceId, null); assert.deepEqual(context.ownedCellIds, []);
        }
    }
    assert.deepEqual(refs[0].range, refs[1].range); assert.notEqual(refs[0].ownerInstanceId, refs[1].ownerInstanceId); assert.notEqual(refs[0].id, refs[1].id);
    complete('actual-C-reuse', ['S01', 'X01', 'X02'], 'compiler-backed-C');
});

// Labeled synthetic source-only input: Unicode is before every interesting range;
// fixture semantics below are hand-authored and never inferred using a second parser.
const helperText = 'package Independent; // \uD55C\uD83D\uDE00e\u0301\r\n' + `function Bit#(8) inc(Bit#(8) x); return x + 1; endfunction
function Bit#(8) choose(Bit#(8) x, Bool flag);
  Bit#(8) y = x;
  begin Bit#(8) x = 9; y = inc(x); end
  if (flag) y = inc(y); else y = 3;
  return y;
endfunction
function Bit#(8) reassigned(Bit#(8) p); let x = p; x = 7; return x; endfunction
module mkTop(Empty);
  Reg#(Bit#(8)) r <- mkReg(0);
  rule go (r < 9);
    if (r > 2) r <= 1; else r <= 3;
    dynamicAssert(r != 5, "no");
    let a = inc(r); r <= a;
  endrule
endmodule
module mkForeign(Empty); rule idle; noAction; endrule endmodule
endpackage
`;
function synthetic(text = helperText, key = 'synthetic-unicode-helper') {
    const doc = oracle.document('synthetic/Independent.bsv', Buffer.from(text));
    const built = buildSource([{ pathRef: doc.pathRef, contentHash: doc.revision, text }]);
    const model = { ...built.semantic, sourceReferences: built.references, supplements: built.supplements };
    return { key, doc, model, api: hardware.createAnalysisQuery({ sourceModel: model }) };
}
test('S02/S04/S05/S07/S08 labeled synthetic Unicode/helper/shadow/reassignment/merge and signed guard/body semantics', async () => {
    const f = synthetic(), fn = one(f.model.functionDefinitions, x => x.name === 'choose');
    const r = await query(f, 'behavior', fn);
    assert.equal(r.context.snapshotId, null); assert.equal(r.context.modelId, null); assert.equal(r.code.owner, null);
    assert.equal(f.model.instances.some(x => x.targetDefinitionId === fn.id), false);
    const span = oracle.section(f.doc, 'function Bit#(8) choose', 'endfunction');
    const flag = code(f, r, 'expressions', fn.id, 'flag', oracle.locate(f.doc, 'if (flag)'));
    oracle.assertSignedConditions(r.conditions, { predicate: null, body: [
        { expressionId: flag.id, polarity: true, evaluated: false }, { expressionId: flag.id, polarity: false, evaluated: false }] });
    const inc = one(f.model.functionDefinitions, x => x.name === 'inc'), ret = record(f, 'statements', inc.id, 'return x + 1;');
    const incBody = await query(f, 'behavior', inc);
    const unicode = required(f, incBody, ret.id, null, 'return x + 1;');
    const proof = oracle.assertSourceReference(unicode, f.doc);
    assert.notEqual(proof.utf8.start, unicode.range.start); assert.notEqual(proof.codepoint.start, unicode.range.start);
    for (const [text, actualText] of [['inc(x)', 'x'], ['inc(y)', 'y']]) {
        const call = record(f, 'callSites', fn.id, text), actual = one(f.model.expressions, x => x.id === call.argumentExpressionIds[0]);
        const result = await query(f, 'call-site', call), m = result.callMappings[0];
        oracle.assertCallContext(m, { resolution: 'exact', caller: { ownerInstanceId: null, behaviorId: null, definitionId: fn.id }, consumer: null,
            callee: { ownerInstanceId: null, endpointId: null, definitionId: inc.id, behaviorId: null },
            actualToFormal: [{ actualExpressionId: actual.id, formalIndex: 0, formalName: 'x', ownerInstanceId: null }],
            producer: [], returnIds: [ret.id], returnAvailability: 'source-records', resultBindingId: null });
        oracle.assertCodeRecord(m.returns[0], f.doc, oracle.locate(f.doc, 'return x + 1;'));
        oracle.assertCodeRecord(m.actualToFormal[0].actual, f.doc, oracle.locate(f.doc, actualText, oracle.locate(f.doc, text, span)));
        const formal = m.actualToFormal[0].formal;
        assert.equal(formal.name, 'x'); assert.equal(formal.type, 'Bit#(8)');
        // Existing formal contracts carry name/type, not a standalone source range.
        // Actual argument and callee return ranges are checked above.
        assert.equal(formal.range, undefined);
    }
    const shadowCall = record(f, 'callSites', fn.id, 'inc(x)');
    const shadowActual = one(f.model.expressions, x => x.id === shadowCall.argumentExpressionIds[0]);
    const shadow = await query(f, 'source-dependencies', shadowActual);
    const declaration = code(f, r, 'statements', fn.id, 'Bit#(8) x = 9;', span);
    assert.deepEqual(shadow.code.dependencies[0].uses, [declaration.localSymbolId]);
    assert.deepEqual(shadow.code.expressions.map(x => x.text), ['x', '9']);
    const returned = record(f, 'statements', fn.id, 'return y;'), merge = await query(f, 'source-dependencies', returned);
    assert.equal(merge.status, 'partial'); assert.deepEqual(merge.code.expressions.map(x => x.text), ['y']);
    assert.deepEqual(merge.code.dependencies[0].definitions, []);
    assert.equal(merge.code.dependencies[0].bindingEnvironment.resolutionStatus, 'unresolved');
    assert.ok(merge.frontier.some(x => x.reason === 'unresolved-source'));
    const reassigned = one(f.model.functionDefinitions, x => x.name === 'reassigned');
    const reassignment = await query(f, 'source-dependencies', record(f, 'statements', reassigned.id, 'return x;'));
    assert.equal(reassignment.status, 'complete'); assert.deepEqual(reassignment.code.expressions.map(x => x.text), ['x', '7']);
    const owner = instance(f, 'mkTop'), b = behavior(f, owner, 'go'), guarded = await query(f, 'behavior', b, owner);
    const predicate = code(f, guarded, 'expressions', b.definitionId, 'r < 9'), condition = code(f, guarded, 'expressions', b.definitionId, 'r > 2');
    const expected = { predicate: { expressionId: predicate.id, evaluated: false }, body: [
        { expressionId: condition.id, polarity: true, evaluated: false }, { expressionId: condition.id, polarity: false, evaluated: false }] };
    oracle.assertSignedConditions(guarded.conditions, expected);
    assert.equal(guarded.code.assertions.length, 1); code(f, guarded, 'statements', b.definitionId, 'dynamicAssert(r != 5, "no");');
    assert.equal(guarded.code.stateEffects.length, 3); noCompilerSchedule(guarded);
    const elseWrite = code(f, guarded, 'statements', b.definitionId, 'r <= 3;');
    const elseDeps = await query(f, 'source-dependencies', elseWrite, owner);
    oracle.assertSignedConditions(elseDeps.conditions, { predicate: null, body: [expected.body[1]] });
    const bad = structuredClone(guarded.conditions); bad.body[1].polarity = true;
    mutation('real-G5-negated-body-polarity', 'SOURCE_POLARITY', () => oracle.assertSignedConditions(bad, expected));
    const direct = record(f, 'callSites', b.definitionId, 'inc(r)');
    const entered = await query(f, 'behavior', inc, owner, { seed: { entityId: inc.id, sourceRevision: f.doc.revision, entryCallSiteId: direct.id } });
    assert.equal(entered.code.entryCallMapping.caller.ownerInstanceId, owner.id);
    assert.equal(entered.code.entryCallMapping.caller.behaviorId, b.id);
    assert.equal(entered.code.entryCallMapping.callee.ownerInstanceId, null);
    for (const q of [input(f, 'behavior', inc, owner), input(f, 'behavior', inc, instance(f, 'mkForeign'), { seed: { entityId: inc.id, entryCallSiteId: direct.id } }),
        input(f, 'behavior', inc, owner, { seed: { entityId: inc.id, entryCallSiteId: shadowCall.id } })]) await assert.rejects(f.api.query(q), { code: 'INVALID_INPUT' });
    complete('synthetic-lexical', ['S02', 'S03', 'S04', 'S05', 'S07', 'S08'], 'synthetic-source-only');
});

test('S06/S07 captured and genuinely current snapshots separate stale disk revisions without modifying authoritative input', async t => {
    const f = synthetic(), fn = one(f.model.functionDefinitions, x => x.name === 'inc');
    const captured = await query(f, 'behavior', fn); assert.equal(captured.code.freshness.status, 'captured');
    const unavailable = await query(f, 'behavior', fn, null, { mode: 'current-source' }); assert.equal(unavailable.status, 'stale');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'g5-independent-current-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'Independent.bsv'); fs.writeFileSync(file, f.doc.bytes);
    const registry = hardware.createArtifactRegistry({ sourceRoots: [directory], artifactRoots: [directory] });
    const descriptor = { pathRef: f.doc.pathRef, contentHash: f.doc.revision, revision: f.doc.revision };
    await registry.registerSource({ ...descriptor, path: file, capture: true });
    const analysis = await stock.attachCorrespondence({ registry, sources: [descriptor] });
    const attached = { ...f, analysis, api: hardware.createAnalysisQuery({ analysis }) };
    const current = await query(attached, 'behavior', fn, null, { mode: 'current-source' });
    assert.equal(current.status, 'complete'); assert.equal(current.code.freshness.status, 'current');
    assert.deepEqual(current.sourceRefs, captured.sourceRefs);
    fs.writeFileSync(file, Buffer.concat([f.doc.bytes, Buffer.from('\n')]));
    const refreshed = await stock.refreshFreshness(analysis, registry);
    const changed = { ...f, analysis: refreshed, api: hardware.createAnalysisQuery({ analysis: refreshed }) };
    const stale = await query(changed, 'behavior', fn, null, { mode: 'current-source' });
    assert.equal(stale.status, 'stale'); assert.deepEqual(stale.sourceRefs, []);
    assert.ok(stale.frontier.some(x => x.reason === 'current-source-unavailable'));
    const retained = await query(changed, 'behavior', fn); assert.equal(retained.status, 'complete');
    assert.deepEqual(retained.sourceRefs, captured.sourceRefs);
    await assert.rejects(f.api.query(input(f, 'behavior', fn, null, { seed: { entityId: fn.id, sourceRevision: oracle.sha256(fs.readFileSync(file)) } })), { code: 'SOURCE_REVISION_MISMATCH' });
    complete('synthetic-freshness', ['S06', 'S07'], 'synthetic-source-only-real-registry');
});

test('S06/X01/X02 actual A G5 claims/explanations equal independently invoked G3 before/after real cone expansion', async () => {
    const f = await fixture('A'), owner = instance(f, 'mkConnected.left'), get = endpoint(f, owner, 'get');
    const r = await query(f, 'correspondence', get, owner);
    const direct = stock.sourceToImplementation(f.analysis, { occurrencePath: owner.path, semanticId: 'def:Connected:mkStage.get' });
    oracle.assertClaims(r.correspondence.stock.claims, direct);
    assert.ok(direct.claims.some(c => c.scope === 'connectivity'));
    assert.deepEqual(r.correspondence.origin.claims, []); assert.equal(r.correspondence.completeOriginSet, false);
    const generated = new Map();
    for (const claim of direct.claims) {
        const explanation = one(r.correspondence.stock.explanations, x => x.claim.id === claim.id);
        assert.deepEqual(explanation, stock.explainMapping(f.analysis, claim.id));
        for (const e of explanation.evidence.filter(x => x.kind === 'generated-rtl')) generated.set(e.id, e);
    }
    assert.ok(generated.size > 0);
    for (const e of generated.values()) {
        const doc = raw(e.pathRef, e.contentHash); assert.notEqual(doc.pathRef, f.doc.pathRef);
        oracle.assertSourceReference({ ...e, revision: e.contentHash }, doc);
    }
    const formalPort = one([...generated.values()], e => e.role === 'formal-port' && e.range.text === 'output [7 : 0] get;');
    const generatedDoc = raw(formalPort.pathRef, formalPort.contentHash);
    oracle.assertSourceReference({ ...formalPort, revision: formalPort.contentHash }, generatedDoc, { range: oracle.locate(generatedDoc, 'output [7 : 0] get;') });
    const state = instance(f, `${owner.path}.state`), rhs = record(f, 'expressions', 'def:Connected:mkStage.put', 'value + 1');
    const known = origin.sourceToImplementation(f.originCase.analysis, { occurrencePath: ['mkConnected', 'left'], contribution: 'known' });
    for (const [entity, kind] of [[state, 'binding'], [rhs, 'rhs-binary']]) {
        const before = await query(f, 'correspondence', entity, owner), expected = { claims: known.claims.filter(x => x.source.kind === kind) };
        assert.equal(expected.claims.length, 1); oracle.assertClaims(before.correspondence.origin.claims, expected);
        for (const claim of expected.claims) assert.deepEqual(one(before.correspondence.origin.explanations, x => x.claim.id === claim.id), origin.explainMapping(f.originCase.analysis, claim.id));
        await query(f, 'source-dependencies', rhs, owner);
        const claim = expected.claims[0], cell = f.originCase.request.importResult.implementation.cells[claim.target.entityId];
        assert.ok(cell);
        const reverse = await query(f, 'correspondence', cell, owner, { implementationProvider: 'instrumented', seed: { entityId: cell.id } });
        oracle.assertClaims(reverse.correspondence.origin.claims, origin.implementationToSource(f.originCase.analysis, { entityId: cell.id }));
        const pin = f.originCase.request.importResult.implementation.pins[cell.pins[0]];
        const coneInput = input(f, 'correspondence', cell, owner, { implementationProvider: 'instrumented', seed: { entityId: pin.id },
            kind: 'dependencies', direction: 'backward', semanticsProfile: 'yosys-0.68-structural-v1' });
        const cone = await f.api.query(coneInput); assert.ok(['complete', 'partial', 'empty'].includes(cone.status));
        if (process.env.G5_OUTPUT_DIR) fs.writeFileSync(path.join(process.env.G5_OUTPUT_DIR, `source-integration-cone-${kind}.json`), JSON.stringify({ input: coneInput, result: cone }, null, 2) + '\n', { flag: 'wx' });
        const after = await query(f, 'correspondence', entity, owner);
        oracle.assertClaims(after.correspondence.origin.claims, expected); assert.deepEqual(after.correspondence, before.correspondence);
        if (kind === 'rhs-binary') {
            for (const [name, change] of [['complete-origin', x => { x[0].completeOriginSet = true; }], ['claim-strength', x => { x[0].status = 'complete-origin'; }],
                ['connectivity-added-to-origin', x => { x.push(direct.claims.find(c => c.scope === 'connectivity')); }]]) {
                const bad = structuredClone(after.correspondence.origin.claims); change(bad);
                mutation(`real-G5-${name}`, 'CORRESPONDENCE_CLAIMS', () => oracle.assertClaims(bad, expected));
            }
        }
    }
    const noBinding = { ...f, api: hardware.createAnalysisQuery({ importResult: f.importResult, analysis: f.analysis, originCase: f.originCase }) };
    assert.deepEqual((await query(noBinding, 'correspondence', rhs, owner)).correspondence.origin.claims, []);
    complete('actual-A-independent-G3', ['S06', 'X01', 'X02'], 'compiler-backed-A');
});

test.after(() => {
    for (const [pathRef, revision] of originals) {
        assert.equal(oracle.sha256(fs.readFileSync(path.join(root, pathRef))), revision);
        evidence.documents.push({ pathRef, revision, preserved: true });
    }
    evidence.totals = { passedCases: evidence.cases.length, publicSourceQueries: evidence.queries.length,
        rejectedRealG5Mutations: evidence.mutations.length, preservedDocuments: evidence.documents.length,
        requirements: [...new Set(evidence.cases.flatMap(x => x.requirements))].sort(), g5QueryIntegrationVerified: evidence.cases.length === 7 };
    if (process.env.G5_OUTPUT_DIR) fs.writeFileSync(path.join(process.env.G5_OUTPUT_DIR, 'source-integration-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    console.log(`G5_SOURCE_INTEGRATION ${JSON.stringify(evidence.totals)}`);
});
