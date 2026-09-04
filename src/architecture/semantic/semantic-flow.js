'use strict';

const { compareContractTypes } = require('../interface-contract-types');
const { semanticFlowId } = require('./ids');

const SOURCE_ORIGIN = 'Source-derived';

function buildSemanticFlows(options) {
    const {
        behaviors, accessBindings, bindings, endpoints, channels, limits = {}, seedFlows = []
    } = options;
    const flows = [...seedFlows];
    const diagnostics = [];
    const endpointById = new Map(endpoints.map((item) => [item.id, item]));
    const behaviorByDefinitionOwner = new Map(behaviors.map((item) => [
        `${item.ownerInstanceId}\u0000${item.definitionId}`, item
    ]));
    const channelByEndpoint = channelIndex(channels);

    for (const access of accessBindings) {
        const endpoint = endpointById.get(access.endpointId);
        if (endpoint) {
            if (endpoint.category === 'action' || endpoint.category === 'action-value') {
                add(flows, flow('invoke', access.behaviorId, endpoint.id, access, channelByEndpoint,
                    { fromBehaviorId: access.behaviorId, toEndpointId: endpoint.id }));
            }
            if (endpoint.category === 'value' || endpoint.category === 'action-value') {
                add(flows, flow('return', endpoint.id, access.behaviorId, access, channelByEndpoint,
                    { fromEndpointId: endpoint.id, toBehaviorId: access.behaviorId }));
            }
        } else if (access.resolutionStatus === 'exact') {
            const kind = access.accessKind === 'write' ? 'state-write' : 'state-read';
            const from = kind === 'state-write' ? access.behaviorId : access.targetInstanceId;
            const to = kind === 'state-write' ? access.targetInstanceId : access.behaviorId;
            add(flows, flow(kind, from, to, access, channelByEndpoint, {
                behaviorId: access.behaviorId, stateInstanceId: access.targetInstanceId
            }));
        }
    }
    for (const endpoint of endpoints) {
        if (!endpoint.implementationMethodId) continue;
        const implementation = behaviorByDefinitionOwner.get(
            `${endpoint.ownerInstanceId}\u0000${endpoint.implementationMethodId}`);
        if (!implementation) continue;
        if (endpoint.category === 'action' || endpoint.category === 'action-value') {
            add(flows, flow('invoke', endpoint.id, implementation.id, endpoint, channelByEndpoint, {
                fromEndpointId: endpoint.id, toBehaviorId: implementation.id, implementationLink: true
            }));
        }
        if (endpoint.category === 'value' || endpoint.category === 'action-value') {
            add(flows, flow('return', implementation.id, endpoint.id, endpoint, channelByEndpoint, {
                fromBehaviorId: implementation.id, toEndpointId: endpoint.id, implementationLink: true
            }));
        }
    }
    projectStructuralBindings(bindings, flows, channelByEndpoint);
    projectPayloads(accessBindings, behaviors, endpointById, channelByEndpoint, flows, diagnostics);

    const maxEdges = positive(limits.maxEdges, 25000);
    if (flows.length > maxEdges) diagnostics.push({
        code: 'semantic-flow.truncated', severity: 'warning',
        message: `Semantic flow projection retained ${maxEdges} of ${flows.length} edges.`,
        location: flows[maxEdges]?.location || null, analysisOrigin: SOURCE_ORIGIN
    });
    return { flows: flows.slice(0, maxEdges), diagnostics };
}

function projectStructuralBindings(bindings, flows, channels) {
    for (const binding of bindings) {
        if (binding.kind === 'constructor-binding' && binding.resolutionStatus === 'exact') {
            add(flows, flow('constructor-binding', binding.sourceInstanceId, binding.targetInstanceId,
                binding, channels, { bindingId: binding.id }));
        }
        if (binding.kind === 'interface-forward' && binding.resolutionStatus === 'exact') {
            add(flows, flow('interface-forward', binding.outerEndpointId, binding.innerEndpointId,
                binding, channels, { bindingId: binding.id, fromEndpointId: binding.outerEndpointId,
                    toEndpointId: binding.innerEndpointId }));
        }
    }
}

function projectPayloads(accesses, behaviors, endpointById, channels, flows, diagnostics) {
    const byBehavior = groupBy(accesses.filter((item) => item.endpointId), (item) => item.behaviorId);
    const behaviorById = new Map(behaviors.map((item) => [item.id, item]));
    const ownerEndpoint = new Map();
    for (const endpoint of endpointById.values()) if (endpoint.implementationMethodId) {
        ownerEndpoint.set(`${endpoint.ownerInstanceId}\u0000${endpoint.implementationMethodId}`, endpoint);
    }
    for (const [behaviorId, owned] of byBehavior) {
        const producers = owned
            .filter((item) => Boolean(endpointById.get(item.endpointId)?.resultType))
            .map((item) => ({ ...item, endpoint: endpointById.get(item.endpointId) }));
        const aliases = producerAliases(producers);
        for (const consumer of owned) {
            const target = endpointById.get(consumer.endpointId);
            if (target?.direction !== 'input') continue;
            for (let index = 0; index < consumer.arguments.length; index += 1) {
                const candidates = producersForExpression(consumer.arguments[index], producers, aliases);
                if (candidates.length > 1) {
                    diagnostics.push(unresolvedDiagnostic(consumer, consumer.arguments[index], candidates));
                    continue;
                }
                if (candidates.length === 1) addPayload(candidates[0], consumer, target, index, flows, channels);
            }
        }
        const behavior = behaviorById.get(behaviorId);
        const returned = behavior && ownerEndpoint.get(`${behavior.ownerInstanceId}\u0000${behavior.definitionId}`);
        if (returned) for (const producer of producers.filter(isReturnExpression)) {
            addReturn(producer, returned, flows, channels);
        }
    }
}

