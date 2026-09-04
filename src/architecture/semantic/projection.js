'use strict';

const DATA_FLOW_KINDS = new Set([
    'payload', 'invoke', 'return', 'state-read', 'state-write',
    'constructor-binding', 'interface-forward'
]);

function projectSemanticModel(model) {
    const definitions = new Map(model.definitions.map((item) => [item.id, item]));
    const instances = new Map(model.instances.map((item) => [item.id, item]));
    const endpoints = new Map(model.endpoints.map((item) => [item.id, item]));
    const channels = new Map(model.protocolChannels.map((item) => [item.id, item]));
    const channelByEndpoint = new Map();
    for (const channel of channels.values()) {
        for (const endpointId of Object.values(channel.methods || {}))
            if (!channelByEndpoint.has(endpointId)) channelByEndpoint.set(endpointId, channel.id);
    }

    const neededEndpoints = new Set();
    for (const flow of model.semanticFlows) {
        if (flow.implementationLink) continue;
        if (endpoints.has(flow.fromId)) neededEndpoints.add(flow.fromId);
        if (endpoints.has(flow.toId)) neededEndpoints.add(flow.toId);
    }
    for (const binding of model.bindings) {
        if (binding.kind !== 'interface-forward' || binding.resolutionStatus !== 'exact') continue;
        neededEndpoints.add(binding.outerEndpointId);
        neededEndpoints.add(binding.innerEndpointId);
    }

    const nodes = [];
    for (const instance of instances.values()) nodes.push(instanceNode(instance, definitions));
    for (const behavior of model.stateBehaviors) nodes.push(behaviorNode(behavior, instances, definitions));
    for (const channel of channels.values()) nodes.push(channelNode(channel, instances));
    for (const id of neededEndpoints) {
        const endpoint = endpoints.get(id);
        if (endpoint) nodes.push(endpointNode(endpoint, instances, channelByEndpoint));
    }
    for (const instance of instances.values()) {
        if (instance.primitiveKind) continue;
        const definition = definitions.get(instance.targetDefinitionId);
        if (!definition) continue;
        for (const member of model.indexes.childrenByDefinition.get(definition.id) || []) {
            if (member.kind === 'function-definition')
                nodes.push(definitionMemberNode(instance, member, 'function'));
            else if (member.kind === 'type-definition')
                nodes.push(definitionMemberNode(instance, member, member.definitionKind || 'type'));
        }
    }

    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = [];
    for (const instance of instances.values()) {
        if (!instance.parentInstanceId) continue;
        addEdge(edges, instance.parentInstanceId, instance.id,
            instance.primitiveKind ? 'contains' : 'instance-child', instance.name, instance.location);
    }
    for (const node of nodes) {
        if (!node.parentId || instances.has(node.id)) continue;
        addEdge(edges, node.parentId, node.id, 'contains', node.name, node.location);
    }
    for (const flow of model.semanticFlows) {
        if (!flow.implementationLink && nodeIds.has(flow.fromId) && nodeIds.has(flow.toId)) {
            addFlowEdge(edges, flow.fromId, flow.toId, flow, flow.kind);
        }
        if (flow.kind !== 'payload') continue;
        const sourceOwner = endpointOwner(flow.fromEndpointId || flow.fromId, endpoints);
        const targetOwner = endpointOwner(flow.toEndpointId || flow.toId, endpoints);
        if (sourceOwner && targetOwner && sourceOwner !== targetOwner
            && nodeIds.has(sourceOwner) && nodeIds.has(targetOwner)) {
            addFlowEdge(edges, sourceOwner, targetOwner, flow, 'payload', 'aggregate');
        }
    }
    for (const binding of model.bindings) {
        if (binding.kind !== 'interface-forward' || binding.resolutionStatus !== 'exact') continue;
        const source = channelByEndpoint.get(binding.outerEndpointId)
            || endpoints.get(binding.outerEndpointId)?.ownerInstanceId;
        const innerEndpoint = endpoints.get(binding.innerEndpointId);
        const target = innerEndpoint?.ownerInstanceId === binding.ownerInstanceId
            ? channelByEndpoint.get(binding.innerEndpointId) || innerEndpoint.ownerInstanceId
            : innerEndpoint?.ownerInstanceId;
        if (nodeIds.has(source) && nodeIds.has(target)) {
            addEdge(
                edges,
                source,
                target,
                'interface-forward',
                binding.outerPath.join('.'),
                binding.location,
                {
                evidence: `${binding.outerPath.join('.')} forwards to ${
                    binding.innerPath.join('.')
                }`, analysisOrigin: binding.analysisOrigin,
                confidence: binding.confidence || 'explicit', semanticId: binding.id,
                bidirectional: true
                }
            );
        }
    }
    for (const relation of model.scheduleRelations || []) {
        if (!nodeIds.has(relation.sourceBehaviorId) || !nodeIds.has(relation.targetBehaviorId)) continue;
        addEdge(
            edges,
            relation.sourceBehaviorId,
            relation.targetBehaviorId,
            relation.kind,
            relation.kind.replace(/-/g, ' '),
            relation.location,
            {
                mode: 'scheduling', origin: relation.origin,
                analysisOrigin: relation.analysisOrigin, confidence: relation.confidence,
                evidence: relation.evidence, semanticId: relation.id,
                bidirectional: relation.bidirectional === true
            }
        );
    }

    return {
        nodes,
        edges: edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
        architectureRoots: model.roots.map((root) => root.instanceId).filter((id) => nodeIds.has(id)),
        interfaceContracts: model.interfaceContracts.map((contract) => ({
            ...contract,
            semanticInterfaceId: contract.interfaceId,
            semanticModuleId: contract.moduleId,
            interfaceId: legacyDefinitionId(definitions.get(contract.interfaceId)),
            moduleId: legacyDefinitionId(definitions.get(contract.moduleId))
        }))
    };
}

