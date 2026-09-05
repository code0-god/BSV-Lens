'use strict';

const { behaviorAccessBindingId } = require('./ids');

const SOURCE_ORIGIN = 'Source-derived';

function buildBehaviorBindings(stateBehaviors, callableByBehaviorId, instances, endpoints, structuralBindings = []) {
    const bindings = [];
    const childrenByParent = groupBy(instances.filter((item) => item.parentInstanceId),
        (item) => item.parentInstanceId);
    const instanceById = new Map(instances.map((item) => [item.id, item]));
    const parametersByTarget = groupBy(structuralBindings.filter((item) =>
        item.kind === 'constructor-binding' && item.resolutionStatus === 'exact'),
    (item) => item.targetInstanceId);
    const endpointByOwnerPath = new Map(endpoints.map((endpoint) => [
        endpointKey(endpoint.ownerInstanceId, endpoint.interfacePath), endpoint
    ]));
    for (const behavior of stateBehaviors) {
        const callable = callableByBehaviorId.get(behavior.id);
        const children = childrenByParent.get(behavior.ownerInstanceId) || [];
        const childByName = new Map(children.map((child) => [child.name, child]));
        for (const binding of parametersByTarget.get(behavior.ownerInstanceId) || []) {
            const source = instanceById.get(binding.sourceInstanceId);
            if (source) childByName.set(binding.formalParameter.name, source);
        }
        const accesses = callable?.accesses || [];
        for (const [index, access] of accesses.entries()) {
            const child = childByName.get(access.instance);
            if (!child) continue;
            const endpoint = access.memberPath
                ? endpointByOwnerPath.get(endpointKey(child.id, access.memberPath.split('.')))
                : null;
            bindings.push(makeBinding(behavior, access, child, endpoint, index));
        }
        const explicit = new Set(accesses.map((access) => `${access.kind}\u0000${access.instance}`));
        let syntheticIndex = accesses.length;
        for (const [kind, names] of [['read', behavior.reads], ['write', behavior.writes]]) {
            for (const name of names) {
                const child = childByName.get(name);
                if (!child?.primitiveKind || explicit.has(`${kind}\u0000${name}`)) continue;
                bindings.push(makeBinding(behavior, {
                    instance: name, kind, operation: `state-${kind}`, memberPath: null,
                    arguments: [], sourceEvidence: behavior.evidence[0] || '',
                    evidence: { callable: behavior.name, referencedInstance: name },
                    location: behavior.location
                }, child, null, syntheticIndex));
                syntheticIndex += 1;
            }
        }
    }
    return { bindings };
}

function makeBinding(behavior, access, child, endpoint, index) {
    const id = behaviorAccessBindingId(behavior.id, index);
    const callSiteId = access.codeCallSiteId || `callsite:${behavior.id}:${index}`;
    return {
        id, callSiteId, kind: 'behavior-access',
        behaviorId: behavior.id, ownerInstanceId: behavior.ownerInstanceId,
        targetInstanceId: child.id, endpointId: endpoint?.id || null,
        accessKind: endpoint ? endpointAccessKind(endpoint) : access.kind,
        operation: access.operation, memberPath: access.memberPath,
        arguments: [...(access.arguments || [])], resultBinding: access.resultBinding || null,
        valueBinding: access.valueBinding || null,
        statementId: access.statementId || null,
        pathConditionExpressionIds: [...(access.pathConditionExpressionIds || [])],
        resolutionStatus: endpoint || child.primitiveKind ? 'exact' : 'unresolved',
        sourceEvidence: access.sourceEvidence, sourceText: access.sourceText || access.sourceEvidence,
        sourceRange: access.sourceRange || access.location || behavior.location || null,
        evidence: access.evidence,
        evidenceRefs: access.sourceEvidence ? [{
            kind: 'call-site', id: callSiteId, bindingId: id,
            text: access.sourceText || access.sourceEvidence,
            location: access.location || behavior.location || null,
            sourceRange: access.sourceRange || access.location || behavior.location || null
        }] : [],
        location: access.location || behavior.location || null, analysisOrigin: SOURCE_ORIGIN,
        confidence: endpoint || child.primitiveKind ? 'explicit' : 'unknown'
    };
}
function endpointAccessKind(endpoint) {
    return endpoint.direction === 'output' ? 'return' : 'invoke';
}
function endpointKey(ownerId, path) { return `${ownerId}\u0000${path.join('.')}`; }
function groupBy(items, key) {
    const result = new Map();
    for (const item of items) result.set(key(item), [...(result.get(key(item)) || []), item]);
    return result;
}

module.exports = { buildBehaviorBindings };
