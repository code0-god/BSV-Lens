'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const oracle = require('../experiments/hardware/g5/source-reference.cjs');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
const { loadOriginCase } = require('../experiments/hardware/g3/origin-query');
const stock = require('../src/hardware/correspondence');
const origin = require('../src/hardware/correspondence/origin');
const { createSceneQuery } = require('../src/hardware/scene-query');
const { createArchitecture } = require('../src/hardware/architecture');
const { createSemanticQueries } = require('../media/semantic-query');
const { parseBsvFile } = require('../src/architecture/parser');
const { buildSemanticModel } = require('../src/architecture/semantic/model');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const evidence = { schema: 'g5-source-reference-v1', compilerBacked: [], sourceOnly: [], mutations: [],
    g5Integration: { status: 'separate-integration-suite',
        test: 'test/hardware-analysis-source-integration.test.js', evidence: 'source-integration-evidence.json' } };
function mutation(name, code, action) {
    assert.throws(action, { code });
    evidence.mutations.push({ name, status: 'rejected', code });
}
function raw(pathRef, revision) { return oracle.document(pathRef, fs.readFileSync(path.join(root, pathRef)), revision); }
function one(items, predicate) { const found = items.filter(predicate); assert.equal(found.length, 1); return found[0]; }
function owner(model, occurrencePath) { return one(model.instances, item => item.path === occurrencePath); }
function behavior(model, ownerId, name) { return one(model.stateBehaviors, item => item.ownerInstanceId === ownerId && item.name === name); }
function expression(model, callableId, text) { return one(model.expressions, item => item.enclosingCallableId === callableId && item.text === text); }
function code(model, doc, callableId, text, span, table = 'expressions') {
    const record = one(model[table], item => item.enclosingCallableId === callableId && item.text === text);
    oracle.assertCodeRecord(record, doc, oracle.locate(doc, text, span));
    return record;
}
const captures = new Map();
async function captured(key) {
    if (!captures.has(key)) captures.set(key, (async () => {
        const [capture, originCase] = await Promise.all([loadCapturedCase(key), loadOriginCase(key)]);
        const { request, analysis } = capture, source = request.sources[0];
        const doc = raw(source.pathRef, source.revision), originFile = one(originCase.request.files,
            f => f.kind === 'source' && f.pathRef.endsWith(`/${path.basename(doc.pathRef)}`));
        const originDoc = raw(originFile.pathRef, originFile.contentHash);
        assert.deepEqual(doc.bytes, originDoc.bytes);
        const sourceBindings = [{ sourcePathRef: doc.pathRef, sourceRevision: doc.revision,
            originPathRef: originDoc.pathRef, originRevision: originDoc.revision }];
        const sceneQuery = createSceneQuery({ buildId: key, label: key, importResult: request.importResult,
            analysis, originCase, sourceBindings });
        const architecture = createArchitecture({ importResult: request.importResult, analysis });
        return { key, ...capture, originCase, doc, originDoc, sceneQuery, architecture, model: analysis.sourceModel };
    })());
    return captures.get(key);
}
function inspect(c, ownerId, selectedEntityId) {
    const intent = { buildId: c.key, snapshotId: c.request.importResult.snapshot.id, queryGeneration: 1,
        sceneKind: 'bsv', implementationProvider: 'stock', ownerInstanceId: ownerId, rootInstanceId: ownerId, selectedEntityId };
    const scene = c.sceneQuery.getScene(intent).scene;
    assert.equal(scene.sourceContext.ownerInstanceId, ownerId);
    for (const ref of scene.inspector.sourceRefs) {
        const doc = ref.pathRef === c.doc.pathRef ? c.doc : c.originDoc;
        oracle.assertSourceReference(ref, doc);
        const opened = c.sceneQuery.getSource(ref);
        oracle.assertSourceReference(opened, doc);
        assert.equal(opened.readOnly, true);
    }
    return scene;
}

