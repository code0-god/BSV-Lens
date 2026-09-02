'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeConfig, parseJsonc } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(manifest.name, 'bsv-architecture-explorer');
assert.equal(manifest.displayName, 'BSV Architecture Explorer');
assert.equal(manifest.main, './src/extension.js');
assert.equal(manifest.engines.vscode.startsWith('^'), true);
assert.deepEqual(manifest.dependencies || {}, {});
assert.equal(manifest.icon, 'media/icon.png');

const required = [
    'README.md',
    'LICENSE',
    'src/extension.js',
    'src/panel/architecture-panel.js',
    'src/panel/html.js',
    'media/webview.js',
    'media/webview.css',
    'media/icon.png'
];
for (const relativePath of required) assert.ok(fs.existsSync(path.join(root, relativePath)), `Missing ${relativePath}`);

const declaredCommands = new Set(manifest.contributes.commands.map((item) => item.command));
for (const command of [
    'bsvArchitecture.openWorkspace',
    'bsvArchitecture.openCurrentFile',
    'bsvArchitecture.openSymbol',
    'bsvArchitecture.refresh',
    'bsvArchitecture.createConfig',
    'bsvArchitecture.exportJson'
]) assert.ok(declaredCommands.has(command), `Command is not declared: ${command}`);

for (const key of Object.keys(manifest.contributes.configuration.properties)) {
    assert.match(key, /^bsvArchitecture\./);
}

for (const filePath of walk(root).filter((item) => item.endsWith('.js') && !item.includes(`${path.sep}dist${path.sep}`))) {
    childProcess.execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
}

const exampleRoot = path.join(root, 'examples', 'bsv-mini-accelerator');
const parsedFiles = walk(path.join(exampleRoot, 'hw', 'bsv', 'src'))
    .filter((item) => item.endsWith('.bsv'))
    .map((filePath) => parseBsvFile(fs.readFileSync(filePath, 'utf8'), {
        uri: `file://${filePath}`,
        relativePath: path.relative(exampleRoot, filePath).replace(/\\/g, '/')
    }));
const config = normalizeConfig(parseJsonc(fs.readFileSync(path.join(exampleRoot, '.bsv-arch.json'), 'utf8')), {
    workspaceName: 'Mini BSV Accelerator'
});
const model = buildArchitectureModel(parsedFiles, config, {
    workspaceName: 'Mini BSV Accelerator',
    workspaceUri: 'file:///bsv-mini-accelerator'
});

assert.equal(model.diagnostics.length, 0);
assert.ok(model.nodes.some((node) => node.name === 'mapGlobalRow' && node.kind === 'function'));
assert.ok(model.nodes.some((node) => node.name === 'mkAcceleratorTop' && node.entry));
assert.ok(model.edges.some((edge) => edge.kind === 'instantiate' && edge.label === 'quantizer'));
assert.ok(model.edges.some((edge) => edge.kind === 'data' && edge.label === 'quantized activations'));

const html = fs.readFileSync(path.join(root, 'src', 'panel', 'html.js'), 'utf8');
assert.match(html, /default-src 'none'/);
assert.match(html, /nonce-/);
assert.doesNotMatch(html, /unsafe-inline/);
assert.match(html, />B<\/span>/);

const brandedSources = walk(root).filter((item) => {
    if (item.includes(`${path.sep}dist${path.sep}`)) return false;
    if (/\.(?:png|jpg|jpeg|gif|webp)$/i.test(item)) return false;
    return fs.statSync(item).isFile();
});
const forbiddenBrandTokens = [
    String.fromCharCode(65, 81, 117, 65),
    String.fromCharCode(97, 113, 117, 97, 66, 115, 118, 65, 114, 99, 104),
    String.fromCharCode(97, 113, 117, 97, 45, 98, 115, 118, 45, 97, 114, 99, 104, 105, 116, 101, 99, 116, 117, 114, 101, 45, 101, 120, 112, 108, 111, 114, 101, 114)
];
for (const filePath of brandedSources) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const token of forbiddenBrandTokens) {
        assert.equal(content.includes(token), false, `Legacy branding remains in ${path.relative(root, filePath)}`);
    }
}

console.log(`check: ${parsedFiles.length} example BSV files, ${model.stats.nodes} nodes, ${model.stats.edges} edges`);
console.log('check: generic manifest, JavaScript syntax, CSP, parser, graph model, and branding are valid');

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (['.git', 'node_modules', '.build'].includes(entry.name)) return [];
        const fullPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(fullPath) : [fullPath];
    });
}
