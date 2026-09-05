'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { buildSemanticSource } = require('./semantic-fixture');
const { createSemanticQueries } = require('../media/semantic-query');

const SOURCE = `
package QueryFixture;
interface ProducerIfc;
    method Bit#(8) value;
endinterface
interface ConsumerIfc;
    method Bool putReady;
    method Action put(Bit#(8) item);
endinterface
module mkProducer(ProducerIfc);
    method Bit#(8) value = 8'h2a;
endmodule
module mkConsumer(ConsumerIfc);
    method Bool putReady = True;
    method Action put(Bit#(8) item);
        noAction;
    endmethod
endmodule
module mkTopA(Empty);
    ProducerIfc producer <- mkProducer;
    ConsumerIfc consumer <- mkConsumer;
    rule bridge;
        Bit#(8) item = producer.value;
        consumer.put(item);
    endrule
endmodule
module mkTopB(Empty);
    ProducerIfc producer <- mkProducer;
    ConsumerIfc consumer <- mkConsumer;
    rule bridge;
        consumer.put(producer.value);
    endrule
endmodule
endpackage
`;

function fixture() {
    const model = buildSemanticSource(SOURCE, 'QueryFixture.bsv', {
        entrypoints: ['mkTopA', 'mkTopB']
    });
    return { model, queries: createSemanticQueries(model) };
}

function occurrence(model, path) {
    return model.instances.find((instance) => instance.path === path);
}

function endpoint(model, ownerInstanceId, name) {
    return model.endpoints.find((candidate) =>
        candidate.ownerInstanceId === ownerInstanceId
        && candidate.kind === 'method-endpoint'
        && candidate.name === name
    );
}

test('semantic query module exposes matching CommonJS and browser UMD APIs', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'media', 'semantic-query.js'), 'utf8');
    const context = { globalThis: {} };
    vm.runInNewContext(source, context);

    assert.equal(typeof createSemanticQueries, 'function');
    assert.equal(typeof context.globalThis.BsvArchitectureSemanticQuery.createSemanticQueries, 'function');
    assert.deepEqual(
        [...context.globalThis.BsvArchitectureSemanticQuery.DEFAULT_TRACE_KINDS],
        ['payload']
    );
});

test('composition, channels, implementations, and behavior slices use canonical occurrence IDs', () => {
    const { model, queries } = fixture();
    const top = occurrence(model, 'mkTopA');
    const producer = occurrence(model, 'mkTopA.producer');
    const producerEndpoint = endpoint(model, producer.id, 'value');
    const consumer = occurrence(model, 'mkTopA.consumer');
    const consumerEndpoint = endpoint(model, consumer.id, 'put');
    const channel = model.protocolChannels.find((candidate) =>
        candidate.ownerInstanceId === consumer.id
    );

    const composition = queries.getInstanceComposition(top.id);
    assert.equal(composition.status, 'exact');
    assert.deepEqual(composition.children.map((item) => item.id).sort(), [
        occurrence(model, 'mkTopA.consumer').id,
        producer.id
    ].sort());
    assert.ok(composition.behaviors.some((behavior) => behavior.name === 'bridge'));
    assert.ok(composition.relationRoles.containment.length >= 2);
    assert.ok(composition.relationRoles.binding.length >= 0);

    const members = queries.getChannelMembers(channel.id);
    assert.equal(members.status, 'exact');
    assert.ok(members.members.some((member) =>
        member.endpoint.id === consumerEndpoint.id && member.role === 'action'
    ));

    const implementation = queries.resolveEndpointImplementation(producerEndpoint.id, {
        ownerInstanceId: producer.id,
        filters: { hiddenIds: [producerEndpoint.id] }
    });
    assert.equal(implementation.status, 'exact');
    assert.equal(implementation.behavior.ownerInstanceId, producer.id);
    assert.equal(implementation.behavior.name, 'value');

    const slice = queries.getBehaviorSlice(implementation.behavior.id, {
        ownerInstanceId: producer.id
    });
    assert.equal(slice.status, 'exact');
    assert.equal(slice.owner.id, producer.id);
    assert.ok(slice.implementationEndpoints.some((item) => item.id === producerEndpoint.id));
    assert.ok(slice.flows.some((flow) => flow.implementationLink));

    assert.equal(queries.getInstanceComposition('missing').status, 'unresolved');
    assert.equal(queries.getChannelMembers('missing').status, 'unresolved');
    assert.equal(queries.resolveEndpointImplementation('missing').status, 'unresolved');
    assert.equal(queries.getBehaviorSlice('missing').status, 'unresolved');

    const serializedQueries = createSemanticQueries(JSON.parse(JSON.stringify(model)));
    assert.equal(serializedQueries.getInstanceComposition(top.id).status, 'exact');
    assert.equal(serializedQueries.resolveEndpointImplementation(producerEndpoint.id).status, 'exact');
});

