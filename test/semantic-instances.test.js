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

test('replicateM preserves ordered module-family dimensions and leaf constructor', () => {
    // Given
    const source = `
package NestedAggregate;
interface ChildIfc;
endinterface
module mkChild(ChildIfc);
endmodule
module mkTop(Empty);
    Vector#(2, Vector#(3, ChildIfc)) children <- replicateM(replicateM(mkChild));
endmodule
endpackage
`;

    // When
    const family = build(source).instances.find((instance) => instance.name === 'children');

    // Then
    assert.equal(family.targetDefinitionId, 'def:NestedAggregate:mkChild');
    assert.equal(family.primitiveKind, null);
    assert.deepEqual(family.family, {
        kind: 'module-family',
        declaredType: 'Vector#(2, Vector#(3, ChildIfc))',
        dimensions: [
            { expression: '2', status: 'concrete', size: 2, indexDomain: { lower: 0, upperExclusive: 2 } },
            { expression: '3', status: 'concrete', size: 3, indexDomain: { lower: 0, upperExclusive: 3 } }
        ],
        leafType: 'ChildIfc',
        generatorExpression: 'replicateM(replicateM(mkChild))',
        generatorKind: 'replicateM',
        generatorDepth: 2,
        leafConstructor: 'mkChild',
        resolutionStatus: 'exact',
        elementExpansion: 'lazy'
    });
    assert.deepEqual(family.multiplicity, { status: 'exact', count: 6, expression: '2 * 3' });
});

test('symbolic storage families remain distinct from packed vector registers', () => {
    // Given
    const source = `
package StorageAggregate;
module mkTop#(numeric type n)(Empty);
    Vector#(n, Reg#(Bit#(8))) lanes <- replicateM(mkReg(0));
    Reg#(Vector#(n, Bit#(8))) packed <- mkReg(replicate(0));
endmodule
endpackage
`;

    // When
    const model = build(source, { entrypoints: ['mkTop'] });
    const lanes = model.instances.find((instance) => instance.name === 'lanes');
    const packed = model.instances.find((instance) => instance.name === 'packed');

    // Then
    assert.equal(lanes.primitiveKind, 'register');
    assert.equal(lanes.family.kind, 'storage-family');
    assert.deepEqual(lanes.family.dimensions, [{
        expression: 'n', status: 'symbolic', size: null,
        indexDomain: { lower: 0, upperExclusive: null, expression: 'n' }
    }]);
    assert.equal(lanes.family.leafType, 'Reg#(Bit#(8))');
    assert.equal(lanes.family.resolutionStatus, 'symbolic');
    assert.equal(packed.primitiveKind, 'register');
    assert.equal(packed.family, null);
    assert.equal(packed.declaredType, 'Reg#(Vector#(n, Bit#(8)))');
});

test('mapM preserves unresolved generator structure without inventing repeated constructors', () => {
    // Given
    const source = `
package MappedAggregate;
interface ChildIfc;
endinterface
module mkTop(Empty);
    Vector#(count, ChildIfc) children <- mapM(makeChild, indices);
endmodule
endpackage
`;

    // When
    const family = build(source, { entrypoints: ['mkTop'] }).instances
        .find((instance) => instance.name === 'children');

    // Then
    assert.equal(family.targetDefinitionId, null);
    assert.equal(family.family.generatorKind, 'mapM');
    assert.equal(family.family.leafConstructor, null);
    assert.equal(family.family.resolutionStatus, 'unresolved');
    assert.equal(family.expansionStatus, 'unresolved');
});

test('family detection does not intercept direct vector constructors', () => {
    const source = `
package DirectVector;
interface ChildIfc;
endinterface
module mkVectorChild(ChildIfc);
endmodule
module mkTop(Empty);
    Vector#(2, ChildIfc) children <- mkVectorChild;
endmodule
endpackage
`;
    const child = build(source).instances.find((instance) => instance.name === 'children');
    assert.equal(child.family, null);
    assert.equal(child.targetDefinitionId, 'def:DirectVector:mkVectorChild');
});

test('mapM resolves a direct module constructor but keeps varying generation unresolved', () => {
    const source = `
package KnownMap;
interface ChildIfc;
endinterface
module mkChild(ChildIfc);
endmodule
module mkTop(Empty);
    Vector#(count, ChildIfc) children <- mapM(mkChild, configs);
endmodule
endpackage
`;
    const child = build(source, { entrypoints: ['mkTop'] }).instances.find((instance) => instance.name === 'children');
    assert.equal(child.targetDefinitionId, 'def:KnownMap:mkChild');
    assert.equal(child.family.leafConstructor, 'mkChild');
    assert.equal(child.family.resolutionStatus, 'unresolved');
});

test('missing family constructors and unsafe dimension products are not exact', () => {
    const source = `
package InvalidFamilies;
interface ChildIfc;
endinterface
module mkTop(Empty);
    Vector#(2, ChildIfc) missing <- replicateM(mkMissing);
    Vector#(9007199254740991, Vector#(2, ChildIfc)) huge <- replicateM(replicateM(mkMissing));
endmodule
endpackage
`;
    const model = build(source, { entrypoints: ['mkTop'] });
    const missing = model.instances.find((instance) => instance.name === 'missing');
    const huge = model.instances.find((instance) => instance.name === 'huge');
    assert.equal(missing.family.resolutionStatus, 'unresolved');
    assert.equal(huge.multiplicity.status, 'unresolved');
    assert.equal(huge.multiplicity.count, null);
});

