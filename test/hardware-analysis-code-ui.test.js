'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalog } = require('../experiments/hardware/g4/server');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
const { buildSource } = require('../src/hardware/correspondence/source');
const { hash } = require('../src/hardware/json');
const { createAnalysisQuery } = require('../src/hardware/analysis');
const UI = require('../media/hardware-analysis');
require('../media/hardware-inspector');
let catalog;
async function actual(build = 'A') {
    catalog ||= createCatalog();
    const query = (await catalog).find(q => q.getCatalogEntry().buildId === build), entry = query.getCatalogEntry();
    const input = { buildId: build, snapshotId: entry.snapshotId, ownerInstanceId: entry.rootInstanceId,
        rootInstanceId: entry.rootInstanceId, sceneKind: 'bsv', implementationProvider: 'stock', queryGeneration: 1 };
    return { query, input, scene: query.getScene(input).scene, source: (await loadCapturedCase(build)).analysis.sourceModel };
}
function visit(scene, result = null, request = null, disclosureState = {}) {
    return { ...scene, selectedEntityId: scene.selection.selectedEntityId, selectedRelationId: scene.selection.selectedRelationId,
        disclosureState, analysis: result ? { result, request } : null };
}
async function execute(f, scene, action) {
    const request = { analysisId: scene.provenance.analysisId, snapshotId: scene.implementationContext.snapshotId,
        implementationProvider: scene.implementationContext.provider, queryGeneration: 1,
        ...UI.sourceInput(scene, action) };
    return { request, result: await f.query.analyze(request) };
}
// This DOM adapter records native element/event contracts only. All source records,
// analysis results, scenes, and navigation targets come from the real product.
function dom() {
    const nodes = [];
    class Node {
        constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.scrollTop = 0; this.classList = { add() {}, toggle() {} }; nodes.push(this); }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = children; }
        setAttribute(key, value) { this.attributes[key] = value; }
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
        querySelectorAll(selector) {
            const key = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1]?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            assert.ok(key, `Unsupported DOM selector: ${selector}`);
            return this.children.flatMap(child => [...(Object.hasOwn(child.dataset, key) ? [child] : []), ...child.querySelectorAll(selector)]);
        }
        async fire(type) { for (const fn of this.listeners[type] || []) await fn({ target: this }); }
    }
    const ids = new Map(['selection-title', 'inspector-content', 'capability-content', 'inspector'].map(id => [id, new Node('div')]));
    global.document = { createElement: tag => new Node(tag), createDocumentFragment: () => new Node('fragment'), getElementById: id => ids.get(id) || nodes.find(n => n.id === id) };
    return { nodes, ids };
}
function render(scene, state, handlers = {}) {
    const d = dom();
    global.BsvHardwareInspector.render(scene, state, { analysisContext: { capabilities: Object.fromEntries(['state-accesses', 'behavior', 'call-site', 'source-dependencies', 'correspondence'].map(k => [k, 'available'])) },
        analysisProjection: UI.projectAnalysis(scene, state.analysis?.result), ...handlers });
    return d;
}
test('G5-C actual storage UI actions submit canonical source seed and render selectable reader/writer code', async () => {
    const f = await actual(), child = f.scene.children.find(c => c.label === 'left');
    const interior = f.query.getScene({ ...f.input, rootInstanceId: child.id, ownerInstanceId: child.id }).scene;
    const storage = interior.storages[0], scene = f.query.getScene({ ...f.input, rootInstanceId: child.id, ownerInstanceId: child.id, selectedEntityId: storage.id }).scene;
    const actions = UI.sourceActions(scene, visit(scene));
    const action = actions.find(a => a.kind === 'state-accesses');
    assert.equal(action.entityId, storage.id); assert.equal(action.ownerInstanceId, child.id);
    const { result, request } = await execute(f, scene, action);
    assert.equal(result.code.storage.id, storage.id);
    const submitted = [], d = render(scene, visit(scene, result, request), { analyze: input => submitted.push(input), patchAnalysis() {} });
    for (const behavior of [...result.readers, ...result.writers]) {
        const control = d.nodes.find(n => n.dataset.sourceEntityId === behavior.id && n.dataset.analysisKind === 'behavior');
        assert.ok(control); await control.fire('click');
        assert.equal(submitted.at(-1).seed.entityId, behavior.id);
        assert.equal(submitted.at(-1).ownerInstanceId, child.id);
    }
    assert.ok(d.nodes.some(n => n.id === 'code-drawer'));
});
test('G5-C real connection call/argument/producer context retains original references and actions', async () => {
    const f = await actual(), call = f.source.callSites.find(c => c.calleeName === 'right.put');
    const { request, result } = await execute(f, f.scene, { kind: 'call-site', entityId: call.id, ownerInstanceId: f.scene.ownerInstanceId });
    const records = UI.codeRecords(result), mapping = result.callMappings[0];
    assert.ok(records.some(r => r.role === 'call' && r.entityId === call.id));
    assert.ok(records.some(r => r.role === 'argument' && r.entityId === call.argumentExpressionIds[0]));
    assert.notEqual(mapping.producer[0].ownerInstanceId, mapping.consumer.ownerInstanceId);
    const patches = [], opened = [], d = render(f.scene, visit(f.scene, result, request), {
        patchAnalysis: value => patches.push(value), analyze() {}, openSource: ref => opened.push(f.query.getSource(ref)) });
    for (const role of ['caller', 'producer', 'consumer', 'actual-formal']) assert.ok(d.nodes.some(n => n.dataset.codeContext === role));
    const ref = result.sourceRefs.find(r => r.semanticId === call.id);
    const source = d.nodes.find(n => n.dataset.sourceReferenceId === ref.id && n.tagName === 'pre');
    assert.equal(source.textContent, ref.range.text); assert.equal(source.dataset.sourceRevision, ref.revision);
    assert.equal(Number(source.dataset.rangeStart), ref.range.start); assert.equal(Number(source.dataset.rangeEnd), ref.range.end);
    const choose = d.nodes.find(n => n.dataset.codeRecordId && n.dataset.sourceEntityId === call.argumentExpressionIds[0]);
    await choose.fire('click'); assert.equal(patches.at(-1).codeSelection, choose.dataset.codeRecordId);
    assert.equal(choose.dataset.analysisEntityId, call.argumentExpressionIds[0]);
    await d.nodes.find(n => n.dataset.analysisSourceId === ref.id).fire('click');
    assert.equal(opened[0].id, ref.id); assert.equal(opened[0].readOnly, true); assert.equal(opened[0].text, ref.range.text);
    const restored = render(f.scene, visit(f.scene, result, request, { analysis: { codeScroll: { [ref.id]: { top: 31, left: 17 } } } }), {
        codeScroll: (id, scroll) => patches.push({ id, scroll }) });
    const pre = restored.nodes.find(n => n.dataset.sourceReferenceId === ref.id);
    assert.equal(pre.scrollTop, 31); assert.equal(pre.scrollLeft, 17);
    pre.scrollTop = 42; await pre.fire('scroll'); assert.deepEqual(patches.at(-1), { id: ref.id, scroll: { top: 42, left: 17 } });
});
test('G5-C source-only helpers preserve signed conditions, local definition/use, return and null RTL', async () => {
    const text = `package UiHelpers;
function Bit#(8) inc(Bit#(8) x); return x + 1; endfunction
function Bit#(8) choose(Bit#(8) x, Bool flag);
  Bit#(8) y = x;
  if (flag) y = inc(y); else y = 3;
  return y;
endfunction
endpackage`;
    const built = buildSource([{ pathRef: 'synthetic/UiHelpers.bsv', contentHash: hash(text), text }]);
    const sourceModel = { ...built.semantic, sourceReferences: built.references, supplements: built.supplements };
    const api = createAnalysisQuery({ sourceModel }), fn = sourceModel.functionDefinitions.find(f => f.name === 'choose');
    const request = { kind: 'behavior', analysisId: api.getContext().analysisId, snapshotId: null,
        implementationProvider: 'stock', ownerInstanceId: null, implementationOccurrenceId: null,
        seed: { entityId: fn.id }, scope: { kind: 'source-only', rootOccurrenceId: null }, mode: 'build', queryGeneration: 1 };
    const result = await api.query(request), records = UI.codeRecords(result);
    for (const role of ['condition', 'local-definition', 'local-use', 'return', 'call', 'argument']) assert.ok(records.some(r => r.role === role), role);
    assert.ok(records.some(r => r.role === 'condition' && r.polarity === false));
    const f = await actual(), d = render(f.scene, visit(f.scene, result, request), { patchAnalysis() {}, analyze() {} });
    for (const section of ['predicate', 'body-conditions', 'readiness', 'scheduling', 'assertions', 'state-effects']) assert.ok(d.nodes.some(n => n.dataset.codeSection === section), section);
    assert.equal(d.nodes.filter(n => n.dataset.analysisRevealId).length, 0);
    for (const record of records.filter(r => r.kind)) {
        const input = UI.sourceInput(f.scene, record, { request, result });
        assert.equal(input.implementationOccurrenceId, null); assert.equal(input.ownerInstanceId, null);
        assert.deepEqual(input.scope, request.scope);
        await api.query({ ...request, ...input });
    }
    const helper = records.find(r => r.role === 'function' && r.entityId !== fn.id);
    assert.equal(helper.entryCallSiteId, sourceModel.callSites[0].id);
    assert.equal(UI.sourceInput(f.scene, helper, { request, result }).seed.entryCallSiteId, helper.entryCallSiteId);
});
test('G5-C G3 explanations keep claims unchanged and distinguish generated evidence from approved originals', async () => {
    const f = await actual(), child = f.scene.children.find(c => c.label === 'left');
    const interior = f.query.getScene({ ...f.input, rootInstanceId: child.id, ownerInstanceId: child.id }).scene;
    const { result, request } = await execute(f, interior, { kind: 'correspondence', entityId: interior.storages[0].id, ownerInstanceId: child.id });
    const before = JSON.stringify(result), opened = [];
    const d = render(interior, visit(interior, result, request), { patchAnalysis() {},
        openImplementation: () => opened.push('instrumented'), openSource: ref => opened.push(f.query.getSource(ref)) });
    const claim = result.correspondence.origin.claims[0];
    assert.ok(d.nodes.some(n => n.dataset.claimId === claim.id));
    assert.ok(d.nodes.some(n => n.dataset.sourceRole === 'generated'));
    assert.equal(result.correspondence.completeOriginSet, false);
    await d.nodes.find(n => n.dataset.analysisRevealId === claim.target.entityId).fire('click');
    assert.equal(opened[0], 'instrumented');
    for (const ref of result.sourceRefs) {
        await d.nodes.find(n => n.dataset.analysisSourceId === ref.id).fire('click');
        assert.equal(opened.at(-1).text, ref.range.text);
    }
    assert.equal(JSON.stringify(result), before);
});