test('real alias payload exposes exact source transfer provenance and evidence', () => {
    const { model, queries } = fixture();
    const producer = occurrence(model, 'mkTopA.producer');
    const consumer = occurrence(model, 'mkTopA.consumer');
    const from = endpoint(model, producer.id, 'value');
    const to = endpoint(model, consumer.id, 'put');
    const payload = model.semanticFlows.find((flow) =>
        flow.kind === 'payload'
        && flow.fromEndpointId === from.id
        && flow.toEndpointId === to.id
    );

    const result = queries.getFlowEvidence(payload.id);
    assert.equal(result.status, 'exact');
    assert.equal(result.flow.kind, 'payload');
    assert.equal(result.producer.endpointId, from.id);
    assert.equal(result.consumer.endpointId, to.id);
    assert.equal(result.mapping.parameterIndex, 0);
    assert.equal(result.mapping.parameterName, 'item');
    assert.equal(result.mapping.sourceExpression, 'producer.value');
    assert.equal(result.mapping.consumerArgumentExpression, 'item');
    assert.deepEqual(result.mapping.sourceAliases, ['item']);
    assert.equal(result.flow.payloadType, 'Bit#(8)');
    assert.equal(result.flow.payloadTypeStatus, 'exact');
    assert.equal(result.provenance.analysisOrigin, 'Source-derived');
    assert.equal(result.provenance.resolutionStatus, 'exact');
    assert.ok(result.callSiteId);
    assert.ok(result.causeBehaviorId);
    assert.notEqual(result.causeBehaviorId, result.producer.implementationBehaviorId);
    assert.notEqual(result.causeBehaviorId, result.consumer.implementationBehaviorId);
    assert.equal(result.flow.ownerInstanceId, occurrence(model, 'mkTopA').id);
    assert.deepEqual(result.evidenceRefs.map((item) => item.text), [
        'Bit#(8) item = producer.value;',
        'consumer.put(item);'
    ]);
    assert.ok(result.evidenceRefs.every((item) => item.location && item.sourceRange));
    assert.equal(queries.getFlowEvidence('missing').status, 'unresolved');
});

test('formal calls map to actual occurrences without changing source callsite evidence', () => {
    const source = `
package FormalTransfer;
interface ProducerIfc;
    method Bit#(8) value;
endinterface
interface ConsumerIfc;
    method Action put(Bit#(8) item);
endinterface
module mkProducer(ProducerIfc);
    method Bit#(8) value = 1;
endmodule
module mkConsumer(ConsumerIfc);
    method Action put(Bit#(8) item);
        noAction;
    endmethod
endmodule
module mkRelay#(ProducerIfc upstream, ConsumerIfc downstream)(Empty);
    rule bridge;
        let item = upstream.value;
        downstream.put(item);
    endrule
endmodule
module mkTop(Empty);
    ProducerIfc producer <- mkProducer;
    ConsumerIfc consumer <- mkConsumer;
    Empty relay <- mkRelay(producer, consumer);
endmodule
endpackage
`;
    const model = buildSemanticSource(source, 'FormalTransfer.bsv', { entrypoints: ['mkTop'] });
    const queries = createSemanticQueries(model);
    const producer = occurrence(model, 'mkTop.producer');
    const consumer = occurrence(model, 'mkTop.consumer');
    const relay = occurrence(model, 'mkTop.relay');
    const from = endpoint(model, producer.id, 'value');
    const to = endpoint(model, consumer.id, 'put');
    const payload = model.semanticFlows.find((flow) =>
        flow.kind === 'payload'
        && flow.fromEndpointId === from.id
        && flow.toEndpointId === to.id
    );

    const result = queries.getFlowEvidence(payload.id);
    assert.equal(result.status, 'exact');
    assert.equal(result.flow.ownerInstanceId, relay.id);
    assert.equal(result.producer.endpoint.ownerInstanceId, producer.id);
    assert.equal(result.consumer.endpoint.ownerInstanceId, consumer.id);
    assert.deepEqual(result.evidenceRefs.map((item) => item.text), [
        'let item = upstream.value;',
        'downstream.put(item);'
    ]);
    assert.ok(model.bindings.some((binding) =>
        binding.kind === 'constructor-binding'
        && binding.targetInstanceId === relay.id
        && binding.sourceInstanceId === producer.id
        && binding.formalParameter.name === 'upstream'
    ));
});

