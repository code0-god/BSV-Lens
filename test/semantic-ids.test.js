'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSemanticSource } = require('./semantic-fixture');

test('duplicate callable semantic IDs use deterministic ordinals instead of source lines', () => {
    // Given
    const source = `
package DuplicateSemantic;
module mkDuplicate(Empty);
    method Action update;
        noAction;
    endmethod
    method Action update;
        noAction;
    endmethod
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'DuplicateSemantic.bsv', {
        entrypoints: ['mkDuplicate']
    });
    const methods = model.stateBehaviors.filter((behavior) =>
        behavior.name === 'update'
    );

    // Then
    assert.equal(methods.length, 2);
    assert.notEqual(methods[0].id, methods[1].id);
    assert.equal(methods[0].definitionId, 'def:DuplicateSemantic:mkDuplicate.update');
    assert.equal(methods[1].definitionId, 'def:DuplicateSemantic:mkDuplicate.update~1');
    assert.equal(methods.some((method) => /:\d+$/.test(method.id)), false);
    assert.ok(model.diagnostics.some((diagnostic) =>
        diagnostic.code === 'definition.duplicate'
        && diagnostic.severity === 'warning'
        && diagnostic.location
    ));
});

test('same method name in distinct provided interfaces is not a duplicate', () => {
    // Given
    const source = `
package InterfaceIdentity;
interface LeftIfc;
    method Bool valid;
endinterface
interface RightIfc;
    method Bool valid;
endinterface
interface OuterIfc;
    interface LeftIfc left;
    interface RightIfc right;
endinterface
module mkPorts(OuterIfc);
    interface LeftIfc left;
        method Bool valid = True;
    endinterface
    interface RightIfc right;
        method Bool valid = False;
    endinterface
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'InterfaceIdentity.bsv', {
        entrypoints: ['mkPorts']
    });
    const methods = model.stateBehaviors.filter((behavior) =>
        behavior.name === 'valid'
    );

    // Then
    assert.equal(methods.length, 2);
    assert.deepEqual(methods.map((behavior) => behavior.interfacePath), [
        ['left'],
        ['right']
    ]);
    assert.equal(new Set(methods.map((behavior) => behavior.id)).size, 2);
    assert.equal(model.diagnostics.some((diagnostic) =>
        diagnostic.code === 'definition.duplicate'
    ), false);
    assert.deepEqual(model.endpoints
        .filter((endpoint) => endpoint.kind === 'method-endpoint')
        .map((endpoint) => [
            endpoint.interfacePath.join('.'),
            endpoint.implementationMethodId
        ]), [
        ['left.valid', 'def:InterfaceIdentity:mkPorts.left.valid'],
        ['right.valid', 'def:InterfaceIdentity:mkPorts.right.valid']
    ]);
});
