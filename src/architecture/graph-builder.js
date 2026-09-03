'use strict';

const { applyNodeConfiguration, groupForPath } = require('./config');
const { analyzeTypeWidth } = require('./type-analysis');
const { findMatchingDelimiter, normalizeWhitespace, splitTopLevel } = require('./source-utils');
const { normalizeScheduleAttributes } = require('./scheduling');
const { resolveArchitectureSymbol } = require('./symbol-resolver');

function buildArchitectureModel(parsedFiles, config, context = {}) {
    const nodes = [];
    const edges = [];
    const diagnostics = parsedFiles.flatMap((file) => file.diagnostics || []);
    const nodeById = new Map();
    const packageNodes = new Map();
    const moduleNodesByName = new Map();
    const interfaceNodesByName = new Map();
    const functionNodesByName = new Map();
    const interfaceDefinitionsByName = indexInterfaceDefinitions(parsedFiles);
    const fileByPackage = new Map();
    const childNodeByOwnerAndName = new Map();
    const typeDefinitions = parsedFiles;

    const addNode = (rawNode) => {
        if (nodeById.has(rawNode.id)) {
            diagnostics.push({
                severity: 'warning',
                message: `Duplicate architecture node id: ${rawNode.id}`,
                location: rawNode.location || null
            });
            return nodeById.get(rawNode.id);
        }
        const node = applyNodeConfiguration({
            ownerId: rawNode.ownerId ?? rawNode.parentId ?? null,
            memberGroup: rawNode.memberGroup || memberGroupFor(rawNode),
            ports: rawNode.ports || [],
            reads: rawNode.reads || [],
            writes: rawNode.writes || [],
            invocations: rawNode.invocations || [],
            scheduleRelations: rawNode.scheduleRelations || [],
            analysisOrigin: rawNode.analysisOrigin || (rawNode.virtual ? 'Configured' : 'Source-derived'),
            confidence: rawNode.confidence || 'explicit',
            sourceEvidence: rawNode.sourceEvidence || rawNode.signature || '',
            ...rawNode
        }, config);
        nodes.push(node);
        nodeById.set(node.id, node);
        return node;
    };

    const addEdge = createEdgeAdder(edges);

    for (const file of parsedFiles) {
        fileByPackage.set(file.packageName, file);
        const packageId = packageNodeId(file.packageName);
        const packageNode = addNode({
            id: packageId,
            sourceId: file.packageName,
            name: file.packageName,
            label: file.packageName,
            kind: 'package',
            packageName: file.packageName,
            relativePath: file.relativePath,
            location: file.packageLocation,
            annotations: file.packageAnnotations,
            group: groupForPath(config, file.relativePath),
            description: '',
            details: {
                imports: file.imports.map((entry) => entry.package),
                exports: file.exports.map((entry) => entry.value),
                modules: file.modules.length,
                interfaces: file.interfaces.length,
                functions: file.functions.filter((fn) => !fn.parentModuleName).length,
                types: file.types.filter((type) => !type.parentModuleName).length
            }
        });
        packageNodes.set(file.packageName, packageNode);

        for (const item of file.interfaces) {
            const id = interfaceNodeId(file.packageName, item.name);
            const methods = item.methods.map((method) => decorateMethodPort(method, item.name, typeDefinitions));
            const node = addNode({
                id,
                sourceId: item.name,
                name: item.name,
                label: item.name,
                kind: 'interface',
                packageName: file.packageName,
                relativePath: file.relativePath,
                location: item.location,
                sourceRange: item.sourceRange,
                annotations: item.annotations,
                group: groupForPath(config, file.relativePath),
                description: '',
                signature: item.signature,
                parentId: packageId,
                ports: methods,
                details: {
                    methods,
                    subinterfaces: item.subinterfaces
                }
            });
            indexByName(interfaceNodesByName, item.name, node);
            addEdge(packageId, id, 'contains', 'interface', true);
        }

        for (const item of file.types) {
            const parentId = item.parentModuleName
                ? moduleNodeId(file.packageName, item.parentModuleName)
                : packageId;
            const id = typeNodeId(file.packageName, item.name, item.parentModuleName);
            addNode({
                id,
                sourceId: item.name,
                name: item.name,
                label: item.name,
                kind: item.kind === 'alias' ? 'type' : item.kind,
                packageName: file.packageName,
                relativePath: file.relativePath,
                location: item.location,
                sourceRange: item.sourceRange,
                annotations: item.annotations,
                group: groupForPath(config, file.relativePath),
                description: '',
                signature: item.signature,
                parentId,
                details: {
                    ...item.details,
                    width: analyzeTypeWidth(item.name, typeDefinitions)
                }
            });
        }

        for (const item of file.modules) {
            const id = moduleNodeId(file.packageName, item.name);
            const interfaceDefinition = resolveInterfaceDefinition(
                item.returnInterface,
                file,
                interfaceDefinitionsByName
            );
            const ports = (interfaceDefinition?.item.methods || [])
                .map((method) => decorateMethodPort(method, interfaceDefinition.item.name, typeDefinitions));
            const node = addNode({
                id,
                sourceId: item.name,
                name: item.name,
                label: item.name,
                kind: 'module',
                packageName: file.packageName,
                relativePath: file.relativePath,
                location: item.location,
                sourceRange: item.sourceRange,
                annotations: item.annotations,
                group: groupForPath(config, file.relativePath),
                description: item.summary,
                signature: item.signature,
                parentId: packageId,
                ports,
                scheduleRelations: item.scheduleRelations || [],
                details: {
                    returnInterface: item.returnInterface,
                    instanceCount: item.instances.length,
                    ruleCount: item.rules.length,
                    methodCount: item.methods.length,
                    stateCount: item.instances.filter((instance) => instance.primitiveKind).length,
                    childInstanceCount: item.instances.filter((instance) => !instance.primitiveKind).length,
                    localFunctions: item.localFunctions,
                    providedInterfaces: item.providedInterfaces,
                    methodPorts: ports
                }
            });
            indexByName(moduleNodesByName, item.name, node);
            addEdge(packageId, id, 'contains', 'module', true);
        }

        for (const item of file.functions) {
            const ownerId = item.parentModuleName
                ? moduleNodeId(file.packageName, item.parentModuleName)
                : packageId;
            const id = functionNodeId(file.packageName, item.name, item.parentModuleName, item.location.line);
            const node = addNode({
                id,
                sourceId: item.name,
                name: item.name,
                label: item.name,
                kind: 'function',
                packageName: file.packageName,
                relativePath: file.relativePath,
                location: item.location,
                sourceRange: item.sourceRange,
                annotations: item.annotations,
                group: groupForPath(config, file.relativePath),
                description: '',
                signature: item.signature,
                parentId: ownerId,
                details: {
                    returnType: item.returnType,
                    parameters: item.parameters,
                    locals: item.locals,
                    calls: item.calls,
                    returns: item.returns,
                    operations: item.operations,
                    parentModuleName: item.parentModuleName
                }
            });
            indexByName(functionNodesByName, item.name, node);
            childNodeByOwnerAndName.set(`${ownerId}:${item.name}`, node);
            addEdge(ownerId, id, 'contains', item.parentModuleName ? 'local function' : 'function', true);
        }
    }

    for (const file of parsedFiles) {
        for (const module of file.modules) {
            const ownerId = moduleNodeId(file.packageName, module.name);
            const ownerNode = nodeById.get(ownerId);
            if (!ownerNode) continue;

            for (const instance of module.instances) {
                const id = instanceNodeId(ownerId, instance.name, instance.location.line);
                const kind = instance.primitiveKind || 'instance';
                const dataType = storageDataType(instance.type, instance.primitiveKind);
                const node = addNode({
                    id,
                    sourceId: instance.name,
                    name: instance.name,
                    label: instance.name,
                    kind,
                    packageName: file.packageName,
                    relativePath: file.relativePath,
                    location: instance.location,
                    sourceRange: instance.sourceRange,
                    annotations: {},
                    group: ownerNode.group,
                    description: '',
                    signature: instance.signature,
                    parentId: ownerId,
                    primitive: Boolean(instance.primitiveKind),
                    details: {
                        type: instance.type,
                        declaredType: instance.declaredType,
                        constructor: instance.constructor,
                        constructorExpression: instance.constructorExpression,
                        staticArguments: instance.staticArguments,
                        arguments: instance.arguments,
                        specialization: instance.specialization,
                        multiplicity: instance.multiplicity,
                        role: instance.role,
                        config: instance.config,
                        primitiveKind: instance.primitiveKind,
                        dataType,
                        width: dataType ? analyzeTypeWidth(dataType, typeDefinitions) : unresolvedWidth('instance data type is unknown'),
                        targetId: null,
                        targetName: null
                    }
                });
                childNodeByOwnerAndName.set(`${ownerId}:${instance.name}`, node);
                addEdge(ownerId, id, 'contains', kind, true);
            }

            for (const rule of module.rules) {
                const id = memberNodeId('rule', ownerId, rule.name, rule.location.line);
                const node = addNode({
                    id,
                    sourceId: rule.name,
                    name: rule.name,
                    label: rule.name,
                    kind: 'rule',
                    packageName: file.packageName,
                    relativePath: file.relativePath,
                    location: rule.location,
                    sourceRange: rule.sourceRange,
                    annotations: {},
                    group: ownerNode.group,
                    description: rule.guard ? `Guard: ${rule.guard}` : '',
                    signature: rule.signature,
                    parentId: ownerId,
                    reads: rule.reads || [],
                    writes: rule.writes || [],
                    invocations: rule.invocations || [],
                    details: {
                        guard: rule.guard,
                        calls: rule.calls,
                        references: rule.references,
                        accesses: rule.accesses || []
                    }
                });
                childNodeByOwnerAndName.set(`${ownerId}:${rule.name}`, node);
                addEdge(ownerId, id, 'contains', 'rule', true);
                addBehaviorAccessEdges(
                    node,
                    rule.accesses,
                    ownerId,
                    file,
                    childNodeByOwnerAndName,
                    interfaceDefinitionsByName,
                    addEdge
                );
                addCallEdges(node, rule.calls, file, functionNodesByName, nodes, nodeById, addEdge, diagnostics);
            }

            for (const method of module.methods) {
                const id = memberNodeId('method', ownerId, method.name, method.location.line);
                const port = decorateMethodPort(method, module.returnInterface, typeDefinitions);
                const node = addNode({
                    id,
                    sourceId: method.name,
                    name: method.name,
                    label: method.name,
                    kind: 'method',
                    packageName: file.packageName,
                    relativePath: file.relativePath,
                    location: method.location,
                    sourceRange: method.sourceRange,
                    annotations: {},
                    group: ownerNode.group,
                    description: '',
                    signature: method.signature,
                    parentId: ownerId,
                    ports: [port],
                    reads: method.reads || [],
                    writes: method.writes || [],
                    invocations: method.invocations || [],
                    details: {
                        returnType: method.returnType,
                        parameters: method.parameters,
                        guard: method.guard || '',
                        category: method.category || 'unknown',
                        direction: method.direction || 'unknown',
                        resultType: method.resultType || null,
                        inline: method.inline,
                        calls: method.calls,
                        references: method.references,
                        accesses: method.accesses || []
                    }
                });
                childNodeByOwnerAndName.set(`${ownerId}:${method.name}`, node);
                addEdge(ownerId, id, 'contains', 'method', true);
                addBehaviorAccessEdges(
                    node,
                    method.accesses,
                    ownerId,
                    file,
                    childNodeByOwnerAndName,
                    interfaceDefinitionsByName,
                    addEdge
                );
                addCallEdges(node, method.calls, file, functionNodesByName, nodes, nodeById, addEdge, diagnostics);
            }

            if (config.scheduling?.provider !== 'off') {
                if (config.scheduling?.includePotentialDependencies !== false) {
                    addPotentialStateDependencies(ownerId, nodes, addEdge);
                }
            }
        }
    }

    for (const file of parsedFiles) {
        const sourcePackage = packageNodes.get(file.packageName);
        if (!sourcePackage) continue;
        for (const imported of file.imports) {
            const targetPackage = packageNodes.get(imported.package);
            if (targetPackage) addEdge(sourcePackage.id, targetPackage.id, 'import', '', true);
        }

        for (const module of file.modules) {
            const sourceId = moduleNodeId(file.packageName, module.name);
            if (module.returnInterface) {
                const interfaceResolution = resolveNamedTarget(
                    module.returnInterface,
                    file,
                    interfaceNodesByName,
                    nodes,
                    nodeById,
                    ['interface']
                );
                if (interfaceResolution.status === 'exact') {
                    addEdge(sourceId, interfaceResolution.node.id, 'implements', '', true);
                } else if (interfaceResolution.status === 'ambiguous') {
                    addResolutionDiagnostic(
                        diagnostics,
                        module.returnInterface,
                        interfaceResolution,
                        module.location
                    );
                }
            }

            for (const instance of module.instances) {
                if (instance.primitiveKind) continue;
                const instanceId = instanceNodeId(sourceId, instance.name, instance.location.line);
                const instanceNode = nodeById.get(instanceId);
                const targetResolution = resolveNamedTarget(
                    instance.constructor,
                    file,
                    moduleNodesByName,
                    nodes,
                    nodeById,
                    ['module']
                );
                if (targetResolution.status === 'exact') {
                    instanceNode.details.targetId = targetResolution.node.id;
                    instanceNode.details.targetName = targetResolution.node.name;
                    addEdge(sourceId, targetResolution.node.id, 'instantiate', instance.name, true);
                } else {
                    instanceNode.details.targetName = instance.constructor;
                    instanceNode.details.unresolved = true;
                    if (targetResolution.status === 'ambiguous') {
                        addResolutionDiagnostic(
                            diagnostics,
                            instance.constructor,
                            targetResolution,
                            instance.location
                        );
                    }
                }
            }
        }

        for (const fn of file.functions) {
            const sourceId = functionNodeId(file.packageName, fn.name, fn.parentModuleName, fn.location.line);
            const sourceNode = nodeById.get(sourceId);
            if (sourceNode) {
                addCallEdges(sourceNode, fn.calls, file, functionNodesByName, nodes, nodeById, addEdge, diagnostics);
            }
        }
    }

    for (const virtualNode of config.virtualNodes) addNode(virtualNode);
    for (const manualEdge of config.edges) {
        const source = resolveNodeReference(manualEdge.from, nodes, nodeById);
        const target = resolveNodeReference(manualEdge.to, nodes, nodeById);
        if (source.status === 'exact' && target.status === 'exact') {
            addEdge(source.node.id, target.node.id, manualEdge.kind, manualEdge.label, false, {
                description: manualEdge.description,
                mode: manualEdge.mode,
                origin: manualEdge.origin,
                confidence: manualEdge.confidence,
                evidence: manualEdge.evidence,
                bidirectional: manualEdge.bidirectional,
                manual: true
            });
        } else {
            addResolutionDiagnostic(diagnostics, manualEdge.from, source, null, 'Manual');
            addResolutionDiagnostic(diagnostics, manualEdge.to, target, null, 'Manual');
        }
    }

    const scheduleRelations = context.scheduleRelations
        || normalizeScheduleAttributes(parsedFiles);
    addExternalScheduleEdges(scheduleRelations, nodes, addEdge, diagnostics, context);
    attachCompilerSupportingEvidence(edges);
    const limits = applyGraphLimits(nodes, edges, context.limits, diagnostics);
    attachMemberBuckets(nodes, edges);
    attachScheduleRelations(nodes, edges);

    for (const node of nodes) {
        if (node.hidden) continue;
        if (node.entry) node.tags = unique([...(node.tags || []), 'entrypoint']);
    }

    const roots = computeRoots(nodes, edges, config.entrypoints);
    const groups = buildGroups(nodes, config);
    const files = parsedFiles.map((file) => ({
        uri: file.uri,
        relativePath: file.relativePath,
        packageName: file.packageName,
        lineCount: file.lineCount,
        diagnostics: file.diagnostics.length,
        nodeIds: nodes.filter((node) => node.relativePath === file.relativePath).map((node) => node.id)
    }));

    const visibleNodes = nodes.filter((node) => !node.hidden);
    const stats = countKinds(visibleNodes, edges);
    const scheduling = summarizeScheduling(edges, context.scheduleProvider);

    return {
        schemaVersion: 2,
        title: config.title,
        generatedAt: new Date().toISOString(),
        workspaceName: context.workspaceName || '',
        workspaceUri: context.workspaceUri || null,
        activeFile: context.activeFile || null,
        config,
        files,
        nodes,
        edges,
        groups,
        roots,
        scheduling,
        diagnostics,
        stats,
        limits
    };
}

