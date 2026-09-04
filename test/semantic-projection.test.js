'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');
const Graph = require('../media/graph-view');

function buildGraph() {
    const fixturePath = path.join(
        __dirname,
        'fixtures',
        'semantic-workspace',
        'src',
        'SemanticFlowFixture.bsv'
    );
    const parsed = parseBsvFile(fs.readFileSync(fixturePath, 'utf8'), {
        uri: `file://${fixturePath}`,
        relativePath: 'src/SemanticFlowFixture.bsv'
    });
    return buildArchitectureModel([parsed], normalizeConfig({
        entrypoints: ['mkFlowTop']
    }), {
        workspaceName: 'Semantic Flow',
        workspaceUri: 'file:///semantic-flow',
        limits: { maxNodes: 1000, maxEdges: 2000 }
    });
}

function view(model, state) {
    return Graph.createViewModel(model, {
        sourceScope: 'workspace',
        level: 'system',
        analysisMode: 'structure',
        hopScope: 'all',
        filters: {
            packages: false,
            imports: false,
            rules: true,
            primitives: true
        },
        ...state
    }).visible();
}

test('architecture schema 3 keeps legacy graph fields and canonical semantic truth', () => {
    // Given
    const model = buildGraph();

    // When
    const root = model.instances.find((instance) => instance.root);
    const rootNode = model.nodes.find((node) => node.semanticId === root.id);

    // Then
    assert.equal(model.schemaVersion, 3);
    for (const field of [
        'definitions',
        'instances',
        'endpoints',
        'bindings',
        'protocolChannels',
        'semanticFlows',
        'stateBehaviors',
        'interfaceContracts',
        'diagnostics',
        'provenance',
        'nodes',
        'edges',
        'groups',
        'roots'
    ]) assert.ok(field in model, field);
    assert.ok(model.nodes.some((node) => node.id === 'module:SemanticFlowFixture.mkFlowTop'));
    assert.equal(rootNode.kind, 'instance');
    assert.equal(rootNode.architectureInstance, true);
    assert.equal(rootNode.details.targetDefinitionId, 'def:SemanticFlowFixture:mkFlowTop');
    assert.equal(rootNode.details.constructor, null);
    assert.ok(model.architectureRoots.includes(rootNode.id));
    const nodeIds = new Set(model.nodes.map((node) => node.id));
    assert.ok(model.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)));
    const indexes = Object.getOwnPropertyDescriptor(model, 'semanticIndexes');
    assert.equal(indexes.enumerable, false);
    assert.equal(indexes.value.definitionById.size, model.definitions.length);
    assert.equal(JSON.stringify(model).includes('"semanticIndexes"'), false);
});

test('System Structure defaults to instance architecture while Source Map stays secondary', () => {
    // Given
    const model = buildGraph();

    // When
    const architecture = view(model, {
        level: 'system',
        analysisMode: 'structure'
    });
    const sourceMap = view(model, {
        level: 'system',
        analysisMode: 'structure',
        filters: {
            packages: true,
            imports: false,
            rules: true,
            primitives: true
        }
    });

    // Then
    assert.ok(architecture.nodes.some((node) => node.name === 'scheduler'));
    assert.ok(architecture.nodes.every((node) =>
        node.architectureInstance || node.virtual
    ));
    assert.equal(architecture.nodes.some((node) => node.kind === 'package'), false);
    assert.ok(architecture.edges.some((edge) => edge.kind === 'instance-child'));
    assert.ok(sourceMap.nodes.some((node) => node.kind === 'package'));
    assert.ok(sourceMap.nodes.some((node) => node.kind === 'module'));
});

test('System Data Flow projects typed payload between instance occurrences', () => {
    // Given
    const model = buildGraph();

    // When
    const visible = view(model, {
        level: 'system',
        analysisMode: 'data-flow'
    });
    const byId = new Map(visible.nodes.map((node) => [node.id, node]));
    const flow = visible.edges.find((edge) =>
        edge.kind === 'payload'
        && edge.label === 'ArrayWork#(arrayDim)'
    );

    // Then
    assert.ok(flow);
    assert.equal(byId.get(flow.source).name, 'scheduler');
    assert.equal(byId.get(flow.target).name, 'worker');
    assert.equal(flow.analysisOrigin, 'Source-derived');
    assert.ok(flow.sourceLocation);
});

test('Module Structure groups protocol channels state methods and child instances', () => {
    // Given
    const model = buildGraph();
    const scheduler = model.nodes.find((node) =>
        node.architectureInstance && node.name === 'scheduler'
    );
    const root = model.nodes.find((node) =>
        node.architectureInstance && node.details.root
    );

    // When
    const schedulerView = view(model, {
        level: 'module',
        analysisMode: 'structure',
        focusStack: [scheduler.id]
    });
    const rootView = view(model, {
        level: 'module',
        analysisMode: 'structure',
        focusStack: [root.id]
    });

    // Then
    assert.ok(schedulerView.nodes.some((node) =>
        node.kind === 'member-group' && node.label === 'Protocol Channels'
    ));
    assert.ok(schedulerView.nodes.some((node) =>
        node.kind === 'member-group' && node.label === 'State'
    ));
    assert.ok(schedulerView.nodes.some((node) =>
        node.kind === 'member-group' && node.label === 'Methods'
    ));
    assert.ok(rootView.nodes.some((node) =>
        node.kind === 'member-group' && node.label === 'Child Instances'
    ));
    assert.ok(rootView.nodes.some((node) =>
        node.architectureInstance && node.name === 'scheduler'
    ));
    assert.ok(rootView.nodes.some((node) =>
        node.architectureInstance && node.name === 'worker'
    ));
    assert.equal(rootView.nodes.some((node) =>
        node.kind === 'instance-group' && node.count === 1
    ), false);
});

test('Behavior view exposes rules state endpoint links and source evidence', () => {
    // Given
    const model = buildGraph();
    const root = model.nodes.find((node) =>
        node.architectureInstance && node.details.root
    );

    // When
    const visible = view(model, {
        level: 'behavior',
        analysisMode: 'data-flow',
        focusStack: [root.id]
    });

    // Then
    assert.ok(visible.nodes.some((node) => node.kind === 'rule' && node.name === 'bridge'));
    assert.ok(visible.nodes.some((node) => node.kind === 'endpoint' && node.name === 'currentWork'));
    assert.ok(visible.edges.some((edge) =>
        edge.kind === 'payload'
        && edge.evidence
        && edge.sourceLocation
    ));
});
