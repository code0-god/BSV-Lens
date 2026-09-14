'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const vscode = require('vscode');
const { runtimeInventory, inventoryFromEntries } = require('../native-runtime.cjs');
const { editorColumn } = require('./editor-column.cjs');

const TARGET = 'code0-god.bsv-lens';
const COMMANDS = new Set(['bsvArchitecture.openHardwareSchematic', 'bsvArchitecture.openWorkspace']);
const UI_COMMANDS = new Set(['workbench.action.closeActiveEditor', 'workbench.action.focusFirstEditorGroup',
    'workbench.action.focusSecondEditorGroup', 'workbench.action.evenEditorWidths', 'workbench.action.toggleSidebarVisibility',
    'workbench.action.toggleAuxiliaryBar', 'workbench.action.closePanel']);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const required = name => { assert.ok(process.env[name], `${name} is required`); return process.env[name]; };
let observerContext;

function activate(context) {
    observerContext = context;
    if (process.env.G6_OBSERVER_AUTORUN === '1') {
        run({ automatic: true }).catch(error => console.error(error?.stack || error))
            .then(() => vscode.commands.executeCommand('workbench.action.quit'))
            .catch(error => console.error(`Observer quit failed: ${error?.message || error}`));
    }
}
function within(root, file) { const relative = path.relative(root, file); return !relative.startsWith('..') && !path.isAbsolute(relative); }
function rangeValue(range) {
    return { start: { line: range.start.line, character: range.start.character }, end: { line: range.end.line, character: range.end.character } };
}
function editorValue(editor) {
    const document = editor.document, text = document.getText(), selection = editor.selection;
    const selected = document.getText(selection);
    return { uri: document.uri.toString(), version: document.version, dirty: document.isDirty,
        languageId: document.languageId, eol: document.eol, fullTextSha256: digest(text), utf8Bytes: Buffer.byteLength(text),
        selection: rangeValue(selection), active: { line: selection.active.line, character: selection.active.character },
        anchor: { line: selection.anchor.line, character: selection.anchor.character }, selectionText: selected.slice(0, 65536),
        selectionTextTruncated: selected.length > 65536, selectionSha256: digest(selected), viewColumn: editor.viewColumn,
        visibleRanges: editor.visibleRanges.map(rangeValue) };
}
function validatedRange(document, payload) {
    const start = payload.start, end = payload.end || start;
    for (const point of [start, end]) assert.ok(point && Number.isSafeInteger(point.line) && point.line >= 0
        && Number.isSafeInteger(point.character) && point.character >= 0, 'Invalid test cursor/range');
    const range = new vscode.Range(start.line, start.character, end.line, end.character);
    assert.deepEqual(rangeValue(document.validateRange(range)), rangeValue(range), 'Test range is outside document');
    return range;
}

