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
    const roots = new Map(model.roots.map((item) => [item.instanceId, item]));
    const boundaries = new Map((model.semanticBoundaries || []).map((item) => [
        item.rootInstanceId, item
    ]));
    const channelExposure = new Map();
    for (const boundary of boundaries.values()) for (const exposure of boundary.channels) {
        channelExposure.set(exposure.channelId, { boundary, exposure });
    }
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
    for (const instance of instances.values()) nodes.push(instanceNode(
        instance,
        definitions,
        roots.get(instance.id),
        boundaries.get(instance.id)
    ));
    for (const behavior of model.stateBehaviors) nodes.push(behaviorNode(behavior, instances, definitions));
    for (const channel of channels.values()) nodes.push(channelNode(
        channel,
        instances,
        channelExposure.get(channel.id)
    ));
    for (const boundary of boundaries.values()) {
        nodes.push(boundaryNode(boundary, instances, 'inbound'));
        nodes.push(boundaryNode(boundary, instances, 'outbound'));
    }
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
    for (const boundary of boundaries.values()) {
        for (const exposure of boundary.channels) {
            if (!nodeIds.has(exposure.channelId)) continue;
            for (const direction of boundaryDirections(exposure)) {
                const inbound = direction.direction === 'inbound';
                const boundaryNodeId = boundaryPresentationId(
                    boundary.rootInstanceId,
                    direction.direction
                );
                if (!nodeIds.has(boundaryNodeId)) continue;
                addEdge(
                    edges,
                    inbound ? boundaryNodeId : exposure.channelId,
                    inbound ? exposure.channelId : boundaryNodeId,
                    inbound ? 'boundary-input' : 'boundary-output',
                    direction.payloadTypes.join(' | '),
                    exposure.location,
                    {
                        mode: 'data-flow', boundary: true, external: true, inferred: false,
                        semanticFlowId: null, semanticBoundaryId: boundary.id,
                        boundaryNodeId, rootInstanceId: boundary.rootInstanceId,
                        channelId: exposure.channelId, direction: direction.direction,
                        payloadTypes: direction.payloadTypes,
                        analysisOrigin: boundary.analysisOrigin, confidence: boundary.confidence,
                        evidence: `Unbound ${direction.direction} root channel ${exposure.name}`,
                        idSuffix: `${boundary.id}:${exposure.channelId}:${direction.direction}`
                    }
                );
            }
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

function instanceNode(instance, definitions, root, boundary) {
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
            rootReason: root?.reason || instance.rootReason || null,
            rootStatus: root?.rootStatus || instance.rootStatus || null,
            externalBoundaryIds: boundary ? {
                inbound: boundaryPresentationId(instance.id, 'inbound'),
                outbound: boundaryPresentationId(instance.id, 'outbound')
            } : null,
            externalChannelCount: boundary?.channels.length || 0,
            unmatchedPublicEndpointCount: boundary?.unmatchedEndpoints.length || 0,
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

function channelNode(channel, instances, boundaryExposure) {
    const owner = instances.get(channel.ownerInstanceId);
    const boundary = boundaryExposure?.boundary;
    const exposure = boundaryExposure?.exposure;
    return baseNode({ ...channel, relativePath: owner?.relativePath }, {
        parentId: channel.ownerInstanceId,
        memberGroup: 'protocol-channels',
        externalChannel: Boolean(boundary),
        boundaryRootId: boundary?.rootInstanceId || null,
        details: {
            direction: channel.direction,
            payloadType: channel.payloadType,
            methods: channel.methods,
            boundaryStatus: exposure?.bindingStatus || null,
            semanticBoundaryId: boundary?.id || null,
            boundaryNodeIds: boundary ? {
                inbound: boundaryPresentationId(boundary.rootInstanceId, 'inbound'),
                outbound: boundaryPresentationId(boundary.rootInstanceId, 'outbound')
            } : null,
            legs: exposure?.legs || []
        }
    });
}

function boundaryNode(boundary, instances, direction) {
    const root = instances.get(boundary.rootInstanceId);
    const input = direction === 'inbound';
    const channels = boundary.channels.filter((exposure) =>
        boundaryDirections(exposure).some((item) => item.direction === direction)
    );
    const unmatchedEndpoints = boundary.unmatchedEndpoints.filter((endpoint) =>
        (endpoint.legs || []).some((leg) => leg.direction === direction)
    );
    return baseNode({
        ...boundary,
        id: boundaryPresentationId(boundary.rootInstanceId, direction),
        name: `${root?.name || boundary.path} External ${input ? 'Inputs' : 'Outputs'}`,
        location: null,
        sourceRange: null,
        relativePath: root?.relativePath || null
    }, {
        semanticId: boundary.id,
        label: `External ${input ? 'Inputs' : 'Outputs'}`,
        kind: 'root-boundary',
        parentId: null,
        virtual: true,
        external: true,
        rootBoundary: true,
        presentationRole: input ? 'external-input' : 'external-output',
        boundaryDirection: direction,
        boundaryRootId: boundary.rootInstanceId,
        bindingStatus: boundary.bindingStatus,
        details: {
            rootInstanceId: boundary.rootInstanceId,
            rootReason: boundary.rootReason,
            rootStatus: boundary.rootStatus,
            bindingStatus: boundary.bindingStatus,
            direction,
            presentationRole: input ? 'external-input' : 'external-output',
            channelCount: channels.length,
            totalChannelCount: boundary.channels.length,
            unmatchedEndpointCount: unmatchedEndpoints.length,
            totalUnmatchedEndpointCount: boundary.unmatchedEndpoints.length,
            channels,
            unmatchedEndpoints
        }
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

function boundaryDirections(exposure) {
    const legDirections = unique((exposure.legs || []).map((leg) => leg.direction).filter(Boolean));
    const logical = legDirections.length > 0
        ? legDirections
        : exposure.direction === 'input' || exposure.direction === 'ack'
            ? ['inbound']
            : exposure.direction === 'request-response'
                ? ['inbound', 'outbound']
                : ['outbound'];
    return logical.map((direction) => {
        const legPayloadTypes = (exposure.legs || [])
            .filter((leg) => leg.direction === direction
                && leg.transfer !== 'control'
                && leg.payloadType !== 'Bool')
            .map((leg) => leg.payloadType)
            .filter(Boolean);
        return {
            direction,
            payloadTypes: unique(legPayloadTypes.length > 0 || exposure.legs?.length > 0
                ? legPayloadTypes
                : exposure.payloadType ? [exposure.payloadType] : [])
        };
    });
}
function boundaryPresentationId(rootInstanceId, direction) {
    return `boundary-${direction === 'inbound' ? 'input' : 'output'}:${rootInstanceId}`;
}
function endpointOwner(id, endpoints) { return endpoints.get(id)?.ownerInstanceId || null; }
function unique(items) { return [...new Set(items)]; }
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
