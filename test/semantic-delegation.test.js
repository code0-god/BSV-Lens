'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSemanticSource } = require('./semantic-fixture');

function buildProxy(body, options = {}) {
    const formals = options.formals || 'SourceIfc upstream';
    const actuals = options.actuals || 'producer';
    const declarations = options.declarations || 'SourceIfc producer <- mkSource;';
    const source = `
package Delegation;
interface SourceIfc;
    method Bit#(8) value;
endinterface
module mkSource(SourceIfc);
    method Bit#(8) value = 1;
endmodule
module mkProxy#(${formals})(SourceIfc);
${body}
endmodule
module mkTop(Empty);
    ${declarations}
    SourceIfc proxy <- mkProxy(${actuals});
endmodule
endpackage
`;
    return buildSemanticSource(source, 'Delegation.bsv', { entrypoints: ['mkTop'] });
}

function proxyContext(model) {
    const proxy = model.instances.find((instance) => instance.path === 'mkTop.proxy');
    const behavior = model.stateBehaviors.find((candidate) =>
        candidate.ownerInstanceId === proxy.id && candidate.name === 'value'
    );
    const endpoint = model.endpoints.find((candidate) =>
        candidate.ownerInstanceId === proxy.id
        && candidate.kind === 'method-endpoint'
        && candidate.name === 'value'
    );
    return {
        proxy,
        behavior,
        endpoint,
        bindings: model.bindings.filter((binding) => binding.behaviorId === behavior.id),
        incomingReturns: model.semanticFlows.filter((flow) =>
            flow.kind === 'return' && flow.toBehaviorId === behavior.id
        )
    };
}

test('constant return does not fabricate delegation evidence and preserves structural semantics', () => {
    const model = buildProxy('    method Bit#(8) value = 42;');
    const { proxy, behavior, endpoint, bindings, incomingReturns } = proxyContext(model);

    assert.deepEqual(bindings, []);
    assert.deepEqual(incomingReturns, []);
    assert.ok(model.bindings.some((binding) =>
        binding.kind === 'constructor-binding'
        && binding.targetInstanceId === proxy.id
        && binding.formalParameter.name === 'upstream'
        && binding.resolutionStatus === 'exact'
    ));
    assert.ok(model.semanticFlows.some((flow) =>
        flow.implementationLink
        && flow.kind === 'return'
        && flow.fromBehaviorId === behavior.id
        && flow.toEndpointId === endpoint.id
    ));
    assert.equal(JSON.stringify(model).includes('return upstream.value;'), false);
});

test('unused same-name constructor interface does not imply a delegation', () => {
    const model = buildProxy(`    method Bit#(8) value;
        return 8'h2a;
    endmethod`);
    const { bindings, incomingReturns } = proxyContext(model);

    assert.deepEqual(bindings, []);
    assert.deepEqual(incomingReturns, []);
});

test('computed return keeps only the real formal access and its exact evidence', () => {
    const model = buildProxy(`    method Bit#(8) value;
        return upstream.value + 1;
    endmethod`);
    const { bindings, incomingReturns } = proxyContext(model);

    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].resolutionStatus, 'exact');
    assert.equal(bindings[0].sourceEvidence, 'return upstream.value + 1;');
    assert.ok(bindings[0].location);
    assert.equal(incomingReturns.length, 1);
    assert.equal(incomingReturns[0].evidence, 'return upstream.value + 1;');
});

test('unresolved method body does not manufacture a delegation', () => {
    const model = buildProxy(`    method Bit#(8) value;
        // No endmethod: parser can only retain the signature.`);
    const { bindings, incomingReturns } = proxyContext(model);

    assert.deepEqual(bindings, []);
    assert.deepEqual(incomingReturns, []);
});

test('multiple same-name candidates resolve from the formal used by source', () => {
    const model = buildProxy(`    method Bit#(8) value;
        return alternate.value;
    endmethod`, {
        formals: 'SourceIfc upstream, SourceIfc alternate',
        actuals: 'producer, backup',
        declarations: `SourceIfc producer <- mkSource;
    SourceIfc backup <- mkSource;`
    });
    const backup = model.instances.find((instance) => instance.path === 'mkTop.backup');
    const { bindings } = proxyContext(model);

    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].targetInstanceId, backup.id);
    assert.equal(bindings[0].sourceEvidence, 'return alternate.value;');
});

test('inline delegation uses the actual inline expression as evidence', () => {
    const model = buildProxy('    method Bit#(8) value = upstream.value;');
    const { bindings, incomingReturns } = proxyContext(model);

    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].sourceEvidence, 'upstream.value;');
    assert.ok(bindings[0].location);
    assert.equal(incomingReturns.length, 1);
    assert.equal(incomingReturns[0].evidence, 'upstream.value;');
});

test('explicit return delegation binds the formal call to its actual occurrence', () => {
    const model = buildProxy(`    method Bit#(8) value;
        return upstream.value;
    endmethod`);
    const producer = model.instances.find((instance) => instance.path === 'mkTop.producer');
    const { bindings, incomingReturns } = proxyContext(model);

    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].targetInstanceId, producer.id);
    assert.equal(bindings[0].resolutionStatus, 'exact');
    assert.equal(bindings[0].evidence.referencedInstance, 'upstream');
    assert.equal(bindings[0].sourceEvidence, 'return upstream.value;');
    assert.equal(incomingReturns.length, 1);
});
