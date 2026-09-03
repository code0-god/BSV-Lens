'use strict';

const vscode = require('vscode');
const { WorkspaceAnalyzer } = require('./architecture/analyzer');
const { parseBsvFile } = require('./architecture/parser');
const { ArchitecturePanel, VIEW_TYPE } = require('./panel/architecture-panel');

function activate(context) {
    const output = vscode.window.createOutputChannel('BSV Lens');
    const analyzer = new WorkspaceAnalyzer(vscode, { output });
    const runtime = { vscode, extensionUri: context.extensionUri };
    const codeLensProvider = new BsvArchitectureCodeLensProvider(vscode);

    context.subscriptions.push(output);
    context.subscriptions.push(vscode.commands.registerCommand('bsvArchitecture.openWorkspace', async () => {
        const activeUri = activeBsvUri();
        const folder = await chooseWorkspaceFolder(activeUri);
        await ArchitecturePanel.createOrShow(runtime, analyzer, {
            folder,
            activeUri,
            initialMode: 'system',
            initialSourceScope: 'workspace',
            focusId: null,
            focusName: null,
            focusKind: null,
            fileOnly: !folder
        }, output);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('bsvArchitecture.openCurrentFile', async (resource) => {
        const uri = resource instanceof vscode.Uri ? resource : activeBsvUri();
        if (!uri || !uri.path.toLowerCase().endsWith('.bsv')) {
            vscode.window.showWarningMessage('Open or select a .bsv file first.');
            return;
        }
        const folder = await chooseWorkspaceFolder(uri);
        await ArchitecturePanel.createOrShow(runtime, analyzer, {
            folder,
            activeUri: uri,
            initialMode: 'file',
            initialSourceScope: 'current-file',
            focusId: null,
            focusName: null,
            focusKind: null,
            fileOnly: !folder
        }, output);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('bsvArchitecture.openSymbol', async (argument = {}) => {
        const uri = argument.uri ? vscode.Uri.parse(argument.uri) : activeBsvUri();
        const folder = await chooseWorkspaceFolder(uri);
        const kind = argument.kind || null;
        const mode = kind === 'package' ? 'system' : 'file';
        await ArchitecturePanel.createOrShow(runtime, analyzer, {
            folder,
            activeUri: uri,
            initialMode: mode,
            initialSourceScope: kind === 'package' ? 'workspace' : 'current-file',
            initialLevel: kind === 'module' ? 'module' : kind === 'function' ? 'behavior' : 'system',
            focusId: argument.id || null,
            focusName: argument.name || null,
            focusKind: kind,
            fileOnly: !folder
        }, output);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('bsvArchitecture.refresh', async () => {
        if (ArchitecturePanel.currentPanel) await ArchitecturePanel.currentPanel.refresh();
        else await vscode.commands.executeCommand('bsvArchitecture.openWorkspace');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('bsvArchitecture.exportJson', async () => {
        let panel = ArchitecturePanel.currentPanel;
        if (!panel) {
            const activeUri = activeBsvUri();
            const folder = await chooseWorkspaceFolder(activeUri);
            panel = await ArchitecturePanel.createOrShow(runtime, analyzer, {
                folder,
                activeUri,
                initialMode: 'system',
                initialSourceScope: 'workspace',
                focusId: null,
                focusName: null,
                focusKind: null,
                fileOnly: !folder
            }, output);
        }
        await panel.exportJson();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('bsvArchitecture.createConfig', async () => {
        const folder = await chooseWorkspaceFolder(activeBsvUri());
        if (!folder) {
            vscode.window.showWarningMessage('Open a workspace folder before creating .bsv-arch.json.');
            return;
        }
        try {
            const result = await analyzer.createStarterConfig(folder);
            const document = await vscode.workspace.openTextDocument(result.uri);
            await vscode.window.showTextDocument(document, { preview: false });
            vscode.window.showInformationMessage(result.created
                ? 'Created .bsv-arch.json with detected BSV source roots.'
                : '.bsv-arch.json already exists.');
        } catch (error) {
            vscode.window.showErrorMessage(`BSV Lens: ${error.message}`);
        }
    }));

    const selector = [
        { scheme: 'file', pattern: '**/*.bsv' },
        { scheme: 'vscode-remote', pattern: '**/*.bsv' }
    ];
    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, new BsvDocumentSymbolProvider(vscode)));
    context.subscriptions.push(vscode.languages.registerCodeLensProvider(selector, codeLensProvider));

    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    status.command = 'bsvArchitecture.openCurrentFile';
    status.text = '$(circuit-board) BSV Lens';
    status.tooltip = 'Open BSV Lens architecture visualization';
    context.subscriptions.push(status);

    const updateStatus = () => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document?.uri?.path.toLowerCase().endsWith('.bsv')) status.show();
        else status.hide();
    };
    updateStatus();
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatus));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('bsvArchitecture.enableCodeLens')) codeLensProvider.refresh();
        if (event.affectsConfiguration('bsvArchitecture') && ArchitecturePanel.currentPanel) {
            ArchitecturePanel.currentPanel.scheduleAutoRefresh();
        }
    }));

    context.subscriptions.push(vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
        async deserializeWebviewPanel(panel, state) {
            panel.webview.options = {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
            };
            await ArchitecturePanel.revive(panel, runtime, analyzer, state || {}, output);
        }
    }));

    output.appendLine('BSV Lens activated.');
}

function deactivate() {
    ArchitecturePanel.currentPanel?.dispose();
}

function activeBsvUri() {
    const uri = vscode.window.activeTextEditor?.document?.uri;
    return uri?.path.toLowerCase().endsWith('.bsv') ? uri : undefined;
}

