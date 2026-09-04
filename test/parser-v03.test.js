'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');
const { analyzeTypeWidth } = require('../src/architecture/type-analysis');

function parse(source, name = 'Feature.bsv') {
    return parseBsvFile(source, {
        uri: `file:///${name}`,
        relativePath: name
    });
}

test('struct field comments do not contaminate following field types', () => {
    const parsed = parse(`
package CommentedStruct;
typedef struct {
    UInt#(32) first;
    // The next field carries a hardware contract.
    UInt#(32) second;
} Packet deriving (Bits, Eq);
endpackage
`);

    assert.deepEqual(parsed.types[0].details.fields, [
        { name: 'first', type: 'UInt#(32)' },
        { name: 'second', type: 'UInt#(32)' }
    ]);
});

test('typedef alias comments do not contaminate target widths', () => {
    const parsed = parse(`
package CommentedAlias;
typedef UInt#(/* hardware width */ 32) Word;
endpackage
`);

    assert.deepEqual(analyzeTypeWidth('Word', parsed.types), {
        bits: 32,
        status: 'exact',
        origin: 'Word'
    });
});

test('interface methods expose categories directions parameters and guards', () => {
    const parsed = parse(`
package Ports;
interface PEIfc;
    method Action loadWeight(Bit#(8) weight);
    method Bool weightLoaded;
    method ActionValue#(Bit#(32)) step(Bit#(8) activation) if (ready);
endinterface
endpackage
`);
    const methods = new Map(parsed.interfaces[0].methods.map((method) => [method.name, method]));

    assert.deepEqual(
        {
            category: methods.get('loadWeight').category,
            direction: methods.get('loadWeight').direction,
            returnType: methods.get('loadWeight').returnType,
            parameters: methods.get('loadWeight').parameters
        },
        {
            category: 'action',
            direction: 'input',
            returnType: 'Action',
            parameters: [{ name: 'weight', type: 'Bit#(8)' }]
        }
    );
    assert.equal(methods.get('weightLoaded').category, 'value');
    assert.equal(methods.get('weightLoaded').direction, 'output');
    assert.equal(methods.get('step').category, 'action-value');
    assert.equal(methods.get('step').direction, 'request-response');
    assert.equal(methods.get('step').guard, 'ready');
    assert.deepEqual(methods.get('step').port, {
        name: 'step',
        interface: 'PEIfc',
        category: 'action-value',
        direction: 'request-response',
        parameters: [{ name: 'activation', type: 'Bit#(8)' }],
        returnType: 'ActionValue#(Bit#(32))',
        resultType: 'Bit#(32)',
        guarded: true,
        guard: 'ready'
    });
});

test('Reg and FIFO behavior accesses are classified with evidence', () => {
    const parsed = parse(`
package Flow;
import FIFOF::*;
module mkFlow(Empty);
    Reg#(UInt#(8)) count <- mkReg(0);
    FIFOF#(UInt#(8)) fifo <- mkFIFOF;
    rule produce;
        count <= count + 1;
        fifo.enq(count);
    endrule
    rule consume;
        let value = fifo.first;
        fifo.deq;
    endrule
endmodule
endpackage
`);
    const rules = new Map(parsed.modules[0].rules.map((rule) => [rule.name, rule]));

    assert.ok(rules.get('produce').accesses.some((access) =>
        access.instance === 'count' && access.kind === 'write' && access.operation === 'register-write'
    ));
    assert.ok(rules.get('produce').accesses.some((access) =>
        access.instance === 'count' && access.kind === 'read' && access.operation === 'register-read'
    ));
    assert.ok(rules.get('produce').accesses.some((access) =>
        access.instance === 'fifo' && access.kind === 'write' && access.operation === 'enqueue'
    ));
    assert.ok(rules.get('consume').accesses.some((access) =>
        access.instance === 'fifo' && access.kind === 'read' && access.operation === 'first'
    ));
    assert.ok(rules.get('consume').accesses.some((access) =>
        access.instance === 'fifo' && access.kind === 'read' && access.operation === 'dequeue'
    ));
    assert.ok(rules.get('consume').accesses.every((access) =>
        access.evidence.callable === 'consume'
        && Number.isInteger(access.evidence.statementLine)
        && access.evidence.snippet
    ));
});

