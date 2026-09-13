'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { finished } = require('node:stream/promises');
const { createRunOutput } = require('../g4/run-output');
const root = path.resolve(__dirname, '../../..');

async function createRun(label) {
    if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid G5 run label');
    const directory = path.join(await createRunOutput(root, `g5-${label}`), 'g5');
    fs.mkdirSync(directory);
    return directory;
}

async function run(label, executable, args) {
    const directory = await createRun(label);
    const startedAt = new Date().toISOString();
    const environment = { ...process.env, G5_OUTPUT_DIR: directory, G4_REVIEW_ROOT: root };
    const streams = ['stdout', 'stderr'].map(name =>
        fs.createWriteStream(path.join(directory, `${name}.log`), { flags: 'wx' }));
    const child = spawn(executable, args, { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { streams[0].write(bytes); process.stdout.write(bytes); });
    child.stderr.on('data', bytes => { streams[1].write(bytes); process.stderr.write(bytes); });
    let spawnError = null;
    child.on('error', error => { spawnError = { code: error.code, message: error.message }; });
    const result = await new Promise(resolve => child.once('close', (exitCode, signal) => resolve({ exitCode, signal })));
    for (const stream of streams) stream.end();
    await Promise.all(streams.map(stream => finished(stream)));
    const receipt = {
        schema: 'g5-run-v1', label, executable, args, cwd: root, directory,
        startedAt, finishedAt: new Date().toISOString(), ...result, spawnError,
        environment: { node: process.version, platform: process.platform, arch: process.arch,
            PATH: environment.PATH, NODE_OPTIONS: environment.NODE_OPTIONS || null,
            G5_OUTPUT_DIR: directory, G4_REVIEW_ROOT: root },
        stdout: 'stdout.log', stderr: 'stderr.log'
    };
    fs.writeFileSync(path.join(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    console.log(`G5_RECEIPT ${path.join(directory, 'receipt.json')}`);
    return receipt;
}

if (require.main === module) {
    const [label, executable, ...args] = process.argv.slice(2);
    if (!label || !executable) throw new Error('Usage: run.cjs LABEL EXECUTABLE [ARGUMENTS...]');
    run(label, executable, args).then(receipt => {
        process.exitCode = receipt.exitCode === 0 && !receipt.spawnError ? 0 : 1;
    }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { createRun, run };
