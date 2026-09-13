'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
const { loadOriginCase } = require('../experiments/hardware/g3/origin-query');
const { createSceneQuery } = require('../src/hardware/scene-query');
const { createArchitecture } = require('../src/hardware/architecture');
const cache = new Map();
async function fixture(key) {
    if (!cache.has(key)) cache.set(key, (async () => {
        const [stock, originCase] = await Promise.all([loadCapturedCase(key), loadOriginCase(key)]);
        const sourceBindings = stock.request.sources.map(source => ({ sourcePathRef: source.pathRef, sourceRevision: source.revision,
            originPathRef: originCase.request.files.find(f => f.kind === 'source' && f.contentHash === source.contentHash).pathRef, originRevision: source.revision }));
        const options = { buildId: key, label: key, importResult: stock.request.importResult, analysis: stock.analysis, originCase, sourceBindings };
        return { stock, originCase, options, query: createSceneQuery(options) };
    })());
    return cache.get(key);
}
function intent(f, extra = {}) { return { buildId: f.options.buildId, snapshotId: f.stock.request.importResult.snapshot.id, queryGeneration: 1, ...extra }; }
function at(f, path) { return f.stock.analysis.sourceModel.instances.find(i => i.path === path); }
function scene(f, extra = {}) { return f.query.getScene(intent(f, extra)).scene; }

test('real A/B/C product scenes are typed, immutable, deterministic and retain every local semantic flow', async () => {
    for (const key of ['A', 'B', 'C']) {
        const f = await fixture(key), before = JSON.stringify([f.stock.request.importResult, f.stock.analysis, f.originCase.analysis]);
        const architecture = createArchitecture({ importResult: f.stock.request.importResult, analysis: f.stock.analysis });
        const catalog = f.query.getCatalogEntry();
        assert.equal(catalog.buildId, key);
        for (const context of f.stock.analysis.correspondence.contexts) {
            const s = scene(f, { rootInstanceId: context.occurrenceId });
            assert.ok(Object.isFrozen(s));
            for (const field of ['id', 'snapshotId', 'sourceRevision', 'sceneKind', 'rootInstanceId', 'ownerInstanceId', 'occurrencePath', 'shell', 'children', 'storages', 'contacts', 'connections', 'correspondence', 'capabilities', 'selection', 'disclosureState', 'provenance', 'header', 'breadcrumb', 'implementationContext', 'inspector']) assert.ok(Object.hasOwn(s, field), field);
            assert.equal(s.shell.id, context.occurrenceId);
            assert.ok(s.children.every(c => c.kind === 'module-occurrence' && c.interaction.kind === 'enter'));
            assert.ok(s.storages.every(c => c.kind === 'storage' && c.interaction.kind === 'inspect'));
            assert.ok(s.contacts.every(c => c.ownerId && c.direction && c.category));
            const members = [...s.connections.flatMap(c => c.memberRelationIds), ...s.projection.foldedRelationIds, ...s.projection.scopeOutsideRelationIds];
            const expected = Object.values(architecture.relations).filter(r => r.ownerInstanceId === context.occurrenceId).map(r => r.id);
            assert.deepEqual([...members].sort(), [...expected].sort());
            assert.equal(new Set(members).size, members.length);
            for (const c of s.connections) {
                assert.deepEqual(c.memberRelationIds, c.members.map(m => m.id));
                assert.ok(c.sourceRefIds.length);
                assert.ok(c.members.every(m => m.sourceRefIds.length && architecture.relations[m.id].conditions
                    && architecture.relations[m.id].confirmationScope));
                assert.equal(new Set(c.members.map(member => member.kind)).size, 1);
                const detail = scene(f, { rootInstanceId: context.occurrenceId, selectedRelationId: c.id });
                assert.deepEqual(detail.inspector.sourceRefs.filter(ref => !ref.id.startsWith('scene-origin-source-'))
                    .map(ref => ref.id).sort(), [...c.sourceRefIds].sort());
            }
            assert.deepEqual(s, scene(f, { rootInstanceId: context.occurrenceId }));
        }
        assert.equal(JSON.stringify([f.stock.request.importResult, f.stock.analysis, f.originCase.analysis]), before);
    }
});

