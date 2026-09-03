'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');

function build(source, config = {}) {
    const parsed = parseBsvFile(source, {
        uri: 'file:///Feature.bsv',
        relativePath: 'Feature.bsv'
    });
    return buildArchitectureModel([parsed], normalizeConfig(config), {
        workspaceName: 'Feature',
        workspaceUri: 'file:///feature'
    });
}

const FEATURE_SOURCE = `
package Feature;
import FIFOF::*;

typedef UInt#(8) Word;
typedef struct {
    Word left;
    Bit#(4) right;
} Pair deriving (Bits, Eq);

interface PEIfc;
    method Action loadWeight(Bit#(8) weight);
    method Bool weightLoaded;
    method ActionValue#(Bit#(32)) step(Bit#(8) activation);
endinterface

(* descending_urgency = "produce, consume" *)
module mkPE(PEIfc);
    Reg#(Bool) loaded <- mkReg(False);
    FIFOF#(Word) fifo <- mkFIFOF;

    rule produce;
        fifo.enq(1);
        loaded <= True;
    endrule

    rule consume;
        let value = fifo.first;
        fifo.deq;
        loaded <= False;
    endrule

    method Action loadWeight(Bit#(8) weight);
        loaded <= True;
    endmethod
    method Bool weightLoaded = loaded;
    method ActionValue#(Bit#(32)) step(Bit#(8) activation);
        let value <- fifo.first;
        return zeroExtend(value);
    endmethod
endmodule
endpackage
`;

test('schema version 2 preserves old fields and adds node provenance', () => {
    const model = build(FEATURE_SOURCE);
    const moduleNode = model.nodes.find((node) => node.kind === 'module');

    assert.equal(model.schemaVersion, 2);
    assert.equal(moduleNode.parentId, 'package:Feature');
    assert.equal(moduleNode.ownerId, 'package:Feature');
    assert.equal(moduleNode.analysisOrigin, 'Source-derived');
    assert.equal(moduleNode.confidence, 'explicit');
    assert.ok(moduleNode.sourceEvidence);
    assert.ok(moduleNode.memberBuckets.methods.memberNodeIds.length === 3);
    assert.equal(moduleNode.memberBuckets.methods.collapsed, true);
    assert.equal(moduleNode.memberBuckets.state.totalCount, 2);
});

test('data flow edges preserve producer FIFO consumer direction and evidence', () => {
    const model = build(FEATURE_SOURCE);
    const id = (name, kind) => model.nodes.find((node) => node.name === name && node.kind === kind).id;
    const produce = id('produce', 'rule');
    const consume = id('consume', 'rule');
    const fifo = id('fifo', 'fifo');
    const data = model.edges.filter((edge) => edge.mode === 'data-flow');

    assert.ok(data.some((edge) =>
        edge.source === produce && edge.target === fifo && edge.kind === 'write' && edge.label === 'enqueue'
    ));
    assert.ok(data.some((edge) =>
        edge.source === fifo && edge.target === consume && edge.kind === 'read' && edge.label === 'first'
    ));
    assert.ok(data.every((edge) => edge.origin && edge.confidence && edge.evidence));
});

test('data flow excludes pure FIFO state effects while scheduling consumes them', () => {
    const model = build(`
package FifoEffects;
import FIFOF::*;
module mkFifoEffects(Empty);
    FIFOF#(UInt#(8)) fifo <- mkFIFOF;
    rule firstConsumer;
        let value = fifo.first;
        fifo.deq;
    endrule
    rule secondConsumer;
        fifo.deq;
    endrule
endmodule
endpackage
`);
    const fifoId = model.nodes.find((node) => node.name === 'fifo').id;
    const dataLabels = model.edges
        .filter((edge) => edge.mode === 'data-flow' && [edge.source, edge.target].includes(fifoId))
        .map((edge) => edge.label);
    const dependency = model.edges.find((edge) =>
        edge.kind === 'potential-state-dependency' && edge.label === 'fifo'
    );

    assert.deepEqual(dataLabels, ['first']);
    assert.match(dependency.evidence, /dequeues fifo/);
});

test('interface method ports include exact widths only when resolvable', () => {
    const model = build(FEATURE_SOURCE);
    const moduleNode = model.nodes.find((node) => node.kind === 'module');
    const pairType = model.nodes.find((node) => node.name === 'Pair');
    const ports = new Map(moduleNode.ports.map((port) => [port.name, port]));

    assert.equal(ports.get('loadWeight').category, 'action');
    assert.equal(ports.get('loadWeight').parameters[0].width.bits, 8);
    assert.equal(ports.get('weightLoaded').category, 'value');
    assert.deepEqual(ports.get('weightLoaded').resultWidth, {
        bits: 1,
        status: 'exact',
        origin: 'Bool'
    });
    assert.equal(ports.get('step').direction, 'request-response');
    assert.equal(ports.get('step').resultWidth.bits, 32);
    assert.deepEqual(pairType.details.width, {
        bits: 12,
        status: 'exact',
        origin: 'Pair'
    });
});

