'use strict';

(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BsvArchitectureSemanticQuery = api;
}(typeof globalThis === 'undefined' ? null : globalThis, function createApi() {
    const DEFAULT_TRACE_KINDS = Object.freeze(['payload']);

    function createSemanticQueries(model = {}) {
        const index = semanticIndexes(model);

        function getInstanceComposition(instanceId) {
            const instance = index.instanceById.get(instanceId);
            if (!instance) return unresolved();
            const children = values(index.childrenByInstance, instanceId);
            const endpoints = values(index.endpointsByInstance, instanceId);
            const channels = values(index.channelsByInstance, instanceId);
            const behaviors = values(index.stateBehaviorsByInstance, instanceId);
            const relatedIds = new Set([
                instanceId,
                ...children.map((item) => item.id),
                ...endpoints.map((item) => item.id),
                ...behaviors.map((item) => item.id)
            ]);
            const bindings = (model.bindings || []).filter((binding) =>
                [binding.ownerInstanceId, binding.sourceInstanceId, binding.targetInstanceId]
                    .some((id) => relatedIds.has(id))
            );
            const flows = (model.semanticFlows || []).filter((flow) =>
                relatedIds.has(flow.fromId) || relatedIds.has(flow.toId)
                || relatedIds.has(flow.ownerInstanceId)
            );
            const scheduling = (model.scheduleRelations || []).filter((relation) =>
                relatedIds.has(relation.sourceBehaviorId) || relatedIds.has(relation.targetBehaviorId)
            );
            return {
                status: 'exact',
                instance,
                parent: index.instanceById.get(instance.parentInstanceId) || null,
                children,
                endpoints,
                channels,
                behaviors,
                bindings,
                relationRoles: {
                    containment: [...children, ...endpoints, ...channels, ...behaviors],
                    binding: bindings,
                    payload: flows.filter((flow) => relationRole(flow) === 'payload'),
                    control: flows.filter((flow) => relationRole(flow) === 'control'),
                    implementation: flows.filter((flow) => relationRole(flow) === 'implementation'),
                    scheduling
                }
            };
        }

        function getChannelMembers(channelId) {
            const channel = index.channelById.get(channelId);
            if (!channel) return unresolved();
            const members = Object.entries(channel.methods || {}).flatMap(([role, endpointId]) => {
                const endpoint = index.endpointById.get(endpointId);
                return endpoint ? [{ role, endpoint }] : [];
            });
            return { status: 'exact', channel, members };
        }

        function resolveEndpointImplementation(endpointId, context = {}) {
            const endpoint = index.endpointById.get(endpointId);
            if (!endpoint || !contextAllowsOwner(context, endpoint.ownerInstanceId)) return unresolved();
            if (!endpoint.implementationMethodId) {
                return { status: 'unresolved', endpoint, behavior: null, candidates: [],
                    ownerInstanceId: endpoint.ownerInstanceId };
            }
            const candidates = (model.stateBehaviors || []).filter((behavior) =>
                behavior.ownerInstanceId === endpoint.ownerInstanceId
                && behavior.definitionId === endpoint.implementationMethodId
            );
            return {
                status: candidates.length === 1 ? 'exact' : candidates.length > 1 ? 'multiple' : 'unresolved',
                endpoint,
                behavior: candidates.length === 1 ? candidates[0] : null,
                candidates,
                ownerInstanceId: endpoint.ownerInstanceId
            };
        }

        function getFlowEvidence(flowId) {
            const flow = index.flowById.get(flowId);
            if (!flow) return unresolved();
            const producerEndpointId = flow.producerEndpointId || flow.fromEndpointId || null;
            const consumerEndpointId = flow.consumerEndpointId || flow.toEndpointId || null;
            return {
                status: 'exact',
                flow,
                evidenceRefs: evidenceRefs(flow),
                causeBehaviorId: flow.causeBehaviorId || flow.behaviorId || null,
                callSiteId: flow.callSiteId || null,
                producer: {
                    endpointId: producerEndpointId,
                    endpoint: index.endpointById.get(producerEndpointId) || null,
                    implementationBehaviorId: flow.producerImplementationBehaviorId || null
                },
                consumer: {
                    endpointId: consumerEndpointId,
                    endpoint: index.endpointById.get(consumerEndpointId) || null,
                    implementationBehaviorId: flow.consumerImplementationBehaviorId || null
                },
                mapping: flowMapping(flow),
                provenance: flow.provenance || {
                    analysisOrigin: flow.analysisOrigin || null,
                    resolutionStatus: flow.resolutionStatus || flow.payloadTypeStatus || 'exact'
                }
            };
        }

        function getBehaviorSlice(behaviorId, context = {}) {
            const behavior = index.stateBehaviorById.get(behaviorId);
            if (!behavior || !contextAllowsOwner(context, behavior.ownerInstanceId)) return unresolved();
            const key = `${behavior.ownerInstanceId}\u0000${behavior.definitionId}`;
            const bindings = values(index.bindingsByBehavior, behavior.id);
            const flows = (model.semanticFlows || []).filter((flow) =>
                flow.fromBehaviorId === behavior.id || flow.toBehaviorId === behavior.id
                || flow.causeBehaviorId === behavior.id || flow.behaviorId === behavior.id
            );
            const scheduleRelations = values(index.scheduleByBehavior, behavior.id);
            const implementationEndpoints = values(index.implementationEndpointsByBehavior, key);
            return {
                status: 'exact',
                behavior,
                owner: index.instanceById.get(behavior.ownerInstanceId) || null,
                bindings,
                flows,
                scheduleRelations,
                implementationEndpoints,
                evidenceRefs: behaviorEvidenceRefs(behavior, bindings)
            };
        }

        function getExpressionDependencies(expressionId) {
            return {
                status: 'unsupported',
                reason: 'expression-ir-pending-gate-c',
                expressionId
            };
        }

        function traceSemanticFlow(query = {}) {
            const fromId = query.fromId;
            const toId = query.toId;
            const requestedScope = query.scope && typeof query.scope === 'object'
                ? { ...query.scope } : null;
            if (!canonicalEntity(fromId) || !canonicalEntity(toId)
                || !validTraceScope(requestedScope)) {
                return traceResult('unresolved', [], 0, false,
                    'canonical-endpoint-or-scope-unresolved', requestedScope);
            }
            const kinds = Array.isArray(query.kinds) && query.kinds.length
                ? [...new Set(query.kinds)] : [...DEFAULT_TRACE_KINDS];
            const maxDepth = nonNegative(query.maxDepth, 32);
            const maxVisited = nonNegative(query.maxVisited, 10000);
            if (maxVisited === 0) {
                return traceResult('search-limit', [], 0, true, 'max-visited', requestedScope);
            }
            const allowed = new Set(kinds);
            const adjacency = new Map();
            for (const flow of model.semanticFlows || []) {
                if (!allowed.has(flow.kind) || !inTraceScope(flow, requestedScope)) continue;
                if (!adjacency.has(flow.fromId)) adjacency.set(flow.fromId, []);
                adjacency.get(flow.fromId).push(flow);
            }
            for (const flows of adjacency.values()) flows.sort((a, b) => a.id.localeCompare(b.id));
            const queue = [{ nodeId: fromId, flows: [] }];
            const bestDepth = new Map([[fromId, 0]]);
            let visitedCount = 0;
            let depthTruncated = false;
            const paths = [];
            let shortest = null;
            while (queue.length) {
                if (visitedCount >= maxVisited) {
                    return traceResult('search-limit', paths, visitedCount, true,
                        'max-visited', requestedScope);
                }
                const current = queue.shift();
                visitedCount += 1;
                if (current.nodeId === toId) {
                    shortest = shortest ?? current.flows.length;
                    if (current.flows.length === shortest) paths.push(tracePath(fromId, toId, current.flows));
                    continue;
                }
                if (shortest !== null) continue;
                if (current.flows.length >= maxDepth) {
                    if ((adjacency.get(current.nodeId) || []).length) depthTruncated = true;
                    continue;
                }
                for (const flow of adjacency.get(current.nodeId) || []) {
                    const depth = current.flows.length + 1;
                    const previous = bestDepth.get(flow.toId);
                    if (previous !== undefined && previous < depth) continue;
                    bestDepth.set(flow.toId, depth);
                    queue.push({ nodeId: flow.toId, flows: [...current.flows, flow] });
                }
            }
            if (paths.length) {
                const uncertain = paths.some((path) => path.uncertainty);
                return traceResult(uncertain ? 'unresolved' : 'exact', paths,
                    visitedCount, false, uncertain ? 'unresolved-dependency' : null, requestedScope);
            }
            if (depthTruncated) {
                return traceResult('search-limit', [], visitedCount, true, 'max-depth', requestedScope);
            }
            if (hasUnresolvedDependency(fromId, toId, allowed, requestedScope)) {
                return traceResult('unresolved', [], visitedCount, false,
                    'ambiguous-dependency', requestedScope);
            }
            return traceResult('no-path', [], visitedCount, false, null, requestedScope);
        }

        function validTraceScope(scope) {
            if (!scope) return true;
            if (scope.rootInstanceId) {
                const root = index.instanceById.get(scope.rootInstanceId);
                if (!root || root.parentInstanceId) return false;
            }
            return !scope.ownerInstanceId || index.instanceById.has(scope.ownerInstanceId);
        }

        function inTraceScope(flow, scope) {
            if (!scope) return true;
            if (scope.ownerInstanceId && flow.ownerInstanceId !== scope.ownerInstanceId) return false;
            if (scope.rootInstanceId) {
                return rootForEntity(flow.fromId) === scope.rootInstanceId
                    && rootForEntity(flow.toId) === scope.rootInstanceId;
            }
            return true;
        }

        function hasUnresolvedDependency(fromId, toId, allowed, scope) {
            if (!allowed.has('payload')) return false;
            return (model.diagnostics || []).some((diagnostic) =>
                diagnostic.code === 'semantic-flow.unresolved'
                && diagnostic.consumerEndpointId === toId
                && (diagnostic.evidence?.producerEndpointIds || []).includes(fromId)
                && (!scope?.ownerInstanceId || diagnostic.ownerInstanceId === scope.ownerInstanceId)
                && (!scope?.rootInstanceId
                    || rootForEntity(fromId) === scope.rootInstanceId
                    && rootForEntity(toId) === scope.rootInstanceId)
            );
        }

        function resolveSourceReference(reference, context = {}) {
            if (typeof reference === 'string' || reference?.id) {
                const id = typeof reference === 'string' ? reference : reference.id;
                const candidate = sourceReferenceForId(id);
                if (!candidate || !contextAllowsOwner(context, candidate.ownerInstanceId)) return unresolved();
                return { status: 'exact', references: [candidate] };
            }
            if (!reference?.uri || !Number.isInteger(reference.line)
                || !Number.isInteger(reference.column)) return unresolved();
            let candidates = sourceCandidates().filter((candidate) =>
                positionInRange(reference, candidate.sourceRange || candidate.location)
            );
            if (context.ownerInstanceId) {
                candidates = candidates.filter((candidate) =>
                    candidate.ownerInstanceId === context.ownerInstanceId
                );
            }
            if (!candidates.length) return unresolved();
            const minimum = Math.min(...candidates.map((candidate) =>
                rangeWeight(candidate.sourceRange || candidate.location)
            ));
            candidates = candidates.filter((candidate) =>
                rangeWeight(candidate.sourceRange || candidate.location) === minimum
            ).sort((a, b) => a.id.localeCompare(b.id));
            return {
                status: candidates.length === 1 ? 'exact' : 'multiple',
                references: candidates
            };
        }

        function canonicalEntity(id) {
            return index.instanceById.get(id) || index.endpointById.get(id)
                || index.stateBehaviorById.get(id) || index.flowById.get(id)
                || index.bindingById.get(id) || index.channelById.get(id)
                || index.definitionById.get(id) || null;
        }

        function sourceReferenceForId(id) {
            const entity = canonicalEntity(id);
            return entity ? sourceReference(entity) : null;
        }

        let cachedSourceCandidates = null;
        function sourceCandidates() {
            if (cachedSourceCandidates) return cachedSourceCandidates;
            cachedSourceCandidates = [
                ...(model.definitions || []),
                ...(model.instances || []),
                ...(model.endpoints || []),
                ...(model.bindings || []),
                ...(model.semanticFlows || []),
                ...(model.stateBehaviors || []),
                ...(model.protocolChannels || []),
                ...(model.scheduleRelations || [])
            ].filter((entity) => entity.id && (entity.sourceRange || entity.location))
                .map(sourceReference);
            return cachedSourceCandidates;
        }

        function sourceReference(entity) {
            return {
                id: entity.id,
                kind: semanticKind(entity),
                ownerInstanceId: ownerInstanceId(entity),
                location: entity.location || null,
                sourceRange: entity.sourceRange || null,
                entity
            };
        }

        function ownerInstanceId(entity) {
            if (entity.ownerInstanceId) return entity.ownerInstanceId;
            if (entity.ownerInstanceId === null) return null;
            if (entity.kind === 'instance-occurrence') return entity.id;
            return null;
        }

        function tracePath(fromId, toId, flows) {
            const steps = flows.map((flow) => ({
                flowId: flow.id,
                kind: flow.kind,
                fromId: flow.fromId,
                toId: flow.toId,
                mapping: flowMapping(flow),
                causeBehaviorId: flow.causeBehaviorId || null,
                callSiteId: flow.callSiteId || null,
                evidenceRefs: evidenceRefs(flow),
                scope: flowScope(flow),
                uncertainty: flowUncertainty(flow)
            }));
            return {
                fromId,
                toId,
                steps,
                scope: {
                    fromRootInstanceId: rootForEntity(fromId),
                    toRootInstanceId: rootForEntity(toId)
                },
                uncertainty: steps.some((step) => step.uncertainty) ? 'contains-unresolved-step' : null
            };
        }

        function flowScope(flow) {
            return {
                ownerInstanceId: flow.ownerInstanceId || null,
                fromRootInstanceId: rootForEntity(flow.fromId),
                toRootInstanceId: rootForEntity(flow.toId)
            };
        }

        function rootForEntity(id) {
            const entity = canonicalEntity(id);
            let ownerId = entity?.kind === 'instance-occurrence' ? entity.id
                : entity?.ownerInstanceId || null;
            const seen = new Set();
            while (ownerId && !seen.has(ownerId)) {
                seen.add(ownerId);
                const instance = index.instanceById.get(ownerId);
                if (!instance) return null;
                if (!instance.parentInstanceId) return instance.id;
                ownerId = instance.parentInstanceId;
            }
            return null;
        }

        return {
            getInstanceComposition,
            getChannelMembers,
            resolveEndpointImplementation,
            getFlowEvidence,
            getBehaviorSlice,
            getExpressionDependencies,
            traceSemanticFlow,
            resolveSourceReference
        };
    }

    function semanticIndexes(model) {
        const supplied = model.indexes || model.semanticIndexes || {};
        const definitions = model.definitions || [];
        const instances = model.instances || [];
        const endpoints = model.endpoints || [];
        const bindings = model.bindings || [];
        const channels = model.protocolChannels || [];
        const flows = model.semanticFlows || [];
        const behaviors = model.stateBehaviors || [];
        const schedules = model.scheduleRelations || [];
        return {
            definitionById: supplied.definitionById || mapById(definitions),
            instanceById: supplied.instanceById || mapById(instances),
            childrenByInstance: supplied.childrenByInstance || grouped(instances, (item) => item.parentInstanceId),
            endpointById: supplied.endpointById || mapById(endpoints),
            endpointsByInstance: supplied.endpointsByInstance || grouped(endpoints, (item) => item.ownerInstanceId),
            bindingById: supplied.bindingById || mapById(bindings),
            bindingsByBehavior: supplied.bindingsByBehavior || grouped(bindings, (item) => item.behaviorId),
            channelById: supplied.channelById || mapById(channels),
            channelsByInstance: supplied.channelsByInstance || grouped(channels, (item) => item.ownerInstanceId),
            flowById: supplied.flowById || mapById(flows),
            stateBehaviorById: supplied.stateBehaviorById || mapById(behaviors),
            stateBehaviorsByInstance: supplied.stateBehaviorsByInstance
                || grouped(behaviors, (item) => item.ownerInstanceId),
            implementationEndpointsByBehavior: supplied.implementationEndpointsByBehavior
                || grouped(endpoints.filter((item) => item.implementationMethodId),
                    (item) => `${item.ownerInstanceId}\u0000${item.implementationMethodId}`),
            scheduleByBehavior: supplied.scheduleByBehavior || grouped(
                schedules.flatMap((relation) => [
                    { ...relation, behaviorId: relation.sourceBehaviorId },
                    { ...relation, behaviorId: relation.targetBehaviorId }
                ]),
                (item) => item.behaviorId
            )
        };
    }

    function evidenceRefs(flow) {
        if (Array.isArray(flow.evidenceRefs)) return flow.evidenceRefs;
        if (!flow.evidence) return [];
        return [{ kind: 'relation', id: flow.id, text: flow.evidence, location: flow.location || null }];
    }
    function behaviorEvidenceRefs(behavior, bindings) {
        const refs = bindings.flatMap((binding) => binding.evidenceRefs || []);
        if (refs.length) return refs;
        return (behavior.evidence || []).map((text, index) => ({
            kind: 'behavior', id: `${behavior.id}:evidence:${index}`, text,
            location: behavior.location || null
        }));
    }
    function flowMapping(flow) {
        return {
            parameterIndex: flow.consumerArgumentIndex ?? flow.parameterIndex ?? null,
            parameterName: flow.consumerArgumentName || flow.parameterName || null,
            sourceExpression: flow.sourceExpression || null,
            sourceAliases: [...(flow.sourceAliases || [])],
            consumerArgumentExpression: flow.consumerArgumentExpression || flow.alias || null,
            payloadType: flow.payloadType || null,
            payloadTypeStatus: flow.payloadTypeStatus || null
        };
    }
    function relationRole(flow) {
        if (flow.relationRole) return flow.relationRole;
        if (flow.implementationLink) return 'implementation';
        if (flow.kind === 'payload') return 'payload';
        if (['constructor-binding', 'interface-forward'].includes(flow.kind)) return 'binding';
        return 'control';
    }
    function flowUncertainty(flow) {
        if (flow.resolutionStatus && flow.resolutionStatus !== 'exact') return flow.resolutionStatus;
        return flow.payloadTypeStatus && flow.payloadTypeStatus !== 'exact'
            ? flow.payloadTypeStatus : null;
    }
    function traceResult(status, paths, visitedCount, truncated, uncertainty, scope = null) {
        return {
            status,
            paths: paths.map((path) => ({ ...path, truncated })),
            visitedCount,
            truncated,
            uncertainty,
            scope
        };
    }
    function semanticKind(entity) {
        if (entity.kind) return entity.kind;
        return 'semantic-entity';
    }
    function contextAllowsOwner(context, ownerId) {
        return !context?.ownerInstanceId || context.ownerInstanceId === ownerId;
    }
    function positionInRange(position, range) {
        if (!range || position.uri !== range.uri) return false;
        const afterStart = position.line > range.line
            || position.line === range.line && position.column >= (range.column || 0);
        const endLine = Number.isInteger(range.endLine) ? range.endLine : range.line;
        const endColumn = Number.isInteger(range.endColumn)
            ? range.endColumn : (range.column || 0) + 1;
        return afterStart && (position.line < endLine
            || position.line === endLine && position.column <= endColumn);
    }
    function rangeWeight(range) {
        const lines = Math.max(0, (range.endLine ?? range.line) - range.line);
        return lines * 1000000 + (lines === 0
            ? Math.max(0, (range.endColumn ?? range.column) - range.column)
            : Math.max(0, range.endColumn || 0));
    }
    function values(map, key) { return map.get(key) || []; }
    function mapById(items) { return new Map(items.map((item) => [item.id, item])); }
    function grouped(items, key) {
        const result = new Map();
        for (const item of items) {
            const value = key(item);
            if (value === null || value === undefined) continue;
            if (!result.has(value)) result.set(value, []);
            result.get(value).push(item);
        }
        for (const group of result.values()) group.sort((a, b) => a.id.localeCompare(b.id));
        return result;
    }
    function nonNegative(value, fallback) {
        return Number.isInteger(value) && value >= 0 ? value : fallback;
    }
    function unresolved() { return { status: 'unresolved', references: [] }; }

    return { DEFAULT_TRACE_KINDS, createSemanticQueries };
}));
