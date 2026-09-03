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
const { SourceScheduleProvider } = require('./scheduling');
const { BscScheduleProvider } = require('../compiler/bsc-schedule-provider');
const {
    isPathInsideWorkspace,
    validateTrustedExternalPath
} = require('../security/workspace-boundary');

const CONFIG_FILE = '.bsv-arch.json';
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

class WorkspaceAnalyzer {
    constructor(vscode, options = {}) {
        this.vscode = vscode;
        this.decoder = new TextDecoder('utf-8');
        this.encoder = new TextEncoder();
        this.output = options.output || null;
        this.sourceScheduleProvider = options.sourceScheduleProvider || new SourceScheduleProvider();
        this.bscScheduleProvider = options.bscScheduleProvider || new BscScheduleProvider();
    }

    async analyze(request = {}) {
        const folder = request.folder || this.resolveWorkspaceFolder(request.activeUri);
        const settings = this.vscode.workspace.getConfiguration('bsvArchitecture', folder?.uri);
        const settingsExclude = settings.get('exclude', []);
        const settingsShowPrimitives = settings.get('showPrimitives', false);
        const settingsIncludePotentialScheduleDependencies = settings.get('includePotentialScheduleDependencies', true);
        const maxFiles = settings.get('maxFiles', 750);
        const configResult = await this.loadConfig(folder, {
            settingsExclude,
            settingsShowPrimitives,
            settingsIncludePotentialScheduleDependencies
        });
        const config = configResult.config;
        const analysisDiagnostics = [...configResult.diagnostics];
        const discoveredUris = request.fileOnly && request.activeUri
            ? [request.activeUri]
            : await this.discoverFiles(folder, config, maxFiles, request.activeUri);
        const uris = await this.filterSourceUris(folder, discoveredUris, analysisDiagnostics);

        if (uris.length >= maxFiles && !request.fileOnly) {
            analysisDiagnostics.push({
                severity: 'warning',
                message: `Analysis reached the configured ${maxFiles}-file limit. Increase bsvArchitecture.maxFiles to scan more files.`,
                location: null
            });
        }

        const sourceResults = (await mapLimit(uris, 16, async (uri) => {
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
                const relativePath = this.relativePath(folder, uri);
                return {
                    uri,
                    text,
                    parsed: parseBsvFile(text, {
                        uri: uri.toString(),
                        relativePath
                    })
                };
            } catch (error) {
                analysisDiagnostics.push({
                    severity: 'error',
                    message: `Cannot read ${uri.toString()}: ${error.message}`,
                    location: null
                });
                return null;
            }
        })).filter(Boolean);
        const parsedFiles = sourceResults.map((item) => item.parsed);
        const scheduleResult = await this.analyzeScheduling({
            folder,
            config,
            parsedFiles,
            uris: sourceResults.map((item) => item.uri),
            sourceFiles: sourceResults.map((item) => ({
                uri: item.uri.toString(),
                relativePath: item.parsed.relativePath,
                text: item.text
            })),
            token: request.token
        });
        analysisDiagnostics.push(...scheduleResult.diagnostics);

