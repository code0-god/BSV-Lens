'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');
const { buildSemanticModel } = require('../src/architecture/semantic/model');

function build(source, config = {}) {
    const parsed = parseBsvFile(source, {
        uri: 'file:///Instances.bsv',
        relativePath: 'Instances.bsv'
    });
    return buildSemanticModel([parsed], normalizeConfig(config), {
        limits: { maxNodes: 1000, maxEdges: 2000 }
    });
}

test('instance IR separates roots occurrences targets and constructor bindings', () => {
    // Given
    const source = `
package Instances;
interface LinkIfc;
    method Bit#(8) value;
endinterface
module mkSource(LinkIfc);
    method Bit#(8) value = 0;
endmodule
module mkConsumer#(
    LinkIfc upstream,
    Integer limit
)(LinkIfc);
    method Bit#(8) value = upstream.value;
endmodule
module mkTop(Empty);
    LinkIfc source <- mkSource;
    LinkIfc consumer <- mkConsumer(source, 16);
endmodule
endpackage
`;

    // When
    const model = build(source);
    const root = model.instances.find((instance) => instance.root);
    const sourceInstance = model.instances.find((instance) => instance.path === 'mkTop.source');
    const consumer = model.instances.find((instance) => instance.path === 'mkTop.consumer');
    const structural = model.bindings.find((binding) =>
        binding.kind === 'constructor-binding'
        && binding.targetInstanceId === consumer.id
    );

    // Then
    assert.deepEqual({
        name: root.name,
        path: root.path,
        parentInstanceId: root.parentInstanceId,
        targetDefinitionId: root.targetDefinitionId,
        constructor: root.constructor,
        synthetic: root.synthetic,
        root: root.root,
        analysisOrigin: root.analysisOrigin
    }, {
        name: 'mkTop',
        path: 'mkTop',
        parentInstanceId: null,
        targetDefinitionId: 'def:Instances:mkTop',
        constructor: null,
        synthetic: true,
        root: true,
        analysisOrigin: 'Source-derived root projection'
    });
    assert.equal(sourceInstance.parentInstanceId, root.id);
    assert.equal(sourceInstance.targetDefinitionId, 'def:Instances:mkSource');
    assert.equal(consumer.targetDefinitionId, 'def:Instances:mkConsumer');
    assert.notEqual(sourceInstance.id, consumer.id);
    assert.equal(/:\d+$/.test(sourceInstance.id), false);
    assert.deepEqual({
        sourceInstanceId: structural.sourceInstanceId,
        targetInstanceId: structural.targetInstanceId,
        formalParameter: structural.formalParameter,
        actualExpression: structural.actualExpression,
        resolutionStatus: structural.resolutionStatus,
        analysisOrigin: structural.analysisOrigin
    }, {
        sourceInstanceId: sourceInstance.id,
        targetInstanceId: consumer.id,
        formalParameter: {
            index: 0,
            name: 'upstream',
            type: 'LinkIfc'
        },
        actualExpression: 'source',
        resolutionStatus: 'exact',
        analysisOrigin: 'Source-derived'
    });
    assert.deepEqual(consumer.parameterBindings, [{
        index: 1,
        formalParameter: 'limit',
        actualExpression: '16',
        resolutionStatus: 'metadata'
    }]);
});

test('root resolution preserves every uninstantiated candidate', () => {
    // Given
    const source = `
package Roots;
module mkFirst(Empty);
endmodule
module mkSecond(Empty);
endmodule
endpackage
`;

    // When
    const model = build(source);

    // Then
    assert.deepEqual(
        model.instances.filter((instance) => instance.root).map((instance) => instance.name),
        ['mkFirst', 'mkSecond']
    );
    assert.deepEqual(model.roots.map((root) => root.reason), ['uninstantiated', 'uninstantiated']);
});

test('recursive instance hierarchy records a diagnostic and cuts each cycle branch', () => {
    // Given
    const source = `
package Cyclic;
module mkA(Empty);
    Empty b <- mkB;
endmodule
module mkB(Empty);
    Empty a <- mkA;
endmodule
endpackage
`;

    // When
    const model = build(source);

    // Then
    assert.ok(model.instances.some((instance) => instance.expansionStatus === 'cycle-cut'));
    assert.ok(model.diagnostics.some((diagnostic) =>
        diagnostic.code === 'instance.cycle'
        && diagnostic.severity === 'error'
        && diagnostic.location
    ));
    assert.deepEqual(
        model.roots.map((root) => root.reason),
        ['cycle-fallback', 'cycle-fallback']
    );
});

test('replicated declarations retain multiplicity without fake element instances', () => {
    // Given
    const source = `
package Aggregate;
interface ChildIfc;
endinterface
module mkChild(ChildIfc);
endmodule
module mkTop(Empty);
    Vector#(4, ChildIfc) children <- replicateM(mkChild);
endmodule
endpackage
`;

    // When
    const model = build(source);
    const occurrences = model.instances.filter((instance) => instance.name === 'children');

    // Then
    assert.equal(occurrences.length, 1);
    assert.deepEqual(occurrences[0].multiplicity, {
        status: 'exact',
        count: 4,
        expression: '4'
    });
    assert.equal(model.instances.some((instance) => /children\[\d+\]/.test(instance.path)), false);
});
