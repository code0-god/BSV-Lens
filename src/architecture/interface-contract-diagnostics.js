'use strict';

function makeMethodDiagnostic(interfaceNode, moduleNode, kind, method, detail, severity = 'warning') {
    return makeContractDiagnostic({
        interfaceName: interfaceNode.name,
        moduleName: moduleNode.name,
        kind,
        methodName: method?.name || null,
        severity,
        location: methodLocation(method) || moduleNode.location,
        detail
    });
}

function makeContractDiagnostic(options) {
    const unresolved = options.severity === 'info';
    const subject = options.methodName || options.interfaceName;
    return {
        severity: options.severity,
        code: unresolved ? 'contract.unresolved' : 'contract.mismatch',
        message: [
            unresolved ? 'Interface contract unresolved:' : 'Interface contract mismatch:',
            `${options.interfaceName} -> ${options.moduleName}`,
            `${diagnosticLabel(options.kind)}:`,
            `- ${subject}${options.detail ? ` (${options.detail})` : ''}`
        ].join('\n'),
        location: options.location || null,
        analysisOrigin: 'Source-derived',
        interfaceName: options.interfaceName,
        moduleName: options.moduleName,
        mismatchKind: options.kind,
        methodName: options.methodName
    };
}

function unresolvedProvidedInterfaceContract(interfaceNode, moduleNode, provided) {
    const diagnostic = makeContractDiagnostic({
        interfaceName: interfaceNode.name,
        moduleName: moduleNode.name,
        kind: 'provided-interface-range',
        methodName: null,
        severity: 'info',
        location: provided.location || moduleNode.location,
        detail: `${provided.name} has no matching endinterface`
    });
    return {
        interfaceId: interfaceNode.id,
        moduleId: moduleNode.id,
        interfaceName: interfaceNode.name,
        moduleName: moduleNode.name,
        status: 'unresolved',
        analysisOrigin: 'Source-derived',
        methods: [],
        diagnostics: [diagnostic]
    };
}

function diagnosticLabel(kind) {
    return {
        'missing-method': 'Missing',
        'unexpected-method': 'Unexpected',
        'duplicate-implementation': 'Duplicate',
        'method-category': 'Method category',
        'parameter-count': 'Parameter count',
        'parameter-type': 'Parameter type',
        'return-type': 'Return type',
        'provided-interface-range': 'Provided interface',
        'interface-resolution': 'Resolution'
    }[kind] || 'Mismatch';
}

function contractStatus(diagnostics) {
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) return 'mismatch';
    if (diagnostics.length > 0) return 'unresolved';
    return 'exact';
}

function methodLocation(method) {
    return method?.location || method?.declarationSource || method?.port?.declarationSource || null;
}

module.exports = {
    contractStatus,
    makeContractDiagnostic,
    makeMethodDiagnostic,
    methodLocation,
    unresolvedProvidedInterfaceContract
};