test('payload tracing is root-safe, filter-independent, and never infers non-transfer relations', () => {
    const { model, queries } = fixture();
    const aProducer = endpoint(model, occurrence(model, 'mkTopA.producer').id, 'value');
    const aConsumer = endpoint(model, occurrence(model, 'mkTopA.consumer').id, 'put');
    const bConsumer = endpoint(model, occurrence(model, 'mkTopB.consumer').id, 'put');

    const rootA = occurrence(model, 'mkTopA');
    const rootB = occurrence(model, 'mkTopB');
    const traced = queries.traceSemanticFlow({
        fromId: aProducer.id,
        toId: aConsumer.id,
        scope: { rootInstanceId: rootA.id }
    }, {
        filters: { kinds: [], hiddenIds: [aProducer.id, aConsumer.id] }
    });
    assert.equal(traced.status, 'exact');
    assert.equal(traced.paths.length, 1);
    assert.deepEqual(traced.paths[0].steps.map((step) => step.kind), ['payload']);
    assert.equal(traced.paths[0].steps[0].mapping.parameterIndex, 0);
    assert.ok(traced.paths[0].steps[0].causeBehaviorId);
    assert.ok(traced.paths[0].steps[0].callSiteId);
    assert.equal(traced.paths[0].uncertainty, null);
    assert.equal(traced.paths[0].truncated, false);
    assert.equal(traced.truncated, false);
    assert.deepEqual(traced.scope, { rootInstanceId: rootA.id });

    const depthLimited = queries.traceSemanticFlow({
        fromId: aProducer.id,
        toId: aConsumer.id,
        maxDepth: 0
    });
    assert.equal(depthLimited.status, 'search-limit');
    assert.equal(depthLimited.truncated, true);
    assert.equal(depthLimited.uncertainty, 'max-depth');

    const excludedByScope = queries.traceSemanticFlow({
        fromId: aProducer.id,
        toId: aConsumer.id,
        scope: { rootInstanceId: rootB.id }
    });
    assert.equal(excludedByScope.status, 'no-path');
    assert.deepEqual(excludedByScope.scope, { rootInstanceId: rootB.id });

    const crossRoot = queries.traceSemanticFlow({
        fromId: aProducer.id,
        toId: bConsumer.id
    });
    assert.equal(crossRoot.status, 'no-path');
    assert.deepEqual(crossRoot.paths, []);

    const bindingOnly = queries.traceSemanticFlow({
        fromId: aProducer.ownerInstanceId,
        toId: occurrence(model, 'mkTopA').id
    });
    assert.equal(bindingOnly.status, 'no-path');
    assert.equal(queries.traceSemanticFlow({ fromId: 'missing', toId: aConsumer.id }).status, 'unresolved');
    assert.equal(queries.traceSemanticFlow({
        fromId: aProducer.id,
        toId: aConsumer.id,
        maxVisited: 0
    }).status, 'search-limit');
});

