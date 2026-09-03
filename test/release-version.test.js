'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assertReleaseTag } = require('../scripts/check-release-version');

test('release tag must exactly match manifest version', () => {
    assert.equal(assertReleaseTag('0.3.0', 'v0.3.0'), 'v0.3.0');
    assert.throws(() => assertReleaseTag('0.3.0', 'v0.3.1'));
    assert.throws(() => assertReleaseTag('0.3.0', 'main'));
});