test('FIFO accesses separate payload data flow from state effects', () => {
    const parsed = parse(`
package Effects;
import FIFOF::*;
module mkEffects(Empty);
    FIFOF#(UInt#(8)) fifo <- mkFIFOF;
    rule inspect;
        let ready = fifo.notEmpty;
        let value = fifo.peek;
        fifo.deq;
        fifo.clear;
    endrule
endmodule
endpackage
`);
    const accesses = new Map(parsed.modules[0].rules[0].accesses.map((access) => [access.member, access]));

    assert.deepEqual(
        ['notEmpty', 'peek', 'deq', 'clear'].map((member) => ({
            member,
            dataFlow: accesses.get(member).dataFlow,
            stateEffect: accesses.get(member).stateEffect
        })),
        [
            { member: 'notEmpty', dataFlow: 'read', stateEffect: 'observe' },
            { member: 'peek', dataFlow: 'read', stateEffect: 'observe' },
            { member: 'deq', dataFlow: null, stateEffect: 'dequeue' },
            { member: 'clear', dataFlow: null, stateEffect: 'clear' }
        ]
    );
});

test('ActionValue result binding is retained as return data flow', () => {
    const parsed = parse(`
package Binding;
interface SourceIfc;
    method ActionValue#(Bit#(8)) get;
endinterface
module mkBinding(Empty);
    SourceIfc source <- mkSource;
    rule capture;
        let item <- source.get;
    endrule
endmodule
endpackage
`);
    const access = parsed.modules[0].rules[0].accesses.find((item) => item.instance === 'source');
    assert.equal(access.member, 'get');
    assert.equal(access.resultBinding, 'item');
    assert.equal(access.kind, 'return');
    assert.equal(access.operation, 'action-value-result');
});

test('parameterized and inferred instances preserve constructor specialization', () => {
    const parsed = parse(`
package Instances;
module mkInstances(Empty);
    ChildIfc#(8) typed <- mkChild#(8)(True);
    let inferred <- mkChild#(16)(False);
endmodule
endpackage
`);

    assert.deepEqual(parsed.modules[0].instances.map((instance) => ({
        name: instance.name,
        type: instance.type,
        declaredType: instance.declaredType,
        constructor: instance.constructor,
        constructorExpression: instance.constructorExpression,
        staticArguments: instance.staticArguments,
        arguments: instance.arguments,
        specialization: instance.specialization
    })), [
        {
            name: 'typed',
            type: 'ChildIfc#(8)',
            declaredType: 'ChildIfc#(8)',
            constructor: 'mkChild',
            constructorExpression: 'mkChild#(8)(True)',
            staticArguments: ['8'],
            arguments: ['True'],
            specialization: '#(8)'
        },
        {
            name: 'inferred',
            type: 'inferred',
            declaredType: null,
            constructor: 'mkChild',
            constructorExpression: 'mkChild#(16)(False)',
            staticArguments: ['16'],
            arguments: ['False'],
            specialization: '#(16)'
        }
    ]);
});

test('replicateM and mapM preserve exact parameterized and unresolved multiplicity', () => {
    const parsed = parse(`
package Multiplicity;
module mkMultiplicity#(numeric type lanes)(Empty);
    Vector#(4, ChildIfc) exact <- replicateM(mkChild);
    Vector#(lanes, ChildIfc) parameterized <- replicateM(mkChild);
    let mapped <- mapM(mkChild, configs);
endmodule
endpackage
`);

    assert.deepEqual(parsed.modules[0].instances.map((instance) => ({
        name: instance.name,
        constructor: instance.constructor,
        primitiveKind: instance.primitiveKind,
        multiplicity: instance.multiplicity
    })), [
        {
            name: 'exact',
            constructor: 'replicateM',
            primitiveKind: 'vector',
            multiplicity: { status: 'exact', count: 4, expression: '4' }
        },
        {
            name: 'parameterized',
            constructor: 'replicateM',
            primitiveKind: 'vector',
            multiplicity: { status: 'parameterized', count: null, expression: 'lanes' }
        },
        {
            name: 'mapped',
            constructor: 'mapM',
            primitiveKind: null,
            multiplicity: { status: 'unresolved', count: null, expression: null }
        }
    ]);
});

