'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { createHardwarePanels } = require('../src/panel/hardware-panel');
const { loadNativeInput } = require('../src/hardware/native-input');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function editorDocument(uri, text) {
    const offsetAt = position => text.split('\n').slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character;
    return { uri, version: 1, isDirty: false,
        positionAt(offset) { const before = text.slice(0, offset).split('\n'); return { line: before.length - 1, character: before.at(-1).length }; },
        getText(range) { return range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text; } };
}
function event() {
    const listeners = new Set();
    return { subscribe(callback) { listeners.add(callback); return { dispose() { listeners.delete(callback); } }; },
        fire(value) { return Promise.all([...listeners].map(callback => callback(value))); }, count: () => listeners.size };
}
class Uri {
    constructor(value) { this.value = new URL(value); this.scheme = this.value.protocol.slice(0, -1); this.authority = this.value.host; this.path = this.value.pathname; }
    static file(value) { return new Uri(pathToFileURL(value)); }
    static joinPath(base, ...values) { return Uri.file(path.join(base.fsPath, ...values)); }
    get fsPath() { return fileURLToPath(this.value); }
    toString() { return this.value.href; }
}
async function fixture(t) {
    const runs = path.resolve(__dirname, '../.build/hardware/runs'); await fs.mkdir(runs, { recursive: true });
    const run = path.join(await fs.mkdtemp(path.join(runs, 'g6-panel-lifecycle-')), 'g6'); await fs.mkdir(run);
    const extensionRoot = path.join(run, 'api-boundary-extension'); await fs.mkdir(extensionRoot);
    await fs.mkdir(path.join(extensionRoot, 'src')); await fs.mkdir(path.join(extensionRoot, 'media'));
    await fs.writeFile(path.join(extensionRoot, 'package.json'), JSON.stringify({ publisher: 'test-only', name: 'lifecycle-boundary', version: '0.0.0' }));
    await fs.writeFile(path.join(extensionRoot, 'src/entry.js'), "'use strict'; // Test-only build inventory, never installed.\n");
    await fs.copyFile(path.resolve(__dirname, '../media/hardware-native.html'), path.join(extensionRoot, 'media/hardware-native.html'));
    const selection = event(), document = event(), theme = event(), panels = [], output = [], writes = [];
    const control = { workspacePick: null, write: null, providerDisposed: 0 };
    const folder = { name: 'Test workspace', uri: Uri.file(run) };
    const vscode = { Uri, UIKind: { Web: 2 }, ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 }, env: { uiKind: 1 }, version: 'api-boundary-mock',
        workspace: { workspaceFolders: [folder],
            registerTextDocumentContentProvider() { return { dispose() { control.providerDisposed++; } }; },
            onDidChangeTextDocument: document.subscribe,
            fs: { async writeFile(uri, bytes) { writes.push({ uri: uri.toString(), bytes: bytes.length }); await control.write?.promise; } } },
        window: { activeColorTheme: { kind: 2 }, onDidChangeTextEditorSelection: selection.subscribe,
            onDidChangeActiveColorTheme: theme.subscribe,
            showWorkspaceFolderPick: () => control.workspacePick.promise,
            showSaveDialog: async () => Uri.file(path.join(run, 'approved-export.svg')),
            createWebviewPanel(_viewType, _title, showColumn) {
                const message = event(), view = event(), closing = event(), sent = [];
                const panel = { visible: true, active: true, disposed: false, showColumn, sent, message, view, closing, revealCalls: [],
                    onDidChangeViewState: view.subscribe, onDidDispose: closing.subscribe,
                    reveal(viewColumn, preserveFocus) { this.revealCalls.push({ viewColumn, preserveFocus }); this.visible = true; this.active = !preserveFocus; },
                    dispose() { if (!this.disposed) { this.disposed = true; this.visible = false; this.active = false; void closing.fire(); } },
                    webview: { cspSource: 'test-webview:', options: {}, html: '', asWebviewUri: value => value,
                        onDidReceiveMessage: message.subscribe, postMessage(value) { sent.push(value); return Promise.resolve(true); } } };
                panels.push(panel); return panel;
            } } };
    const context = { extensionPath: extensionRoot, extensionUri: Uri.file(extensionRoot), extensionMode: 2,
        workspaceState: { get: () => undefined, update: async () => {} } };
    const manager = createHardwarePanels({ vscode, context, output: { appendLine: value => output.push(value) } });
    t.after(() => manager.dispose()); t.diagnostic(`VS Code API-boundary mock evidence only: ${run}`);
    return { run, manager, panels, control, vscode, context, folder, writes,
        listenerCount: () => selection.count() + document.count() + theme.count() + panels.reduce((n, panel) => n + panel.message.count() + panel.view.count() + panel.closing.count(), 0) };
}
async function opened(f) {
    const entry = await f.manager.open(), panel = f.panels[0], identity = entry.protocol.identity();
    await panel.message.fire({ protocol: identity.protocol, panelId: null, sessionId: null, buildId: identity.buildId,
        requestId: 'hello', generation: 0, snapshotId: null, action: 'hello',
        payload: { expectedBuildId: identity.buildId, expectedProtocol: identity.protocol } });
    assert.equal(panel.sent.at(-1).action, 'welcome'); return { entry, panel };
}

