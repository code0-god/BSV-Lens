'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { finished } = require('node:stream/promises');
const root = path.resolve(__dirname, '../../..');
function createRun(label) {
    if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid G6 run label');
    const base = path.join(root, '.build/hardware/runs'); fs.mkdirSync(base, { recursive: true });
    const directory = path.join(fs.mkdtempSync(path.join(base, `g6-${label}-`)), 'g6'); fs.mkdirSync(directory); return directory;
}
async function run(label, executable, args) {
    const directory = createRun(label), startedAt = new Date().toISOString();
    const env = { ...process.env, G6_OUTPUT_DIR: directory };
    const logs = ['stdout', 'stderr'].map(name => fs.createWriteStream(path.join(directory, `${name}.log`), { flags: 'wx' }));
    const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', value => { logs[0].write(value); process.stdout.write(value); });
    child.stderr.on('data', value => { logs[1].write(value); process.stderr.write(value); });
    let spawnError = null; child.on('error', error => { spawnError = { code: error.code, message: error.message }; });
    const exit = await new Promise(resolve => child.once('close', (exitCode, signal) => resolve({ exitCode, signal })));
    logs.forEach(stream => stream.end()); await Promise.all(logs.map(stream => finished(stream)));
    const receipt = { schema: 'g6-run-v1', directory, startedAt, finishedAt: new Date().toISOString(), executable, args,
        cwd: root, ...exit, spawnError, environment: { node: process.version, platform: process.platform, arch: process.arch,
            G6_OUTPUT_DIR: directory, PATH: env.PATH, NODE_OPTIONS: env.NODE_OPTIONS || null }, stdout: 'stdout.log', stderr: 'stderr.log' };
    fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(`G6_RECEIPT ${path.join(directory, 'receipt.json')}`); return receipt;
}
if (require.main === module) {
    const [label, executable, ...args] = process.argv.slice(2);
    if (!label || !executable) throw new Error('Usage: run.cjs LABEL EXECUTABLE [ARGUMENTS...]');
    run(label, executable, args).then(result => { process.exitCode = result.exitCode === 0 && !result.spawnError ? 0 : 1; })
        .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { createRun, run };
