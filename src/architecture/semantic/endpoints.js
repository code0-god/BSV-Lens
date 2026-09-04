'use strict';

const {
    endpointId,
    interfaceForwardBindingId,
    methodDefinitionId
} = require('./ids');
const { compareContractTypes } = require('../interface-contract-types');

const SOURCE_ORIGIN = 'Source-derived';

function buildEndpoints(definitions, instances, contracts, resolver, context = {}) {
    const endpoints = [];
    const bindings = [];
    const diagnostics = [];
    const definitionById = new Map(definitions.map((item) => [item.id, item]));
    const contractByModule = new Map(contracts.map((item) => [item.moduleId, item]));
    const maxDepth = positive(context.limits?.maxInterfaceDepth, 32);

    for (const instance of instances) {
        const module = definitionById.get(instance.targetDefinitionId);
        if (module?.kind !== 'module-definition' || !module.returnInterface) continue;
        const resolution = resolver.resolveInterface(module.returnInterface, module.packageName);
        if (resolution.status !== 'exact') continue;
        const contract = contractByModule.get(module.id);
        projectInterface({
            instance, module, interfaceDefinition: resolution.definition, path: [], endpoints,
            diagnostics, resolver, contract, ancestors: new Set(), depth: 0, maxDepth
        });
    }

    const endpointByOwnerAndPath = new Map(endpoints.map((item) => [endpointKey(
        item.ownerInstanceId, item.interfacePath
    ), item]));
    const childrenByParent = groupBy(instances.filter((item) => item.parentInstanceId),
        (item) => item.parentInstanceId);
    for (const owner of instances) {
        const module = definitionById.get(owner.targetDefinitionId);
        if (module?.kind !== 'module-definition') continue;
        const aliases = flattenAliases(module.providedInterfaces || []);
        for (const provided of aliases) {
            const binding = forwardBinding(owner, provided, childrenByParent, endpointByOwnerAndPath);
            bindings.push(binding);
            if (binding.resolutionStatus !== 'exact') diagnostics.push(forwardDiagnostic(owner, provided, binding));
        }
    }
    return { endpoints, bindings, diagnostics };
}

function projectInterface(state) {
    const {
        instance, module, interfaceDefinition, path, endpoints, diagnostics,
        resolver, contract, ancestors, depth, maxDepth
    } = state;
    endpoints.push(interfaceEndpoint(instance, interfaceDefinition, path));
    if (depth >= maxDepth) {
        diagnostics.push(endpointDiagnostic('endpoint.depth', 'warning', interfaceDefinition.location,
            `Interface expansion reached the depth limit at ${displayPath(instance, path)}.`));
        return;
    }
    if (ancestors.has(interfaceDefinition.id)) {
        diagnostics.push(endpointDiagnostic('endpoint.cycle', 'warning', interfaceDefinition.location,
            `Interface expansion cycle was cut at ${displayPath(instance, path)}.`));
        return;
    }
    const nextAncestors = new Set([...ancestors, interfaceDefinition.id]);
    const methodContracts = path.length === 0
        ? new Map((contract?.methods || []).map((item) => [item.name, item]))
        : new Map();
    for (const method of interfaceDefinition.methods || []) {
        const methodContract = methodContracts.get(method.name);
        endpoints.push(methodEndpoint(
            instance, module, interfaceDefinition, path, method, contract, methodContract
        ));
    }
    for (const subinterface of interfaceDefinition.subinterfaces || []) {
        const subpath = [...path, subinterface.name];
        const resolution = resolver.resolveInterface(subinterface.type, interfaceDefinition.packageName);
        if (resolution.status !== 'exact') {
            endpoints.push(unresolvedInterfaceEndpoint(instance, subinterface, subpath));
            diagnostics.push(endpointDiagnostic('endpoint.interface-unresolved', 'info', subinterface.location,
                `Cannot resolve interface ${subinterface.type} at ${displayPath(instance, subpath)}.`));
            continue;
        }
        projectInterface({
            ...state, interfaceDefinition: resolution.definition, path: subpath,
            ancestors: nextAncestors, depth: depth + 1
        });
    }
}

function interfaceEndpoint(instance, interfaceDefinition, path) {
    return {
        id: endpointId(instance.id, path),
        kind: 'subinterface-endpoint',
        name: path[path.length - 1] || interfaceDefinition.name,
        ownerInstanceId: instance.id,
        interfacePath: path,
        interfaceDefinitionId: interfaceDefinition.id,
        interfaceType: interfaceDefinition.name,
        resolutionStatus: 'exact',
        location: interfaceDefinition.location || instance.location || null,
        evidence: { declaration: interfaceDefinition.signature || `interface ${interfaceDefinition.name}` },
        analysisOrigin: SOURCE_ORIGIN
    };
}

function unresolvedInterfaceEndpoint(instance, subinterface, path) {
    return {
        id: endpointId(instance.id, path), kind: 'subinterface-endpoint', name: subinterface.name,
        ownerInstanceId: instance.id, interfacePath: path, interfaceDefinitionId: null,
        interfaceType: subinterface.type, resolutionStatus: 'unresolved',
        location: subinterface.location || instance.location || null,
        evidence: { declaration: `interface ${subinterface.type} ${subinterface.name}` },
        analysisOrigin: SOURCE_ORIGIN
    };
}

