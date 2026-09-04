'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');

function build(source) {
    const parsed = parseBsvFile(source, {
        uri: 'file:///ContractEdge.bsv',
        relativePath: 'ContractEdge.bsv'
    });
    return buildArchitectureModel([parsed], normalizeConfig({}), {});
}

test('provided-interface ranges span nested interface blocks to their matching terminator', () => {
    const model = build(`
package DeepNestedContract;
interface InnerIfc;
    method Bool innerReady;
endinterface
interface OuterIfc;
    interface InnerIfc inner;
    method Bool outerReady;
endinterface
interface TopIfc;
    interface OuterIfc outer;
    method Bool topReady;
endinterface
module mkTop(TopIfc);
    interface OuterIfc outer;
        interface InnerIfc inner;
            method Bool innerReady = True;
        endinterface
        method Bool outerReady = True;
    endinterface
    method Bool topReady = True;
endmodule
endpackage
`);
    const contract = model.interfaceContracts.find((item) => item.moduleName === 'mkTop');

    assert.equal(contract.status, 'exact');
    assert.deepEqual(
        contract.methods.map((method) => [method.name, method.status]),
        [['topReady', 'exact']]
    );
    assert.deepEqual(contract.diagnostics, []);
});

test('malformed provided-interface blocks make contracts unresolved without hiding methods', () => {
    const model = build(`
package MalformedProvided;
interface TopIfc;
    method Bool ready;
endinterface
module mkMalformed(TopIfc);
    interface NestedIfc nested;
    method Bool ready = True;
endmodule
endpackage
`);
    const contract = model.interfaceContracts[0];

    assert.equal(contract.status, 'unresolved');
    assert.deepEqual(contract.diagnostics.map((diagnostic) => ({
        mismatchKind: diagnostic.mismatchKind,
        severity: diagnostic.severity,
        analysisOrigin: diagnostic.analysisOrigin
    })), [{
        mismatchKind: 'provided-interface-range',
        severity: 'info',
        analysisOrigin: 'Source-derived'
    }]);
});

test('interface contracts mark uppercase generic type parameters unresolved', () => {
    const model = build(`
package GenericContract;
interface GenericIfc;
    method Foo#(N) value(Bar#(M) inputValue);
endinterface
module mkGeneric(GenericIfc);
    method Foo#(P) value(Bar#(Q) inputValue) = makeFoo(inputValue);
endmodule
endpackage
`);
    const contract = model.interfaceContracts[0];
    const method = contract.methods[0];

    assert.equal(contract.status, 'unresolved');
    assert.equal(method.status, 'unresolved');
    assert.deepEqual(
        method.diagnostics
            .map((diagnostic) => [diagnostic.mismatchKind, diagnostic.severity])
            .sort(([left], [right]) => left.localeCompare(right)),
        [
            ['parameter-type', 'info'],
            ['return-type', 'info']
        ]
    );
    assert.equal(model.diagnostics.some((diagnostic) =>
        diagnostic.code === 'contract.mismatch'
    ), false);
});

test('interface contracts remain unresolved when the return interface definition is unavailable', () => {
    const model = build(`
package MissingInterface;
module mkExternal(ExternalIfc#(n));
    method Bool ready = True;
endmodule
endpackage
`);
    const contract = model.interfaceContracts[0];

    assert.deepEqual({
        interfaceId: contract.interfaceId,
        moduleName: contract.moduleName,
        interfaceName: contract.interfaceName,
        status: contract.status,
        analysisOrigin: contract.analysisOrigin,
        diagnostics: contract.diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            mismatchKind: diagnostic.mismatchKind,
            severity: diagnostic.severity
        }))
    }, {
        interfaceId: null,
        moduleName: 'mkExternal',
        interfaceName: 'ExternalIfc',
        status: 'unresolved',
        analysisOrigin: 'Source-derived',
        diagnostics: [{
            code: 'contract.unresolved',
            mismatchKind: 'interface-resolution',
            severity: 'info'
        }]
    });
});
