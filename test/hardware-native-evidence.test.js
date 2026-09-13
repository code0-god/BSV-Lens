'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createRun } = require('../experiments/hardware/g6/run.cjs');
const { hash } = require('../experiments/hardware/g4/validate-delivery');
const { prepare, createIndex } = require('../experiments/hardware/g6/evidence.cjs');
const { validateEvidence } = require('../experiments/hardware/g6/validate-delivery.cjs');
function fixture() {
    const root = createRun('evidence-test'), put = (name, bytes) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
    put('report.json', '{"status":"NOT RUN","scope":"synthetic assembler fixture"}\n');
    put('view.state.json', '{"duplicateDiagnostic":true}\n');
    put('unselected.json', 'must never be collected');
    const plan = { schema: 'g6-evidence-plan-v1', budget: { archiveBaseBytes: 596500000, legacyBaseBytes: 433400000 },
        lanes: [{ id: 'test', root, files: ['report.json'], omit: [{ from: 'view.state.json', reason: 'Synthetic duplicate state; actual evidence remains separately selected.' }] }],
        results: [{ id: 'test', status: 'NOT RUN', receipt: 'test/report.json' }] };
    return { root, put, plan };
}
test('Evidence plan copies exact raw selections, records omitted state hashes and never discovers other files', () => {
    const { root, plan } = fixture(), prepared = prepare(plan), built = createIndex(plan, prepared, 'run-synthetic');
    assert.deepEqual([...prepared.files.keys()], ['test/report.json', 'omitted-diagnostics.json']);
    assert.ok(prepared.files.get('test/report.json').bytes.equals(fs.readFileSync(path.join(root, 'report.json'))));
    assert.equal(prepared.omitted[0].sha256, hash(fs.readFileSync(path.join(root, 'view.state.json'))));
    assert.equal(validateEvidence(built.entries, { allowIncompleteNative: true }).complete, false);
    assert.deepEqual(createIndex(plan, prepared, 'run-synthetic').index, built.index);
    assert.ok(built.budget.archiveTotalBytes < 768 * 1024 * 1024);
    assert.ok(built.budget.legacyTotalBytes < 512 * 1024 * 1024);
});
test('Evidence plan rejects wrong pins, traversal, symlinks, profiles, duplicate targets and omitted captures', () => {
    const { root, put, plan } = fixture();
    const reject = mutate => { const value = structuredClone(plan); mutate(value); assert.throws(() => prepare(value)); };
    reject(value => value.lanes[0].files = [{ from: 'report.json', sha256: '0'.repeat(64) }]);
    reject(value => value.lanes[0].files = [{ from: '../outside.json' }]);
    reject(value => value.lanes[0].files = ['report.json', { from: 'unselected.json', to: 'test/report.json' }]);
    reject(value => value.lanes[0].omit = [{ from: 'capture.png', reason: 'not permitted' }]);
    put('profile-retained/state.json', '{}'); reject(value => value.lanes[0].files = ['profile-retained/state.json']);
    fs.symlinkSync('report.json', path.join(root, 'link.json')); reject(value => value.lanes[0].files = ['link.json']);
    const prepared = prepare(plan);
    assert.throws(() => createIndex({ ...plan, budget: { archiveBaseBytes: 768 * 1024 * 1024, legacyBaseBytes: 0 } }, prepared, 'run-budget'), /archive budget/);
    assert.throws(() => createIndex({ ...plan, budget: { archiveBaseBytes: 0, legacyBaseBytes: 512 * 1024 * 1024 } }, prepared, 'run-budget'), /G4 collector budget/);
});
test('Native receipt trace/capture references cannot disappear from an explicit index', () => {
    const { put, plan } = fixture(); const trace = Buffer.from('synthetic ZIP envelope'), capture = Buffer.from('synthetic PNG envelope');
    put('native-trace-001.zip', trace); put('capture.png', capture);
    put('native-receipt.json', JSON.stringify({ traceChunks: [{ path: 'native-trace-001.zip', bytes: trace.length, sha256: hash(trace) }],
        captures: [{ path: 'capture.png', bytes: capture.length, sha256: hash(capture) }] }));
    plan.lanes[0].files.push('native-receipt.json', 'native-trace-001.zip', 'capture.png');
    plan.native = { receipts: ['test/native-receipt.json'], traces: ['test/native-trace-001.zip'], captures: ['test/capture.png'] };
    createIndex(plan, prepare(plan), 'run-synthetic');
    for (const key of ['traces', 'captures']) { const changed = structuredClone(plan); changed.native[key] = [];
        assert.throws(() => createIndex(changed, prepare(changed), 'run-synthetic'), /missing from index/); }
});
test('External workspace data requires explicit role, preserves source bytes and binds replay roots to its evidence directory', () => {
    const { root, put, plan } = fixture(); put('selected-input/hw/Example.bsv', 'module mkExample(Empty); endmodule\n');
    put('selected-input/input.json', '{"version":1,"sources":[]}\n');
    const events = '{"event":"editorSelection"}\n{"event":"sourceReveal"}\n'; put('selected-input/native-events.jsonl', events);
    plan.lanes.push({ id: 'source', kind: 'external-workspace-data', role: 'external-workspace-data', root: path.join(root, 'selected-input'),
        files: [{ from: 'hw/Example.bsv', to: 'inputs/sources/hw/Example.bsv' }, { from: 'input.json', to: 'inputs/input.json' },
            { from: 'native-events.jsonl', to: 'inputs/native-events.jsonl' }] });
    plan.inputs = [{ manifest: 'inputs/input.json', sourceRoot: 'inputs/sources' }];
    const built = createIndex(plan, prepare(plan), 'run-synthetic');
    assert.equal(built.index.files.find(row => row.path.endsWith('Example.bsv')).role, 'external-workspace-data');
    assert.equal(built.index.inputs[0].sourceRoot, 'docs/hardware/evidence/g6/run-synthetic/inputs/sources');
    assert.equal(built.entries.find(row => row.name.endsWith('Example.bsv')).data.toString(), 'module mkExample(Empty); endmodule\n');
    assert.equal(built.entries.find(row => row.name.endsWith('native-events.jsonl')).data.toString(), events);
    const changed = structuredClone(plan); delete changed.lanes[1].role; assert.throws(() => prepare(changed), /role must be explicit/);
    for (const target of ['inputs/capture.js', 'inputs/capture.json']) {
        const renamed = structuredClone(plan); renamed.lanes[1].files[2].to = target;
        assert.throws(() => prepare(renamed), /data only|extensions must remain unchanged/);
    }
});
