'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const publish = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish.yml'), 'utf8');

test('CI stays reusable and publish remains a separate tag-only workflow', () => {
    assert.match(ci, /workflow_call:/);
    assert.match(ci, /pull_request:/);
    assert.doesNotMatch(ci, /vsce publish|id-token: write/);
    assert.match(publish, /tags:\s*\n\s*-\s*'v\*\.\*\.\*'/);
    assert.match(publish, /uses: \.\/\.github\/workflows\/ci\.yml/);
    assert.match(publish, /needs: verify/);
});

test('CI uploads only verified current release artifacts', () => {
    assert.match(ci, /actions\/upload-artifact@v4/);
    assert.match(ci, /if: github\.ref == 'refs\/heads\/main' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    for (const artifact of [
        'dist/bsv-lens-*.vsix',
        'dist/bsv-lens-repository-*.zip',
        'dist/SHA256SUMS.txt'
    ]) assert.ok(ci.includes(artifact));
});

test('Marketplace publish uses minimal OIDC permissions and duplicate rejection', () => {
    assert.match(publish, /contents: read/);
    assert.match(publish, /id-token: write/);
    assert.match(publish, /environment: marketplace/);
    assert.match(publish, /azure\/login@v3/);
    assert.match(publish, /allow-no-subscriptions: true/);
    for (const variable of ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID']) {
        assert.ok(publish.includes(`vars.${variable}`));
    }
    assert.doesNotMatch(publish, /subscription-id|AZURE_SUBSCRIPTION_ID/);
    assert.match(publish, /npm run check:release-tag/);
    assert.match(publish, /vsce publish --azure-credential --packagePath/);
    assert.doesNotMatch(publish, /VSCE_PAT|--skip-duplicate|contents: write/);
});
