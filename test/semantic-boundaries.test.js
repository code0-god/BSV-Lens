'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');
const { projectSemanticModel } = require('../src/architecture/semantic/projection');
const { buildSemanticSource } = require('./semantic-fixture');

const SOURCE = `
package BoundaryFixture;

interface StreamIfc;
    method Bool itemValid;
    method UInt#(16) item;
    method Action consumeItem;
endinterface

interface SinkIfc;
    method Bool itemReady;
    method Action item(UInt#(16) value);
endinterface

interface DependencyIfc;
    method Bool available;
endinterface

module mkDependency(DependencyIfc);
    method Bool available = True;
endmodule

module mkUsesDependency#(DependencyIfc dependency)(Empty);
endmodule

module mkProducer(StreamIfc);
    DependencyIfc dependency <- mkDependency;
    Empty user <- mkUsesDependency(dependency);
    method Bool itemValid = True;
    method UInt#(16) item = 0;
    method Action consumeItem;
    endmethod
endmodule

module mkConsumer(SinkIfc);
    method Bool itemReady = True;
    method Action item(UInt#(16) value);
    endmethod
endmodule

endpackage
`;

function model(config = {}) {
    return buildSemanticSource(SOURCE, 'BoundaryFixture.bsv', config);
}

test('uninstantiated source modules retain canonical root metadata and parent invariants', () => {
    const semantic = model();

    assert.deepEqual(semantic.roots.map((root) => [root.name, root.reason]), [
        ['mkProducer', 'uninstantiated'],
        ['mkConsumer', 'uninstantiated']
    ]);
    for (const root of semantic.roots) {
        assert.equal(root.rootStatus, 'unbound');
        assert.equal(root.parentInstanceId, null);
        assert.equal(root.path, root.name);
        assert.ok(root.targetDefinitionId);
        assert.equal(root.analysisOrigin, 'Source-derived root projection');
        assert.equal(root.evidence.selectionReason, root.reason);
        const occurrence = semantic.instances.find((instance) => instance.id === root.instanceId);
        assert.equal(occurrence.parentInstanceId, null);
        assert.equal(occurrence.path, root.path);
        assert.equal(occurrence.targetDefinitionId, root.targetDefinitionId);
    }

    const child = semantic.instances.find((instance) => instance.path === 'mkProducer.user');
    const constructor = semantic.bindings.find((binding) =>
        binding.kind === 'constructor-binding' && binding.targetInstanceId === child.id
    );
    assert.ok(constructor);
    assert.notEqual(constructor.kind, 'instance-child');
});

test('root boundaries expose inferred channels and unmatched public endpoints without cross-root wiring', () => {
    const semantic = model();
    const endpointOwners = new Map(semantic.endpoints.map((endpoint) => [endpoint.id, endpoint.ownerInstanceId]));
    const roots = new Set(semantic.roots.map((root) => root.instanceId));
    const crossRootFlows = semantic.semanticFlows.filter((flow) => {
        const source = endpointOwners.get(flow.fromEndpointId || flow.fromId);
        const target = endpointOwners.get(flow.toEndpointId || flow.toId);
        return source !== target && roots.has(source) && roots.has(target);
    });

    assert.equal(crossRootFlows.length, 0);
    assert.equal(semantic.semanticBoundaries.length, 2);
    const producer = semantic.semanticBoundaries.find((boundary) => boundary.path === 'mkProducer');
    const consumer = semantic.semanticBoundaries.find((boundary) => boundary.path === 'mkConsumer');
    assert.equal(producer.channels.length, 1);
    assert.equal(producer.channels[0].direction, 'output-with-ack');
    assert.equal(producer.channels[0].payloadType, 'UInt#(16)');
    assert.ok(producer.channels[0].legs.some((leg) =>
        leg.role === 'payload' && leg.direction === 'outbound' && leg.payloadType === 'UInt#(16)'
    ));
    assert.deepEqual(producer.unmatchedEndpoints, []);
    assert.equal(consumer.channels.length, 1);
    assert.equal(consumer.channels[0].direction, 'input');
    assert.ok(consumer.channels[0].legs.some((leg) =>
        leg.role === 'action' && leg.direction === 'inbound' && leg.payloadType === 'UInt#(16)'
    ));
});

