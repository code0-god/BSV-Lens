'use strict';
function signedConditions(source, ids = []) {
    return ids.map(signedExpressionId => {
        const polarity = !signedExpressionId.startsWith('!'), expressionId = polarity ? signedExpressionId : signedExpressionId.slice(1);
        const expression = source.expressions.get(expressionId) || null;
        return { signedExpressionId, expressionId, polarity, text: expression?.text || null, expression, evaluated: false };
    });
}
function callMapping(source, selected, ownerInstanceId, { allowsOwner = () => true, maxBits = 4096 } = {}) {
    const explicitBinding = source.bindings.get(selected.id);
    const call = source.calls.get(selected.id) || source.calls.get(explicitBinding?.callSiteId || selected.callSiteId);
    const callers = source.behaviors.filter(b => b.ownerInstanceId === ownerInstanceId &&
        (call ? b.definitionId === call.enclosingCallableId : b.id === explicitBinding?.behaviorId));
    const caller = { ownerInstanceId, behaviorId: callers.length === 1 ? callers[0].id : null,
        definitionId: call?.enclosingCallableId || callers[0]?.definitionId || null };
    const bindings = explicitBinding ? [explicitBinding] : [...source.bindings.values()].filter(b => b.ownerInstanceId === ownerInstanceId &&
        b.callSiteId === call?.id && b.statementId === call?.parentStatementId && callers.some(c => c.id === b.behaviorId));
    const targets = bindings.filter(b => b.endpointId), binding = targets.length === 1 ? targets[0] : explicitBinding || null;
    const endpoint = source.endpoints.get(binding?.endpointId);
    const helper = source.functions.get(call?.calleeDefinitionId);
    const resolution = endpoint ? source.semantic.resolveEndpointImplementation(endpoint.id, { ownerInstanceId: endpoint.ownerInstanceId }) : null;
    const actuals = (call?.argumentExpressionIds || []).map(id => source.expressions.get(id));
    const exactMethod = !!call && !call.specialization && targets.length === 1 && binding.resolutionStatus === 'exact' &&
        actuals.every(Boolean) && actuals.length === (endpoint?.parameters || []).length;
    const actualToFormal = exactMethod ? actuals.map((expression, formalIndex) => ({ actualExpressionId: expression.id,
        formalIndex, formalName: endpoint.parameters[formalIndex].name, formal: endpoint.parameters[formalIndex],
        actual: expression, endpointId: endpoint.id, ownerInstanceId: endpoint.ownerInstanceId })) : helper ?
        (call.actualToFormal || []).map(m => ({ ...m, actual: source.expressions.get(m.actualExpressionId),
            formal: helper.parameters[m.formalIndex], definitionId: helper.id, ownerInstanceId: null })) : [];
    const statement = source.statements.get(call?.parentStatementId || binding?.statementId);
    const callee = endpoint ? { endpointId: endpoint.id, ownerInstanceId: endpoint.ownerInstanceId,
        definitionId: endpoint.implementationMethodId || null, behaviorId: resolution.behavior?.id || null,
        endpoint, implementation: resolution } : helper ? { endpointId: null, ownerInstanceId: null, definitionId: helper.id,
        behaviorId: null, functionDefinition: helper } : null;
    const flows = (source.model.semanticFlows || []).filter(f => f.callSiteId === call?.id && f.ownerInstanceId === ownerInstanceId);
    const returnAvailability = callee && !allowsOwner(callee.ownerInstanceId) ? 'scope-boundary' : 'source-records';
    const returns = returnAvailability === 'source-records' && callee?.definitionId ? [...source.statements.values()].filter(s => s.enclosingCallableId === callee.definitionId && s.kind === 'return') : [];
    const producer = [], producerCandidates = [];
    let truncated = false;
    // Traverse only recorded expression/definition IDs. A producer binding must share the actual
    // expression's statement and caller behavior, and its exact lexical start (not a nearby line).
    for (const [formalIndex, actual] of actuals.entries()) {
        if (!actual) continue;
        const queue = [actual.id], seen = new Set();
        for (let i = 0; i < queue.length; i++) {
            const expression = source.expressions.get(queue[i]);
            if (!expression || seen.has(expression.id)) continue;
            if (seen.size >= maxBits) { truncated = true; break; }
            seen.add(expression.id);
            queue.push(...(expression.operandIds || []), ...(expression.argumentIds || []), ...(expression.definitionIds || []).filter(id => source.expressions.has(id)));
            if (expression.kind !== 'member-reference') continue;
            const matches = [...source.bindings.values()].filter(b => b.ownerInstanceId === ownerInstanceId && b.accessKind === 'return' && b.endpointId &&
                b.statementId === expression.parentStatementId && callers.some(c => c.id === b.behaviorId) &&
                b.location?.uri === expression.sourceRange?.uri && b.location?.line === expression.sourceRange.line && b.location?.column === expression.sourceRange.column);
            if (matches.length !== 1) { producerCandidates.push(...matches); continue; }
            const binding = matches[0], endpoint = source.endpoints.get(binding.endpointId);
            const implementation = source.semantic.resolveEndpointImplementation(endpoint.id, { ownerInstanceId: endpoint.ownerInstanceId });
            producer.push({ endpointId: endpoint.id, ownerInstanceId: endpoint.ownerInstanceId,
                implementationBehaviorId: implementation.behavior?.id || null, bindingId: binding.id,
                expressionId: expression.id, argumentExpressionId: actual.id, formalIndex, resolution: binding.resolutionStatus, binding });
        }
    }
    const resolved = exactMethod || helper && call.resolutionStatus === 'exact'
        || call?.builtin && !call.specialization && call.resolutionStatus === 'exact';
    return { callSite: call || null, binding, caller, callee, resolution: resolved ? 'exact' : targets.length > 1 ? 'multiple' : 'unresolved',
        reason: resolved ? null : call?.specialization ? 'unsupported-specialization' : targets.length > 1 ? 'ambiguous-endpoint-binding' : 'unresolved-call-target',
        candidates: targets.length > 1 ? targets : (call?.candidateDefinitionIds || []).map(id => source.functions.get(id)).filter(Boolean),
        actualToFormal, returns, returnAvailability, truncated, producerCandidates, resultBinding: statement?.kind === 'result-binding' ? statement : binding?.resultBinding || binding?.valueBinding || null,
        conditions: signedConditions(source, statement?.pathConditionExpressionIds || binding?.pathConditionExpressionIds),
        producer,
        consumer: endpoint ? { endpointId: endpoint.id, ownerInstanceId: endpoint.ownerInstanceId } : null, flows };
}
module.exports = { callMapping, signedConditions };