test('A same-shell identity, typed get/put, exact state readers/writers and source/RHS evidence', async () => {
    const f = await fixture('A'), overall = scene(f), left = overall.children.find(c => c.label === 'left');
    const inside = scene(f, { rootInstanceId: left.id });
    assert.equal(inside.shell.id, left.id);
    const state = inside.storages[0];
    assert.equal(state.declaredType, 'Reg#(Bit#(8))');
    assert.equal(state.constructor, 'mkReg');
    assert.deepEqual(state.defaultExpressions, ['0']);
    assert.deepEqual(state.readers.map(b => b.label), ['get']);
    assert.deepEqual(state.writers.map(b => b.label), ['put']);
    const selected = scene(f, { rootInstanceId: left.id, selectedEntityId: state.id });
    assert.ok(selected.inspector.sections.length);
    assert.equal(selected.inspector.implementationAction.implementationProvider, 'instrumented');
    assert.equal(selected.correspondence.origin.claims.length, 1);
    assert.equal(selected.correspondence.origin.claims[0].source.kind, 'binding');
    const source = f.query.getSource(state.sourceRefs[0]);
    assert.equal(source.text, f.stock.analysis.sourceModel.sourceDocuments[0].content.slice(source.range.start, source.range.end));
    const get = inside.contacts.find(p => p.ownerId === left.id && p.label === 'get');
    const put = inside.contacts.find(p => p.ownerId === left.id && p.label === 'put');
    assert.equal(get.result.type, 'Bit#(8)'); assert.equal(put.category, 'Action');
    assert.deepEqual(put.arguments, [{ name: 'value', type: 'Bit#(8)', declaredType: 'Bit#(8)' }]);
    const method = scene(f, { rootInstanceId: left.id, selectedEntityId: get.id, disclosureState: { rtlSignals: true } });
    const binding = method.correspondence.stock.claims.find(c => c.relationKind === 'ordered-port-binding' && c.role === 'result');
    assert.deepEqual(binding.orderedBindings.map(b => b.formalValue), [13,14,15,16,17,18,19,20]);
    assert.deepEqual(binding.orderedBindings.map(b => b.actualValue), [21,22,23,24,25,26,27,28]);
    assert.equal(method.correspondence.origin.claims.length, 0);
    const expression = f.stock.analysis.sourceModel.expressions.find(e => e.text === 'value + 1');
    const rhs = scene(f, { rootInstanceId: left.id, selectedEntityId: expression.id });
    assert.equal(rhs.correspondence.origin.claims.length, 1);
    assert.equal(rhs.correspondence.origin.claims[0].source.range.text, expression.text);
});

test('instrumented RTL uses only its actual targets; unmapped cells and aliases gain no neighboring origins', async () => {
    const f = await fixture('A'), left = at(f, 'mkConnected.left');
    const state = scene(f, { rootInstanceId: left.id }).storages[0];
    const rtl = scene(f, { rootInstanceId: left.id, ownerInstanceId: left.id, selectedEntityId: state.id, sceneKind: 'rtl', implementationProvider: 'instrumented' });
    const model = f.originCase.request.importResult.implementation;
    assert.equal(rtl.snapshotId, model.snapshot.id);
    assert.equal(rtl.implementationContext.ownerInstanceId, left.id);
    assert.equal(rtl.implementationContext.highlightEntityIds.length, 1);
    assert.ok(rtl.children.every(c => model.entities[c.id]));
    assert.ok(rtl.contacts.every(c => model.entities[c.id]));
    const known = rtl.implementationContext.highlightEntityIds[0];
    assert.equal(model.cells[known].type, '$dff');
    const unmapped = rtl.children.find(c => c.id !== known && model.cells[c.id]?.type === '$mux');
    const unknown = scene(f, { rootInstanceId: rtl.rootInstanceId, ownerInstanceId: left.id, selectedEntityId: unmapped.id, sceneKind: 'rtl', implementationProvider: 'instrumented' });
    assert.equal(unknown.correspondence.origin.claims.length, 0);
    assert.deepEqual(unknown.implementationContext.highlightEntityIds, []);
    const alias = Object.values(model.aliases).find(a => a.occurrenceId === rtl.implementationContext.contextOccurrenceId);
    assert.equal(scene(f, { rootInstanceId: rtl.rootInstanceId, ownerInstanceId: left.id, selectedEntityId: alias.id, sceneKind: 'rtl', implementationProvider: 'instrumented' }).correspondence.origin.claims.length, 0);
    assert.throws(() => scene(f, { selectedEntityId: known }), { code: 'INVALID_INPUT' });
    assert.throws(() => scene(f, { sceneKind: 'rtl', implementationProvider: 'stock', selectedEntityId: known }), { code: 'INVALID_INPUT' });
});

