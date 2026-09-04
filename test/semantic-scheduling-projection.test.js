'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');
const Graph = require('../media/graph-view');

test('instance scheduling view projects shared definition facts into selected context', () => {
    // Given
    const parsed = parseBsvFile(`
package SchedulingProjection;
(* execution_order = "first, second" *)
module mkController(Empty);
    rule first;
        noAction;
    endrule
    rule second;
        noAction;
    endrule
endmodule
module mkTop(Empty);
    Empty left <- mkController;
    Empty right <- mkController;
endmodule
endpackage
`, {
        uri: 'file:///SchedulingProjection.bsv',
        relativePath: 'SchedulingProjection.bsv'
    });
    const model = buildArchitectureModel([parsed], normalizeConfig({
        entrypoints: ['mkTop']
    }), {});
    const left = model.nodes.find((node) =>
        node.architectureInstance && node.details.path === 'mkTop.left'
    );

    // When
    const visible = Graph.createViewModel(model, {
        sourceScope: 'workspace',
        level: 'behavior',
        analysisMode: 'scheduling',
        hopScope: 'all',
        focusStack: [left.id],
        filters: { packages: false, rules: true, primitives: true }
    }).visible();

    // Then
    assert.equal(model.scheduleRelations.length, 2);
    assert.equal(new Set(model.scheduleRelations.map((relation) =>
        relation.definitionRelationId
    )).size, 1);
    assert.deepEqual(
        visible.nodes.filter((node) => node.kind === 'rule').map((node) => node.name),
        ['first', 'second']
    );
    assert.equal(visible.edges.length, 1);
    assert.equal(visible.edges[0].kind, 'execution-order');
    assert.equal(visible.edges[0].origin, 'source-attribute');
    assert.equal(visible.edges[0].confidence, 'explicit');
    assert.equal(visible.edges[0].analysisOrigin, 'Source-derived');
});
