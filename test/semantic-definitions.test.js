'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');
const { buildSemanticModel } = require('../src/architecture/semantic/model');

function build(source) {
    const parsed = parseBsvFile(source, {
        uri: 'file:///Definitions.bsv',
        relativePath: 'Definitions.bsv'
    });
    return buildSemanticModel([parsed], normalizeConfig({}), {});
}

const SOURCE = `
package Definitions;
typedef UInt#(8) Word;

interface ChildIfc#(numeric type n);
    method Action put(Word value);
    method Word value;
endinterface

function Word increment(Word value);
    return value + 1;
endfunction

module mkChild#(
    numeric type n,
    Integer limit
)(ChildIfc#(n)) provisos (Add#(1, n, nextN));
    Reg#(Word) state <- mkReg(0);
    function Word localIncrement(Word value);
        return value + 1;
    endfunction
    method Action put(Word value);
        state <= value;
    endmethod
    method Word value = state;
endmodule

module mkTop(Empty);
    ChildIfc#(8) child <- mkChild#(8)(16);
endmodule
endpackage
`;

test('semantic model exposes canonical schema fields before presentation', () => {
    // Given
    const expectedFields = [
        'definitions',
        'instances',
        'endpoints',
        'bindings',
        'protocolChannels',
        'semanticFlows',
        'stateBehaviors',
        'interfaceContracts',
        'diagnostics',
        'provenance'
    ];

    // When
    const model = build(SOURCE);

    // Then
    assert.equal(model.schemaVersion, 3);
    for (const field of expectedFields) assert.ok(field in model, field);
    for (const field of expectedFields.slice(0, 9)) assert.ok(Array.isArray(model[field]), field);
});

test('definition IR separates package interface module type and function facts', () => {
    // Given
    const model = build(SOURCE);

    // When
    const byId = new Map(model.definitions.map((definition) => [definition.id, definition]));
    const module = byId.get('def:Definitions:mkChild');
    const interfaceDefinition = byId.get('def:Definitions:ChildIfc');

    // Then
    assert.equal(byId.get('def:Definitions:$package').kind, 'package-definition');
    assert.equal(byId.get('def:Definitions:Word').kind, 'type-definition');
    assert.equal(byId.get('def:Definitions:increment').kind, 'function-definition');
    assert.deepEqual({
        kind: module.kind,
        packageName: module.packageName,
        name: module.name,
        returnInterface: module.returnInterface,
        typeParameters: module.typeParameters,
        constructorParameters: module.constructorParameters,
        provisos: module.provisos,
        childNames: module.childInstanceDeclarations.map((instance) => instance.name),
        methodNames: module.methods.map((method) => method.name),
        localFunctions: module.localFunctions.map((local) => [local.name, local.id]),
        stateNames: module.stateDeclarations.map((state) => state.name),
        analysisOrigin: module.analysisOrigin
    }, {
        kind: 'module-definition',
        packageName: 'Definitions',
        name: 'mkChild',
        returnInterface: 'ChildIfc#(n)',
        typeParameters: [{
            name: 'n',
            kind: 'numeric-type',
            declaration: 'numeric type n'
        }],
        constructorParameters: [{
            name: 'limit',
            type: 'Integer',
            declaration: 'Integer limit'
        }],
        provisos: ['Add#(1, n, nextN)'],
        childNames: ['state'],
        methodNames: ['put', 'value'],
        localFunctions: [[
            'localIncrement',
            'def:Definitions:mkChild.localIncrement'
        ]],
        stateNames: ['state'],
        analysisOrigin: 'Source-derived'
    });
    assert.equal(interfaceDefinition.kind, 'interface-definition');
    assert.deepEqual(interfaceDefinition.typeParameters, [{
        name: 'n',
        kind: 'numeric-type',
        declaration: 'numeric type n'
    }]);
    assert.deepEqual(interfaceDefinition.methods.map((method) => method.name), ['put', 'value']);
    assert.equal(byId.has('def:Definitions:localIncrement'), false);
    assert.equal(
        byId.get('def:Definitions:mkChild.localIncrement').ownerDefinitionId,
        'def:Definitions:mkChild'
    );
    assert.ok(module.location);
    assert.ok(module.sourceRange);
});

test('semantic definition IDs remain stable when source lines move', () => {
    // Given
    const shifted = `\n\n\n${SOURCE}`;

    // When
    const baselineIds = build(SOURCE).definitions.map((definition) => definition.id).sort();
    const shiftedIds = build(shifted).definitions.map((definition) => definition.id).sort();

    // Then
    assert.deepEqual(shiftedIds, baselineIds);
    assert.equal(shiftedIds.some((id) => /:\d+$/.test(id)), false);
});
