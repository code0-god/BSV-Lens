'use strict';

const PACKAGE_DEFINITION_NAME = '$package';

function definitionId(packageName, name) {
    return `def:${packageName}:${name}`;
}

function packageDefinitionId(packageName) {
    return definitionId(packageName, PACKAGE_DEFINITION_NAME);
}

function instanceOccurrenceId(rootDefinitionId, path) {
    return `instance:${rootDefinitionId}:${path}`;
}

function constructorBindingId(targetInstanceId, parameterIndex) {
    return `binding:${targetInstanceId}:constructor:${parameterIndex}`;
}

function methodDefinitionId(moduleDefinitionId, methodName, duplicateOrdinal = 0) {
    return `${moduleDefinitionId}.${methodName}${duplicateOrdinal ? `~${duplicateOrdinal}` : ''}`;
}

function endpointId(ownerInstanceId, interfacePath) {
    const path = interfacePath.length ? interfacePath.join('.') : '$interface';
    return `endpoint:${ownerInstanceId}:${path}`;
}

function interfaceForwardBindingId(ownerInstanceId, outerPath) {
    return `binding:${ownerInstanceId}:interface-forward:${outerPath.join('.')}`;
}

function protocolChannelId(ownerInstanceId, key) {
    return `channel:${ownerInstanceId}:${key}`;
}

function behaviorDefinitionId(moduleDefinitionId, kind, name, duplicateOrdinal = 0) {
    const suffix = duplicateOrdinal ? `~${duplicateOrdinal}` : '';
    return kind === 'method' ? methodDefinitionId(moduleDefinitionId, name, duplicateOrdinal)
        : `${moduleDefinitionId}.${kind}.${name}${suffix}`;
}

function stateBehaviorId(ownerInstanceId, kind, name, duplicateOrdinal = 0) {
    return `behavior:${ownerInstanceId}:${kind}:${name}${
        duplicateOrdinal ? `~${duplicateOrdinal}` : ''
    }`;
}

function behaviorAccessBindingId(behaviorId, index) {
    return `binding:${behaviorId}:access:${index}`;
}

function semanticFlowId(kind, fromId, toId, suffix = '') {
    return `flow:${kind}:${fromId}:${toId}${suffix ? `:${suffix}` : ''}`;
}

module.exports = {
    PACKAGE_DEFINITION_NAME,
    definitionId,
    packageDefinitionId,
    instanceOccurrenceId,
    constructorBindingId,
    methodDefinitionId,
    endpointId,
    interfaceForwardBindingId,
    protocolChannelId,
    behaviorDefinitionId,
    stateBehaviorId,
    behaviorAccessBindingId,
    semanticFlowId
};