test('ambiguous source dependencies remain unresolved instead of reporting an exact trace', () => {
    const source = `
package AmbiguousQuery;
interface ProducerIfc;
    method Bit#(8) value;
endinterface
interface ConsumerIfc;
    method Action put(Bit#(8) item);
endinterface
module mkProducer(ProducerIfc);
    method Bit#(8) value = 1;
endmodule
module mkConsumer(ConsumerIfc);
    method Action put(Bit#(8) item);
        noAction;
    endmethod
endmodule
module mkTop(Empty);
    ProducerIfc left <- mkProducer;
    ProducerIfc right <- mkProducer;
    ConsumerIfc consumer <- mkConsumer;
    rule bridge;
        Bit#(8) item = 0;
        if (chooseLeft) item = left.value;
        else item = right.value;
        consumer.put(item);
    endrule
endmodule
endpackage
`;
    const model = buildSemanticSource(source, 'AmbiguousQuery.bsv', { entrypoints: ['mkTop'] });
    const queries = createSemanticQueries(model);
    const left = endpoint(model, occurrence(model, 'mkTop.left').id, 'value');
    const consumer = endpoint(model, occurrence(model, 'mkTop.consumer').id, 'put');

    assert.equal(model.semanticFlows.some((flow) =>
        flow.kind === 'payload' && flow.fromId === left.id && flow.toId === consumer.id
    ), false);
    const result = queries.traceSemanticFlow({ fromId: left.id, toId: consumer.id });
    assert.equal(result.status, 'unresolved');
    assert.equal(result.uncertainty, 'ambiguous-dependency');
    assert.deepEqual(result.paths, []);
});

test('type-unresolved source transfer returns an uncertain path, never exact', () => {
    const source = `
package UnresolvedTypeQuery;
interface ProducerIfc#(numeric type n);
    method Bit#(n) value;
endinterface
interface ConsumerIfc#(numeric type m);
    method Action put(Bit#(m) item);
endinterface
module mkProducer#(numeric type n)(ProducerIfc#(n));
    method Bit#(n) value = 0;
endmodule
module mkConsumer#(numeric type m)(ConsumerIfc#(m));
    method Action put(Bit#(m) item);
        noAction;
    endmethod
endmodule
module mkTop(Empty);
    ProducerIfc#(8) producer <- mkProducer#(8);
    ConsumerIfc#(8) consumer <- mkConsumer#(8);
    rule bridge;
        consumer.put(producer.value);
    endrule
endmodule
endpackage
`;
    const model = buildSemanticSource(source, 'UnresolvedTypeQuery.bsv', { entrypoints: ['mkTop'] });
    const queries = createSemanticQueries(model);
    const producer = endpoint(model, occurrence(model, 'mkTop.producer').id, 'value');
    const consumer = endpoint(model, occurrence(model, 'mkTop.consumer').id, 'put');
    const payload = model.semanticFlows.find((flow) =>
        flow.kind === 'payload' && flow.fromId === producer.id && flow.toId === consumer.id
    );

    assert.equal(payload.payloadTypeStatus, 'unresolved');
    const result = queries.traceSemanticFlow({ fromId: producer.id, toId: consumer.id });
    assert.equal(result.status, 'unresolved');
    assert.equal(result.uncertainty, 'unresolved-dependency');
    assert.equal(result.paths.length, 1);
    assert.equal(result.paths[0].steps[0].uncertainty, 'unresolved');
});

test('source reference resolution is exact by ID, contextual by occurrence, and never first-match', () => {
    const { model, queries } = fixture();
    const producerA = occurrence(model, 'mkTopA.producer');
    const valueA = model.stateBehaviors.find((behavior) =>
        behavior.ownerInstanceId === producerA.id && behavior.name === 'value'
    );

    const byId = queries.resolveSourceReference(valueA.id, { ownerInstanceId: producerA.id });
    assert.equal(byId.status, 'exact');
    assert.equal(byId.references[0].id, valueA.id);
    assert.equal(byId.references[0].ownerInstanceId, producerA.id);

    const ambiguous = queries.resolveSourceReference({
        uri: valueA.location.uri,
        line: valueA.location.line,
        column: valueA.location.column
    });
    assert.equal(ambiguous.status, 'multiple');
    assert.ok(ambiguous.references.length >= 2);

    const contextual = queries.resolveSourceReference({
        uri: valueA.location.uri,
        line: valueA.location.line,
        column: valueA.location.column
    }, { ownerInstanceId: producerA.id });
    assert.equal(contextual.status, 'exact');
    assert.equal(contextual.references[0].id, valueA.id);

    assert.equal(queries.resolveSourceReference({ uri: 'file:///missing.bsv', line: 0, column: 0 }).status,
        'unresolved');
    assert.deepEqual(queries.getExpressionDependencies('expression:pending', { ownerInstanceId: producerA.id }), {
        status: 'unsupported',
        reason: 'expression-ir-pending-gate-c',
        expressionId: 'expression:pending'
    });
});
