'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSemanticSource } = require('./semantic-fixture');

test('configured entrypoints take precedence over unrelated root candidates', () => {
    // Given
    const source = `
package ConfiguredRoot;
module mkConfigured(Empty);
endmodule
module mkUnrelated(Empty);
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'ConfiguredRoot.bsv', {
        entrypoints: ['mkConfigured']
    });

    // Then
    assert.deepEqual(model.roots.map((root) => [root.name, root.reason]), [
        ['mkConfigured', 'configured']
    ]);
    assert.deepEqual(
        model.instances.filter((instance) => instance.root).map((instance) => instance.name),
        ['mkConfigured']
    );
});

test('constructor arity mismatches remain unresolved with source diagnostics', () => {
    // Given
    const source = `
package ConstructorArity;
interface LinkIfc;
endinterface
module mkSource(LinkIfc);
endmodule
module mkChild#(
    LinkIfc upstream,
    Integer limit
)(Empty);
endmodule
module mkTop(Empty);
    LinkIfc source <- mkSource;
    Empty missing <- mkChild(source);
    Empty extra <- mkChild(source, 16, False);
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'ConstructorArity.bsv', {
        entrypoints: ['mkTop']
    });
    const diagnostics = model.diagnostics.filter((diagnostic) =>
        diagnostic.code === 'constructor.arity'
    );
    const missing = model.instances.find((instance) => instance.path === 'mkTop.missing');

    // Then
    assert.equal(diagnostics.length, 2);
    assert.ok(diagnostics.every((diagnostic) =>
        diagnostic.severity === 'warning'
        && diagnostic.location
    ));
    assert.ok(missing.parameterBindings.some((binding) =>
        binding.index === 1
        && binding.formalParameter === 'limit'
        && binding.actualExpression === null
        && binding.resolutionStatus === 'unresolved'
    ));
});

test('static type actuals stay separate from constructor argument bindings', () => {
    // Given
    const source = `
package StaticBindings;
interface LinkIfc;
endinterface
module mkSource(LinkIfc);
endmodule
module mkChild#(
    numeric type n,
    LinkIfc upstream
)(Empty);
endmodule
module mkTop(Empty);
    LinkIfc source <- mkSource;
    Empty child <- mkChild#(8)(source);
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'StaticBindings.bsv', {
        entrypoints: ['mkTop']
    });
    const child = model.instances.find((instance) => instance.path === 'mkTop.child');

    // Then
    assert.deepEqual(child.staticBindings, [{
        index: 0,
        formalParameter: 'n',
        actualExpression: '8',
        resolutionStatus: 'metadata'
    }]);
    assert.equal(model.bindings.some((binding) =>
        binding.kind === 'constructor-binding'
        && binding.targetInstanceId === child.id
        && binding.formalParameter.name === 'upstream'
    ), true);
});

test('ambiguous configured entrypoint reports ambiguity without choosing a root', () => {
    // Given
    const parsed = [
        ['First.bsv', 'package First; module mkTop(Empty); endmodule endpackage'],
        ['Second.bsv', 'package Second; module mkTop(Empty); endmodule endpackage']
    ].map(([name, source]) => {
        const { parseBsvFile } = require('../src/architecture/parser');
        return parseBsvFile(source, {
            uri: `file:///${name}`,
            relativePath: name
        });
    });
    const { normalizeConfig } = require('../src/architecture/config');
    const { buildSemanticModel } = require('../src/architecture/semantic/model');

    // When
    const model = buildSemanticModel(parsed, normalizeConfig({
        entrypoints: ['mkTop']
    }), {});

    // Then
    assert.deepEqual(model.roots, []);
    assert.ok(model.diagnostics.some((diagnostic) =>
        diagnostic.code === 'entrypoint.ambiguous'
        && diagnostic.severity === 'warning'
    ));
});

test('unresolved configured entrypoint reports info without natural-root fallback', () => {
    // Given
    const source = `
package MissingRoot;
module mkAvailable(Empty);
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'MissingRoot.bsv', {
        entrypoints: ['mkMissing']
    });

    // Then
    assert.deepEqual(model.roots, []);
    assert.ok(model.diagnostics.some((diagnostic) =>
        diagnostic.code === 'entrypoint.unresolved'
        && diagnostic.severity === 'info'
    ));
});
