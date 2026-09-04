'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');
const { normalizeScheduleAttributes } = require('../src/architecture/scheduling');
const { buildSemanticModel } = require('../src/architecture/semantic/model');

function parsedSource(source) {
    return parseBsvFile(source, {
        uri: 'file:///SemanticSchedule.bsv',
        relativePath: 'SemanticSchedule.bsv'
    });
}

const SOURCE = `
package SemanticSchedule;
(* execution_order = "first, second" *)
module mkController(Empty);
    Reg#(Bool) state <- mkReg(False);
    rule first;
        state <= True;
    endrule
    rule second;
        let value = state;
    endrule
endmodule
module mkTop(Empty);
    Empty left <- mkController;
    Empty right <- mkController;
endmodule
endpackage
`;

test('source scheduling facts project into each instance context without changing provenance', () => {
    // Given
    const parsed = parsedSource(SOURCE);
    const sourceRelations = normalizeScheduleAttributes([parsed]);

    // When
    const model = buildSemanticModel([parsed], normalizeConfig({
        entrypoints: ['mkTop']
    }), {
        scheduleRelations: sourceRelations
    });
    const contextual = model.scheduleRelations.filter((relation) =>
        relation.definitionRelationId
    );

    // Then
    assert.equal(contextual.length, 2);
    assert.equal(new Set(contextual.map((relation) => relation.definitionRelationId)).size, 1);
    assert.deepEqual(
        contextual.map((relation) => relation.instancePath).sort(),
        ['mkTop.left', 'mkTop.right']
    );
    assert.ok(contextual.every((relation) =>
        relation.kind === 'execution-order'
        && relation.origin === 'source-attribute'
        && relation.confidence === 'explicit'
        && relation.analysisOrigin === 'Source-derived'
        && relation.contextualProjection === true
        && relation.sourceBehaviorId
        && relation.targetBehaviorId
        && relation.evidence
        && relation.location
        && relation.supportingRelationIds.length === 1
    ));
    assert.ok(model.indexes.scheduleByBehavior
        .get(contextual[0].sourceBehaviorId)
        .some((relation) => relation.id === contextual[0].id));
});

test('only BSC scheduling facts receive Compiler-authoritative provenance', () => {
    // Given
    const parsed = parsedSource(SOURCE);
    const bscRelation = {
        from: 'first',
        to: 'second',
        kind: 'conflict',
        moduleName: 'mkController',
        packageName: 'SemanticSchedule',
        origin: 'bsc',
        confidence: 'authoritative',
        evidence: 'BSC conflict relation',
        location: parsed.modules[0].location
    };

    // When
    const model = buildSemanticModel([parsed], normalizeConfig({
        entrypoints: ['mkTop']
    }), {
        scheduleRelations: [bscRelation],
        scheduleProvider: 'bsc'
    });

    // Then
    assert.equal(model.scheduleRelations.length, 2);
    assert.ok(model.scheduleRelations.every((relation) =>
        relation.origin === 'bsc'
        && relation.confidence === 'authoritative'
        && relation.analysisOrigin === 'Compiler-authoritative'
        && relation.evidence === 'BSC conflict relation'
        && relation.supportingRelationIds.length === 1
    ));
});

test('shared state emits potential scheduling only when no stronger fact exists', () => {
    // Given
    const parsed = parsedSource(`
package PotentialSchedule;
module mkController(Empty);
    Reg#(Bool) state <- mkReg(False);
    rule writeState;
        state <= True;
    endrule
    rule readState;
        let value = state;
    endrule
endmodule
endpackage
`);

    // When
    const model = buildSemanticModel([parsed], normalizeConfig({
        entrypoints: ['mkController']
    }), {});

    // Then
    assert.equal(model.scheduleRelations.length, 1);
    assert.equal(model.scheduleRelations[0].kind, 'potential-state-dependency');
    assert.equal(model.scheduleRelations[0].origin, 'source-heuristic');
    assert.equal(model.scheduleRelations[0].confidence, 'potential');
    assert.equal(model.scheduleRelations[0].analysisOrigin, 'Source-derived');
    assert.equal(model.scheduleRelations[0].bidirectional, true);
    assert.match(model.scheduleRelations[0].evidence, /state/);
});

test('potential scheduling stops deterministically at relation budget', () => {
    // Given
    const parsed = parsedSource(`
package ScheduleBudget;
module mkController(Empty);
    Reg#(Bool) state <- mkReg(False);
    rule first; state <= True; endrule
    rule second; let value = state; endrule
    rule third; state <= False; endrule
endmodule
endpackage
`);

    // When
    const model = buildSemanticModel([parsed], normalizeConfig({
        entrypoints: ['mkController']
    }), {
        limits: { maxEdges: 1 }
    });

    // Then
    assert.equal(model.scheduleRelations.length, 1);
    assert.ok(model.diagnostics.some((diagnostic) =>
        diagnostic.code === 'scheduling.limit'
        && diagnostic.severity === 'warning'
    ));
});
