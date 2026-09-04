'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createVSIX } = require('@vscode/vsce');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'dist', `${manifest.name}-${manifest.version}.vsix`);

async function main() {
    fs.mkdirSync(path.dirname(output), { recursive: true });
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
