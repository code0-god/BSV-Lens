'use strict';
const assert = require('node:assert/strict');
const ordered = values => [...values].sort();
const unique = values => [...new Set(values)];
function assertConnectionDisclosure(connection, inspector, rendered) {
    assert.equal(connection.kind, 'semantic-connection');
    const expected = connection.memberRelationIds;
    assert.ok(expected.length > 0);
    assert.equal(unique(expected).length, expected.length);
    assert.deepEqual(ordered(connection.members.map(item => item.id)), ordered(expected));
    assert.deepEqual(ordered(inspector.relationMembers.map(item => item.id)), ordered(expected));
    const detail = inspector.connectionEssentials;
    assert.ok(detail, 'Selected summary must expose endpoint and family details');
    assert.equal(detail.family, connection.relationFamily);
    assert.equal(detail.memberCount, expected.length);
    assert.deepEqual(ordered(detail.memberRelationIds), ordered(expected));
    for (const role of ['from', 'to']) {
        const endpointIds = ordered(unique(connection.members.map(item => item[`${role}Id`])));
        assert.deepEqual(ordered(detail[role].map(item => item.id)), endpointIds);
        assert.deepEqual(ordered(rendered.endpoints.filter(item => item.role === role).map(item => item.id)), endpointIds);
        for (const endpoint of detail[role]) {
            const actual = rendered.endpoints.find(item => item.role === role && item.id === endpoint.id);
            assert.ok(endpoint.label && endpoint.ownerPath);
            assert.equal(actual.label, endpoint.label);
        }
    }
    assert.ok(rendered.text.includes(detail.family), 'Actual Inspector omits the relation family');
    assert.deepEqual(ordered(rendered.memberIds), ordered(expected));
    for (const item of inspector.relationMembers) {
        const original = connection.members.find(member => member.id === item.id);
        assert.equal(item.fromId, original.fromId); assert.equal(item.toId, original.toId);
        assert.equal(item.kind, original.kind);
    }
    return { memberIds: expected, family: detail.family, from: detail.from, to: detail.to };
}
function selfTest() {
    const member = { id: 'relation-a', kind: 'return', fromId: 'cell-method-a', toId: 'owner-method-b' };
    const connection = { kind: 'semantic-connection', relationFamily: 'return', memberRelationIds: [member.id], members: [member] };
    const endpoint = (id, label) => ({ id, label, ownerPath: 'actual.instance' });
    const inspector = { relationMembers: [member], connectionEssentials: { family: 'return', memberCount: 1,
        memberRelationIds: [member.id], from: [endpoint(member.fromId, 'input')], to: [endpoint(member.toId, 'output')] } };
    const rendered = { text: 'return: input / output', memberIds: [member.id], endpoints: [
        { role: 'from', id: member.fromId, label: 'input' }, { role: 'to', id: member.toId, label: 'output' }] };
    assertConnectionDisclosure(connection, inspector, rendered);
    const bad = [value => { value.inspector.relationMembers = []; }, value => { value.inspector.connectionEssentials.family = 'alias'; },
        value => { value.inspector.connectionEssentials.from[0].id = 'foreign'; }, value => { value.rendered.memberIds = []; },
        value => { value.rendered.endpoints[0].label = '...'; }, value => { value.inspector.relationMembers[0].toId = 'foreign'; }];
    for (const change of bad) { const value = structuredClone({ connection, inspector, rendered }); change(value);
        assert.throws(() => assertConnectionDisclosure(value.connection, value.inspector, value.rendered)); }
    console.log('Native summary disclosure oracle: 1 positive / 6 negative checks PASS');
}
if (require.main === module) selfTest();
module.exports = { assertConnectionDisclosure };
