"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGeometry, validateMembership, selectionIdentity, intersection, EPS } =
    require('../experiments/hardware/g4-fix/oracle/geometry.cjs');
function fixture(specs = [{ id: 'occ/a/net', segments: [[20, 40, 180, 40]] }]) {
    const scene = { sceneKind: 'rtl', snapshotId: 'snapshot', shell: { id: 'shell', label: '' },
        children: [], storages: [], contacts: [], interfaceGroups: [], connections: [] };
    const geometry = { valid: true, nodes: [{ id: 'shell', x: 0, y: 0, width: 200, height: 200 }],
        contacts: [], groups: [], labels: [], routes: [], bounds: { x: -10, y: -10, width: 220, height: 220 } };
    for (const spec of specs) {
        const endpoints = spec.endpoints || [spec.segments[0].slice(0, 2), spec.segments.at(-1).slice(2)];
        const connection = { id: spec.id, label: '', direction: 'net', style: 'physical', bits: [`${spec.id}/bit/2`],
            rawBits: [2], memberRelationIds: [`${spec.id}/bit/2`], members: [], endpointIds: [], incidences: [] };
        for (const [i, [x, y]] of endpoints.entries()) {
            const id = `${spec.id}/pin/${i}`, incidenceId = JSON.stringify([spec.id, id]);
            const first = spec.segments.find(s => s[0] === x && s[1] === y || s[2] === x && s[3] === y);
            const other = first[0] === x && first[1] === y ? first.slice(2) : first.slice(0, 2);
            const side = other[0] > x ? 'right' : other[0] < x ? 'left' : other[1] > y ? 'bottom' : 'top';
            const ownerId = `${id}/body`;
            scene.children.push({ id: ownerId, label: '' });
            geometry.nodes.push({ id: ownerId, x: x - (side === 'right' ? 2 : side === 'left' ? 0 : 1),
                y: y - (side === 'bottom' ? 2 : side === 'top' ? 0 : 1), width: 2, height: 2 });
            scene.contacts.push({ id, ownerId, bits: connection.bits, label: '', detail: '' });
            connection.incidences.push({ contactId: id,
                members: [{ bitId: connection.bits[0], endpointId: id, index: 0, contactIndex: 0, boundaryId: null, formalBitId: null }] });
            connection.endpointIds.push(id);
            geometry.contacts.push({ id, ownerId, x, y, side, boundary: false,
                slots: [{ id: incidenceId, connectionId: spec.id, contactId: id, x, y, indices: [0], bitIds: connection.bits }] });
        }
        const attachments = geometry.contacts.filter(c => connection.endpointIds.includes(c.id)).map(c => ({ ...c.slots[0] }));
        geometry.routes.push({ id: spec.id, segments: spec.segments, points: attachments, attachments,
            junctions: spec.junctions || [], unconnected: !endpoints.length,
            path: spec.segments.map(s => `M${s[0]},${s[1]}L${s[2]},${s[3]}`).join(' ') });
        scene.connections.push(connection);
    }
    return { scene, geometry };
}
const report = f => validateGeometry(f.scene, f.geometry);
const codes = f => report(f).findings.map(f => f.code);
test('G01 cross-owner overlap includes escapes; names and raw integers cannot hide it', () => {
    const f = fixture([{ id: 'occ/a/net', segments: [[20, 40, 120, 40]] }, { id: 'occ/b/net', segments: [[60, 40, 180, 40]] }]);
    assert.ok(codes(f).includes('G01'));
    for (const c of f.scene.connections) { c.label = 'same'; c.rawBits = [2]; }
    assert.ok(codes(f).includes('G01'));
    f.scene.connections[0].label = 'renamed Unsupported';
    assert.ok(codes(f).includes('G01'));
});
test('G02 proper point crossing has no overlap or junction dot', () => {
    const f = fixture([{ id: 'a', segments: [[20, 100, 180, 100]] }, { id: 'b', segments: [[100, 20, 100, 180]] }]);
    assert.deepEqual(codes(f), []); assert.equal(report(f).metrics.crossings, 1);
    f.geometry.routes[0].junctions.push({ x: 100, y: 100 }); assert.ok(codes(f).includes('G02'));
    assert.equal(intersection([0, 0, 10, 0], [10, -10, 10, 10]).proper, false);
});
test('G03 same-owner fanout trunk is valid and dots need branching', () => {
    const f = fixture([{ id: 'a', segments: [[20, 100, 180, 100], [60, 100, 120, 100], [100, 100, 100, 180]],
        endpoints: [[20, 100], [180, 100], [100, 180]], junctions: [{ x: 100, y: 100 }] }]);
    assert.deepEqual(codes(f), []); f.geometry.routes[0].junctions = []; assert.ok(codes(f).includes('G03'));
});
test('G04/G05 own contact escape, unrelated contact corridor and unrelated body', () => {
    const f = fixture(); assert.deepEqual(codes(f), []);
    f.scene.contacts.push({ id: 'foreign', ownerId: 'shell', label: '', detail: '', bits: [] });
    f.geometry.contacts.push({ id: 'foreign', ownerId: 'shell', x: 100, y: 40, side: 'left', slots: [] });
    assert.ok(codes(f).includes('G05'));
    f.scene.children.push({ id: 'obstacle', label: '' }); f.geometry.nodes.push({ id: 'obstacle', x: 90, y: 30, width: 20, height: 20 });
    assert.ok(codes(f).includes('G04'));
});
test('G06 wire/label, node/label and label/label collisions', () => {
    const f = fixture(); f.scene.connections[0].label = 'net';
    f.geometry.labels.push({ ownerId: f.scene.connections[0].id, role: 'connection', text: 'net', bounds: { x: 80, y: 36, width: 30, height: 12 } });
    assert.ok(codes(f).includes('G06')); f.geometry.labels[0].bounds = { x: 18, y: 39, width: 10, height: 12 };
    assert.ok(report(f).findings.some(f => f.code === 'G06' && f.kind === 'label-node'));
    f.geometry.labels[0].bounds = { x: 60, y: 60, width: 30, height: 12 }; f.geometry.labels.push({ ...f.geometry.labels[0], role: 'detail' });
    assert.ok(report(f).findings.some(f => f.code === 'G06' && f.kind === 'label-label'));
});
test('G07 unauthorized shell boundary crossing', () => {
    const f = fixture(); f.geometry.routes[0].segments.push([100, 40, 100, -5]); assert.ok(codes(f).includes('G07'));
});
test('G08/G09 dangling, shifted endpoints and wrong indices', () => {
    const f = fixture(); f.geometry.routes[0].segments[0][2] -= 1;
    assert.ok(codes(f).includes('G08')); assert.ok(codes(f).includes('G09'));
    const shifted = fixture(); shifted.geometry.routes[0].attachments[0].x += 1; assert.ok(codes(shifted).includes('G09'));
    const wrong = fixture(); wrong.geometry.contacts[0].slots[0].indices = [1]; assert.ok(codes(wrong).includes('G09'));
});
test('G10 route and label bounds, not just bodies', () => {
    const f = fixture(); f.geometry.bounds.width = 100; assert.ok(codes(f).includes('G10'));
    const label = fixture(); label.geometry.labels.push({ ownerId: label.scene.connections[0].id, role: 'connection', text: 'outside',
        bounds: { x: 205, y: 30, width: 50, height: 10 } }); assert.ok(codes(label).includes('G10'));
});
test('G11 selection/highlight cannot change ownership', () => {
    const f = fixture(), selected = structuredClone(f.scene); selected.selection = { selectedRelationId: selected.connections[0].id };
    selected.implementationContext = { highlightEntityIds: ['something'] }; assert.equal(selectionIdentity(f.scene), selectionIdentity(selected));
    selected.connections[0].bits.push('foreign/bit/2'); assert.notEqual(selectionIdentity(f.scene), selectionIdentity(selected));
    assert.ok(validateGeometry(f.scene, f.geometry, { selectedScene: selected }).findings.some(f => f.code === 'G11'));
});
test('missing metadata cannot silently disable checks', () => {
    const f = fixture(); delete f.geometry.labels; delete f.geometry.routes[0].attachments; delete f.geometry.contacts[0].slots;
    assert.ok(codes(f).includes('SCHEMA'));
});
test('detached/single-contact exceptions need canonical endpoint evidence', () => {
    const f = fixture([{ id: 'a', segments: [[60, 60, 72, 60]], endpoints: [] }]); assert.deepEqual(codes(f), []);
    f.geometry.routes[0].unconnected = false; assert.ok(codes(f).includes('G08'));
    const stub = fixture([{ id: 'a', segments: [[20, 40, 60, 40]], endpoints: [[20, 40]] }]); assert.deepEqual(codes(stub), []);
    stub.geometry.routes[0].segments.push([60, 40, 60, 80], [60, 40, 100, 40]); assert.ok(codes(stub).includes('G08'));
});