async function chooseWorkspaceFolder(uri) {
    if (uri) {
        const containing = vscode.workspace.getWorkspaceFolder(uri);
        if (containing) return containing;
    }
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length <= 1) return folders[0] || null;
    const selected = await vscode.window.showQuickPick(
        folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath || folder.uri.path, folder })),
        { placeHolder: 'Select the workspace folder to analyze' }
    );
    return selected?.folder || null;
}

class BsvDocumentSymbolProvider {
    constructor(api) {
        this.vscode = api;
    }

    provideDocumentSymbols(document) {
        const parsed = parseBsvFile(document.getText(), {
            uri: document.uri.toString(),
            relativePath: document.fileName
        });
        const fullRange = new this.vscode.Range(
            new this.vscode.Position(0, 0),
            document.positionAt(document.getText().length)
        );
        const packageSelection = rangeFromLocation(this.vscode, parsed.packageLocation);
        const root = new this.vscode.DocumentSymbol(
            parsed.packageName,
            'package',
            this.vscode.SymbolKind.Package,
            fullRange,
            packageSelection
        );

        for (const item of parsed.types.filter((type) => !type.parentModuleName)) {
            root.children.push(symbolForItem(this.vscode, document, item, symbolKindForType(this.vscode, item.kind), item.kind));
        }
        for (const item of parsed.interfaces) {
            const symbol = symbolForItem(this.vscode, document, item, this.vscode.SymbolKind.Interface, 'interface');
            for (const method of item.methods) {
                symbol.children.push(symbolForLocation(this.vscode, method.name, method.signature, this.vscode.SymbolKind.Method, method.location));
            }
            root.children.push(symbol);
        }
        for (const item of parsed.functions.filter((fn) => !fn.parentModuleName)) {
            root.children.push(symbolForItem(this.vscode, document, item, this.vscode.SymbolKind.Function, item.returnType));
        }
        for (const item of parsed.modules) {
            const symbol = symbolForItem(this.vscode, document, item, this.vscode.SymbolKind.Module, item.returnInterface || 'module');
            for (const instance of item.instances) {
                symbol.children.push(symbolForLocation(
                    this.vscode,
                    instance.name,
                    `${instance.type} ← ${instance.constructor}`,
                    instance.primitiveKind === 'register' ? this.vscode.SymbolKind.Variable : this.vscode.SymbolKind.Object,
                    instance.location
                ));
            }
            for (const rule of item.rules) {
                symbol.children.push(symbolForLocation(this.vscode, rule.name, rule.guard || 'rule', this.vscode.SymbolKind.Event, rule.location));
            }
            for (const method of item.methods) {
                symbol.children.push(symbolForLocation(this.vscode, method.name, method.returnType || 'method', this.vscode.SymbolKind.Method, method.location));
            }
            for (const fn of parsed.functions.filter((candidate) => candidate.parentModuleName === item.name)) {
                symbol.children.push(symbolForItem(this.vscode, document, fn, this.vscode.SymbolKind.Function, fn.returnType));
            }
            root.children.push(symbol);
        }
        return [root];
    }
}

class BsvArchitectureCodeLensProvider {
    constructor(api) {
        this.vscode = api;
        this.emitter = new api.EventEmitter();
        this.onDidChangeCodeLenses = this.emitter.event;
    }

    refresh() {
        this.emitter.fire();
    }

    provideCodeLenses(document) {
        const enabled = this.vscode.workspace.getConfiguration('bsvArchitecture', document.uri).get('enableCodeLens', true);
        if (!enabled) return [];
        const parsed = parseBsvFile(document.getText(), {
            uri: document.uri.toString(),
            relativePath: document.fileName
        });
        const lenses = [new this.vscode.CodeLens(rangeFromLocation(this.vscode, parsed.packageLocation), {
            title: '$(circuit-board) Open file architecture',
            command: 'bsvArchitecture.openCurrentFile',
            arguments: [document.uri]
        })];
        for (const module of parsed.modules) {
            lenses.push(new this.vscode.CodeLens(rangeFromLocation(this.vscode, module.location), {
                title: '$(type-hierarchy-sub) Open module architecture',
                command: 'bsvArchitecture.openSymbol',
                arguments: [{ uri: document.uri.toString(), name: module.name, kind: 'module' }]
            }));
        }
        for (const fn of parsed.functions) {
            lenses.push(new this.vscode.CodeLens(rangeFromLocation(this.vscode, fn.location), {
                title: '$(references) Open function flow',
                command: 'bsvArchitecture.openSymbol',
                arguments: [{ uri: document.uri.toString(), name: fn.name, kind: 'function' }]
            }));
        }
        return lenses;
    }
}

function symbolForItem(api, document, item, kind, detail) {
    const range = item.range
        ? new api.Range(document.positionAt(item.range.start), document.positionAt(item.range.end))
        : rangeFromLocation(api, item.location);
    return new api.DocumentSymbol(
        item.name,
        detail || '',
        kind,
        range,
        rangeFromLocation(api, item.location)
    );
}

function symbolForLocation(api, name, detail, kind, location) {
    const range = rangeFromLocation(api, location);
    return new api.DocumentSymbol(name, detail || '', kind, range, range);
}

function symbolKindForType(api, kind) {
    if (kind === 'enum') return api.SymbolKind.Enum;
    if (kind === 'struct' || kind === 'union') return api.SymbolKind.Struct;
    return api.SymbolKind.TypeParameter;
}

function rangeFromLocation(api, location) {
    const start = new api.Position(location?.line || 0, location?.column || 0);
    const end = new api.Position(location?.endLine ?? location?.line ?? 0, location?.endColumn ?? (location?.column || 0) + 1);
    return new api.Range(start, end);
}

module.exports = {
    activate,
    deactivate,
    BsvArchitectureCodeLensProvider,
    BsvDocumentSymbolProvider,
    chooseWorkspaceFolder
};
