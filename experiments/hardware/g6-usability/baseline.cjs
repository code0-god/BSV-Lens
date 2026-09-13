'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { entry } = require('../g6/preservation.cjs');
const { runtime } = require('../g4-fix/package.cjs');
const { forbidden } = require('../g4/validate-delivery');
const { workspaceInventory } = require('../g6/live-compiler.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const SELF = 'experiments/hardware/g6-usability/baseline.cjs';
const OMIT = new Set(['.git', '.omo', '.omx', '.codegraph', 'node_modules']);
const RUNS = '.build/hardware/runs';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sort = rows => rows.sort((a, b) => a.path.localeCompare(b.path));
const write = (directory, name, value) => {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' });
    return { file: name, bytes: bytes.length, sha256: hash(bytes) };
};
function createOutput(label) {
    fs.mkdirSync(path.join(ROOT, RUNS), { recursive: true });
    const output = path.join(fs.mkdtempSync(path.join(ROOT, RUNS, `g6-usability-${label}-`)), 'g6-usability');
    fs.mkdirSync(output); return output;
}
function walk(root, relative = '', skip = () => false) {
    return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(item => {
        const name = relative ? `${relative}/${item.name}` : item.name;
        if (OMIT.has(item.name) || skip(name)) return [];
        return item.isDirectory() ? walk(root, name, skip) : [name];
    });
}
function command(root, args) {
    let stdout = '', stderr = '', exit = 0;
    try { stdout = execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
    catch (error) { stdout = String(error.stdout || ''); stderr = String(error.stderr || error.message); exit = error.status ?? -1; }
    return { executable: 'git', args: ['-C', root, ...args], exit, stdout, stderr };
}
function gitIdentity(root) {
    const commands = { branch: ['branch', '--show-current'], head: ['rev-parse', 'HEAD'], originMain: ['rev-parse', '--verify', 'refs/remotes/origin/main'],
        status: ['status', '--porcelain=v1', '--untracked-files=all'], staged: ['diff', '--cached', '--name-status'], unstaged: ['diff', '--name-status'],
        stagedDiff: ['diff', '--cached', '--binary'], unstagedDiff: ['diff', '--binary'], untracked: ['ls-files', '--others', '--exclude-standard', '-z'] };
    return Object.fromEntries(Object.entries(commands).map(([key, args]) => [key, command(root, args)]));
}
async function capture({ root = ROOT, workspace, prior, output = createOutput('baseline') }) {
    assert.ok(workspace && prior, 'Explicit actual workspace and previous G6 baseline required');
    const startedAt = new Date().toISOString();
    const git = gitIdentity(root), manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))), lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
    const featureNames = ['src', 'media', 'scripts', 'experiments', 'test'].flatMap(directory => walk(root, directory, name => forbidden(name) || name === SELF));
    featureNames.push('package.json', 'package-lock.json');
    const feature = sort(runtime(featureNames.filter(name => fs.lstatSync(path.join(root, name)).isFile()).map(name => ({ name: `bsv-lens/${name}`, data: fs.readFileSync(path.join(root, name)) }))));
    const featureFile = write(output, 'feature.inventory.json', { definition: 'Prior G4/G5/G6 runtime filter: package/package-lock plus js/cjs/mjs/py/sh/tcl/html/css under src/media/scripts/experiments/test, archive forbidden-path exclusions, path.localeCompare order. Newly created baseline writer excluded from pre-task identity.', files: feature, fingerprint: hash(JSON.stringify(feature)) });
    const identity = write(output, 'identity.json', { schema: 'g6-usability-start-identity-v1', startedAt, root, git, version: manifest.version,
        lockPackageVersion: lock.version, lockRootVersion: lock.packages?.['']?.version, feature: featureFile, featureFingerprint: hash(JSON.stringify(feature)), featureFiles: feature.length });
    console.log(JSON.stringify({ phase: 'runtime-baseline-captured', output, featureFiles: feature.length, featureFingerprint: hash(JSON.stringify(feature)), identity }));
    const actual = workspaceInventory(fs.realpathSync(workspace));
    const sourceFiles = sort(walk(workspace).filter(name => /\.bsv$/i.test(name)).map(name => {
        const file = path.join(workspace, name), stat = fs.lstatSync(file);
        return stat.isSymbolicLink() ? { path: name, kind: 'symlink', target: fs.readlinkSync(file) } : { path: name, kind: 'file', bytes: stat.size, sha256: hash(fs.readFileSync(file)) };
    }));
    const workspaceFile = write(output, 'actual-workspace.inventory.json', { ...actual, schema: 'g6-usability-workspace-baseline-v1', allBsvFiles: sourceFiles,
        allBsvFingerprint: hash(JSON.stringify(sourceFiles)), allBsvDefinition: 'Every .bsv case-insensitive path inside actual workspace, excluding .git/.omo/.omx/.codegraph/node_modules, without following symlinks. This is preservation inventory, not automatic-discovery inclusion policy.' });
    const priorBytes = fs.readFileSync(prior), old = JSON.parse(priorBytes); assert.equal(old.schema, 'g6-baseline-v1');
    assert.equal(hash(JSON.stringify(old.entries)), old.fingerprint, 'Previous baseline descriptor integrity');
    const names = [...new Set([...walk(root, '', name => name === RUNS || name === SELF), ...old.entries.filter(row => row.path.startsWith(`${RUNS}/`)).map(row => row.path)])];
    const entries = [], failures = []; let cursor = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
        while (cursor < names.length) { const name = names[cursor++]; try { entries.push(await entry(root, { path: name })); } catch (error) { failures.push({ path: name, error: error.message }); } }
    }));
    assert.equal(failures.length, 0, JSON.stringify(failures)); sort(entries);
    const captured = new Map(entries.map(row => [row.path, row]));
    for (const row of feature) assert.deepEqual(captured.get(row.path.slice(9)), { path: row.path.slice(9), kind: 'file', bytes: row.bytes, sha256: row.sha256 }, `Runtime changed during baseline: ${row.path}`);
    const historical = sort(walk(root, RUNS, name => name.split('/')[3]?.startsWith('g6-usability-')).map(name => {
        const stat = fs.lstatSync(path.join(root, name));
        return { path: name, kind: stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'non-file', bytes: stat.size, mtimeMs: stat.mtimeMs,
            ...(stat.isSymbolicLink() ? { target: fs.readlinkSync(path.join(root, name)) } : {}) };
    }));
    const content = write(output, 'protected-content.inventory.json', { schema: 'g6-usability-content-inventory-v1', files: entries, fingerprint: hash(JSON.stringify(entries)) });
    const historicalFile = write(output, 'historical-runs.inventory.json', { schema: 'g6-usability-historical-metadata-v1', files: historical, fingerprint: hash(JSON.stringify(historical)) });
    const categories = Object.fromEntries(['src/', 'media/', 'scripts/', 'experiments/', 'test/', 'docs/hardware/evidence/', 'dist/'].map(prefix => [prefix, entries.filter(row => row.path.startsWith(prefix)).length]));
    const baseline = { schema: 'g6-usability-baseline-v1', startedAt, finishedAt: new Date().toISOString(), root, identity, feature: featureFile, workspace: workspaceFile,
        content, historical: historicalFile, categories, previousBaseline: { path: path.resolve(prior), bytes: priorBytes.length, sha256: hash(priorBytes), entries: old.entries.length },
        policy: { content: 'Rehashed all current repository regular files/symlink targets except process/tool local state and historical run trees; all prior G6 content-protected run members remain content-protected. Current indexed G6 evidence and every previous dist artifact are content-protected.',
            historical: 'All pre-follow-up run members checked by path/type/size/mtime and symlink target; metadata scope only, not a new content-hash claim. Current g6-usability-* runs excluded by explicit new-task output namespace.',
            excludedNames: [...OMIT], baselineWriter: SELF, currentRunPrefix: `${RUNS}/g6-usability-`, previousHashesReused: false } };
    write(output, 'baseline.json', baseline);
    console.log(JSON.stringify({ phase: 'complete', output, featureFiles: feature.length, contentFiles: entries.length, historicalFiles: historical.length,
        workspaceSourceFiles: actual.sourceFiles, allWorkspaceBsvFiles: sourceFiles.length, categories })); return baseline;
}
async function verify(file, allowed = [], { output = createOutput('preservation') } = {}) {
    const baseline = JSON.parse(fs.readFileSync(file)); assert.equal(baseline.schema, 'g6-usability-baseline-v1');
    const load = descriptor => { const bytes = fs.readFileSync(path.join(path.dirname(file), descriptor.file)); assert.equal(hash(bytes), descriptor.sha256); return JSON.parse(bytes); };
    const { files } = load(baseline.content), names = new Set(files.map(row => row.path));
    assert.equal(new Set(allowed).size, allowed.length);
    for (const name of allowed) assert.ok(names.has(name) && /^(?:src\/|media\/|scripts\/|test\/|experiments\/hardware\/(?!fixtures\/)|package(?:-lock)?\.json$)/.test(name)
        && !/[\0\\*?]/.test(name) && !name.split('/').includes('..'), `Protected/unrecognized change: ${name}`);
    const changes = []; let cursor = 0;
    await Promise.all(Array.from({ length: 8 }, async () => { while (cursor < files.length) { const before = files[cursor++], after = await entry(baseline.root, before); if (!isDeepStrictEqual(before, after)) changes.push({ before, after }); } }));
    const historicalChanges = [];
    for (const before of load(baseline.historical).files) {
        let after; try { const stat = fs.lstatSync(path.join(baseline.root, before.path)); after = { path: before.path, kind: stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'non-file', bytes: stat.size, mtimeMs: stat.mtimeMs,
            ...(stat.isSymbolicLink() ? { target: fs.readlinkSync(path.join(baseline.root, before.path)) } : {}) }; } catch (error) { if (error.code !== 'ENOENT') throw error; after = { path: before.path, kind: 'missing' }; }
        if (!isDeepStrictEqual(before, after)) historicalChanges.push({ before, after });
    }
    const workspace = load(baseline.workspace), workspaceChanges = [];
    const workspaceFiles = new Map(workspace.files.map(row => [row.path, { kind: 'file', ...row }]));
    for (const row of workspace.allBsvFiles) workspaceFiles.set(row.path, row);
    for (const before of workspaceFiles.values()) {
        const after = await entry(workspace.workspace, before);
        if (!isDeepStrictEqual({ ...before, path: before.path }, { ...after, path: after.path })) workspaceChanges.push({ before, after });
    }
    const unauthorized = changes.filter(row => !allowed.includes(row.before.path));
    const receipt = { schema: 'g6-usability-preservation-v1', baseline: path.resolve(file), status: !unauthorized.length && !historicalChanges.length && !workspaceChanges.length ? 'pass' : 'fail',
        checked: files.length, unchanged: files.length - changes.length, allowed, changes, unauthorized, historicalChanges, workspaceChanges };
    write(output, 'preservation.json', receipt); console.log(JSON.stringify({ output, status: receipt.status, checked: receipt.checked, changes: changes.length,
        unauthorized: unauthorized.length, historicalChanges: historicalChanges.length, workspaceChanges: workspaceChanges.length }));
    assert.equal(receipt.status, 'pass'); return receipt;
}
async function selfTest() {
    const output = createOutput('baseline-self-test'), root = path.join(output, 'fixture'), workspace = path.join(output, 'workspace');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true }); fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(root, 'src/input.js'), 'before'); fs.writeFileSync(path.join(root, 'capture.json'), 'capture'); fs.writeFileSync(path.join(workspace, 'Design.bsv'), 'module');
    const files = await Promise.all(['src/input.js', 'capture.json'].map(name => entry(root, { path: name })));
    const content = write(output, 'protected.json', { files });
    const historical = write(output, 'historical.json', { files: [] });
    const source = await entry(workspace, { path: 'Design.bsv' });
    const workspaceFile = write(output, 'workspace.json', { workspace, files: [], allBsvFiles: [source] });
    write(output, 'baseline.json', { schema: 'g6-usability-baseline-v1', root, content, historical, workspace: workspaceFile });
    const file = path.join(output, 'baseline.json'); await verify(file);
    fs.writeFileSync(path.join(root, 'src/input.js'), 'after'); await verify(file, ['src/input.js']);
    await assert.rejects(verify(file), /fail/); await assert.rejects(verify(file, ['capture.json']), /Protected/);
    fs.writeFileSync(path.join(workspace, 'Design.bsv'), 'modified'); await assert.rejects(verify(file, ['src/input.js']), /fail/);
    write(output, 'self-test.json', { status: 'pass', cases: ['unchanged', 'exact permitted runtime change', 'unauthorized change rejected', 'evidence cannot be allowlisted', 'all-workspace BSV change rejected'] });
    console.log(JSON.stringify({ output, selfTest: 'pass', cases: 5 }));
}
if (require.main === module) {
    const [mode, ...args] = process.argv.slice(2);
    const result = mode === '--capture' ? capture({ workspace: args[0], prior: args[1] }) : mode === '--verify' ? verify(args[0], args.slice(1)) : mode === '--self-test' ? selfTest() : Promise.reject(new Error('Usage: baseline.cjs --capture WORKSPACE PRIOR_BASELINE | --verify BASELINE [EXACT_ALLOWED_FILE ...] | --self-test'));
    result.catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { capture, verify, createOutput };