function applyGraphLimits(nodes, edges, requested = {}, diagnostics = []) {
    const maxNodes = graphLimit(requested.maxNodes, 10000);
    const maxEdges = graphLimit(requested.maxEdges, 25000);
    const originalNodes = nodes.length;
    const originalEdges = edges.length;
    if (nodes.length > maxNodes) nodes.splice(maxNodes);
    const retained = new Set(nodes.map((node) => node.id));
    for (let index = edges.length - 1; index >= 0; index -= 1) {
        if (!retained.has(edges[index].source) || !retained.has(edges[index].target)) edges.splice(index, 1);
    }
    const edgeLimitTruncated = Math.max(0, edges.length - maxEdges);
    if (edges.length > maxEdges) edges.splice(maxEdges);
    const nodesTruncated = originalNodes - nodes.length;
    const edgesTruncated = originalEdges - edges.length;
    if (nodesTruncated > 0) diagnostics.push({
        severity: 'warning',
        code: 'limit.nodes',
        message: `Architecture graph reached the ${maxNodes}-node limit; ${nodesTruncated} nodes were omitted.`,
        location: null
    });
    if (edgeLimitTruncated > 0) diagnostics.push({
        severity: 'warning',
        code: 'limit.edges',
        message: `Architecture graph reached the ${maxEdges}-edge limit; ${edgesTruncated} edges were omitted.`,
        location: null
    });
    return { maxNodes, maxEdges, originalNodes, originalEdges, nodesTruncated, edgesTruncated };
}