test('enum parser preserves explicit encoding expressions', () => {
    const parsed = parse(`
package Encoded;
typedef enum { Idle = 0, Busy = 3, Error = 7 } State deriving (Bits, Eq);
endpackage
`);

    assert.deepEqual(parsed.types[0].details, {
        variants: ['Idle', 'Busy', 'Error'],
        variantValues: [
            { name: 'Idle', value: '0' },
            { name: 'Busy', value: '3' },
            { name: 'Error', value: '7' }
        ]
    });
});

test('parser preserves raw scheduling attributes with owners', () => {
    const parsed = parse(`
package Schedule;
(* descending_urgency = "issueCompute, drainResult" *)
(* mutually_exclusive = "loadWeight, issueCompute" *)
module mkController(Empty);
    rule issueCompute; noAction; endrule
    rule drainResult; noAction; endrule
    method Action loadWeight; noAction; endmethod
endmodule
endpackage
`);

    assert.deepEqual(parsed.modules[0].bsvAttributes.map((attribute) => ({
        ownerKind: attribute.ownerKind,
        ownerName: attribute.ownerName,
        name: attribute.name,
        names: attribute.names,
        rawValue: attribute.rawValue
    })), [
        {
            ownerKind: 'module',
            ownerName: 'mkController',
            name: 'descending_urgency',
            names: ['issueCompute', 'drainResult'],
            rawValue: '"issueCompute, drainResult"'
        },
        {
            ownerKind: 'module',
            ownerName: 'mkController',
            name: 'mutually_exclusive',
            names: ['loadWeight', 'issueCompute'],
            rawValue: '"loadWeight, issueCompute"'
        }
    ]);
    assert.equal(parsed.modules[0].scheduleRelations, undefined);
    assert.ok(parsed.modules[0].bsvAttributes.every((attribute) => attribute.location.uri === 'file:///Feature.bsv'));
});

test('parser preserves rule and method scheduling attribute owners', () => {
    const parsed = parse(`
package ScheduleOwners;
module mkController(Empty);
    (* preempts = "issue, drain" *)
    rule issue; noAction; endrule
    (* conflict_free = "loadWeight, step" *)
    method Action loadWeight; noAction; endmethod
endmodule
endpackage
`);
    const module = parsed.modules[0];

    assert.deepEqual([
        ...module.rules.flatMap((rule) => rule.bsvAttributes),
        ...module.methods.flatMap((method) => method.bsvAttributes)
    ].map(({ ownerKind, ownerName, moduleName }) => ({
        ownerKind,
        ownerName,
        moduleName
    })), [
        { ownerKind: 'rule', ownerName: 'issue', moduleName: 'mkController' },
        { ownerKind: 'method', ownerName: 'loadWeight', moduleName: 'mkController' }
    ]);
});

test('duplicate method names retain line-based architecture IDs', () => {
    const source = `
package Duplicate;
module mkDuplicate(Empty);
    method Action update; noAction; endmethod
    method Action update; noAction; endmethod
endmodule
endpackage
`;
    const parsed = parse(source, 'Duplicate.bsv');
    const model = buildArchitectureModel([parsed], normalizeConfig({}), {});
    const methods = model.nodes.filter((node) => node.kind === 'method' && node.name === 'update');

    assert.equal(methods.length, 2);
    assert.notEqual(methods[0].id, methods[1].id);
});

test('comments and strings cannot manufacture v0.3 syntax', () => {
    const parsed = parse(`
package Safe;
// method Action fake(Bit#(8) value);
// (* descending_urgency = "fake, real" *)
interface SafeIfc;
    method Bool real;
endinterface
module mkSafe(Empty);
    String text = "fifo.enq(value); (* preempts = \\"fake, real\\" *)";
endmodule
endpackage
`);

    assert.deepEqual(parsed.interfaces[0].methods.map((method) => method.name), ['real']);
    assert.deepEqual(parsed.modules[0].bsvAttributes, []);
});
