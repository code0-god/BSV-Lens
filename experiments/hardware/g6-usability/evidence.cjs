'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../g4/validate-delivery');
const { relative } = require('../g6/validate-delivery.cjs');
const { checkLimits } = require('../g5-readability/package.cjs');
const { createOutput } = require('./baseline.cjs');
const delivery = require('./validate-delivery.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function read(root, name) {
    relative(name); let file = root;
    assert.ok(!name.split('/').some(part => /^(?:profiles?(?:[-_].*)?|test-tools|browser-profile)$/.test(part)), 'Local profile/tool input forbidden');
    for (const part of name.split('/')) { file = path.join(file, part); assert.ok(!fs.lstatSync(file).isSymbolicLink(), 'Evidence symlink forbidden'); }
    const before = fs.statSync(file); assert.ok(before.isFile() && before.size <= 64 * 1024 * 1024, 'Evidence member limit');
    const bytes = fs.readFileSync(file), after = fs.statSync(file);
    assert.ok(before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'Evidence changed while reading'); return bytes;
}
function prepare(plan, { workspace = ROOT } = {}) {
    assert.equal(plan.schema, 'g6-usability-evidence-plan-v1'); assert.ok(plan.lanes.length);
    const files = new Map(), original = [], omitted = [], ids = new Set();
    for (const lane of plan.lanes) {
        assert.match(lane.id, /^[a-z][a-z0-9-]*$/); assert.ok(!ids.has(lane.id)); ids.add(lane.id);
        const root = fs.realpathSync(path.resolve(workspace, lane.root)); assert.ok(fs.statSync(root).isDirectory());
        if (lane.kind === 'external-workspace-data') assert.equal(lane.role, 'external-workspace-data');
        else { assert.ok(!lane.kind || lane.kind === 'run'); assert.match(path.relative(fs.realpathSync(workspace), root).split(path.sep).join('/'), /^\.build\/hardware\/runs\/g6-usability-[A-Za-z0-9_-]+\/(?:g6|g6-usability)$/); }
        const selected = new Set();
        for (const value of lane.files) {
            const item = typeof value === 'string' ? { from: value } : value, from = relative(item.from), target = relative(item.to || `${lane.id}/${from}`), role = item.role || lane.role;
            assert.ok(!selected.has(from) && !files.has(target) && !['index.json', 'omitted-diagnostics.json'].includes(target), 'Duplicate/reserved evidence selection'); selected.add(from);
            if (role) { assert.equal(role, 'external-workspace-data'); assert.match(from, /\.(?:json|jsonl|bsv|v)$/i); assert.equal(path.extname(from), path.extname(target), 'External data extension changed'); }
            const bytes = read(root, from), record = { path: target, bytes: bytes.length, sha256: hash(bytes), ...(role ? { role } : {}) };
            if (item.bytes !== undefined) assert.equal(record.bytes, item.bytes); if (item.sha256) assert.equal(record.sha256, item.sha256);
            files.set(target, { bytes, record }); original.push({ root, from, target, bytes: bytes.length, sha256: record.sha256 });
        }
        for (const item of lane.omit || []) {
            const from = relative(item.from); assert.match(from, /\.state\.json$/); assert.ok(!selected.has(from) && item.reason); selected.add(from);
            const bytes = read(root, from); omitted.push({ lane: lane.id, from, bytes: bytes.length, sha256: hash(bytes), reason: item.reason });
            original.push({ root, from, target: null, bytes: bytes.length, sha256: hash(bytes) });
        }
    }
    if (omitted.length) { const bytes = encode({ schema: 'g6-usability-omitted-diagnostics-v1', scope: 'Only redundant full state diagnostics omitted; actual before/current traces, captures, DOM measurements and query/source proof remain inline. Raw originals preserved.', files: omitted });
        files.set('omitted-diagnostics.json', { bytes, record: { path: 'omitted-diagnostics.json', bytes: bytes.length, sha256: hash(bytes) } }); }
    return { files, original, omitted };
}
function createIndex(plan, prepared, runName) {
    assert.match(runName, /^run-[A-Za-z0-9_-]+$/);
    assert.ok(plan.budget && ['archiveBaseBytes', 'legacyBaseBytes'].every(key => Number.isSafeInteger(plan.budget[key]) && plan.budget[key] >= 0), 'Measured base budgets required');
    const descriptor = value => {
        if (!value) return undefined;
        const receipt = prepared.files.get(relative(value.receipt)); assert.ok(receipt, 'Missing VSIX verification'); const proof = JSON.parse(receipt.bytes);
        if (value.file) { const file = prepared.files.get(relative(value.file)); assert.ok(file); assert.equal(file.record.sha256, proof.sha256); assert.equal(file.record.bytes, proof.bytes); }
        return { ...value, bytes: proof.bytes, sha256: proof.sha256 };
    };
    const index = { schema: 'g6-usability-evidence-v1', files: [...prepared.files.values()].map(row => row.record).sort((a, b) => a.path.localeCompare(b.path)),
        vsix: descriptor(plan.vsix), native: plan.native || { receipts: [], traces: [], captures: [] },
        ...(plan.before ? { before: { ...plan.before, vsix: descriptor(plan.before.vsix) } } : {}),
        acceptance: plan.acceptance || [], workspaces: plan.workspaces || [], diagnostics: plan.diagnostics || [], lanes: plan.results || [], userVisualDesignAcceptance: 'PENDING',
        assembly: { planSha256: hash(encode(plan)), originalFiles: prepared.original.length, omittedStateFiles: prepared.omitted.length } };
    const prefix = `bsv-lens/${delivery.evidenceRoot}${runName}/`, entries = [...prepared.files].map(([name, row]) => ({ name: prefix + name, data: row.bytes }));
    entries.push({ name: prefix + 'index.json', data: encode(index) }); checkLimits(entries);
    const budget = { evidenceBytes: entries.reduce((sum, row) => sum + row.data.length, 0), ...plan.budget, aggregateLimit: 768 * 1024 * 1024,
        legacyLimit: 512 * 1024 * 1024, policy: 'G4 collector excludes this separately validated evidence root; legacy base remains below512MiB, whole archive below768MiB, every member below64MiB.' };
    budget.archiveTotalBytes = budget.archiveBaseBytes + budget.evidenceBytes;
    assert.ok(budget.archiveTotalBytes <= budget.aggregateLimit, 'Combined archive budget exceeded'); assert.ok(budget.legacyBaseBytes <= budget.legacyLimit, 'Legacy collector budget exceeded');
    return { index, entries, budget };
}
function assemble(plan, { workspace = ROOT, output = createOutput('evidence'), allowIncompleteNative = false } = {}) {
    assert.match(path.relative(workspace, output).split(path.sep).join('/'), /^\.build\/hardware\/runs\/g6-usability-[A-Za-z0-9_-]+\/g6-usability$/);
    const prepared = prepare(plan, { workspace }), directory = fs.mkdtempSync(path.join(output, 'run-')), built = createIndex(plan, prepared, path.basename(directory));
    const validation = delivery.validateEvidence(built.entries, { allowIncompleteNative });
    for (const row of built.entries) { const name = row.name.slice(`bsv-lens/${delivery.evidenceRoot}${path.basename(directory)}/`.length), file = path.join(directory, name);
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, row.data, { flag: 'wx' }); }
    for (const row of prepared.original) assert.equal(hash(read(row.root, row.from)), row.sha256, 'Original evidence changed during assembly');
    const receipt = { schema: 'g6-usability-evidence-assembly-v1', status: validation.complete ? 'pass' : 'candidate-native-incomplete', directory,
        indexSha256: hash(encode(built.index)), budget: built.budget, originalInputs: prepared.original, originalInputsPreserved: true, omittedStateFiles: prepared.omitted.length };
    fs.writeFileSync(path.join(output, 'assembly-receipt.json'), encode(receipt), { flag: 'wx' }); return receipt;
}
if (require.main === module) {
    const args = process.argv.slice(2), allowIncompleteNative = args[0] === '--allow-incomplete-native'; if (allowIncompleteNative) args.shift();
    assert.equal(args.length, 1, 'Usage: evidence.cjs [--allow-incomplete-native] EXPLICIT_PLAN.json');
    try { console.log(JSON.stringify(assemble(JSON.parse(fs.readFileSync(args[0])), { allowIncompleteNative }))); } catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { prepare, createIndex, assemble };