function graphLimit(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function addExternalScheduleEdges(relations, nodes, addEdge, diagnostics, context = {}) {
    const behavior = nodes.filter((node) => ['rule', 'method'].includes(node.kind));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const relation of relations) {
        const sourceName = relation.from || relation.source;
        const targetName = relation.to || relation.target;
        const source = resolveScheduleEndpoint(sourceName, relation, behavior, nodeById, context);
        const target = resolveScheduleEndpoint(targetName, relation, behavior, nodeById, context);
        if (source.status !== 'exact' || target.status !== 'exact') {
            addScheduleResolutionDiagnostic(diagnostics, sourceName, source, relation);
            addScheduleResolutionDiagnostic(diagnostics, targetName, target, relation);
            continue;
        }
        addEdge(source.node.id, target.node.id, relation.kind, relation.kind.replace(/-/g, ' '), true, {
            mode: 'scheduling',
            origin: relation.origin || 'bsc',
            confidence: relation.confidence || 'authoritative',
            evidence: relation.evidence || `${sourceName} ${relation.kind} ${targetName}`,
            compilerLocation: relation.location || relation.compilerLocation || null,
            bidirectional: relation.bidirectional === true
        });
    }
}

function resolveScheduleEndpoint(reference, relation, behavior, nodeById, context) {
    const moduleName = relation.moduleName || relation.module || context.scheduleTopModule || null;
    if (moduleName) {
        const candidates = behavior.filter((node) => {
            const owner = nodeById.get(node.parentId);
            return (owner?.name === moduleName || owner?.sourceId === moduleName)
                && (!relation.packageName || node.packageName === relation.packageName)
                && normalizeCompilerName(node.name) === normalizeCompilerName(reference);
        });
        return resolutionFromCandidates(
            candidates,
            `No behavior named ${reference} exists in module ${moduleName}.`
        );
    }
    return resolveArchitectureSymbol(reference, {
        nodes: behavior,
        nodeById,
        packageName: relation.packageName || null,
        topModule: context.scheduleTopModule || null,
        kinds: ['rule', 'method'],
        normalizeName: normalizeCompilerName
    });
}