function instanceNode(instance, definitions) {
    const definition = definitions.get(instance.targetDefinitionId);
    const primitive = Boolean(instance.primitiveKind);
    const source = {
        ...instance,
        packageName: instance.packageName || definition?.packageName,
        relativePath: instance.relativePath || definition?.relativePath,
        signature: instance.signature || definition?.signature
    };
    return baseNode(source, {
        kind: primitive ? instance.primitiveKind : 'instance',
        parentId: instance.parentInstanceId,
        architectureInstance: !primitive,
        primitive,
        memberGroup: primitive ? 'state' : (instance.parentInstanceId ? 'child-instances' : null),
        details: {
            targetDefinitionId: instance.targetDefinitionId,
            targetId: legacyDefinitionId(definition),
            targetName: definition?.name || instance.constructor || null,
            path: instance.path,
            root: instance.root === true,
            resolution: instance.targetResolutionStatus || (definition ? 'exact' : 'unresolved'),
            specialization: instance.specialization || null,
            multiplicity: instance.multiplicity || null,
            declaredType: instance.declaredType || instance.type || null,
            type: instance.type || null,
            constructor: instance.constructor || null,
            expansionStatus: instance.expansionStatus
        }
    });
}

function behaviorNode(behavior, instances, definitions) {
    const owner = instances.get(behavior.ownerInstanceId);
    const definition = definitions.get(owner?.targetDefinitionId);
    return baseNode({ ...behavior, relativePath: definition?.relativePath }, {
        semanticBehavior: true,
        description: behavior.summary,
        parentId: behavior.ownerInstanceId,
        memberGroup: behavior.kind === 'rule' ? 'rules' : 'methods',
        reads: behavior.reads, writes: behavior.writes, invocations: behavior.invocations,
        details: {
            definitionId: behavior.definitionId,
            summary: behavior.summary,
            category: behavior.category,
            returnType: behavior.returnType,
            guard: behavior.guard,
            inputs: behavior.inputs,
            outputs: behavior.outputs,
            stateReads: behavior.reads,
            stateWrites: behavior.writes,
            invocations: behavior.invocations,
            protocolMembership: behavior.protocolMembership,
            sourceEvidence: behavior.evidence,
            transitions: behavior.transitions
        }
    });
}

