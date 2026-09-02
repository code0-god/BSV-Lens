'use strict';

const path = require('path');
const { TextDecoder, TextEncoder } = require('util');
const { buildArchitectureModel } = require('./graph-builder');
const {
    makeStarterConfig,
    normalizeConfig,
    parseJsonc
} = require('./config');
const { parseBsvFile } = require('./parser');

const CONFIG_FILE = '.bsv-arch.json';
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

class WorkspaceAnalyzer {
    constructor(vscode) {
        this.vscode = vscode;
        this.decoder = new TextDecoder('utf-8');
        this.encoder = new TextEncoder();
    }

    async analyze(request = {}) {
        const folder = request.folder || this.resolveWorkspaceFolder(request.activeUri);
        const settings = this.vscode.workspace.getConfiguration('bsvArchitecture', folder?.uri);
        const settingsExclude = settings.get('exclude', []);
        const settingsShowPrimitives = settings.get('showPrimitives', false);
        const maxFiles = settings.get('maxFiles', 750);
        const configResult = await this.loadConfig(folder, { settingsExclude, settingsShowPrimitives });
        const config = configResult.config;
        const analysisDiagnostics = [...configResult.diagnostics];
        const uris = request.fileOnly && request.activeUri
            ? [request.activeUri]
            : await this.discoverFiles(folder, config, maxFiles, request.activeUri);

        if (uris.length >= maxFiles && !request.fileOnly) {
            analysisDiagnostics.push({
                severity: 'warning',
                message: `Analysis reached the configured ${maxFiles}-file limit. Increase bsvArchitecture.maxFiles to scan more files.`,
                location: null
            });
        }

        const parsedFiles = (await mapLimit(uris, 16, async (uri) => {
            try {
                const bytes = await this.vscode.workspace.fs.readFile(uri);
                if (bytes.byteLength > MAX_SOURCE_BYTES) {
                    analysisDiagnostics.push({
                        severity: 'warning',
                        message: `Skipped ${this.relativePath(folder, uri)} because it is larger than ${MAX_SOURCE_BYTES / (1024 * 1024)} MiB.`,
                        location: { uri: uri.toString(), line: 0, column: 0, endLine: 0, endColumn: 0 }
                    });
                    return null;
                }
                const text = this.decoder.decode(bytes);
                return parseBsvFile(text, {
                    uri: uri.toString(),
                    relativePath: this.relativePath(folder, uri)
                });
            } catch (error) {
                analysisDiagnostics.push({
                    severity: 'error',
                    message: `Cannot read ${uri.toString()}: ${error.message}`,
                    location: null
                });
                return null;
            }
        })).filter(Boolean);

        const activeFile = request.activeUri
            ? this.relativePath(folder, request.activeUri)
            : null;
        const model = buildArchitectureModel(parsedFiles, config, {
            workspaceName: folder?.name || (request.activeUri ? path.basename(request.activeUri.fsPath || request.activeUri.path) : 'BSV'),
            workspaceUri: folder?.uri?.toString() || null,
            activeFile
        });
        model.diagnostics.unshift(...analysisDiagnostics);
        model.stats.files = parsedFiles.length;
        model.analysisMode = request.fileOnly ? 'file' : 'workspace';
        return model;
    }

    resolveWorkspaceFolder(uri) {
        if (uri) {
            const folder = this.vscode.workspace.getWorkspaceFolder(uri);
            if (folder) return folder;
        }
        return this.vscode.workspace.workspaceFolders?.[0] || null;
    }

    async loadConfig(folder, settings = {}) {
        const diagnostics = [];
        let raw = {};
        let configPath = null;

        if (folder) {
            const configUri = this.vscode.Uri.joinPath(folder.uri, CONFIG_FILE);
            try {
                const bytes = await this.vscode.workspace.fs.readFile(configUri);
                raw = parseJsonc(this.decoder.decode(bytes), CONFIG_FILE);
                configPath = configUri.toString();
            } catch (error) {
                if (!isFileNotFound(error)) {
                    diagnostics.push({
                        severity: 'error',
                        message: error.message,
                        location: { uri: configUri.toString(), line: 0, column: 0, endLine: 0, endColumn: 0 }
                    });
                }
            }
        }

        const config = normalizeConfig(raw, {
            workspaceName: folder?.name || 'BSV',
            settingsExclude: settings.settingsExclude,
            settingsShowPrimitives: settings.settingsShowPrimitives,
            configPath
        });
        if (config.sourceRoots.length === 0) config.sourceRoots = await this.detectSourceRoots(folder);
        return { config, diagnostics };
    }