test('projection uses separate boundary presentation IDs and directional data-flow edges', () => {
    const semantic = model({ entrypoints: ['mkProducer', 'mkConsumer'] });
    const projection = projectSemanticModel(semantic);

    assert.deepEqual(semantic.roots.map((root) => root.reason), ['configured', 'configured']);
    const boundaryNodes = projection.nodes.filter((node) => node.kind === 'root-boundary');
    assert.equal(boundaryNodes.length, 4);
    for (const root of semantic.roots) {
        const canonicalId = `semantic-boundary:${root.instanceId}`;
        const presentations = boundaryNodes.filter((node) => node.semanticId === canonicalId);
        assert.deepEqual(presentations.map((node) => node.presentationRole).sort(), [
            'external-input',
            'external-output'
        ]);
        assert.deepEqual(presentations.map((node) => node.boundaryDirection).sort(), [
            'inbound',
            'outbound'
        ]);
        assert.deepEqual(presentations.map((node) => node.id).sort(), [
            `boundary-input:${root.instanceId}`,
            `boundary-output:${root.instanceId}`
        ]);
        assert.ok(presentations.every((node) => node.details.rootStatus === 'unbound'));
    }
    const boundaryEdges = projection.edges.filter((edge) => edge.boundary);
    assert.ok(boundaryEdges.some((edge) => edge.kind === 'boundary-output'));
    assert.ok(boundaryEdges.some((edge) => edge.kind === 'boundary-input'));
    const producerRootId = semantic.roots.find((root) => root.name === 'mkProducer').instanceId;
    const producerEdges = boundaryEdges.filter((edge) => edge.rootInstanceId === producerRootId);
    assert.deepEqual(producerEdges.map((edge) => edge.direction).sort(), [
        'inbound',
        'outbound'
    ]);
    assert.deepEqual(
        producerEdges.find((edge) => edge.direction === 'inbound').payloadTypes,
        []
    );
    assert.deepEqual(
        producerEdges.find((edge) => edge.direction === 'outbound').payloadTypes,
        ['UInt#(16)']
    );
    assert.ok(boundaryEdges.every((edge) => edge.mode === 'data-flow'));
    assert.ok(boundaryEdges.every((edge) => edge.semanticFlowId === null));
    for (const edge of boundaryEdges) {
        if (edge.direction === 'inbound') {
            assert.equal(edge.source, `boundary-input:${edge.rootInstanceId}`);
            assert.equal(edge.boundaryNodeId, edge.source);
        } else {
            assert.equal(edge.target, `boundary-output:${edge.rootInstanceId}`);
            assert.equal(edge.boundaryNodeId, edge.target);
        }
    }

    const producerRoot = projection.nodes.find((node) =>
        node.kind === 'instance' && node.name === 'mkProducer'
    );
    assert.equal(producerRoot.details.rootReason, 'configured');
    assert.equal(producerRoot.details.rootStatus, 'unbound');
    const producerBoundary = semantic.semanticBoundaries.find((boundary) =>
        boundary.rootInstanceId === producerRoot.id
    );
    const producerChannel = projection.nodes.find((node) =>
        node.id === producerBoundary.channels[0].channelId
    );
    assert.deepEqual(producerChannel.location, producerBoundary.channels[0].location);
    assert.notDeepEqual(producerChannel.location, producerRoot.location);
});

test('graph model exports canonical semantic boundaries without changing schema version', () => {
    const parsed = parseBsvFile(SOURCE, {
        uri: 'file:///BoundaryFixture.bsv',
        relativePath: 'BoundaryFixture.bsv'
    });
    const graph = buildArchitectureModel([parsed], normalizeConfig({
        entrypoints: ['mkProducer', 'mkConsumer']
    }), { limits: { maxNodes: 1000, maxEdges: 2000 } });

    assert.equal(graph.schemaVersion, 3);
    assert.equal(graph.semanticBoundaries.length, 2);
    assert.deepEqual(graph.semanticBoundaries.map((boundary) => boundary.rootReason), [
        'configured',
        'configured'
    ]);
});