test('R04-R08 real imported fixture: aliases, reorders, repeated positions, literal sites, scopes and multiple drivers', async t => {
    const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
    const hardware = require('../src/hardware');
    const { rtlContent } = require('../src/hardware/scene');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g4-geometry-membership-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const cell = (connections, directions, type = 'opaque') => ({ type, connections, port_directions: directions });
    const raw = { modules: {
        top: { attributes: { top: '1' }, ports: { bus: { direction: 'inout', bits: [2, 3] }, vector: { direction: 'input', bits: [4, 5] } },
            netnames: { exactReorder: { bits: [5, 4] }, partialSlice: { bits: [2] }, repeat: { bits: [2, 3, 2] } },
            cells: { firstDriver: cell({ Y: [2, 3] }, { Y: 'output' }), secondDriver: cell({ Y: [2, 3] }, { Y: 'output' }),
                mix: cell({ A: [3, 2, 3, '0', '0'] }, { A: 'input' }), vectorLoad: cell({ A: [4, 5] }, { A: 'input' }),
                left: cell({ I: [2, 3] }, { I: 'input' }, 'child'), right: cell({ I: [3, 2] }, { I: 'input' }, 'child') } },
        child: { ports: { I: { direction: 'input', bits: [2, 3] } }, cells: {}, netnames: {} }
    } };
    const file = path.join(directory, 'design.json'); await fs.writeFile(file, JSON.stringify(raw));
    const registry = hardware.createArtifactRegistry({ artifactRoots: [directory], sourceRoots: [] });
    await registry.registerArtifact({ pathRef: 'fixture', path: file });
    const model = (await hardware.importArtifact({ registry, artifactRef: 'fixture' })).implementation;
    const root = model.occurrences[model.roots[0]];
    const scene = { sceneKind: 'rtl', snapshotId: model.snapshot.id, ...rtlContent(model, root.id, 'source-owner') };
    // Test metadata comes from exact imported binding records, not layout or the oracle's answer.
    for (const c of scene.connections) {
        const grouped = new Map();
        for (const member of c.members) for (const endpoint of member.endpoints) {
            const binding = Object.values(model.boundaries).find(b => b.parentOccurrenceId === root.id
                && b.pinId === endpoint.entityId && b.index === endpoint.index && b.actualBitId === member.bitId);
            const contactId = binding ? binding.portId : endpoint.entityId;
            if (!grouped.has(contactId)) grouped.set(contactId, []);
            grouped.get(contactId).push({ bitId: member.bitId, endpointId: endpoint.entityId, index: endpoint.index,
                contactIndex: binding ? binding.index : endpoint.index, boundaryId: binding?.id || null, formalBitId: binding?.formalBitId || null });
        }
        c.incidences = [...grouped].map(([contactId, members]) => ({ contactId, members }));
    }
    assert.deepEqual(validateMembership(scene, { model }).findings, []);
    const reordered = scene.connections.find(c => c.rawBits.length === 2 && c.rawBits[0] === 5);
    assert.deepEqual(reordered.rawBits, [5, 4]);
    const b2 = model.bits[`${root.id}/bit/2`];
    assert.equal(b2.endpoints.filter(e => e.role === 'driver').length, 2);
    assert.ok(b2.endpoints.some(e => e.role === 'bidirectional'));
    const repeated = scene.connections.flatMap(c => c.incidences).find(i => i.members.length > 1 && i.members[0].bitId === i.members[1].bitId);
    assert.ok(repeated); assert.notEqual(repeated.members[0].contactIndex, repeated.members[1].contactIndex);
    const literals = root.bits.map(id => model.bits[id]).filter(b => b.kind === 'constant' && b.value === '0');
    assert.equal(literals.length, 2); assert.notEqual(literals[0].id, literals[1].id);
    const children = root.children.map(id => model.occurrences[id]);
    assert.notEqual(model.ports[children[0].ports[0]].bits[0], model.ports[children[1].ports[0]].bits[0]);
    const mutate = change => { const s = structuredClone(scene); change(s); return validateMembership(s, { model }).findings; };
    assert.ok(mutate(s => { const c = s.connections.find(c => c.id === reordered.id); c.bits.reverse(); }).some(f => f.kind === 'alias-or-vector-order'));
    assert.ok(mutate(s => { const c = s.connections.find(c => c.id === reordered.id); c.bits.push(b2.id); }).some(f => f.kind === 'partial-slice-union-or-split'));
    assert.ok(mutate(s => { const c = s.connections.find(c => c.bits.includes(b2.id)); c.members.find(m => m.bitId === b2.id).endpoints.pop(); }).some(f => f.kind === 'canonical-member-endpoints'));
    assert.ok(mutate(s => { s.connections[0].direction = 'forward'; }).some(f => f.kind === 'directed-or-semantic-rtl-net'));
    assert.ok(mutate(s => { const i = s.connections.flatMap(c => c.incidences).find(i => i.members.some(m => m.boundaryId)); i.members[0].contactIndex++; }).some(f => f.kind === 'canonical-incidence-members'));
    assert.ok(mutate(s => { const m = s.connections.flatMap(c => c.incidences).flatMap(i => i.members).find(m => m.boundaryId); m.formalBitId = m.bitId; }).some(f => f.kind === 'canonical-incidence-members'));
    assert.ok(mutate(s => { delete s.connections[0].incidences[0].members[0].formalBitId; }).some(f => f.kind === 'canonical-incidence-members'));
});

