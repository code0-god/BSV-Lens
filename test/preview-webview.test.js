'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const token = 'test-preview-capability';

function fixture() {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-preview-'));
    const sourceRoot = path.join(workspace, 'custom');
    fs.mkdirSync(sourceRoot);
    fs.writeFileSync(path.join(sourceRoot, 'Inside.bsv'), 'package Inside; module mkInside(Empty); endmodule endpackage\n');
    fs.writeFileSync(path.join(sourceRoot, 'Excluded.bsv'), 'package Excluded; endpackage\n');
    fs.mkdirSync(path.join(workspace, 'build'));
    fs.writeFileSync(path.join(workspace, 'build', 'Leak.bsv'), 'package RootBuildLeak; endpackage\n');
    const outside = path.join(os.tmpdir(), `Secret-${path.basename(workspace)}.bsv`);
    fs.writeFileSync(outside, 'package SecretOutside; endpackage\n');
    fs.symlinkSync(outside, path.join(sourceRoot, 'Secret.bsv'));
    fs.writeFileSync(path.join(workspace, '.bsv-arch.json'), JSON.stringify({
        version: 1,
        sourceRoots: ['.'],
        exclude: ['**/Excluded.bsv']
    }));
    return { workspace, outside };
}

function startPreview(workspace) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/preview-webview.js'], {
            cwd: root,
            env: {
                ...process.env,
                PORT: '0',
                BSV_TEST_WORKSPACE: workspace,
                BSV_PREVIEW_TOKEN: token
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error(`Preview did not start:\n${output}`));
        }, 5_000);
        const inspect = (chunk) => {
            output += chunk;
            const ready = /^READY (http:\/\/127\.0\.0\.1:\d+)$/m.exec(output);
            if (!ready) return;
            clearTimeout(timeout);
            resolve({ child, origin: ready[1] });
        };
        child.stdout.on('data', inspect);
        child.stderr.on('data', inspect);
        child.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

test('preview requires loopback host and per-run capability', async (t) => {
    const sample = fixture();
    t.after(() => fs.rmSync(sample.workspace, { recursive: true, force: true }));
    t.after(() => fs.rmSync(sample.outside, { force: true }));
    const preview = await startPreview(sample.workspace);
    t.after(() => preview.child.kill());

    assert.equal((await fetch(`${preview.origin}/health`)).status, 200);
    assert.equal((await fetch(preview.origin)).status, 403);
    assert.equal((await fetch(preview.origin, {
        headers: { 'x-bsv-preview-token': token }
    })).status, 200);
    assert.equal((await fetch(preview.origin.replace('127.0.0.1', 'localhost'), {
        headers: { 'x-bsv-preview-token': token }
    })).status, 403);
    assert.equal((await fetch(`${preview.origin}/model.json`, {
        headers: { 'x-bsv-preview-token': token }
    })).status, 404);
});

test('preview honors configured roots and rejects external symlinks', async (t) => {
    const sample = fixture();
    t.after(() => fs.rmSync(sample.workspace, { recursive: true, force: true }));
    t.after(() => fs.rmSync(sample.outside, { force: true }));
    const preview = await startPreview(sample.workspace);
    t.after(() => preview.child.kill());

    const response = await fetch(preview.origin, {
        headers: { 'x-bsv-preview-token': token }
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /mkInside/);
    assert.doesNotMatch(html, /SecretOutside|package:Excluded|RootBuildLeak/);
});
