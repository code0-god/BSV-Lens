'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const previous = require('../g6/validate-delivery.cjs');
const historical = require('../g6/historical-companions.cjs');
const legacy = require('../g5/validate-review.cjs');
const base = require('../g4/validate-delivery');
const fix = require('../g4-fix/package.cjs');
const { createOutput } = require('./baseline.cjs');
const evidenceRoot = 'docs/hardware/evidence/g6-usability/';
const companionPath = 'docs/hardware/g6-usability/HISTORICAL_COMPANIONS.json';
const required = Object.entries({ A: 6, F: 8, D: 12, R: 7, U: 12 }).flatMap(([prefix, n]) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`));
const nativeRequired = new Set(required.filter(id => /^[AU]/.test(id) || ['F01', 'F02', 'F05', 'F06'].includes(id)));
const translated = name => name.replace(evidenceRoot, previous.evidenceRoot);
const tracePath = name => name.startsWith(evidenceRoot) && previous.tracePath(translated(name));
const vsixPath = name => name.startsWith(evidenceRoot) && previous.vsixPath(translated(name));
function safe(name) {
    previous.relative(name);
    assert.ok(!base.forbidden(name) || tracePath(name) || vsixPath(name) || legacy.tracePath(name), `Forbidden usability member: ${name}`);
    return name;
}
function validateCompanion(entries) {
    const prior = historical.validateCompanion(entries);
    assert.ok(!entries.some(row => row.name.startsWith(`bsv-lens/${previous.evidenceRoot}`)), 'Historical G6 evidence duplicated');
    const bytes = entries.find(row => row.name === `bsv-lens/${companionPath}`)?.data; assert.ok(bytes, 'Missing historical G6 companion contract');
    const manifest = JSON.parse(bytes); assert.equal(manifest.schema, 'g6-usability-historical-v1'); assert.equal(manifest.omittedRoot, previous.evidenceRoot);
    assert.ok(manifest.inventory.length); assert.deepEqual(manifest.inventory.map(row => row.path), [...new Set(manifest.inventory.map(row => row.path))].sort((a, b) => a.localeCompare(b)));
    for (const row of manifest.inventory) { previous.relative(row.path); assert.ok(row.path.startsWith(previous.evidenceRoot)); assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0); assert.match(row.sha256, /^[a-f0-9]{64}$/); }
    assert.equal(base.hash(JSON.stringify(manifest.inventory)), manifest.inventorySha256);
    assert.deepEqual(manifest.archives.map(row => row.path), ['review', 'source'].map(mode => `dist/bsv-lens-hardware-g6-${mode}.zip`));
    for (const row of manifest.archives) { assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0); assert.match(row.sha256, /^[a-f0-9]{64}$/); }
    assert.equal(manifest.coreReplayRequiresHistoricalArchive, false); assert.equal(manifest.authorCompanionCount, 14);
    return { path: companionPath, sha256: base.hash(bytes), inventorySha256: manifest.inventorySha256, archives: manifest.archives, prior };
}
function nativeEnvelope(rows, index, before = false) {
    const scope = before ? index.before : index;
    if (!scope) return null;
    const adapted = rows.map(row => ({ name: translated(row.name), data: row.name === rows[0].name
        ? Buffer.from(JSON.stringify({ ...index, schema: 'g6-evidence-v1', vsix: scope.vsix, native: scope.native, acceptance: [] })) : row.data }));
    // Reuse only the existing installed-byte/isolation checks. Historical N/S success is never a current usability gate.
    const proof = previous.validateEvidence(adapted, { allowIncompleteNative: true });
    return JSON.parse(JSON.stringify(proof, (_, value) => typeof value === 'string' && value.startsWith(previous.evidenceRoot)
        ? value.replace(previous.evidenceRoot, evidenceRoot) : value));
}
function validateEvidence(entries, { allowIncompleteNative = false, expected } = {}) {
    const files = new Map();
    for (const row of entries) { assert.ok(row.name.startsWith('bsv-lens/')); const name = safe(row.name.slice(9)); assert.ok(!files.has(name), 'Duplicate usability member'); files.set(name, row.data); }
    const indexes = [], covered = new Set(), acceptance = new Map(), builds = [], receipts = [], workspaces = [], beforeBuilds = [], beforeReceipts = [], diagnostics = [], inventoryTables = [];
    for (const [name, bytes] of files) {
        if (!name.startsWith(evidenceRoot) || !name.endsWith('/index.json')) continue;
        assert.match(name, /^docs\/hardware\/evidence\/g6-usability\/run-[A-Za-z0-9_-]+\/index\.json$/);
        const index = JSON.parse(bytes), directory = path.posix.dirname(name); assert.equal(index.schema, 'g6-usability-evidence-v1');
        assert.ok(index.files.length); assert.deepEqual(index.files.map(row => row.path), [...new Set(index.files.map(row => row.path))].sort((a, b) => a.localeCompare(b)));
        const members = new Set(index.files.map(row => {
            const target = safe(`${directory}/${previous.relative(row.path)}`), data = files.get(target);
            assert.ok(target !== name && data, `Missing usability attachment: ${target}`); assert.equal(data.length, row.bytes); assert.equal(base.hash(data), row.sha256);
            covered.add(target); return target;
        }));
        const ref = relative => { const target = safe(`${directory}/${previous.relative(relative)}`); assert.ok(members.has(target), `Unindexed usability reference: ${target}`); return target; };
        const json = relative => JSON.parse(files.get(ref(relative)));
        const rows = [{ name: `bsv-lens/${name}`, data: bytes }, ...[...members].map(member => ({ name: `bsv-lens/${member}`, data: files.get(member) }))];
        for (const [before, scope] of [[false, index], [true, index.before]]) {
            if (!scope) continue;
            const native = nativeEnvelope(rows, index, before);
            (before ? beforeBuilds : builds).push(...native.builds);
            (before ? beforeReceipts : receipts).push(...native.nativeReceipts);
            for (const value of scope.native?.receipts || []) {
                const receipt = json(value), prefix = path.posix.dirname(value);
                for (const [kind, items] of [['traces', receipt.traceChunks], ['captures', receipt.captures]]) {
                    assert.ok(Array.isArray(items) && items.length, `Native ${kind} missing`);
                    for (const item of items) { const relative = `${prefix}/${previous.relative(item.path)}`, data = files.get(ref(relative));
                        assert.equal(data.length, item.bytes); assert.equal(base.hash(data), item.sha256); assert.ok(scope.native[kind]?.includes(relative), `Native ${kind} absent from index`); }
                }
            }
        }
        for (const row of index.acceptance || []) {
            assert.ok(required.includes(row.id) && !acceptance.has(row.id), 'Unknown/duplicate usability acceptance ID');
            assert.ok(['PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NOT RUN'].includes(row.status));
            if (row.status === 'PASS') {
                assert.equal(row.executed, true); assert.ok(['installed-vsix', 'native-adapter', 'core'].includes(row.scope));
                if (nativeRequired.has(row.id)) assert.equal(row.scope, 'installed-vsix', `${row.id} requires installed native execution`);
                const proof = json(row.receipt); assert.ok(['PASS', 'pass', 'passed'].includes(proof.status) || proof.exit === 0 || proof.exitCode === 0);
                assert.ok(!proof.error && !proof.failure && !proof.spawnError && !['FAIL', 'fail', 'failed', 'BLOCKED'].includes(proof.status));
                if (row.scope === 'installed-vsix') {
                    assert.equal(proof.vsixSha256, index.vsix?.sha256, 'Acceptance VSIX differs from final bytes');
                    assert.ok((index.native?.receipts || []).some(value => path.posix.dirname(value) === path.posix.dirname(row.receipt)), 'Acceptance requires same-directory native receipt');
                }
            } else { assert.ok(row.reason, 'Nonpassing gate requires reason'); if (row.receipt) ref(row.receipt); }
            acceptance.set(row.id, { ...row, receipt: row.receipt ? ref(row.receipt) : null });
        }
        for (const workspace of index.workspaces || []) {
            const inventory = json(workspace.inventory), root = previous.relative(workspace.root); assert.ok(inventory.files.length);
            const seen = new Set();
            for (const row of inventory.files) { const relative = previous.relative(row.path); assert.ok(!seen.has(relative)); seen.add(relative);
                const data = files.get(ref(`${root}/${relative}`)); assert.equal(data.length, row.bytes); assert.equal(base.hash(data), row.sha256); }
            const manifest = ref(workspace.manifest), config = require('../../../src/hardware/native-input').validateNativeManifest(JSON.parse(files.get(manifest)));
            require('./replay-input.cjs').sourceEntry(workspace.sourceEntry, config, inventory.files);
            workspaces.push({ ...workspace, root: `${directory}/${root}`, inventory: ref(workspace.inventory), manifest });
        }
        for (const item of index.diagnostics || []) {
            const manifest = ref(item.manifest);
            if (item.kind === 'lossless-file-inventory') inventoryTables.push({ manifest, tables: json(item.manifest) });
            else {
                assert.ok(['lossless-native-transport', 'lossless-json-interning'].includes(item.kind)); const base = path.posix.dirname(item.manifest);
                const codec = item.kind === 'lossless-native-transport' ? require('./diagnostics.cjs') : require('./json-interning.cjs');
                const decoded = codec.decode(json(item.manifest), name => files.get(ref(`${base === '.' ? '' : base + '/'}${name}`)));
                diagnostics.push({ kind: item.kind, manifest, status: 'PASS', originals: decoded.map(({ data, ...row }) => row) });
            }
        }
        indexes.push({ path: name, sha256: base.hash(bytes), members: members.size });
    }
    if (inventoryTables.length) require('./inventory-tables.cjs').decodeMany(inventoryTables.map(row => row.tables)).forEach(({ data, ...row }, index) =>
        diagnostics.push({ kind: 'lossless-file-inventory', manifest: inventoryTables[index].manifest, status: 'PASS', originals: [row] }));
    const decodedPaths = new Set(); let decodedBytes = 0;
    for (const item of diagnostics) for (const original of item.originals) {
        assert.ok(!decodedPaths.has(original.path), 'Duplicate reconstructed logical attachment'); decodedPaths.add(original.path);
        decodedBytes += original.bytes; assert.ok(decodedBytes <= 768 * 1024 * 1024, 'All reconstructed diagnostics aggregate limit');
    }
    for (const name of files.keys()) if (name.startsWith(evidenceRoot) && !indexes.some(index => index.path === name)) assert.ok(covered.has(name), `Unindexed usability evidence: ${name}`);
    const complete = receipts.length > 0 && builds.length > 0 && beforeBuilds.length > 0 && beforeReceipts.length > 0 && workspaces.length > 0 && required.every(id => acceptance.get(id)?.status === 'PASS');
    assert.ok(complete || allowIncompleteNative, 'Missing current installed usability gates/before captures/workspace inputs');
    const result = { indexes, builds, beforeBuilds, nativeReceipts: receipts, beforeReceipts, workspaces, diagnostics, acceptance: [...acceptance.values()], complete };
    if (expected) assert.deepEqual(result, expected, 'Usability evidence changed during replay'); return result;
}
function validateEntries(entries, sourceOnly, workspace, options = {}) {
    const current = validateEvidence(entries, { allowIncompleteNative: options.allowIncompleteNative ?? options.allowIncompleteBrowser, expected: options.expected?.current });
    const companion = validateCompanion(entries);
    const inherited = legacy.validateEntries(entries.filter(row => !tracePath(row.name.slice(9)) && !vsixPath(row.name.slice(9))), sourceOnly, workspace, { allowIncompleteBrowser: false });
    inherited.inherited.inventory = historical.inventory(entries); inherited.runtime = fix.runtime(entries).sort((a, b) => a.path.localeCompare(b.path));
    inherited.evidence = { inherited: inherited.evidence, companion, current, browser: current.complete ? 'indexed-pass' : 'MISSING - USABILITY CANDIDATE ONLY' };
    if (options.expected) assert.deepEqual(inherited.evidence, options.expected); return inherited;
}
function replayCommand({ js, env, directory, mode, lane, script }) {
    const output = path.join(directory, `core-replay-${mode}`, lane); fs.mkdirSync(output, { recursive: true });
    const previousOutput = env.G6_OUTPUT_DIR; env.G6_OUTPUT_DIR = output;
    try { return JSON.parse(js(script, '--replay').stdout); }
    finally { if (previousOutput === undefined) delete env.G6_OUTPUT_DIR; else env.G6_OUTPUT_DIR = previousOutput; }
}
async function validateDelivery({ workspace, archives, directory = createOutput('delivery'), allowIncompleteNative = false, nativeReplay } = {}) {
    return legacy.validateDelivery({ workspace, archives, directory, allowIncompleteBrowser: allowIncompleteNative, validateMembers: validateEntries,
        publicQueriesRunner: async ({ js, env, receipt }) => {
            const proof = replayCommand({ js, env, directory, mode: receipt.mode, lane: 'legacy12', script: 'experiments/hardware/g6-usability/delivery-replay.cjs' });
            assert.equal(proof.originalStrictComparison?.status, 'FAIL', 'Original strict cross-build failure must remain explicit');
            assert.equal(proof.queries?.length, 12); assert.equal(proof.replayVerification?.executedQueryCount, 12);
            assert.equal(proof.replayVerification.completeIndexedFacts, 'PASS'); assert.equal(proof.replayVerification.workerCancellation, 'PASS');
            return { result: { status: proof.status, queries: proof.queries, cancellation: proof.cancellation },
                verification: { ...proof.replayVerification, originalStrictComparison: proof.originalStrictComparison,
                    output: proof.output, resultRepresentation: proof.resultRepresentation, identityProof: proof.identityProof } };
        },
        replayExtra: async ({ receipt, cwd, env, js, py, members }) => {
            receipt.schema = 'g6-usability-delivery-v1'; receipt.nativeEvidence = members.evidence.current;
            receipt.nativeInputReplay = JSON.parse(js('experiments/hardware/g6/replay-input.cjs').stdout);
            receipt.actualWorkspaceInputReplay = members.evidence.current.workspaces.map(input => JSON.parse(js('experiments/hardware/g6-usability/replay-input.cjs', input.manifest, input.root,
                ...(input.sourceEntry ? [JSON.stringify(input.sourceEntry)] : [])).stdout));
            const semantic = replayCommand({ js, env, directory, mode: receipt.mode, lane: 'semantic75', script: 'experiments/hardware/g6-usability/semantic.cjs' }); assert.equal(semantic.status, 'PASS');
            receipt.semanticReplay = JSON.parse(fs.readFileSync(path.join(semantic.output, 'semantic.json')));
            receipt.originalStrictSemanticComparison = receipt.semanticReplay.originalStrictComparison;
            assert.equal(receipt.originalStrictSemanticComparison.status, 'FAIL');
            js('--test', 'experiments/hardware/g6-usability/package.test.cjs', 'experiments/hardware/g6-usability/diagnostics.test.cjs', 'experiments/hardware/g6-usability/inventory-tables.test.cjs', 'experiments/hardware/g6-usability/json-interning.test.cjs');
            receipt.reconstructedDiagnostics = members.evidence.current.diagnostics.filter(item => item.kind === 'lossless-native-transport')
                .map(item => JSON.parse(js('experiments/hardware/g6-usability/diagnostics.cjs', '--verify', item.manifest).stdout));
            const inventories = members.evidence.current.diagnostics.filter(item => item.kind === 'lossless-file-inventory');
            if (inventories.length) receipt.reconstructedInventories = JSON.parse(js('experiments/hardware/g6-usability/inventory-tables.cjs', '--verify', ...inventories.map(item => item.manifest)).stdout);
            receipt.reconstructedInternedJson = members.evidence.current.diagnostics.filter(item => item.kind === 'lossless-json-interning')
                .map(item => JSON.parse(js('experiments/hardware/g6-usability/json-interning.cjs', '--verify', item.manifest).stdout));
            const traces = members.evidence.current.indexes.flatMap(row => { const index = JSON.parse(fs.readFileSync(path.join(cwd, row.path)));
                return [...(index.native?.traces || []), ...(index.before?.native?.traces || [])].map(name => `${path.posix.dirname(row.path)}/${name}`); });
            if (traces.length) py('-c', 'import sys,zipfile\nfor p in sys.argv[1:]:\n with zipfile.ZipFile(p) as z:\n  assert all(i.file_size<=64*1024*1024 for i in z.infolist())\n  assert sum(i.file_size for i in z.infolist())<=768*1024*1024\n  assert z.testzip() is None,p\nprint("Indexed before/current native trace CRC PASS")', ...traces);
            receipt.nativeTraceCrc = traces.length ? 'PASS' : 'NOT RUN';
            receipt.nativeReplay = nativeReplay ? await nativeReplay({ receipt, cwd, env, directory, workspaces: members.evidence.current.workspaces })
                : { status: 'NOT RUN', reason: 'Explicit installed-VSIX external-tools replay required for final delivery.' };
            if (nativeReplay) assert.equal(receipt.nativeReplay.status, 'PASS');
        } });
}
module.exports = { evidenceRoot, companionPath, required, nativeRequired, safe, tracePath, vsixPath, validateEvidence, validateCompanion, validateEntries, validateDelivery };