test('independent source byte/UTF16 oracle rejects text, position, hash, owner, omission, Unicode and stale mutations', () => {
    const doc = oracle.document('synthetic/Unicode.bsv', Buffer.from('\t한😀e\u0301\r\n끝'));
    // Hand-authored oracle self-test candidate, not a product result.
    const ref = { pathRef: doc.pathRef, contentHash: doc.revision, revision: doc.revision,
        semanticId: 'synthetic-expression', ownerInstanceId: 'caller-A', range: { start: 1, end: 6, text: '한😀e\u0301' },
        sliceHash: oracle.sha256(Buffer.from('한😀e\u0301')) };
    const expected = { semanticId: ref.semanticId, ownerInstanceId: 'caller-A', range: { start: 1, end: 6 } };
    const proof = oracle.assertSourceReference(ref, doc, expected);
    assert.deepEqual(proof.utf8, { start: 1, end: 11 });
    assert.deepEqual(proof.codepoint, { start: 1, end: 5 });
    assert.equal(oracle.assertSourceReferences([ref], [doc], [{ ...expected, pathRef: doc.pathRef }]), 1);
    for (const [name, error, change] of [
        ['text', 'SOURCE_TEXT', r => { r.range.text = 'forged'; }],
        ['document-hash', 'SOURCE_HASH', r => { r.contentHash = '0'.repeat(64); }],
        ['stale-revision', 'SOURCE_REVISION', r => { r.revision = '0'.repeat(64); }],
        ['slice-hash', 'SOURCE_SLICE_HASH', r => { r.sliceHash = '0'.repeat(64); }],
        ['owner', 'SOURCE_OWNER', r => { r.ownerInstanceId = 'caller-B'; }],
        ['semantic-id', 'SOURCE_CONTEXT', r => { r.semanticId = 'another-expression'; }],
        ['split-surrogate', 'SPLIT_SCALAR', r => { r.range.start = 3; }],
        ['outside-document', 'SOURCE_RANGE', r => { r.range.end = 99; }],
        ['reverse-range', 'SOURCE_RANGE', r => { r.range.end = 0; }],
        ['byte-offset-as-utf16', 'SOURCE_UNIT', r => { r.range.unit = 'utf8'; }],
        ['wrong-byte-coordinates', 'SOURCE_COORDINATES', r => { r.range.utf8 = { start: 1, end: 10 }; }],
        ['self-consistent-wrong-slice', 'SOURCE_EXPECTED_POSITION', r => {
            r.range = { start: 0, end: 1, text: '\t' }; r.sliceHash = oracle.sha256(Buffer.from('\t'));
        }]
    ]) { const bad = clone(ref); change(bad); mutation(name, error, () => oracle.assertSourceReference(bad, doc, expected)); }
    mutation('missing-required-reference', 'SOURCE_EXPECTED_REFERENCE', () => oracle.assertSourceReferences([], [doc], [{ ...expected, pathRef: doc.pathRef }]));
    mutation('changed-source-bytes-retain-revision', 'SOURCE_REVISION', () => oracle.document(doc.pathRef, Buffer.from(`${doc.text} `), doc.revision));
    mutation('malformed-UTF8', 'SOURCE_ENCODING', () => oracle.document(doc.pathRef, Buffer.from([0xf0, 0x9f, 0x98])));
    mutation('unbounded-source', 'SOURCE_BYTE_BOUND', () => oracle.document(doc.pathRef, Buffer.alloc(oracle.MAX_BYTES + 1)));
    mutation('ambiguous-anchor', 'REFERENCE_ANCHOR', () => oracle.locate(oracle.document('s', Buffer.from('x x')), 'x'));
    evidence.sourceOnly.push({ domain: 'unicode-CRLF-tab-combining-astral', compilerBacked: false, proof });
});

