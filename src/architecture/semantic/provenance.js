'use strict';

function attachSemanticProvenance(model) {
    const definitionById = new Map(model.definitions.map((definition) => [
        definition.id,
        definition
    ]));
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    decorate(model.definitions, (definition) => ({
        confidence: 'exact',
        evidence: definition.signature || {
            kind: definition.kind,
            relativePath: definition.relativePath
        }
    }));
    decorate(model.instances, (instance) => ({
        confidence: instance.targetResolutionStatus === 'unresolved'
            || instance.expansionStatus === 'unresolved'
            ? 'unresolved'
            : 'exact',
        evidence: instance.signature || instance.constructorExpression || {
            path: instance.path,
            targetDefinitionId: instance.targetDefinitionId
        }
    }));
    decorate(model.endpoints, (endpoint) => ({
        confidence: endpoint.contractStatus === 'exact'
            || endpoint.resolutionStatus === 'exact'
            ? 'exact'
            : 'unresolved',
        evidence: endpoint.evidence || {
            interfacePath: endpoint.interfacePath
        }
    }));
    decorate(model.bindings, () => ({
        confidence: 'source-derived',
        evidence: {}
    }));
    decorate(model.protocolChannels, (channel) => {
        const endpoint = Object.values(channel.methods || {})
            .map((id) => endpointById.get(id))
            .find(Boolean);
        return {
            confidence: channel.confidence || 'source-derived',
            evidence: channel.evidence || {},
            location: endpoint?.location || null
        };
    });
    decorate(model.semanticFlows, () => ({
        confidence: 'source-derived',
        evidence: {}
    }));
    decorate(model.stateBehaviors, () => ({
        confidence: 'source-derived',
        evidence: []
    }));
    decorate(model.interfaceContracts, (contract) => ({
        confidence: contract.status === 'exact' ? 'exact' : contract.status,
        evidence: {
            interfaceId: contract.interfaceId,
            moduleId: contract.moduleId,
            methods: contract.methods.map((method) => method.name)
        },
        location: definitionById.get(contract.moduleId)?.location || null
    }));
    return model;
}

function decorate(items, defaults) {
    for (const item of items) {
        const fallback = defaults(item);
        item.analysisOrigin ||= 'Source-derived';
        item.confidence ||= fallback.confidence;
        item.evidence ||= fallback.evidence;
        item.location ||= fallback.location || null;
    }
}

module.exports = {
    attachSemanticProvenance
};
