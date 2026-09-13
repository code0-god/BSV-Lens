'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const files = ['index.html', 'style.css', 'app.js', 'layout.js', 'navigation.js', 'bsv-layout.js', 'bsv-renderer.js', 'server.js', '../importer.js', '../bsv-architecture.js'];
const receipt = { format: 'unbundled-commonjs-and-browser-svg', files: [] };
for (const name of files) {
    const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
    if (name.endsWith('.js')) new vm.Script(text, { filename: name });
    receipt.files.push({ name, bytes: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') });
}
const out = path.resolve(__dirname, '../../../.build/hardware/bsv-ui');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'build-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`Validated ${files.length} unbundled runtime files; ${path.relative(process.cwd(), out)}/build-receipt.json`);
