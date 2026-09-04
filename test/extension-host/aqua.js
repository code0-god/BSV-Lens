'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');
const {
    assertAquaSemanticArchitecture
} = require('./aqua-semantic-assertions');

const MATMUL_SCHEDULER_METHODS = [
    'startReady',
    'start',
    'publishReady',
    'publishStripe',
    'workValid',
    'currentWork',
    'completeWork',
    'lookaheadValid',
    'lookaheadStripe',
    'completionValid',
    'completion',
    'consumeCompletion'
];

async function run() {
    const extensionRoot = path.resolve(__dirname, '..', '..');
    const workspaceRoot = path.resolve(process.env.AQUA_WORKSPACE);
    const activePath = path.join(workspaceRoot, 'hw', 'bsv', 'src', 'control', 'AquaLoopMatmul.bsv');
    const schedulerPath = path.join(workspaceRoot, 'hw', 'bsv', 'src', 'control', 'MatmulScheduler.bsv');
    const activeUri = vscode.Uri.file(activePath);
    const extension = vscode.extensions.getExtension('code0-god.bsv-lens');
    assert.ok(extension, 'development extension is discoverable');
    await extension.activate();

    const document = await vscode.workspace.openTextDocument(activeUri);
    await vscode.window.showTextDocument(document);
    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', activeUri);
    assert.ok(symbols.some((symbol) => symbol.name === 'AquaLoopMatmul'));

    await vscode.commands.executeCommand('bsvArchitecture.openWorkspace');
    const { ArchitecturePanel } = require(path.join(extensionRoot, 'src', 'panel', 'architecture-panel'));
    const panel = ArchitecturePanel.currentPanel;
    assert.ok(panel, 'AQuA architecture panel opened');
    assertAquaSemanticArchitecture(panel.model);
    assert.equal(panel.model.stats.files, 14);
    assert.ok(panel.model.stats.nodes >= 300);
    assert.ok(panel.model.stats.edges >= 900);
    assert.equal(panel.model.diagnostics.filter((item) => item.severity === 'error').length, 0);
    assert.equal(panel.model.security.workspaceTrusted, vscode.workspace.isTrusted);
    assert.equal(panel.model.security.bscExecutionEnabled, vscode.workspace.isTrusted);
    assert.equal(panel.model.scheduling.provider, 'source');
    assert.ok(panel.model.scheduling.relationCount >= 300);

    for (const name of [
        'mkAquaLoopMatmul',
        'mkAquaMemorySubsystem',
        'mkMatmulScheduler',
        'mkWorkScheduler',
        'mkLoadController',
        'mkStoreController'
    ]) assert.ok(panel.model.nodes.some((node) => node.name === name), `${name} is modeled`);

    const matmulScheduler = panel.model.nodes.find((node) =>
        node.kind === 'module' && node.name === 'mkMatmulScheduler'
    );
    const matmulSchedulerInterface = panel.model.nodes.find((node) =>
        node.kind === 'interface' && node.name === 'MatmulSchedulerIfc'
    );
    assert.ok(matmulScheduler, 'mkMatmulScheduler module is modeled');
    assert.ok(matmulSchedulerInterface, 'MatmulSchedulerIfc interface is modeled');
    const implementationMethods = panel.model.nodes.filter((node) =>
        node.kind === 'method' && node.parentId === matmulScheduler.id
    );
    assert.deepEqual(
        matmulSchedulerInterface.ports.map((method) => method.name),
        MATMUL_SCHEDULER_METHODS
    );
    assert.deepEqual(
        implementationMethods.map((method) => method.name),
        MATMUL_SCHEDULER_METHODS
    );
    const workValid = implementationMethods.find((method) => method.name === 'workValid');
    assert.ok(workValid, 'workValid method is modeled');
    await panel.handleMessage({ type: 'openSource', nodeId: workValid.id });
    assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, schedulerPath);
    assert.equal(vscode.window.activeTextEditor.selection.active.line, workValid.location.line);
    const matmulContract = panel.model.interfaceContracts.find((contract) =>
        contract.moduleId === matmulScheduler.id
    );
    assert.ok(matmulContract, 'MatmulScheduler interface contract is modeled');
    assert.equal(matmulContract.status, 'exact');
    assert.equal(matmulContract.diagnostics.length, 0);
    assert.equal(
        panel.model.nodes.filter((node) => node.kind === 'method' && node.name === 'isValid').length,
        0
    );
    assert.deepEqual(
        panel.model.nodes
            .filter((node) => node.parentId === matmulScheduler.id && node.primitive)
            .map((node) => [node.name, node.kind])
            .sort(([left], [right]) => left.localeCompare(right)),
        [
            ['activeDescriptor', 'register'],
            ['activeStripe', 'register'],
            ['completions', 'fifo'],
            ['nextStripeId', 'register'],
            ['publishedUntil', 'register'],
            ['stripeLookahead', 'register'],
            ['workPosition', 'register']
        ]
    );

    const loop = panel.model.nodes.find((node) => node.name === 'mkAquaLoopMatmul');
    assert.deepEqual(
        {
            methods: loop.details.methodCount,
            rules: loop.details.ruleCount,
            children: loop.details.childInstanceCount
        },
        { methods: 23, rules: 5, children: 2 }
    );
    const descriptor = loop.details.methodPorts
        .find((method) => method.name === 'start')
        .parameters.find((parameter) => parameter.type === 'AquaMatmulDescriptor');
    assert.deepEqual(descriptor.width, {
        bits: 385,
        status: 'exact',
        origin: 'AquaMatmulDescriptor'
    });

    const nodeName = new Map(panel.model.nodes.map((node) => [node.id, node.name]));
    const hasEdge = (kind, source, target, label) => panel.model.edges.some((edge) =>
        edge.kind === kind
        && nodeName.get(edge.source) === source
        && nodeName.get(edge.target) === target
        && (!label || edge.label === label)
    );
    assert.ok(hasEdge('instantiate', 'mkAquaLoopMatmul', 'mkMatmulScheduler', 'matmul'));
    assert.ok(hasEdge('instantiate', 'mkAquaLoopMatmul', 'mkWorkScheduler', 'fragments'));
    assert.ok(hasEdge('invoke', 'beginArrayWork', 'fragments', 'start'));
    assert.ok(hasEdge('invoke', 'finishFragments', 'fragments', 'consumeDone'));
    assert.ok(hasEdge('invoke', 'retireWork', 'matmul', 'completeWork'));
    for (const [instance, target] of [
        ['load', 'mkLoadController'],
        ['staging', 'mkLoadStager'],
        ['accumulators', 'mkAccumulatorMem'],
        ['store', 'mkStoreController']
    ]) assert.ok(hasEdge('instantiate', 'mkAquaMemorySubsystem', target, instance));
    assert.equal(
        panel.model.nodes.some((node) => node.kind === 'module' && /systolic|processingelement/i.test(node.name)),
        false
    );

    await panel.handleMessage({ type: 'openSource', nodeId: loop.id });
    assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, activePath);
    assert.equal(vscode.window.activeTextEditor.selection.active.line, loop.location.line);

    const jsonUri = vscode.Uri.file(path.join(extensionRoot, '.build', 'aqua-architecture.json'));
    const svgUri = vscode.Uri.file(path.join(extensionRoot, '.build', 'aqua-diagram.svg'));
    panel.chooseSaveUri = async (_name, label) => label === 'SVG' ? svgUri : jsonUri;
    await panel.handleMessage({ type: 'exportJson' });
    const exported = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(jsonUri)));
    assert.deepEqual(exported.stats, panel.model.stats);
    assert.equal(exported.nodes.find((node) => node.id === loop.id).name, 'mkAquaLoopMatmul');
    assert.equal(
        exported.interfaceContracts.find((contract) => contract.moduleId === matmulScheduler.id).status,
        'exact'
    );
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>AQuA</text></svg>';
    await panel.handleMessage({ type: 'exportSvg', svg, suggestedName: 'aqua-diagram.svg' });
    assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(svgUri)), svg);

    const refreshToken = panel.refreshToken;
    await panel.handleMessage({ type: 'refresh' });
    assert.equal(panel.refreshToken, refreshToken + 1);
    assert.equal(panel.modelRevision, panel.refreshToken);

    await vscode.commands.executeCommand('bsvArchitecture.openSymbol', {
        uri: activeUri.toString(),
        name: 'mkAquaLoopMatmul',
        kind: 'module'
    });
    assert.equal(panel.resolveInitialFocus(panel.model), loop.id);

    await vscode.commands.executeCommand('bsvArchitecture.openCurrentFile', activeUri);
    assert.equal(panel.request.initialSourceScope, 'current-file');
    assert.equal(panel.model.activeFile, 'hw/bsv/src/control/AquaLoopMatmul.bsv');
    panel.dispose();
}

module.exports = { run };