test('native Hardware Schematic opens in the second editor column and reuses that panel', async t => {
    const f = await fixture(t); await opened(f);
    assert.equal(f.panels[0].showColumn, f.vscode.ViewColumn.Two);
    await f.manager.open(); assert.equal(f.panels.length, 1);
});

test('manager cleanup is one promise and waits for work in a panel already closing', async t => {
    const f = await fixture(t), { entry, panel } = await opened(f);
    f.control.write = deferred();
    const request = panel.message.fire({ ...entry.protocol.identity(), requestId: 'export-pending', snapshotId: null,
        action: 'export-svg', payload: { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', suggestedName: 'test.svg' } });
    await tick(); assert.equal(f.writes.length, 1);
    panel.dispose(); const panelCleanup = entry.dispose(); assert.equal(entry.dispose(), panelCleanup);
    assert.equal(f.manager.getDiagnostics().activePanels, 0); assert.equal(f.manager.getDiagnostics().closingPanels, 1);
    const cleanup = f.manager.dispose(); assert.equal(f.manager.dispose(), cleanup);
    let settled = false; cleanup.then(() => { settled = true; }); await tick();
    assert.equal(settled, false); assert.equal(f.control.providerDisposed, 0); assert.equal(f.listenerCount(), 0);
    const sentBefore = panel.sent.length;
    f.control.write.resolve(); await Promise.all([request, cleanup, panelCleanup]);
    assert.equal(settled, true); assert.equal(f.control.providerDisposed, 1); assert.equal(panel.sent.length, sentBefore);
    const diagnostics = f.manager.getDiagnostics(); assert.equal(diagnostics.closingPanels, 0);
    assert.equal(diagnostics.retired.length, 1); assert.equal(diagnostics.retired[0].state.activeOperations, 0);
    assert.equal(diagnostics.retired[0].listeners, 0); assert.equal(diagnostics.retired[0].watchers, 0);
});
test('manager disposal settles live panels once and blocks subsequent native creation', async t => {
    const f = await fixture(t); await opened(f);
    const first = f.manager.dispose(), concurrent = f.manager.dispose(); assert.equal(first, concurrent);
    await first; assert.equal(f.control.providerDisposed, 1); assert.equal(f.listenerCount(), 0);
    assert.equal(await f.manager.open(), undefined); assert.equal(f.panels.length, 1);
    assert.equal(f.manager.getDiagnostics().retired.length, 1);
});
test('workspace choice completing after manager disposal cannot create a native panel', async t => {
    const f = await fixture(t);
    f.vscode.workspace.workspaceFolders.push({ name: 'Second workspace', uri: Uri.file(path.join(f.run, 'second')) });
    f.control.workspacePick = deferred();
    const pending = f.manager.open(); await tick(); assert.equal(f.panels.length, 0);
    await f.manager.dispose(); f.control.workspacePick.resolve(f.folder);
    assert.equal(await pending, undefined); assert.equal(f.panels.length, 0); assert.equal(f.listenerCount(), 0);
    assert.equal(f.control.providerDisposed, 1);
});
test('revival after disposal closes only supplied stale panel and installs no listeners', async t => {
    const f = await fixture(t); await f.manager.dispose(); let staleDisposed = 0;
    assert.equal(await f.manager.revive({ dispose() { staleDisposed++; } }, { schema: 1, view: null }), undefined);
    assert.equal(staleDisposed, 1); assert.equal(f.panels.length, 0); assert.equal(f.listenerCount(), 0);
    assert.equal(f.manager.getDiagnostics().activePanels, 0);
});

async function savedWorkspace(f) {
    const sourceRoot = path.join(f.run, 'source'); await fs.mkdir(sourceRoot);
    await fs.writeFile(path.join(sourceRoot, 'Saved.bsv'), 'package Saved; module mkSaved(Empty); Reg#(Bit#(8)) state <- mkReg(0); endmodule endpackage');
    const input = await loadNativeInput({ sourceRoot }), entry = input.catalog[0].getCatalogEntry();
    const scene = input.catalog[0].getScene({ buildId: entry.buildId, snapshotId: null, queryGeneration: 1,
        sceneKind: 'bsv', rootInstanceId: entry.rootInstanceId }).scene;
    const saved = { schema: 1, inputIdentity: input.inputIdentity, view: { buildId: entry.buildId, snapshotId: null,
        sourceRevision: scene.sourceRevision, sceneKind: 'bsv', provider: 'stock', rootInstanceId: entry.rootInstanceId,
        ownerInstanceId: entry.rootInstanceId, selectedEntityId: scene.storages[0].id, selectedRelationId: null,
        viewport: { x: 11, y: 23, scale: 1.25 }, activePanel: 'inspector', disclosureState: { capabilities: true }, query: null } };
    const store = new Map([[`bsvArchitecture.hardwareSchematic.v1:${f.folder.uri.toString()}`, saved]]);
    f.context.workspaceState.get = key => store.get(key);
    f.vscode.window.showQuickPick = async choices => choices.find(choice => choice.root === f.run);
    f.vscode.window.showInputBox = async () => 'source';
    f.vscode.RelativePattern = class { constructor(base, pattern) { this.baseUri = base; this.pattern = pattern; } };
    f.vscode.workspace.createFileSystemWatcher = () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} });
    return { saved, store };
}
async function reviveAndRegister(f, state) {
    const panel = f.vscode.window.createWebviewPanel(), entry = await f.manager.revive(panel, state), identity = entry.protocol.identity();
    await panel.message.fire({ protocol: identity.protocol, panelId: null, sessionId: null, buildId: identity.buildId,
        requestId: 'hello', generation: 0, snapshotId: null, action: 'hello',
        payload: { expectedBuildId: identity.buildId, expectedProtocol: identity.protocol } });
    assert.equal(entry.session.getInput(), null); assert.deepEqual(entry.session.getCatalog(), []);
    assert.equal(panel.sent.at(-1).payload.restoreState, null); assert.equal(f.manager.getDiagnostics().sessions[0].watchers, 0);
    await panel.message.fire({ ...entry.protocol.identity(), requestId: 'explicit-registration', snapshotId: null, action: 'choose-source', payload: {} });
    assert.equal(panel.sent.find(message => message.requestId === 'explicit-registration').status, 'ok');
    return { entry, event: panel.sent.findLast(message => message.kind === 'event' && message.action === 'catalog') };
}
test('revived native panel restores only the Host memento after explicit input registration', async t => {
    const f = await fixture(t), { saved } = await savedWorkspace(f), before = structuredClone(saved);
    const webview = { schema: 1, inputIdentity: 'forged', view: { ...saved.view, selectedEntityId: 'foreign-object',
        sourceRevision: 'foreign-revision', viewport: { x: 999, y: 999, scale: 9 }, query: { kind: 'forged' } } };
    const result = await reviveAndRegister(f, webview);
    assert.equal(result.entry.key, f.folder.uri.toString());
    assert.ok(result.event.payload.restoreState, 'Verified Host memento must survive revival and explicit registration');
    assert.deepEqual(JSON.parse(JSON.stringify(result.event.payload.restoreState)), { schema: 1, view: saved.view });
    assert.equal(result.entry.session.getInput().inputIdentity, saved.inputIdentity); assert.deepEqual(saved, before);
});
test('unknown or ambiguous revived state cannot select a workspace or restore an untrusted memento', async t => {
    for (const variant of ['unknown-schema', 'foreign-build', 'ambiguous-workspace']) {
        const f = await fixture(t), { saved, store } = await savedWorkspace(f);
        const state = { schema: variant === 'unknown-schema' ? 2 : 1, view: { buildId: variant === 'foreign-build' ? 'foreign-build' : saved.view.buildId } };
        if (variant === 'ambiguous-workspace') {
            const folder = { name: 'Second workspace', uri: Uri.file(path.join(f.run, 'second')) };
            f.vscode.workspace.workspaceFolders.push(folder); store.set(`bsvArchitecture.hardwareSchematic.v1:${folder.uri.toString()}`, structuredClone(saved));
        }
        const result = await reviveAndRegister(f, state);
        assert.match(result.entry.key, /^unregistered-restore:/); assert.equal(result.event.payload.restoreState, undefined);
    }
});