function methodEndpoint(instance, module, interfaceDefinition, parentPath, method, moduleContract, methodContract) {
    const path = [...parentPath, method.name];
    const implementationMatches = (module.methods || []).filter((candidate) =>
        [...(candidate.interfacePath || []), candidate.name].join('.') === path.join('.')
    );
    const nestedStatus = parentPath.length > 0
        ? nestedMethodStatus(method, implementationMatches)
        : null;
    const exactImplementation = moduleContract?.status === 'exact' && (
        parentPath.length === 0
            ? methodContract?.status === 'exact'
            : nestedStatus === 'exact'
    );
    return {
        id: endpointId(instance.id, path),
        kind: 'method-endpoint',
        name: method.name,
        ownerInstanceId: instance.id,
        interfacePath: path,
        interfaceDefinitionId: interfaceDefinition.id,
        category: method.category || 'unknown',
        direction: method.direction || 'unknown',
        parameters: (method.parameters || []).map((item) => ({ name: item.name, type: item.type })),
        returnType: method.returnType || '',
        resultType: method.resultType ?? null,
        contractStatus: exactImplementation
            ? 'exact'
            : parentPath.length === 0
                ? methodContract?.status || moduleContract?.status || 'unresolved'
                : nestedStatus,
        implementationMethodId: exactImplementation
            ? methodDefinitionId(module.id, path.join('.'))
            : null,
        location: method.location || interfaceDefinition.location || instance.location || null,
        evidence: { declaration: method.signature || `method ${method.returnType} ${method.name}` },
        analysisOrigin: SOURCE_ORIGIN
    };
}

function nestedMethodStatus(method, implementations) {
    if (implementations.length !== 1) return 'mismatch';
    const implementation = implementations[0];
    if (method.category !== implementation.category) return 'mismatch';
    const declaredParameters = method.parameters || [];
    const actualParameters = implementation.parameters || [];
    if (declaredParameters.length !== actualParameters.length) return 'mismatch';
    const comparisons = [
        ...declaredParameters.map((parameter, index) =>
            compareContractTypes(parameter.type, actualParameters[index].type).status
        ),
        compareContractTypes(method.returnType, implementation.returnType).status
    ];
    if (comparisons.includes('mismatch')) return 'mismatch';
    return comparisons.includes('unresolved') ? 'unresolved' : 'exact';
}

function forwardBinding(owner, provided, childrenByParent, endpoints) {
    const outerPath = provided.path || [provided.name];
    const target = parseTarget(provided.targetExpression);
    const children = (childrenByParent.get(owner.id) || []).filter((item) => item.name === target?.[0]);
    const child = children.length === 1 ? children[0] : null;
    const innerPath = target || [];
    const childPath = target?.slice(1) || [];
    const outerEndpoint = endpoints.get(endpointKey(owner.id, outerPath));
    const innerEndpoint = child && endpoints.get(endpointKey(child.id, childPath));
    const exact = Boolean(target && child && outerEndpoint && innerEndpoint);
    return {
        id: interfaceForwardBindingId(owner.id, outerPath),
        kind: 'interface-forward',
        ownerInstanceId: owner.id,
        outerPath,
        innerPath,
        outerEndpointId: outerEndpoint?.id || null,
        innerEndpointId: innerEndpoint?.id || null,
        targetInstanceId: child?.id || null,
        targetExpression: provided.targetExpression,
        resolutionStatus: exact ? 'exact' : 'unresolved',
        evidence: { targetExpression: provided.targetExpression, form: provided.form },
        location: provided.location || owner.location || null,
        analysisOrigin: SOURCE_ORIGIN
    };
}

function flattenAliases(items) {
    const result = [];
    for (const item of items) {
        if (item.form === 'alias' && item.targetExpression) result.push(item);
        result.push(...flattenAliases(item.members || []));
    }
    return result;
}

function parseTarget(expression) {
    const text = String(expression || '').trim();
    return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(text) ? text.split('.') : null;
}
function forwardDiagnostic(owner, provided, binding) {
    return endpointDiagnostic('endpoint.forward-unresolved', 'info', binding.location,
        `Cannot resolve interface forwarding ${owner.path}.${(provided.path || []).join('.')} = ${provided.targetExpression}.`);
}
function endpointDiagnostic(code, severity, location, message) {
    return { code, severity, message, location: location || null, analysisOrigin: SOURCE_ORIGIN };
}
function displayPath(instance, path) { return [instance.path, ...path].join('.'); }
function endpointKey(ownerId, path) { return `${ownerId}\u0000${path.join('.')}`; }
function groupBy(items, key) {
    const result = new Map();
    for (const item of items) result.set(key(item), [...(result.get(key(item)) || []), item]);
    return result;
}
function positive(value, fallback) { return Number.isInteger(value) && value > 0 ? value : fallback; }

module.exports = { buildEndpoints };
