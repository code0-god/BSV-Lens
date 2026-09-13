'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRun } = require('./run.cjs');
const delivery = require('./validate-delivery.cjs');
const legacy = require('../g4/validate-delivery');
const { checkLimits } = require('./package-review.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const descriptor = (relative, bytes, role) => ({ path: relative, bytes: bytes.length, sha256: hash(bytes), ...(role ? { role } : {}) });
function sourceRoot(lane, workspace) {
    assert.match(lane.id, /^[a-z][a-z0-9-]*$/); assert.ok(typeof lane.root === 'string');
    const root = fs.realpathSync(path.resolve(workspace, lane.root)); assert.ok(fs.statSync(root).isDirectory());
    if (lane.kind === 'external-workspace-data') assert.equal(lane.role, 'external-workspace-data', 'External input role must be explicit');
    else {
        assert.ok(!lane.kind || lane.kind === 'run', 'Unknown evidence input kind');
        const relative = path.relative(fs.realpathSync(workspace), root).split(path.sep).join('/');
        assert.match(relative, /^\.build\/hardware\/runs\/[A-Za-z0-9_-]+\/g6$/, 'Evidence lane must name one exact G6 run root');
    }
    return root;
}
function read(root, relative) {
    delivery.relative(relative); let file = root;
    assert.ok(!relative.split('/').slice(0, -1).some(part => /^(?:profiles?(?:[-_].*)?|browser-profile|test-tools|\.vscode-shared)$/.test(part)), 'Native profiles/tool stores are not evidence inputs');
    for (const part of relative.split('/')) {
        file = path.join(file, part); assert.ok(!fs.lstatSync(file).isSymbolicLink(), `Evidence input symlink: ${relative}`);
    }
    const before = fs.statSync(file); assert.ok(before.isFile() && before.size <= 64 * 1024 * 1024, `Evidence input member limit: ${relative}`);
    const bytes = fs.readFileSync(file), after = fs.statSync(file);
    assert.ok(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino, `Evidence input changed during copy: ${relative}`);
    return bytes;
}
function prepare(plan, { workspace = ROOT } = {}) {
    assert.equal(plan.schema, 'g6-evidence-plan-v1'); assert.ok(Array.isArray(plan.lanes) && plan.lanes.length);
    assert.ok(plan.budget && ['archiveBaseBytes', 'legacyBaseBytes'].every(key => Number.isSafeInteger(plan.budget[key]) && plan.budget[key] >= 0), 'Explicit measured base budgets required');
    const files = new Map(), original = [], omitted = [], laneIds = new Set();
    for (const lane of plan.lanes) {
        assert.ok(!laneIds.has(lane.id), 'Duplicate lane ID'); laneIds.add(lane.id);
        const root = sourceRoot(lane, workspace); assert.ok(Array.isArray(lane.files), 'Exact file list required');
        const selected = new Set();
        for (const value of lane.files) {
            const item = typeof value === 'string' ? { from: value } : value;
            const from = delivery.relative(item.from), target = delivery.relative(item.to || `${lane.id}/${from}`), role = item.role || lane.role;
            assert.ok(!['index.json', 'omitted-diagnostics.json'].includes(target) && !files.has(target), 'Duplicate/reserved evidence target');
            assert.ok(!selected.has(from), 'Duplicate source file in one lane'); selected.add(from);
            if (role) assert.equal(role, 'external-workspace-data', 'Only the explicit external workspace role is supported');
            if (lane.kind === 'external-workspace-data' || role) {
                for (const name of [from, target]) assert.match(name, /\.(?:json|jsonl|bsv|v)$/i, 'External workspace role is data only');
                assert.equal(path.extname(target).toLowerCase(), path.extname(from).toLowerCase(), 'External data extensions must remain unchanged');
            }
            const bytes = read(root, from), record = descriptor(target, bytes, role);
            if (item.sha256) assert.equal(record.sha256, item.sha256, 'Pinned source SHA changed');
            if (item.bytes !== undefined) assert.equal(record.bytes, item.bytes, 'Pinned source size changed');
            files.set(target, { bytes, record }); original.push({ lane: lane.id, root, from, target, bytes: bytes.length, sha256: record.sha256 });
        }
        for (const item of lane.omit || []) {
            const from = delivery.relative(item.from); assert.match(from, /\.state\.json$/, 'Only redundant full state diagnostics may be omitted');
            assert.ok(!selected.has(from) && typeof item.reason === 'string' && item.reason.length, 'Omission requires a separate file and reason');
            selected.add(from);
            const bytes = read(root, from); omitted.push({ lane: lane.id, from, bytes: bytes.length, sha256: hash(bytes), reason: item.reason });
            original.push({ lane: lane.id, root, from, target: null, bytes: bytes.length, sha256: hash(bytes) });
        }
    }
    if (omitted.length) {
        const bytes = encoded({ schema: 'g6-omitted-diagnostics-v1', scope: 'Redundant full-state diagnostics only; raw originals remain in their exact source runs. Actual traces, captures, measurements and result evidence are retained.',
            files: omitted.sort((a, b) => `${a.lane}/${a.from}`.localeCompare(`${b.lane}/${b.from}`)) });
        files.set('omitted-diagnostics.json', { bytes, record: descriptor('omitted-diagnostics.json', bytes) });
    }
    return { files, original, omitted };
}
function createIndex(plan, prepared, runName) {
    assert.match(runName, /^run-[A-Za-z0-9_-]+$/);
    const { files } = prepared, lookup = name => { const value = files.get(delivery.relative(name)); assert.ok(value, `Unselected evidence reference: ${name}`); return value; };
    let vsix;
    if (plan.vsix) { const { bytes, sha256 } = lookup(plan.vsix.file).record; vsix = { file: plan.vsix.file, receipt: plan.vsix.receipt, bytes, sha256 }; }
    for (const receiptPath of plan.native?.receipts || []) {
        const receipt = JSON.parse(lookup(receiptPath).bytes), prefix = path.posix.dirname(receiptPath);
        for (const [key, list] of [['traces', receipt.traceChunks], ['captures', receipt.captures]]) {
            assert.ok(Array.isArray(list) && list.length, `Native receipt must enumerate actual ${key}`);
            for (const item of list) {
                const name = `${prefix}/${delivery.relative(item.path)}`, record = lookup(name).record;
                assert.equal(record.bytes, item.bytes); assert.equal(record.sha256, item.sha256);
                assert.ok(plan.native[key]?.includes(name), `Native ${key} missing from index: ${name}`);
            }
        }
    }
    const inputRoot = name => `${delivery.evidenceRoot}${runName}/${delivery.relative(name)}`;
    const inputs = (plan.inputs || []).map(input => ({ ...input,
        ...(input.sourceRoot ? { sourceRoot: inputRoot(input.sourceRoot) } : {}),
        ...(input.artifactRoot ? { artifactRoot: inputRoot(input.artifactRoot) } : {}) }));
    const index = { schema: 'g6-evidence-v1', files: [...files.values()].map(item => item.record).sort((a, b) => a.path.localeCompare(b.path)),
        ...(vsix ? { vsix } : {}), native: plan.native || { receipts: [], traces: [], captures: [] },
        acceptance: plan.acceptance || [], lanes: plan.results || [], inputs, userVisualDesignAcceptance: 'PENDING',
        assembly: { planSha256: hash(encoded(plan)), originalFileCount: prepared.original.length, omittedDiagnosticCount: prepared.omitted.length } };
    const prefix = `bsv-lens/${delivery.evidenceRoot}${runName}/`;
    const entries = [...files].map(([name, item]) => ({ name: `${prefix}${name}`, data: item.bytes }));
    entries.push({ name: `${prefix}index.json`, data: encoded(index) });
    checkLimits(entries);
    const bytes = entries.reduce((sum, row) => sum + row.data.length, 0), legacyBytes = entries
        .filter(row => !legacy.forbidden(row.name.slice('bsv-lens/'.length))).reduce((sum, row) => sum + row.data.length, 0);
    const budget = { evidenceBytes: bytes, archiveBaseBytes: plan.budget.archiveBaseBytes, archiveTotalBytes: plan.budget.archiveBaseBytes + bytes,
        legacyEvidenceBytes: legacyBytes, legacyBaseBytes: plan.budget.legacyBaseBytes, legacyTotalBytes: plan.budget.legacyBaseBytes + legacyBytes,
        archiveLimit: 768 * 1024 * 1024, legacyLimit: 512 * 1024 * 1024,
        scope: 'Preassembly estimate using the explicitly supplied measured base. Final packager independently checks actual combined bytes.' };
    assert.ok(budget.archiveTotalBytes <= budget.archiveLimit, 'Combined G6 archive budget exceeded');
    assert.ok(budget.legacyTotalBytes < budget.legacyLimit, 'Inherited G4 collector budget exceeded');
    return { index, entries, budget };
}
function assemble(plan, { workspace = ROOT, output = process.env.G6_OUTPUT_DIR || createRun('evidence'), allowIncompleteNative = false } = {}) {
    assert.match(path.relative(workspace, path.resolve(output)).split(path.sep).join('/'),
        /^\.build\/hardware\/runs\/[A-Za-z0-9_-]+\/g6$/, 'Assembly output must remain in one unique G6 run');
    const prepared = prepare(plan, { workspace }), directory = fs.mkdtempSync(path.join(output, 'run-'));
    const result = createIndex(plan, prepared, path.basename(directory));
    const validation = delivery.validateEvidence(result.entries, { allowIncompleteNative });
    for (const row of result.entries) {
        const relative = row.name.slice(`bsv-lens/${delivery.evidenceRoot}${path.basename(directory)}/`.length);
        const file = path.join(directory, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, row.data, { flag: 'wx' });
        assert.equal(hash(fs.readFileSync(file)), hash(row.data), 'Evidence copy changed bytes');
    }
    for (const row of prepared.original) assert.equal(hash(read(row.root, row.from)), row.sha256, 'Original evidence changed during assembly');
    const receipt = { schema: 'g6-evidence-assembly-v1', status: validation.complete ? 'pass' : 'candidate-native-incomplete', directory,
        index: descriptor('index.json', encoded(result.index)), budget: result.budget, originalInputs: prepared.original,
        omittedDiagnosticCount: prepared.omitted.length, originalInputsPreserved: true, finalArchivesCreated: false };
    fs.writeFileSync(path.join(output, 'assembly-receipt.json'), encoded(receipt), { flag: 'wx' });
    console.log(JSON.stringify({ directory, status: receipt.status, files: result.index.files.length, budget: result.budget })); return receipt;
}
if (require.main === module) {
    const args = process.argv.slice(2), allowIncompleteNative = args[0] === '--allow-incomplete-native';
    if (allowIncompleteNative) args.shift();
    assert.equal(args.length, 1, 'Usage: evidence.cjs [--allow-incomplete-native] EXPLICIT_PLAN.json');
    try { assemble(JSON.parse(fs.readFileSync(args[0])), { allowIncompleteNative }); }
    catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
module.exports = { prepare, createIndex, assemble };
