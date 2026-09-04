'use strict';

const { compareContractTypes } = require('../interface-contract-types');
const {
    contractStatus,
    makeContractDiagnostic,
    makeMethodDiagnostic,
    unresolvedProvidedInterfaceContract
} = require('../interface-contract-diagnostics');

function buildSemanticContracts(definitions) {
    const resolver = createDefinitionResolver(definitions);
    const contracts = [];
    const diagnostics = [];
    for (const module of definitions.filter((item) => item.kind === 'module-definition' && item.returnInterface)) {
        const resolution = resolver.resolveInterface(module.returnInterface, module.packageName);
        const contract = resolution.status === 'exact'
            ? compareInterfaceContract(resolution.definition, module)
            : unresolvedContract(module, resolution);
        contracts.push(contract);
        diagnostics.push(...contract.diagnostics);
    }
    return { contracts, diagnostics, resolver };
}

function compareInterfaceContract(interfaceDefinition, module) {
    const incomplete = (module.providedInterfaces || []).find((item) => item.complete === false);
    if (incomplete) return unresolvedProvidedInterfaceContract(interfaceDefinition, module, incomplete);
    const expected = interfaceDefinition.methods || [];
    const actual = (module.methods || []).filter((method) =>
        !(module.providedInterfaces || []).some((provided) => provided.range
            && method.range?.start >= provided.range.start
            && method.range?.end <= provided.range.end));
    const expectedByName = groupByName(expected);
    const actualByName = groupByName(actual);
    const names = [...new Set([...expected.map(nameOf), ...actual.map(nameOf)])];
    const methods = names.map((name) => compareMethod(
        interfaceDefinition, module, expectedByName.get(name) || [], actualByName.get(name) || []
    ));
    const diagnostics = methods.flatMap((method) => method.diagnostics);
    return {
        interfaceId: interfaceDefinition.id,
        moduleId: module.id,
        interfaceName: interfaceDefinition.name,
        moduleName: module.name,
        status: contractStatus(diagnostics),
        analysisOrigin: 'Source-derived',
        methods,
        diagnostics
    };
}

function compareMethod(interfaceDefinition, module, expectedMethods, actualMethods) {
    const expected = expectedMethods[0] || null;
    const actual = actualMethods[0] || null;
    const name = expected?.name || actual?.name || '';
    const diagnostics = [];
    if (!expected) addDiagnostic(diagnostics, interfaceDefinition, module,
        'unexpected-method', actual, `implemented ${actualMethods.length} time${actualMethods.length === 1 ? '' : 's'}`);
    if (expected && !actual) addDiagnostic(diagnostics, interfaceDefinition, module,
        'missing-method', expected, `expected ${signature(expected)}`);
    if (actualMethods.length > 1) addDiagnostic(diagnostics, interfaceDefinition, module,
        'duplicate-implementation', actualMethods[1], `implemented ${actualMethods.length} times`);
    if (expected && actual) compareSignature(interfaceDefinition, module, expected, actual, diagnostics);
    return {
        name,
        status: methodStatus(expected, actualMethods, diagnostics),
        expected: expected ? summary(expected) : null,
        implementations: actualMethods.map(summary),
        diagnostics
    };
}

function compareSignature(iface, module, expected, actual, diagnostics) {
    if (expected.category !== actual.category) addDiagnostic(diagnostics, iface, module,
        'method-category', actual, `expected ${expected.category}, found ${actual.category}`);
    const expectedParameters = expected.parameters || [];
    const actualParameters = actual.parameters || [];
    if (expectedParameters.length !== actualParameters.length) addDiagnostic(diagnostics, iface, module,
        'parameter-count', actual, `expected ${expectedParameters.length}, found ${actualParameters.length}`);
    else expectedParameters.forEach((parameter, index) => compareType(
        iface, module, 'parameter-type', parameter.type, actualParameters[index].type, actual, diagnostics
    ));
    compareType(iface, module, 'return-type', expected.returnType, actual.returnType, actual, diagnostics);
}

