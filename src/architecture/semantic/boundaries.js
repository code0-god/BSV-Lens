'use strict';

const ROOT_BOUNDARY_ORIGIN = 'Source-derived root boundary';

function buildSemanticBoundaries(roots, instances, endpoints, channels) {
    const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
    const endpointById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const endpointsByOwner = groupBy(endpoints, (endpoint) => endpoint.ownerInstanceId);
    const channelsByOwner = groupBy(channels, (channel) => channel.ownerInstanceId);

    return roots.map((root) => {
        const instance = instanceById.get(root.instanceId);
        const ownedEndpoints = endpointsByOwner.get(root.instanceId) || [];
        const exposures = (channelsByOwner.get(root.instanceId) || []).map((channel) =>
            channelExposure(channel, ownedEndpoints, endpointById));
        const matchedEndpointIds = new Set(exposures.flatMap((exposure) =>
            exposure.legs.map((leg) => leg.endpointId)));
        const unmatchedEndpoints = ownedEndpoints
            .filter((endpoint) => endpoint.kind === 'method-endpoint'
                && !matchedEndpointIds.has(endpoint.id))
            .map(endpointExposure);
        return {
            id: `semantic-boundary:${root.instanceId}`,
            kind: 'root-boundary',
            rootInstanceId: root.instanceId,
            rootReason: root.reason,
            rootStatus: 'unbound',
            bindingStatus: 'unbound',
            parentInstanceId: null,
            path: root.path,
            targetDefinitionId: root.targetDefinitionId,
            channels: exposures,
            unmatchedEndpoints,
            analysisOrigin: ROOT_BOUNDARY_ORIGIN,
            confidence: 'exact',
            evidence: {
                selectionReason: root.reason,
                rootInstanceId: root.instanceId,
                publicChannelIds: exposures.map((exposure) => exposure.channelId),
                unmatchedEndpointIds: unmatchedEndpoints.map((endpoint) => endpoint.endpointId)
            },
            location: instance?.location || null,
            sourceRange: null
        };
    });
}

function channelExposure(channel, ownedEndpoints, endpointById) {
    const legs = [];
    for (const [role, endpointId] of Object.entries(channel.methods || {})) {
        const endpoint = endpointById.get(endpointId);
        if (!endpoint) continue;
        if (endpoint.kind === 'method-endpoint') {
            legs.push(...methodLegs(endpoint, role));
            continue;
        }
        if (endpoint.kind !== 'subinterface-endpoint') continue;
        const prefix = endpoint.interfacePath;
        for (const nested of ownedEndpoints) {
            if (nested.kind !== 'method-endpoint'
                || !startsWithPath(nested.interfacePath, prefix)) continue;
            const suffix = nested.interfacePath.slice(prefix.length).join('.');
            legs.push(...methodLegs(nested, suffix ? `${role}.${suffix}` : role));
        }
    }
    return {
        channelId: channel.id,
        name: channel.name,
        direction: channel.direction,
        payloadType: channel.payloadType,
        bindingStatus: 'unbound',
        legs,
        location: channel.location || firstLocation(legs),
        analysisOrigin: channel.analysisOrigin || 'Source-derived',
        confidence: channel.confidence || 'source-derived',
        evidence: channel.evidence || {}
    };
}

function endpointExposure(endpoint) {
    return {
        endpointId: endpoint.id,
        name: endpoint.name,
        interfacePath: [...endpoint.interfacePath],
        category: endpoint.category,
        direction: endpoint.direction,
        parameters: endpoint.parameters.map((parameter) => ({ ...parameter })),
        resultType: endpoint.resultType,
        returnType: endpoint.returnType,
        contractStatus: endpoint.contractStatus,
        bindingStatus: 'unbound',
        legs: methodLegs(endpoint, 'unmatched'),
        location: endpoint.location || null,
        evidence: endpoint.evidence || {}
    };
}

function methodLegs(endpoint, role) {
    const legs = endpoint.parameters.map((parameter, index) => ({
        role,
        endpointId: endpoint.id,
        methodPath: endpoint.interfacePath.join('.'),
        transfer: 'parameter',
        parameterIndex: index,
        parameterName: parameter.name,
        direction: 'inbound',
        payloadType: parameter.type,
        category: endpoint.category,
        contractStatus: endpoint.contractStatus,
        location: endpoint.location || null,
        evidence: endpoint.evidence || {}
    }));
    if (endpoint.resultType) legs.push({
        role,
        endpointId: endpoint.id,
        methodPath: endpoint.interfacePath.join('.'),
        transfer: 'result',
        parameterIndex: null,
        parameterName: null,
        direction: 'outbound',
        payloadType: endpoint.resultType,
        category: endpoint.category,
        contractStatus: endpoint.contractStatus,
        location: endpoint.location || null,
        evidence: endpoint.evidence || {}
    });
    if (legs.length === 0 && endpoint.category === 'action') legs.push({
        role,
        endpointId: endpoint.id,
        methodPath: endpoint.interfacePath.join('.'),
        transfer: 'control',
        parameterIndex: null,
        parameterName: null,
        direction: 'inbound',
        payloadType: null,
        category: endpoint.category,
        contractStatus: endpoint.contractStatus,
        location: endpoint.location || null,
        evidence: endpoint.evidence || {}
    });
    return legs;
}

function startsWithPath(path, prefix) {
    return path.length > prefix.length && prefix.every((part, index) => path[index] === part);
}
function firstLocation(legs) { return legs.find((leg) => leg.location)?.location || null; }
function groupBy(items, key) {
    const result = new Map();
    for (const item of items) result.set(key(item), [...(result.get(key(item)) || []), item]);
    return result;
}

module.exports = { buildSemanticBoundaries };
