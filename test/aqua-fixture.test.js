'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    fingerprintBsvSources
} = require('../scripts/aqua-fixture');

test('AQuA source fingerprints ignore file creation order and detect changes', (t) => {
    const firstWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-fingerprint-first-'));
    const secondWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-fingerprint-second-'));
    t.after(() => fs.rmSync(firstWorkspace, { recursive: true, force: true }));
    t.after(() => fs.rmSync(secondWorkspace, { recursive: true, force: true }));
    const firstRoot = path.join(firstWorkspace, 'hw', 'bsv', 'src');
    const secondRoot = path.join(secondWorkspace, 'hw', 'bsv', 'src');
    fs.mkdirSync(firstRoot, { recursive: true });
    fs.mkdirSync(secondRoot, { recursive: true });
    fs.writeFileSync(path.join(firstRoot, 'B.bsv'), 'package B; endpackage\n');
    fs.writeFileSync(path.join(firstRoot, 'A.bsv'), 'package A; endpackage\n');
    fs.writeFileSync(path.join(secondRoot, 'A.bsv'), 'package A; endpackage\n');
    fs.writeFileSync(path.join(secondRoot, 'B.bsv'), 'package B; endpackage\n');

    const first = fingerprintBsvSources(firstWorkspace);
    const second = fingerprintBsvSources(secondWorkspace);

    assert.deepEqual(first, second);
    assert.equal(first.files, 2);
    fs.writeFileSync(path.join(secondRoot, 'A.bsv'), 'package Changed; endpackage\n');
    assert.notEqual(fingerprintBsvSources(secondWorkspace).fingerprint, first.fingerprint);
});