        const activeFile = request.activeUri
            ? this.relativePath(folder, request.activeUri)
            : null;
        const model = buildArchitectureModel(parsedFiles, config, {
            workspaceName: folder?.name || (request.activeUri ? path.basename(request.activeUri.fsPath || request.activeUri.path) : 'BSV'),
            workspaceUri: folder?.uri?.toString() || null,
            activeFile,
            scheduleRelations: scheduleResult.relations,
            scheduleProvider: scheduleResult.provider,
            scheduleTopModule: config.scheduling?.topModule || null
        });
        for (const diagnostic of model.diagnostics.filter((item) => item.code?.startsWith('resolution.'))) {
            this.output?.appendLine(`[resolution] ${diagnostic.message}`);
        }
        model.diagnostics.unshift(...analysisDiagnostics);
        model.stats.files = parsedFiles.length;
        model.analysisMode = request.fileOnly ? 'file' : 'workspace';
        model.scheduling.source = scheduleResult.source;
        model.scheduling.reason = scheduleResult.reason || '';
        model.viewDefaults = viewDefaults(settings);
        const workspaceTrusted = this.vscode.workspace?.isTrusted !== false;
        model.security = {
            workspaceTrusted,
            restrictedMode: !workspaceTrusted,
            sourceAnalysisAvailable: true,
            bscExecutionEnabled: workspaceTrusted,
            externalScheduleReportsEnabled: workspaceTrusted
        };
        return model;
    }

    async analyzeScheduling(context) {
        const scheduling = context.config.scheduling || {};
        if (scheduling.provider === 'off') {
            return { provider: 'off', source: 'source', relations: [], diagnostics: [] };
        }
        const sourceResult = await this.sourceScheduleProvider.analyze({
            parsedFiles: context.parsedFiles,
            sourceFiles: context.sourceFiles
        }, context.token);
        const sourceRelations = sourceResult.available ? sourceResult.relations || [] : [];
        const sourceDiagnostics = sourceResult.diagnostics || [];
        if (scheduling.provider === 'source') {
            return {
                provider: 'source',
                source: 'source',
                relations: sourceRelations,
                diagnostics: sourceDiagnostics
            };
        }
        const hasReport = scheduling.reportFiles.length > 0;
        const hasBuild = Boolean(scheduling.topModule) && context.uris.length > 0;
        if (scheduling.provider === 'auto' && !hasReport && !hasBuild) {
            return {
                provider: 'source',
                source: 'source',
                relations: sourceRelations,
                diagnostics: sourceDiagnostics
            };
        }

        const inputFiles = selectBscInputFiles(context.parsedFiles, context.uris, scheduling.topModule);
        const result = await this.bscScheduleProvider.analyze({
            folder: context.folder,
            workspacePath: context.folder?.uri?.fsPath,
            workspaceTrusted: this.vscode.workspace?.isTrusted !== false,
            inputFiles,
            sourceFiles: context.sourceFiles,
            scheduling,
            onOutput: (text) => this.appendCompilerOutput(text)
        }, context.token);
        if (result.available) {
            return {
                provider: 'bsc',
                source: result.source || 'compiler-output',
                relations: [...sourceRelations, ...(result.relations || [])],
                diagnostics: [...sourceDiagnostics, ...(result.diagnostics || [])],
                reason: ''
            };
        }
        const severity = scheduling.provider === 'bsc' ? 'warning' : 'info';
        return {
            provider: 'source',
            source: 'source-fallback',
            relations: sourceRelations,
            diagnostics: [
                ...sourceDiagnostics,
                ...(result.diagnostics || []),
                {
                    severity,
                    message: `Using source-derived scheduling: ${result.reason || 'BSC scheduling is unavailable.'}`,
                    location: null
                }
            ],
            reason: result.reason || 'BSC scheduling is unavailable.'
        };
    }

    appendCompilerOutput(text) {
        if (!text) return;
        if (typeof this.output?.append === 'function') this.output.append(String(text));
        else if (typeof this.output?.appendLine === 'function') this.output.appendLine(String(text).replace(/\n$/, ''));
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
            settingsIncludePotentialScheduleDependencies: settings.settingsIncludePotentialScheduleDependencies,
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

    async filterSourceUris(folder, uris, diagnostics) {
        if (this.vscode.workspace?.isTrusted !== false || !folder) return uris;
        const allowed = [];
        for (const uri of uris) {
            let result;
            if (uri.scheme === 'file' && folder.uri.scheme === 'file') {
                result = await validateTrustedExternalPath({
                    workspacePath: folder.uri.fsPath,
                    basePath: folder.uri.fsPath,
                    value: uri.fsPath,
                    workspaceTrusted: false,
                    purpose: 'source file'
                });
            } else {
                const sameScheme = uri.scheme === folder.uri.scheme;
                const insideWorkspace = sameScheme
                    && isPathInsideWorkspace(folder.uri.path, uri.path, path.posix);
                result = {
                    allowed: insideWorkspace,
                    reason: insideWorkspace
                        ? ''
                        : 'External source files are unavailable in a restricted workspace.'
                };
            }
            if (result.allowed) allowed.push(uri);
            else diagnostics.push({
                severity: 'warning',
                message: `${result.reason} Skipped ${uri.toString()}.`,
                location: null
            });
        }
        return allowed;
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

function selectBscInputFiles(parsedFiles, uris, topModule) {
    if (topModule) {
        const index = parsedFiles.findIndex((file) =>
            (file.modules || []).some((module) => module.name === topModule)
        );
        if (index >= 0) return [uriPath(uris[index])].filter(Boolean);
    }
    return uris.map(uriPath).filter(Boolean);
}

function uriPath(uri) {
    return uri?.fsPath || uri?.path || (typeof uri === 'string' ? uri : null);
}

function viewDefaults(settings) {
    return {
        sourceScope: resolveDefaultSourceScope(settings),
        level: settings.get('defaultLevel', 'system'),
        analysisMode: settings.get('defaultMode', 'structure'),
        hopScope: settings.get('defaultHopScope', 'all'),
        showMethodPorts: settings.get('showMethodPorts', true),
        collapseModuleMembers: settings.get('collapseModuleMembers', true),
        includePotentialScheduleDependencies: settings.get('includePotentialScheduleDependencies', true)
    };
}

function resolveDefaultSourceScope(settings) {
    const inspected = typeof settings.inspect === 'function'
        ? settings.inspect('defaultSourceScope')
        : null;
    const explicit = inspected && [
        inspected.workspaceFolderLanguageValue,
        inspected.workspaceFolderValue,
        inspected.workspaceLanguageValue,
        inspected.workspaceValue,
        inspected.globalLanguageValue,
        inspected.globalValue
    ].find((value) => value !== undefined);
    if (explicit !== undefined && explicit !== null) return explicit;
    if (inspected) return settings.get('defaultView', 'system') === 'file' ? 'current-file' : 'workspace';
    return settings.get('defaultSourceScope', settings.get('defaultView', 'system') === 'file' ? 'current-file' : 'workspace');
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
    resolveDefaultSourceScope,
    selectBscInputFiles,
    toBraceGlob
};
