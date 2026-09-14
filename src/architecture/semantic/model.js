'use strict';

const { buildDefinitions } = require('./definitions');
const { buildInstances } = require('./instances');
const { buildSemanticContracts } = require('./contracts');
const { buildEndpoints } = require('./endpoints');
const { buildProtocolChannels } = require('./protocol-channels');
const { buildSemanticBoundaries } = require('./boundaries');
const {
    attachProtocolMembership,
    buildStateBehaviors
} = require('./state-behaviors');
const { buildBehaviorBindings } = require('./behavior-bindings');
const { buildSemanticFlows } = require('./semantic-flow');
const { buildSemanticIndexes } = require('./indexes');
const { buildSemanticScheduleRelations } = require('./scheduling');
const { attachSemanticProvenance } = require('./provenance');
const { behaviorDefinitionId } = require('./ids');

const ARRAY_FIELDS = [
    'instances',
    'endpoints',
    'bindings',
    'protocolChannels',
    'semanticBoundaries',
    'semanticFlows',
    'stateBehaviors',
    'interfaceContracts'
];

function buildSemanticModel(parsedFiles, config, context = {}) {
    const files = Array.isArray(parsedFiles) ? parsedFiles : [];
    const definitions = buildDefinitions(files);
    const codeIR = buildCodeIR(files, definitions);
    const instanceIR = buildInstances(definitions, files, config || {}, context);
    const contractIR = buildSemanticContracts(definitions);
    const endpointIR = buildEndpoints(
        definitions,
        instanceIR.instances,
        contractIR.contracts,
        contractIR.resolver,
        context
    );
    const protocolIR = buildProtocolChannels(endpointIR.endpoints);
    const behaviorIR = buildStateBehaviors(definitions, instanceIR.instances);
    attachProtocolMembership(
        behaviorIR.stateBehaviors,
        endpointIR.endpoints,
        protocolIR.channels
    );
    const structuralBindings = [...instanceIR.bindings, ...endpointIR.bindings];
    const accessIR = buildBehaviorBindings(
        behaviorIR.stateBehaviors,
        behaviorIR.callableByBehaviorId,
        instanceIR.instances,
        endpointIR.endpoints,
        structuralBindings
    );
    const flowIR = buildSemanticFlows({
        behaviors: behaviorIR.stateBehaviors,
        accessBindings: accessIR.bindings,
        bindings: structuralBindings,
        endpoints: endpointIR.endpoints,
        channels: protocolIR.channels,
        limits: context.limits,
        seedFlows: Array.isArray(context.semanticFlows) ? context.semanticFlows : []
    });
    const scheduleIR = buildSemanticScheduleRelations(
        context.scheduleRelations || [],
        behaviorIR.stateBehaviors,
        instanceIR.instances,
        {
            includePotentialDependencies:
                config?.scheduling?.includePotentialDependencies !== false,
            maxRelations: context.limits?.maxEdges
        }
    );
    const model = {
        schemaVersion: 3,
        codeAnalysisVersion: 2,
        definitions,
        sourceDocuments: files.map((file) => file.sourceDocument).filter(Boolean),
        statements: codeIR.statements,
        expressions: codeIR.expressions,
        callSites: codeIR.callSites,
        bindingEnvironments: codeIR.bindingEnvironments,
        functionDefinitions: codeIR.functionDefinitions
    };
    for (const field of ARRAY_FIELDS) {
        model[field] = Array.isArray(context[field]) ? context[field] : [];
    }
    model.instances = instanceIR.instances;
    model.endpoints = [...endpointIR.endpoints, ...model.endpoints];
    model.bindings = [...structuralBindings, ...accessIR.bindings, ...model.bindings];
    model.protocolChannels = [...protocolIR.channels, ...model.protocolChannels];
    model.semanticBoundaries = buildSemanticBoundaries(
        model.roots || instanceIR.roots,
        instanceIR.instances,
        model.endpoints,
        model.protocolChannels
    );
    model.semanticFlows = flowIR.flows;
    model.stateBehaviors = [...behaviorIR.stateBehaviors, ...model.stateBehaviors];
    model.scheduleRelations = scheduleIR.relations;
    model.interfaceContracts = [...contractIR.contracts, ...model.interfaceContracts];
    model.roots = instanceIR.roots;
    model.diagnostics = [
        ...files.flatMap((file) => file.diagnostics || []),
        ...instanceIR.diagnostics,
        ...contractIR.diagnostics,
        ...endpointIR.diagnostics,
        ...protocolIR.diagnostics,
        ...behaviorIR.diagnostics,
        ...flowIR.diagnostics,
        ...scheduleIR.diagnostics,
        ...(Array.isArray(context.diagnostics) ? context.diagnostics : [])
    ];
    model.provenance = {
        analysisOrigin: 'Source-derived',
        files: files.map((file) => ({
            uri: file.uri,
            relativePath: file.relativePath,
            packageName: file.packageName
        }))
    };
    attachSemanticProvenance(model);
    Object.defineProperty(model, 'indexes', {
        value: buildSemanticIndexes(model),
        enumerable: false
    });
    return model;
}