test('actual A: separate left/right state readers/writers, exact RHS/code, caller actual versus callee formal and no fabricated payload', async () => {
    const c = await captured('A'), { model, doc } = c, q = createSemanticQueries(model);
    const moduleSpan = oracle.section(doc, 'module mkStage(Stage);', 'endmodule');
    const putSpan = oracle.section(doc, '      state <= value + 1;', 'endmethod');
    const parent = owner(model, 'mkConnected'), left = owner(model, 'mkConnected.left'), right = owner(model, 'mkConnected.right');
    const rhs = expression(model, 'def:Connected:mkStage.put', 'value + 1');
    const statement = code(model, doc, rhs.enclosingCallableId, 'state <= value + 1;', moduleSpan, 'statements');
    code(model, doc, rhs.enclosingCallableId, 'value + 1', putSpan);
    for (const child of [left, right]) {
        const state = owner(model, `${child.path}.state`), put = behavior(model, child.id, 'put'), get = behavior(model, child.id, 'get');
        const accesses = model.bindings.filter(b => b.targetInstanceId === state.id && ['read', 'write'].includes(b.accessKind));
        assert.deepEqual(accesses.map(b => [b.accessKind, b.behaviorId]).sort(), [['read', get.id], ['write', put.id]]);
        assert.deepEqual(c.architecture.storage[state.id].readers.map(b => b.id), [get.id]);
        assert.deepEqual(c.architecture.storage[state.id].writers.map(b => b.id), [put.id]);
        assert.deepEqual(q.getBehaviorSlice(put.id, { ownerInstanceId: child.id }).behavior.writes, ['state']);
        assert.deepEqual(q.getBehaviorSlice(get.id, { ownerInstanceId: child.id }).behavior.reads, ['state']);
        code(model, doc, get.definitionId, 'state', oracle.locate(doc, 'method Bit#(8) get = state;', moduleSpan));
        assert.equal(q.getBehaviorSlice(put.id, { ownerInstanceId: parent.id }).status, 'unresolved');
        const scene = inspect(c, child.id, statement.id);
        oracle.assertSourceReferences(scene.inspector.sourceRefs, [doc, c.originDoc], [{ pathRef: doc.pathRef,
            semanticId: statement.id, range: oracle.locate(doc, 'state <= value + 1;', moduleSpan) }]);
        const rhsScene = inspect(c, child.id, rhs.id);
        const direct = origin.sourceToImplementation(c.originCase.analysis, { family: 'origin', contribution: 'known',
            occurrencePath: child.path.split('.'), sourceRevision: doc.revision });
        const matching = direct.claims.filter(claim => claim.source.kind === 'rhs-binary');
        assert.equal(matching.length, 1);
        oracle.assertClaims(rhsScene.correspondence.origin.claims, { claims: matching });
        for (const claim of matching) oracle.assertSourceReference(claim.source, c.originDoc, {
            range: oracle.locate(c.originDoc, 'value + 1', moduleSpan), definitionId: put.definitionId });
        const storageScene = inspect(c, child.id, state.id);
        const declaration = storageScene.inspector.sourceRefs.find(ref => ref.sourceKind === 'state-declaration');
        oracle.assertSourceReference(declaration, doc, { range: oracle.locate(doc,
            '\n   Reg#(Bit#(8)) state <- mkReg(0);', moduleSpan) });
    }
    const call = code(model, doc, 'def:Connected:mkConnected.put', 'right.put(left.get + value)',
        oracle.section(doc, 'module mkConnected(Stage);', 'endmodule'), 'callSites');
    const actual = code(model, doc, call.enclosingCallableId, 'left.get + value', call.range);
    assert.equal(call.argumentExpressionIds[0], actual.id);
    const binding = one(model.bindings, b => b.callSiteId === call.id && b.accessKind === 'invoke');
    assert.equal(binding.ownerInstanceId, parent.id); assert.equal(binding.targetInstanceId, right.id);
    const endpoint = one(model.endpoints, e => e.id === binding.endpointId);
    assert.equal(endpoint.ownerInstanceId, right.id); assert.deepEqual(endpoint.parameters, [{ name: 'value', type: 'Bit#(8)' }]);
    const formal = oracle.locate(doc, 'value', oracle.locate(doc, 'method Action put(Bit#(8) value);', moduleSpan));
    assert.notEqual(formal.start, actual.range.start);
    assert.equal(q.resolveEndpointImplementation(endpoint.id, { ownerInstanceId: right.id }).behavior.id, behavior(model, right.id, 'put').id);
    assert.equal(q.resolveEndpointImplementation(endpoint.id, { ownerInstanceId: parent.id }).status, 'unresolved');
    // Original A's operator actual is not a canonical payload edge. Do not turn
    // its nested read or containing parent into a fabricated complete flow.
    const producer = one(model.endpoints, e => e.ownerInstanceId === left.id && e.name === 'get');
    assert.equal(model.semanticFlows.some(f => f.kind === 'payload' && f.fromId === producer.id && f.toId === endpoint.id), false);
    const getScene = inspect(c, left.id, producer.id);
    const connectivity = stock.sourceToImplementation(c.analysis, { occurrenceId: left.id,
        semanticId: 'def:Connected:mkStage.get', method: 'get', family: 'connectivity', snapshotId: c.request.importResult.snapshot.id });
    assert.ok(connectivity.claims.length > 0);
    oracle.assertClaims(getScene.correspondence.stock.claims, connectivity);
    assert.equal(getScene.correspondence.origin.claims.length, 0);
    const complete = origin.sourceToImplementation(c.originCase.analysis, { contribution: 'complete' });
    oracle.assertClaims([], complete);
    mutation('connectivity-promoted-to-origin', 'CORRESPONDENCE_CLAIMS', () => oracle.assertClaims(connectivity.claims, complete));
    const known = origin.sourceToImplementation(c.originCase.analysis, { occurrencePath: ['mkConnected', 'left'] });
    for (const [name, change] of [
        ['promoted-complete-origin', claim => { claim.completeOriginSet = true; }],
        ['promoted-mapping-strength', claim => { claim.status = 'complete-origin'; }],
        ['origin-expanded-by-connectivity', claim => { claim.target.entityId = connectivity.claims[0].tuple.target.entityId; }]
    ]) { const bad = clone(known.claims); change(bad[0]); mutation(name, 'CORRESPONDENCE_CLAIMS', () => oracle.assertClaims(bad, known)); }
    const ref = inspect(c, left.id, rhs.id).inspector.sourceRefs.find(r => r.pathRef === doc.pathRef);
    mutation('public-source-opening-stale', 'SOURCE_REVISION_MISMATCH', () => c.sceneQuery.getSource({ ...ref, revision: '0'.repeat(64) }));
    mutation('actual-A-RHS-text', 'SOURCE_TEXT', () => oracle.assertSourceReference({ ...ref, text: 'value + 2' }, doc));
    mutation('actual-A-RHS-slice-hash', 'SOURCE_SLICE_HASH', () => oracle.assertSourceReference({ ...ref, sliceHash: '0'.repeat(64) }, doc));
    mutation('actual-A-RHS-document-hash', 'SOURCE_HASH', () => oracle.assertSourceReference({ ...ref, contentHash: '0'.repeat(64) }, doc));
    mutation('actual-A-RHS-wrong-owner-request', 'INVALID_INPUT', () => inspect(c, parent.id, rhs.id));
    const shifted = { ...ref, range: oracle.locate(doc, 'value', oracle.locate(doc, 'left.put(value);')),
        text: 'value', sliceHash: oracle.sha256(Buffer.from('value')) };
    mutation('actual-A-self-consistent-caller-range-as-RHS', 'SOURCE_EXPECTED_POSITION', () => oracle.assertSourceReference(shifted, doc,
        { range: oracle.locate(doc, 'value + 1', moduleSpan) }));
    evidence.compilerBacked.push({ corpus: 'A', sourceHash: doc.revision, stateOwners: [left.id, right.id],
        statementId: statement.id, rhsId: rhs.id, callerId: parent.id, callSiteId: call.id,
        actualRange: actual.range, formalRange: formal, connectivityClaims: connectivity.claims.length,
        originObjects: origin.getCoverage(c.originCase.analysis).knownContributorObjects, sourceSurface: 'createSceneQuery.getScene/getSource' });
});