test('instance graph details retain parser identity and multiplicity metadata', () => {
    const model = build(`
package InstanceDetails;
module mkInstanceDetails(Empty);
    ChildIfc#(8) child <- mkChild#(8)(True);
    Vector#(4, ChildIfc) children <- replicateM(mkChild);
endmodule
endpackage
`);
    const child = model.nodes.find((node) => node.name === 'child');
    const children = model.nodes.find((node) => node.name === 'children');

    assert.deepEqual({
        declaredType: child.details.declaredType,
        constructorExpression: child.details.constructorExpression,
        staticArguments: child.details.staticArguments,
        specialization: child.details.specialization
    }, {
        declaredType: 'ChildIfc#(8)',
        constructorExpression: 'mkChild#(8)(True)',
        staticArguments: ['8'],
        specialization: '#(8)'
    });
    assert.deepEqual(children.details.multiplicity, {
        status: 'exact',
        count: 4,
        expression: '4'
    });
});

test('source and heuristic scheduling relations remain distinctly identified', () => {
    const model = build(FEATURE_SOURCE);
    const scheduling = model.edges.filter((edge) => edge.mode === 'scheduling');
    const urgency = scheduling.find((edge) => edge.kind === 'descending-urgency');
    const potential = scheduling.find((edge) => edge.kind === 'potential-state-dependency');

    assert.equal(urgency.origin, 'source-attribute');
    assert.equal(urgency.confidence, 'explicit');
    assert.equal(potential.origin, 'source-heuristic');
    assert.equal(potential.confidence, 'potential');
    assert.match(potential.evidence, /writes loaded|reads loaded/);
    assert.notEqual(potential.kind, 'conflict');
    assert.ok(['SOURCE-DERIVED', 'HEURISTIC', 'MIXED'].includes(model.scheduling.badge));
});

test('edge deduplication uses source target kind and evidence', () => {
    const model = build(FEATURE_SOURCE, {
        edges: [
            { from: 'mkPE', to: 'PEIfc', kind: 'control', label: 'first', evidence: 'same' },
            { from: 'mkPE', to: 'PEIfc', kind: 'control', label: 'second', evidence: 'same' },
            { from: 'mkPE', to: 'PEIfc', kind: 'control', label: 'third', evidence: 'different' }
        ]
    });
    const manual = model.edges.filter((edge) => edge.kind === 'control');

    assert.equal(manual.length, 2);
    assert.deepEqual(manual.map((edge) => edge.evidence).sort(), ['different', 'same']);
});

test('BSC relations remain authoritative and drive the authoritative badge', () => {
    const source = `
package CompilerSchedule;
module mkCompilerSchedule(Empty);
    rule first; noAction; endrule
    rule second; noAction; endrule
endmodule
endpackage
`;
    const parsed = parseBsvFile(source, {
        uri: 'file:///CompilerSchedule.bsv',
        relativePath: 'CompilerSchedule.bsv'
    });
    const model = buildArchitectureModel([parsed], normalizeConfig({
        scheduling: { provider: 'bsc', includePotentialDependencies: false }
    }), {
        workspaceName: 'Compiler schedule',
        workspaceUri: 'file:///compiler-schedule',
        scheduleProvider: 'bsc',
        scheduleRelations: [{
            from: 'first',
            to: 'second',
            kind: 'conflict',
            origin: 'bsc',
            confidence: 'authoritative',
            evidence: 'compiler relation fixture'
        }]
    });
    const edge = model.edges.find((item) => item.kind === 'conflict');

    assert.equal(edge.origin, 'bsc');
    assert.equal(edge.confidence, 'authoritative');
    assert.equal(model.scheduling.badge, 'BSC AUTHORITATIVE');
    assert.equal(model.scheduling.authoritative, true);
});

test('BSC relations retain matching heuristic support as evidence', () => {
    const parsed = parseBsvFile(`
package CompilerSupport;
module mkCompilerSupport(Empty);
    Reg#(Bool) active <- mkReg(False);
    rule first; active <= True; endrule
    rule second; let value = active; endrule
endmodule
endpackage
`, {
        uri: 'file:///CompilerSupport.bsv',
        relativePath: 'CompilerSupport.bsv'
    });
    const model = buildArchitectureModel([parsed], normalizeConfig({
        scheduling: { provider: 'bsc', includePotentialDependencies: true }
    }), {
        scheduleProvider: 'bsc',
        scheduleRelations: [{
            from: 'first',
            to: 'second',
            moduleName: 'mkCompilerSupport',
            kind: 'conflict',
            origin: 'bsc',
            confidence: 'authoritative',
            evidence: 'compiler relation fixture'
        }]
    });
    const edge = model.edges.find((item) => item.origin === 'bsc');

    assert.deepEqual(edge.supportingEvidence.map((item) => item.origin), ['source-heuristic']);
    assert.equal(model.edges.some((item) => item.kind === 'potential-state-dependency'), false);
});
