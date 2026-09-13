'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseJsonc } = require('../architecture/config');
const { createArtifactRegistry } = require('../hardware/registry');
const { LIMITS, relative: validateSourcePath } = require('../hardware/native-input-schema');
const { failure, hash, stable } = require('../hardware/json');
const { grantDirectory, verifyDirectoryGrant } = require('./hardware-authority');
const SOURCE_GLOB = '**/*.[bB][sS][vV]';
const HARD_EXCLUDE = ['.git', 'node_modules', '.build', '.vscode-test', '.cache', '.omx', '.omo', '.codegraph', '.venv']
    .map(name => `**/${name}/**`).concat('**/docs/hardware/evidence/**');
const DISCOVERY_LIMITS = Object.freeze({ maxCandidates: 1024, timeoutMs: 10000, configBytes: 65536, maxGlobWork: 32000000 });
const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.length <= 2048).slice(0, 128) : [];
function globMatches(name, pattern, budget) {
    name = name.toLowerCase(); pattern = pattern.toLowerCase().replace(/\\/g, '/');
    let previous = new Uint8Array(name.length + 1), next = new Uint8Array(name.length + 1); previous[0] = 1;
    for (let i = 0; i < pattern.length; i++) {
        const token = pattern[i], star = token === '*', recursive = star && pattern[i + 1] === '*';
        if (recursive) while (pattern[i + 1] === '*') i++;
        next.fill(0); if (star) next[0] = previous[0];
        for (let j = 1; j <= name.length; j++) {
            if (--budget.remaining < 0) throw failure('LIMIT_EXCEEDED', 'Source include/exclude matching exceeded its bounded work limit');
            const allowed = recursive || name[j - 1] !== '/';
            next[j] = star ? previous[j] || allowed && next[j - 1]
                : previous[j - 1] && (token === '?' ? allowed : token === name[j - 1]);
        }
        [previous, next] = [next, previous];
    }
    return !!previous[name.length];
}
const matches = (name, patterns, budget = { remaining: DISCOVERY_LIMITS.maxGlobWork }) => patterns.some(pattern =>
    globMatches(name, pattern, budget) || pattern.startsWith('**/') && globMatches(name, pattern.slice(3), budget));
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
function inside(name) { return !!name && !path.isAbsolute(name) && !name.split('/').some(part => !part || part === '..' || part === '.'); }
function bounded(value, fallback, maximum) { return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : Math.min(fallback, maximum); }

async function sourcePath(grant, file) {
    const name = relative(grant.path, file);
    if (!inside(name)) throw failure('PATH_DENIED', 'Source is outside the selected workspace');
    let current = grant.path;
    for (const part of name.split('/')) {
        current = path.join(current, part);
        if ((await fs.lstat(current)).isSymbolicLink()) throw failure('PATH_DENIED', 'Source discovery does not follow symbolic links');
    }
    await verifyDirectoryGrant(grant);
    const stat = await fs.stat(current);
    if (!stat.isFile()) throw failure('PATH_DENIED', 'Source is not a regular file');
    return { name, stat };
}

