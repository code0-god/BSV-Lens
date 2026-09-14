'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const hardware = require('../src/hardware');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
const { loadOriginCase } = require('../experiments/hardware/g3/origin-query');
const { createArchitecture } = require('../src/hardware/architecture');
const { buildSource } = require('../src/hardware/correspondence/source');
const { hash, stable } = require('../src/hardware/json');
const cache = new Map();
async function fixture(key) {
    if (!cache.has(key)) cache.set(key, Promise.all([loadCapturedCase(key), loadOriginCase(key)]).then(([stock, originCase]) => {
        const source = stock.request.sources[0], captured = originCase.request.files.find(f => f.kind === 'source' && f.contentHash === source.revision);
        const options = { importResult: stock.request.importResult, analysis: stock.analysis, originCase,
            sourceBindings: [{ sourcePathRef: source.pathRef, sourceRevision: source.revision, originPathRef: captured.pathRef, originRevision: captured.contentHash }] };
        return { ...options, architecture: createArchitecture(options), api: hardware.createAnalysisQuery(options), source: stock.analysis.sourceModel };
    }));
    return cache.get(key);
}
function query(f, kind, entity, owner, extra = {}) {
    const provider = extra.implementationProvider || 'stock', c = f.api.getContext(provider);
    const imported = provider === 'stock' ? f.importResult : f.originCase.request.importResult;
    const context = f.analysis.correspondence.contexts.find(x => x.occurrenceId === owner);
    const stockId = context?.contextOccurrenceId || context?.implementationOccurrenceId;
    const path = f.importResult.implementation.occurrences[stockId]?.path;
    const occurrence = provider === 'stock' ? stockId : Object.values(imported.implementation.occurrences).find(x => stable(x.path) === stable(path))?.id;
    return { kind, analysisId: c.analysisId, snapshotId: c.snapshotId, implementationProvider: provider, ownerInstanceId: owner,
        implementationOccurrenceId: occurrence, seed: { entityId: entity.id }, scope: { kind: 'design', rootOccurrenceId: imported.implementation.roots[0] }, queryGeneration: 1, ...extra };
}
function slices(result, source) {
    assert.ok(result.sourceRefs.length);
    for (const ref of result.sourceRefs) {
        const document = source.sourceDocuments.find(d => d.relativePath === ref.pathRef);
        assert.equal(ref.revision, hash(document.content)); assert.equal(ref.contentHash, ref.revision);
        assert.equal(ref.range.text, document.content.slice(ref.range.start, ref.range.end));
        assert.equal(ref.sliceHash, hash(ref.range.text)); assert.ok(ref.id); assert.ok(ref.semanticId);
    }
}
test('S01 actual A storage declaration, occurrence readers/writers and exact assignment/read slices', async () => {
    const f = await fixture('A'), storage = Object.values(f.architecture.storage).find(x => x.path === 'mkConnected.left.state');
    const r = await f.api.query(query(f, 'state-accesses', storage, storage.ownerInstanceId));
    assert.equal(r.status, 'complete'); assert.equal(r.code.storage.id, storage.id);
    assert.equal(r.code.storage.declaredType, 'Reg#(Bit#(8))'); assert.equal(r.code.storage.constructor, 'mkReg');
    assert.deepEqual(r.code.storage.defaultExpressions, ['0']);
    assert.deepEqual(r.readers.map(x => x.id), storage.readers.map(x => x.id));
    assert.deepEqual(r.writers.map(x => x.id), storage.writers.map(x => x.id));
    assert.ok(r.sourceRefs.some(x => x.range.text.includes('state <= value + 1;')));
    assert.ok(r.relations.some(x => x.kind === 'read' && x.from.entityId === storage.id));
    assert.ok(r.relations.some(x => x.kind === 'write' && x.to.entityId === storage.id)); slices(r, f.source);
});
test('S02/S08 actual B predicates, state effects, assertions, readiness and absent compiler scheduling remain separate', async () => {
    const f = await fixture('B');
    assert.deepEqual(Object.values(f.architecture.storage).map(x => x.label).sort(), ['count', 'phase']);
    for (const behavior of f.source.stateBehaviors) {
        const r = await f.api.query(query(f, 'behavior', behavior, behavior.ownerInstanceId));
        assert.equal(r.code.behavior.id, behavior.id); slices(r, f.source);
        assert.equal(r.conditions.predicate?.expressionId || null, behavior.predicateExpressionId || null);
        assert.equal(r.code.scheduling.compiler.status, 'not-attached');
        assert.equal(r.code.readiness.status, 'not-attached');
        assert.ok(r.code.scheduling.potentialDependencies.every(x => x.origin === 'source-heuristic'));
        assert.ok(r.relations.every(x => x.family !== 'logic-dependency'));
    }
});
test('S03 actual A method calls join canonical caller/binding/target/formal IDs without promoting unresolved raw calls', async () => {
    const f = await fixture('A');
    for (const call of f.source.callSites.filter(c => c.calleeName.includes('.'))) {
        const binding = f.source.bindings.find(b => b.callSiteId === call.id && b.endpointId);
        assert.ok(binding);
        const r = await f.api.query(query(f, 'call-site', call, binding.ownerInstanceId));
        const m = r.callMappings[0], endpoint = f.source.endpoints.find(e => e.id === binding.endpointId);
        assert.equal(m.callSite.id, call.id); assert.equal(m.callSite.resolutionStatus, 'unresolved');
        assert.equal(m.resolution, 'exact'); assert.equal(m.caller.ownerInstanceId, binding.ownerInstanceId);
        assert.equal(m.callee.endpointId, endpoint.id); assert.equal(m.callee.ownerInstanceId, endpoint.ownerInstanceId);
        assert.equal(m.binding.id, binding.id);
        if (call.calleeName === 'right.put') {
            const producer = f.source.bindings.find(b => b.statementId === call.parentStatementId && b.accessKind === 'return');
            assert.equal(m.producer.length, 1); assert.equal(m.producer[0].endpointId, producer.endpointId);
            assert.equal(m.producer[0].bindingId, producer.id); assert.equal(m.producer[0].formalIndex, 0);
            assert.notEqual(m.producer[0].ownerInstanceId, m.consumer.ownerInstanceId);
            assert.notEqual(m.caller.ownerInstanceId, m.consumer.ownerInstanceId);
        }
        assert.deepEqual(m.actualToFormal.map(x => [x.actualExpressionId, x.formalIndex, x.formalName]),
            call.argumentExpressionIds.map((id, i) => [id, i, endpoint.parameters[i].name])); slices(r, f.source);
    }
});
function synthetic(text) {
    const pathRef = 'synthetic/Helpers.bsv', revision = hash(text);
    const built = buildSource([{ pathRef, contentHash: revision, text }]);
    const source = { ...built.semantic, sourceReferences: built.references, supplements: built.supplements };
    const api = hardware.createAnalysisQuery({ sourceModel: source });
    return { source, api, input(kind, entity, extra = {}) { const c = api.getContext(); return { kind, analysisId: c.analysisId,
        snapshotId: null, implementationProvider: 'stock', implementationOccurrenceId: null, ownerInstanceId: null,
        seed: { entityId: entity.id }, scope: { kind: 'source-only', rootOccurrenceId: null }, queryGeneration: 1, ...extra }; } };
}
test('typeclass prototype has a source range but no executable behavior', async () => {
    const text = 'package Helpers; typeclass Pick#(type t); function t pick(t x); endtypeclass endpackage';
    const f = synthetic(text), fn = f.source.functionDefinitions.find(x => x.name === 'pick');
    const result = await f.api.query(f.input('behavior', fn));
    assert.equal(result.status, 'partial');
    assert.equal(result.code.functionDefinition.id, fn.id);
    assert.ok(result.frontier.some(x => x.reason === 'unsupported-source' && x.detail === 'declaration-only'));
    assert.deepEqual(result.code.statements, []);
    assert.deepEqual(result.callMappings, []);
    assert.ok(result.sourceRefs.some(x => x.semanticId === fn.id && x.range.text === 'function t pick(t x);'));
});
test('real duplicate source declarations remain rejected with both locations', () => {
    const text = 'package Helpers; function Bit#(8) inc(Bit#(8) x) = x; endpackage';
    const documents = ['first/Helpers.bsv', 'second/Helpers.bsv'].map(pathRef => ({ pathRef, contentHash: hash(text), text }));
    assert.throws(() => buildSource(documents), error => error.code === 'AMBIGUOUS_SOURCE'
        && /first\/Helpers\.bsv:1/.test(error.message) && /second\/Helpers\.bsv:1/.test(error.message));
});