function resolutionFromCandidates(candidates, reason) {
    if (candidates.length === 1) return { status: 'exact', node: candidates[0], scope: 'module' };
    if (candidates.length > 1) {
        return {
            status: 'ambiguous',
            candidates: [...candidates].sort((left, right) => left.id.localeCompare(right.id))
        };
    }
    return { status: 'unresolved', reason };
}

function addScheduleResolutionDiagnostic(diagnostics, reference, resolution, relation) {
    if (resolution.status === 'exact') return;
    const compiler = relation.origin === 'bsc';
    diagnostics.push({
        severity: 'warning',
        code: compiler ? 'resolution.compiler' : 'resolution.scheduling',
        message: resolution.status === 'ambiguous'
            ? `${compiler ? 'Ambiguous compiler' : 'Ambiguous scheduling'} reference: ${reference}\nCandidates:\n${resolution.candidates.map((node) => `- ${node.id}`).join('\n')}`
            : `${compiler ? 'Compiler schedule' : 'Scheduling'} reference cannot be resolved: ${reference}. ${resolution.reason}`,
        location: relation.location || relation.sourceLocation || null
    });
}

function normalizeCompilerName(value) {
    return String(value || '').replace(/^RL_/, '');
}

function attachMemberBuckets(nodes, edges) {
    const specifications = [
        ['interfaces', false, (node) => node.kind === 'interface'],
        ['methods', true, (node) => node.kind === 'method'],
        ['rules', true, (node) => node.kind === 'rule'],
        ['localFunctions', true, (node) => node.kind === 'function'],
        ['state', true, (node) => node.primitive || ['register', 'fifo', 'wire', 'memory', 'vector'].includes(node.kind)],
        ['childInstances', false, (node) => node.kind === 'instance' && !node.primitive],
        ['types', false, (node) => ['type', 'enum', 'struct', 'union'].includes(node.kind)]
    ];
    for (const moduleNode of nodes.filter((node) => node.kind === 'module')) {
        const children = nodes.filter((node) => node.parentId === moduleNode.id);
        const implemented = edges
            .filter((edge) => edge.source === moduleNode.id && edge.kind === 'implements')
            .map((edge) => nodes.find((node) => node.id === edge.target))
            .filter(Boolean);
        const buckets = {};
        for (const [name, collapsed, predicate] of specifications) {
            const members = name === 'interfaces'
                ? uniqueNodes([...children.filter(predicate), ...implemented])
                : children.filter(predicate);
            buckets[name] = {
                totalCount: members.length,
                visibleCount: collapsed ? 0 : members.length,
                collapsed,
                memberNodeIds: members.map((node) => node.id).sort()
            };
        }
        moduleNode.memberBuckets = buckets;
    }
}