test('actual B: explicit rule/method predicates remain source facts with zero instrumented origins and no body conditional', async () => {
    const c = await captured('B'), { model, doc } = c, own = owner(model, 'mkControl');
    for (const [name, predicateText, writeText] of [
        ['decrement', 'count > 0 && phase', 'count <= count - 1;'],
        ['increment', 'count < 8', 'count <= count + 2;'],
        ['inject', 'count < 4', 'count <= value;']
    ]) {
        const b = behavior(model, own.id, name), predicate = code(model, doc, b.definitionId, predicateText);
        assert.equal(b.predicateExpressionId, predicate.id);
        const statement = code(model, doc, b.definitionId, writeText, undefined, 'statements');
        assert.deepEqual(statement.pathConditionExpressionIds, []);
        const relations = Object.values(c.architecture.relations).filter(r => r.behaviorId === b.id && r.kind === 'state-write');
        assert.equal(relations.length, 1);
        oracle.assertConditions(relations[0].conditions, { predicate: { expressionId: predicate.id, evaluated: false }, body: [] });
        const scene = inspect(c, own.id, statement.id);
        assert.ok(scene.inspector.sourceRefs.length > 0);
        oracle.assertClaims(scene.correspondence.origin.claims,
            origin.sourceToImplementation(c.originCase.analysis, { occurrencePath: ['mkControl'], contribution: 'known' }));
    }
    assert.equal(model.statements.some(s => s.kind === 'if'), false);
    assert.equal(origin.getCoverage(c.originCase.analysis).knownContributorObjects, 0);
    evidence.compilerBacked.push({ corpus: 'B', sourceHash: doc.revision, predicates: 3, bodyConditionals: 0,
        originObjects: 0, sourceAvailable: true, schedulingInferredFromPredicates: false });
});