async function discoverWorkspace({ vscode, folder, signal, previous, changedFiles, onProgress = () => {} }) {
    if (!folder || folder.uri.scheme !== 'file' || vscode.env.remoteName || vscode.env.uiKind === vscode.UIKind.Web)
        throw failure('UNSUPPORTED', 'Automatic discovery requires a local desktop workspace folder');
    if (!(vscode.workspace.workspaceFolders || []).some(item => item.uri.toString() === folder.uri.toString()))
        throw failure('PATH_DENIED', 'The selected workspace folder is no longer open');
    const grant = await grantDirectory(folder.uri.fsPath), started = performance.now(), token = new vscode.CancellationTokenSource();
    const abort = () => token.cancel(); signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; token.cancel(); }, DISCOVERY_LIMITS.timeoutMs);
    const check = () => {
        if (signal?.aborted) throw failure('CANCELLED', 'Workspace discovery cancelled');
        if (!(vscode.workspace.workspaceFolders || []).some(item => item.uri.toString() === folder.uri.toString()))
            throw failure('PATH_DENIED', 'The selected workspace folder is no longer open');
        if (timedOut) throw failure('LIMIT_EXCEEDED', 'Workspace discovery timed out; choose a smaller source scope');
    };
    try {
        check(); onProgress({ phase: 'discovering', message: 'Finding BSV sources in the current workspace…' });
        const settings = vscode.workspace.getConfiguration('bsvArchitecture', folder.uri);
        const limits = { maxFiles: bounded(settings.get('maxFiles'), 750, LIMITS.maxFiles),
            maxFileBytes: bounded(settings.get('maxSourceBytes'), 4194304, LIMITS.maxSourceBytes), maxSourceBytes: LIMITS.maxSourceBytes,
            ...DISCOVERY_LIMITS };
        const diagnostics = [], excluded = [], unanalysed = [], included = [], sources = [], globBudget = { remaining: limits.maxGlobWork };
        let config = {};
        const configFile = path.join(grant.path, '.bsv-arch.json');
        try {
            const { stat } = await sourcePath(grant, configFile);
            if (stat.size > limits.configBytes) throw failure('LIMIT_EXCEEDED', 'Source configuration exceeds its byte limit');
            const registry = createArtifactRegistry({ artifactRoots: [grant.path], resolvedRoots: true });
            await registry.registerArtifact({ pathRef: '.bsv-arch.json', path: configFile });
            config = parseJsonc((await registry.readArtifact('.bsv-arch.json', limits.configBytes)).text);
            if (!config || typeof config !== 'object' || Array.isArray(config)) throw failure('INVALID_INPUT', 'Source configuration must be an object');
        } catch (error) { if (error.code !== 'ENOENT') diagnostics.push({ code: error.code || 'INVALID_INPUT', message: 'Source configuration could not be used; workspace defaults remain available.' }); }
        const includes = list(settings.get('hardwareInclude', []));
        const roots = list(config.sourceRoots).map(name => name.replace(/\\/g, '/').replace(/\/$/, '')).filter(name => name === '.' || inside(name));
        const configuredExcludes = [...list(settings.get('exclude', [])), ...list(config.exclude)];
        const filesExclude = vscode.workspace.getConfiguration('files', folder.uri).get('exclude', {});
        const fileExcludes = list(Object.entries(filesExclude || {}).filter(([, value]) => value === true).map(([name]) => name));
        // Only directory globs with identical subtree semantics can run before the candidate cap; explicit includes retain the full search.
        const pushedDownExcludes = includes.length ? [] : [...new Set([...configuredExcludes, ...fileExcludes])].filter(pattern =>
            !HARD_EXCLUDE.includes(pattern) && inside(pattern) && pattern.endsWith('/**') && /^[\w ./?*-]+$/.test(pattern)
            && !pattern.slice(pattern.startsWith('**/') ? 3 : 0, -3).includes('**'));
        const rules = { hardExclude: HARD_EXCLUDE, exclude: [...configuredExcludes, ...fileExcludes], include: includes,
            sourceRoots: roots, filesExcludeApplied: true, searchExcludeApplied: false, pushedDownExcludes,
            conditionalFileExcludes: Object.keys(filesExclude || {}).filter(key => typeof filesExclude[key] === 'object') };
        const incremental = previous?.workspace.uri === folder.uri.toString() && !previous.truncated && changedFiles?.length;
        const found = incremental ? [...new Set([...previous.included, ...previous.excluded, ...previous.unanalysed].map(item => item.path)
            .concat(changedFiles).filter(name => inside(name) && /\.bsv$/i.test(name)))].map(name => vscode.Uri.file(path.join(grant.path, name)))
            : await vscode.workspace.findFiles(new vscode.RelativePattern(folder, SOURCE_GLOB),
                `{${[...HARD_EXCLUDE, ...pushedDownExcludes].join(',')}}`, limits.maxCandidates + 1, token.token);
        check(); const candidates = new Map(found.map(uri => [uri.toString(), uri]));
        for (const document of vscode.workspace.textDocuments || []) if (document.uri.scheme === 'file'
            && /\.bsv$/i.test(document.uri.path) && inside(relative(grant.path, document.uri.fsPath))) candidates.set(document.uri.toString(), document.uri);
        const all = [...candidates.values()].sort((a, b) => a.toString() < b.toString() ? -1 : 1);
        const truncated = all.length > limits.maxCandidates;
        let bytes = 0;
        for (const uri of all.slice(0, limits.maxCandidates)) {
            check();
            const name = uri.scheme === 'file' ? relative(grant.path, uri.fsPath) : uri.toString();
            const owningFolder = vscode.workspace.getWorkspaceFolder?.(uri);
            const explicit = matches(name, includes, globBudget), rootIncluded = !roots.length || roots.some(root => root === '.' || name.startsWith(`${root}/`));
            const reason = !inside(name) || uri.scheme !== 'file' ? 'outside-workspace'
                : owningFolder && owningFolder.uri.toString() !== folder.uri.toString() ? 'another-workspace-folder'
                : matches(name, HARD_EXCLUDE, globBudget) ? 'cache-or-evidence'
                    : !explicit && !rootIncluded ? 'configured-source-roots'
                        : !explicit && matches(name, rules.exclude, globBudget) ? 'configured-exclude' : null;
            if (reason) { excluded.push({ path: name, reason }); continue; }
            try { validateSourcePath(name); }
            catch (_) { unanalysed.push({ path: name, reason: 'unsupported-source-reference' }); continue; }
            try {
                const { stat } = await sourcePath(grant, uri.fsPath);
                if (stat.size > limits.maxFileBytes) { unanalysed.push({ path: name, reason: 'file-byte-limit', bytes: stat.size }); continue; }
                if (sources.length >= limits.maxFiles || bytes + stat.size > limits.maxSourceBytes) {
                    unanalysed.push({ path: name, reason: sources.length >= limits.maxFiles ? 'file-count-limit' : 'total-byte-limit', bytes: stat.size }); continue;
                }
                const classification = /(^|\/)(tb|tests?|testbench)(\/|$)/i.test(name) ? 'testbench-path-candidate' : 'source';
                sources.push({ path: name }); bytes += stat.size;
                included.push({ path: name, bytes: stat.size, classification, inclusion: explicit ? 'explicit-include' : 'workspace-source' });
            } catch (error) {
                if (!incremental || error.code !== 'ENOENT') unanalysed.push({ path: name, reason: error.code === 'PATH_DENIED' ? 'symlink-or-authority' : 'unavailable' });
            }
        }
        const dirty = (vscode.workspace.textDocuments || []).filter(document => document.isDirty && document.uri.scheme === 'file'
            && included.some(row => row.path === relative(grant.path, document.uri.fsPath))).map(document => ({ path: relative(grant.path, document.uri.fsPath), version: document.version }));
        await verifyDirectoryGrant(grant); check();
        const summary = { status: truncated || unanalysed.length ? 'partial' : sources.length ? 'ready' : 'no-bsv',
            workspace: { name: folder.name, uri: folder.uri.toString() }, discoveredFiles: all.length,
            analyzedFiles: sources.length, sourceBytes: bytes, included, excluded, unanalysed, dirtyDocuments: dirty,
            truncated, rules, limits, diagnostics, compilerExecuted: false, sourceMode: 'saved-disk', elapsedMs: performance.now() - started,
            discoveryMode: incremental ? 'changed-file-inventory' : 'workspace-search',
            fingerprint: hash(stable(included.map(({ path, bytes }) => ({ path, bytes })))) };
        return { sourceRoot: grant.path, rootGrants: { sourceRoot: grant },
            manifest: { version: 1, label: folder.name, sources }, discovery: summary };
    } finally { clearTimeout(timer); token.dispose(); signal?.removeEventListener('abort', abort); }
}