    async detectSourceRoots(folder) {
        if (!folder) return ['.'];
        const candidates = ['hw/bsv/src', 'bsv/src', 'src'];
        const found = [];
        for (const candidate of candidates) {
            try {
                const stat = await this.vscode.workspace.fs.stat(this.vscode.Uri.joinPath(folder.uri, ...candidate.split('/')));
                if (stat.type & this.vscode.FileType.Directory) found.push(candidate);
            } catch {
                // Missing candidates are expected.
            }
        }
        return found.length > 0 ? found : ['.'];
    }

    async discoverFiles(folder, config, maxFiles, activeUri) {
        const results = new Map();
        if (folder) {
            const excludeGlob = toBraceGlob(config.exclude);
            for (const root of config.sourceRoots) {
                if (results.size >= maxFiles) break;
                const normalizedRoot = normalizeRoot(root);
                const includeGlob = normalizedRoot === '.' ? '**/*.bsv' : `${normalizedRoot}/**/*.bsv`;
                const include = new this.vscode.RelativePattern(folder, includeGlob);
                const remaining = Math.max(1, maxFiles - results.size);
                const found = await this.vscode.workspace.findFiles(include, excludeGlob, remaining);
                for (const uri of found) results.set(uri.toString(), uri);
            }
        }

        if (activeUri && activeUri.path.toLowerCase().endsWith('.bsv')) {
            results.set(activeUri.toString(), activeUri);
        }
        return [...results.values()].sort((left, right) => left.toString().localeCompare(right.toString()));
    }

    relativePath(folder, uri) {
        if (!folder) return path.basename(uri.fsPath || uri.path);
        if (uri.scheme === 'file' && folder.uri.scheme === 'file') {
            return path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
        }
        const folderPath = folder.uri.path.replace(/\/$/, '');
        return uri.path.startsWith(`${folderPath}/`)
            ? uri.path.slice(folderPath.length + 1)
            : uri.path.replace(/^\//, '');
    }

    async createStarterConfig(folder) {
        if (!folder) throw new Error('Open a workspace folder before creating .bsv-arch.json.');
        const configUri = this.vscode.Uri.joinPath(folder.uri, CONFIG_FILE);
        try {
            await this.vscode.workspace.fs.stat(configUri);
            return { uri: configUri, created: false };
        } catch (error) {
            if (!isFileNotFound(error)) throw error;
        }

        const config = makeStarterConfig(folder.name || 'BSV Project');
        const detected = await this.detectSourceRoots(folder);
        config.sourceRoots = detected;
        await this.vscode.workspace.fs.writeFile(
            configUri,
            this.encoder.encode(`${JSON.stringify(config, null, 2)}\n`)
        );
        return { uri: configUri, created: true };
    }
}

function normalizeRoot(root) {
    const normalized = String(root || '.').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    return normalized || '.';
}

function toBraceGlob(patterns) {
    const normalized = (patterns || []).map((pattern) => String(pattern).replace(/\\/g, '/')).filter(Boolean);
    if (normalized.length === 0) return undefined;
    if (normalized.length === 1) return normalized[0];
    return `{${normalized.join(',')}}`;
}

function isFileNotFound(error) {
    return error?.code === 'FileNotFound'
        || error?.name === 'EntryNotFound (FileSystemError)'
        || /not found/i.test(error?.message || '');
}

async function mapLimit(items, limit, worker) {
    const result = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;
            result[index] = await worker(items[index], index);
        }
    });
    await Promise.all(workers);
    return result;
}

module.exports = {
    CONFIG_FILE,
    WorkspaceAnalyzer,
    isFileNotFound,
    mapLimit,
    normalizeRoot,
    toBraceGlob
};
