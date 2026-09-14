'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadNativeInput } = require('../src/hardware/native-input');
const { createArchitecture } = require('../src/hardware/architecture');
const { stable } = require('../src/hardware/json');
const { validateMembership } = require('../experiments/hardware/g4-fix/oracle/geometry.cjs');

const source = `package Nested;
interface Leaf;
 method Action put(Bit#(8) x);
 method Bit#(8) get;
endinterface
interface Branch;
 interface Leaf requests;
 interface Leaf responses;
endinterface
interface Tree;
 interface Branch alpha;
 interface Branch beta;
endinterface
module mkBranch(Branch); endmodule
module mkTree(Tree);
 Branch left <- mkBranch;
 Branch right <- mkBranch;
 interface alpha = left;
 interface beta = right;
endmodule
endpackage
`;
async function input(text = source) {
    const base = path.resolve('.build/hardware/runs');
    await fs.mkdir(base, { recursive: true });
    const root = path.join(await fs.mkdtemp(path.join(base, 'g6-usability-projection-test-')), 'g6-usability');
    await fs.mkdir(root); await fs.writeFile(path.join(root, 'Input.bsv'), text);
    return loadNativeInput({ sourceRoot: root });
}
function scene(query, extra = {}) {
    const entry = query.getCatalogEntry();
    return query.getScene({ buildId: entry.buildId, snapshotId: entry.snapshotId, queryGeneration: 1, ...extra }).scene;
}

test('overview folds leaf endpoints by exact interface path and discloses canonical members on selection', async () => {
    const value = await input(), query = value.catalog[0], before = stable(value.analysis);
    const view = scene(query);
    assert.equal(view.projection.kind, 'bsv-overview');
    assert.equal(view.contacts.length, 0);
    assert.ok(view.interfaceGroups.every(group => group.interfacePath.length <= 1));
    const alpha = view.interfaceGroups.find(group => group.ownerId === view.shell.id && group.label === 'alpha');
    assert.ok(alpha); assert.equal(alpha.memberContactIds.length, 4);
    const selected = scene(query, { selectedEntityId: alpha.id });
    assert.deepEqual(selected.inspector.interfaceMembers.map(member => member.interfacePath), [['alpha', 'requests'], ['alpha', 'responses']]);
    const requests = selected.inspector.interfaceMembers[0];
    const detail = scene(query, { selectedEntityId: requests.id });
    assert.deepEqual(detail.inspector.interfaceMembers.map(member => member.label), ['put', 'get']);
    assert.equal(stable(value.analysis), before);
});

test('summary membership is an exact canonical partition and never mixes relation families', async () => {
    const value = await input(), architecture = createArchitecture({ analysis: value.analysis });
    const view = scene(value.catalog[0]);
    const expected = Object.values(architecture.relations).filter(relation => relation.ownerInstanceId === view.ownerInstanceId).map(relation => relation.id).sort();
    const actual = [...view.connections.flatMap(connection => connection.memberRelationIds), ...view.projection.foldedRelationIds, ...view.projection.scopeOutsideRelationIds];
    assert.equal(new Set(actual).size, actual.length);
    assert.deepEqual(actual.sort(), expected);
    assert.deepEqual(validateMembership(view, { architecture }).findings, []);
    for (const connection of view.connections) {
        assert.equal(new Set(connection.members.map(member => member.kind)).size, 1);
        assert.equal(connection.relationFamily, connection.members[0].kind);
        const selected = scene(value.catalog[0], { selectedRelationId: connection.id });
        assert.ok(selected.inspector.sections.some(section => section.id === 'relations'));
        assert.ok(selected.inspector.sourceRefs.length);
        if (connection.relationFamily === 'interface-forward') {
            assert.equal(selected.inspector.connectionEssentials.meaning, 'binding');
            assert.equal(selected.inspector.connectionEssentials.direction, 'binding');
            assert.ok(!selected.inspector.title.includes('→'));
        }
    }
});

