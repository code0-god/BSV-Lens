'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectFiles } = require('../../../scripts/zip');
const base = require('../g4/validate-delivery');
const legacy = require('../g5/validate-review.cjs');
const fix = require('../g4-fix/package.cjs');
const historical = require('./historical-companions.cjs');
const { createRun } = require('./run.cjs');
const evidenceRoot = 'docs/hardware/evidence/g6/';
const tracePath = name => /^docs\/hardware\/evidence\/g6\/run-[A-Za-z0-9_-]+\/(?:[A-Za-z0-9_-]+\/)*native-trace(?:-[A-Za-z0-9_-]+)?\.zip$/.test(name);
const vsixPath = name => /^docs\/hardware\/evidence\/g6\/run-[A-Za-z0-9_-]+\/(?:[A-Za-z0-9_-]+\/)*bsv-lens-0\.4\.1-[a-f0-9]+\.vsix$/.test(name);
function relative(name) {
    assert.ok(typeof name === 'string' && name && !/[\\:\0]/.test(name) && name.split('/').every(part => part && !['.', '..'].includes(part)), 'Unsafe G6 path');
    assert.ok(!name.split('/').some(part => ['.omx', '.codegraph', 'node_modules', 'user-data', 'extensions', 'shared-data', 'profile', 'profiles'].includes(part)), 'Forbidden G6 local state');
    assert.ok(!name.startsWith('.build/hardware/runs/'), 'Replay outputs must not be shipped'); return name;
}
function safe(name) { relative(name); assert.ok(!base.forbidden(name) || legacy.tracePath(name) || tracePath(name) || vsixPath(name), `Forbidden G6 member: ${name}`); return name; }
function validateNativeIsolation(receipt) {
    const stores = [['user-data-dir', 'userDataDir'], ['extensions-dir', 'extensionsDir'], ['shared-data-dir', 'sharedDataDir']];
    const isolation = receipt.isolation;
    assert.ok(isolation && typeof isolation.profile === 'string' && path.isAbsolute(isolation.profile)
        && path.normalize(isolation.profile) === isolation.profile, 'Missing canonical private profile path');
    for (const [option, key] of stores) {
        const directory = isolation[key];
        assert.ok(typeof directory === 'string' && path.isAbsolute(directory) && !directory.includes('\0')
            && path.normalize(directory) === directory && path.dirname(directory) === isolation.profile, `${option} must remain inside the private profile`);
    }
    assert.equal(new Set(stores.map(([, key]) => isolation[key])).size, 3, 'Native isolation stores must be separate');
    const argv = args => {
        assert.ok(Array.isArray(args) && args.every(arg => typeof arg === 'string'), 'Native launch/CLI argv missing');
        for (const [option, key] of stores) assert.deepEqual(args.filter(arg => arg === `--${option}` || arg.startsWith(`--${option}=`)),
            [`--${option}=${isolation[key]}`], `Native launch/CLI must explicitly bind private --${option}`);
    };
    argv(receipt.launch?.argv);
    assert.ok(Array.isArray(receipt.commands) && ['--version', '--install-extension', '--list-extensions']
        .every(phase => receipt.commands.some(command => command.phase === phase)), 'Installed CLI command evidence missing');
    for (const command of receipt.commands) { assert.equal(command.exitCode, 0, 'Native CLI did not succeed'); argv(command.argv); }
    assert.equal(receipt.sharedDataOptionEvidence?.option, '--shared-data-dir', 'Shared-data option support evidence missing');
    assert.match(receipt.sharedDataOptionEvidence.mainSha256 || '', /^[a-f0-9]{64}$/, 'VS Code shared-data option source hash missing');
    return { profile: isolation.profile, ...Object.fromEntries(stores.map(([, key]) => [key, isolation[key]])) };
}
function validateEvidence(entries, { allowIncompleteNative = false, expected } = {}) {
    const files = new Map();
    for (const row of entries) { assert.ok(row.name.startsWith('bsv-lens/')); const name = safe(row.name.slice(9)); assert.ok(!files.has(name), 'Duplicate G6 member'); files.set(name, row.data); }
    const covered = new Set(), indexes = [], nativeReceipts = [], acceptance = new Map(), lanes = [], inputs = [], builds = [];
    for (const [name, bytes] of files) {
        if (!name.startsWith(evidenceRoot) || !name.endsWith('/index.json')) continue;
        assert.match(name, /^docs\/hardware\/evidence\/g6\/run-[A-Za-z0-9_-]+\/index\.json$/);
        const index = JSON.parse(bytes), directory = path.posix.dirname(name), members = new Set();
        assert.equal(index.schema, 'g6-evidence-v1'); assert.ok(Array.isArray(index.files) && index.files.length);
        assert.deepEqual(index.files.map(row => row.path), index.files.map(row => row.path).sort((a, b) => a.localeCompare(b)), 'G6 index must be path-sorted');
        for (const row of index.files) {
            const target = safe(`${directory}/${relative(row.path)}`), data = files.get(target);
            assert.ok(target !== name && !members.has(target), 'Duplicate/self G6 index reference');
            assert.ok(data, `Missing G6 attachment: ${target}`); assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0);
            assert.equal(data.length, row.bytes, 'G6 attachment byte mismatch'); assert.equal(base.hash(data), row.sha256, 'G6 attachment SHA mismatch');
            members.add(target); covered.add(target);
        }
        const ref = value => { const target = safe(`${directory}/${relative(value)}`); assert.ok(members.has(target), `Unindexed G6 reference: ${target}`); return target; };
        const json = value => JSON.parse(files.get(ref(value)));
        let vsix = null;
        if (index.vsix) {
            const descriptor = index.vsix; assert.match(descriptor.sha256, /^[a-f0-9]{64}$/); assert.ok(descriptor.bytes > 0);
            const receipt = json(descriptor.receipt); assert.equal(receipt.sha256, descriptor.sha256); assert.equal(receipt.bytes, descriptor.bytes); assert.equal(receipt.crc, 'PASS');
            assert.equal(receipt.nativeBuild.extensionId, 'code0-god.bsv-lens'); assert.equal(receipt.nativeBuild.version, '0.4.1');
            assert.ok(Array.isArray(receipt.runtime) && ['src/extension.js', 'media/hardware-view.js'].every(name => receipt.runtime.some(row => row.path === name)), 'VSIX runtime inventory missing product entries');
            if (descriptor.file) { const file = ref(descriptor.file); assert.ok(vsixPath(file)); assert.equal(base.hash(files.get(file)), descriptor.sha256); assert.equal(files.get(file).length, descriptor.bytes); }
            vsix = { sha256: descriptor.sha256, bytes: descriptor.bytes, receipt: ref(descriptor.receipt), build: receipt.nativeBuild, runtime: receipt.runtime }; builds.push(vsix);
        }
        for (const value of index.native?.receipts || []) {
            const receipt = json(value); assert.equal(receipt.targetMode, 'installed', 'Native receipt must be installed VSIX');
            assert.equal(receipt.status, 'passed'); assert.equal(receipt.installedRuntimeIdentity, 'PASS'); assert.ok(vsix, 'Native receipt requires VSIX identity');
            const isolation = validateNativeIsolation(receipt);
            assert.equal(receipt.vsixSha256, vsix.sha256); assert.deepEqual(receipt.installedTarget.runtime.files, receipt.archiveRuntime.files);
            assert.ok(receipt.installedTarget.extensionPath && receipt.environment, 'Installed location/environment missing');
            assert.deepEqual([...receipt.archiveRuntime.rawFiles].sort((a, b) => a.path.localeCompare(b.path)), [...vsix.runtime].sort((a, b) => a.path.localeCompare(b.path)));
            const basePath = path.posix.dirname(value), archived = files.get(ref(`${basePath}/archive-package.json`)), installed = files.get(ref(`${basePath}/installed-package.json`));
            const runtime = require('./native-runtime.cjs'), delta = runtime.installerDelta(archived, installed);
            assert.deepEqual(delta, receipt.installerDelta); runtime.assertRuntimeMatch(receipt.archiveRuntime, receipt.installedTarget.runtime, delta);
            for (const [data, rows] of [[archived, receipt.archiveRuntime.rawFiles], [installed, receipt.installedTarget.runtime.rawFiles]]) {
                const row = rows.find(row => row.path === 'package.json'); assert.equal(row.bytes, data.length); assert.equal(row.sha256, base.hash(data));
            }
            nativeReceipts.push({ path: ref(value), vsixSha256: receipt.vsixSha256, isolation });
        }
        for (const value of index.native?.traces || []) assert.ok(tracePath(ref(value)), 'Unapproved native trace name');
        for (const value of index.native?.captures || []) assert.match(ref(value), /\.png$/);
        for (const row of index.acceptance || []) {
            assert.match(row.id, /^(?:N(?:0[1-9]|1[0-5])|S(?:0[1-9]|1[0-4]))$/); assert.ok(!acceptance.has(row.id), 'Duplicate native acceptance ID');
            assert.ok(['PASS', 'FAIL', 'BLOCKED', 'NOT RUN', 'PARTIAL'].includes(row.status));
            if (row.status === 'PASS') {
                assert.equal(row.executed, true);
                assert.ok(row.id.startsWith('N') ? row.scope === 'installed-vsix' : ['installed-vsix', 'native-adapter', 'native-contract'].includes(row.scope), 'Acceptance scope cannot substitute core/preview for native');
                const proof = json(row.receipt), passed = ['PASS', 'pass', 'passed'].includes(proof.status) || proof.exit === 0 || proof.exitCode === 0;
                assert.ok(passed && !['FAIL', 'fail', 'failed', 'BLOCKED', 'blocked'].includes(proof.status) && !proof.error && !proof.spawnError && !proof.failure, 'Acceptance receipt did not pass');
                if (row.scope === 'installed-vsix') {
                    assert.equal(proof.vsixSha256, vsix?.sha256, 'Acceptance must bind the final VSIX SHA');
                    assert.ok(nativeReceipts.some(receipt => path.posix.dirname(receipt.path) === path.posix.dirname(ref(row.receipt))),
                        'Installed acceptance requires an isolated native receipt in the same evidence directory');
                }
            }
            else { assert.ok(row.reason, 'Missing acceptance limitation'); if (row.receipt) ref(row.receipt); }
            acceptance.set(row.id, { ...row, receipt: row.receipt ? ref(row.receipt) : null });
        }
        for (const lane of index.lanes || []) { assert.ok(lane.id && lane.status); if (lane.receipt) ref(lane.receipt); lanes.push(lane); }
        for (const input of index.inputs || []) { ref(input.manifest); for (const key of ['sourceRoot', 'artifactRoot']) if (input[key]) relative(input[key]); inputs.push({ ...input, manifest: ref(input.manifest) }); }
        indexes.push({ path: name, sha256: base.hash(bytes), members: members.size });
    }
    for (const name of files.keys()) if (name.startsWith(evidenceRoot) && !indexes.some(row => row.path === name)) assert.ok(covered.has(name), `Unindexed G6 evidence: ${name}`);
    const required = [...Array.from({ length: 15 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 14 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`)];
    const complete = nativeReceipts.length > 0 && builds.length > 0 && required.every(id => acceptance.get(id)?.status === 'PASS')
        && indexes.some(row => { const index = JSON.parse(files.get(row.path)); return index.native?.traces?.length && index.native?.captures?.length; });
    assert.ok(complete || allowIncompleteNative, 'Missing final installed-native/VSIX/N01-N15/S01-S14 evidence');
    const result = { indexes, nativeReceipts, acceptance: [...acceptance.values()], lanes, inputs, builds, complete };
    if (expected) assert.deepEqual(result, expected, 'G6 evidence changed after replay'); return result;
}
function validateEntries(entries, sourceOnly, workspace, options = {}) {
    const native = validateEvidence(entries, { allowIncompleteNative: options.allowIncompleteNative ?? options.allowIncompleteBrowser, expected: options.expected?.native });
    const companion = historical.validateCompanion(entries);
    const inheritedEntries = entries.filter(row => !tracePath(row.name.slice(9)) && !vsixPath(row.name.slice(9)));
    const members = legacy.validateEntries(inheritedEntries, sourceOnly, workspace, { allowIncompleteBrowser: false });
    members.inherited.inventory = historical.inventory(entries); members.runtime = fix.runtime(entries).sort((a, b) => a.path.localeCompare(b.path));
    members.evidence = { inherited: members.evidence, native, companion, browser: native.complete ? 'indexed-pass' : 'MISSING - G6 NATIVE CANDIDATE ONLY' };
    if (options.expected) assert.deepEqual(members.evidence, options.expected, 'G6 archive evidence changed'); return members;
}
async function validateDelivery({ workspace = path.resolve(__dirname, '../../..'), archives, directory = createRun('delivery'), allowIncompleteNative = false, nativeReplay } = {}) {
    return legacy.validateDelivery({ workspace, archives, directory, allowIncompleteBrowser: allowIncompleteNative, validateMembers: validateEntries,
        replayExtra: async ({ receipt, cwd, env, js, py, members }) => {
            receipt.schema = 'g6-delivery-validation-v1'; receipt.nativeEvidence = members.evidence.native;
            receipt.coreScope = 'Compiler-free shipped core; installed native is a separate indexed and optional replay lane.';
            receipt.nativeInputReplay = JSON.parse(js('experiments/hardware/g6/replay-input.cjs').stdout);
            const semanticReplay = JSON.parse(js('experiments/hardware/g6/semantic.cjs', '--replay').stdout);
            assert.equal(semanticReplay.status, 'pass'); assert.equal(semanticReplay.queryCount, 75);
            receipt.detailedSemanticReplay = JSON.parse(fs.readFileSync(path.join(semanticReplay.output, 'semantic.json')));
            for (const descriptor of members.evidence.native.inputs) js('experiments/hardware/g6/replay-input.cjs', descriptor.manifest, descriptor.sourceRoot || '-', descriptor.artifactRoot || '-');
            const traces = members.evidence.native.indexes.flatMap(row => {
                const index = JSON.parse(fs.readFileSync(path.join(cwd, row.path)));
                return (index.native?.traces || []).map(file => `${path.posix.dirname(row.path)}/${file}`);
            });
            if (traces.length) py('-c', `import sys,zipfile
for p in sys.argv[1:]:
 with zipfile.ZipFile(p) as z:
  assert all(i.file_size<=64*1024*1024 for i in z.infolist()),'TRACE_MEMBER_SIZE'
  assert sum(i.file_size for i in z.infolist())<=768*1024*1024,'TRACE_TOTAL_SIZE'
  assert z.testzip() is None,p
print('Indexed native trace inner CRC PASS')`, ...traces);
            receipt.nativeTraceCrc = traces.length ? 'PASS' : 'NOT RUN - no native traces in candidate';
            if (nativeReplay) {
                assert.equal(typeof nativeReplay, 'function'); receipt.nativeReplay = await nativeReplay({ receipt, cwd, env, directory });
                assert.equal(receipt.nativeReplay.status, 'PASS');
            } else receipt.nativeReplay = { status: 'NOT RUN', reason: 'Native installed replay is an explicit external-tools lane; indexed final installation evidence is validated separately.' };
        } });
}
if (require.main === module) {
    const args = process.argv.slice(2), allowIncompleteNative = args[0] === '--allow-incomplete-native';
    if (allowIncompleteNative) args.shift();
    validateDelivery({ archives: args, allowIncompleteNative }).then(rows => console.log(JSON.stringify(rows.map(row => ({
        archive: row.archive, status: row.status, sha256: row.sha256, core: row.coreScope, nativeReplay: row.nativeReplay })), null, 2)))
        .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { evidenceRoot, tracePath, vsixPath, relative, safe, validateNativeIsolation, validateEvidence, validateEntries, validateDelivery, inventory: historical.inventory, extraction: legacy.extraction };
