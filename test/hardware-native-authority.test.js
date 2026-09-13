'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRun } = require('../experiments/hardware/g6/run.cjs');
const { grantDirectory, grantSubdirectory, verifyDirectoryGrant } = require('../src/panel/hardware-authority');
test('native source folder cannot promote an escaped symlink into new root authority', async () => {
    const root = createRun('authority'), approved = path.join(root, 'approved'), outside = path.join(root, 'outside');
    await fs.mkdir(path.join(approved, 'source'), { recursive: true }); await fs.mkdir(outside);
    const grant = await grantDirectory(approved);
    assert.equal((await grantSubdirectory(grant, 'source')).path, await fs.realpath(path.join(approved, 'source')));
    await fs.symlink(outside, path.join(approved, 'escape'));
    for (const relative of ['escape', '../outside', outside, 'source/../escape'])
        await assert.rejects(grantSubdirectory(grant, relative), { code: 'PATH_DENIED' });
});
test('native directory grants reject root replacement across an awaited picker', async () => {
    const root = createRun('authority-replace'), selected = path.join(root, 'selected'), other = path.join(root, 'other');
    await fs.mkdir(selected); await fs.mkdir(other); const grant = await grantDirectory(selected);
    await fs.rename(selected, path.join(root, 'retired')); await fs.symlink(other, selected);
    await assert.rejects(verifyDirectoryGrant(grant), { code: 'PATH_DENIED' });
    await assert.rejects(grantSubdirectory(grant, '.'), { code: 'PATH_DENIED' });
});