function uniqueNodes(nodes) {
    return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function attachScheduleRelations(nodes, edges) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const edge of edges.filter((item) => item.mode === 'scheduling')) {
        const relation = {
            edgeId: edge.id,
            kind: edge.kind,
            sourceId: edge.source,
            targetId: edge.target,
            origin: edge.origin,
            confidence: edge.confidence,
            evidence: edge.evidence
        };
        nodeById.get(edge.source)?.scheduleRelations.push(relation);
        if (edge.target !== edge.source) nodeById.get(edge.target)?.scheduleRelations.push(relation);
    }
}

function attachCompilerSupportingEvidence(edges) {
    const heuristics = edges.filter((edge) => edge.kind === 'potential-state-dependency');
    const supportingEdgeIds = new Set();
    for (const edge of edges.filter((item) => item.origin === 'bsc')) {
        const support = heuristics.filter((item) =>
            item.source === edge.source && item.target === edge.target
            || item.source === edge.target && item.target === edge.source
        );
        if (support.length > 0) {
            for (const item of support) supportingEdgeIds.add(item.id);
            edge.supportingEvidence = support.map((item) => ({
                kind: item.kind,
                origin: item.origin,
                confidence: item.confidence,
                evidence: item.evidence
            }));
        }
    }
    for (let index = edges.length - 1; index >= 0; index -= 1) {
        if (supportingEdgeIds.has(edges[index].id)) edges.splice(index, 1);
    }
}

function summarizeScheduling(edges, provider = null) {
    const schedulingEdges = edges.filter((edge) => edge.mode === 'scheduling');
    const origins = [...new Set(schedulingEdges.map((edge) => edge.origin))];
    const hasBsc = origins.includes('bsc') || provider === 'bsc';
    const hasAttribute = origins.includes('source-attribute');
    const hasHeuristic = origins.includes('source-heuristic');
    let badge = 'SOURCE-DERIVED';
    if (hasBsc && (hasAttribute || hasHeuristic)) badge = 'MIXED';
    else if (hasBsc) badge = 'BSC AUTHORITATIVE';
    else if (hasAttribute && hasHeuristic) badge = 'MIXED';
    else if (hasHeuristic) badge = 'HEURISTIC';
    return {
        provider: provider || (hasBsc ? 'bsc' : 'source'),
        badge,
        origins,
        relationCount: schedulingEdges.length,
        authoritative: hasBsc
    };
}