test('G5-C off-scene Reveal stays available beyond frontend hierarchy knowledge and uses the real navigation resolver', async () => {
    const { createNavigation } = require('../media/hardware-navigation'), layout = require('../media/hardware-layout');
    const f = await actual(), child = f.scene.children.find(c => c.label === 'left');
    const resolved = [], nav = createNavigation({ queryScene: input => f.query.getScene(input),
        queryAnalysis: (input, options) => f.query.analyze(input, options),
        resolveAnalysisTarget: input => { resolved.push(input); return f.query.revealAnalysisTarget(input); },
        layoutScene: layout.layout, fitViewport: layout.fitViewport, getSize: () => ({ width: 1100, height: 650 }) });
    assert.equal(await nav.navigate({ ...f.input, sceneKind: 'rtl', rootInstanceId: child.id, ownerInstanceId: child.id }), true);
    let state = nav.getState();
    const contact = state.scene.contacts.find(c => c.ownerId === state.scene.shell.id && c.label === 'get');
    assert.equal(await nav.analyze({ kind: 'same-net', seed: { entityId: contact.id, indices: [0] },
        scope: { kind: 'design', rootOccurrenceId: state.current.implementationContext.rootOccurrenceId } }), true);
    state = nav.getState();
    const target = state.current.analysis.result.objects.find(o => o.occurrenceId === state.scene.implementationContext.parentOccurrenceId);
    assert.equal(UI.revealIntent(state.scene, target, state.current.analysis.result), null);
    assert.equal(UI.canReveal(target), true);
    state.current.disclosureState.analysis = { referenceLimit: state.current.analysis.result.objects.length };
    const d = render(state.scene, state.current, { revealAnalysis: ref => nav.revealAnalysis(ref), patchAnalysis() {} });
    const reveal = d.nodes.find(n => n.dataset.analysisRevealId === target.entityId);
    assert.ok(reveal); await reveal.fire('click');
    assert.equal(resolved.length, 1); assert.equal(resolved[0].target.entityId, target.entityId);
    assert.equal(nav.getState().current.selectedEntityId, target.entityId);
    assert.equal(nav.getState().current.implementationContext.contextOccurrenceId, target.occurrenceId);
    assert.equal(nav.back(), true); assert.deepEqual(nav.getState().current.analysis, state.current.analysis);
});