test('R12 tolerance, foreign T-touches, path mismatch and selection reorders are non-vacuous', () => {
    assert.equal(EPS, 1e-7);
    assert.equal(intersection([0, 0, 20, 0], [10, EPS / 2, 30, EPS / 2]).kind, 'overlap');
    assert.equal(intersection([0, 0, 20, 0], [10, EPS * 2, 30, EPS * 2]), null);
    const f = fixture([{ id: 'a', segments: [[20, 100, 180, 100]] }, { id: 'b', segments: [[100, 20, 100, 100]] }]);
    assert.ok(codes(f).includes('G02'));
    const path = fixture(); path.geometry.routes[0].path = 'M20,40L100,40';
    assert.ok(report(path).findings.some(f => f.kind === 'svg-path-segment-disagreement'));
    const disconnected = fixture(); disconnected.geometry.routes[0].segments.push([50, 80, 100, 80]);
    assert.ok(report(disconnected).findings.some(f => f.kind === 'disconnected-owner-route'));
});


test('G09 duplicate owner IDs and attachment-only index corruption cannot evade the oracle', () => {
    const f = fixture(); f.geometry.routes[0].attachments[0].indices = [9];
    assert.ok(report(f).findings.some(f => f.kind === 'attachment-index-membership'));
    const duplicate = fixture(); duplicate.geometry.routes.push(structuredClone(duplicate.geometry.routes[0]));
    duplicate.scene.connections.push(structuredClone(duplicate.scene.connections[0]));
    assert.ok(report(duplicate).findings.some(f => f.kind === 'duplicate-or-missing-identity'));
});


