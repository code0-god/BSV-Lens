'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { discoverWorkspace, watchWorkspace, matches } = require('../src/panel/hardware-discovery');
const { loadNativeInput } = require('../src/hardware/native-input');
const bsv = name => `package ${name}; module mk${name}(Empty); endmodule endpackage`;
const uri = file => ({ scheme: 'file', fsPath: file, path: file, toString: () => pathToFileURL(file).href });
function event() {
    const listeners = new Set();
    return { add(fn) { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
        fire(value) { listeners.forEach(fn => fn(value)); }, count: () => listeners.size };
}
async function fixture(t) {
    const runs = path.resolve(__dirname, '../.build/hardware/runs'); await fs.mkdir(runs, { recursive: true });
    const root = path.join(await fs.mkdtemp(path.join(runs, 'g6-usability-discovery-')), 'g6-usability'); await fs.mkdir(root);
    const folder = { name: 'Independent workspace', uri: uri(root) }, settings = { exclude: [] }, files = [], searches = [], watchers = [];
    const save = event(), config = event(), folders = event();
    class CancellationTokenSource {
        constructor() { const cancelled = event(); this.cancelled = cancelled; this.token = { isCancellationRequested: false, onCancellationRequested: cancelled.add }; }
        cancel() { this.token.isCancellationRequested = true; this.cancelled.fire(); }
        dispose() {}
    }
    const vscode = { env: { uiKind: 1 }, UIKind: { Web: 2 }, Uri: { file: uri }, CancellationTokenSource,
        RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
        workspace: { workspaceFolders: [folder], textDocuments: [],
            getConfiguration(namespace) { return { get: (name, fallback) => namespace === 'files' ? {} : settings[name] ?? fallback }; },
            async findFiles(include, exclude, maxResults, token) { searches.push({ include, exclude, maxResults, token }); return files.slice(0, maxResults); },
            createFileSystemWatcher(pattern) {
                const change = event(), create = event(), remove = event();
                const watcher = { pattern, change, create, remove, disposed: false,
                    onDidChange: change.add, onDidCreate: create.add, onDidDelete: remove.add,
                    dispose() { this.disposed = true; } };
                watchers.push(watcher); return watcher;
            }, onDidSaveTextDocument: save.add, onDidChangeConfiguration: config.add, onDidChangeWorkspaceFolders: folders.add } };
    async function add(name, text = bsv(path.basename(name, path.extname(name)))) {
        const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); files.push(uri(file)); return file;
    }
    t.diagnostic(`Discovery API-boundary evidence: ${root}`);
    return { root, folder, vscode, settings, files, searches, watchers, save, config, folders, add,
        discover: signal => discoverWorkspace({ vscode, folder, signal }) };
}

