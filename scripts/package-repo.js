'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { collectFiles, writeZip } = require('./zip');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const archiveName = `${manifest.name}-repository-${manifest.version}.zip`;
const output = path.join(root, 'dist', archiveName);

const entries = collectFiles(root, {
    prefix: manifest.name,
    exclude(relativePath, entry) {
        const segments = relativePath.split('/');
        if (segments.some((segment) => ['.git', 'node_modules', '.build'].includes(segment))) return true;
        if (relativePath === `dist/${archiveName}` || relativePath === 'dist/SHA256SUMS.txt') return true;
        return entry.isFile() && /(?:\.log|\.DS_Store)$/.test(relativePath);
    }
});
const result = writeZip(output, entries);
console.log(`repo: ${path.relative(root, result.outputPath)} (${result.entries} files, ${result.bytes} bytes)`);