function channelNode(channel, instances) {
    const owner = instances.get(channel.ownerInstanceId);
    return baseNode({ ...channel, location: owner?.location, relativePath: owner?.relativePath }, {
        parentId: channel.ownerInstanceId,
        memberGroup: 'protocol-channels',
        details: { direction: channel.direction, payloadType: channel.payloadType, methods: channel.methods }
    });
}

function endpointNode(endpoint, instances, channelByEndpoint) {
    const owner = instances.get(endpoint.ownerInstanceId);
    return baseNode({ ...endpoint, relativePath: owner?.relativePath }, {
        kind: 'endpoint', parentId: endpoint.ownerInstanceId, memberGroup: null,
        details: {
            endpointKind: endpoint.kind, interfacePath: endpoint.interfacePath,
            direction: endpoint.direction, category: endpoint.category,
            parameters: endpoint.parameters, resultType: endpoint.resultType,
            channelId: channelByEndpoint.get(endpoint.id) || null
        }
    });
}

function definitionMemberNode(instance, member, kind) {
    return baseNode(member, {
        id: `semantic-member:${instance.id}:${kind}:${member.id || member.name}`,
        kind, parentId: instance.id,
        memberGroup: kind === 'function' ? 'local-functions' : 'types',
        details: { definitionId: member.id || null }
    });
}

function baseNode(source, overrides) {
    return {
        id: source.id, semanticId: source.id, sourceId: source.name, name: source.name,
        label: source.name, kind: source.kind, ownerId: overrides.parentId ?? null,
        packageName: source.packageName || null, relativePath: source.relativePath || null,
        location: source.location || null, sourceRange: source.sourceRange || null,
        annotations: {}, group: 'architecture',
        description: '', ports: [], reads: [], writes: [], invocations: [], scheduleRelations: [],
        analysisOrigin: source.analysisOrigin || 'Source-derived', confidence: source.confidence || 'explicit',
        sourceEvidence: evidenceText(source), ...overrides
    };
}

function addFlowEdge(edges, source, target, flow, kind, suffix = '') {
    addEdge(edges, source, target, kind, flow.payloadType || '', flow.location, {
        evidence: evidenceText(flow), analysisOrigin: flow.analysisOrigin,
        confidence: flow.confidence, semanticId: flow.id,
        idSuffix: suffix, payloadType: flow.payloadType || null, suppressLabel: ['state-read', 'state-write'].includes(kind)
    });
}

function addEdge(edges, source, target, kind, label, location, extra = {}) {
    if (!source || !target) return;
    edges.push({
        id: `semantic-edge:${edges.length}:${extra.idSuffix || ''}:${source}->${target}`,
        source, target, kind, label: label || '', mode: DATA_FLOW_KINDS.has(kind) ? 'data-flow' : 'structure',
        origin: 'source-derived', analysisOrigin: extra.analysisOrigin || 'Source-derived',
        confidence: extra.confidence || 'explicit', evidence: extra.evidence || label || kind,
        sourceLocation: location || null, bidirectional: false, inferred: true, ...extra
    });
}

function endpointOwner(id, endpoints) { return endpoints.get(id)?.ownerInstanceId || null; }
function legacyDefinitionId(definition) {
    if (!definition) return null;
    if (definition.kind === 'module-definition') return `module:${definition.packageName}.${definition.name}`;
    if (definition.kind === 'interface-definition') return `interface:${definition.packageName}.${definition.name}`;
    return null;
}
function evidenceText(item) {
    if (typeof item.evidence === 'string') return item.evidence;
    return item.sourceEvidence || item.evidence?.declaration || item.evidence?.targetExpression || '';
}

module.exports = { projectSemanticModel };
