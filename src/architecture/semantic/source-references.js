'use strict';

const { behaviorDefinitionId } = require('./ids');

function buildSourceReferenceIndex(model = {}) {
    const nodes = model.nodes || [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const instances = model.instances || [];
    const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
    const behaviors = model.stateBehaviors || [];
    const endpoints = model.endpoints || [];
    const channelByEndpoint = new Map();
    for (const channel of model.protocolChannels || []) {
        for (const endpointId of Object.values(channel.methods || {})) {
            if (!channelByEndpoint.has(endpointId)) channelByEndpoint.set(endpointId, channel.id);
        }
    }
    const references = [];

    for (const definition of model.definitions || []) {
        addReference(references, {
            id: definition.id,
            kind: 'definition',
            name: definition.name,
            definitionId: definition.id,
            location: definition.location,
            sourceRange: definition.sourceRange,
            presentations: definitionPresentations(definition, instances, nodes, nodeById)
        });
        if (definition.kind === 'module-definition') {
            addModuleMembers(
                references, definition, instances, instanceById, behaviors,
                endpoints, nodes, nodeById, channelByEndpoint
            );
        } else if (definition.kind === 'interface-definition') {
            addInterfaceMethods(references, definition, endpoints, nodeById, channelByEndpoint);
        }
    }

    for (const [kind, entities] of [
        ['statement', model.statements],
        ['expression', model.expressions],
        ['call-site', model.callSites]
    ]) for (const entity of entities || []) addReference(references, {
        id: entity.id,
        kind,
        name: entity.name || entity.calleeName || entity.kind || entity.relativePath || entity.id,
        definitionId: entity.enclosingCallableId || entity.id,
        location: entity.location || entity.sourceRange,
        sourceRange: entity.sourceRange,
        presentations: []
    });

    const byUri = new Map();
    for (const reference of references) {
        const uri = ownershipRange(reference)?.uri;
        if (!uri) continue;
        if (!byUri.has(uri)) byUri.set(uri, []);
        byUri.get(uri).push(reference);
    }
    return {
        references,
        byUri,
        ...buildCrossReferences(model, references),
        sourceRangeKey
    };
}

function findSourceReferenceAtPosition(index, position = {}) {
    if (!index || !position.uri || !Number.isInteger(position.line) || !Number.isInteger(position.column)) {
        return unresolved();
    }
    const candidates = (index.byUri.get(position.uri) || []).filter((reference) =>
        positionInRange(position.line, position.column, ownershipRange(reference))
    );
    if (candidates.length === 0) return unresolved();
    const minimum = Math.min(...candidates.map((reference) => rangeWeight(ownershipRange(reference))));
    const references = candidates
        .filter((reference) => rangeWeight(ownershipRange(reference)) === minimum)
        .sort((left, right) => left.id.localeCompare(right.id));
    return {
        status: references.length === 1 ? 'exact' : 'multiple',
        references
    };
}

function addModuleMembers(
    references,
    definition,
    instances,
    instanceById,
    behaviors,
    endpoints,
    nodes,
    nodeById,
    channelByEndpoint
) {
    const duplicateCount = new Map();
    for (const [kind, callables] of [['rule', definition.rules], ['method', definition.methods]]) {
        for (const callable of callables || []) {
            const path = [...(callable.interfacePath || []), callable.name].join('.');
            const key = `${kind}\u0000${path}`;
            const ordinal = duplicateCount.get(key) || 0;
            duplicateCount.set(key, ordinal + 1);
            const definitionId = behaviorDefinitionId(definition.id, kind, path, ordinal);
            const semantic = [];
            for (const behavior of behaviors.filter((item) => item.definitionId === definitionId)) {
                addPresentation(semantic, nodeById, behavior.id, 'behavior', behavior.ownerInstanceId);
            }
            if (kind === 'method') {
                for (const endpoint of endpoints.filter((item) => item.implementationMethodId === definitionId)) {
                    addEndpointPresentation(semantic, endpoint, nodeById, channelByEndpoint);
                }
            }
            for (const node of nodes.filter((item) =>
                !item.semanticId
                && item.kind === kind
                && item.name === callable.name
                && sameLocation(item.location, callable.location)
            )) addPresentation(semantic, nodeById, node.id, 'definition', null);
            addReference(references, {
                id: definitionId,
                kind: kind === 'method' ? 'implementation-method' : 'rule',
                name: callable.name,
                definitionId,
                location: callable.location,
                sourceRange: callable.sourceRange,
                presentations: semantic
            });
        }
    }

    const declarationCount = new Map();
    for (const declaration of definition.childInstanceDeclarations || []) {
        const declarationKind = declaration.primitiveKind ? 'state-declaration' : 'instance-declaration';
        const key = `${declarationKind}\u0000${declaration.name}`;
        const ordinal = declarationCount.get(key) || 0;
        declarationCount.set(key, ordinal + 1);
        const id = `${definition.id}.${declarationKind}.${declaration.name}${ordinal ? `~${ordinal}` : ''}`;
        const presentations = [];
        for (const occurrence of instances.filter((item) => {
            if (item.root || item.name !== declaration.name || !sameLocation(item.location, declaration.location)) return false;
            return instanceById.get(item.parentInstanceId)?.targetDefinitionId === definition.id;
        })) addPresentation(presentations, nodeById, occurrence.id, 'occurrence', occurrence.parentInstanceId);
        for (const node of nodes.filter((item) =>
            !item.semanticId
            && item.name === declaration.name
            && sameLocation(item.location, declaration.location)
        )) addPresentation(presentations, nodeById, node.id, 'definition', node.parentId);
        addReference(references, {
            id,
            kind: declarationKind,
            name: declaration.name,
            definitionId: id,
            parentDefinitionId: definition.id,
            location: declaration.location,
            sourceRange: declaration.sourceRange,
            presentations
        });
    }
}

function addInterfaceMethods(references, definition, endpoints, nodeById, channelByEndpoint) {
    const duplicateCount = new Map();
    for (const method of definition.methods || []) {
        const ordinal = duplicateCount.get(method.name) || 0;
        duplicateCount.set(method.name, ordinal + 1);
        const id = `${definition.id}.interface-method.${method.name}${ordinal ? `~${ordinal}` : ''}`;
        const presentations = [];
        for (const endpoint of endpoints.filter((item) =>
            item.kind === 'method-endpoint'
            && item.interfaceDefinitionId === definition.id
            && item.name === method.name
            && sameLocation(item.location, method.location)
        )) addEndpointPresentation(presentations, endpoint, nodeById, channelByEndpoint);
        addReference(references, {
            id,
            kind: 'interface-method',
            interfaceDefinitionId: definition.id,
            name: method.name,
            definitionId: id,
            location: method.location,
            sourceRange: method.sourceRange,
            presentations
        });
    }
}

function definitionPresentations(definition, instances, nodes, nodeById) {
    const presentations = [];
    const legacyId = legacyDefinitionId(definition);
    if (legacyId) addPresentation(presentations, nodeById, legacyId, 'definition', nodeById.get(legacyId)?.parentId);
    for (const occurrence of instances.filter((item) => item.targetDefinitionId === definition.id)) {
        addPresentation(presentations, nodeById, occurrence.id, 'occurrence', occurrence.parentInstanceId);
    }
    if (!legacyId) {
        for (const node of nodes.filter((item) =>
            !item.semanticId
            && item.name === definition.name
            && sameLocation(item.location, definition.location)
        )) addPresentation(presentations, nodeById, node.id, 'definition', node.parentId);
    }
    return presentations;
}

function legacyDefinitionId(definition) {
    if (definition.kind === 'package-definition') return `package:${definition.packageName}`;
    if (definition.kind === 'module-definition') return `module:${definition.packageName}.${definition.name}`;
    if (definition.kind === 'interface-definition') return `interface:${definition.packageName}.${definition.name}`;
    if (definition.kind === 'type-definition') {
        return `type:${definition.packageName}.${definition.ownerDefinitionId ? `${ownerName(definition.ownerDefinitionId)}.` : ''}${definition.name}`;
    }
    return null;
}

function ownerName(definitionId) {
    return String(definitionId || '').split(':').at(-1);
}

function addReference(references, reference) {
    const range = ownershipRange(reference);
    if (!range?.uri) return;
    references.push({
        ...reference,
        presentations: uniquePresentations(reference.presentations || [])
    });
}

function addPresentation(result, nodeById, id, role, ownerId) {
    const node = nodeById.get(id);
    if (!node) return;
    result.push({
        id,
        role,
        ownerId: ownerId || null,
        parentId: node.parentId || null
    });
}

function addEndpointPresentation(result, endpoint, nodeById, channelByEndpoint) {
    if (nodeById.has(endpoint.id)) {
        addPresentation(result, nodeById, endpoint.id, 'endpoint', endpoint.ownerInstanceId);
        return;
    }
    const channelId = channelByEndpoint.get(endpoint.id);
    if (channelId) addPresentation(result, nodeById, channelId, 'endpoint', endpoint.ownerInstanceId);
}

function buildCrossReferences(model, references) {
    const occurrenceIdsByDefinitionId = groupedIds(
        model.instances || [], (item) => item.targetDefinitionId, (item) => item.id
    );
    const occurrenceIdsByInstanceDeclarationId = new Map();
    const endpointIdsByImplementationMethodId = groupedIds(
        (model.endpoints || []).filter((item) => item.implementationMethodId),
        (item) => item.implementationMethodId,
        (item) => item.id
    );
    const endpointIdsByInterfaceMethodId = new Map();
    const presentationNodeIdsBySemanticId = new Map();
    const semanticIdsBySourceRange = new Map();

    for (const reference of references) {
        if (reference.kind === 'instance-declaration') {
            const ids = (model.instances || []).filter((instance) =>
                !instance.root
                && instance.name === reference.name
                && sameLocation(instance.location, reference.location)
                && (model.instances || []).some((parent) =>
                    parent.id === instance.parentInstanceId
                    && parent.targetDefinitionId === reference.parentDefinitionId
                )
            ).map((item) => item.id);
            setSorted(occurrenceIdsByInstanceDeclarationId, reference.id, ids);
        }
        if (reference.kind === 'interface-method') {
            const ids = (model.endpoints || []).filter((endpoint) =>
                endpoint.kind === 'method-endpoint'
                && endpoint.interfaceDefinitionId === reference.interfaceDefinitionId
                && endpoint.name === reference.name
                && sameLocation(endpoint.location, reference.location)
            ).map((item) => item.id);
            setSorted(endpointIdsByInterfaceMethodId, reference.id, ids);
        }
        setSorted(
            presentationNodeIdsBySemanticId,
            reference.id,
            reference.presentations.map((item) => item.id)
        );
        const key = sourceRangeKey(ownershipRange(reference));
        if (key) appendSorted(semanticIdsBySourceRange, key, reference.id);
    }
    for (const node of model.nodes || []) {
        if (node.semanticId) appendSorted(presentationNodeIdsBySemanticId, node.semanticId, node.id);
    }
    return {
        occurrenceIdsByDefinitionId,
        occurrenceIdsByInstanceDeclarationId,
        endpointIdsByImplementationMethodId,
        endpointIdsByInterfaceMethodId,
        presentationNodeIdsBySemanticId,
        semanticIdsBySourceRange
    };
}

function groupedIds(items, key, value) {
    const result = new Map();
    for (const item of items) appendSorted(result, key(item), value(item));
    return result;
}
function setSorted(map, key, values) {
    map.set(key, [...new Set(values)].sort());
}
function appendSorted(map, key, value) {
    if (!key || !value) return;
    setSorted(map, key, [...(map.get(key) || []), value]);
}
function sourceRangeKey(range) {
    if (!range?.uri) return null;
    return [range.uri, range.line, range.column || 0,
        range.endLine ?? range.line, range.endColumn ?? (range.column || 0) + 1].join(':');
}

function uniquePresentations(items) {
    const byId = new Map();
    for (const item of items) {
        const previous = byId.get(item.id);
        if (!previous || rolePriority(item.role) < rolePriority(previous.role)) byId.set(item.id, item);
    }
    return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function rolePriority(role) {
    return { endpoint: 0, behavior: 1, occurrence: 2, definition: 3 }[role] ?? 9;
}

function ownershipRange(reference) {
    return reference?.sourceRange || reference?.location || null;
}

function sameLocation(left, right) {
    return Boolean(left && right
        && left.uri === right.uri
        && left.line === right.line
        && (left.column || 0) === (right.column || 0));
}

function positionInRange(line, column, range) {
    if (!range) return false;
    const afterStart = line > range.line || line === range.line && column >= (range.column || 0);
    const endLine = Number.isInteger(range.endLine) ? range.endLine : range.line;
    const endColumn = Number.isInteger(range.endColumn) ? range.endColumn : (range.column || 0) + 1;
    return afterStart && (line < endLine || line === endLine && column < endColumn);
}

function rangeWeight(range) {
    const lines = Math.max(0, (range.endLine ?? range.line) - range.line);
    const columns = lines === 0
        ? Math.max(0, (range.endColumn ?? range.column) - range.column)
        : Math.max(0, range.endColumn || 0);
    return lines * 1000000 + columns;
}

function unresolved() {
    return { status: 'unresolved', references: [] };
}

module.exports = {
    buildSourceReferenceIndex,
    findSourceReferenceAtPosition
};