function watchWorkspace({ vscode, folder, onInvalidated }) {
    const subscriptions = [], changed = new Set();
    let timer = null, disposed = false, revision = 0, rescanReason = null;
    function invalidate(uri, reason = 'source-changed') {
        if (disposed) return;
        if (uri) {
            if (uri.scheme !== 'file') return;
            const name = relative(folder.uri.fsPath, uri.fsPath);
            if (!inside(name) || matches(name, HARD_EXCLUDE)) return;
            changed.add(name);
        }
        if (reason === 'workspace-folders-changed' || reason === 'configuration-changed' && !rescanReason) rescanReason = reason;
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const payload = { reason: rescanReason || reason, changedFiles: [...changed].sort(), revision: ++revision,
                autoRefresh: vscode.workspace.getConfiguration('bsvArchitecture', folder.uri).get('autoRefresh', true) };
            rescanReason = null;
            changed.clear(); if (!disposed) onInvalidated(payload);
        }, 350);
    }
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, SOURCE_GLOB));
    subscriptions.push(watcher, watcher.onDidChange(uri => invalidate(uri)), watcher.onDidCreate(uri => invalidate(uri, 'source-created')),
        watcher.onDidDelete(uri => invalidate(uri, 'source-deleted')));
    const configWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.bsv-arch.json'));
    subscriptions.push(configWatcher, configWatcher.onDidChange(uri => invalidate(uri, 'configuration-changed')),
        configWatcher.onDidCreate(uri => invalidate(uri, 'configuration-changed')), configWatcher.onDidDelete(uri => invalidate(uri, 'configuration-changed')));
    subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => { if (/\.bsv$/i.test(document.uri.path)) invalidate(document.uri, 'source-saved'); }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (['bsvArchitecture', 'files.exclude', 'files.watcherExclude'].some(key => event.affectsConfiguration(key, folder.uri))) invalidate(null, 'configuration-changed');
        }), vscode.workspace.onDidChangeWorkspaceFolders(() => invalidate(null, 'workspace-folders-changed')));
    return { dispose() { disposed = true; clearTimeout(timer); rescanReason = null; subscriptions.forEach(item => item?.dispose()); changed.clear(); },
        diagnostics: () => ({ disposed, pendingChanges: changed.size, revision, watchers: disposed ? 0 : 2 }) };
}

module.exports = { discoverWorkspace, watchWorkspace, sourcePath, matches, SOURCE_GLOB, HARD_EXCLUDE, DISCOVERY_LIMITS };
