'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRunOutput } = require('../g4/run-output');
const root = path.resolve(__dirname, '../../..');

(async () => {
    const [label, command, ...args] = process.argv.slice(2);
    if (!label || !command || !/^[a-z0-9-]+$/.test(label)) throw new Error('Usage: run.cjs label command [args...]');
    const output = await createRunOutput(root, `g4-fix-${label}`);
    const startedAt = new Date().toISOString();
    const oracle = fs.readFileSync(path.join(__dirname, 'oracle/regressions.test.cjs'));
    const stdout = fs.createWriteStream(path.join(output, 'stdout.log'), { flags: 'wx' });
    const stderr = fs.createWriteStream(path.join(output, 'stderr.log'), { flags: 'wx' });
    const child = spawn(command, args, { cwd: root, env: { ...process.env, G4_REVIEW_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { stdout.write(bytes); process.stdout.write(bytes); });
    child.stderr.on('data', bytes => { stderr.write(bytes); process.stderr.write(bytes); });
    child.on('error', error => { stderr.write(String(error)); });
    child.on('close', (exitCode, signal) => {
        stdout.end(); stderr.end();
        const receipt = { schema: 'g4-correctness-followup-run-v1', label, command, args, cwd: root,
            startedAt, finishedAt: new Date().toISOString(), exitCode, signal,
            environment: { node: process.version, platform: process.platform, arch: process.arch, PATH: process.env.PATH,
                NODE_OPTIONS: process.env.NODE_OPTIONS || null, G4_REVIEW_ROOT: root },
            oracle: { provenance: 'Locally reconstructed from supplied findings; original external review files unavailable',
                sha256: crypto.createHash('sha256').update(oracle).digest('hex') },
            stdout: 'stdout.log', stderr: 'stderr.log' };
        fs.writeFileSync(path.join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
        console.log(`G4_FIX_RECEIPT ${path.join(output, 'receipt.json')}`);
        process.exitCode = exitCode === 0 ? 0 : 1;
    });
})().catch(error => { console.error(error); process.exitCode = 1; });
