'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');

function parse(source, name = 'Feature.bsv') {
    return parseBsvFile(source, {
        uri: `file:///${name}`,
        relativePath: name
    });
}

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

test('source scheduling attributes attach to module relations', () => {
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

    assert.deepEqual(parsed.modules[0].scheduleRelations.map((relation) => ({
        source: relation.source,
        target: relation.target,
        kind: relation.kind,
        bidirectional: relation.bidirectional,
        origin: relation.origin,
        confidence: relation.confidence
    })), [
        {
            source: 'issueCompute',
            target: 'drainResult',
            kind: 'descending-urgency',
            bidirectional: false,
            origin: 'source-attribute',
            confidence: 'explicit'
        },
        {
            source: 'loadWeight',
            target: 'issueCompute',
            kind: 'mutually-exclusive',
            bidirectional: true,
            origin: 'source-attribute',
            confidence: 'explicit'
        }
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
    assert.deepEqual(parsed.modules[0].scheduleRelations, []);
});
