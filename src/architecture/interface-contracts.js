'use strict';

const { resolveArchitectureSymbol } = require('./symbol-resolver');
const { compareContractTypes } = require('./interface-contract-types');
const {
    contractStatus,
    makeContractDiagnostic,
    makeMethodDiagnostic,
    methodLocation,
    unresolvedProvidedInterfaceContract
} = require('./interface-contract-diagnostics');

function buildInterfaceContracts(parsedFiles, nodes, diagnostics) {
    const interfaceNodes = nodes.filter((node) => node.kind === 'interface');
    const interfaceNodeById = new Map(interfaceNodes.map((node) => [node.id, node]));
    const contracts = [];

    for (const file of parsedFiles) {
        for (const module of file.modules || []) {
            if (!module.returnInterface) continue;
            const moduleNode = nodes.find((node) =>
                node.kind === 'module'
                && node.packageName === file.packageName
                && node.name === module.name
            );
            if (!moduleNode) continue;
            const resolution = resolveArchitectureSymbol(module.returnInterface, {
                nodes: interfaceNodes,
                nodeById: interfaceNodeById,
                packageName: file.packageName,
                importedPackages: (file.imports || []).map((entry) => entry.package),
                kinds: ['interface']
            });
            const contract = resolution.status === 'exact'
                ? compareInterfaceContract(resolution.node, moduleNode, module)
                : unresolvedInterfaceContract(module.returnInterface, moduleNode, resolution);
            contracts.push(contract);
            diagnostics.push(...contract.diagnostics);
        }
    }

    return contracts;
}

function compareInterfaceContract(interfaceNode, moduleNode, module) {
    const incomplete = (module.providedInterfaces || []).find((provided) =>
        provided.complete === false
    );
    if (incomplete) return unresolvedProvidedInterfaceContract(interfaceNode, moduleNode, incomplete);
    const expectedMethods = interfaceNode.details?.methods || interfaceNode.ports || [];
    const actualMethods = (module.methods || []).filter((method) =>
        !(module.providedInterfaces || []).some((provided) =>
            provided.range
            && method.range.start >= provided.range.start
            && method.range.end <= provided.range.end
        )
    );
    const expectedByName = groupMethods(expectedMethods);
    const actualByName = groupMethods(actualMethods);
    const names = unique([
        ...expectedMethods.map((method) => method.name),
        ...actualMethods.map((method) => method.name)
    ]);
    const methods = names.map((name) => compareMethod(
        interfaceNode,
        moduleNode,
        expectedByName.get(name) || [],
        actualByName.get(name) || []
    ));
    const diagnostics = methods.flatMap((method) => method.diagnostics);
    return {
        interfaceId: interfaceNode.id,
        moduleId: moduleNode.id,
        interfaceName: interfaceNode.name,
        moduleName: moduleNode.name,
        status: contractStatus(diagnostics),
        analysisOrigin: 'Source-derived',
        methods,
        diagnostics
    };
}

function unresolvedInterfaceContract(interfaceName, moduleNode, resolution) {
    const detail = resolution.status === 'ambiguous'
        ? `ambiguous candidates: ${resolution.candidates.map((node) => node.id).join(', ')}`
        : resolution.reason;
    const diagnostic = makeContractDiagnostic({
        interfaceName,
        moduleName: moduleNode.name,
        kind: 'interface-resolution',
        methodName: null,
        severity: 'info',
        location: moduleNode.location,
        detail
    });
    return {
        interfaceId: null,
        moduleId: moduleNode.id,
        interfaceName,
        moduleName: moduleNode.name,
        status: 'unresolved',
        analysisOrigin: 'Source-derived',
        methods: [],
        diagnostics: [diagnostic]
    };
}