test('independent overview membership rejects missing groups, merged families and hidden relations', async () => {
    const value = await input(), architecture = createArchitecture({ analysis: value.analysis }), original = scene(value.catalog[0]);
    for (const mutate of [
        view => { view.interfaceGroups.pop(); },
        view => { view.connections[0].relationFamily = 'payload'; },
        view => { view.connections.pop(); },
        view => { view.projection.sourceRevision = 'foreign'; },
        view => { view.projection.scopeOutsideRelationIds.push(view.connections[0].memberRelationIds[0]); }
    ]) {
        const view = structuredClone(original); mutate(view);
        assert.equal(validateMembership(view, { architecture }).valid, false);
    }
});

test('constructor-bound external source endpoint becomes an explicit scope continuation without adding a sibling block', async () => {
    const value = await input(`package External;
interface Producer;
 method Bit#(8) get;
endinterface
module mkProducer(Producer);
 method Bit#(8) get = 1;
endmodule
module mkConsumer#(Producer producer)(Empty);
 Reg#(Bit#(8)) state <- mkReg(0);
 rule tick; state <= producer.get; endrule
endmodule
module mkTop(Empty);
 Producer producer <- mkProducer;
 Empty consumer <- mkConsumer(producer);
endmodule
endpackage
`);
    const query = value.catalog[0], overall = scene(query), consumer = overall.children.find(child => child.label === 'consumer');
    const view = scene(query, { rootInstanceId: consumer.id }), architecture = createArchitecture({ analysis: value.analysis });
    assert.equal(view.children.length, 0);
    const external = view.interfaceGroups.find(group => group.continuation);
    assert.ok(external); assert.equal(external.continuation.path, 'mkTop.producer');
    assert.ok(view.connections.some(connection => connection.endpointIds.includes(external.id)));
    assert.deepEqual(validateMembership(view, { architecture }).findings, []);
    const inspected = scene(query, { rootInstanceId: consumer.id, selectedEntityId: external.id });
    assert.ok(inspected.inspector.sections.some(section => section.id === 'interface-group'));
    const invalid = structuredClone(view); invalid.interfaceGroups.find(group => group.continuation).continuation.ownerInstanceId = consumer.id;
    assert.equal(validateMembership(invalid, { architecture }).valid, false);
    assert.throws(() => scene(query, { rootInstanceId: consumer.id, selectedEntityId: overall.children.find(child => child.label === 'producer').id }), { code: 'INVALID_INPUT' });
});

test('unresolved module family remains an inspectable placeholder instead of disappearing', async () => {
    const value = await input(`package UnresolvedFamily;
interface MissingIfc;
endinterface
module mkTop(Empty);
    Vector#(count, MissingIfc) missing <- replicateM(mkMissing);
endmodule
endpackage
`);
    const architecture = createArchitecture({ analysis: value.analysis });
    const family = Object.values(architecture.occurrences).find((item) => item.label === 'missing');
    assert.ok(family);
    assert.equal(family.status, 'unresolved');
    assert.equal(family.unresolvedReason, 'module-constructor-unresolved');
    assert.equal(family.family.resolutionStatus, 'unresolved');
    assert.equal(family.interaction.kind, 'inspect');
    const root = Object.values(architecture.occurrences).find((item) => item.parentInstanceId === null);
    assert.ok(root.children.includes(family.id));
    const view = scene(value.catalog[0]);
    const child = view.children.find((item) => item.id === family.id);
    assert.ok(child);
    assert.equal(child.status, 'unresolved');
    assert.equal(child.interaction.kind, 'inspect');
});

