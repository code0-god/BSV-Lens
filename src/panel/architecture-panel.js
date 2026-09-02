'use strict';

const { TextEncoder } = require('util');
const { getWebviewHtml } = require('./html');

const VIEW_TYPE = 'bsvArchitecture.explorer';

class ArchitecturePanel {
    static currentPanel = null;

    static async createOrShow(context, analyzer, request = {}, output = null) {
        if (ArchitecturePanel.currentPanel) {
            ArchitecturePanel.currentPanel.panel.reveal(context.vscode.ViewColumn.Beside);
            ArchitecturePanel.currentPanel.updateRequest(request);
            await ArchitecturePanel.currentPanel.refresh();
            return ArchitecturePanel.currentPanel;
        }

        const panel = context.vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'BSV Architecture Explorer',
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
        const activeUri = state.activeUri ? context.vscode.Uri.parse(state.activeUri) : undefined;
        const instance = new ArchitecturePanel(panel, context, analyzer, {
            folder,
            activeUri,
            initialMode: state.mode || 'system',
            focusId: state.focusId || null
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
        this.refreshToken = 0;
        this.refreshTimer = null;
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
        this.installWatchers();
    }

    updateRequest(request = {}, reinstallWatchers = true) {
        const previousFolder = this.watchFolderKey();
        for (const key of ['folder', 'activeUri', 'initialMode', 'focusId', 'focusName', 'focusKind']) {
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

    async refresh() {
        const token = ++this.refreshToken;
        this.panel.webview.postMessage({ type: 'busy', value: true, message: 'Analyzing BSV sources…' });
        try {
            const model = await this.analyzer.analyze({
                folder: this.request.folder,
                activeUri: this.request.activeUri,
                fileOnly: this.request.fileOnly
            });
            if (token !== this.refreshToken) return;
            this.model = model;
            this.panel.title = model.title || 'BSV Architecture Explorer';
            const initialFocus = this.resolveInitialFocus(model);
            this.panel.webview.postMessage({
                type: 'model',
                model,
                initial: {
                    mode: this.request.initialMode || this.defaultView(),
                    focusId: initialFocus,
                    activeFile: model.activeFile
                }
            });
            this.output?.appendLine(`[${new Date().toISOString()}] Analyzed ${model.stats.files} BSV files, ${model.stats.nodes} nodes, ${model.stats.edges} edges.`);
        } catch (error) {
            if (token !== this.refreshToken) return;
            this.reportError(error);
            this.panel.webview.postMessage({ type: 'error', message: error.message });
        } finally {
            if (token === this.refreshToken) this.panel.webview.postMessage({ type: 'busy', value: false });
        }
    }

    resolveInitialFocus(model) {
        if (this.request.focusId && model.nodes.some((node) => node.id === this.request.focusId)) return this.request.focusId;
        if (!this.request.focusName) return null;
        const sameFile = model.nodes.find((node) =>
            node.name === this.request.focusName
            && (!this.request.focusKind || node.kind === this.request.focusKind)
            && (!model.activeFile || node.relativePath === model.activeFile)
        );
        if (sameFile) return sameFile.id;
        return model.nodes.find((node) =>
            node.name === this.request.focusName
            && (!this.request.focusKind || node.kind === this.request.focusKind)
        )?.id || null;
    }

    defaultView() {
        return this.vscode.workspace.getConfiguration('bsvArchitecture', this.request.folder?.uri).get('defaultView', 'system');
    }

    async handleMessage(message) {
        try {
            switch (message?.type) {
                case 'ready':
                    if (this.model) {
                        this.panel.webview.postMessage({
                            type: 'model',
                            model: this.model,
                            initial: {
                                mode: this.request.initialMode || this.defaultView(),
                                focusId: this.resolveInitialFocus(this.model),
                                activeFile: this.model.activeFile
                            }
                        });
                    }
                    break;
                case 'refresh':
                    await this.refresh();
                    break;
                case 'openSource':
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
                    this.request.initialMode = message.state?.mode || this.request.initialMode;
                    this.request.focusId = message.state?.focusId || null;
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
        const node = nodeId ? this.model?.nodes.find((item) => item.id === nodeId) : null;
        const target = node?.location || location;
        if (!target?.uri) {
            throw new Error('This architecture element has no source location.');
        }
        const uri = this.vscode.Uri.parse(target.uri);
        const document = await this.vscode.workspace.openTextDocument(uri);
        const editor = await this.vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: this.vscode.ViewColumn.One
        });
        const position = new this.vscode.Position(target.line || 0, target.column || 0);
        editor.selection = new this.vscode.Selection(position, position);
        editor.revealRange(new this.vscode.Range(position, position), this.vscode.TextEditorRevealType.InCenterIfOutsideViewport);
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
    }

    reportError(error) {
        const message = error instanceof Error ? error.message : String(error);
        this.output?.appendLine(`[${new Date().toISOString()}] ERROR ${message}`);
        this.vscode.window.showErrorMessage(`BSV Architecture Explorer: ${message}`);
    }

    dispose() {
        if (ArchitecturePanel.currentPanel === this) ArchitecturePanel.currentPanel = null;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
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
