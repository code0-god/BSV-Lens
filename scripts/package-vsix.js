'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createVSIX } = require('@vscode/vsce');
const { writeBuildMetadata } = require('./build-metadata');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'dist', `${manifest.name}-${manifest.version}.vsix`);

async function main() {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).length > 0;
    const metadata = writeBuildMetadata(root, sourceCommit, dirty);
    console.log(`build: ${metadata.buildId} (${sourceCommit}${dirty ? ', dirty' : ''})`);
    await createVSIX({
        cwd: root,
        packagePath: output,
        dependencies: false
    });
    console.log(`vsix: ${path.relative(root, output)} (${fs.statSync(output).size} bytes)`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