test('C preserves symbolic declarations, concrete 8/12 contacts, wrappers and inlined origin contexts', async () => {
    const f = await fixture('C');
    for (const [name, width] of [['narrow', 8], ['wide', 12]]) {
        const wrapper = at(f, `mkReuse.${name}`), inlined = at(f, `mkReuse.${name}.implementation`);
        const w = scene(f, { rootInstanceId: wrapper.id });
        assert.ok(w.connections.some(c => c.members.some(m => m.kind === 'interface-return')));
        assert.equal(w.contacts.find(p => p.ownerId === wrapper.id && p.label === 'get').result.type, `Bit#(${width})`);
        const s = scene(f, { rootInstanceId: inlined.id });
        assert.equal(s.implementationContext.ownership, 'containing-only');
        assert.equal(s.implementationContext.implementationOccurrenceId, null);
        assert.equal(s.storages[0].declaredType, 'Reg#(Bit#(width))');
        assert.equal(s.contacts.find(p => p.ownerId === inlined.id && p.label === 'get').result.type, `Bit#(${width})`);
        const rtl = scene(f, { sceneKind: 'rtl', implementationProvider: 'instrumented', rootInstanceId: inlined.id, ownerInstanceId: inlined.id, selectedEntityId: s.storages[0].id });
        assert.deepEqual(rtl.implementationContext.occurrencePath, ['mkReuse', name]);
        assert.equal(rtl.implementationContext.ownerInstanceId, inlined.id);
        assert.equal(rtl.implementationContext.ownership, 'containing-only');
        const cell = f.originCase.request.importResult.implementation.cells[rtl.implementationContext.highlightEntityIds[0]];
        assert.equal(cell.raw.connections.Q.length, width);
        assert.ok(!rtl.children.some(c => c.label === 'implementation'));
    }
});

test('B has real behaviors and unsupported zero origins, without fake behavior blocks', async () => {
    const f = await fixture('B'), s = scene(f);
    assert.equal(s.children.length, 0); assert.equal(s.storages.length, 2);
    assert.equal(s.correspondence.origin.coverage.knownContributorObjects, 0);
    const count = s.storages.find(x => x.label === 'count');
    assert.deepEqual(count.writers.map(x => x.label).sort(), ['decrement', 'increment', 'inject']);
    const selected = scene(f, { selectedEntityId: count.id });
    assert.equal(selected.correspondence.origin.claims.length, 0);
    assert.equal(selected.correspondence.origin.completeOriginSet, 'not-established');
    assert.ok(selected.inspector.behaviorRefs.some(b => b.label === 'decrement'));
});

test('query boundaries reject foreign identities, hostile JSON, wrong source pairs and shifted source ranges', async () => {
    const f = await fixture('A');
    assert.throws(() => f.query.getScene(intent(f, { buildId: 'other' })), { code: 'INVALID_INPUT' });
    assert.throws(() => f.query.getScene(intent(f, { snapshotId: 'other' })), { code: 'SNAPSHOT_MISMATCH' });
    assert.throws(() => f.query.getScene(intent(f, { queryGeneration: -1 })), { code: 'INVALID_INPUT' });
    assert.throws(() => f.query.getScene(JSON.parse('{"__proto__":{}}')), { code: 'INVALID_INPUT' });
    assert.throws(() => createSceneQuery({ ...f.options, analysis: structuredClone(f.stock.analysis) }), { code: 'INVALID_INPUT' });
    assert.throws(() => createSceneQuery({ ...f.options, sourceBindings: [{ ...f.options.sourceBindings[0], originRevision: '0'.repeat(64) }] }), { code: 'SOURCE_REVISION_MISMATCH' });
    const noBinding = createSceneQuery({ ...f.options, sourceBindings: [] });
    const left = at(f, 'mkConnected.left'), state = scene(f, { rootInstanceId: left.id }).storages[0];
    assert.equal(noBinding.getScene(intent(f, { rootInstanceId: left.id, selectedEntityId: state.id })).scene.correspondence.origin.claims.length, 0);
    assert.throws(() => f.query.getSource({ ...state.sourceRefs[0], revision: '0'.repeat(64) }), { code: 'SOURCE_REVISION_MISMATCH' });
    assert.throws(() => f.query.getSource({ ...state.sourceRefs[0], range: { start: 0, end: 1 } }), { code: 'INVALID_RANGE' });
    const response = f.query.getScene(intent(f, { queryGeneration: 42 }));
    assert.equal(response.queryGeneration, 42); assert.equal(response.requestSnapshotId, f.options.importResult.snapshot.id);
});