function addCallEdges(sourceNode, calls, file, functionNodesByName, nodes, nodeById, addEdge, diagnostics) {
    for (const call of calls || []) {
        if (call.builtin) continue;
        const target = resolveNamedTarget(
            call.name,
            file,
            functionNodesByName,
            nodes,
            nodeById,
            ['function']
        );
        if (target.status === 'exact' && target.node.id !== sourceNode.id) {
            addEdge(sourceNode.id, target.node.id, 'call', call.name, true, {
                mode: 'data-flow',
                origin: 'source-derived',
                confidence: 'explicit',
                evidence: `${sourceNode.name} calls ${call.name}`,
                sourceLocation: sourceNode.location
            });
        } else if (target.status === 'ambiguous') {
            addResolutionDiagnostic(diagnostics, call.name, target, sourceNode.location);
        }
    }
}

function addBehaviorAccessEdges(sourceNode, accesses, ownerId, file, childNodes, interfaceDefinitions, addEdge) {
    for (const access of accesses || []) {
        const target = childNodes.get(`${ownerId}:${access.instance}`);
        if (!target) continue;
        const metadata = {
            mode: 'data-flow',
            origin: 'source-derived',
            confidence: access.confidence || 'derived',
            evidence: access.sourceEvidence || access.evidence?.snippet || `${sourceNode.name} accesses ${access.instance}`,
            sourceLocation: access.location || sourceNode.location
        };

        if (access.dataFlow === 'write') {
            addEdge(sourceNode.id, target.id, 'write', access.operation || 'write', true, metadata);
            continue;
        }
        if (access.dataFlow === 'read') {
            addEdge(target.id, sourceNode.id, 'read', access.operation || 'read', true, metadata);
            continue;
        }
        if (['read', 'write'].includes(access.kind)) continue;

        const method = resolveInstanceMethod(target, access.member, file, interfaceDefinitions);
        const category = method?.category || (access.kind === 'return' ? 'action-value' : 'unknown');
        if (category === 'action') {
            addEdge(sourceNode.id, target.id, 'invoke', access.member || 'invoke', true, metadata);
        } else if (category === 'value') {
            addEdge(target.id, sourceNode.id, 'value', access.member || 'value', true, metadata);
        } else if (category === 'action-value') {
            addEdge(sourceNode.id, target.id, 'invoke', access.member || 'request', true, {
                ...metadata,
                evidence: `${metadata.evidence} [request]`
            });
            addEdge(target.id, sourceNode.id, 'return', access.member || 'result', true, {
                ...metadata,
                evidence: `${metadata.evidence} [result]`
            });
        } else {
            addEdge(sourceNode.id, target.id, 'access', access.member || 'unclassified access', true, {
                ...metadata,
                confidence: 'unknown'
            });
        }
    }
}

function addPotentialStateDependencies(ownerId, nodes, addEdge) {
    const behavior = nodes
        .filter((node) => node.parentId === ownerId && ['rule', 'method'].includes(node.kind))
        .sort((left, right) => left.id.localeCompare(right.id));
    for (let left = 0; left < behavior.length; left += 1) {
        for (let right = left + 1; right < behavior.length; right += 1) {
            const first = behavior[left];
            const second = behavior[right];
            const firstEffects = schedulingEffects(first);
            const secondEffects = schedulingEffects(second);
            const shared = intersect(
                firstEffects.map((effect) => effect.instance),
                secondEffects.map((effect) => effect.instance)
            );
            for (const stateName of shared) {
                const firstStateEffects = firstEffects.filter((effect) => effect.instance === stateName);
                const secondStateEffects = secondEffects.filter((effect) => effect.instance === stateName);
                if (!hasSchedulingMutation(firstStateEffects) && !hasSchedulingMutation(secondStateEffects)) continue;
                const ordered = orderEffectDependency(first, second, firstStateEffects, secondStateEffects);
                const evidence = dependencyEvidence(
                    ordered[0],
                    ordered[1],
                    stateName,
                    ordered[0] === first ? firstStateEffects : secondStateEffects,
                    ordered[1] === second ? secondStateEffects : firstStateEffects
                );
                addEdge(ordered[0].id, ordered[1].id, 'potential-state-dependency', stateName, true, {
                    mode: 'scheduling',
                    origin: 'source-heuristic',
                    confidence: 'potential',
                    evidence,
                    sourceLocation: ordered[0].location,
                    bidirectional: true
                });
            }
        }
    }
}

function schedulingEffects(node) {
    const effects = (node.details?.accesses || [])
        .filter((access) => access.instance && access.stateEffect)
        .map((access) => ({ instance: access.instance, effect: access.stateEffect }));
    if (effects.length > 0) return effects;
    return [
        ...(node.reads || []).map((instance) => ({ instance, effect: 'read' })),
        ...(node.writes || []).map((instance) => ({ instance, effect: 'write' }))
    ];
}

function hasSchedulingMutation(effects) {
    return effects.some(({ effect }) => !['read', 'observe'].includes(effect));
}