test('actual C: narrow/wide inlined owners, wrapper formals, canonical payload caller/producer/consumer separation', async () => {
    const c = await captured('C'), { model, doc } = c, q = createSemanticQueries(model);
    const rhs = code(model, doc, 'def:Reuse:mkWidth.put', 'value + 1', oracle.section(doc, 'module mkWidth(Sample#(width));', 'endmodule'));
    const sourceRefs = [];
    for (const [name, width] of [['narrow', 8], ['wide', 12]]) {
        const wrapper = owner(model, `mkReuse.${name}`), inline = owner(model, `mkReuse.${name}.implementation`);
        const context = one(c.analysis.correspondence.contexts, x => x.occurrenceId === inline.id);
        assert.equal(context.implementationOccurrenceId, null); assert.ok(context.contextOccurrenceId); assert.deepEqual(context.ownedCellIds, []);
        assert.equal(q.resolveSourceReference(rhs.id, { ownerInstanceId: inline.id }).status, 'exact');
        assert.equal(q.resolveSourceReference(rhs.id, { ownerInstanceId: wrapper.id }).status, 'unresolved');
        const scene = inspect(c, inline.id, rhs.id);
        assert.equal(scene.implementationContext.implementationOccurrenceId, null);
        const direct = origin.sourceToImplementation(c.originCase.analysis, { occurrencePath: ['mkReuse', name], contribution: 'known' });
        oracle.assertClaims(scene.correspondence.origin.claims, { claims: direct.claims.filter(claim => claim.source.kind === 'rhs-binary') });
        sourceRefs.push(scene.inspector.sourceRefs.find(r => r.pathRef === doc.pathRef));
        const method = one(c.analysis.correspondence.methods, m => m.occurrenceId === wrapper.id && m.method === 'get');
        assert.equal(method.signals.find(s => s.role === 'result').width, width);
        assert.equal(method.body, null);
        oracle.assertSourceReference(method.forwardingSource, doc, { occurrenceId: wrapper.id,
            range: oracle.locate(doc, 'return implementation;', oracle.section(doc, `module mk${name === 'narrow' ? 'Narrow' : 'Wide'}(Sample#(${width}));`, 'endmodule')) });
    }
    assert.deepEqual(sourceRefs[0], sourceRefs[1]); // Same lexical code, two separately checked owner requests.
    const parent = owner(model, 'mkReuse'), low = owner(model, 'mkReuse.low'), narrow = owner(model, 'mkReuse.narrow');
    const from = one(model.endpoints, e => e.ownerInstanceId === low.id && e.name === 'get');
    const to = one(model.endpoints, e => e.ownerInstanceId === narrow.id && e.name === 'put');
    const call = code(model, doc, 'def:Reuse:mkReuse.put', 'narrow.put(low.get)', undefined, 'callSites');
    const actual = code(model, doc, call.enclosingCallableId, 'low.get', call.range);
    assert.equal(call.argumentExpressionIds[0], actual.id);
    const expected = { fromId: from.id, toId: to.id, ownerInstanceId: parent.id,
        causeBehaviorId: behavior(model, parent.id, 'put').id, callSiteId: call.id,
        producerEndpointId: from.id, consumerEndpointId: to.id, consumerArgumentIndex: 0, consumerArgumentName: 'value' };
    const flow = one(model.semanticFlows, f => f.kind === 'payload' && f.fromId === from.id && f.toId === to.id);
    oracle.assertPayload(q.getFlowEvidence(flow.id).flow, expected);
    assert.equal(q.traceSemanticFlow({ fromId: from.id, toId: to.id }).status, 'exact');
    mutation('containment-only-fake-payload', 'PAYLOAD_CONTEXT', () => oracle.assertPayload({ ...flow, fromId: parent.id, toId: narrow.id }, expected));
    mutation('payload-caller-is-callee', 'PAYLOAD_CONTEXT', () => oracle.assertPayload({ ...flow, causeBehaviorId: behavior(model, low.id, 'get').id }, expected));
    mutation('payload-formal-position', 'PAYLOAD_CONTEXT', () => oracle.assertPayload({ ...flow, consumerArgumentIndex: 1 }, expected));
    evidence.compilerBacked.push({ corpus: 'C', sourceHash: doc.revision, widths: [8, 12], inlinedOwners: 2,
        rhsId: rhs.id, payload: expected, originObjects: origin.getCoverage(c.originCase.analysis).knownContributorObjects });
});

