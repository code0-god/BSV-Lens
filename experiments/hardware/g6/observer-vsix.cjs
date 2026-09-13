'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inventoryFromEntries } = require('./native-runtime.cjs');

const ID = 'bsv-lens-tests.bsv-lens-g6-observer';
const RUNTIME = ['package.json', 'observer/index.js', 'observer/editor-column.cjs', 'native-runtime.cjs'];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function readObserverVsix(vsix) {
    execFileSync('/usr/bin/unzip', ['-tqq', vsix], { stdio: ['ignore', 'pipe', 'pipe'] });
    const entries = RUNTIME.map(relative => ({ path: relative, bytes: execFileSync('/usr/bin/unzip', ['-p', vsix, `extension/${relative}`], { maxBuffer: 1048576 }) }));
    const manifest = JSON.parse(entries.find(entry => entry.path === 'package.json').bytes);
    assert.equal(`${manifest.publisher}.${manifest.name}`, ID); assert.equal(manifest.version, '0.0.1');
    assert.equal(manifest.main, './observer/index.js'); assert.equal(manifest.capabilities.untrustedWorkspaces.supported, true);
    return { id: ID, version: manifest.version, vsix: path.resolve(vsix), sha256: digest(fs.readFileSync(vsix)),
        manifest: manifest, runtime: inventoryFromEntries(entries, 'Installed test observer package/JavaScript runtime'), crc: 'PASS' };
}
async function prepareObserverVsix(output) {
    assert.equal(path.basename(path.resolve(output)), 'g6');
    const stage = path.join(output, 'observer-stage'); fs.mkdirSync(path.join(stage, 'observer'), { recursive: true });
    const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'observer/package.json')));
    assert.equal(`${original.publisher}.${original.name}`, ID); assert.equal(original.dependencies, undefined);
    const manifest = { ...original, main: './observer/index.js', license: 'MIT',
        repository: { type: 'git', url: 'https://github.com/code0-god/BSV-Lens.git' },
        description: 'Test-only observer for isolated BSV Lens native validation.',
        files: ['observer/**', 'native-runtime.cjs', 'README.md', 'LICENSE'] };
    fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    const copies = [['observer/index.js', path.join(__dirname, 'observer/index.js')],
        ['observer/editor-column.cjs', path.join(__dirname, 'observer/editor-column.cjs')],
        ['native-runtime.cjs', path.join(__dirname, 'native-runtime.cjs')], ['LICENSE', path.resolve(__dirname, '../../../LICENSE')]];
    const mappings = copies.map(([relative, source]) => {
        const bytes = fs.readFileSync(source); fs.writeFileSync(path.join(stage, relative), bytes, { flag: 'wx' });
        return { source, archivePath: `extension/${relative}`, bytes: bytes.length, sha256: digest(bytes), transformation: 'byte-copy' };
    });
    fs.writeFileSync(path.join(stage, 'README.md'), '# G6 test observer\n\nFor fresh isolated validation profiles only. No product commands or semantic query implementation.\n', { flag: 'wx' });
    const vsix = path.join(output, 'bsv-lens-g6-observer-0.0.1.vsix'); assert.equal(fs.existsSync(vsix), false);
    await require('@vscode/vsce').createVSIX({ cwd: stage, packagePath: vsix, dependencies: false });
    const result = { schema: 'g6-observer-package-v1', scope: 'Separate test driver only; not BSV Lens product runtime',
        packager: { name: '@vscode/vsce', version: require('@vscode/vsce/package.json').version }, stage,
        ...readObserverVsix(vsix), mappings, manifestTransform: { original, staged: manifest,
            reason: 'Package the existing observer as a normal extension to avoid development-window trust behavior' } };
    fs.writeFileSync(`${vsix}.sha256`, `${result.sha256}  ${path.basename(vsix)}\n`, { flag: 'wx' });
    fs.writeFileSync(path.join(output, 'observer-package.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    return result;
}
module.exports = { prepareObserverVsix, readObserverVsix, OBSERVER_ID: ID, OBSERVER_RUNTIME: RUNTIME };
