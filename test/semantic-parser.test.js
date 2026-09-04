'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseBsvFile } = require('../src/architecture/parser');

function parse(source) {
    return parseBsvFile(source, {
        uri: 'file:///SemanticParser.bsv',
        relativePath: 'SemanticParser.bsv'
    });
}

test('module signature separates type formals constructor formals return interface and provisos', () => {
    // Given
    const source = `
package SemanticParser;
interface UpstreamIfc#(numeric type n);
endinterface
interface ChildIfc#(numeric type n);
endinterface
module mkChild#(
    numeric type n,
    UpstreamIfc#(n) upstream,
    Integer limit
)(
    ChildIfc#(n)
) provisos (
    Bits#(ChildIfc#(n), childBits),
    Add#(1, n, nextN)
);
endmodule
endpackage
`;

    // When
    const module = parse(source).modules[0];

    // Then
    assert.equal(module.returnInterface, 'ChildIfc');
    assert.equal(module.returnInterfaceExpression, 'ChildIfc#(n)');
    assert.deepEqual(module.typeParameters, [{
        name: 'n',
        kind: 'numeric-type',
        declaration: 'numeric type n'
    }]);
    assert.deepEqual(module.constructorParameters, [
        {
            name: 'upstream',
            type: 'UpstreamIfc#(n)',
            declaration: 'UpstreamIfc#(n) upstream'
        },
        {
            name: 'limit',
            type: 'Integer',
            declaration: 'Integer limit'
        }
    ]);
    assert.deepEqual(module.provisos, [
        'Bits#(ChildIfc#(n), childBits)',
        'Add#(1, n, nextN)'
    ]);
});

test('provided interfaces preserve nested paths and explicit alias targets', () => {
    // Given
    const source = `
package SemanticParser;
module mkForwarder(OuterIfc);
    interface ReadPortIfc activationPort;
        interface requests = load.activationPort.requests;
        interface responses = staging.activationResponses;
    endinterface
    interface outputPort = store.outputPort;
    interface accumulator = accumulators;
endmodule
endpackage
`;

    // When
    const provided = parse(source).modules[0].providedInterfaces;

    // Then
    assert.deepEqual(provided.map((item) => ({
        name: item.name,
        path: item.path,
        parentPath: item.parentPath,
        form: item.form,
        targetExpression: item.targetExpression,
        members: item.members?.map((member) => ({
            name: member.name,
            path: member.path,
            parentPath: member.parentPath,
            form: member.form,
            targetExpression: member.targetExpression
        })) || []
    })), [
        {
            name: 'activationPort',
            path: ['activationPort'],
            parentPath: [],
            form: 'block',
            targetExpression: null,
            members: [
                {
                    name: 'requests',
                    path: ['activationPort', 'requests'],
                    parentPath: ['activationPort'],
                    form: 'alias',
                    targetExpression: 'load.activationPort.requests'
                },
                {
                    name: 'responses',
                    path: ['activationPort', 'responses'],
                    parentPath: ['activationPort'],
                    form: 'alias',
                    targetExpression: 'staging.activationResponses'
                }
            ]
        },
        {
            name: 'outputPort',
            path: ['outputPort'],
            parentPath: [],
            form: 'alias',
            targetExpression: 'store.outputPort',
            members: []
        },
        {
            name: 'accumulator',
            path: ['accumulator'],
            parentPath: [],
            form: 'alias',
            targetExpression: 'accumulators',
            members: []
        }
    ]);
});

test('behavior facts retain invocation arguments and simple value aliases', () => {
    // Given
    const source = `
package SemanticParser;
module mkFlowTop(Empty);
    SchedulerIfc scheduler <- mkScheduler;
    WorkerIfc worker <- mkWorker;
    rule bridge;
        let work = scheduler.currentWork;
        worker.start(work, work.kTileStart != 0);
    endrule
endmodule
endpackage
`;

    // When
    const accesses = parse(source).modules[0].rules[0].accesses;
    const currentWork = accesses.find((access) =>
        access.instance === 'scheduler' && access.memberPath === 'currentWork'
    );
    const start = accesses.find((access) =>
        access.instance === 'worker' && access.memberPath === 'start'
    );

    // Then
    assert.equal(currentWork.valueBinding, 'work');
    assert.deepEqual(currentWork.arguments, []);
    assert.deepEqual(start.arguments, ['work', 'work.kTileStart != 0']);
    assert.equal(start.evidence.callable, 'bridge');
    assert.match(start.sourceEvidence, /worker\.start/);
});

test('malformed provided interface remains incomplete without invented members', () => {
    // Given
    const source = `
package SemanticParser;
module mkMalformed(OuterIfc);
    interface ReadPortIfc activationPort;
        interface requests = load.activationPort.requests;
endmodule
endpackage
`;

    // When
    const provided = parse(source).modules[0].providedInterfaces;

    // Then
    assert.equal(provided.length, 1);
    assert.equal(provided[0].complete, false);
    assert.deepEqual(provided[0].members, []);
});

test('methods inside provided interface blocks retain semantic interface paths', () => {
    // Given
    const source = `
package SemanticParser;
module mkPorts(OuterIfc);
    interface LeftIfc left;
        method Bool valid = True;
    endinterface
    interface RightIfc right;
        method Bool valid = False;
    endinterface
endmodule
endpackage
`;

    // When
    const methods = parse(source).modules[0].methods;

    // Then
    assert.deepEqual(methods.map((method) => ({
        name: method.name,
        interfacePath: method.interfacePath
    })), [
        { name: 'valid', interfacePath: ['left'] },
        { name: 'valid', interfacePath: ['right'] }
    ]);
});