test('relation list names distinguish occurrences and repeated call sites without changing selection identity', async () => {
    const value = await input(`package Calls;
interface Port;
 method Action put(Bit#(8) value);
endinterface
module mkPort(Port);
 method Action put(Bit#(8) value); noAction; endmethod
endmodule
module mkCalls(Empty);
 Port left <- mkPort;
 Port right <- mkPort;
 Reg#(Bit#(8)) state <- mkReg(0);
 rule tick;
  left.put(1);
  left.put(2);
  right.put(3);
 endrule
 rule reads;
  if (state == 0) begin
   let previous = state + state;
   state <= previous;
  end
 endrule
endmodule
endpackage
`);
    const query = value.catalog[0], view = scene(query), architecture = createArchitecture({ analysis: value.analysis });
    const calls = view.inspector.relationMembers.filter(member => member.kind === 'invoke');
    assert.equal(calls.length, 3);
    assert.equal(new Set(calls.map(member => member.label)).size, 3);
    assert.equal(calls.filter(member => member.label.includes('left.put')).length, 2);
    assert.equal(calls.filter(member => member.label.includes('right.put')).length, 1);
    assert.ok(calls.filter(member => member.label.includes('left.put')).every(member => /Input\.bsv:\d+:\d+/.test(member.label)));
    const reads = view.inspector.relationMembers.filter(member => member.kind === 'state-read');
    assert.ok(reads.length >= 2);
    assert.equal(new Set(reads.map(member => member.label)).size, reads.length);
    for (const member of calls) {
        assert.equal(member.interaction.entityId, member.id);
        assert.equal(member.interaction.relationId, member.id);
        assert.deepEqual(member.sourceRefIds, architecture.relations[member.id].sourceRefs.map(ref => ref.id));
        assert.equal(scene(query, { selectedRelationId: member.id }).selection.selectedRelationId, member.id);
        assert.ok(!member.label.includes(member.id));
    }
});

test('selected public summary exposes exact original members, endpoints and source behavior actions', async () => {
    const value = await input(`package Summary;
interface Port;
 method Bit#(8) first;
 method Bit#(8) second;
 method Bit#(8) third;
 method Bit#(8) fourth;
 method Bit#(8) fifth;
endinterface
interface Top;
 method Bit#(8) getA;
 method Bit#(8) getB;
endinterface
module mkPort(Port);
 method Bit#(8) first = 1;
 method Bit#(8) second = 2;
 method Bit#(8) third = 3;
 method Bit#(8) fourth = 4;
 method Bit#(8) fifth = 5;
endmodule
module mkTop(Top);
 Port unit <- mkPort;
 method Bit#(8) getA = unit.first;
 method Bit#(8) getB = unit.second;
endmodule
endpackage
`);
    const query = value.catalog[0], overall = scene(query), summary = overall.connections.find(connection => connection.memberRelationIds.length >= 2);
    assert.ok(summary);
    const selected = scene(query, { selectedRelationId: summary.id });
    assert.deepEqual(selected.inspector.relationMembers.map(member => member.id), summary.memberRelationIds);
    const essentials = selected.inspector.connectionEssentials;
    assert.equal(essentials.family, summary.relationFamily);
    assert.equal(essentials.meaning, 'source-relation');
    assert.equal(essentials.ownerInstanceId, overall.ownerInstanceId);
    assert.deepEqual(essentials.memberRelationIds, summary.memberRelationIds);
    assert.deepEqual(essentials.from.map(endpoint => endpoint.label), ['unit.first', 'unit.second']);
    assert.deepEqual(essentials.to.map(endpoint => endpoint.label), ['method getA', 'method getB']);
    assert.ok(selected.inspector.title.includes('unit.first'));
    for (const member of selected.inspector.relationMembers) {
        const detail = scene(query, { selectedRelationId: member.id });
        assert.deepEqual(detail.inspector.connectionEssentials.memberRelationIds, [member.id]);
        assert.ok(detail.inspector.sections.find(section => section.id === 'behavior-actions').actions.length);
        assert.ok(detail.inspector.sourceRefs.length);
        for (const ref of detail.inspector.sourceRefs) assert.equal(query.getSource(ref).text, value.sources[0].capturedText.slice(ref.range.start, ref.range.end));
    }
});
