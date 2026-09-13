'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { collectFiles } = require('../../../scripts/zip');
const { snapshotCore, collectEntries, companionManifest } = require('./package-review.cjs');
const prior = require('../g5-readability/package.cjs');
const { inventory } = require('./historical-companions.cjs');
const { hash } = require('../g4/validate-delivery');
const { createRun } = require('./run.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const DEPENDENCIES = ['@playwright/test', '@vscode/test-electron'];
function copyTestDependencies(author, workspace, names = DEPENDENCIES) {
    const manifest = JSON.parse(fs.readFileSync(path.join(author, 'package.json'))), copied = new Map(), unavailableOptional = [];
    function locate(name, from) {
        const resolver = createRequire(path.join(from, 'package.json'));
        let file;
        try { file = resolver.resolve(`${name}/package.json`); }
        catch (error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; file = resolver.resolve(name); }
        let directory = path.dirname(file);
        while (directory.startsWith(`${author}${path.sep}`)) {
            const candidate = path.join(directory, 'package.json');
            if (fs.existsSync(candidate) && JSON.parse(fs.readFileSync(candidate)).name === name) return directory;
            directory = path.dirname(directory);
        }
        throw new Error(`Dependency outside explicit author installation: ${name}`);
    }
    function copy(name, from) {
        const directory = locate(name, from), relative = path.relative(author, directory);
        assert.ok(relative.startsWith(`node_modules${path.sep}`), 'Dependency must come from author node_modules');
        if (copied.has(relative)) return copied.get(relative);
        const data = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))), record = { name, version: data.version, path: relative.split(path.sep).join('/') };
        copied.set(relative, record);
        const destination = path.join(workspace, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.cpSync(directory, destination, { recursive: true, errorOnExist: true, force: false, filter: source => {
            if (source !== directory && path.basename(source) === 'node_modules') return false;
            assert.ok(!fs.lstatSync(source).isSymbolicLink(), `Dependency symlink: ${source}`); return true;
        } });
        for (const dependency of Object.keys(data.dependencies || {}).sort()) copy(dependency, directory);
        for (const dependency of Object.keys(data.optionalDependencies || {}).sort()) {
            try { copy(dependency, directory); }
            catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; unavailableOptional.push({ owner: name, name: dependency }); }
        }
        return record;
    }
    for (const name of names) {
        assert.ok(manifest.devDependencies?.[name], `Undeclared author test dependency: ${name}`);
        const record = copy(name, author); assert.equal(record.version, manifest.devDependencies[name], 'Declared test dependency version mismatch');
    }
    const files = inventory(collectFiles(path.join(workspace, 'node_modules'), { prefix: 'node_modules' }));
    return { roots: names, packages: [...copied.values()].sort((a, b) => a.path.localeCompare(b.path)), files,
        fingerprint: hash(JSON.stringify(files)), unavailableOptional,
        scope: 'Author-only test dependency copies; absent from source/review archives and compiler-free shipped replay.' };
}
function counts(stdout) {
    return Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled'].map(key =>
        [key, Number(stdout.match(new RegExp(`# ${key} (\\d+)`))?.[1] ?? -1)]));
}
function changedInputs(workspace, records) {
    return records.filter(row => {
        const file = path.join(workspace, row.path.replace(/^bsv-lens\//, ''));
        return !fs.existsSync(file) || fs.statSync(file).size !== row.bytes || hash(fs.readFileSync(file)) !== row.sha256;
    }).map(row => row.path);
}
function run({ author = ROOT, output = process.env.G6_OUTPUT_DIR || createRun('core') } = {}) {
    const snapshot = snapshotCore({ workspace: author, output }), workspace = snapshot.workspace;
    const dependencies = copyTestDependencies(author, workspace);
    const generated = path.join(output, 'generated'), suite = path.join(output, 'suite'); fs.mkdirSync(generated); fs.mkdirSync(suite);
    const tests = fs.readdirSync(path.join(workspace, 'test')).filter(name => name.endsWith('.test.js')).sort().map(name => `test/${name}`);
    const args = ['--no-global-search-paths', '--test', '--test-reporter=tap', ...tests];
    const environment = { ...process.env, G4_REVIEW_ROOT: workspace, G5_OUTPUT_DIR: generated,
        G5_READABILITY_OUTPUT_DIR: generated, G6_OUTPUT_DIR: generated, GIT_CEILING_DIRECTORIES: output };
    delete environment.NODE_PATH; delete environment.G5_READABILITY_BROWSER_NEGATIVE;
    const startedAt = new Date().toISOString();
    const child = spawnSync(process.execPath, args, { cwd: workspace, env: environment, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(suite, 'stdout.log'), child.stdout || '', { flag: 'wx' });
    fs.writeFileSync(path.join(suite, 'stderr.log'), child.stderr || '', { flag: 'wx' });
    const changed = changedInputs(workspace, snapshot.inventory), dependencyChanges = changedInputs(workspace, dependencies.files);
    const current = inventory(collectEntries({ workspace: author, companion: companionManifest(author), priorCompanion: prior.companionManifest(author) }));
    const authorChanged = !require('node:util').isDeepStrictEqual(current, snapshot.inventory);
    const receipt = { schema: 'g6-core-v1', status: child.status === 0 && !child.error && !changed.length && !dependencyChanges.length && !authorChanged ? 'pass' : 'fail',
        executable: process.execPath, args, cwd: workspace, startedAt, finishedAt: new Date().toISOString(), exit: child.status,
        signal: child.signal, error: child.error?.message, counts: counts(child.stdout || ''), changedInputs: changed, dependencyChanges,
        authorContentChangedDuringExecution: authorChanged, featureIdentity: snapshot.featureIdentity, inputFiles: snapshot.inventory.length,
        dependencies, environment: { node: process.version, platform: process.platform, arch: process.arch, G4_REVIEW_ROOT: workspace,
            G5_OUTPUT_DIR: generated, G5_READABILITY_OUTPUT_DIR: generated, G6_OUTPUT_DIR: generated, GIT_CEILING_DIRECTORIES: output,
            NODE_OPTIONS: environment.NODE_OPTIONS || null, NODE_PATH: null }, stdout: 'suite/stdout.log', stderr: 'suite/stderr.log',
        scope: 'Full test/*.test.js from exact copied source/input snapshot. No browser/native execution claimed; browser-negative is a separate lane.' };
    fs.writeFileSync(path.join(output, 'core.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, status: receipt.status, counts: receipt.counts, changedInputs: changed,
        authorChanged, featureIdentity: snapshot.featureIdentity, dependencyPackages: dependencies.packages.length }));
    assert.equal(receipt.status, 'pass', 'Core execution or input preservation failed; see core.json and suite logs'); return receipt;
}
if (require.main === module) { try { run(); } catch (error) { console.error(error); process.exitCode = 1; } }
module.exports = { run, copyTestDependencies, counts, changedInputs };
