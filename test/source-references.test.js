'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');
const {
    buildSourceReferenceIndex,
    findSourceReferenceAtPosition
} = require('../src/architecture/semantic/source-references');

const URI = 'file:///SourceReferences.bsv';
const SOURCE = `
package SourceReferences;
interface StreamIfc;
    method Bool publishValid;
    method Bit#(8) publish;
    method Action consumePublish;
endinterface
module mkMatmul(StreamIfc);
    Reg#(Bool) busy <- mkReg(False);
    rule advance;
        busy <= True;
    endrule
    method Bool publishValid = busy;
    method Bit#(8) publish = 0;
    method Action consumePublish;
        busy <= False;
    endmethod
endmodule
module mkLoop(StreamIfc);
    StreamIfc matmul <- mkMatmul;
    method Bool publishValid = matmul.publishValid;
    method Bit#(8) publish = matmul.publish;
    method Action consumePublish;
        matmul.consumePublish;
    endmethod
endmodule
endpackage
`;

function fixture() {
    const parsed = parseBsvFile(SOURCE, { uri: URI, relativePath: 'SourceReferences.bsv' });
    const model = buildArchitectureModel([parsed], normalizeConfig({
        entrypoints: ['mkLoop']
    }), { limits: { maxNodes: 1000, maxEdges: 2000 } });
    return { parsed, model, index: buildSourceReferenceIndex(model) };
}

function at(index, location) {
    return findSourceReferenceAtPosition(index, {
        uri: location.uri,
        line: location.line,
        column: location.column
    });
}

function exact(index, location, kind) {
    const match = at(index, location);
    assert.equal(match.status, 'exact');
    assert.equal(match.references.length, 1);
    assert.equal(match.references[0].kind, kind);
    return match.references[0];
}

test('canonical source ownership rejects root and child borrowed Publish channel locations', () => {
    const { parsed, model } = fixture();
    const loop = parsed.modules.find((item) => item.name === 'mkLoop');
    const declaration = loop.instances.find((item) => item.name === 'matmul');
    const rootChannel = model.protocolChannels.find((channel) =>
        channel.ownerInstanceId === model.instances.find((instance) => instance.root).id
    );
    const childOccurrence = model.instances.find((instance) => instance.name === 'matmul');
    const childChannel = model.protocolChannels.find((channel) =>
        channel.ownerInstanceId === childOccurrence.id
    );
    model.nodes.push(
        { id: rootChannel.id, kind: 'protocol-channel', name: 'Publish', location: loop.location },
        { id: childChannel.id, kind: 'protocol-channel', name: 'Publish', location: declaration.location }
    );
    const collisionIndex = buildSourceReferenceIndex(model);
    const root = exact(collisionIndex, loop.location, 'definition');
    const child = exact(collisionIndex, declaration.location, 'instance-declaration');

    assert.ok(model.nodes.some((node) =>
        node.kind === 'protocol-channel'
        && node.location?.line === loop.location.line
        && node.location?.column === loop.location.column
    ));
    assert.ok(model.nodes.some((node) =>
        node.kind === 'protocol-channel'
        && node.location?.line === declaration.location.line
        && node.location?.column === declaration.location.column
    ));
    assert.ok(root.presentations.some((item) => item.role === 'occurrence'));
    assert.ok(child.presentations.some((item) => item.role === 'occurrence'));
    assert.equal(root.presentations.some((item) => item.role === 'channel'), false);
    assert.equal(child.presentations.some((item) => item.role === 'channel'), false);
    assert.equal(root.presentations.some((item) => item.id.startsWith('channel:')), false);
    assert.equal(child.presentations.some((item) => item.id.startsWith('channel:')), false);
});

test('index covers definitions declarations implementations interface methods rules and state', () => {
    const { parsed, index } = fixture();
    const matmul = parsed.modules.find((item) => item.name === 'mkMatmul');
    const interfaceDefinition = parsed.interfaces[0];
    const cases = [
        [matmul.location, 'definition'],
        [parsed.modules.find((item) => item.name === 'mkLoop').instances[0].location, 'instance-declaration'],
        [matmul.methods.find((item) => item.name === 'publish').location, 'implementation-method'],
        [interfaceDefinition.methods.find((item) => item.name === 'publish').location, 'interface-method'],
        [matmul.rules[0].location, 'rule'],
        [matmul.instances[0].location, 'state-declaration']
    ];

    for (const [location, kind] of cases) exact(index, location, kind);

    const implementation = exact(index,
        matmul.methods.find((item) => item.name === 'consumePublish').location,
        'implementation-method');
    assert.ok(implementation.presentations.some((item) => item.role === 'behavior'));
    assert.ok(implementation.presentations.some((item) => item.role === 'endpoint'));

    const interfaceMethod = exact(index,
        interfaceDefinition.methods.find((item) => item.name === 'consumePublish').location,
        'interface-method');
    assert.ok(interfaceMethod.presentations.length > 0);
    assert.ok(interfaceMethod.presentations.every((item) => item.role === 'endpoint'));
});

test('cross-reference exposes each canonical source-to-semantic mapping', () => {
    const { parsed, model, index } = fixture();
    const loopDefinition = model.definitions.find((item) => item.name === 'mkLoop');
    const matmulDefinition = model.definitions.find((item) => item.name === 'mkMatmul');
    const loop = parsed.modules.find((item) => item.name === 'mkLoop');
    const declaration = exact(index, loop.instances[0].location, 'instance-declaration');
    const implementation = exact(index,
        parsed.modules.find((item) => item.name === 'mkMatmul').methods.find((item) =>
            item.name === 'publish'
        ).location,
        'implementation-method');
    const interfaceMethod = exact(index,
        parsed.interfaces[0].methods.find((item) => item.name === 'publish').location,
        'interface-method');

    assert.deepEqual(index.occurrenceIdsByDefinitionId.get(loopDefinition.id), [
        model.instances.find((item) => item.root).id
    ]);
    assert.deepEqual(index.occurrenceIdsByInstanceDeclarationId.get(declaration.id), [
        model.instances.find((item) => item.name === 'matmul').id
    ]);
    assert.deepEqual(index.endpointIdsByImplementationMethodId.get(implementation.id),
        model.endpoints.filter((item) =>
            item.implementationMethodId === implementation.id
        ).map((item) => item.id).sort());
    const interfaceDefinition = model.definitions.find((item) =>
        item.kind === 'interface-definition' && item.name === 'StreamIfc'
    );
    assert.deepEqual(index.endpointIdsByInterfaceMethodId.get(interfaceMethod.id),
        model.endpoints.filter((item) =>
            item.interfaceDefinitionId === interfaceDefinition.id
            && item.name === 'publish'
        ).map((item) => item.id).sort());

    const rootPresentation = index.presentationNodeIdsBySemanticId.get(loopDefinition.id);
    assert.ok(rootPresentation.includes(model.instances.find((item) => item.root).id));
    const sourceKey = index.sourceRangeKey(loopDefinition.sourceRange || loopDefinition.location);
    assert.ok(index.semanticIdsBySourceRange.get(sourceKey).includes(loopDefinition.id));
    assert.notEqual(matmulDefinition.id, model.instances.find((item) => item.name === 'matmul').id);
});

test('unowned source text is unresolved instead of falling back to its enclosing module', () => {
    const { index } = fixture();
    const match = findSourceReferenceAtPosition(index, {
        uri: URI,
        line: 0,
        column: 0
    });
    assert.equal(match.status, 'unresolved');
    assert.deepEqual(match.references, []);
});