test('public state query exposes case arm labels and default exclusion without a fake Boolean guard', async () => {
    const f = synthetic(`package CaseQuery;
module mkTop(Empty);
    Reg#(Bit#(2)) selector <- mkReg(0);
    Reg#(Bit#(8)) result <- mkReg(0);
    rule update;
        case (selector)
            0: result <= 1;
            default: result <= 2;
        endcase
    endrule
endmodule
endpackage`);
    const owner = f.source.instances.find((item) => item.parentInstanceId === null && item.name === 'mkTop');
    const storage = f.source.instances.find((item) => item.parentInstanceId === owner.id && item.name === 'result');
    const queryResult = await f.api.query(f.input('state-accesses', storage, { ownerInstanceId: owner.id }));
    assert.equal(queryResult.status, 'complete');
    assert.deepEqual(queryResult.conditions.body, []);
    assert.deepEqual(queryResult.conditions.caseArms.map((condition) => ({
        kind: condition.kind,
        semantics: condition.semantics,
        selector: condition.selector.text,
        labels: condition.labels.map((label) => label.text),
        priorLabels: condition.priorLabels.map((label) => label.text),
        evaluated: condition.evaluated
    })), [
        { kind: 'case-arm', semantics: 'selector-matches-label', selector: 'selector', labels: ['0'], priorLabels: [], evaluated: false },
        { kind: 'case-default', semantics: 'no-prior-arm-match', selector: 'selector', labels: [], priorLabels: ['0'], evaluated: false }
    ]);
    assert.equal(queryResult.code.bindings.length, 2);
    assert.ok(queryResult.code.bindings.every((binding) => binding.caseConditions.length === 1));
    assert.equal(queryResult.relations.filter((relation) => relation.kind === 'case-condition').length, 2);
});
test('builtin-named typeclass call keeps dispatch unresolved through the public query', async () => {
    for (const instance of ['', 'instance Bits#(T, 8); function Bit#(8) pack(T x) = 0; endinstance']) {
        const f = synthetic(`package Helpers; ${instance} function Bit#(8) caller(Bit#(8) x) = pack(x); endpackage`);
        const call = f.source.callSites.find(x => x.calleeName === 'pack');
        const result = await f.api.query(f.input('call-site', call)), mapping = result.callMappings[0];
        assert.equal(mapping.resolution, instance ? 'unresolved' : 'exact');
        assert.equal(result.status, instance ? 'partial' : 'complete');
        if (instance) {
            assert.equal(mapping.callee, null);
            assert.deepEqual(mapping.actualToFormal, []);
            assert.deepEqual(mapping.candidates.map(x => x.id), call.candidateDefinitionIds);
        }
    }
});
const helperText = `package Helpers;
function Bit#(8) inc(Bit#(8) x);
  return x + 1;
endfunction
function Bit#(8) choose(Bit#(8) x, Bool flag);
  Bit#(8) y = x;
  begin
    Bit#(8) x = 9;
    y = inc(x);
  end
  if (flag) y = inc(y); else y = 3;
  return y;
endfunction
endpackage
`;
test('S04/S05 labeled synthetic helper mappings, shadow/reassignment/branch merge, signed else paths and no fake RTL', async () => {
    const f = synthetic(helperText), fn = f.source.functionDefinitions.find(x => x.name === 'choose');
    const r = await f.api.query(f.input('behavior', fn));
    assert.equal(r.context.snapshotId, null); assert.equal(r.context.modelId, null); assert.equal(r.code.owner, null);
    assert.equal(r.code.functionDefinition.id, fn.id); slices(r, f.source);
    assert.ok(r.conditions.body.some(c => c.signedExpressionId.startsWith('!') && c.polarity === false));
    const ret = f.source.expressions.find(e => fn.returnExpressionIds.includes(e.id));
    const d = await f.api.query(f.input('source-dependencies', ret));
    assert.equal(d.status, 'partial'); assert.equal(d.code.dependencies[0].bindingEnvironment.resolutionStatus, 'unresolved');
    assert.ok(d.frontier.some(x => x.reason === 'unresolved-source'));
    for (const call of f.source.callSites) {
        const c = await f.api.query(f.input('call-site', call));
        assert.equal(c.callMappings[0].resolution, 'exact');
        assert.deepEqual(c.callMappings[0].actualToFormal.map(x => [x.actualExpressionId, x.formalIndex]), call.actualToFormal.map(x => [x.actualExpressionId, x.formalIndex]));
        assert.equal(c.callMappings[0].callee.ownerInstanceId, null);
    }
    const inner = f.source.statements.find(s => s.kind === 'local-declaration' && s.localSymbol?.name === 'x');
    const firstCall = f.source.callSites[0], actual = f.source.expressions.find(e => e.id === firstCall.argumentExpressionIds[0]);
    const traced = await f.api.query(f.input('source-dependencies', actual));
    assert.equal(traced.code.dependencies[0].uses[0], inner.localSymbolId);
    assert.ok(traced.relations.some(e => e.from.entityId === inner.initializerExpressionId || e.from.entityId === inner.rightExpressionId));
});
test('S06/S07 labeled Unicode exact ranges, hostile seeds, foreign revisions and captured/current freshness', async () => {
    const f = synthetic(helperText.replace('return x + 1;', '/* 한😀é */ return x + 1;'));
    const fn = f.source.functionDefinitions.find(x => x.name === 'inc'), q = f.input('behavior', fn);
    const r = await f.api.query(q); slices(r, f.source); assert.equal(r.code.sourceMode, 'build'); assert.equal(r.code.freshness.status, 'captured');
    const stale = await f.api.query({ ...q, mode: 'current-source' }); assert.equal(stale.status, 'stale');
    for (const seed of [{ entityId: fn.id, sourceRevision: '0'.repeat(64) }, { entityId: 'command:evil' },
        { entityId: fn.id, entryCallSiteId: 'foreign' }, { entityId: fn.id, range: { start: 0, end: 1 } }, { entityId: fn.id, indices: [0] }])
        await assert.rejects(f.api.query({ ...q, seed }));
    const malformed = structuredClone(f.source); malformed.functionDefinitions[0].sourceRange.endLine = 99999;
    const bad = hardware.createAnalysisQuery({ sourceModel: malformed });
    await assert.rejects(bad.query({ ...q, analysisId: bad.getContext().analysisId }), { code: 'INVALID_RANGE' });
});
test('S01/S03 actual C inline owners, widths 8/12 and bias 3/9 keep occurrence-specific source identities', async () => {
    const f = await fixture('C');
    for (const name of ['narrow', 'wide']) {
        const owner = f.source.instances.find(x => x.path === `mkReuse.${name}.implementation`);
        const behavior = f.source.stateBehaviors.find(x => x.ownerInstanceId === owner.id && x.name === 'put');
        const r = await f.api.query(query(f, 'behavior', behavior, owner.id));
        assert.equal(r.code.owner.id, owner.id); assert.equal(r.code.behavior.id, behavior.id);
        assert.ok(r.sourceRefs.some(x => x.ownerInstanceId === owner.id && x.range.text === 'value + 1'));
        const contact = Object.values(f.architecture.contacts).find(x => x.ownerInstanceId === owner.id && x.label === 'get');
        assert.equal(contact.result.type, `Bit#(${name === 'narrow' ? 8 : 12})`);
    }
    for (const [name, bias] of [['low', '3'], ['high', '9']]) {
        const owner = f.source.instances.find(x => x.path === `mkReuse.${name}`);
        const b = f.source.stateBehaviors.find(x => x.ownerInstanceId === owner.id && x.name === 'put');
        const r = await f.api.query(query(f, 'behavior', b, owner.id));
        assert.ok(r.code.owner.arguments.includes(bias)); assert.equal(r.code.behavior.ownerInstanceId, owner.id);
    }
});
test('X01/X02 actual stock correspondence and instrumented known contributors call unchanged G3 APIs', async () => {
    const f = await fixture('A'), stock = require('../src/hardware/correspondence'), origin = require('../src/hardware/correspondence/origin');
    const contact = Object.values(f.architecture.contacts).find(x => x.label === 'get' && f.architecture.occurrences[x.ownerInstanceId].path === 'mkConnected.left');
    const r = await f.api.query(query(f, 'correspondence', contact, contact.ownerInstanceId));
    assert.ok(r.correspondence.stock.claims.some(x => x.scope === 'connectivity'));
    for (const claim of r.correspondence.stock.claims) {
        assert.deepEqual(claim, f.analysis.correspondence.claims.find(x => x.id === claim.id));
        assert.deepEqual(r.correspondence.stock.explanations.find(x => x.claim.id === claim.id), stock.explainMapping(f.analysis, claim.id));
    }
    assert.equal(r.correspondence.completeOriginSet, false); assert.deepEqual(r.correspondence.origin.claims, []);
    const storage = Object.values(f.architecture.storage).find(x => x.path === 'mkConnected.left.state');
    const s = await f.api.query(query(f, 'correspondence', storage, storage.ownerInstanceId));
    assert.equal(s.correspondence.origin.claims.length, 1);
    const claim = s.correspondence.origin.claims[0]; assert.equal(claim.status, 'verified-known-contributor');
    assert.deepEqual(claim, origin.implementationToSource(f.originCase.analysis, { entityId: claim.target.entityId }).claims[0]);
    const cell = f.originCase.request.importResult.implementation.cells[claim.target.entityId];
    const reverse = await f.api.query(query(f, 'correspondence', cell, storage.ownerInstanceId, { implementationProvider: 'instrumented' }));
    assert.deepEqual(reverse.correspondence.origin.claims, s.correspondence.origin.claims);
    assert.ok(reverse.sourceRefs.some(ref => ref.semanticId === claim.source.semanticId));
    const put = f.source.stateBehaviors.find(b => b.ownerInstanceId === storage.ownerInstanceId && b.name === 'put');
    const rhs = f.source.expressions.find(e => e.enclosingCallableId === put.definitionId && e.text === 'value + 1');
    const rhsResult = await f.api.query(query(f, 'correspondence', rhs, storage.ownerInstanceId));
    assert.equal(rhsResult.correspondence.origin.claims.length, 1);
    assert.equal(rhsResult.correspondence.origin.claims[0].source.range.text, 'value + 1');
    const noBinding = { ...f, api: hardware.createAnalysisQuery({ importResult: f.importResult, analysis: f.analysis, originCase: f.originCase }) };
    assert.deepEqual((await noBinding.api.query(query(noBinding, 'correspondence', rhs, storage.ownerInstanceId))).correspondence.origin.claims, []);
    const before = stable([f.analysis.correspondence, f.originCase.analysis.bundle]);
    assert.throws(() => hardware.createAnalysisQuery({ importResult: f.importResult, analysis: structuredClone(f.analysis) }), { code: 'INVALID_INPUT' });
    await f.api.query(query(f, 'source-dependencies', rhs, storage.ownerInstanceId));
    assert.equal(stable([f.analysis.correspondence, f.originCase.analysis.bundle]), before);
    const b = await fixture('B'), behavior = b.source.stateBehaviors[0];
    assert.ok((await b.api.query(query(b, 'behavior', behavior, behavior.ownerInstanceId))).code.behavior);
    assert.equal(b.originCase.analysis.bundle.claims.length, 0);
});
test('X04/X05 session keeps last result after cancellation, stale, foreign provider/snapshot and resource failures', async () => {
    const f = synthetic(helperText), fn = f.source.functionDefinitions[0], q = f.input('behavior', fn);
    const session = hardware.createAnalysisSession(f.api), good = await session.query(q);
    const controller = new AbortController();
    await assert.rejects(session.query(q, { signal: controller.signal, onProgress(e) { if (e.phase === 'ready') controller.abort(); } }), { code: 'CANCELLED' });
    assert.equal(session.getState().current.id, good.id);
    for (const extra of [{ snapshotId: 'foreign' }, { implementationProvider: 'instrumented' }, { mode: 'current-source' }, { limits: { maxResultBytes: 1 } }]) {
        await assert.rejects(session.query({ ...q, ...extra })); assert.equal(session.getState().current.id, good.id);
    }
    const limited = await f.api.query({ ...q, limits: { maxBits: 1 } });
    assert.equal(limited.status, 'partial'); assert.ok(limited.frontier.some(x => x.reason === 'resource-limit'));
    const next = await f.api.query({ ...q, queryGeneration: 55 }); assert.equal(next.id, good.id); assert.equal(next.queryId, good.queryId);
});
test('S03/S05 labeled source-only helper entry context is verified by caller IDs, not names', async () => {
    const f = synthetic(helperText.replace('endpackage', `module mkTop(Empty);
      Reg#(Bit#(8)) r <- mkReg(0);
      rule go; let a = inc(r); r <= a; endrule
    endmodule
    endpackage`));
    const owner = f.source.instances.find(i => i.root), fn = f.source.functionDefinitions.find(x => x.name === 'inc');
    const behavior = f.source.stateBehaviors.find(b => b.ownerInstanceId === owner.id), call = f.source.callSites.find(c => c.enclosingCallableId === behavior.definitionId);
    const q = f.input('behavior', fn, { ownerInstanceId: owner.id, seed: { entityId: fn.id, entryCallSiteId: call.id } });
    const r = await f.api.query(q); assert.equal(r.code.entryCallMapping.callSite.id, call.id);
    assert.equal(r.code.entryCallMapping.caller.behaviorId, behavior.id); assert.equal(r.code.entryCallMapping.callee.ownerInstanceId, null);
    assert.equal(r.context.snapshotId, null);
    await assert.rejects(f.api.query({ ...q, seed: { entityId: fn.id } }), { code: 'INVALID_INPUT' });
    const foreign = f.source.callSites.find(c => c.enclosingCallableId !== behavior.definitionId);
    await assert.rejects(f.api.query({ ...q, seed: { entityId: fn.id, entryCallSiteId: foreign.id } }), { code: 'INVALID_INPUT' });
});
test('S02/S04/S08 labeled guarded if/else, assertions, result bindings, reassignment, dynamic and specialization limitations', async () => {
    const f = synthetic(`package Helpers;
      function Bit#(8) inc(Bit#(8) x); return x + 1; endfunction
      function Bit#(8) reassigned(Bit#(8) p); let x = p; x = 7; return x; endfunction
      module mkTop(Empty);
        Reg#(Bit#(8)) r <- mkReg(0);
        rule go (r < 9);
          if (r > 2) r <= 1; else r <= 3;
          dynamicAssert(r != 5, "no");
          let result <- unknown.get(r);
          let x = inc#(8)(r);
          let y = inc(r, 2);
          r <= result;
        endrule
      endmodule
    endpackage`);
    const behavior = f.source.stateBehaviors[0], q = f.input('behavior', behavior, { ownerInstanceId: behavior.ownerInstanceId });
    const r = await f.api.query(q); assert.equal(r.conditions.predicate.text, 'r < 9');
    assert.deepEqual(r.conditions.body.map(x => [x.text, x.polarity]).sort(), [['r > 2', false], ['r > 2', true]]);
    assert.equal(r.code.assertions.length, 1); assert.equal(r.code.stateEffects.length, 3);
    const effect = r.code.statements.find(s => s.kind === 'state-assignment' && s.pathConditionExpressionIds[0]?.startsWith('!'));
    const deps = await f.api.query(f.input('source-dependencies', f.source.expressions.find(e => e.id === effect.rightExpressionId), { ownerInstanceId: behavior.ownerInstanceId }));
    assert.equal(deps.conditions.body[0].signedExpressionId, effect.pathConditionExpressionIds[0]); assert.equal(deps.conditions.body[0].polarity, false);
    const unknown = r.callMappings.find(m => m.callSite.calleeName === 'unknown.get');
    assert.equal(unknown.resultBinding.kind, 'result-binding'); assert.equal(unknown.resolution, 'unresolved');
    const specialized = r.callMappings.find(m => m.callSite.specialization);
    assert.equal(specialized.reason, 'unsupported-specialization'); assert.equal(specialized.actualToFormal.length, 0); assert.ok(specialized.candidates.length);
    const arity = r.callMappings.find(m => m.callSite.calleeName === 'inc' && m.callSite.argumentExpressionIds.length === 2);
    assert.equal(arity.resolution, 'unresolved'); assert.deepEqual(arity.actualToFormal, []);
    const fn = f.source.functionDefinitions.find(x => x.name === 'reassigned'), ret = f.source.expressions.find(e => fn.returnExpressionIds.includes(e.id));
    const d = await f.api.query(f.input('source-dependencies', ret));
    assert.equal(d.status, 'complete'); assert.equal(d.code.dependencies[0].bindingEnvironment.bindings.x.originExpressionIds.length, 1);
    assert.deepEqual(d.code.expressions.map(e => e.text), ['x', '7']);
});
test('S07 current-source uses genuine attached freshness; changed source is stale and in-memory records never read a URI', async t => {
    const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
    const stock = require('../src/hardware/correspondence');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g5-source-current-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'Helpers.bsv'); await fs.writeFile(file, helperText);
    const registry = hardware.createArtifactRegistry({ sourceRoots: [directory], artifactRoots: [directory] });
    const descriptor = { pathRef: 'synthetic/Helpers.bsv', contentHash: hash(helperText), revision: hash(helperText) };
    await registry.registerSource({ ...descriptor, path: file, capture: true });
    const analysis = await stock.attachCorrespondence({ registry, sources: [descriptor] });
    const api = hardware.createAnalysisQuery({ analysis, sourceModel: analysis.sourceModel });
    const f = synthetic(helperText), fn = f.source.functionDefinitions[0], q = f.input('behavior', fn, { analysisId: api.getContext().analysisId, mode: 'current-source' });
    const r = await api.query(q); assert.equal(r.status, 'complete'); assert.equal(r.code.freshness.status, 'current');
    await fs.writeFile(file, helperText + '\n');
    const refreshed = await stock.refreshFreshness(analysis, registry);
    const staleApi = hardware.createAnalysisQuery({ analysis: refreshed, sourceModel: refreshed.sourceModel });
    assert.equal((await staleApi.query({ ...q, analysisId: staleApi.getContext().analysisId })).status, 'stale');
    const captured = synthetic(helperText); await fs.rm(file);
    assert.equal((await captured.api.query(captured.input('behavior', captured.source.functionDefinitions[0]))).status, 'complete');
});
test('S03 source occurrence scope retains a call boundary without entering a foreign callee body', async () => {
    const f = await fixture('A'), call = f.source.callSites.find(c => c.calleeName === 'left.put'), binding = f.source.bindings.find(b => b.callSiteId === call.id);
    const q = query(f, 'call-site', call, binding.ownerInstanceId);
    const r = await f.api.query({ ...q, scope: { kind: 'occurrence', rootOccurrenceId: q.implementationOccurrenceId } });
    assert.equal(r.status, 'partial'); assert.ok(r.frontier.some(f => f.reason === 'scope'));
    assert.equal(r.callMappings[0].returnAvailability, 'scope-boundary');
    for (const extra of [{ implementationOccurrenceId: [q.implementationOccurrenceId] }, { scope: { kind: 'design', rootOccurrenceId: [q.scope.rootOccurrenceId] } }])
        await assert.rejects(f.api.query({ ...q, ...extra }), { code: 'INVALID_INPUT' });
});
