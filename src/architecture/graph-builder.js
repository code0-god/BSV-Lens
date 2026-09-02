'use strict';

const { applyNodeConfiguration, groupForPath } = require('./config');

function buildArchitectureModel(parsedFiles, config, context = {}) {
    const nodes = [];
    const edges = [];
    const diagnostics = parsedFiles.flatMap((file) => file.diagnostics || []);
    const nodeById = new Map();
    const packageNodes = new Map();
    const moduleNodesByName = new Map();
    const interfaceNodesByName = new Map();
    const functionNodesByName = new Map();
    const fileByPackage = new Map();
    const childNodeByOwnerAndName = new Map();

    const addNode = (rawNode) => {
        if (nodeById.has(rawNode.id)) {
            diagnostics.push({
                severity: 'warning',
                message: `Duplicate architecture node id: ${rawNode.id}`,
                location: rawNode.location || null
            });
            return nodeById.get(rawNode.id);
        }
        const node = applyNodeConfiguration(rawNode, config);
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
            const node = addNode({
                id,
                sourceId: item.name,
                name: item.name,
                label: item.name,
                kind: 'interface',
                packageName: file.packageName,
                relativePath: file.relativePath,
                location: item.location,
                annotations: item.annotations,
                group: groupForPath(config, file.relativePath),
                description: '',
                signature: item.signature,
                parentId: packageId,
                details: {
                    methods: item.methods,
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
                annotations: item.annotations,
                group: groupForPath(config, file.relativePath),
                description: '',
                signature: item.signature,
                parentId,
                details: item.details
            });
        }

        for (const item of file.modules) {
            const id = moduleNodeId(file.packageName, item.name);
            const node = addNode({
                id,
                sourceId: item.name,
                name: item.name,
                label: item.name,
                kind: 'module',
                packageName: file.packageName,
                relativePath: file.relativePath,
                location: item.location,
                annotations: item.annotations,
                group: groupForPath(config, file.relativePath),
                description: item.summary,
                signature: item.signature,
                parentId: packageId,
                details: {
                    returnInterface: item.returnInterface,
                    instanceCount: item.instances.length,
                    ruleCount: item.rules.length,
                    methodCount: item.methods.length,
                    localFunctions: item.localFunctions,
                    providedInterfaces: item.providedInterfaces
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
                const node = addNode({
                    id,
                    sourceId: instance.name,
                    name: instance.name,
                    label: instance.name,
                    kind,
                    packageName: file.packageName,
                    relativePath: file.relativePath,
                    location: instance.location,
                    annotations: {},
                    group: ownerNode.group,
                    description: '',
                    signature: instance.signature,
                    parentId: ownerId,
                    primitive: Boolean(instance.primitiveKind),
                    details: {
                        type: instance.type,
                        constructor: instance.constructor,
                        primitiveKind: instance.primitiveKind,
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
                    annotations: {},
                    group: ownerNode.group,
                    description: rule.guard ? `Guard: ${rule.guard}` : '',
                    signature: rule.signature,
                    parentId: ownerId,
                    details: {
                        guard: rule.guard,
                        calls: rule.calls,
                        references: rule.references
                    }
                });
                addEdge(ownerId, id, 'contains', 'rule', true);
                for (const reference of rule.references) {
                    const target = childNodeByOwnerAndName.get(`${ownerId}:${reference}`);
                    if (target) addEdge(id, target.id, 'access', '', true);
                }
                addCallEdges(node, rule.calls, file, functionNodesByName, addEdge);
            }

            for (const method of module.methods) {
                const id = memberNodeId('method', ownerId, method.name, method.location.line);
                const node = addNode({
                    id,
                    sourceId: method.name,
                    name: method.name,
                    label: method.name,
                    kind: 'method',
                    packageName: file.packageName,
                    relativePath: file.relativePath,
                    location: method.location,
                    annotations: {},
                    group: ownerNode.group,
                    description: '',
                    signature: method.signature,
                    parentId: ownerId,
                    details: {
                        returnType: method.returnType,
                        parameters: method.parameters,
                        inline: method.inline,
                        calls: method.calls,
                        references: method.references
                    }
                });
                addEdge(ownerId, id, 'contains', 'method', true);
                for (const reference of method.references) {
                    const target = childNodeByOwnerAndName.get(`${ownerId}:${reference}`);
                    if (target) addEdge(id, target.id, 'access', '', true);
                }
                addCallEdges(node, method.calls, file, functionNodesByName, addEdge);
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
                const interfaceTarget = resolveNamedTarget(
                    module.returnInterface,
                    file,
                    interfaceNodesByName,
                    packageNodes
                );
                if (interfaceTarget) addEdge(sourceId, interfaceTarget.id, 'implements', '', true);
            }

            for (const instance of module.instances) {
                if (instance.primitiveKind) continue;
                const instanceId = instanceNodeId(sourceId, instance.name, instance.location.line);
                const instanceNode = nodeById.get(instanceId);
                const target = resolveNamedTarget(instance.constructor, file, moduleNodesByName, packageNodes);
                if (target) {
                    instanceNode.details.targetId = target.id;
                    instanceNode.details.targetName = target.name;
                    addEdge(sourceId, target.id, 'instantiate', instance.name, true);
                } else {
                    instanceNode.details.targetName = instance.constructor;
                    instanceNode.details.unresolved = true;
                }
            }
        }

        for (const fn of file.functions) {
            const sourceId = functionNodeId(file.packageName, fn.name, fn.parentModuleName, fn.location.line);
            const sourceNode = nodeById.get(sourceId);
            if (sourceNode) addCallEdges(sourceNode, fn.calls, file, functionNodesByName, addEdge);
        }
    }

    for (const virtualNode of config.virtualNodes) addNode(virtualNode);
    for (const manualEdge of config.edges) {
        const source = resolveNodeReference(manualEdge.from, nodes, nodeById);
        const target = resolveNodeReference(manualEdge.to, nodes, nodeById);
        if (source && target) {
            addEdge(source.id, target.id, manualEdge.kind, manualEdge.label, false, {
                description: manualEdge.description,
                manual: true
            });
        } else {
            diagnostics.push({
                severity: 'warning',
                message: `Manual edge cannot be resolved: ${manualEdge.from} -> ${manualEdge.to}`,
                location: null
            });
        }
    }

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

    return {
        schemaVersion: 1,
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
        diagnostics,
        stats
    };
}

function addCallEdges(sourceNode, calls, file, functionNodesByName, addEdge) {
    for (const call of calls || []) {
        if (call.builtin) continue;
        const target = resolveNamedTarget(call.name, file, functionNodesByName);
        if (target && target.id !== sourceNode.id) addEdge(sourceNode.id, target.id, 'call', '', true);
    }
}

function resolveNamedTarget(name, sourceFile, index, packageNodes = null) {
    const candidates = index.get(name) || [];
    if (candidates.length === 0) return null;
    const samePackage = candidates.find((node) => node.packageName === sourceFile.packageName);
    if (samePackage) return samePackage;
    const importedNames = new Set((sourceFile.imports || []).map((entry) => entry.package));
    const imported = candidates.find((node) => importedNames.has(node.packageName));
    if (imported) return imported;
    if (candidates.length === 1) return candidates[0];
    if (packageNodes) {
        const packageCandidate = candidates.find((node) => packageNodes.has(node.packageName));
        if (packageCandidate) return packageCandidate;
    }
    return candidates[0];
}

function resolveNodeReference(reference, nodes, nodeById) {
    if (nodeById.has(reference)) return nodeById.get(reference);
    if (nodeById.has(`virtual:${reference}`)) return nodeById.get(`virtual:${reference}`);
    const exact = nodes.filter((node) => node.name === reference || node.sourceId === reference);
    if (exact.length === 1) return exact[0];
    const module = exact.find((node) => node.kind === 'module');
    if (module) return module;
    const packageNode = exact.find((node) => node.kind === 'package');
    return packageNode || exact[0] || null;
}

function createEdgeAdder(edges) {
    const keys = new Set();
    return (source, target, kind, label = '', inferred = true, extras = {}) => {
        if (!source || !target || source === target && kind === 'contains') return null;
        const key = `${source}|${target}|${kind}|${label}`;
        if (keys.has(key)) return null;
        keys.add(key);
        const edge = {
            id: `edge:${edges.length}:${source}->${target}`,
            source,
            target,
            kind,
            label,
            inferred,
            ...extras
        };
        edges.push(edge);
        return edge;
    };
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
    resolveNodeReference
};
