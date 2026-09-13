'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRunOutput } = require('./run-output');
const root = path.resolve(__dirname, '../../..');

test('G4 output reservation refuses orphan validation checksum receipts', async t => {
    const { assertNewOutput } = require('./package');
    const directory = await createRunOutput(root, 'g4-package-guard');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const archive = path.join(directory, 'candidate.zip');
    const sidecar = `${archive}.validation.json.sha256`;
    fs.writeFileSync(sidecar, 'existing receipt bytes');
    assert.throws(() => assertNewOutput(archive), /Refusing to overwrite/);
    assert.equal(fs.readFileSync(sidecar, 'utf8'), 'existing receipt bytes');
    assert.equal(fs.existsSync(archive), false);
});