function compareMethod(interfaceNode, moduleNode, expectedMethods, actualMethods) {
    const expected = expectedMethods[0] || null;
    const name = expected?.name || actualMethods[0]?.name || '';
    const diagnostics = [];
    if (!expected) {
        diagnostics.push(makeMethodDiagnostic(
            interfaceNode,
            moduleNode,
            'unexpected-method',
            actualMethods[0],
            `implemented ${actualMethods.length} time${actualMethods.length === 1 ? '' : 's'}`
        ));
    }
    if (expected && actualMethods.length === 0) {
        diagnostics.push(makeMethodDiagnostic(
            interfaceNode,
            moduleNode,
            'missing-method',
            expected,
            `expected ${methodSignature(expected)}`
        ));
    }
    if (actualMethods.length > 1) {
        diagnostics.push(makeMethodDiagnostic(
            interfaceNode,
            moduleNode,
            'duplicate-implementation',
            actualMethods[1],
            `implemented ${actualMethods.length} times`
        ));
    }
    if (expected && actualMethods[0]) {
        compareMethodSignature(interfaceNode, moduleNode, expected, actualMethods[0], diagnostics);
    }

    return {
        name,
        status: methodStatus(expected, actualMethods, diagnostics),
        expected: expected ? methodSummary(expected) : null,
        implementations: actualMethods.map(methodSummary),
        diagnostics
    };
}

function compareMethodSignature(interfaceNode, moduleNode, expected, actual, diagnostics) {
    if (expected.category !== actual.category) {
        diagnostics.push(makeMethodDiagnostic(
            interfaceNode,
            moduleNode,
            'method-category',
            actual,
            `expected ${expected.category}, found ${actual.category}`
        ));
    }
    if ((expected.parameters || []).length !== (actual.parameters || []).length) {
        diagnostics.push(makeMethodDiagnostic(
            interfaceNode,
            moduleNode,
            'parameter-count',
            actual,
            `expected ${(expected.parameters || []).length}, found ${(actual.parameters || []).length}`
        ));
    } else {
        (expected.parameters || []).forEach((parameter, index) => {
            compareType(
                interfaceNode,
                moduleNode,
                'parameter-type',
                parameter.type,
                actual.parameters[index].type,
                actual,
                diagnostics
            );
        });
    }
    compareType(
        interfaceNode,
        moduleNode,
        'return-type',
        expected.returnType,
        actual.returnType,
        actual,
        diagnostics
    );
}

function compareType(interfaceNode, moduleNode, kind, expected, actual, method, diagnostics) {
    const comparison = compareContractTypes(expected, actual);
    if (comparison.status === 'exact') return;
    diagnostics.push(makeMethodDiagnostic(
        interfaceNode,
        moduleNode,
        kind,
        method,
        `expected ${comparison.expected || 'unknown'}, found ${comparison.actual || 'unknown'}`,
        comparison.status === 'unresolved' ? 'info' : 'warning'
    ));
}

function methodStatus(expected, actualMethods, diagnostics) {
    if (!expected) return 'unexpected';
    if (actualMethods.length === 0) return 'missing';
    if (actualMethods.length > 1) return 'duplicate';
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) return 'mismatch';
    if (diagnostics.length > 0) return 'unresolved';
    return 'exact';
}

function methodSummary(method) {
    return {
        name: method.name,
        category: method.category || 'unknown',
        parameterCount: (method.parameters || []).length,
        parameters: (method.parameters || []).map((parameter) => ({
            name: parameter.name,
            type: parameter.type
        })),
        returnType: method.returnType || '',
        location: methodLocation(method)
    };
}

function methodSignature(method) {
    const parameters = (method.parameters || []).map((parameter) => parameter.type).join(', ');
    return `${method.returnType || 'unknown'} ${method.name}(${parameters})`;
}

function groupMethods(methods) {
    const result = new Map();
    for (const method of methods) {
        if (!result.has(method.name)) result.set(method.name, []);
        result.get(method.name).push(method);
    }
    return result;
}

function unique(values) {
    return [...new Set(values)];
}

module.exports = {
    buildInterfaceContracts
};