function producerAliases(producers) {
    const result = new Map();
    for (const producer of producers) {
        const aliases = [producer.valueBinding, producer.resultBinding, bareAssignmentAlias(producer)];
        for (const alias of aliases.filter(Boolean)) {
            result.set(alias, [...(result.get(alias) || []), producer]);
        }
    }
    return result;
}
function producersForExpression(expression, producers, aliases) {
    const compact = String(expression || '').replace(/\s+/g, '');
    const direct = producers.filter((item) => compact === `${item.evidence?.referencedInstance}.${item.memberPath}`);
    if (direct.length) return uniqueById(direct);
    return /^[A-Za-z_$][\w$]*$/.test(compact) ? uniqueById(aliases.get(compact) || []) : [];
}
function bareAssignmentAlias(access) {
    const instance = escapeRegExp(access.evidence?.referencedInstance || '');
    const member = escapeRegExp(access.memberPath || '');
    if (!instance || !member) return null;
    const match = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*=\\s*${instance}\\s*\\.\\s*${member}\\b`)
        .exec(access.sourceEvidence || '');
    return match?.[1] || null;
}

function addPayload(producer, consumer, target, index, flows, channels, suffix = '') {
    const source = producer.endpoint;
    const parameter = target.parameters?.[index];
    if (!source || !parameter) return;
    const comparison = compareContractTypes(parameter.type, source.resultType || source.returnType);
    const evidence = `${producer.sourceEvidence} -> ${consumer.sourceEvidence}`;
    add(flows, flow('payload', source.id, target.id, consumer, channels, {
        fromEndpointId: source.id, toEndpointId: target.id, parameterIndex: index,
        parameterName: parameter.name, payloadType: source.resultType || source.returnType,
        payloadTypeStatus: comparison.status, confidence: comparison.status, evidence,
        comparison, alias: suffix || consumer.arguments[index]
    }));
}
function addReturn(producer, target, flows, channels) {
    const source = producer.endpoint;
    const comparison = compareContractTypes(target.resultType || target.returnType,
        source.resultType || source.returnType);
    add(flows, flow('return', source.id, target.id, producer, channels, {
        fromEndpointId: source.id, toEndpointId: target.id,
        payloadType: source.resultType || source.returnType,
        payloadTypeStatus: comparison.status, confidence: comparison.status,
        comparison, evidence: producer.sourceEvidence
    }));
}
function unresolvedDiagnostic(consumer, alias, candidates) {
    return { code: 'semantic-flow.unresolved', severity: 'info',
        message: `Payload alias ${alias} has multiple endpoint producers.`,
        behaviorId: consumer.behaviorId, evidence: { producerEndpointIds: candidates.map((item) => item.endpointId) },
        location: consumer.location || null, analysisOrigin: SOURCE_ORIGIN };
}
function isReturnExpression(item) { return /^\s*return\b/.test(item.sourceEvidence || ''); }

function flow(kind, fromId, toId, evidence, channels, extra = {}) {
    const result = { id: semanticFlowId(kind, fromId, toId, extra.alias || evidence.id), kind,
        fromId, toId, evidence: evidence.sourceEvidence || evidence.evidence?.declaration || '',
        location: evidence.location || null, analysisOrigin: SOURCE_ORIGIN, confidence: 'explicit', ...extra };
    const fromChannelId = channels.get(fromId);
    const toChannelId = channels.get(toId);
    if (fromChannelId) result.fromChannelId = fromChannelId;
    if (toChannelId) result.toChannelId = toChannelId;
    return result;
}
function channelIndex(channels) {
    const result = new Map();
    for (const channel of channels) for (const endpointId of Object.values(channel.methods || {})) {
        if (!result.has(endpointId)) result.set(endpointId, channel.id);
    }
    return result;
}
function add(flows, candidate) { if (!flows.some((item) => item.id === candidate.id)) flows.push(candidate); }
function uniqueById(items) { return [...new Map(items.map((item) => [item.id, item])).values()]; }
function groupBy(items, key) { const result = new Map(); for (const item of items) result.set(key(item), [...(result.get(key(item)) || []), item]); return result; }
function positive(value, fallback) { return Number.isInteger(value) && value >= 0 ? value : fallback; }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = { buildSemanticFlows };
