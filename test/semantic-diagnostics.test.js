'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');
const { buildSemanticModel } = require('../src/architecture/semantic/model');
const { buildSemanticSource } = require('./semantic-fixture');

test('unresolved module constructors remain visible as low-noise source diagnostics', () => {
    // Given
    const source = `
package UnresolvedConstructor;
module mkTop(Empty);
    MissingIfc child <- mkMissing(config);
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'UnresolvedConstructor.bsv', {
        entrypoints: ['mkTop']
    });
    const diagnostic = model.diagnostics.find((item) =>
        item.code === 'module-constructor.unresolved'
    );

    // Then
    assert.equal(diagnostic.severity, 'info');
    assert.ok(diagnostic.location);
    assert.equal(diagnostic.analysisOrigin, 'Source-derived');
    assert.match(diagnostic.message, /mkMissing/);
});

test('ambiguous imported constructors never pick an arbitrary definition', () => {
    // Given
    const sources = [
        ['First.bsv', 'package First; module mkChild(Empty); endmodule endpackage'],
        ['Second.bsv', 'package Second; module mkChild(Empty); endmodule endpackage'],
        ['Top.bsv', `
package Top;
import First::*;
import Second::*;
module mkTop(Empty);
    Empty child <- mkChild;
endmodule
endpackage
`]
    ];
    const parsed = sources.map(([name, source]) => parseBsvFile(source, {
        uri: `file:///${name}`,
        relativePath: name
    }));

    // When
    const model = buildSemanticModel(parsed, normalizeConfig({
        entrypoints: ['mkTop']
    }), {});
    const child = model.instances.find((instance) => instance.path === 'mkTop.child');
    const diagnostic = model.diagnostics.find((item) =>
        item.code === 'module-constructor.ambiguous'
    );

    // Then
    assert.equal(child.targetDefinitionId, null);
    assert.equal(child.targetResolutionStatus, 'unresolved');
    assert.equal(diagnostic.severity, 'warning');
    assert.ok(diagnostic.location);
});

test('scalar constructor parameters stay metadata without unresolved noise', () => {
    // Given
    const source = `
package ScalarMetadata;
module mkChild#(Integer limit)(Empty);
endmodule
module mkTop(Empty);
    Empty child <- mkChild(16);
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'ScalarMetadata.bsv', {
        entrypoints: ['mkTop']
    });

    // Then
    assert.deepEqual(model.instances.find((instance) =>
        instance.path === 'mkTop.child'
    ).parameterBindings, [{
        index: 0,
        formalParameter: 'limit',
        actualExpression: '16',
        resolutionStatus: 'metadata'
    }]);
    assert.equal(model.diagnostics.some((diagnostic) =>
        diagnostic.code === 'constructor-binding.unresolved'
    ), false);
});