test('complete visit queries retain BSV hierarchy through explicit RTL and enforce selection ownership', async () => {
    const f = await fixture('A'), left = at(f, 'mkConnected.left'), right = at(f, 'mkConnected.right');
    const inside = scene(f, { rootInstanceId: left.id, ownerInstanceId: left.id });
    const state = inside.storages[0];
    const selected = scene(f, { rootInstanceId: left.id, ownerInstanceId: left.id, selectedEntityId: state.id,
        viewport: { x: 12, y: 34, scale: 0.8 }, sourceContext: inside.sourceContext,
        implementationContext: inside.implementationContext, sceneId: inside.id, occurrencePath: inside.occurrencePath });
    const rtl = scene(f, { rootInstanceId: left.id, ownerInstanceId: left.id, selectedEntityId: state.id,
        sceneKind: 'rtl', implementationProvider: 'instrumented', sourceContext: selected.sourceContext });
    assert.equal(rtl.rootInstanceId, selected.rootInstanceId);
    assert.deepEqual(rtl.occurrencePath, selected.occurrencePath);
    assert.equal(rtl.sourceContext.selectedEntityId, state.id);
    assert.notEqual(rtl.shell.id, rtl.ownerInstanceId);
    assert.throws(() => scene(f, { rootInstanceId: left.id, ownerInstanceId: left.id,
        selectedEntityId: scene(f, { rootInstanceId: right.id }).storages[0].id }), { code: 'INVALID_INPUT' });
});

test('summary connections separate relation families and preserve folded implementation members', async () => {
    const f = await fixture('A'), left = at(f, 'mkConnected.left');
    const inside = scene(f, { rootInstanceId: left.id });
    assert.equal(inside.connections.length, 2);
    assert.ok(inside.connections.every(connection => connection.fromId !== connection.toId));
    assert.ok(inside.connections.every(connection => connection.memberRelationIds.length === 1));
    assert.equal(inside.projection.foldedRelationIds.length, 2);
    const overall = scene(f);
    assert.equal(overall.connections.length, 4);
    assert.ok(overall.connections.every(connection => connection.endpointIds.length === 2));
    assert.equal(overall.projection.foldedRelationIds.length, 2);
});

test('behavior inspection exposes canonical RHS actions and predicate identities', async () => {
    const f = await fixture('A'), left = at(f, 'mkConnected.left');
    const source = f.stock.analysis.sourceModel;
    const put = source.stateBehaviors.find(b => b.ownerInstanceId === left.id && b.name === 'put');
    const expression = source.expressions.find(e => e.text === 'value + 1');
    const selected = scene(f, { rootInstanceId: left.id, selectedEntityId: put.id });
    assert.ok(selected.inspector.sections.flatMap(section => section.actions).some(action => action.id === expression.id));
    const control = await fixture('B');
    const guarded = control.stock.analysis.sourceModel.stateBehaviors.find(b => b.predicateExpressionId);
    assert.ok(guarded);
    const detail = scene(control, { selectedEntityId: guarded.id });
    const behavior = detail.inspector.sections.find(section => section.behaviorId === guarded.id);
    assert.equal(behavior.guard.expressionId, guarded.predicateExpressionId);
});

test('verified signal disclosure is explicit and actual RTL shells remain inspectable', async () => {
    const f = await fixture('A'), left = at(f, 'mkConnected.left');
    const inside = scene(f, { rootInstanceId: left.id });
    const get = inside.contacts.find(contact => contact.label === 'get' && contact.ownerId === left.id);
    const selected = scene(f, { rootInstanceId: left.id, selectedEntityId: get.id });
    assert.ok(selected.inspector.sections.flatMap(section => section.actions).some(action => action.kind === 'disclosure' && action.id === 'rtlSignals'));
    const rtl = scene(f, { rootInstanceId: left.id, sceneKind: 'rtl' });
    const shell = scene(f, { rootInstanceId: left.id, ownerInstanceId: left.id, sceneKind: 'rtl', selectedEntityId: rtl.shell.id });
    assert.equal(shell.selection.selectedEntityId, rtl.shell.id);
    assert.equal(shell.sourceContext.selectedEntityId, null);
});

test('RTL literal vectors aggregate by real contact without sharing unrelated constants', async () => {
    const f = await fixture('A'), left = at(f, 'mkConnected.left');
    const rtl = scene(f, { rootInstanceId: left.id, sceneKind: 'rtl', implementationProvider: 'instrumented' });
    const literals = rtl.connections.filter(connection => connection.kind === 'constant-connection' && connection.endpointIds.length);
    const contacts = literals.map(connection => JSON.stringify(connection.endpointIds));
    assert.equal(new Set(contacts).size, contacts.length);
    assert.ok(literals.some(connection => connection.members.length > 1));
    for (const vector of literals) {
        assert.deepEqual(vector.rawBits, vector.members.map(member => member.value));
        assert.equal(new Set(vector.bits).size, vector.bits.length);
    }
});