test('RegFile constructors classify as memory rather than register', () => {
    const source = `
package Memories;
module mkTop(Empty);
    RegFile#(Bit#(4), Bit#(8)) table <- mkRegFileFull;
endmodule
endpackage
`;
    assert.equal(build(source, { entrypoints: ['mkTop'] }).instances.find((item) => item.name === 'table').primitiveKind, 'memory');
});

test('indexed storage family accesses retain deterministic element identity', () => {
    const source = `
package IndexedFamily;
module mkTop(Empty);
    Vector#(2, Reg#(Bit#(8))) regs <- replicateM(mkReg(0));
    rule update;
        regs[1] <= regs[0] + 1;
    endrule
endmodule
endpackage
`;
    const model = build(source, { entrypoints: ['mkTop'] });
    const family = model.instances.find((item) => item.name === 'regs');
    const behavior = model.stateBehaviors.find((item) => item.name === 'update');
    const statement = model.statements.find((item) => item.kind === 'state-assignment');
    assert.equal(model.expressions.find((item) => item.id === statement.targetExpressionId).text, 'regs[1]');
    const accesses = model.bindings.filter((item) =>
        item.kind === 'behavior-access' && item.behaviorId === behavior.id);
    assert.deepEqual(accesses.map((item) => [item.accessKind, item.elementRef]).sort(), [
        ['read', {
            familyInstanceId: family.id,
            id: `${family.id}[0]`,
            indices: [{ expression: '0', value: 0, resolutionStatus: 'exact' }],
            resolutionStatus: 'exact'
        }],
        ['write', {
            familyInstanceId: family.id,
            id: `${family.id}[1]`,
            indices: [{ expression: '1', value: 1, resolutionStatus: 'exact' }],
            resolutionStatus: 'exact'
        }]
    ]);
});

test('indexed family member calls and unbraced else writes keep their element identity', () => {
    const source = `
package IndexedMembers;
module mkTop(Empty);
    Vector#(2, FIFOF#(Bit#(8))) queues <- replicateM(mkFIFOF);
    Vector#(2, Reg#(Bit#(8))) regs <- replicateM(mkReg(0));
    Reg#(Bool) choose <- mkReg(False);
    rule update;
        queues[1].enq(8);
        let value = queues[0].first;
        if (choose) regs[0] <= value; else regs[1] <= 2;
    endrule
endmodule
endpackage
`;
    const model = build(source, { entrypoints: ['mkTop'] });
    const byName = new Map(model.instances.map((item) => [item.name, item]));
    const nameById = new Map(model.instances.map((item) => [item.id, item.name]));
    const behavior = model.stateBehaviors.find((item) => item.name === 'update');
    const accesses = model.bindings.filter((item) =>
        item.kind === 'behavior-access' && item.behaviorId === behavior.id && item.elementRef);
    assert.deepEqual(accesses.map((item) => [nameById.get(item.elementRef.familyInstanceId), item.accessKind, item.elementRef.id]).sort(), [
        ['queues', 'read', `${byName.get('queues').id}[0]`],
        ['queues', 'write', `${byName.get('queues').id}[1]`],
        ['regs', 'write', `${byName.get('regs').id}[0]`],
        ['regs', 'write', `${byName.get('regs').id}[1]`]
    ]);
});

test('case-controlled and symbolic family accesses keep their honest control and element status', () => {
    const source = `
package ControlledFamily;
module mkTop(Empty);
    Vector#(2, Reg#(Bit#(8))) regs <- replicateM(mkReg(0));
    Reg#(Bit#(2)) selector <- mkReg(0);
    rule selectWrite;
        case (selector)
            0: regs[0] <= 1;
            default: regs[1] <= 2;
        endcase
    endrule
    rule symbolicWrite;
        regs[selector] <= 3;
    endrule
endmodule
endpackage
`;
    const model = build(source, { entrypoints: ['mkTop'] });
    const select = model.stateBehaviors.find((item) => item.name === 'selectWrite');
    const controlled = model.bindings.filter((item) => item.behaviorId === select.id && item.targetInstanceId
        === model.instances.find((item) => item.name === 'regs').id && item.accessKind === 'write');
    assert.equal(controlled.length, 2);
    assert.deepEqual(controlled.map((item) => item.caseConditions[0].kind), ['case-arm', 'case-default']);
    assert.equal(controlled[0].caseConditions[0].semantics, 'selector-matches-label');
    assert.equal(controlled[1].caseConditions[0].semantics, 'no-prior-arm-match');
    assert.deepEqual(controlled[1].caseConditions[0].priorLabelExpressionIds,
        controlled[0].caseConditions[0].labelExpressionIds);
    assert.ok(controlled.every((item) => item.caseArmIds.length === 1 && item.resolutionStatus === 'exact'));
    const symbolic = model.bindings.find((item) => item.behaviorId
        === model.stateBehaviors.find((behavior) => behavior.name === 'symbolicWrite').id
        && item.accessKind === 'write');
    assert.equal(symbolic.elementRef.id, null);
    assert.equal(symbolic.elementRef.resolutionStatus, 'unresolved');
    assert.equal(symbolic.resolutionStatus, 'unresolved');
    assert.equal(symbolic.confidence, 'unknown');
});