test('bounded workspace discovery includes deep mixed-case sources, libraries and testbench candidates without name-based removal', async t => {
    const f = await fixture(t);
    await f.add('deep/hardware/unit/Engine.BSV'); await f.add('vendor/Lib.bsv'); await f.add('tb/Harness.bsv'); await f.add('dist/Output.bsv');
    const result = await f.discover();
    assert.equal(result.manifest.sources.length, 4); assert.equal(result.discovery.status, 'ready');
    assert.equal(result.discovery.included.find(row => row.path === 'tb/Harness.bsv').classification, 'testbench-path-candidate');
    assert.equal(result.discovery.compilerExecuted, false); assert.equal(f.searches[0].include.base, f.folder);
    assert.ok(f.searches[0].token); assert.equal(f.searches[0].maxResults, 1025);
    assert.equal(f.searches[0].exclude.includes('build/'), true, 'Only explicit .build evidence cache appears in hard excludes');
    assert.equal(f.searches[0].exclude.includes('**/build/**'), false);
});
test('configured exclusions retain reasons and explicit include can recover build/test sources', async t => {
    const f = await fixture(t); await f.add('Main.bsv'); await f.add('build/Generated.bsv'); await f.add('tb/Harness.bsv');
    f.settings.exclude = ['**/build/**'];
    await fs.writeFile(path.join(f.root, '.bsv-arch.json'), '{"sourceRoots":["."],"exclude":["tb/**"]}');
    const excluded = await f.discover();
    assert.deepEqual(excluded.manifest.sources.map(row => row.path), ['Main.bsv']);
    assert.equal(excluded.discovery.excluded.length, 2);
    f.settings.hardwareInclude = ['**/build/**', 'tb/**'];
    assert.equal((await f.discover()).manifest.sources.length, 3);
});
test('configured build copies are excluded before the search cap without overriding explicit source inclusion', async t => {
    const f = await fixture(t), late = await f.add('tests/LastSource.bsv');
    f.settings.exclude = ['**/build/**'];
    const copies = Array.from({ length: 1025 }, (_, index) => uri(path.join(f.root, `build/copy${index}.bsv`)));
    f.files.splice(0, f.files.length, ...copies, uri(late));
    f.vscode.workspace.findFiles = async (include, exclude, maxResults, token) => {
        f.searches.push({ include, exclude, maxResults, token });
        const omitBuild = exclude.slice(1, -1).split(',').includes('**/build/**');
        return f.files.filter(file => !omitBuild || !file.fsPath.startsWith(path.join(f.root, 'build') + path.sep)).slice(0, maxResults);
    };
    const complete = await f.discover();
    assert.deepEqual(complete.manifest.sources, [{ path: 'tests/LastSource.bsv' }]);
    assert.equal(complete.discovery.status, 'ready'); assert.equal(complete.discovery.truncated, false);
    assert.deepEqual(complete.discovery.rules.pushedDownExcludes, ['**/build/**']);
    assert.equal(f.searches[0].maxResults, 1025);
    f.settings.hardwareInclude = ['build/Explicit.bsv'];
    f.files.splice(0, f.files.length, uri(late)); await f.add('build/Explicit.bsv');
    const explicit = await f.discover();
    assert.deepEqual(explicit.manifest.sources.map(source => source.path), ['build/Explicit.bsv', 'tests/LastSource.bsv']);
    assert.deepEqual(explicit.discovery.rules.pushedDownExcludes, []);
    assert.equal(f.searches[1].exclude.includes('**/build/**'), false);
});
test('search pushdown keeps ambiguous glob syntax and conditional excludes in the existing postfilter', async t => {
    const f = await fixture(t); await f.add('Keep.bsv');
    f.settings.exclude = ['**/build/**', 'deep/cache*/**', 'nested/b?r/**', '**/build/**', '**/{one,two}/**',
        '**/b[ui]ild/**', '**/comma,name/**', '**/back\\slash/**', '/absolute/**', '../outside/**', 'deep/**/cache/**', '**/*.bsv'];
    const previous = f.vscode.workspace.getConfiguration;
    f.vscode.workspace.getConfiguration = namespace => namespace === 'files'
        ? { get: () => ({ 'from-files/**': true, 'disabled/**': false, 'conditional/**': { when: '$(basename).js' } }) } : previous(namespace);
    const result = await f.discover();
    const expected = ['**/build/**', 'deep/cache*/**', 'nested/b?r/**', 'from-files/**'];
    assert.deepEqual(result.discovery.rules.pushedDownExcludes, expected);
    assert.equal(f.searches[0].exclude, `{${[...result.discovery.rules.hardExclude, ...expected].join(',')}}`);
    assert.equal(result.discovery.rules.searchExcludeApplied, false);
    assert.deepEqual(result.discovery.rules.conditionalFileExcludes, ['conditional/**']);
    assert.deepEqual(result.discovery.excluded, [{ path: 'Keep.bsv', reason: 'configured-exclude' }], 'Non-pushed file glob remains enforced after search');
});
test('symlink escape and outside URI are rejected individually while valid workspace source remains available', async t => {
    const f = await fixture(t), good = await f.add('Safe.bsv');
    const outside = path.join(path.dirname(f.root), 'Outside.bsv'); await fs.writeFile(outside, bsv('Outside'));
    const link = path.join(f.root, 'Escape.bsv'); await fs.symlink(outside, link);
    f.files.push(uri(link), uri(outside));
    const result = await f.discover();
    assert.deepEqual(result.manifest.sources, [{ path: 'Safe.bsv' }]);
    assert.equal(result.discovery.status, 'partial');
    assert.equal(result.discovery.unanalysed[0].reason, 'symlink-or-authority');
    assert.equal(result.discovery.excluded[0].reason, 'outside-workspace');
    const loaded = await loadNativeInput(result); assert.equal(loaded.sources[0].path, good);
    assert.equal(loaded.sourceModel.instances.some(item => item.name === 'mkOutside'), false);
});
test('file count and per-file bytes report partial inventory instead of claiming complete discovery', async t => {
    const f = await fixture(t); await f.add('A.bsv'); await f.add('B.bsv'); await f.add('Huge.bsv', 'x'.repeat(1024));
    f.settings.maxFiles = 1; f.settings.maxSourceBytes = 128;
    const result = await f.discover();
    assert.equal(result.manifest.sources.length, 1); assert.equal(result.discovery.status, 'partial');
    assert.deepEqual(new Set(result.discovery.unanalysed.map(row => row.reason)), new Set(['file-count-limit', 'file-byte-limit']));
});
test('a file growing beyond the configured discovery size cannot be imported after its initial stat check', async t => {
    const f = await fixture(t), file = await f.add('Growing.bsv'); f.settings.maxSourceBytes = 128;
    const selected = await f.discover();
    await fs.writeFile(file, bsv('Growing') + ' '.repeat(256));
    await assert.rejects(loadNativeInput(selected), { code: 'LIMIT_EXCEEDED' });
});
test('empty, function-only and dirty sources are distinct and original bytes remain unchanged', async t => {
    const f = await fixture(t); assert.equal((await f.discover()).discovery.status, 'no-bsv');
    const file = await f.add('Functions.bsv', 'package Functions; function Bit#(8) increment(Bit#(8) x); return x + 1; endfunction endpackage');
    f.vscode.workspace.textDocuments.push({ uri: uri(file), isDirty: true, version: 7, getText: () => 'UNSAVED' });
    const input = await loadNativeInput(await f.discover());
    assert.equal(input.summary.discovery.status, 'no-module'); assert.deepEqual(input.catalog, []);
    assert.equal(input.summary.discovery.dirtyDocuments[0].version, 7); assert.equal(input.summary.discovery.sourceMode, 'saved-disk');
    assert.equal(input.sources[0].capturedText.includes('UNSAVED'), false);
});
test('separate workspace folders keep same package/module names in independent sessions', async t => {
    const first = await fixture(t), second = await fixture(t);
    await first.add('Equal.bsv', bsv('Equal')); await second.add('Equal.bsv', bsv('Equal'));
    first.vscode.workspace.workspaceFolders.push(second.folder);
    const a = await loadNativeInput(await first.discover()), b = await loadNativeInput(await second.discover());
    assert.equal(a.sources.length, 1); assert.equal(b.sources.length, 1); assert.notEqual(a.sources[0].path, b.sources[0].path);
    assert.notEqual(first.folder.uri.toString(), second.folder.uri.toString());
});
test('cancelled or removed workspace discovery cannot grant input authority', async t => {
    const f = await fixture(t), controller = new AbortController(); controller.abort();
    await assert.rejects(f.discover(controller.signal), { code: 'CANCELLED' });
    f.vscode.workspace.workspaceFolders = [];
    await assert.rejects(f.discover(), { code: 'PATH_DENIED' });
});
test('nested workspace projects and unsupported logical filenames cannot contaminate a valid source set', async t => {
    const f = await fixture(t); await f.add('Owner.bsv'); await f.add('child/Other.bsv'); await f.add('Odd%Name.bsv');
    const child = { name: 'Nested independent project', uri: uri(path.join(f.root, 'child')) };
    f.vscode.workspace.workspaceFolders.push(child);
    f.vscode.workspace.getWorkspaceFolder = value => value.fsPath.startsWith(child.uri.fsPath + path.sep) ? child : f.folder;
    const result = await f.discover();
    assert.deepEqual(result.manifest.sources, [{ path: 'Owner.bsv' }]);
    assert.equal(result.discovery.excluded[0].reason, 'another-workspace-folder');
    assert.equal(result.discovery.unanalysed[0].reason, 'unsupported-source-reference');
});
test('hostile include/exclude glob patterns use deterministic bounded matching rather than regex backtracking', async t => {
    const f = await fixture(t), name = 'a'.repeat(60) + '.bsv'; await f.add(name, bsv('Safe'));
    f.settings.exclude = ['*a'.repeat(24) + 'b'];
    const started = performance.now(), result = await f.discover();
    assert.equal(result.manifest.sources.length, 1); assert.ok(performance.now() - started < 1000);
    assert.equal(matches('deep/a/File.BSV', ['**/*.bsv']), true);
    assert.equal(matches('File.bsv', ['**/*.bsv']), true);
    assert.equal(matches('deep/a/File.bsv', ['deep/*.bsv']), false);
    assert.equal(matches('file1.bsv', ['file?.bsv']), true);
    assert.throws(() => matches('a'.repeat(512), ['*a'.repeat(100)], { remaining: 10 }), { code: 'LIMIT_EXCEEDED' });
});
test('the exact product evidence subtree is excluded without excluding unrelated evidence-named source folders', async t => {
    const f = await fixture(t); await f.add('docs/hardware/evidence/capture/Huge.bsv');
    await f.add('evidence-controller/Real.bsv'); await f.add('vendor/Library.bsv');
    const found = await f.discover();
    assert.deepEqual(found.manifest.sources.map(item => item.path), ['evidence-controller/Real.bsv', 'vendor/Library.bsv']);
    assert.equal(found.discovery.excluded[0].reason, 'cache-or-evidence');
    assert.ok(found.discovery.rules.hardExclude.includes('**/docs/hardware/evidence/**'));
});
test('changed-file refresh reuses inventory and removes deleted paths without another workspace search', async t => {
    const f = await fixture(t), deleted = await f.add('Old.bsv'); await f.add('Keep.bsv');
    const initial = await f.discover(); await fs.unlink(deleted); await f.add('Added.bsv');
    const result = await discoverWorkspace({ vscode: f.vscode, folder: f.folder, previous: initial.discovery, changedFiles: ['Old.bsv', 'Added.bsv'] });
    assert.equal(f.searches.length, 1); assert.equal(result.discovery.discoveryMode, 'changed-file-inventory');
    assert.deepEqual(result.manifest.sources.map(row => row.path), ['Added.bsv', 'Keep.bsv']);
    assert.equal(result.discovery.unanalysed.length, 0);
});
test('external changes, save and rename coalesce; configuration changes notify; dispose cleans all subscriptions', async t => {
    const f = await fixture(t), file = await f.add('First.bsv'), received = [];
    let resolve;
    const next = () => new Promise(done => { resolve = done; });
    const watcher = watchWorkspace({ vscode: f.vscode, folder: f.folder, onInvalidated: event => { received.push(event); resolve?.(); } });
    const change = next(); f.watchers[0].change.fire(uri(file)); f.save.fire({ uri: uri(file) });
    f.watchers[0].remove.fire(uri(file)); f.watchers[0].create.fire(uri(path.join(f.root, 'Renamed.bsv')));
    await change; assert.equal(received.length, 1); assert.deepEqual(received[0].changedFiles, ['First.bsv', 'Renamed.bsv']);
    const config = next(); f.settings.autoRefresh = false; f.config.fire({ affectsConfiguration: key => key === 'bsvArchitecture' });
    await config; assert.equal(received[1].autoRefresh, false);
    watcher.dispose(); assert.equal(f.save.count() + f.config.count() + f.folders.count(), 0);
    assert.equal(watcher.diagnostics().watchers, 0); assert.ok(f.watchers.every(item => item.disposed));
});
test('configuration and workspace rescans survive later saved-file events in the same debounce batch', async t => {
    for (const reason of ['configuration-changed', 'workspace-folders-changed']) {
        const f = await fixture(t), one = await f.add('One.bsv'), initial = await f.discover();
        await f.add('Two.bsv');
        let resolve;
        const next = () => new Promise(done => { resolve = done; });
        const watcher = watchWorkspace({ vscode: f.vscode, folder: f.folder, onInvalidated: event => resolve(event) });
        t.after(() => watcher.dispose());
        const batch = next();
        f.config.fire({ affectsConfiguration: key => key === 'files.watcherExclude' });
        if (reason === 'workspace-folders-changed') f.folders.fire({ added: [], removed: [] });
        f.save.fire({ uri: uri(one) });
        const notice = await batch;
        assert.equal(notice.reason, reason); assert.deepEqual(notice.changedFiles, ['One.bsv']);
        const fullDiscovery = ['configuration-changed', 'workspace-folders-changed'].includes(notice.reason);
        const updated = await discoverWorkspace({ vscode: f.vscode, folder: f.folder, previous: initial.discovery,
            changedFiles: fullDiscovery ? null : notice.changedFiles });
        assert.equal(f.searches.length, 2); assert.equal(updated.discovery.status, 'ready');
        assert.deepEqual(updated.manifest.sources.map(source => source.path), ['One.bsv', 'Two.bsv']);
        const following = next(); f.save.fire({ uri: uri(one) });
        assert.equal((await following).reason, 'source-saved', 'A completed rescan does not leak into the next batch');
    }
});
