'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { layout, fitViewport } = require('../media/hardware-layout');

function scene(count = 2, sceneKind = 'bsv') {
    const children = Array.from({ length: count }, (_, i) => ({ id: `child-${i}`, kind: 'module',
        label: `unit-${i}`, secondary: 'Module#(Bit#(12))' }));
    const contacts = [{ id: 'in', ownerId: 'root', direction: 'input', label: 'put', detail: 'value : Bit#(12)' },
        { id: 'out', ownerId: 'root', direction: 'output', label: 'get', detail: 'Bit#(12)' },
        ...children.flatMap(child => [
            { id: `${child.id}:in`, ownerId: child.id, direction: 'input', label: 'put', detail: 'value : Bit#(12)' },
            { id: `${child.id}:out`, ownerId: child.id, direction: 'output', label: 'get', detail: 'Bit#(12)' }
        ])];
    return { sceneKind, shell: { id: 'root', label: 'Root', kind: 'module' }, children, storages: [], contacts,
        connections: children.map((child, i) => ({ id: `connection-${i}`, fromId: i ? `child-${i - 1}:out` : 'in',
            toId: `${child.id}:in`, endpointIds: [i ? `child-${i - 1}:out` : 'in', `${child.id}:in`],
            style: sceneKind === 'bsv' ? 'semantic' : 'physical', label: 'payload', memberRelationIds: [`relation-${i}`] })) };
}

test('layout contains every object and attaches contacts without mutating scene truth', () => {
    for (const kind of ['bsv', 'rtl']) for (const count of [0, 1, 2, 26]) {
        const input = scene(count, kind), before = JSON.stringify(input);
        const geometry = layout(input, { width: 1100, height: 650 });
        assert.equal(geometry.nodes.length, count + 1);
        assert.equal(geometry.contacts.length, input.contacts.length);
        assert.equal(geometry.routes.length, input.connections.length);
        for (const node of geometry.nodes) {
            assert.ok(node.x >= geometry.bounds.x && node.y >= geometry.bounds.y);
            assert.ok(node.x + node.width <= geometry.bounds.x + geometry.bounds.width);
            assert.ok(node.y + node.height <= geometry.bounds.y + geometry.bounds.height);
            assert.ok(node.width > 0 && node.height > 0);
        }
        for (const contact of geometry.contacts) {
            const owner = geometry.nodes.find(node => node.id === contact.ownerId);
            assert.ok(owner);
            assert.ok(contact.x === owner.x || contact.x === owner.x + owner.width);
            assert.ok(contact.y >= owner.y && contact.y <= owner.y + owner.height);
        }
        for (const route of geometry.routes) {
            assert.ok(route.segments.length);
            for (const segment of route.segments) {
                assert.ok(segment.every(Number.isFinite));
                assert.ok(segment[0] === segment[2] || segment[1] === segment[3]);
            }
        }
        const objects = geometry.nodes.filter(node => node.id !== input.shell.id);
        for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
            const a = objects[i], b = objects[j];
            assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
        }
        assert.equal(JSON.stringify(input), before);
    }
});

test('Fit keeps dense RTL nodes inside actual canvas rather than burying them', () => {
    const geometry = layout(scene(26, 'rtl'), { width: 980, height: 640 });
    const view = fitViewport(geometry, { width: 980, height: 640 });
    for (const node of geometry.nodes) {
        const x = view.x + node.x * view.scale, y = view.y + node.y * view.scale;
        assert.ok(x >= 0 && y >= 0);
        assert.ok(x + node.width * view.scale <= 980);
        assert.ok(y + node.height * view.scale <= 640);
        assert.ok(node.width * view.scale >= 35, 'Actual hardware must remain visible at overview Fit');
    }
});

test('layout rejects missing connection endpoints instead of inventing a hardware contact', () => {
    const input = scene(1);
    input.connections[0].endpointIds.push('foreign');
    assert.throws(() => layout(input, { width: 900, height: 650 }), /endpoint/i);
});

test('contact-free RTL vectors remain inspectable without invented endpoints', () => {
    const input = scene(1, 'rtl');
    input.connections.push({ id: 'isolated-vector', endpointIds: [], style: 'physical', label: 'isolated' });
    const geometry = layout(input, { width: 900, height: 650 });
    const isolated = geometry.routes.find(route => route.id === 'isolated-vector');
    assert.equal(isolated.unconnected, true);
    assert.deepEqual(isolated.points, []);
    assert.ok(isolated.path.length);
    assert.equal(geometry.contacts.length, input.contacts.length);
});