async function automaticWorkspace(f, text) {
    const file = path.join(f.run, 'Workspace.bsv'); await fs.writeFile(file, text);
    f.vscode.RelativePattern = class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } };
    f.vscode.CancellationTokenSource = class {
        constructor() { this.token = { isCancellationRequested: false }; }
        cancel() { this.token.isCancellationRequested = true; }
        dispose() {}
    };
    Object.assign(f.vscode.workspace, {
        getConfiguration: namespace => ({ get: (_key, fallback) => namespace === 'files' ? {} : fallback }),
        findFiles: async () => [Uri.file(file)], textDocuments: [],
        onDidSaveTextDocument: event().subscribe, onDidChangeConfiguration: event().subscribe,
        onDidChangeWorkspaceFolders: event().subscribe,
        createFileSystemWatcher() {
            return { onDidChange: event().subscribe, onDidCreate: event().subscribe, onDidDelete: event().subscribe, dispose() {} };
        }
    });
    const picks = [];
    f.vscode.window.showQuickPick = async (choices, options) => {
        picks.push({ choices, options }); return choices.find(choice => choice.label === 'mkController') || choices[0];
    };
    const openAndDiscover = async () => {
        const { entry, panel } = await opened(f);
        await panel.message.fire({ ...entry.protocol.identity(), requestId: 'automatic-discovery', snapshotId: null, action: 'discover-workspace', payload: {} });
        const result = panel.sent.find(message => message.requestId === 'automatic-discovery');
        assert.equal(result.status, 'ok'); return { entry, panel, picks };
    };
    return { file, openAndDiscover };
}
test('source reveal survives the right Webview losing visibility while the left editor opens', async t => {
    const f = await fixture(t), automatic = await automaticWorkspace(f,
        'package Focus; module mkFocus(Empty); Reg#(Bit#(8)) state <- mkReg(0); endmodule endpackage');
    const { entry, panel } = await automatic.openAndDiscover(), input = entry.session.getInput(), query = input.catalog[0];
    const catalog = query.getCatalogEntry(), scene = query.getScene({ buildId: catalog.buildId, snapshotId: null, queryGeneration: 0 }).scene;
    const reference = scene.shell.sourceRefs[0], text = await fs.readFile(automatic.file, 'utf8');
    const document = editorDocument(Uri.file(automatic.file), text);
    f.vscode.Selection = class { constructor(start, end) { this.start = start; this.end = end; } };
    f.vscode.TextEditorRevealType = { InCenterIfOutsideViewport: 2 };
    f.vscode.workspace.openTextDocument = async () => document;
    let editor;
    f.vscode.window.showTextDocument = async (_document, options) => {
        panel.active = false; panel.visible = false; await panel.view.fire();
        editor = { document, options, selection: null, revealRange(range) { this.revealed = range; } }; return editor;
    };
    await panel.message.fire({ ...entry.protocol.identity(), requestId: 'source-open-focus-change', snapshotId: null,
        action: 'source-open', payload: { buildId: catalog.buildId, reference } });
    const response = panel.sent.find(message => message.requestId === 'source-open-focus-change');
    assert.equal(response.status, 'ok'); assert.equal(editor.options.viewColumn, f.vscode.ViewColumn.One);
    assert.equal(editor.revealed, editor.selection); assert.equal(panel.visible, true); assert.equal(panel.active, false);
    assert.deepEqual(panel.revealCalls.at(-1), { viewColumn: f.vscode.ViewColumn.Two, preserveFocus: true });
});
test('one source root opens automatically even when its child module definitions are separate design entries', async t => {
    const f = await fixture(t), automatic = await automaticWorkspace(f,
        'package Control; module mkLeaf(Empty); endmodule module mkController(Empty); Empty west <- mkLeaf; endmodule endpackage');
    const { entry, picks } = await automatic.openAndDiscover();
    assert.equal(entry.session.getInput().summary.sourceEntries.length, 2);
    assert.equal(entry.session.getInput().summary.sourceEntries.filter(entry => entry.rootCandidate).length, 1);
    assert.equal(entry.session.getInput().selectedSourceEntry.definitionId, 'def:Control:mkController');
    assert.equal(picks.length, 0);
});
test('multiple source roots still require an explicit design choice', async t => {
    const f = await fixture(t), automatic = await automaticWorkspace(f,
        'package Control; module mkLeaf(Empty); endmodule module mkController(Empty); Empty west <- mkLeaf; endmodule module mkMaintenance(Empty); endmodule endpackage');
    const { entry, picks } = await automatic.openAndDiscover();
    assert.equal(entry.session.getInput().summary.sourceEntries.filter(entry => entry.rootCandidate).length, 2);
    assert.equal(picks.length, 1); assert.equal(picks[0].options.title, 'Choose a source design');
    assert.equal(picks[0].choices.find(choice => choice.label === 'mkLeaf').detail, 'Used inside another source module.');
    assert.equal(picks[0].choices.find(choice => choice.label === 'mkController').detail, 'No parent instance found in the analyzed sources.');
});
test('closing the source design picker retains discovered-file status and supports choosing again', async t => {
    const f = await fixture(t);
    await automaticWorkspace(f, 'package Choice; module mkFirst(Empty); endmodule module mkSecond(Empty); endmodule endpackage');
    f.vscode.window.showQuickPick = async () => undefined;
    const { entry, panel } = await opened(f);
    const discover = requestId => panel.message.fire({ ...entry.protocol.identity(), requestId, snapshotId: null,
        action: 'discover-workspace', payload: {} });
    await discover('cancel-source-design');
    const cancelled = panel.sent.find(message => message.requestId === 'cancel-source-design');
    assert.equal(cancelled.status, 'ok');
    assert.equal(cancelled.payload.status, 'selection-required');
    assert.equal(cancelled.payload.sourceFiles, 1); assert.equal(cancelled.payload.designs, 2);
    assert.equal(entry.session.getInput(), null); assert.deepEqual(entry.session.getCatalog(), []);
    const notice = panel.sent.find(message => message.kind === 'event' && message.action === 'source-selection');
    assert.deepEqual(notice.payload, { ...cancelled.payload });
    f.vscode.window.showQuickPick = async choices => choices.find(choice => choice.label === 'mkSecond');
    await discover('retry-source-design');
    assert.equal(panel.sent.find(message => message.requestId === 'retry-source-design').status, 'ok');
    assert.equal(entry.session.getInput().selectedSourceEntry.definitionId, 'def:Choice:mkSecond');
});
test('a cancelled native request cannot publish a late source-picker recovery notice', async t => {
    const f = await fixture(t);
    await automaticWorkspace(f, 'package Choice; module mkFirst(Empty); endmodule module mkSecond(Empty); endmodule endpackage');
    let entered, release;
    const showing = new Promise(resolve => { entered = resolve; });
    f.vscode.window.showQuickPick = () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const { entry, panel } = await opened(f);
    const pending = panel.message.fire({ ...entry.protocol.identity(), requestId: 'pending-source-choice', snapshotId: null,
        action: 'discover-workspace', payload: {} });
    await showing;
    await panel.message.fire({ ...entry.protocol.identity(), requestId: 'abort-choice', snapshotId: null,
        action: 'cancel', payload: { targetRequestId: 'pending-source-choice' } });
    release(undefined); await pending;
    assert.equal(panel.sent.find(message => message.requestId === 'pending-source-choice').status, 'cancelled');
    assert.equal(panel.sent.some(message => message.action === 'source-selection'), false);
    assert.equal(entry.session.getInput(), null);
});
test('an older chooser response cannot replace newer discovery progress while delivery is pending', async t => {
    const f = await fixture(t);
    await automaticWorkspace(f, 'package Choice; module mkFirst(Empty); endmodule module mkSecond(Empty); endmodule endpackage');
    const sent = deferred(), deliver = deferred(), secondOpened = deferred(), secondChoice = deferred();
    let choices = 0;
    f.vscode.window.showQuickPick = async () => { if (++choices === 1) return undefined;
        secondOpened.resolve(); return secondChoice.promise; };
    const { entry, panel } = await opened(f), post = panel.webview.postMessage;
    panel.webview.postMessage = async message => {
        if (message.requestId === 'first-choice') { sent.resolve(); await deliver.promise; }
        return post(message);
    };
    const discover = requestId => panel.message.fire({ ...entry.protocol.identity(), requestId, snapshotId: null,
        action: 'discover-workspace', payload: {} });
    const first = discover('first-choice'); await sent.promise;
    const second = discover('second-choice'); await secondOpened.promise;
    deliver.resolve(); await first;
    const staleNotice = panel.sent.some(message => message.action === 'source-selection');
    secondChoice.resolve(undefined); await second;
    assert.equal(staleNotice, false);
    assert.equal(panel.sent.filter(message => message.action === 'source-selection').length, 1);
});
test('an unmatched previous source URI requires a choice even when only one source design remains', async t => {
    const f = await fixture(t), automatic = await automaticWorkspace(f, 'package Single; module mkOnly(Empty); endmodule endpackage');
    f.context.workspaceState.get = () => ({ schema: 1, inputIdentity: 'previous-input', view: null,
        sourceEntry: { pathRef: 'Foreign.bsv', revision: '0'.repeat(64), definitionId: 'def:Single:mkOnly' } });
    const { entry, picks } = await automatic.openAndDiscover();
    assert.equal(entry.session.getInput().summary.sourceEntries.length, 1);
    assert.equal(picks.length, 1); assert.equal(picks[0].choices.length, 1);
});
test('a limited source index never treats its sole returned root candidate as the only available design', async t => {
    const f = await fixture(t), cycles = Array.from({ length: 1023 }, (_, i) =>
        `module mkCycle${i}(Empty); Empty peer <- mkCycle${(i + 1) % 1023}; endmodule`).join('\n');
    await automaticWorkspace(f, 'package Bounded; module mkController(Empty); Empty leaf <- mkLeaf; endmodule\n'
        + `module mkLeaf(Empty); endmodule\n${cycles}\nendpackage`);
    const picks = [];
    f.vscode.window.showQuickPick = async (choices, options) => { picks.push({ choices, options }); return undefined; };
    const { entry, panel } = await opened(f);
    await panel.message.fire({ ...entry.protocol.identity(), requestId: 'limited-discovery', snapshotId: null, action: 'discover-workspace', payload: {} });
    assert.equal(picks.length, 1); assert.equal(picks[0].choices.length, 1024);
    assert.match(picks[0].options.placeHolder, /1024/); assert.match(picks[0].options.placeHolder, /1025/);
    assert.match(picks[0].options.placeHolder, /limit|scope/i);
    const result = panel.sent.find(message => message.requestId === 'limited-discovery');
    assert.equal(result.status, 'ok'); assert.equal(result.payload.status, 'selection-required');
    assert.equal(result.payload.designs, 1025);
    assert.equal(entry.session.getInput(), null);
});
