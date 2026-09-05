'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');
const {
    assertAquaSemanticArchitecture
} = require('./aqua-semantic-assertions');
const {
    buildSourceReferenceIndex,
    findSourceReferenceAtPosition
} = require('../../src/architecture/semantic/source-references');
const Graph = require('../../media/graph-view');
const SourceResolution = require('../../media/source-resolution');

const SELECTION_TIMEOUT_MS = 5000;

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

function withTimeout(promise, label) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), SELECTION_TIMEOUT_MS);
        })
    ]).finally(() => clearTimeout(timer));
}

function capturePanelMessages(panel) {
    const messages = [];
    const waiters = [];
    const original = panel.panel.webview.postMessage.bind(panel.panel.webview);
    panel.panel.webview.postMessage = (message) => {
        messages.push(message);
        for (const waiter of [...waiters]) {
            if (!waiter.predicate(message)) continue;
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve(message);
        }
        return original(message);
    };
    return {
        messages,
        next(predicate, label) {
            return withTimeout(new Promise((resolve) => waiters.push({ predicate, resolve })), label);
        },
        restore() {
            panel.panel.webview.postMessage = original;
        }
    };
}

function nextExactSelection(uri, line, character) {
    return withTimeout(new Promise((resolve) => {
        const disposable = vscode.window.onDidChangeTextEditorSelection((event) => {
            const active = event.selections[0]?.active;
            if (event.textEditor.document.uri.toString() !== uri.toString()
                || active?.line !== line || active?.character !== character) return;
            disposable.dispose();
            resolve(event);
        });
    }), `editor selection ${line}:${character}`);
}

async function selectAndCaptureReveal(editor, capture, line, character) {
    const selectionChanged = nextExactSelection(editor.document.uri, line, character);
    const revealed = capture.next(
        (message) => message.type === 'revealSource',
        `diagram source reveal for ${line}:${character}`
    );
    const position = new vscode.Position(line, character);
    editor.selection = new vscode.Selection(position, position);
    await selectionChanged;
    return revealed;
}

function canonicalReferenceAt(index, uri, line, column) {
    const match = findSourceReferenceAtPosition(index, {
        uri: uri.toString(),
        line,
        column
    });
    assert.equal(match.status, 'exact');
    assert.equal(match.references.length, 1);
    return match.references[0];
}

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

    const sourceIndex = buildSourceReferenceIndex(panel.model);
    const loopDefinitionReference = canonicalReferenceAt(sourceIndex, activeUri, 209, 11);
    const matmulDeclarationReference = canonicalReferenceAt(sourceIndex, activeUri, 217, 37);
    assert.equal(loopDefinitionReference.kind, 'definition');
    assert.equal(loopDefinitionReference.name, 'mkAquaLoopMatmul');
    assert.equal(matmulDeclarationReference.kind, 'instance-declaration');
    assert.equal(matmulDeclarationReference.name, 'matmul');
    for (const reference of [loopDefinitionReference, matmulDeclarationReference]) {
        assert.equal(reference.presentations.some((item) => item.role === 'channel'), false);
        assert.equal(reference.presentations.some((item) => item.id.startsWith('channel:')), false);
    }

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
    const loopRoot = panel.model.nodes.find((node) =>
        node.name === 'mkAquaLoopMatmul' && node.architectureInstance && node.details?.root
    );
    const matmul = panel.model.nodes.find((node) =>
        node.name === 'matmul' && node.architectureInstance && node.parentId === loopRoot.id
    );
    assert.ok(loopRoot, 'AQuA loop root occurrence is modeled');
    assert.ok(matmul, 'matmul child occurrence is modeled beneath the AQuA loop root');

    const capture = capturePanelMessages(panel);
    const sourceEditor = await vscode.window.showTextDocument(document, {
        preview: false,
        viewColumn: vscode.ViewColumn.One
    });
    const view = Graph.createViewModel(panel.model, {
        sourceScope: 'workspace',
        level: 'system',
        analysisMode: 'structure',
        hopScope: 'all',
        focusStack: [],
        selectedId: null,
        filters: { packages: false, imports: false, rules: true, primitives: false }
    });
    const visible = view.visible();
    const sourceContext = {
        focusInstanceId: null,
        selectedNodeId: null,
        visibleNodeIds: visible.nodes.map((node) => node.id),
        viewNodeIds: visible.nodes.map((node) => node.id)
    };
    const rootReveal = await selectAndCaptureReveal(sourceEditor, capture, 209, 11);
    assert.equal(rootReveal.revision, panel.modelRevision);
    assert.deepEqual(rootReveal.sourceReference, {
        status: 'exact',
        references: [loopDefinitionReference]
    });
    const rootResolution = SourceResolution.resolve(panel.model, rootReveal.sourceReference, sourceContext);
    assert.equal(rootResolution.status, 'visible-exact');
    assert.equal(rootResolution.presentationNodeId, loopRoot.id);
    assert.equal(rootResolution.candidates.some((item) => item.role === 'channel'), false);

    const childReveal = await selectAndCaptureReveal(sourceEditor, capture, 217, 37);
    assert.equal(childReveal.revision, panel.modelRevision);
    assert.deepEqual(childReveal.sourceReference, {
        status: 'exact',
        references: [matmulDeclarationReference]
    });
    const childResolution = SourceResolution.resolve(panel.model, childReveal.sourceReference, sourceContext);
    assert.equal(childResolution.status, 'visible-exact');
    assert.equal(childResolution.presentationNodeId, matmul.id);
    assert.equal(childResolution.candidates.some((item) => item.role === 'channel'), false);
    capture.restore();

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

    const sourceTargets = [
        ['root target definition', loopRoot],
        ['child declaration', matmul],
        ['channel representative source', panel.model.nodes.find((node) =>
            node.kind === 'protocol-channel' && node.parentId === loopRoot.id && node.location?.uri
        )],
        ['endpoint', panel.model.nodes.find((node) =>
            node.kind === 'endpoint' && node.parentId === loopRoot.id && node.location?.uri
        )],
        ['behavior', panel.model.nodes.find((node) =>
            ['rule', 'method'].includes(node.kind) && node.parentId === loopRoot.id && node.location?.uri
        )],
        ['state', panel.model.nodes.find((node) =>
            node.primitive && node.parentId === loopRoot.id && node.location?.uri
        )]
    ];
    for (const [label, target] of sourceTargets) {
        assert.ok(target, `${label} has a diagram presentation with source`);
        await panel.handleMessage({ type: 'openSource', nodeId: target.id });
        assert.equal(vscode.window.activeTextEditor.document.uri.toString(), target.location.uri, `${label} URI`);
        assert.deepEqual(
            [
                vscode.window.activeTextEditor.selection.active.line,
                vscode.window.activeTextEditor.selection.active.character
            ],
            [target.location.line, target.location.column || 0],
            `${label} selection`
        );
    }

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
