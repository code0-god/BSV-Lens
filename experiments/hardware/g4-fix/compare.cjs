'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRunOutput } = require('../g4/run-output');
const root = path.resolve(__dirname, '../../..');
const key = item => `${item.buildId}:${item.provider}:${(item.provider === 'bsv'
    ? item.scene.occurrencePath : item.implementationContext.occurrencePath).join('/')}`;
const membership = scene => scene.connections.map(connection => ({
    id: connection.id, bits: connection.bits || null, rawBits: connection.rawBits || null,
    members: connection.members, memberRelationIds: connection.memberRelationIds
})).sort((a, b) => a.id.localeCompare(b.id));

(async () => {
    const [beforePath, afterPath] = process.argv.slice(2);
    assert.ok(beforePath && afterPath, 'Usage: compare.cjs BEFORE.json AFTER.json');
    const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
    const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
    const old = new Map(before.results.map(item => [key(item), item]));
    assert.equal(after.results.length, old.size);
    const rows = after.results.map(item => {
        const previous = old.get(key(item));
        assert.ok(previous, `Missing baseline scene ${key(item)}`);
        assert.deepEqual(membership(item.scene), membership(previous.scene), `Canonical membership changed: ${key(item)}`);
        assert.deepEqual(item.scene.aliases, previous.scene.aliases, `Alias vectors changed: ${key(item)}`);
        const summary = metrics => ({ bounds: metrics.bounds, totalRouteLength: metrics.totalRouteLength,
            bends: metrics.bends, crossings: metrics.crossings, overlappingPairs: metrics.overlappingPairs,
            overlappingSegments: metrics.overlappingSegments });
        return { scene: key(item), canonicalMembership: 'unchanged', before: summary(previous.metrics), after: summary(item.metrics) };
    });
    const output = await createRunOutput(root, 'g4-fix-metrics-comparison');
    const result = { schema: 'g4-fix-before-after-v1', before: path.resolve(beforePath), after: path.resolve(afterPath), status: 'pass', rows };
    fs.writeFileSync(path.join(output, 'comparison.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ output, scenes: rows.length, membership: 'unchanged',
        overlapsBefore: rows.reduce((sum, item) => sum + item.before.overlappingPairs, 0),
        overlapsAfter: rows.reduce((sum, item) => sum + item.after.overlappingPairs, 0) }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
