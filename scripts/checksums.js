'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const files = [
    `${manifest.name}-${manifest.version}.vsix`,
    `${manifest.name}-repository-${manifest.version}.zip`
];
for (const name of files) {
    if (!fs.existsSync(path.join(dist, name))) throw new Error(`Missing release artifact: ${name}`);
}
const lines = files.map((name) => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, name))).digest('hex');
    return `${hash}  ${name}`;
});
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log(`checksums: ${files.length} artifacts`);