function compareType(iface, module, kind, expected, actual, method, diagnostics) {
    const comparison = compareContractTypes(expected, actual);
    if (comparison.status === 'exact') return;
    addDiagnostic(diagnostics, iface, module, kind, method,
        `expected ${comparison.expected || 'unknown'}, found ${comparison.actual || 'unknown'}`,
        comparison.status === 'unresolved' ? 'info' : 'warning');
}

function addDiagnostic(target, iface, module, kind, method, detail, severity) {
    target.push(makeMethodDiagnostic(iface, module, kind, method, detail, severity));
}

function unresolvedContract(module, resolution) {
    const interfaceName = baseTypeName(module.returnInterface);
    const detail = resolution.status === 'ambiguous'
        ? `ambiguous candidates: ${resolution.candidates.map((item) => item.id).join(', ')}`
        : resolution.reason;
    const diagnostic = makeContractDiagnostic({
        interfaceName, moduleName: module.name, kind: 'interface-resolution', methodName: null,
        severity: 'info', location: module.location, detail
    });
    return {
        interfaceId: null, moduleId: module.id, interfaceName, moduleName: module.name,
        status: 'unresolved', analysisOrigin: 'Source-derived', methods: [], diagnostics: [diagnostic]
    };
}

function createDefinitionResolver(definitions) {
    const interfaces = definitions.filter((item) => item.kind === 'interface-definition');
    const packageImports = new Map(definitions
        .filter((item) => item.kind === 'package-definition')
        .map((item) => [item.packageName, new Set((item.imports || []).map((entry) => entry.package))]));
    return {
        resolveInterface(type, packageName) {
            const parsed = qualifiedType(type);
            let candidates = interfaces.filter((item) => item.name === parsed.name);
            if (parsed.packageName) candidates = candidates.filter((item) => item.packageName === parsed.packageName);
            else {
                const local = candidates.filter((item) => item.packageName === packageName);
                if (local.length) candidates = local;
                else {
                    const imports = packageImports.get(packageName) || new Set();
                    const imported = candidates.filter((item) => imports.has(item.packageName));
                    if (imported.length) candidates = imported;
                }
            }
            if (candidates.length === 1) return { status: 'exact', definition: candidates[0] };
            if (candidates.length > 1) return { status: 'ambiguous', candidates };
            return { status: 'unresolved', candidates: [], reason: `No source interface definition for ${type}.` };
        }
    };
}

function qualifiedType(type) {
    const base = baseTypeName(type);
    const match = /^(.*?)(?:::|\.)([A-Za-z_$][\w$]*)$/.exec(base);
    return match ? { packageName: match[1], name: match[2] } : { packageName: null, name: base };
}
function baseTypeName(type) { return String(type || '').replace(/\s*#\s*\([\s\S]*$/, '').trim(); }
function groupByName(items) {
    const result = new Map();
    for (const item of items) result.set(item.name, [...(result.get(item.name) || []), item]);
    return result;
}
function nameOf(item) { return item.name; }
function methodStatus(expected, actual, diagnostics) {
    if (!expected) return 'unexpected';
    if (!actual.length) return 'missing';
    if (actual.length > 1) return 'duplicate';
    if (diagnostics.some((item) => item.severity === 'warning')) return 'mismatch';
    return diagnostics.length ? 'unresolved' : 'exact';
}
function summary(method) {
    return {
        name: method.name, category: method.category || 'unknown',
        parameterCount: (method.parameters || []).length,
        parameters: (method.parameters || []).map((item) => ({ name: item.name, type: item.type })),
        returnType: method.returnType || '', location: method.location || null
    };
}
function signature(method) {
    return `${method.returnType || 'unknown'} ${method.name}(${(method.parameters || []).map((item) => item.type).join(', ')})`;
}

module.exports = { buildSemanticContracts, createDefinitionResolver };
