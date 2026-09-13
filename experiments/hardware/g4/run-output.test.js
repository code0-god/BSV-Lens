'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '../../..');
// A fresh node --test process must not inherit the parent's test-worker context.
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

test('correspondence receipt writers preserve submitted history in an isolated checkout', async t => {
    const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'g4-output-seam-'));
    t.after(() => fs.rm(isolated, { recursive: true, force: true }));
    await fs.mkdir(path.join(isolated, 'test'));
    await fs.copyFile(path.join(root, 'test/hardware-correspondence.test.js'),
        path.join(isolated, 'test/hardware-correspondence.test.js'));
    // The copied test derives its output root from its own __dirname, so even
    // the old writer cannot reach real G3 history. Registry inputs must be local.
    await fs.symlink(path.join(root, 'src'), path.join(isolated, 'src'), 'dir');
    for (const name of ['experiments/hardware/fixtures', 'experiments/hardware/g4',
        'docs/hardware/evidence/bsv', 'docs/hardware/evidence/toolchain']) {
        await fs.cp(path.join(root, name), path.join(isolated, name), { recursive: true });
    }
    const historical = path.join(isolated, '.build/hardware/g3-a');
    await fs.mkdir(historical, { recursive: true });
    const names = ['cancellation.json', 'measurements.json',
        ...['A', 'B', 'C'].flatMap(key => [`${key}-bundle.json`, `${key}-query.json`])];
    const original = Buffer.from('{"historicalReceipt":true}\n');
    for (const name of names) await fs.writeFile(path.join(historical, name), original);

    const { stdout, stderr } = await execute(process.execPath, ['--test', '--test-reporter=tap',
        '--test-name-pattern=active worker cancellation observes|actual A/B/C and explicit source stress',
        'test/hardware-correspondence.test.js'], { cwd: isolated, env: childEnv, timeout: 60000, maxBuffer: 1024 * 1024 })
        .catch(error => { t.diagnostic(error.stdout); t.diagnostic(error.stderr); throw error; });
    assert.equal(stderr, '');
    assert.match(stdout, /# pass 2\b/);
    for (const name of names) {
        assert.deepEqual(await fs.readFile(path.join(historical, name)), original, `history overwritten: ${name}`);
    }
    const runs = path.join(isolated, '.build/hardware/runs');
    const directories = await fs.readdir(runs);
    assert.equal(directories.length, 2);
    const outputs = (await Promise.all(directories.map(async directory => {
        const entries = await fs.readdir(path.join(runs, directory));
        for (const name of entries) JSON.parse(await fs.readFile(path.join(runs, directory, name), 'utf8'));
        return entries;
    }))).flat().sort();
    assert.deepEqual(outputs, names.sort());

    // Measurement-only invocation must not depend on cancellation creating a directory.
    await fs.rm(path.join(isolated, '.build'), { recursive: true });
    await execute(process.execPath, ['--test',
        '--test-name-pattern=actual A/B/C and explicit source stress',
        'test/hardware-correspondence.test.js'], { cwd: isolated, env: childEnv, timeout: 60000, maxBuffer: 1024 * 1024 })
        .catch(error => { t.diagnostic(error.stdout); t.diagnostic(error.stderr); throw error; });
    await assert.rejects(fs.stat(historical), { code: 'ENOENT' });
    assert.equal((await fs.readdir(runs)).length, 1);
});


test('run directories are unique under concurrent and sequential allocation', async t => {
    const { createRunOutput } = require('./run-output');
    const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'g4-run-allocation-'));
    t.after(() => fs.rm(isolated, { recursive: true, force: true }));
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => createRunOutput(isolated, 'test')));
    const first = concurrent[0];
    await fs.writeFile(path.join(first, 'receipt.json'), '{"run":1}');
    const next = await createRunOutput(isolated, 'test');
    const directories = [...concurrent, next];
    assert.equal(new Set(directories).size, 9);
    for (const directory of directories) {
        assert.equal(path.dirname(directory), path.join(isolated, '.build/hardware/runs'));
        assert.ok((await fs.stat(directory)).isDirectory());
    }
    assert.equal(await fs.readFile(path.join(first, 'receipt.json'), 'utf8'), '{"run":1}');
    assert.deepEqual(await fs.readdir(next), []);
});
