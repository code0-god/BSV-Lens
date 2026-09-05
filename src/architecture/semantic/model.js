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
        definitions
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

module.exports = {
    buildSemanticModel
};
