'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertIsolatedArguments } = require('./native-driver.cjs');
const isolation = { profile: '/private/test-profile', userDataDir: '/private/test-profile/user-data',
    extensionsDir: '/private/test-profile/extensions', sharedDataDir: '/private/test-profile/shared-data' };
const args = ['--user-data-dir=/private/test-profile/user-data', '--extensions-dir=/private/test-profile/extensions',
    '--shared-data-dir=/private/test-profile/shared-data'];
test('CLI and GUI argv identify all three separate private stores', () => {
    for (const command of ['--version', '--install-extension', '--list-extensions', '--new-window'])
        assert.doesNotThrow(() => assertIsolatedArguments([...args, command], isolation));
});
test('missing shared-data isolation cannot silently reuse the user trust database', () => {
    assert.throws(() => assertIsolatedArguments(args.slice(0, 2), isolation), /shared-data-dir/);
});
test('duplicate or foreign store flags are rejected', () => {
    assert.throws(() => assertIsolatedArguments([...args, '--shared-data-dir=/user/global'], isolation), /shared-data-dir/);
    assert.throws(() => assertIsolatedArguments([...args.slice(0, 2), '--shared-data-dir=/user/global'], isolation), /shared-data-dir/);
    assert.throws(() => assertIsolatedArguments(args, { ...isolation, sharedDataDir: '/user/global' }), /escaped/);
});
test('separate configuration, extensions and shared storage cannot alias', () => {
    const aliased = { ...isolation, sharedDataDir: isolation.userDataDir };
    assert.throws(() => assertIsolatedArguments([...args.slice(0, 2), `--shared-data-dir=${isolation.userDataDir}`], aliased), /distinct/);
});
