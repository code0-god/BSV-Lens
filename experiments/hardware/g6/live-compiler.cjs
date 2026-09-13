#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { finished } = require('node:stream/promises');
const { createRun } = require('./run.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const WORKSPACE = process.env.G6_WORKSPACE || path.join(os.homedir(), 'aisa-lab/DynDNN/AQuA');
const BSC = '/opt/homebrew/Cellar/bsc/2026.01/bin/bsc';
const YOSYS = path.join(ROOT, '.build/hardware/toolchain/tools/venv/bin/yowasp-yosys');
const SCOPES = {
    scheduler: { file: 'SchedulerSynthTop', top: 'mkSchedulerSynthTop', library: 'FIFO2.v',
        signatures: ['module mkSchedulerSynthTop(MatmulSchedulerIfc#(16))'],
        description: 'Existing SchedulerSynthTop wrapper of actual MatmulScheduler; arrayDim 16; not the whole AQuA system',
        label: 'AQuA live SchedulerSynthTop (arrayDim 16)' },
    memory: { file: 'MemorySynthTop', top: 'mkMemorySynthTop', library: 'RegFile.v',
        signatures: ['module mkMemorySynthTop(Empty)', 'ScratchpadBankIfc#(8, 4, Int#(8))', 'AccumulatorMemIfc#(2, 8, 32)'],
        description: 'Existing MemorySynthTop wrapper: scratchpad rows8/lanes4/Int8, accumulator banks2/rows8/width32; not the whole AQuA system',
        label: 'AQuA live MemorySynthTop (scratchpad 8×4×8; accumulator 2×8×32)' }
};
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const fileRow = (file, root) => { const bytes = fs.readFileSync(file); return { path: path.relative(root, file).split(path.sep).join('/'), bytes: bytes.length, sha256: digest(bytes) }; };
function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
        if (entry.name === '.git' || entry.name === '.omo') return [];
        const file = path.join(directory, entry.name);
        assert.ok(!entry.isSymbolicLink(), `Unreviewed workspace symlink: ${file}`);
        return entry.isDirectory() ? walk(file) : entry.isFile() ? [file] : [];
    });
}
function workspaceInventory(workspace) {
    const git = args => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' }).trim();
    const files = walk(path.join(workspace, 'hw/bsv')).map(file => fileRow(file, workspace)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const sources = files.filter(row => row.path.startsWith('hw/bsv/src/') && row.path.endsWith('.bsv'));
    const fingerprint = crypto.createHash('sha256');
    for (const row of [...sources].sort((a, b) => a.path.localeCompare(b.path))) fingerprint.update(row.path).update('\0').update(fs.readFileSync(path.join(workspace, row.path))).update('\0');
    return { workspace, head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), status: git(['status', '--porcelain=v1']),
        scope: 'Every regular file under hw/bsv; .git/.omo excluded; original build artifacts included', files,
        inventoryFingerprint: digest(JSON.stringify(files)), sourceFiles: sources.length, sourceFingerprint: fingerprint.digest('hex'), sources };
}
async function command(output, name, executable, argv, cwd, env, timeoutMs) {
    const directory = path.join(output, name); fs.mkdirSync(directory);
    const startedAt = new Date().toISOString(), start = performance.now();
    const logs = ['stdout', 'stderr'].map(label => fs.createWriteStream(path.join(directory, `${label}.log`), { flags: 'wx' }));
    const child = spawn(executable, argv, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let spawnError = null, timedOut = false, forceTimer;
    child.on('error', error => { spawnError = { code: error.code, message: error.message }; });
    child.stdout.pipe(logs[0]); child.stderr.pipe(logs[1]);
    const signalGroup = signal => { if (!child.pid) return; try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const timer = setTimeout(() => { timedOut = true; signalGroup('SIGTERM'); forceTimer = setTimeout(() => signalGroup('SIGKILL'), 2000); }, timeoutMs);
    const exit = await new Promise(resolve => child.once('close', (exitCode, signal) => resolve({ exitCode, signal })));
    clearTimeout(timer); clearTimeout(forceTimer); await Promise.all(logs.map(stream => finished(stream)));
    const receipt = { name, startedAt, finishedAt: new Date().toISOString(), durationMs: performance.now() - start,
        executable, executableRealPath: fs.realpathSync(executable), argv, cwd, environment: env, timeoutMs, timedOut, spawnError,
        ...exit, stdout: fileRow(path.join(directory, 'stdout.log'), output), stderr: fileRow(path.join(directory, 'stderr.log'), output) };
    json(path.join(directory, 'receipt.json'), receipt); return receipt;
}
function toolInventory(bsc, yosys, rtlLibrary) {
    const bscHome = path.resolve(path.dirname(bsc), '..');
    const bscFiles = [bsc, path.join(bscHome, 'libexec/bin/bsc'), path.join(bscHome, 'libexec/bin/core/bsc')];
    const venv = path.resolve(path.dirname(yosys), '..');
    const python = fs.realpathSync(path.join(venv, 'bin/python'));
    const library = fs.readdirSync(path.join(venv, 'lib')).find(name => name.startsWith('python'));
    const site = path.join(venv, 'lib', library, 'site-packages');
    const readerFiles = [yosys, python, ...walk(path.join(site, 'yowasp_yosys')).filter(file => /\.(wasm|py)$/.test(file))];
    const packages = fs.readdirSync(site).filter(name => /^(yowasp|wasmtime)/.test(name) && name.endsWith('.dist-info')).map(name => {
        const metadata = fs.readFileSync(path.join(site, name, 'METADATA'), 'utf8');
        return { name: metadata.match(/^Name: (.+)$/m)?.[1], version: metadata.match(/^Version: (.+)$/m)?.[1] };
    });
    return { bsc: bscFiles.map(file => ({ absolutePath: file, ...fileRow(file, bscHome) })),
        reader: readerFiles.map(file => ({ absolutePath: file, ...fileRow(file, venv) })), packages,
        externalRtlLibrary: path.join(bscHome, 'libexec/lib/Verilog', rtlLibrary) };
}
async function main() {
    const workspace = fs.realpathSync(process.argv[2] || WORKSPACE);
    const scopeName = process.argv[3] || 'scheduler', scope = SCOPES[scopeName];
    assert.ok(Object.hasOwn(SCOPES, scopeName) && process.argv.length <= 4, 'Choose the existing scheduler or memory wrapper recipe');
    const output = process.env.G6_OUTPUT_DIR ? path.resolve(process.env.G6_OUTPUT_DIR) : createRun('live-compiler');
    assert.equal(path.basename(output), 'g6');
    const before = workspaceInventory(workspace); json(path.join(output, 'workspace-before.json'), before);
    const bsv = path.join(workspace, 'hw/bsv'), wrapperRelative = `tb/${scope.file}.bsv`, wrapper = path.join(bsv, wrapperRelative);
    const wrapperText = fs.readFileSync(wrapper, 'utf8');
    assert.ok(scope.signatures.every(signature => wrapperText.includes(signature)), 'Existing wrapper scope changed; review before execution');
    const receipt = { schema: 'g6-live-compiler-v1', status: 'running', output, workspace, startedAt: new Date().toISOString(),
        scope: scope.description, recipe: scopeName,
        nativeAcceptance: 'NOT RUN', compiler: 'stock; existing installation; no patches', top: scope.top,
        budgets: { bscMs: 30000, readerMs: 120000 }, commands: [], wrapper: fileRow(wrapper, workspace),
        makefile: fileRow(path.join(bsv, 'Makefile'), workspace), unknown: ['complete consumed compiler/library closure', 'original BSV cell origins', 'source specialization join'] };
    json(path.join(output, 'execution-contract.json'), receipt);
    let failure;
    try {
        const tools = toolInventory(BSC, YOSYS, scope.library); json(path.join(output, 'tools.json'), tools);
        for (const directory of ['bdir', 'info', 'rtl', 'tmp', 'reader-cache', 'libraries']) fs.mkdirSync(path.join(output, directory));
        const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
            TMPDIR: path.join(output, 'tmp'), YOWASP_CACHE_DIR: path.join(output, 'reader-cache'),
            PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', PYTHONHASHSEED: '0' };
        const run = async (name, executable, argv, cwd, timeout) => {
            const result = await command(output, name, executable, argv, cwd, env, timeout); receipt.commands.push(result);
            assert.ok(result.exitCode === 0 && !result.timedOut && !result.spawnError, `${name} failed; inspect ${name}/stderr.log`); return result;
        };
        await run('bsc-version', BSC, ['-v'], bsv, 30000);
        await run('reader-version', YOSYS, ['-V'], output, 120000);
        const args = ['-u', '-verilog', '-p', '+:src/common:src/memory:src/control:src:tb', '-bdir', path.join(output, 'bdir'),
            '-info-dir', path.join(output, 'info'), '-vdir', path.join(output, 'rtl'), '-g', scope.top, wrapperRelative];
        await run('compile', BSC, args, bsv, 30000);
        const libraryRef = `libraries/${scope.library}`, libraryTarget = path.join(output, libraryRef); fs.copyFileSync(tools.externalRtlLibrary, libraryTarget, fs.constants.COPYFILE_EXCL);
        receipt.externalRtlLibrary = { role: `BSC standard ${scope.library} RTL; fully imported, not a substituted blackbox`,
            original: tools.externalRtlLibrary, ...fileRow(libraryTarget, output) };
        const passes = [`read_verilog rtl/${scope.top}.v ${libraryRef}`, `hierarchy -check -top ${scope.top}`,
            'write_rtlil pre-proc.il', 'proc -noopt', 'write_json design.json', 'write_rtlil design.il'];
        fs.writeFileSync(path.join(output, 'reader.ys'), `${passes.join('\n')}\n`, { flag: 'wx' });
        await run('reader', YOSYS, ['-s', 'reader.ys'], output, 120000);
        const raw = JSON.parse(fs.readFileSync(path.join(output, 'design.json'), 'utf8'));
        receipt.artifact = fileRow(path.join(output, 'design.json'), output);
        receipt.model = { definitions: Object.keys(raw.modules).length, modules: Object.entries(raw.modules).map(([name, module]) => ({
            name, cells: Object.keys(module.cells || {}).length, ports: Object.keys(module.ports || {}).length,
            netnames: Object.keys(module.netnames || {}).length, memories: Object.keys(module.memories || {}).length })) };
        const sourceRows = [...before.sources.map(row => ({ ...row, path: row.path.slice('hw/bsv/'.length) })), fileRow(wrapper, bsv)];
        const manifest = { version: 1, label: scope.label,
            sources: sourceRows.map(row => ({ path: row.path, pathRef: row.path, contentHash: row.sha256 })),
            artifact: { path: 'design.json', pathRef: 'live/design.json', contentHash: receipt.artifact.sha256, manifest: {
                stage: 'bsc-generated-rtl/yosys-hierarchy-proc-noopt', tops: [scope.top],
                sourceInputs: [...sourceRows.map(row => ({ pathRef: row.path, contentHash: row.sha256, role: 'source' })),
                    { pathRef: libraryRef, contentHash: receipt.externalRtlLibrary.sha256, role: 'library' }],
                toolchain: [{ name: 'bsc', version: fs.readFileSync(path.join(output, 'bsc-version/stdout.log'), 'utf8').trim().split('\n')[0], identity: tools.bsc.at(-1).sha256 },
                    { name: 'yowasp-yosys', version: raw.creator, identity: digest(JSON.stringify(tools.reader)) }],
                passSequence: passes, dependencyFingerprint: null, buildOptionsFingerprint: digest(JSON.stringify({ args, environment: env })), concreteParameters: null
            } } };
        require('../../../src/hardware/native-input-schema').validateNativeManifest(manifest);
        json(path.join(output, 'native-input.json'), manifest);
        json(path.join(output, 'native-input-locations.json'), { version: 1, sourceRoot: bsv, artifactRoot: output, manifest: 'native-input.json',
            authorization: 'Paths are replay instructions, not authority; select these roots explicitly in the native UI', metadata: 'not provided', origin: 'not provided' });
        const hardware = require('../../../src/hardware');
        const registry = hardware.createArtifactRegistry({ artifactRoots: [output], sourceRoots: [bsv, path.join(output, 'libraries')] });
        for (const row of sourceRows) await registry.registerSource({ pathRef: row.path, path: path.join(bsv, row.path), contentHash: row.sha256 });
        await registry.registerSource({ pathRef: libraryRef, path: libraryTarget, contentHash: receipt.externalRtlLibrary.sha256 });
        await registry.registerArtifact({ pathRef: 'live/design.json', path: path.join(output, 'design.json') });
        const importStart = performance.now();
        const imported = await hardware.importArtifact({ registry, artifactRef: 'live/design.json', manifest: manifest.artifact.manifest,
            expectedArtifactHash: receipt.artifact.sha256, signal: AbortSignal.timeout(30000) });
        receipt.import = { durationMs: performance.now() - importStart, snapshot: imported.snapshot, availability: imported.availability,
            counts: Object.fromEntries(['occurrences', 'cells', 'ports', 'pins', 'bits', 'aliases', 'memories', 'entities'].map(key => [key, Object.keys(imported.implementation[key] || {}).length])) };
        assert.equal(imported.availability.freshness, 'fresh', 'Declared source/library inputs did not remain current');
        receipt.generated = walk(output).filter(file => /\.(v|ba|bo|json|il|ys)$/.test(file) && !file.includes('reader-cache'))
            .map(file => fileRow(file, output));
        receipt.status = 'passed';
    } catch (error) { failure = error; receipt.status = 'failed'; receipt.error = error?.stack || String(error); }
    finally {
        const after = workspaceInventory(workspace); json(path.join(output, 'workspace-after.json'), after);
        receipt.preservation = { before: before.inventoryFingerprint, after: after.inventoryFingerprint, beforeSource: before.sourceFingerprint,
            afterSource: after.sourceFingerprint, files: before.files.length, gitStateUnchanged: before.head === after.head && before.branch === after.branch && before.status === after.status,
            identical: JSON.stringify(before.files) === JSON.stringify(after.files) };
        if (!receipt.preservation.identical || !receipt.preservation.gitStateUnchanged) { receipt.status = 'failed'; receipt.preservation.error = 'Original workspace changed during live lane'; }
        receipt.finishedAt = new Date().toISOString(); json(path.join(output, 'live-compiler.json'), receipt);
        console.log(JSON.stringify({ output, status: receipt.status, preservation: receipt.preservation, artifact: receipt.artifact, import: receipt.import?.counts }));
    }
    if (failure) throw failure;
    assert.equal(receipt.status, 'passed');
}
if (require.main === module) main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
module.exports = { workspaceInventory, main };
