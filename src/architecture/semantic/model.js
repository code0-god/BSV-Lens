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
        codeAnalysisVersion: 1,
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
        const expressionById = new Map(expressions.map((item) => [item.id, item]));
        return returns.every((item) => expressionById.get(item.expressionId)?.resolutionStatus === 'exact')
            ? 'exact' : 'unresolved';
    }
    function resolveCalls() {
        const functionsByName = new Map();
        for (const fn of functionDefinitions) functionsByName.set(fn.name,
            [...(functionsByName.get(fn.name) || []), fn]);
        const expressionById = new Map(expressions.map((item) => [item.id, item]));
        for (const call of callSites) {
            if (call.builtin && !call.specialization) {
                call.resolutionStatus = 'exact';
                const builtinExpression = expressionById.get(call.expressionId);
                if (builtinExpression) builtinExpression.resolutionStatus = 'exact';
                continue;
            }
            const simpleName = call.calleeName.includes('.') ? null : call.calleeName;
            const caller = callableContexts.get(call.enclosingCallableId);
            const importedPackages = packageImports.get(caller?.packageName) || new Set();
            const candidates = simpleName ? (functionsByName.get(simpleName) || []).filter((fn) =>
                fn.packageName === caller?.packageName
                    ? !fn.ownerDefinitionId || fn.ownerDefinitionId === caller.ownerDefinitionId
                    : !fn.ownerDefinitionId && importedPackages.has(fn.packageName)
            ) : [];
            call.candidateDefinitionIds = candidates.map((item) => item.id).sort();
            const exact = !call.specialization && candidates.length === 1
                && (candidates[0].parameters || []).length === call.argumentExpressionIds.length;
            call.resolutionStatus = exact ? 'exact' : 'unresolved';
            call.calleeDefinitionId = exact ? candidates[0].id : null;
            call.actualToFormal = exact ? call.argumentExpressionIds.map((expressionId, index) => ({
                actualExpressionId: expressionId,
                formalName: candidates[0].parameters[index].name,
                formalIndex: index
            })) : [];
            const expression = expressionById.get(call.expressionId);
            if (expression) {
                expression.resolutionStatus = call.resolutionStatus;
                expression.definitionIds = call.calleeDefinitionId ? [call.calleeDefinitionId] : [];
            }
        }
        for (const expression of [...expressions].sort((left, right) =>
            left.range.end - left.range.start - (right.range.end - right.range.start)
        )) {
            if (expression.kind !== 'operator') continue;
            expression.resolutionStatus = (expression.operandIds || []).every((id) =>
                expressionById.get(id)?.resolutionStatus === 'exact'
            ) ? 'exact' : 'unresolved';
        }
    }
}

module.exports = {
    buildSemanticModel
};