function orderEffectDependency(first, second, firstEffects, secondEffects) {
    if (hasSchedulingMutation(firstEffects) && !hasSchedulingMutation(secondEffects)) return [first, second];
    if (hasSchedulingMutation(secondEffects) && !hasSchedulingMutation(firstEffects)) return [second, first];
    return [first, second];
}

function dependencyEvidence(source, target, stateName, sourceEffects, targetEffects) {
    const sourceAction = effectVerb(sourceEffects);
    const targetAction = effectVerb(targetEffects);
    return `${source.name} ${sourceAction} ${stateName}; ${target.name} ${targetAction} ${stateName}`;
}

function effectVerb(effects) {
    const effect = effects.find((item) => !['read', 'observe'].includes(item.effect))?.effect
        || effects[0]?.effect
        || 'access';
    return {
        read: 'reads',
        observe: 'observes',
        write: 'writes',
        enqueue: 'enqueues',
        dequeue: 'dequeues',
        clear: 'clears'
    }[effect] || `${effect}s`;
}

function intersect(left, right) {
    const candidates = new Set(right);
    return [...new Set(left)].filter((value) => candidates.has(value));
}

function indexInterfaceDefinitions(parsedFiles) {
    const index = new Map();
    for (const file of parsedFiles) {
        for (const item of file.interfaces || []) {
            if (!index.has(item.name)) index.set(item.name, []);
            index.get(item.name).push({ file, item });
        }
    }
    return index;
}

function resolveInstanceMethod(instanceNode, memberName, sourceFile, index) {
    if (!memberName || instanceNode.primitive) return null;
    const typeName = /^[A-Za-z_$][\w$]*/.exec(instanceNode.details?.type || '')?.[0];
    if (!typeName) return null;
    const definition = resolveInterfaceDefinition(typeName, sourceFile, index);
    return definition?.item.methods?.find((method) => method.name === memberName) || null;
}

function resolveInterfaceDefinition(typeName, sourceFile, index) {
    if (!typeName) return null;
    const normalized = /^[A-Za-z_$][\w$]*/.exec(typeName)?.[0];
    const candidates = index.get(normalized) || [];
    const samePackage = candidates.find((candidate) => candidate.file.packageName === sourceFile.packageName);
    const imports = new Set((sourceFile.imports || []).map((entry) => entry.package));
    const imported = candidates.find((candidate) => imports.has(candidate.file.packageName));
    return samePackage || imported || (candidates.length === 1 ? candidates[0] : null);
}

function decorateMethodPort(method, interfaceName, typeDefinitions) {
    const parameters = (method.parameters || []).map((parameter) => ({
        ...parameter,
        width: analyzeTypeWidth(parameter.type, typeDefinitions)
    }));
    const resultType = method.resultType || (method.category === 'value' ? method.returnType : null);
    return {
        ...(method.port || {}),
        name: method.name,
        interface: interfaceName || method.port?.interface || null,
        category: method.category || 'unknown',
        direction: method.direction || 'unknown',
        parameters,
        returnType: method.returnType,
        resultType,
        resultWidth: resultType
            ? analyzeTypeWidth(resultType, typeDefinitions)
            : unresolvedWidth('method has no value result'),
        guarded: Boolean(method.guard),
        guard: method.guard || null,
        declarationSource: method.location
    };
}

function storageDataType(type, primitiveKind) {
    if (!primitiveKind || typeof type !== 'string') return null;
    const application = /^([A-Za-z_$][\w$]*)\s*#\s*\(/.exec(type);
    if (!application) return primitiveKind === 'register' && type === 'Bool' ? 'Bool' : null;
    const open = type.indexOf('(', application[0].indexOf('#'));
    const close = findMatchingDelimiter(type, open, '(', ')');
    if (close < 0) return null;
    const argumentsList = splitTopLevel(type.slice(open + 1, close), ',').map(normalizeWhitespace);
    if (primitiveKind === 'memory' && argumentsList.length > 1) return argumentsList.at(-1);
    return argumentsList[0] || null;
}

function unresolvedWidth(reason) {
    return { bits: null, status: 'unresolved', reason };
}

function resolveNamedTarget(name, sourceFile, _index, nodes, nodeById, kinds) {
    return resolveArchitectureSymbol(name, {
        nodes,
        nodeById,
        packageName: sourceFile.packageName,
        importedPackages: (sourceFile.imports || []).map((entry) => entry.package),
        kinds
    });
}

function resolveNodeReference(reference, nodes, nodeById, options = {}) {
    return resolveArchitectureSymbol(reference, { nodes, nodeById, ...options });
}

function addResolutionDiagnostic(diagnostics, reference, resolution, location, prefix = '') {
    if (resolution.status === 'exact') return;
    const label = prefix ? `${prefix} ` : '';
    diagnostics.push({
        severity: 'warning',
        code: resolution.status === 'ambiguous'
            ? 'resolution.ambiguous'
            : 'resolution.unresolved',
        message: resolution.status === 'ambiguous'
            ? `${label}Ambiguous reference: ${reference}\nCandidates:\n${resolution.candidates.map((node) => `- ${node.id}`).join('\n')}`
            : `${label}Unresolved reference: ${reference}. ${resolution.reason}`,
        location
    });
}

