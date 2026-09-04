'use strict';

function buildSemanticScheduleRelations(relations, stateBehaviors, instances, options = {}) {
    const projected = [];
    const diagnostics = [];
    const maxRelations = Number.isInteger(options.maxRelations) && options.maxRelations > 0
        ? options.maxRelations : 25000;
    const behaviorByInstance = groupBy(stateBehaviors, (item) => item.ownerInstanceId);
    const sortedInstances = instances
        .filter((instance) => instance.targetDefinitionId)
        .slice()
        .sort((left, right) => left.path.localeCompare(right.path));

    for (const relation of relations || []) {
        const matchingInstances = sortedInstances.filter((instance) =>
            matchesModule(instance.targetDefinitionId, relation)
        );
        let matched = 0;
        for (const instance of matchingInstances) {
            const behaviors = behaviorByInstance.get(instance.id) || [];
            const source = uniqueBehavior(behaviors, relation.from || relation.source);
            const target = uniqueBehavior(behaviors, relation.to || relation.target);
            if (!source || !target) continue;
            matched += 1;
            const definitionRelationId = [
                'schedule-definition',
                relation.origin || 'source-derived',
                instance.targetDefinitionId,
                relation.kind,
                source.name,
                target.name
            ].join(':');
            projected.push({
                id: `${definitionRelationId}:${instance.id}`,
                definitionRelationId,
                kind: relation.kind,
                instanceContextId: instance.id,
                instancePath: instance.path,
                sourceBehaviorId: source.id,
                targetBehaviorId: target.id,
                bidirectional: relation.bidirectional === true,
                origin: relation.origin || 'source-derived',
                confidence: relation.confidence || 'source-derived',
                analysisOrigin: relation.origin === 'bsc'
                    ? 'Compiler-authoritative'
                    : 'Source-derived',
                contextualProjection: true,
                evidence: relation.evidence || '',
                location: relation.location || relation.sourceLocation || null,
                supportingRelationIds: []
            });
        }
        if (matched === 0) diagnostics.push({
            code: 'scheduling.unresolved',
            severity: 'info',
            message: `Scheduling relation ${relation.from || relation.source} ${relation.kind} ${relation.to || relation.target} has no exact instance context.`,
            location: relation.location || relation.sourceLocation || null,
            analysisOrigin: relation.origin === 'bsc'
                ? 'Compiler-authoritative'
                : 'Source-derived'
        });
    }
    const explicitTruncated = projected.length > maxRelations;
    if (explicitTruncated) projected.splice(maxRelations);
    const truncated = explicitTruncated || (
        options.includePotentialDependencies !== false
        && addPotentialRelations(projected, stateBehaviors, instances, maxRelations)
    );
    if (truncated) {
        diagnostics.push({
            code: 'scheduling.limit',
            severity: 'warning',
            message: `Semantic scheduling reached the ${maxRelations}-relation limit.`,
            location: null,
            analysisOrigin: 'Source-derived'
        });
    }
    return { relations: projected, diagnostics };
}

function addPotentialRelations(projected, stateBehaviors, instances, maxRelations) {
    const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
    const relationByPair = new Map(projected.map((relation) => [
        pairKey(
            relation.instanceContextId,
            relation.sourceBehaviorId,
            relation.targetBehaviorId
        ),
        relation
    ]));
    for (const [instanceId, behaviors] of groupBy(
        stateBehaviors,
        (behavior) => behavior.ownerInstanceId
    )) {
        const instance = instanceById.get(instanceId);
        const ordered = behaviors.slice().sort((left, right) => left.id.localeCompare(right.id));
        const candidates = potentialCandidates(ordered, instanceId);
        for (const { source, target, states } of candidates) {
            const definitionRelationId = [
                'schedule-definition',
                'source-heuristic',
                instance?.targetDefinitionId || instanceId,
                'potential-state-dependency',
                source.name,
                target.name
            ].join(':');
            const relationId = `${definitionRelationId}:${instanceId}`;
            const key = pairKey(instanceId, source.id, target.id);
            const stronger = relationByPair.get(key);
            if (stronger) {
                stronger.supportingRelationIds.push(relationId);
                continue;
            }
            if (projected.length >= maxRelations) return true;
            const relation = {
                id: relationId,
                definitionRelationId,
                kind: 'potential-state-dependency',
                instanceContextId: instanceId,
                instancePath: instance?.path || '',
                sourceBehaviorId: source.id,
                targetBehaviorId: target.id,
                bidirectional: true,
                origin: 'source-heuristic',
                confidence: 'potential',
                analysisOrigin: 'Source-derived',
                contextualProjection: true,
                evidence: `Shared state: ${states.join(', ')}`,
                location: source.location || target.location || null,
                supportingRelationIds: []
            };
            projected.push(relation);
            relationByPair.set(key, relation);
        }
    }
    return false;
}

function potentialCandidates(behaviors, instanceId) {
    const byState = new Map();
    for (const behavior of behaviors) {
        const writes = new Set(behavior.writes || []);
        for (const state of new Set([...(behavior.reads || []), ...writes])) {
            if (!byState.has(state)) byState.set(state, []);
            byState.get(state).push({ behavior, writes: writes.has(state) });
        }
    }
    const candidates = new Map();
    for (const [state, entries] of byState) {
        for (let left = 0; left < entries.length; left += 1) {
            for (let right = left + 1; right < entries.length; right += 1) {
                if (!entries[left].writes && !entries[right].writes) continue;
                const source = entries[left].behavior;
                const target = entries[right].behavior;
                const key = pairKey(instanceId, source.id, target.id);
                if (!candidates.has(key)) candidates.set(key, { source, target, states: [] });
                candidates.get(key).states.push(state);
            }
        }
    }
    return [...candidates.values()]
        .map((candidate) => ({ ...candidate, states: [...new Set(candidate.states)].sort() }))
        .sort((left, right) => pairKey(instanceId, left.source.id, left.target.id)
            .localeCompare(pairKey(instanceId, right.source.id, right.target.id)));
}

function pairKey(instanceId, sourceId, targetId) {
    return `${instanceId}\u0000${[sourceId, targetId].sort().join('\u0000')}`;
}

function matchesModule(definitionId, relation) {
    const suffix = `:${relation.moduleName || ''}`;
    if (relation.moduleName && !definitionId.endsWith(suffix)) return false;
    if (!relation.packageName) return true;
    return definitionId.startsWith(`def:${relation.packageName}:`);
}

function uniqueBehavior(behaviors, name) {
    const matches = behaviors.filter((behavior) => behavior.name === name);
    return matches.length === 1 ? matches[0] : null;
}

function groupBy(items, key) {
    const result = new Map();
    for (const item of items) {
        const value = key(item);
        result.set(value, [...(result.get(value) || []), item]);
    }
    return result;
}

module.exports = {
    buildSemanticScheduleRelations
};
