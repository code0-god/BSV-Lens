'use strict';

const {
    PACKAGE_DEFINITION_NAME,
    definitionId,
    packageDefinitionId
} = require('./ids');

const SOURCE_ORIGIN = 'Source-derived';

function buildDefinitions(parsedFiles) {
    return parsedFiles.flatMap(definitionsForFile);
}

function definitionsForFile(file) {
    const packageName = file.packageName;
    const localFunctions = groupLocalFunctions(file.functions || []);
    return [
        packageDefinition(file),
        ...(file.interfaces || []).map((item) => interfaceDefinition(packageName, file, item)),
        ...(file.modules || []).map((item) => moduleDefinition(
            packageName,
            file,
            item,
            localFunctions.get(item.name) || []
        )),
        ...(file.types || []).map((item) => typeDefinition(packageName, file, item)),
        ...(file.functions || []).map((item) => functionDefinition(packageName, file, item))
    ];
}

function packageDefinition(file) {
    return sourceDefinition(file, {
        id: packageDefinitionId(file.packageName),
        kind: 'package-definition',
        packageName: file.packageName,
        name: file.packageName,
        idName: PACKAGE_DEFINITION_NAME,
        imports: file.imports || [],
        exports: file.exports || [],
        annotations: file.packageAnnotations || {},
        bsvAttributes: file.bsvAttributes || [],
        location: file.packageLocation || null,
        sourceRange: file.packageSourceRange || null
    });
}

function interfaceDefinition(packageName, file, item) {
    return sourceDefinition(file, {
        ...item,
        id: definitionId(packageName, item.name),
        kind: 'interface-definition',
        packageName,
        typeParameters: item.typeParameters || [],
        methods: item.methods || [],
        subinterfaces: item.subinterfaces || []
    });
}

function moduleDefinition(packageName, file, item, localFunctions) {
    const childInstanceDeclarations = item.instances || [];
    return sourceDefinition(file, {
        ...item,
        id: definitionId(packageName, item.name),
        kind: 'module-definition',
        packageName,
        returnInterface: item.returnInterfaceExpression || item.returnInterface || null,
        typeParameters: item.typeParameters || [],
        constructorParameters: item.constructorParameters || [],
        provisos: item.provisos || [],
        childInstanceDeclarations,
        methods: item.methods || [],
        rules: item.rules || [],
        localFunctions: localFunctions.map((local) => ({
            ...local,
            id: definitionId(packageName, `${item.name}.${local.name}`)
        })),
        stateDeclarations: childInstanceDeclarations.filter((instance) => Boolean(instance.primitiveKind)),
        providedInterfaces: item.providedInterfaces || []
    });
}

function typeDefinition(packageName, file, item) {
    const ownerDefinitionId = item.parentModuleName
        ? definitionId(packageName, item.parentModuleName)
        : null;
    return sourceDefinition(file, {
        ...item,
        id: definitionId(
            packageName,
            item.parentModuleName ? `${item.parentModuleName}.${item.name}` : item.name
        ),
        kind: 'type-definition',
        definitionKind: item.kind,
        packageName,
        ownerDefinitionId
    });
}

function functionDefinition(packageName, file, item) {
    const ownerDefinitionId = item.parentModuleName
        ? definitionId(packageName, item.parentModuleName)
        : null;
    return sourceDefinition(file, {
        ...item,
        id: definitionId(
            packageName,
            item.parentModuleName ? `${item.parentModuleName}.${item.name}` : item.name
        ),
        kind: 'function-definition',
        packageName,
        ownerDefinitionId
    });
}

function sourceDefinition(file, definition) {
    return {
        relativePath: file.relativePath,
        uri: file.uri,
        analysisOrigin: SOURCE_ORIGIN,
        ...definition
    };
}

function groupLocalFunctions(functions) {
    const result = new Map();
    for (const item of functions) {
        if (!item.parentModuleName) continue;
        const values = result.get(item.parentModuleName) || [];
        values.push(item);
        result.set(item.parentModuleName, values);
    }
    return result;
}

module.exports = {
    SOURCE_ORIGIN,
    buildDefinitions,
    definitionsForFile
};