async function run({ automatic = false } = {}) {
    const port = Number(required('G6_OBSERVER_PORT')), token = required('G6_OBSERVER_TOKEN');
    assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid observer port');
    const extensionsRoot = fs.realpathSync(required('G6_EXTENSIONS_DIR'));
    const targetMode = required('G6_TARGET_MODE');
    const targetVersion = required('G6_TARGET_VERSION');
    assert.ok(['installed', 'development'].includes(targetMode), 'Explicit target mode required');
    const expectedRoot = targetMode === 'development' ? fs.realpathSync(required('G6_TARGET_ROOT')) : null;
    const sourceRoot = fs.realpathSync(required('G6_WORKSPACE_ROOT'));
    const documentRoots = new Set([sourceRoot]);
    const channel = await connect(port, token);
    const subscriptions = [], edited = new Map();
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    try {
        if (!automatic) await vscode.extensions.getExtension('bsv-lens-tests.bsv-lens-g6-observer').activate();
        const target = vscode.extensions.getExtension(TARGET);
        assert.ok(target, `${TARGET} target unavailable`);
        const extensionPath = fs.realpathSync(target.extensionPath);
        if (targetMode === 'installed') assert.ok(within(extensionsRoot, extensionPath) && extensionPath !== extensionsRoot, 'Target did not load from isolated VSIX installation');
        else assert.equal(extensionPath, expectedRoot, 'Development target did not load from explicit source root');
        assert.equal(target.packageJSON.version, targetVersion);
        const targetApi = await target.activate();
        const open = async (payload, reverse = false) => {
            assert.equal(typeof payload.path, 'string', 'Test document path required');
            const file = fs.realpathSync(path.resolve(payload.path));
            assert.ok([...documentRoots].some(root => within(root, file)), 'Test document is outside explicit workspace');
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
            const editor = await vscode.window.showTextDocument(document, { preview: false, viewColumn: editorColumn(vscode, document, reverse) });
            return { document, editor };
        };
        subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => channel.send({
            type: 'editorSelection', cause: event.kind ?? null, editor: editorValue(event.textEditor)
        })), vscode.workspace.onDidChangeTextDocument(event => channel.send({
            type: 'documentChange', uri: event.document.uri.toString(), version: event.document.version,
            dirty: event.document.isDirty, fullTextSha256: digest(event.document.getText())
        })));
        channel.onMessage(async message => {
            try {
                let result;
                switch (message.action) {
                case 'openProductCommand':
                    assert.ok(COMMANDS.has(message.payload?.command), 'Test product command is not allowed');
                    await vscode.commands.executeCommand(message.payload.command);
                    result = { command: message.payload.command };
                    if (message.payload.command === 'bsvArchitecture.openHardwareSchematic') {
                        const diagnostics = await targetApi.hardware.getDiagnostics();
                        const modes = (diagnostics.sessions || []).map(session => {
                            assert.equal(fs.realpathSync(session.build.extensionPath), extensionPath, 'Product diagnostics report a foreign runtime path');
                            return session.build.extensionMode;
                        });
                        assert.ok(modes.length, 'Opened product has no session diagnostics');
                        for (const mode of modes) assert.ok(targetMode === 'installed' ? mode === 'installed' : ['development', 'test'].includes(mode), `Unexpected product context mode: ${mode}`);
                        result.targetContextModes = modes;
                    }
                    break;
                case 'openTextDocument': {
                    const { editor } = await open(message.payload); result = editorValue(editor); break;
                }
                case 'uiCommand': {
                    assert.ok(UI_COMMANDS.has(message.payload?.command), 'Observer UI command is not allowed');
                    const active = () => ({ label: vscode.window.tabGroups.activeTabGroup.activeTab?.label || null,
                        column: vscode.window.tabGroups.activeTabGroup.viewColumn });
                    const before = active(); await vscode.commands.executeCommand(message.payload.command);
                    result = { command: message.payload.command, before, after: active() }; break;
                }
                case 'moveCursor': {
                    const { document, editor } = await open(message.payload, true);
                    const range = validatedRange(document, message.payload);
                    editor.selection = new vscode.Selection(range.start, range.end);
                    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                    result = { inputKind: 'reverse-navigation-test-input', ...editorValue(editor) }; break;
                }
                case 'editBuffer': {
                    const { document, editor } = await open(message.payload);
                    assert.equal(typeof message.payload.text, 'string');
                    assert.ok(message.payload.text.length <= 65536, 'Test edit exceeds bounded input');
                    if (!edited.has(document.uri.toString())) {
                        assert.equal(document.isDirty, false, 'Refusing to alter an already dirty document');
                        edited.set(document.uri.toString(), { path: document.uri.fsPath, diskHash: digest(fs.readFileSync(document.uri.fsPath)) });
                    }
                    assert.ok(await editor.edit(builder => builder.replace(validatedRange(document, message.payload), message.payload.text)));
                    result = editorValue(editor); break;
                }
                case 'revertBuffer': {
                    const { document, editor } = await open(message.payload);
                    const original = edited.get(document.uri.toString()); assert.ok(original, 'No driver edit to revert');
                    assert.equal(digest(fs.readFileSync(original.path)), original.diskHash, 'Disk changed during buffer negative');
                    await vscode.commands.executeCommand('workbench.action.files.revert');
                    edited.delete(document.uri.toString()); result = editorValue(editor); break;
                }
                case 'observeEditors': result = { active: vscode.window.activeTextEditor ? editorValue(vscode.window.activeTextEditor) : null,
                    visible: vscode.window.visibleTextEditors.map(editorValue), trusted: vscode.workspace.isTrusted }; break;
                case 'observeResources': result = { pid: process.pid, memory: process.memoryUsage(), cpu: process.cpuUsage(),
                    uptimeSeconds: process.uptime(), activeResources: process.getActiveResourcesInfo(),
                    product: await targetApi.hardware.getDiagnostics() }; break;
                case 'addWorkspaceFolder': {
                    assert.equal(typeof message.payload?.path, 'string', 'Existing local workspace directory required');
                    const root = fs.realpathSync(path.resolve(message.payload.path)); assert.ok(fs.statSync(root).isDirectory());
                    const uri = vscode.Uri.file(root), before = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.toString());
                    const exists = () => vscode.workspace.workspaceFolders?.some(folder => folder.uri.scheme === 'file'
                        && fs.realpathSync(folder.uri.fsPath) === root);
                    if (!exists()) await new Promise((resolve, reject) => {
                        const cleanup = () => { clearTimeout(timer); listener.dispose(); };
                        const listener = vscode.workspace.onDidChangeWorkspaceFolders(() => { if (exists()) { cleanup(); resolve(); } });
                        const timer = setTimeout(() => { cleanup(); reject(new Error('Workspace folder addition did not settle')); }, 10000);
                        const accepted = vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length || 0, 0,
                            { uri, ...(typeof message.payload.name === 'string' ? { name: message.payload.name } : {}) });
                        if (!accepted) { cleanup(); reject(new Error('VS Code rejected workspace folder addition')); }
                    });
                    documentRoots.add(root);
                    result = { inputKind: 'explicit-isolated-workspace-configuration', addedRoot: root, before,
                        after: (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.toString()) }; break;
                }
                case 'observeHardware':
                    assert.equal(typeof targetApi?.hardware?.getDiagnostics, 'function', 'Product read-only diagnostics unavailable');
                    result = await targetApi.hardware.getDiagnostics(); break;
                case 'finish': result = { finishing: true }; break;
                default: throw new Error('Unknown observer action');
                }
                channel.send({ type: 'response', id: message.id, status: 'ok', result });
                if (message.action === 'finish') finish();
            } catch (error) { channel.send({ type: 'response', id: message.id, status: 'error', error: error?.stack || String(error) }); }
        });
        channel.send({ type: 'observerReady', target: { id: target.id, version: target.packageJSON.version, extensionPath, targetMode,
            extensionKind: target.extensionKind, isActive: target.isActive, runtime: runtimeInventory(extensionPath, targetMode === 'installed') },
        observer: { id: observerContext.extension.id, extensionPath: fs.realpathSync(observerContext.extensionPath),
            mode: observerContext.extensionMode,
            ...(observerContext.extensionMode === vscode.ExtensionMode.Production ? { runtime: inventoryFromEntries(
                ['package.json', 'observer/index.js', 'observer/editor-column.cjs', 'native-runtime.cjs'].map(relative => ({
                    path: relative, bytes: fs.readFileSync(path.join(observerContext.extensionPath, relative)) })), 'Installed test observer runtime') } : {}) },
        environment: { vscode: vscode.version, versions: process.versions, execPath: process.execPath, pid: process.pid,
            platform: process.platform, arch: process.arch, remoteName: vscode.env.remoteName ?? null,
            uiKind: vscode.env.uiKind, workspaceTrusted: vscode.workspace.isTrusted, observerMode: observerContext?.extensionMode ?? null,
            workspaceTrustConfiguration: { enabled: vscode.workspace.getConfiguration('security.workspace.trust').get('enabled'),
                enabledInspection: vscode.workspace.getConfiguration('security.workspace.trust').inspect('enabled'),
                startupPrompt: vscode.workspace.getConfiguration('security.workspace.trust').get('startupPrompt'),
                emptyWindow: vscode.workspace.getConfiguration('security.workspace.trust').get('emptyWindow') },
            workspaceFolders: vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()) || [] } });
        await completed;
    } catch (error) {
        channel.send({ type: 'observerFatal', error: error?.stack || String(error) });
        throw error;
    } finally {
        try {
            for (const subscription of subscriptions) subscription.dispose();
            for (const original of edited.values()) {
                assert.equal(digest(fs.readFileSync(original.path)), original.diskHash, 'Disk changed during isolated edit');
                await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(original.path)), { preview: false });
                await vscode.commands.executeCommand('workbench.action.files.revert');
            }
        } catch (error) {
            channel.send({ type: 'observerFatal', error: error?.stack || String(error) }); throw error;
        } finally { channel.close(); }
    }
}
function connect(port, token) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.setEncoding('utf8'); socket.once('error', reject);
        socket.once('connect', () => {
            let buffer = '', listener;
            socket.write(`${JSON.stringify({ type: 'hello', token })}\n`);
            socket.on('data', chunk => {
                buffer += chunk;
                if (buffer.length > 1048576) { socket.destroy(new Error('Observer message too large')); return; }
                let newline;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
                    if (line) { try { listener?.(JSON.parse(line)); } catch (error) { socket.destroy(error); } }
                }
            });
            resolve({ send: message => socket.write(`${JSON.stringify(message)}\n`), onMessage: callback => { listener = callback; }, close: () => socket.end() });
        });
    });
}
module.exports = { activate, run };
