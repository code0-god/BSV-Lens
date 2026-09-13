'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadCapturedCase } = require('./query');
const mapping = require('../../../src/hardware/correspondence');
const root = path.resolve(__dirname, '../../..');

async function main() {
    const output = path.join(root, 'docs/hardware/evidence/g3-a');
    const cases = [
        { corpus: 'A', occurrencePath: 'mkConnected.left', method: 'get' },
        { corpus: 'B', occurrencePath: 'mkControl', method: 'read' },
        { corpus: 'C', occurrencePath: 'mkReuse.wide', method: 'get' }
    ];
    await fs.mkdir(output, { recursive: true });
    const ledger = [];
    for (const selection of cases) {
        const { request, analysis } = await loadCapturedCase(selection.corpus);
        const query = { occurrencePath: selection.occurrencePath, method: selection.method,
            role: 'result', family: 'connectivity' };
        const result = mapping.sourceToImplementation(analysis, query);
        const binding = result.claims.find(claim => claim.relationKind === 'ordered-port-binding');
        if (!binding || result.resolution !== 'resolved') throw new Error(`Unresolved recorded corpus query: ${selection.corpus}`);
        const origin = mapping.sourceToImplementation(analysis, { ...query, family: 'origin' });
        if (origin.claims.length) throw new Error('Stock correspondence unexpectedly asserted origin');
        const receipt = {
            schema: 'g3-a-public-query-receipt-v1',
            corpus: selection.corpus,
            snapshotId: request.importResult.snapshot.id,
            implementationModelId: request.importResult.implementation.id,
            artifact: request.importResult.snapshot.artifact,
            analysisId: analysis.id,
            correspondenceId: analysis.correspondence.id,
            evidenceSet: analysis.correspondence.evidenceSet,
            providers: analysis.correspondence.providers,
            query, result, origin,
            explanation: mapping.explainMapping(analysis, binding.id),
            coverage: mapping.getCoverage(analysis)
        };
        await fs.writeFile(path.join(output, `${selection.corpus}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
        ledger.push({ corpus: selection.corpus, snapshotId: receipt.snapshotId, correspondenceId: receipt.correspondenceId,
            artifact: receipt.artifact, providers: receipt.providers, stage: receipt.coverage.stage,
            categories: receipt.coverage.categories, origin: receipt.coverage.origin });
    }
    await fs.writeFile(path.join(output, 'coverage.json'), `${JSON.stringify({
        schema: 'g3-a-corpus-coverage-v1',
        historicalBaseline: {
            corpus: 'G1-BSV preserved definition-level origin census',
            exactLeafCauses: { numerator: 0, denominator: 53 },
            exactNetnameCauses: { numerator: 0, denominator: 168 },
            storageOriginSets: { numerator: 0, denominator: 8 },
            outermostExpressionSites: { numerator: 0, denominator: 22 }
        },
        executions: ledger
    }, null, 2)}\n`);
    console.log(JSON.stringify(ledger.map(row => ({ corpus: row.corpus, snapshotId: row.snapshotId,
        categories: row.categories.map(item => ({ category: item.category, selection: item.selection,
            total: item.total, resolved: item.resolved, unsupported: item.unsupported,
            knownContributors: item.knownContributors, completeContributorSets: item.completeContributorSets })) }))));
}

main().catch(error => {
    console.error(error.code || 'INVALID_INPUT', error.message);
    process.exitCode = 1;
});
