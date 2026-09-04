'use strict';

const { behaviorDefinitionId, stateBehaviorId } = require('./ids');

const SOURCE_ORIGIN = 'Source-derived';

function buildStateBehaviors(definitions, instances) {
    const definitionById = new Map(definitions.map((item) => [item.id, item]));
    const childrenByParent = groupBy(instances.filter((item) => item.parentInstanceId),
        (item) => item.parentInstanceId);
    const stateBehaviors = [];
    const callableByBehaviorId = new Map();
    const diagnostics = [];

    for (const instance of instances) {
        const definition = definitionById.get(instance.targetDefinitionId);
        if (definition?.kind !== 'module-definition') continue;
        const stateNames = new Set((childrenByParent.get(instance.id) || [])
            .filter((child) => child.primitiveKind).map((child) => child.name));
        const duplicateCount = new Map();
        for (const [kind, callables] of [['rule', definition.rules], ['method', definition.methods]]) {
            for (const callable of callables || []) {
                const callablePath = [...(callable.interfacePath || []), callable.name];
                const duplicateKey = `${kind}\u0000${callablePath.join('.')}`;
                const duplicateOrdinal = duplicateCount.get(duplicateKey) || 0;
                duplicateCount.set(duplicateKey, duplicateOrdinal + 1);
                const behavior = makeBehavior(
                    instance,
                    definition,
                    callable,
                    kind,
                    stateNames,
                    duplicateOrdinal,
                    callablePath
                );
                stateBehaviors.push(behavior);
                callableByBehaviorId.set(behavior.id, callable);
                if (duplicateOrdinal > 0) diagnostics.push({
                    code: 'definition.duplicate',
                    severity: 'warning',
                    message: `Duplicate ${kind} ${callable.name} has semantic ordinal ${duplicateOrdinal}.`,
                    location: callable.location || definition.location || null,
                    analysisOrigin: SOURCE_ORIGIN
                });
            }
        }
    }
    return { stateBehaviors, callableByBehaviorId, diagnostics };
}

function makeBehavior(
    instance,
    definition,
    callable,
    kind,
    stateNames,
    duplicateOrdinal,
    callablePath
) {
    const accesses = callable.accesses || [];
    const implicitReads = [...stateNames].filter((name) =>
        containsName(callable.guard, name) || containsName(callable.signature, name));
    const reads = unique([...(callable.reads || []), ...implicitReads]);
    const writes = unique(callable.writes || []);
    const transitions = accesses.filter((access) => access.stateEffect).map((access) => ({
        state: access.instance,
        effect: access.stateEffect,
        operation: access.operation,
        evidence: access.sourceEvidence,
        location: access.location || null
    }));
    const evidence = unique([
        callable.signature,
        ...accesses.map((access) => access.sourceEvidence)
    ].filter(Boolean));
    return {
        id: stateBehaviorId(
            instance.id,
            kind,
            callablePath.join('.'),
            duplicateOrdinal
        ),
        name: callable.name,
        interfacePath: callable.interfacePath || [],
        kind,
        ownerInstanceId: instance.id,
        definitionId: behaviorDefinitionId(
            definition.id,
            kind,
            callablePath.join('.'),
            duplicateOrdinal
        ),
        category: callable.category || 'unknown',
        returnType: callable.returnType || null,
        guard: callable.guard || '',
        reads,
        writes,
        inputs: (callable.parameters || []).map((parameter) => ({
            name: parameter.name,
            type: parameter.type
        })),
        outputs: callable.category === 'action' || !callable.returnType
            ? []
            : [{ type: callable.returnType }],
        invocations: [...(callable.invocations || [])],
        transitions,
        summary: summarizeTransitions(transitions, callable, kind),
        protocolMembership: [],
        evidence,
        origin: SOURCE_ORIGIN,
        analysisOrigin: SOURCE_ORIGIN,
        confidence: 'explicit',
        location: callable.location || instance.location || null
    };
}

function attachProtocolMembership(stateBehaviors, endpoints, channels) {
    const endpointByOwnerName = new Map(endpoints
        .filter((endpoint) => endpoint.kind === 'method-endpoint')
        .map((endpoint) => [`${endpoint.ownerInstanceId}\u0000${endpoint.name}`, endpoint]));
    const channelByEndpoint = new Map();
    for (const channel of channels) {
        for (const endpointId of Object.values(channel.methods || {})) {
            channelByEndpoint.set(endpointId, channel);
        }
    }
    for (const behavior of stateBehaviors) {
        const endpoint = endpointByOwnerName.get(
            `${behavior.ownerInstanceId}\u0000${behavior.name}`
        );
        const channel = endpoint && channelByEndpoint.get(endpoint.id);
        behavior.protocolMembership = channel ? [{
            id: channel.id,
            name: channel.name,
            direction: channel.direction,
            payloadType: channel.payloadType
        }] : [];
    }
}

function summarizeTransitions(transitions, callable, kind) {
    const updates = unique(transitions
        .filter((transition) => ['update', 'write'].includes(transition.effect))
        .map((transition) => transition.state));
    const enqueues = unique(transitions
        .filter((transition) => transition.effect === 'enqueue')
        .map((transition) => transition.state));
    const dequeues = unique(transitions
        .filter((transition) => transition.effect === 'dequeue')
        .map((transition) => transition.state));
    const parts = [];
    if (updates.length) parts.push(`Updates ${updates.join(', ')}`);
    if (enqueues.length) parts.push(`enqueues ${enqueues.join(', ')}`);
    if (dequeues.length) parts.push(`dequeues ${dequeues.join(', ')}`);
    if (parts.length) return `${parts.join(' and ')}.`;
    if ((callable.invocations || []).length) {
        return `Invokes ${(callable.invocations || []).join(', ')}.`;
    }
    return `${kind === 'rule' ? 'Rule' : 'Method'} ${callable.name}.`;
}

function containsName(text, name) {
    return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(String(text || ''));
}
function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function unique(values) { return [...new Set(values)]; }
function groupBy(items, key) {
    const result = new Map();
    for (const item of items) result.set(key(item), [...(result.get(key(item)) || []), item]);
    return result;
}

module.exports = {
    attachProtocolMembership,
    buildStateBehaviors
};