test('authoritative incidence schema preserves ordered and repeated slot positions', () => {
    const f = fixture(), c = f.scene.connections[0], incidence = c.incidences[0];
    incidence.members = [2, 0, 2].map(index => ({ bitId: c.bits[0], endpointId: incidence.contactId,
        index, contactIndex: index, boundaryId: null, formalBitId: null }));
    f.geometry.contacts[0].slots[0].indices = [2, 0, 2];
    f.geometry.contacts[0].slots[0].bitIds = [c.bits[0], c.bits[0], c.bits[0]];
    f.geometry.routes[0].attachments[0].indices = [2, 0, 2];
    f.geometry.routes[0].attachments[0].bitIds = [c.bits[0], c.bits[0], c.bits[0]];
    assert.deepEqual(codes(f), []);
    f.geometry.contacts[0].slots[0].indices = [0, 2];
    assert.ok(report(f).findings.some(f => f.kind === 'slot-index-membership'));
});


test('source groups use method parent paths, not equal definitions or method names across subinterfaces', () => {
    const source = ['left', 'right'].flatMap(name => [
        { id: `group/${name}`, kind: 'subinterface-endpoint', ownerInstanceId: 's', interfaceDefinitionId: 'IFC', interfacePath: [name] },
        { id: `method/${name}`, kind: 'method-endpoint', ownerInstanceId: 's', interfaceDefinitionId: 'IFC', interfacePath: [name, 'get'] }
    ]);
    const contacts = source.map(e => ({ ...e, ownerId: 's', category: e.kind === 'method-endpoint' ? 'Value' : 'Interface' }));
    const architecture = { occurrences: { s: { id: 's', children: [], storages: [], contacts: contacts.map(c => c.id) } },
        source: { endpoints: source }, contacts: Object.fromEntries(contacts.map(c => [c.id, c])), relations: {}, behaviors: {}, entities: {}, storage: {} };
    const scene = { sceneKind: 'bsv', shell: { id: 's' }, children: [], storages: [], connections: [],
        contacts: contacts.filter(c => c.category === 'Value'), interfaceGroups: ['left', 'right'].map(name => ({
            id: `group/${name}`, ownerId: 's', memberContactIds: [`method/${name}`] })) };
    assert.deepEqual(validateMembership(scene, { architecture }).findings, []);
    scene.interfaceGroups[1].memberContactIds = ['method/left'];
    assert.ok(validateMembership(scene, { architecture }).findings.some(f => f.kind === 'canonical-source-interface-members'));
});
