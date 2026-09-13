'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');

test('G3 alias coverage identifies every actual instrumented definition alias', async () => {
    const ledger = JSON.parse(await fs.readFile(path.join(root, 'docs/hardware/G3_COVERAGE.json'), 'utf8'));
    const population = [];
    for (const corpus of Object.keys(ledger.g3B.artifacts).sort()) {
        const bytes = await fs.readFile(path.join(root,
            `docs/hardware/evidence/g3-origin-ghc96/results/instrumented/${corpus}/design.json`));
        const artifactSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        assert.equal(artifactSha256, ledger.g3B.artifacts[corpus]);
        const raw = JSON.parse(bytes);
        for (const module of Object.keys(raw.modules).sort()) {
            for (const name of Object.keys(raw.modules[module].netnames).sort()) {
                population.push({ artifactSha256, module, name, kind: 'definition-alias' });
            }
        }
    }
    assert.deepEqual(ledger.g3B.aliases.population, population);
    assert.equal(ledger.g3B.aliases.definitionTotal, population.length);
    assert.equal(ledger.g3B.aliases.populationHash,
        crypto.createHash('sha256').update(JSON.stringify(population)).digest('hex'));
    assert.equal(ledger.g3B.aliases.knownOriginContributors, 0);
    assert.equal(ledger.g3B.aliases.completeOriginSets, 0);
});
