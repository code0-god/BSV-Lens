'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRun } = require('./run.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function validateAllowed(names, entries) {
    assert.ok(Array.isArray(names)); const known = new Set(entries.map(row => row.path));
    assert.equal(new Set(names).size, names.length, 'Duplicate allowed file');
    for (const name of names) {
        assert.ok(known.has(name), `Allowed change must name an existing baseline file: ${name}`);
        assert.ok(!/^(?:dist\/|\.build\/|\.vscode-test\/|docs\/hardware\/(?:evidence\/|g[0-5](?:\/|[-/]))|experiments\/hardware\/fixtures\/)/.test(name), `Protected input cannot change: ${name}`);
        assert.ok(!/[\0\\*?]/.test(name) && !path.isAbsolute(name) && !name.split('/').includes('..'), 'Only exact relative file names may be allowed');
    }
}
async function entry(root, before) {
    const file = path.join(root, before.path); let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return { path: before.path, kind: 'missing' }; throw error; }
    if (stat.isSymbolicLink()) return { path: before.path, kind: 'symlink', target: fs.readlinkSync(file) };
    if (!stat.isFile()) return { path: before.path, kind: 'non-file' };
    const digest = crypto.createHash('sha256'); for await (const buffer of fs.createReadStream(file)) digest.update(buffer);
    const after = fs.lstatSync(file);
    assert.ok(stat.size === after.size && stat.mtimeMs === after.mtimeMs && stat.ino === after.ino, `Input changed while hashing: ${before.path}`);
    return { path: before.path, kind: 'file', bytes: stat.size, sha256: digest.digest('hex') };
}
function priorRuns(root, baselineFile, descriptor) {
    assert.ok(descriptor && path.basename(descriptor.file) === descriptor.file, 'Invalid historical inventory reference');
    const bytes = fs.readFileSync(path.join(path.dirname(baselineFile), descriptor.file)); assert.equal(hash(bytes), descriptor.sha256);
    const inventory = JSON.parse(bytes); assert.equal(inventory.schema, 'g6-historical-run-metadata-v1'); assert.equal(inventory.files.length, descriptor.count);
    const changes = [];
    for (const before of inventory.files) {
        assert.ok(before.path.startsWith('.build/hardware/runs/') && !before.path.split('/').includes('..'));
        let after; try { const stat = fs.lstatSync(path.join(root, before.path)); after = { path: before.path, bytes: stat.size, mtimeMs: stat.mtimeMs, kind: stat.isFile() ? 'file' : 'non-file' }; }
        catch (error) { if (error.code !== 'ENOENT') throw error; after = { path: before.path, kind: 'missing' }; }
        if (!require('node:util').isDeepStrictEqual(before, after)) changes.push({ before, after });
    }
    return { checked: inventory.files.length, unchanged: inventory.files.length - changes.length, changes,
        scope: 'Original prior-run path/type/size/mtime metadata; this is not a new content-hash claim.' };
}
async function verify(baselineFile, allowed = [], { root = ROOT, output = process.env.G6_OUTPUT_DIR || createRun('preservation') } = {}) {
    const baseline = JSON.parse(fs.readFileSync(baselineFile)); assert.equal(baseline.schema, 'g6-baseline-v1');
    assert.equal(hash(JSON.stringify(baseline.entries)), baseline.fingerprint); validateAllowed(allowed, baseline.entries);
    const changes = []; let cursor = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
        while (cursor < baseline.entries.length) {
            const before = baseline.entries[cursor++], after = await entry(root, before);
            if (!require('node:util').isDeepStrictEqual(before, after)) changes.push({ before, after });
        }
    }));
    changes.sort((a, b) => a.before.path.localeCompare(b.before.path));
    const unauthorized = changes.filter(row => !allowed.includes(row.before.path));
    const historicalRuns = priorRuns(root, baselineFile, baseline.historicalRuns);
    const receipt = { schema: 'g6-preservation-v1', status: !unauthorized.length && !historicalRuns.changes.length ? 'pass' : 'fail',
        baseline: path.resolve(baselineFile), baselineFingerprint: baseline.fingerprint, allowedChanges: allowed,
        checked: baseline.entries.length, unchanged: baseline.entries.length - changes.length, changes, unauthorized, historicalRuns,
        protected: 'Pre-G6 source/artifact/evidence/archive content and symlink targets; no directory exclusions or permission inferred from Git untracked state.' };
    fs.writeFileSync(path.join(output, 'preservation.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, status: receipt.status, checked: receipt.checked, unchanged: receipt.unchanged,
        changes: changes.map(row => row.before.path), unauthorized: unauthorized.map(row => row.before.path), historicalRuns: historicalRuns.checked,
        changedHistoricalRuns: historicalRuns.changes.length }));
    assert.equal(receipt.status, 'pass', 'G6 baseline preservation failed'); return receipt;
}
if (require.main === module) verify(process.argv[2], process.argv.slice(3)).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify, validateAllowed, entry, priorRuns };