function buildCodeIR(files, definitions) {
    const statements = [];
    const expressions = [];
    const callSites = [];
    const bindingEnvironments = [];
    const functionDefinitions = definitions.filter((item) => item.kind === 'function-definition');
    const callableContexts = new Map();
    const packageImports = new Map(definitions
        .filter((item) => item.kind === 'package-definition')
        .map((item) => [item.packageName, new Set((item.imports || []).map((entry) => entry.package))]));
    for (const definition of definitions) {
        if (definition.kind === 'function-definition' && definition.codeAnalysis) {
            appendAnalysis(definition.codeAnalysis, definition.id, {
                packageName: definition.packageName,
                ownerDefinitionId: definition.ownerDefinitionId || null
            });
        }
        if (definition.kind !== 'module-definition') continue;
        const counts = new Map();
        for (const [kind, values] of [['rule', definition.rules], ['method', definition.methods]]) {
            for (const callable of values || []) {
                const path = [...(callable.interfacePath || []), callable.name].join('.');
                const key = `${kind}\u0000${path}`;
                const ordinal = counts.get(key) || 0;
                counts.set(key, ordinal + 1);
                appendAnalysis(callable.codeAnalysis,
                    behaviorDefinitionId(definition.id, kind, path, ordinal), {
                        packageName: definition.packageName,
                        ownerDefinitionId: definition.id
                    });
            }
        }
    }
    resolveCalls();
    return { statements, expressions, callSites, bindingEnvironments,
        functionDefinitions: functionDefinitions.map((definition) => ({
            id: definition.id, name: definition.name, parameters: definition.parameters || [],
            returnType: definition.returnType || null,
            statementIds: statements.filter((item) => item.enclosingCallableId === definition.id).map((item) => item.id),
            returnExpressionIds: statements.filter((item) => item.enclosingCallableId === definition.id && item.kind === 'return')
                .map((item) => item.expressionId).filter(Boolean),
            sourceDocumentId: definition.uri, sourceRevision: files.find((file) => file.uri === definition.uri)?.sourceDocument?.revision || null,
            sourceRange: definition.sourceRange, range: definition.range,
            ...(definition.declarationScope ? {
                declarationScope: definition.declarationScope,
                declarationOnly: definition.declarationOnly
            } : {}),
            resolutionStatus: functionResolutionStatus(definition.id)
        })) };

    function appendAnalysis(analysis, callableId, callableContext) {
        if (!analysis) return;
        callableContexts.set(callableId, callableContext);
        for (const item of analysis.statements || []) statements.push({ ...item, enclosingCallableId: callableId });
        for (const item of analysis.expressions || []) expressions.push({ ...item, enclosingCallableId: callableId });
        for (const item of analysis.callSites || []) callSites.push({ ...item, enclosingCallableId: callableId });
        for (const item of analysis.bindingEnvironments || []) bindingEnvironments.push({ ...item, enclosingCallableId: callableId });
    }
    function functionResolutionStatus(callableId) {
        const ownedStatements = statements.filter((item) => item.enclosingCallableId === callableId);
        const returns = ownedStatements.filter((item) => item.kind === 'return');
        if (!returns.length || ownedStatements.some((item) => item.resolutionStatus === 'unsupported')) {
            return 'unsupported';
        }
        if (ownedStatements.some((item) => item.resolutionStatus !== 'exact')) return 'unresolved';
        const expressionById = new Map(expressions.map((item) => [item.id, item]));
        return returns.every((item) => expressionById.get(item.expressionId)?.resolutionStatus === 'exact')
            ? 'exact' : 'unresolved';
    }
    function resolveCalls() {
        const functionsByName = new Map();
        for (const fn of functionDefinitions) functionsByName.set(fn.name,
            [...(functionsByName.get(fn.name) || []), fn]);
        const expressionById = new Map(expressions.map((item) => [item.id, item]));
        const callByExpressionId = new Map();
        for (const call of callSites) {
            const simpleName = call.calleeName.includes('.') ? null : call.calleeName;
            const caller = callableContexts.get(call.enclosingCallableId);
            const importedPackages = packageImports.get(caller?.packageName) || new Set();
            const candidates = simpleName ? (functionsByName.get(simpleName) || []).filter((fn) =>
                fn.packageName === caller?.packageName
                    ? !fn.ownerDefinitionId || fn.ownerDefinitionId === caller.ownerDefinitionId
                    : !fn.ownerDefinitionId && importedPackages.has(fn.packageName)
            ) : [];
            const requiresDispatch = candidates.some((fn) => Boolean(fn.declarationScope));
            if (call.builtin && !call.specialization && !requiresDispatch) {
                call.targetResolutionStatus = 'exact';
                callByExpressionId.set(call.expressionId, call);
                continue;
            }
            call.candidateDefinitionIds = candidates.map((item) => item.id).sort();
            const exact = !requiresDispatch && !call.specialization && candidates.length === 1
                && (candidates[0].parameters || []).length === call.argumentExpressionIds.length;
            call.targetResolutionStatus = exact ? 'exact' : 'unresolved';
            if (requiresDispatch) call.resolutionReason = 'typeclass-dispatch-not-resolved';
            call.calleeDefinitionId = exact ? candidates[0].id : null;
            call.actualToFormal = exact ? call.argumentExpressionIds.map((expressionId, index) => ({
                actualExpressionId: expressionId,
                formalName: candidates[0].parameters[index].name,
                formalIndex: index
            })) : [];
            const expression = expressionById.get(call.expressionId);
            if (expression) {
                expression.definitionIds = call.calleeDefinitionId ? [call.calleeDefinitionId] : [];
            }
            callByExpressionId.set(call.expressionId, call);
        }
        for (let pass = 0; pass <= expressions.length; pass += 1) {
            let changed = false;
            for (const expression of expressions) {
                let status = expression.resolutionStatus;
                if (['operator', 'group', 'unary', 'index'].includes(expression.kind)) {
                    status = combinedResolution((expression.operandIds || []).map((id) => expressionById.get(id)));
                } else if (expression.kind === 'call') {
                    const call = callByExpressionId.get(expression.id);
                    const argumentsStatus = combinedResolution((expression.argumentIds || []).map((id) => expressionById.get(id)));
                    status = argumentsStatus === 'unsupported' ? 'unsupported'
                        : call?.targetResolutionStatus === 'exact' && argumentsStatus === 'exact' ? 'exact' : 'unresolved';
                } else if (['identifier', 'member-reference'].includes(expression.kind)
                    && expression.definitionIds?.length) {
                    status = combinedResolution(expression.definitionIds.map((id) => expressionById.get(id)));
                }
                if (status !== expression.resolutionStatus) {
                    expression.resolutionStatus = status;
                    changed = true;
                }
            }
            if (!changed) break;
        }
        for (const call of callSites) {
            call.resolutionStatus = expressionById.get(call.expressionId)?.resolutionStatus || 'unresolved';
        }
        for (const environment of bindingEnvironments) {
            for (const binding of Object.values(environment.bindings || {})) {
                if (binding.originExpressionIds?.length) {
                    binding.resolutionStatus = combinedResolution(binding.originExpressionIds.map((id) => expressionById.get(id)));
                }
            }
        }
        const statementById = new Map(statements.map((item) => [item.id, item]));
        for (const statement of [...statements].sort((left, right) =>
            left.range.end - left.range.start - (right.range.end - right.range.start))) {
            if (statement.kind === 'unsupported') continue;
            const expressionIds = [statement.rightExpressionId, statement.expressionId, statement.conditionExpressionId]
                .filter(Boolean);
            const childStatements = statements.filter((item) => item.parentStatementId === statement.id);
            if (statement.kind === 'case') {
                for (const arm of statement.caseArms || []) {
                    const armItems = [
                        ...(arm.labelExpressionIds || []).map((id) => expressionById.get(id)),
                        ...(arm.bodyStatementIds || []).map((id) => statementById.get(id))
                    ];
                    arm.resolutionStatus = arm.resolutionStatus === 'unsupported'
                        ? 'unsupported' : combinedResolution(armItems);
                }
                statement.resolutionStatus = combinedResolution([
                    ...expressionIds.map((id) => expressionById.get(id)), ...(statement.caseArms || [])
                ]);
            } else if (expressionIds.length || childStatements.length) {
                statement.resolutionStatus = combinedResolution([
                    ...expressionIds.map((id) => expressionById.get(id)), ...childStatements
                ]);
            }
            for (const symbol of [statement.localSymbol, statement.resultSymbol, statement.targetSymbol]) {
                if (symbol && statement.rightExpressionId) symbol.resolutionStatus = statement.resolutionStatus;
            }
        }
    }
}

function combinedResolution(items) {
    if (!items.length) return 'exact';
    if (items.some((item) => !item || item.resolutionStatus === 'unsupported')) return 'unsupported';
    return items.every((item) => item.resolutionStatus === 'exact') ? 'exact' : 'unresolved';
}

module.exports = {
    buildSemanticModel
};
