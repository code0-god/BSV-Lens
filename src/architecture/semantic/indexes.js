'use strict';

function buildSemanticIndexes(model) {
    const definitions = model.definitions || [];
    const instances = model.instances || [];
    const endpoints = model.endpoints || [];
    const bindings = model.bindings || [];
    const channels = model.protocolChannels || [];
    const flows = model.semanticFlows || [];
    const stateBehaviors = model.stateBehaviors || [];
    const scheduleRelations = model.scheduleRelations || [];
    const diagnostics = model.diagnostics || [];
    return {
        definitionById: mapById(definitions),
        definitionsByName: grouped(definitions, (item) => item.name),
        childrenByDefinition: grouped(definitions, (item) => item.ownerDefinitionId),
        instanceById: mapById(instances),
        childrenByInstance: grouped(instances, (item) => item.parentInstanceId),
        instancesByDefinition: grouped(instances, (item) => item.targetDefinitionId),
        endpointById: mapById(endpoints),
        endpointsByInstance: grouped(endpoints, (item) => item.ownerInstanceId),
        bindingById: mapById(bindings),
        bindingsByInstance: grouped(bindings, (item) => item.ownerInstanceId || item.targetInstanceId),
        bindingsByBehavior: grouped(bindings, (item) => item.behaviorId),
        channelById: mapById(channels),
        channelsByInstance: grouped(channels, (item) => item.ownerInstanceId),
        flowById: mapById(flows),
        flowsByNode: grouped(
            flows.flatMap((flow) => [...new Set([flow.fromId, flow.toId].filter(Boolean))]
                .map((nodeId) => ({ id: flow.id, nodeId, flow }))),
            (entry) => entry.nodeId
        ),
        flowsByEndpoint: grouped(
            flows.flatMap((flow) => endpointFlowEntries(flow)),
            (entry) => entry.endpointId
        ),
        stateBehaviorById: mapById(stateBehaviors),
        stateBehaviorsByInstance: grouped(stateBehaviors, (item) => item.ownerInstanceId),
        implementationEndpointsByBehavior: grouped(
            endpoints.filter((item) => item.implementationMethodId).map((endpoint) => ({
                id: endpoint.id,
                behaviorKey: `${endpoint.ownerInstanceId}\u0000${endpoint.implementationMethodId}`,
                endpoint
            })),
            (entry) => entry.behaviorKey
        ),
        scheduleByBehavior: grouped(
            scheduleRelations.flatMap((relation) => [
                { id: relation.id, behaviorId: relation.sourceBehaviorId, relation },
                { id: relation.id, behaviorId: relation.targetBehaviorId, relation }
            ]),
            (entry) => entry.behaviorId
        ),
        diagnosticById: mapById(diagnostics.filter((item) => item.id))
    };
}

function endpointFlowEntries(flow) {
    return [...new Set([
        flow.fromEndpointId,
        flow.toEndpointId
    ].filter(Boolean))].map((endpointId) => ({ id: flow.id, endpointId, flow }));
}

function mapById(items) {
    return new Map(items.map((item) => [item.id, item]));
}

function grouped(items, key) {
    const result = new Map();
    for (const item of items) {
        const value = key(item);
        if (value === null || value === undefined) continue;
        if (!result.has(value)) result.set(value, []);
        result.get(value).push(item.flow || item.relation || item.endpoint || item);
    }
    for (const values of result.values()) {
        values.sort((left, right) => String(left.id).localeCompare(String(right.id)));
    }
    return result;
}

module.exports = {
    buildSemanticIndexes
};