function synthetic(text, pathRef = 'synthetic/SourceOracle.bsv', entrypoints = []) {
    const doc = oracle.document(pathRef, Buffer.from(text));
    const model = buildSemanticModel([parseBsvFile(doc.text, { uri: pathRef, relativePath: pathRef })], { entrypoints });
    return { doc, model, q: createSemanticQueries(model) };
}
test('source-only original helper: distinct branch/shadow bindings, exact actual/formal positions and no hardware occurrence', () => {
    const pathRef = 'test/fixtures/semantic-workspace/src/PureFunctionFixture.bsv', doc = raw(pathRef);
    const { model, q } = synthetic(doc.text, pathRef);
    assert.equal(model.instances.length, 0); assert.equal(model.endpoints.length, 0);
    const fn = one(model.functionDefinitions, f => f.name === 'chooseValue');
    const call = code(model, doc, 'def:PureFunctionFixture:callChoose', 'chooseValue(inputValue, enabled)', undefined, 'callSites');
    const result = q.getExpressionDependencies(call.expressionId);
    assert.equal(result.callee.id, fn.id); assert.equal(result.status, 'exact');
    assert.deepEqual(result.actualToFormal, [
        { actualExpressionId: call.argumentExpressionIds[0], formalIndex: 0, formalName: 'value' },
        { actualExpressionId: call.argumentExpressionIds[1], formalIndex: 1, formalName: 'useInput' }
    ]);
    const header = oracle.locate(doc, 'function Bit#(8) chooseValue(Bit#(8) value, Bool useInput);');
    const actualSpans = ['inputValue', 'enabled'].map(text => oracle.locate(doc, text, call.range));
    const formalSpans = ['value', 'useInput'].map(text => oracle.locate(doc, text, header));
    for (let index = 0; index < 2; index++) oracle.assertCodeRecord(model.expressions.find(e => e.id === call.argumentExpressionIds[index]), doc, actualSpans[index]);
    const returns = model.statements.filter(s => s.enclosingCallableId === fn.id && s.kind === 'return');
    assert.equal(returns.length, 2);
    const condition = code(model, doc, fn.id, 'useInput', oracle.locate(doc, 'if (useInput) begin'));
    assert.deepEqual(returns.map(s => s.pathConditionExpressionIds), [[condition.id], [`!${condition.id}`]]);
    const uses = returns.map(s => model.expressions.find(e => e.id === s.expressionId));
    assert.notDeepEqual(uses[0].useSymbolIds, uses[1].useSymbolIds);
    assert.deepEqual(uses[0].definitionIds, []); assert.equal(uses[1].definitionIds.length, 1);
    const scope = oracle.section(doc, 'function Bit#(8) chooseValue', 'endfunction');
    oracle.assertCodeRecord(returns[0], doc, oracle.locate(doc, 'return value;', oracle.section(doc, 'if (useInput) begin', 'end')));
    oracle.assertCodeRecord(returns[1], doc, oracle.locate(doc, 'return value;', oracle.section(doc, 'else begin', 'end')));
    assert.ok(scope.start < returns[0].range.start);
    const expected = { predicate: null, body: [{ expressionId: condition.id, polarity: false, evaluated: false }] };
    oracle.assertConditions(expected, expected);
    mutation('negated-branch-polarity', 'SOURCE_POLARITY', () => oracle.assertConditions({ ...expected,
        body: [{ ...expected.body[0], polarity: true }] }, expected));
    mutation('body-condition-promoted-to-predicate', 'SOURCE_PREDICATE', () => oracle.assertConditions({ predicate: expected.body[0], body: [] }, expected));
    evidence.sourceOnly.push({ domain: 'original-pure-helper-shadow-branches', compilerBacked: false, pathRef,
        sourceHash: doc.revision, callSiteId: call.id, actualSpans, formalSpans, hardwareOccurrences: 0 });
});

