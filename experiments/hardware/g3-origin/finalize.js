'use strict';

// Author evidence assembly only. Offline readers never execute compiler tools here.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { loadOriginCase } = require('../g3/origin-query');
const origin = require('../../../src/hardware/correspondence/origin');
const root = path.resolve(__dirname, '../../..');
const evidence = path.join(root, 'docs/hardware/evidence/g3-origin-ghc96');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));

async function main() {
    const run = path.resolve(process.argv[2] || '');
    assert.ok(run.startsWith(path.join(root, '.build/hardware/g3-origin') + path.sep), 'Explicit task-owned run directory required');
    const copied = [];
    for (const name of (await fs.readdir(path.join(run, 'receipts'))).sort()) {
        if (name.endsWith('.running.json') || !/\.(json|log|jsonl)$/.test(name)) continue;
        const source = path.join(run, 'receipts', name), destination = path.join(evidence, 'receipts', name);
        const bytes = await fs.readFile(source);
        assert.ok(bytes.length <= 16 * 1024 * 1024, 'Receipt exceeds recorded log limit');
        let existing;
        try { existing = await fs.readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (existing) assert.equal(hash(existing), hash(bytes), `Conflicting captured receipt: ${name}`);
        else await fs.writeFile(destination, bytes);
        copied.push({ path: `receipts/${name}`, sha256: hash(bytes), bytes: bytes.length });
    }
    const sidecar = await json(path.join(evidence, 'results/origin-sidecar.json'));
    const comparison = await json(path.join(evidence, 'results/noninterference.json'));
    const identities = await json(path.join(evidence, 'inputs/execution-identities.json'));
    assert.equal(comparison.verified, true);
    assert.equal(sidecar.compilerBinarySha256, identities.instrumentedBscSha256);
    assert.equal(sidecar.patchSha256, hash(await fs.readFile(path.join(evidence, 'patches/final-bsc-origin.patch'))));
    assert.ok(sidecar.links.every(link => link.completeOriginSet === false));
    const product = [];
    for (const [key, occurrencePath] of [['A', ['mkConnected', 'left']], ['B', ['mkControl']], ['C', ['mkReuse', 'wide']]]) {
        const started = performance.now(), { request, analysis } = await loadOriginCase(key);
        const result = origin.sourceToImplementation(analysis, { occurrencePath });
        const record = { corpus: key, snapshotId: request.importResult.snapshot.id, originBundleId: analysis.bundle.id,
            adapterIdentity: analysis.bundle.adapterIdentity, authority: analysis.bundle.provider,
            query: { occurrencePath }, result, coverage: origin.getCoverage(analysis),
            explanations: result.claims.map(claim => origin.explainMapping(analysis, claim.id)),
            attachAndQueryMs: performance.now() - started };
        await fs.writeFile(path.join(evidence, `results/product-${key}.json`), JSON.stringify(record, null, 2) + '\n');
        product.push({ corpus: key, snapshotId: record.snapshotId, originBundleId: record.originBundleId,
            adapterIdentity: record.adapterIdentity, coverage: record.coverage });
    }
    const stages = copied.filter(file => file.path.endsWith('.json')).map(async file => {
        const value = await json(path.join(evidence, file.path));
        if (!Array.isArray(value.argv) || value.exit === undefined) return null;
        return { path: file.path, exit: value.exit, elapsedSeconds: value.elapsedSeconds,
            completeLog: value.completeLog, logSha256: value.logSha256 };
    });
    const result = { schema: 'g3-origin-final-recovery-v1',
        status: 'verified-supported-contributor-paths; incomplete-total-origin-coverage',
        sourcePin: sidecar.sourcePin, toolchain: identities,
        observedLeafDefinitions: sidecar.coverage.observedTaggedLeafDefinitions,
        knownContributorLeafDefinitions: sidecar.coverage.verifiedKnownContributorLeafDefinitions,
        leafDefinitionPopulation: sidecar.coverage.leafPopulation.length, completeOriginSetLeafDefinitions: 0,
        historicalBaselineUntouched: sidecar.coverage.historicalBaselineUntouched,
        storageAndRhs: 'verified through supported compiler root and actual reader stage to leaves',
        noninterference: 'verified functional RTL and complete ordered structural projection, not origin correctness',
        partialScopes: sidecar.limitations, liveReceipts: (await Promise.all(stages)).filter(Boolean),
        providerAuthority: 'caller-approved captured compiler/reader experiment, not cryptographic attestation',
        noInstalledToolchainReplacement: true, noProductionUiChange: true, noRelease: true,
        interruptedAgent: 'Origin agent usage limit reached after actual sidecar and comparisons; parent verified and assembled outputs' };
    await fs.writeFile(path.join(evidence, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n');
    const a = await json(path.join(root, 'docs/hardware/evidence/g3-a/coverage.json'));
    const aliases = [];
    for (const corpus of Object.keys(sidecar.artifacts).sort()) {
        const raw = await json(path.join(evidence, `results/instrumented/${corpus}/design.json`));
        for (const module of Object.keys(raw.modules).sort()) {
            for (const name of Object.keys(raw.modules[module].netnames).sort()) {
                aliases.push({ artifactSha256: sidecar.artifacts[corpus], module, name, kind: 'definition-alias' });
            }
        }
    }
    await fs.writeFile(path.join(root, 'docs/hardware/G3_COVERAGE.json'), JSON.stringify({
        schemaVersion: 1, historicalBaseline: a.historicalBaseline,
        g3A: a.executions,
        g3B: { sourcePin: sidecar.sourcePin, compilerBinarySha256: sidecar.compilerBinarySha256,
            patchSha256: sidecar.patchSha256, provider: sidecar.provider, artifacts: sidecar.artifacts,
            definitionPopulation: sidecar.coverage.leafPopulation,
            definitionPopulationHash: sidecar.coverage.leafPopulationSha256,
            knownContributorLeafDefinitions: sidecar.coverage.verifiedKnownContributorLeafDefinitions,
            completeOriginSetLeafDefinitions: 0, acceptedLinks: sidecar.links.filter(link =>
                link.status === 'verified-known-contributor' && link.target.kind === 'leaf-cell').map(link => link.id),
            partialLinks: sidecar.links.filter(link => link.status !== 'verified-known-contributor').map(link =>
                ({ id: link.id, target: link.target, gaps: link.gaps })),
            unresolved: sidecar.unresolved, productOccurrences: product,
            aliases: { definitionTotal: aliases.length, population: aliases, populationHash: hash(JSON.stringify(aliases)),
                knownOriginContributors: 0, completeOriginSets: 0,
                selection: 'All definition netname aliases in the three instrumented artifacts; none inferred from cell contact' },
            limitations: sidecar.limitations }
    }, null, 2) + '\n');
    const paths = (await fs.readdir(evidence, { recursive: true })).sort();
    const inventory = [];
    for (const relative of paths) {
        if (relative === 'INVENTORY.json') continue;
        const full = path.join(evidence, relative), stat = await fs.lstat(full);
        assert.equal(stat.isSymbolicLink(), false, `No shipped symlink: ${relative}`);
        if (stat.isFile()) {
            const bytes = await fs.readFile(full);
            inventory.push({ path: relative, sha256: hash(bytes), bytes: bytes.length });
        }
    }
    await fs.writeFile(path.join(evidence, 'INVENTORY.json'), JSON.stringify({
        schema: 'g3-origin-final-inventory-v1', excludes: ['INVENTORY.json'], files: inventory
    }, null, 2) + '\n');
    console.log(JSON.stringify({ copiedReceipts: copied.length, inventoryFiles: inventory.length,
        knownLeafDefinitions: result.knownContributorLeafDefinitions, completeOriginSets: 0,
        product: product.map(p => ({ corpus: p.corpus, total: p.coverage.total, known: p.coverage.knownContributorObjects })) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
