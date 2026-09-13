'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../g4/validate-delivery');
const { inventoryFromEntries, installerDelta } = require('../g6/native-runtime.cjs');
const { createOutput } = require('./baseline.cjs');
const packaging = require('./package-review.cjs');
const delivery = require('./validate-delivery.cjs');
const evidence = require('./evidence.cjs');
function synthetic() {
    const prefix = `bsv-lens/${delivery.evidenceRoot}run-synthetic/`, files = [], rows = [];
    const put = (name, value, raw = false) => { const data = Buffer.from(raw ? value : JSON.stringify(value)); rows.push({ name: prefix + name, data }); files.push({ path: name, bytes: data.length, sha256: hash(data) }); return name; };
    const pkg = Buffer.from('{"name":"bsv-lens"}'), runtime = inventoryFromEntries([{ path: 'package.json', bytes: pkg }, ...['src/extension.js', 'media/hardware-view.js'].map(path => ({ path, bytes: Buffer.from(path) }))], 'synthetic validator input; no installed execution claimed');
    function native(name) {
        const sha = hash(name), isolation = { profile: '/synthetic/profile', userDataDir: '/synthetic/profile/user-data', extensionsDir: '/synthetic/profile/extensions', sharedDataDir: '/synthetic/profile/shared-data' };
        const argv = ['user-data-dir', 'extensions-dir', 'shared-data-dir'].map((value, i) => `--${value}=${[isolation.userDataDir, isolation.extensionsDir, isolation.sharedDataDir][i]}`);
        const vsix = { sha256: sha, bytes: 3, receipt: put(`${name}/vsix-validation.json`, { sha256: sha, bytes: 3, crc: 'PASS', nativeBuild: { extensionId: 'code0-god.bsv-lens', version: '0.4.1' }, runtime: runtime.rawFiles }) };
        put(`${name}/archive-package.json`, pkg, true); put(`${name}/installed-package.json`, pkg, true);
        const trace = put(`${name}/native-trace-main.zip`, 'synthetic trace', true), capture = put(`${name}/screen.png`, 'synthetic image', true);
        const descriptor = name => { const row = files.find(row => row.path === name); return { ...row, path: path.posix.basename(name) }; };
        const receipt = put(`${name}/native-receipt.json`, { status: 'passed', targetMode: 'installed', installedRuntimeIdentity: 'PASS', vsixSha256: sha,
            isolation, launch: { argv }, commands: ['--version', '--install-extension', '--list-extensions'].map(phase => ({ phase, argv, exitCode: 0 })),
            sharedDataOptionEvidence: { option: '--shared-data-dir', mainSha256: hash('source') }, archiveRuntime: runtime, installedTarget: { runtime, extensionPath: '/synthetic/installed' },
            installerDelta: installerDelta(pkg, pkg), environment: { scope: 'synthetic validation only' }, traceChunks: [descriptor(trace)], captures: [descriptor(capture)] });
        return { vsix, native: { receipts: [receipt], traces: [trace], captures: [capture] }, receipt };
    }
    const current = native('current'), before = native('before'); put('inputs/design/Unit.bsv', 'module mkUnit(Empty); endmodule', true);
    const source = files.find(row => row.path.endsWith('Unit.bsv')); put('inputs/inventory.json', { files: [{ ...source, path: 'Unit.bsv' }] });
    put('inputs/native-input.json', { version: 1, sources: [{ path: 'Unit.bsv', pathRef: 'Unit.bsv', contentHash: source.sha256 }] });
    const index = { schema: 'g6-usability-evidence-v1', files, vsix: current.vsix, native: current.native, before,
        acceptance: delivery.required.map(id => ({ id, status: 'PASS', executed: true, scope: 'installed-vsix', receipt: current.receipt })),
        workspaces: [{ id: 'synthetic', root: 'inputs/design', inventory: 'inputs/inventory.json', manifest: 'inputs/native-input.json' }] };
    files.sort((a, b) => a.path.localeCompare(b.path)); rows.push({ name: prefix + 'index.json', data: Buffer.from(JSON.stringify(index)) }); return { prefix, rows, index };
}
function changed(fixture, mutate) {
    const index = structuredClone(fixture.index); mutate(index);
    return fixture.rows.map(row => row.name === fixture.prefix + 'index.json' ? { ...row, data: Buffer.from(JSON.stringify(index)) } : row);
}
test('Usability gates require current installed proof, actual before records, workspace bytes and all45journeys', () => {
    const f = synthetic(), result = delivery.validateEvidence(f.rows); assert.equal(result.complete, true); assert.equal(result.acceptance.length, 45);
    assert.ok(result.builds[0].receipt.startsWith(delivery.evidenceRoot), 'Reused validator paths must return the actual usability evidence root');
    for (const key of ['before', 'workspaces', 'native', 'vsix', 'acceptance']) assert.throws(() => delivery.validateEvidence(changed(f, row => delete row[key])));
    assert.throws(() => delivery.validateEvidence(changed(f, row => { row.before.native.receipts = []; })), /Missing current installed/);
    assert.throws(() => delivery.validateEvidence(changed(f, row => row.acceptance[0].scope = 'core')), /requires installed/);
    assert.throws(() => delivery.validateEvidence(changed(f, row => row.acceptance[0].receipt = row.before.receipt)), /VSIX differs/);
    assert.throws(() => delivery.validateEvidence(changed(f, row => row.acceptance[0].id = 'N01')), /Unknown/);
    assert.throws(() => delivery.validateEvidence(changed(f, row => row.acceptance.pop())), /Missing current installed/);
    assert.throws(() => delivery.validateEvidence(changed(f, row => { row.native.traces = []; })), /absent from index/);
    assert.throws(() => delivery.validateEvidence(changed(f, row => { row.before.native.captures = []; })), /absent from index/);
    assert.equal(delivery.validateEvidence([], { allowIncompleteNative: true }).complete, false);
});
test('Attachment deletion, corruption, profile paths and hidden native assets fail independently', () => {
    const f = synthetic();
    for (const item of f.index.files) { assert.throws(() => delivery.validateEvidence(f.rows.filter(row => row.name !== f.prefix + item.path)));
        assert.throws(() => delivery.validateEvidence(f.rows.map(row => row.name === f.prefix + item.path ? { ...row, data: Buffer.from('corrupt') } : row))); }
    for (const value of ['profile/settings.json', '../escape', 'native/unapproved.zip', 'shared-data/state.json']) assert.throws(() => delivery.validateEvidence(changed(f, row => row.files[0].path = value)));
    assert.throws(() => delivery.validateEvidence([...f.rows, { name: f.prefix + 'orphan.json', data: Buffer.from('{}') }]), /Unindexed/);
});
test('Collector keeps shipped G2/G3/G4/G5 inputs, separates historical G6 and new evidence without requiring old archives', () => {
    const output = createOutput('collector-test'), root = path.join(output, 'workspace'); fs.mkdirSync(root);
    const put = name => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, name); };
    for (const name of ['src/core.js', 'docs/hardware/evidence/g6/run-old/index.json', 'docs/hardware/evidence/g5-readability/run-old/index.json',
        'docs/hardware/evidence/g5/run-YTGBZS/index.json', 'docs/hardware/evidence/g5/run-current/queries.json', 'docs/hardware/evidence/toolchain/A/design.json',
        `${delivery.evidenceRoot}run-new/index.json`, '.omx/private.json']) put(name);
    const names = packaging.collectEntries({ workspace: root }).map(row => row.name);
    assert.ok(names.includes('bsv-lens/src/core.js')); assert.ok(names.includes('bsv-lens/docs/hardware/evidence/toolchain/A/design.json'));
    assert.ok(names.includes('bsv-lens/docs/hardware/evidence/g5/run-current/queries.json')); assert.ok(names.includes(`bsv-lens/${delivery.evidenceRoot}run-new/index.json`));
    assert.ok(!names.some(name => /run-old|run-YTGBZS|\.omx/.test(name)));
    const old = require('../g6/package-review.cjs').collectEntries({ workspace: root }).map(row => row.name);
    assert.ok(old.includes('bsv-lens/docs/hardware/evidence/g6/run-old/index.json'), 'Existing G6 collector still owns and includes its original evidence');
    assert.deepEqual(packaging.archiveNames(root).map(value => path.basename(value)), ['bsv-lens-hardware-g6-usability-review.zip', 'bsv-lens-hardware-g6-usability-source.zip']);
    assert.ok(fs.existsSync(path.join(root, 'docs/hardware/evidence/g6/run-old/index.json')));
});
test('Evidence assembly preserves exact input bytes, permits only redundant state omissions and enforces unchanged limits', () => {
    const root = createOutput('evidence-test'); fs.writeFileSync(path.join(root, 'proof.json'), '{"status":"NOT RUN"}'); fs.writeFileSync(path.join(root, 'view.state.json'), '{"redundant":true}');
    const plan = { schema: 'g6-usability-evidence-plan-v1', budget: { archiveBaseBytes: 596629831, legacyBaseBytes: 433890879 },
        lanes: [{ id: 'synthetic', root, files: ['proof.json'], omit: [{ from: 'view.state.json', reason: 'Redundant state; raw preserved.' }] }] };
    const prepared = evidence.prepare(plan), built = evidence.createIndex(plan, prepared, 'run-synthetic');
    assert.equal(built.index.files.length, 2); assert.equal(delivery.validateEvidence(built.entries, { allowIncompleteNative: true }).complete, false);
    assert.deepEqual(prepared.files.get('synthetic/proof.json').bytes, fs.readFileSync(path.join(root, 'proof.json')));
    assert.throws(() => evidence.prepare({ ...plan, lanes: [{ ...plan.lanes[0], omit: [{ from: 'screen.png', reason: 'not allowed' }] }] }));
    assert.throws(() => evidence.createIndex({ ...plan, budget: { ...plan.budget, archiveBaseBytes: 768 * 1024 * 1024 } }, prepared, 'run-synthetic'), /budget/);
    assert.throws(() => packaging.checkLimits([{ name: 'oversized', data: { length: 64 * 1024 * 1024 + 1 } }]), /MEMBER_SIZE/);
    fs.symlinkSync('proof.json', path.join(root, 'link.json')); assert.throws(() => evidence.prepare({ ...plan, lanes: [{ ...plan.lanes[0], files: ['link.json'] }] }), /symlink/);
});
test('Current core snapshot includes new evidence and works from shipped companion metadata without old archives', () => {
    const output = createOutput('snapshot-test'), root = path.join(output, 'fixture'), snapshotOutput = path.join(output, 'snapshot');
    fs.mkdirSync(root); fs.mkdirSync(snapshotOutput);
    const put = (name, bytes) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
    put('src/core.js', 'module.exports = 1;'); put(delivery.companionPath, '{}\n'); put('docs/hardware/g6/G6_HISTORICAL_COMPANIONS.json', '{}\n');
    put(`${delivery.evidenceRoot}run-copy/proof.json`, '{"scope":"synthetic copy test"}');
    const snapshot = packaging.snapshotCore({ workspace: root, output: snapshotOutput });
    assert.equal(fs.existsSync(path.join(root, 'dist')), false);
    assert.deepEqual(fs.readFileSync(path.join(snapshot.workspace, `${delivery.evidenceRoot}run-copy/proof.json`)), fs.readFileSync(path.join(root, `${delivery.evidenceRoot}run-copy/proof.json`)));
    assert.ok(snapshot.inventory.some(row => row.path.endsWith('/run-copy/proof.json'))); assert.equal(snapshot.runtime.length, 1);
});
test('Existing G5 public replay default remains the exact original command and return value', async () => {
    const { runPublicQueries } = require('../g5/validate-review.cjs'), calls = [], receipt = {}, expected = { original: 'unchanged-return-shape' };
    const result = await runPublicQueries({ receipt, js: (...args) => { calls.push(args); return { stdout: JSON.stringify(expected) }; } });
    assert.deepEqual(calls, [['experiments/hardware/g5/delivery-replay.cjs', '--replay']]); assert.deepEqual(result, expected);
    assert.equal(Object.hasOwn(receipt, 'publicQueriesReplacement'), false);
});
test('Explicit replacement executes and cannot substitute skip, empty queries or unverified public surfaces', async () => {
    const { runPublicQueries } = require('../g5/validate-review.cjs');
    const reply = { result: { status: 'pass', queries: [{ synthetic: true }], cancellation: { status: 'pass', workerExited: true } },
        verification: { status: 'pass', executedQueryCount: 1, cli: 'PASS', http: 'PASS', source: 'PASS' } };
    const context = { receipt: {}, js: () => assert.fail('Explicit replacement must run, not the old default') }; let executed = 0;
    assert.deepEqual(await runPublicQueries(context, async received => { executed++; assert.equal(received, context); return reply; }), reply.result);
    assert.equal(executed, 1); assert.deepEqual(context.receipt.publicQueriesReplacement, reply.verification);
    for (const mutate of [value => value.result.status = 'skip', value => value.result.queries = [], value => value.result.cancellation.workerExited = false,
        value => value.verification.executedQueryCount = 0, value => value.verification.cli = 'NOT RUN', value => delete value.verification.http, value => value.verification.source = 'FAIL']) {
        const changed = structuredClone(reply); mutate(changed); await assert.rejects(runPublicQueries(context, async () => changed));
    }
});
test('Source entry stays separate from the complete registered manifest and binds its exact revision', () => {
    const { sourceEntry } = require('./replay-input.cjs'), { validateNativeManifest } = require('../../../src/hardware/native-input');
    const selected = { pathRef: 'design/Unit.bsv', revision: hash('unit'), definitionId: 'definition-unit' };
    const manifest = { version: 1, sources: [{ path: 'design/Unit.bsv', pathRef: selected.pathRef, contentHash: selected.revision }, { path: 'other/Independent.bsv', contentHash: hash('independent') }] };
    assert.equal(sourceEntry(selected, manifest), selected); assert.equal(manifest.sources.length, 2);
    assert.throws(() => sourceEntry({ ...selected, revision: hash('changed') }, manifest), /revision differs/);
    assert.throws(() => sourceEntry({ ...selected, pathRef: 'outside/Unit.bsv' }, manifest), /full registered/);
    assert.throws(() => sourceEntry({ ...selected, executable: 'not permitted' }, manifest));
    assert.throws(() => validateNativeManifest({ ...manifest, sourceEntry: selected }), /Unknown native manifest field/);
    const native = { version: 1, label: 'workspace', sources: manifest.sources.map(({ path }) => ({ path })) };
    const inventory = manifest.sources.map(row => ({ path: row.path, sha256: row.contentHash }));
    assert.equal(sourceEntry(selected, native, inventory), selected, 'Native manifest shape stays exact; revision pins live in separate inventory');
    assert.throws(() => sourceEntry({ ...selected, revision: hash('changed') }, native, inventory), /revision differs/);
});