test('source-only synthetic: reassignment and unresolved branch merge preserve lexical uncertainty; guard and body polarity stay separate', () => {
    const text = `package SourceOracle; // 😀\r\nfunction Bit#(8) reassigned(Bit#(8) p); let x = p; x = 7; return x; endfunction
function Bit#(8) merged(Bit#(8) p, Bool select); let x = p; if (select) begin x = 1; end else begin x = 2; end return x; endfunction
module mkTop(Empty); Reg#(Bit#(8)) r <- mkReg(0); rule go (r < 8); if (r == 0) begin r <= 1; end else begin r <= 2; end endrule endmodule endpackage`;
    const { doc, model, q } = synthetic(text, undefined, ['mkTop']);
    for (const [name, status] of [['reassigned', 'exact'], ['merged', 'unresolved']]) {
        const fn = one(model.functionDefinitions, f => f.name === name), returned = one(model.statements, s => s.enclosingCallableId === fn.id && s.kind === 'return');
        const span = oracle.section(doc, `function Bit#(8) ${name}`, 'endfunction');
        oracle.assertCodeRecord(returned, doc, oracle.locate(doc, 'return x;', span));
        const result = q.getExpressionDependencies(returned.expressionId);
        assert.equal(result.status, status);
        if (status === 'unresolved') assert.deepEqual(result.definitions, []);
        else {
            const assignment = code(model, doc, fn.id, 'x = 7;', span, 'statements');
            assert.deepEqual(result.expression.definitionIds, [assignment.rightExpressionId]);
        }
        assert.equal(model.instances.some(i => i.targetDefinitionId === fn.id), false);
    }
    const own = owner(model, 'mkTop'), b = behavior(model, own.id, 'go');
    const predicate = code(model, doc, b.definitionId, 'r < 8'), condition = code(model, doc, b.definitionId, 'r == 0');
    assert.equal(b.predicateExpressionId, predicate.id);
    for (const [value, sign] of [[1, ''], [2, '!']]) {
        const write = code(model, doc, b.definitionId, `r <= ${value};`, undefined, 'statements');
        assert.deepEqual(write.pathConditionExpressionIds, [`${sign}${condition.id}`]);
        assert.notEqual(predicate.id, condition.id);
    }
    evidence.sourceOnly.push({ domain: 'reassignment-unresolved-merge-explicit-guard-signed-body', compilerBacked: false,
        sourceHash: doc.revision, statuses: ['exact', 'unresolved'] });
});

