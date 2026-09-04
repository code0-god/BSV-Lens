'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildFlowFixture, buildSemanticSource } = require('./semantic-fixture');

test('canonical semantic entities carry provenance confidence evidence and location', () => {
    // Given
    const model = buildFlowFixture();
    const collections = [
        'definitions',
        'instances',
        'endpoints',
        'bindings',
        'protocolChannels',
        'semanticFlows',
        'stateBehaviors',
        'interfaceContracts'
    ];

    // When
    const missing = collections.flatMap((collection) =>
        model[collection].flatMap((entity) => [
            ['analysisOrigin', entity.analysisOrigin],
            ['confidence', entity.confidence],
            ['evidence', entity.evidence],
            ['location', entity.location]
        ].filter(([, value]) => value === null || value === undefined || value === '')
            .map(([field]) => `${collection}:${entity.id}:${field}`))
    );

    // Then
    assert.deepEqual(missing, []);
    assert.equal(model.definitions.some((entity) =>
        entity.analysisOrigin === 'Compiler-authoritative'
    ), false);
    assert.equal(model.instances.some((entity) =>
        entity.analysisOrigin === 'Compiler-authoritative'
    ), false);
});

test('unresolved source constructs stay unresolved without fabricated exact confidence', () => {
    // Given
    const source = `
package ProvenanceBoundary;
module mkTop(Empty);
    UnknownIfc child <- mkUnavailable(valueOf(n));
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'ProvenanceBoundary.bsv', {
        entrypoints: ['mkTop']
    });
    const child = model.instances.find((instance) => instance.name === 'child');

    // Then
    assert.equal(child.targetDefinitionId, null);
    assert.equal(child.targetResolutionStatus, 'unresolved');
    assert.equal(child.confidence, 'unresolved');
    assert.equal(model.endpoints.some((endpoint) =>
        endpoint.ownerInstanceId === child.id
    ), false);
});
