'use strict';

const { TextEncoder } = require('util');
const { getWebviewHtml } = require('./html');
const {
    buildSourceReferenceIndex,
    findSourceReferenceAtPosition
} = require('../architecture/symbol-index');
const { resolveDefaultSourceScope } = require('../architecture/analyzer');

const VIEW_TYPE = 'bsvArchitecture.explorer';

class ArchitecturePanel {
    static currentPanel = null;

    static async createOrShow(context, analyzer, request = {}, output = null) {
        if (ArchitecturePanel.currentPanel) {
            ArchitecturePanel.currentPanel.panel.reveal(context.vscode.ViewColumn.Beside);
            ArchitecturePanel.currentPanel.updateRequest(request);
            await ArchitecturePanel.currentPanel.refresh({ resetView: true });
            return ArchitecturePanel.currentPanel;
        }

        const panel = context.vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'BSV Lens',
            context.vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.vscode.Uri.joinPath(context.extensionUri, 'media')]
            }
        );
        const instance = new ArchitecturePanel(panel, context, analyzer, request, output);
        ArchitecturePanel.currentPanel = instance;
        await instance.refresh();
        return instance;
    }

    static async revive(panel, context, analyzer, state = {}, output = null) {
        const folder = state.workspaceUri
            ? context.vscode.workspace.workspaceFolders?.find((item) => item.uri.toString() === state.workspaceUri)
            : context.vscode.workspace.workspaceFolders?.[0];
        const activeUri = state.activeUri
            ? context.vscode.Uri.parse(state.activeUri)
            : state.activeFile && folder
                ? context.vscode.Uri.joinPath(folder.uri, ...state.activeFile.split('/'))
                : undefined;
        const instance = new ArchitecturePanel(panel, context, analyzer, {
            folder,
            activeUri,
            initialMode: state.mode || null,
            initialSourceScope: state.sourceScope || (state.mode === 'file' ? 'current-file' : 'workspace'),
            initialLevel: state.level || 'system',
            initialAnalysisMode: state.analysisMode || 'structure',
            initialHopScope: state.hopScope || 'all',
            focusId: state.focusId || state.focusStack?.at(-1) || null
        }, output);
        ArchitecturePanel.currentPanel = instance;
        await instance.refresh();
        return instance;
    }

    constructor(panel, context, analyzer, request, output) {
        this.panel = panel;
        this.context = context;
        this.vscode = context.vscode;
        this.analyzer = analyzer;
        this.output = output;
        this.disposables = [];
        this.watcherDisposables = [];
        this.model = null;
        this.sourceReferenceIndex = null;
        this.refreshToken = 0;
        this.modelRevision = 0;
        this.analysisCancellation = null;
        this.refreshTimer = null;
        this.selectionTimer = null;
        this.request = {};
        this.updateRequest(request, false);

        this.panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.vscode.Uri.joinPath(context.extensionUri, 'media')]
        };
        this.panel.webview.html = getWebviewHtml(this.panel.webview, context.extensionUri, this.vscode);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.disposables);
        this.disposables.push(this.vscode.window.onDidChangeActiveTextEditor((editor) => this.handleActiveEditor(editor)));
        if (typeof this.vscode.window.onDidChangeTextEditorSelection === 'function') {
            this.disposables.push(
                this.vscode.window.onDidChangeTextEditorSelection((event) => this.handleSelectionChange(event))
            );
        }
        this.installWatchers();
    }

    updateRequest(request = {}, reinstallWatchers = true) {
        const previousFolder = this.watchFolderKey();
        for (const key of [
            'folder', 'activeUri', 'initialMode', 'initialSourceScope', 'initialLevel',
            'initialAnalysisMode', 'initialHopScope', 'focusId', 'focusName', 'focusKind'
        ]) {
            if (Object.prototype.hasOwnProperty.call(request, key)) this.request[key] = request[key] ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(request, 'fileOnly')) {
            this.request.fileOnly = request.fileOnly === true;
        }
        if (reinstallWatchers && this.watcherDisposables && previousFolder !== this.watchFolderKey()) this.installWatchers();
    }

    watchFolderKey() {
        const folder = this.request.folder || this.analyzer.resolveWorkspaceFolder(this.request.activeUri);
        return folder?.uri?.toString() || '';
    }

    installWatchers() {
        while (this.watcherDisposables.length > 0) {
            try {
                this.watcherDisposables.pop().dispose();
            } catch {
                // Dispose best-effort.
            }
        }

        const folder = this.request.folder || this.analyzer.resolveWorkspaceFolder(this.request.activeUri);
        if (!folder) return;
        const pattern = new this.vscode.RelativePattern(folder, '**/*.bsv');
        const watcher = this.vscode.workspace.createFileSystemWatcher(pattern);
        this.watcherDisposables.push(
            watcher.onDidChange(() => this.scheduleAutoRefresh()),
            watcher.onDidCreate(() => this.scheduleAutoRefresh()),
            watcher.onDidDelete(() => this.scheduleAutoRefresh()),
            watcher
        );

        const configPattern = new this.vscode.RelativePattern(folder, '.bsv-arch.json');
        const configWatcher = this.vscode.workspace.createFileSystemWatcher(configPattern);
        this.watcherDisposables.push(
            configWatcher.onDidChange(() => this.scheduleAutoRefresh()),
            configWatcher.onDidCreate(() => this.scheduleAutoRefresh()),
            configWatcher.onDidDelete(() => this.scheduleAutoRefresh()),
            configWatcher
        );
    }

    scheduleAutoRefresh() {
        const folder = this.request.folder || this.analyzer.resolveWorkspaceFolder(this.request.activeUri);
        const scope = folder?.uri || this.request.activeUri;
        const enabled = this.vscode.workspace.getConfiguration('bsvArchitecture', scope).get('autoRefresh', true);
        if (!enabled) return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.refresh().catch((error) => this.reportError(error));
        }, 350);
    }

    async refresh(options = {}) {
        const token = ++this.refreshToken;
        const requestedInitial = {
            mode: this.request.initialMode || this.defaultView(),
            ...this.defaultViewState(),
            focusId: this.request.focusId || null
        };
        this.analysisCancellation?.cancel?.();
        this.analysisCancellation?.dispose?.();
        this.analysisCancellation = typeof this.vscode.CancellationTokenSource === 'function'
            ? new this.vscode.CancellationTokenSource()
            : null;
        this.panel.webview.postMessage({ type: 'busy', value: true, message: 'Analyzing BSV sources…' });
        try {
            const model = await this.analyzer.analyze({
                folder: this.request.folder,
                activeUri: this.request.activeUri,
                fileOnly: this.request.fileOnly,
                token: this.analysisCancellation?.token
            });
            if (token !== this.refreshToken) return;
            this.model = model;
            this.sourceReferenceIndex = buildSourceReferenceIndex(model);
            this.modelRevision = token;
            this.panel.title = model.title || 'BSV Lens';
            const initialFocus = this.resolveInitialFocus(model);
            this.panel.webview.postMessage({
                type: 'model',
                model,
                initial: {
                    ...requestedInitial,
                    focusId: initialFocus,
                    activeFile: model.activeFile
                },
                revision: token,
                resetView: options.resetView === true
            });
            this.output?.appendLine(`[${new Date().toISOString()}] Analyzed ${model.stats.files} BSV files, ${model.stats.nodes} nodes, ${model.stats.edges} edges.`);
        } catch (error) {
            if (token !== this.refreshToken) return;
            this.reportError(error);
            this.panel.webview.postMessage({ type: 'error', message: error.message });
        } finally {
            if (token === this.refreshToken) this.panel.webview.postMessage({ type: 'busy', value: false });
            if (token === this.refreshToken) {
                this.analysisCancellation?.dispose?.();
                this.analysisCancellation = null;
            }
        }
    }

    resolveInitialFocus(model) {
        if (this.request.focusId && model.nodes.some((node) => node.id === this.request.focusId)) return this.request.focusId;
        if (!this.request.focusName) return null;
        const matches = model.nodes.filter((node) =>
            node.name === this.request.focusName
            && (!this.request.focusKind || node.kind === this.request.focusKind)
        );
        const sameFile = matches.filter((node) =>
            !model.activeFile || node.relativePath === model.activeFile
        );
        if (sameFile.length === 1) return sameFile[0].id;
        return matches.length === 1 ? matches[0].id : null;
    }

    defaultView() {
        return this.vscode.workspace.getConfiguration('bsvArchitecture', this.request.folder?.uri).get('defaultView', 'system');
    }

    defaultViewState() {
        const settings = this.vscode.workspace.getConfiguration('bsvArchitecture', this.request.folder?.uri);
        return {
            sourceScope: this.request.initialSourceScope
                || resolveDefaultSourceScope(settings),
            level: this.request.initialLevel || settings.get('defaultLevel', 'system'),
            analysisMode: this.request.initialAnalysisMode || settings.get('defaultMode', 'structure'),
            hopScope: this.request.initialHopScope || settings.get('defaultHopScope', 'all')
        };
    }

    async handleMessage(message) {
        try {
            switch (message?.type) {
                case 'ready':
                    if (this.model) {
                        this.panel.webview.postMessage({
            type: 'model',
            model: this.model,
            buildInfo: this.context?.buildInfo || null,
                            initial: {
                                mode: this.request.initialMode || this.defaultView(),
                                ...this.defaultViewState(),
                                focusId: this.resolveInitialFocus(this.model),
                                activeFile: this.model.activeFile
                            },
                            revision: this.modelRevision,
                            resetView: false
                        });
                    }
                    break;
                case 'refresh':
                    await this.refresh();
                    break;
                case 'openSource':
                    if (message.revision !== undefined && message.revision !== this.modelRevision) {
                        throw new Error('Source reference is stale. Refresh the analysis before opening source.');
                    }
                    await this.openSource(message.nodeId, message.location);
                    break;
                case 'exportSvg':
                    await this.exportSvg(message.svg, message.suggestedName);
                    break;
                case 'exportJson':
                    await this.exportJson();
                    break;
                case 'copySvg':
                    await this.vscode.env.clipboard.writeText(String(message.svg || ''));
                    this.panel.webview.postMessage({ type: 'toast', message: 'SVG copied to the clipboard.' });
                    break;
                case 'state':
                    if (message.revision !== this.refreshToken || message.revision !== this.modelRevision) break;
                    this.request.initialSourceScope = message.state?.sourceScope || this.request.initialSourceScope;
                    this.request.initialLevel = message.state?.level || this.request.initialLevel;
                    this.request.initialAnalysisMode = message.state?.analysisMode || this.request.initialAnalysisMode;
                    this.request.initialHopScope = message.state?.hopScope || this.request.initialHopScope;
                    this.request.focusId = message.state?.focusStack?.at(-1) || message.state?.focusId || null;
                    break;
                default:
                    break;
            }
        } catch (error) {
            this.reportError(error);
            this.panel.webview.postMessage({ type: 'toast', message: error.message, error: true });
        }
    }

    async openSource(nodeId, location) {
        const revision = this.modelRevision;
        const node = nodeId ? this.model?.nodes.find((item) => item.id === nodeId) : null;
        if (nodeId && !node) {
            throw new Error('This architecture element no longer exists. Refresh the analysis.');
        }
        const target = node?.location || location;
        if (!target?.uri) {
            throw new Error('This architecture element has no source location.');
        }
        if (!node && !modelOwnsLocation(this.model, target)) {
            throw new Error('Source location is not owned by the current architecture model.');
        }
        const uri = this.vscode.Uri.parse(target.uri);
        const document = await this.vscode.workspace.openTextDocument(uri);
        const editor = await this.vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: this.vscode.ViewColumn.One
        });
        if (revision !== this.modelRevision) {
            throw new Error('Source reference is stale. Refresh the analysis before opening source.');
        }
        const source = this.model?.sourceDocuments?.find((item) => item.uri === target.uri);
        if (source && document.getText() !== source.content) {
            throw new Error('Source has changed since this analysis. Refresh before opening the source range.');
        }
        const position = new this.vscode.Position(target.line || 0, target.column || 0);
        const end = new this.vscode.Position(
            target.endLine ?? target.line ?? 0,
            target.endColumn ?? target.column ?? 0
        );
        editor.selection = new this.vscode.Selection(end, position);
        editor.revealRange(new this.vscode.Range(position, end), this.vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    async exportSvg(svg, suggestedName) {
        if (!svg || typeof svg !== 'string') throw new Error('The diagram did not provide SVG content.');
        if (svg.length > 25 * 1024 * 1024) throw new Error('The SVG is too large to export.');
        const destination = await this.chooseSaveUri(suggestedName || `${safeName(this.model?.title || 'bsv-architecture')}.svg`, 'SVG');
        if (!destination) return;
        await this.vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(svg));
        this.panel.webview.postMessage({ type: 'toast', message: `Saved ${destination.path.split('/').pop()}.` });
    }

    async exportJson() {
        if (!this.model) throw new Error('No architecture model is available.');
        const destination = await this.chooseSaveUri(`${safeName(this.model.title || 'bsv-architecture')}.json`, 'JSON');
        if (!destination) return;
        const content = `${JSON.stringify(this.model, null, 2)}\n`;
        await this.vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(content));
        this.panel.webview.postMessage({ type: 'toast', message: `Saved ${destination.path.split('/').pop()}.` });
    }

    async chooseSaveUri(fileName, label) {
        const folder = this.request.folder || this.analyzer.resolveWorkspaceFolder(this.request.activeUri);
        const defaultUri = folder ? this.vscode.Uri.joinPath(folder.uri, fileName) : undefined;
        return this.vscode.window.showSaveDialog({
            defaultUri,
            filters: { [label]: [fileName.split('.').pop()] },
            saveLabel: `Export ${label}`
        });
    }

    handleActiveEditor(editor) {
        const uri = editor?.document?.uri;
        if (!uri || !uri.path.toLowerCase().endsWith('.bsv')) return;
        this.request.activeUri = uri;
        if (this.model) {
            const folder = this.request.folder || this.analyzer.resolveWorkspaceFolder(uri);
            const activeFile = this.analyzer.relativePath(folder, uri);
            this.model.activeFile = activeFile;
            this.panel.webview.postMessage({ type: 'activeFile', activeFile });
        }
        if (editor?.selection) {
            this.handleSelectionChange({ textEditor: editor, selections: [editor.selection] });
        }
    }

    handleSelectionChange(event) {
        if (this.selectionTimer) clearTimeout(this.selectionTimer);
        this.selectionTimer = setTimeout(() => {
            this.selectionTimer = null;
            this.revealEditorSelection(event);
        }, 140);
    }

    revealEditorSelection(event) {
        const editor = event?.textEditor;
        const uri = editor?.document?.uri;
        const position = event?.selections?.[0]?.active;
        if (!uri || !uri.path.toLowerCase().endsWith('.bsv') || !position || !this.model) return;
        const enabled = this.vscode.workspace
            .getConfiguration('bsvArchitecture', uri)
            .get('syncWithEditor', true);
        if (!enabled) return;
        if (!this.sourceReferenceIndex) {
            this.sourceReferenceIndex = buildSourceReferenceIndex(this.model);
        }
        const sourceReference = findSourceReferenceAtPosition(this.sourceReferenceIndex, {
            uri: uri.toString(),
            line: position.line,
            column: position.character
        });
        this.panel.webview.postMessage({
            type: 'revealSource',
            sourceReference,
            revision: this.modelRevision
        });
    }

    reportError(error) {
        const message = error instanceof Error ? error.message : String(error);
        this.output?.appendLine(`[${new Date().toISOString()}] ERROR ${message}`);
        this.vscode.window.showErrorMessage(`BSV Lens: ${message}`);
    }

    dispose() {
        if (ArchitecturePanel.currentPanel === this) ArchitecturePanel.currentPanel = null;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        if (this.selectionTimer) clearTimeout(this.selectionTimer);
        this.analysisCancellation?.cancel?.();
        this.analysisCancellation?.dispose?.();
        while (this.watcherDisposables.length > 0) {
            try {
                this.watcherDisposables.pop().dispose();
            } catch {
                // Dispose best-effort.
            }
        }
        while (this.disposables.length > 0) {
            try {
                this.disposables.pop().dispose();
            } catch {
                // Dispose best-effort.
            }
        }
    }
}

function modelOwnsLocation(model, target) {
    const collections = [
        'nodes',
        'edges',
        'definitions',
        'instances',
        'endpoints',
        'bindings',
        'protocolChannels',
        'semanticFlows',
        'stateBehaviors',
        'statements',
        'expressions',
        'callSites',
        'functionDefinitions',
        'scheduleRelations',
        'interfaceContracts',
        'diagnostics',
        'semanticDiagnostics'
    ];
    return collections.some((name) => (model?.[name] || []).some((item) =>
        [
            item.location, item.sourceRange, item.sourceLocation, item.compilerLocation,
            ...(item.evidenceRefs || []).flatMap((reference) => [
                reference.sourceRange, reference.location
            ])
        ].some((location) =>
            location?.uri === target.uri
            && (location.line || 0) === (target.line || 0)
            && (location.column || 0) === (target.column || 0)
            && (location.endLine ?? location.line ?? 0) === (target.endLine ?? target.line ?? 0)
            && (location.endColumn ?? location.column ?? 0) === (target.endColumn ?? target.column ?? 0)
        )
    ));
}

function safeName(value) {
    return String(value || 'architecture')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'architecture';
}

module.exports = {
    ArchitecturePanel,
    VIEW_TYPE,
    safeName
};