test('source-only helper code requires a direct caller-owned entry callsite, not a foreign or nested call', () => {
    const text = `package HelperOwner;
function Bit#(8) addOne(Bit#(8) value); return value + 1; endfunction
function Bit#(8) nested(Bit#(8) value); return addOne(value); endfunction
module mkCaller(Empty); rule go; let a = addOne(1); let b = addOne(a); endrule endmodule
module mkForeign(Empty); rule idle; noAction; endrule endmodule endpackage`;
    const { doc, model, q } = synthetic(text, 'synthetic/HelperOwner.bsv', ['mkCaller', 'mkForeign']);
    const own = owner(model, 'mkCaller'), foreign = owner(model, 'mkForeign');
    const fn = one(model.functionDefinitions, f => f.name === 'addOne');
    const rhs = code(model, doc, fn.id, 'value + 1');
    const calls = ['addOne(1)', 'addOne(a)'].map(text => code(model, doc, 'def:HelperOwner:mkCaller.rule.go', text, undefined, 'callSites'));
    assert.notEqual(calls[0].id, calls[1].id);
    for (const call of calls) {
        const context = { ownerInstanceId: own.id, entryCallSiteId: call.id, bindingEnvironmentId: rhs.bindingEnvironmentId };
        assert.equal(q.resolveSourceReference(rhs.id, context).status, 'exact');
        assert.equal(q.resolveSourceReference(rhs.id, { ...context, ownerInstanceId: foreign.id }).status, 'unresolved');
        assert.equal(q.getExpressionDependencies(call.expressionId).callee.id, fn.id);
    }
    const nested = one(model.callSites, call => call.enclosingCallableId === 'def:HelperOwner:nested');
    assert.equal(q.resolveSourceReference(rhs.id, { ownerInstanceId: own.id, entryCallSiteId: nested.id }).status, 'unresolved');
    assert.equal(q.resolveSourceReference(rhs.id, { ownerInstanceId: own.id }).status, 'unresolved');
    assert.equal(model.instances.some(i => i.targetDefinitionId === fn.id), false);
    evidence.sourceOnly.push({ domain: 'direct-helper-callsite-owner-not-nested-or-foreign', compilerBacked: false,
        sourceHash: doc.revision, callSiteIds: calls.map(call => call.id), noHelperOccurrence: true });
});

test.after(() => {
    evidence.totals = { compilerBackedCorpora: evidence.compilerBacked.length, sourceOnlyDomains: evidence.sourceOnly.length,
        rejectedMutations: evidence.mutations.length, g5QueryIntegrationVerified: false };
    if (process.env.G5_OUTPUT_DIR) fs.writeFileSync(path.join(process.env.G5_OUTPUT_DIR, 'source-reference-evidence.json'),
        `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    console.log(`G5_SOURCE_REFERENCE ${JSON.stringify(evidence.totals)}`);
});
