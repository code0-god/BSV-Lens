'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');

function build(source) {
    const parsed = parseBsvFile(source, {
        uri: 'file:///Contract.bsv',
        relativePath: 'Contract.bsv'
    });
    return buildArchitectureModel([parsed], normalizeConfig({}), {});
}

test('matching interface and module methods produce an exact source-derived contract', () => {
    const model = build(`
package ExactContract;
interface ExactIfc;
    method Action load(Bit#(8) value);
    method Bool ready;
    method ActionValue#(Bit#(32)) take;
endinterface
module mkExact(ExactIfc);
    method Action load(Bit#(8) value);
        noAction;
    endmethod
    method Bool ready = True;
    method ActionValue#(Bit#(32)) take;
        return 0;
    endmethod
endmodule
endpackage
`);
    const contract = model.interfaceContracts[0];

    assert.deepEqual({
        interfaceId: contract.interfaceId,
        moduleId: contract.moduleId,
        interfaceName: contract.interfaceName,
        moduleName: contract.moduleName,
        status: contract.status,
        analysisOrigin: contract.analysisOrigin,
        methods: contract.methods.map((method) => [method.name, method.status]),
        diagnostics: contract.diagnostics
    }, {
        interfaceId: 'interface:ExactContract.ExactIfc',
        moduleId: 'module:ExactContract.mkExact',
        interfaceName: 'ExactIfc',
        moduleName: 'mkExact',
        status: 'exact',
        analysisOrigin: 'Source-derived',
        methods: [
            ['load', 'exact'],
            ['ready', 'exact'],
            ['take', 'exact']
        ],
        diagnostics: []
    });
});

test('interface contracts exclude methods implemented by nested provided interfaces', () => {
    const model = build(`
package NestedContract;
interface SinkIfc;
    method Bool ready;
    method Action put(Bit#(8) value);
endinterface
interface ControllerIfc;
    interface SinkIfc sink;
    method Bool issueValid;
endinterface
module mkController(ControllerIfc);
    interface SinkIfc sink;
        method Bool ready = True;
        method Action put(Bit#(8) value);
            noAction;
        endmethod
    endinterface
    method Bool issueValid = True;
endmodule
endpackage
`);
    const contract = model.interfaceContracts.find((item) => item.moduleName === 'mkController');

    assert.equal(contract.status, 'exact');
    assert.deepEqual(
        contract.methods.map((method) => [method.name, method.status]),
        [['issueValid', 'exact']]
    );
    assert.deepEqual(contract.diagnostics, []);
});

test('interface contracts report missing unexpected duplicate and signature mismatches', () => {
    const model = build(`
package ContractMismatch;
interface ExpectedIfc;
    method Action start(Bit#(8) value);
    method Action load(Bit#(8) value);
    method Bool ready;
    method ActionValue#(Bit#(8)) take;
    method Foo#(n) generic;
    method Bool missing;
endinterface
module mkMismatch(ExpectedIfc);
    method Action start();
        noAction;
    endmethod
    method Action load(Bit#(16) value);
        noAction;
    endmethod
    method Action ready;
        noAction;
    endmethod
    method ActionValue#(Bit#(16)) take;
        return 0;
    endmethod
    method Foo#(m) generic = makeFoo(x);
    method Bool extra = True;
    method Bool extra = False;
endmodule
endpackage
`);
    const contract = model.interfaceContracts[0];
    const mismatchKinds = contract.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'warning')
        .map((diagnostic) => `${diagnostic.mismatchKind}:${diagnostic.methodName}`)
        .sort();

    assert.equal(contract.status, 'mismatch');
    assert.deepEqual(mismatchKinds, [
        'duplicate-implementation:extra',
        'method-category:ready',
        'missing-method:missing',
        'parameter-count:start',
        'parameter-type:load',
        'return-type:ready',
        'return-type:take',
        'unexpected-method:extra'
    ]);
    assert.ok(contract.diagnostics.every((diagnostic) =>
        diagnostic.interfaceName === 'ExpectedIfc'
        && diagnostic.moduleName === 'mkMismatch'
        && diagnostic.analysisOrigin === 'Source-derived'
        && diagnostic.location
    ));
    assert.match(
        contract.diagnostics.find((diagnostic) => diagnostic.mismatchKind === 'missing-method').message,
        /Interface contract mismatch:\nExpectedIfc -> mkMismatch/
    );
});