function createEdgeAdder(edges) {
    const keys = new Set();
    return (source, target, kind, label = '', inferred = true, extras = {}) => {
        if (!source || !target || source === target && kind === 'contains') return null;
        const evidence = extras.evidence || label || `${kind}:${source}:${target}`;
        const key = `${source}|${target}|${kind}|${stableValue(evidence)}`;
        if (keys.has(key)) return null;
        keys.add(key);
        const edge = {
            id: `edge:${edges.length}:${source}->${target}`,
            source,
            target,
            kind,
            label,
            mode: extras.mode || modeForEdgeKind(kind),
            origin: extras.origin || (inferred ? 'source-derived' : 'config'),
            confidence: extras.confidence || (inferred ? 'derived' : 'explicit'),
            evidence,
            sourceLocation: extras.sourceLocation || null,
            compilerLocation: extras.compilerLocation || null,
            bidirectional: extras.bidirectional === true,
            inferred,
            ...extras
        };
        edges.push(edge);
        return edge;
    };
}

function modeForEdgeKind(kind) {
    if (['read', 'write', 'invoke', 'return', 'value', 'producer', 'consumer', 'data', 'access', 'call'].includes(kind)) {
        return 'data-flow';
    }
    if ([
        'conflict', 'conflict-free', 'sequential-before', 'sequential-before-reverse',
        'mutually-exclusive', 'descending-urgency', 'execution-order', 'preempts',
        'potential-state-dependency'
    ].includes(kind)) return 'scheduling';
    return 'structure';
}

function stableValue(value) {
    if (value === null || typeof value !== 'object') return String(value);
    if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${key}:${stableValue(value[key])}`).join(',')}}`;
}

function memberGroupFor(node) {
    if (!node.parentId) return null;
    if (node.kind === 'method') return 'methods';
    if (node.kind === 'rule') return 'rules';
    if (node.kind === 'function') return 'local-functions';
    if (['register', 'fifo', 'wire', 'memory', 'vector'].includes(node.kind) || node.primitive) return 'state';
    if (node.kind === 'instance') return 'child-instances';
    if (['type', 'enum', 'struct', 'union'].includes(node.kind)) return 'types';
    if (node.kind === 'interface') return 'interfaces';
    return null;
}

function computeRoots(nodes, edges, configuredEntrypoints) {
    const moduleIds = new Set(nodes.filter((node) => node.kind === 'module' && !node.hidden).map((node) => node.id));
    const instantiated = new Set(edges.filter((edge) => edge.kind === 'instantiate').map((edge) => edge.target));
    const roots = nodes
        .filter((node) => moduleIds.has(node.id) && (!instantiated.has(node.id) || node.entry || configuredEntrypoints.includes(node.name)))
        .map((node) => node.id);
    return roots.length > 0 ? roots : [...moduleIds];
}

function buildGroups(nodes, config) {
    const configured = new Map(config.groups.map((group) => [group.id, group]));
    const ids = unique(nodes.filter((node) => !node.hidden).map((node) => node.group || 'root'));
    return ids.map((id, index) => {
        const group = configured.get(id);
        return {
            id,
            label: group?.label || titleCase(id),
            description: group?.description || '',
            order: group?.order ?? (1000 + index)
        };
    }).sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
}

function countKinds(nodes, edges) {
    const kinds = {};
    for (const node of nodes) kinds[node.kind] = (kinds[node.kind] || 0) + 1;
    return {
        files: unique(nodes.map((node) => node.relativePath).filter(Boolean)).length,
        nodes: nodes.length,
        edges: edges.length,
        kinds
    };
}

function indexByName(index, name, node) {
    if (!index.has(name)) index.set(name, []);
    index.get(name).push(node);
}

function unique(values) {
    return [...new Set(values)];
}

function titleCase(value) {
    return String(value || 'root')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function packageNodeId(packageName) {
    return `package:${packageName}`;
}

function moduleNodeId(packageName, moduleName) {
    return `module:${packageName}.${moduleName}`;
}

function interfaceNodeId(packageName, interfaceName) {
    return `interface:${packageName}.${interfaceName}`;
}

function typeNodeId(packageName, typeName, parentModuleName = null) {
    return `type:${packageName}.${parentModuleName ? `${parentModuleName}.` : ''}${typeName}`;
}

function functionNodeId(packageName, functionName, parentModuleName, line) {
    return `function:${packageName}.${parentModuleName ? `${parentModuleName}.` : ''}${functionName}:${line + 1}`;
}

function instanceNodeId(ownerId, instanceName, line) {
    return `instance:${ownerId}:${instanceName}:${line + 1}`;
}

function memberNodeId(kind, ownerId, name, line) {
    return `${kind}:${ownerId}:${name}:${line + 1}`;
}

module.exports = {
    buildArchitectureModel,
    functionNodeId,
    interfaceNodeId,
    moduleNodeId,
    packageNodeId,
    resolveNodeReference,
    modeForEdgeKind
};
