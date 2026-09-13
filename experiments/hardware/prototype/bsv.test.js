'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createCatalog, createServer, bsvArchitecture, bsvSourceSlice } = require('./server');
const Layout = require('./bsv-layout');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

test('all-three source-owned projections preserve every local relation, identity, source range and immutable Hardware IR', () => {
    let modules = 0, storage = 0, sources = 0;
    const families = new Set();
    for (const build of createCatalog()) {
        const before = JSON.stringify(build.model), view = bsvArchitecture(build);
        assert.equal(view.snapshotId, build.model.snapshot.id);
        modules += Object.keys(view.occurrences).length; storage += Object.keys(view.storage).length;
        for (const rootId of [null, ...Object.keys(view.occurrences)]) {
            const scene = Layout.layout(view, { rootId });
            assert.deepEqual(scene, Layout.layout(view, { rootId }));
            assert.ok(scene.nodes.every(n => ['module-occurrence', 'storage'].includes(n.kind)));
            for (const node of scene.nodes) {
                const item = Layout.entity(view, node.id);
                assert.ok(item.definitionId && item.sourceEvidence.length && view.occurrences[item.ownerOccurrenceId]);
                if (node.parentId) {
                    const parent = scene.nodes.find(p => p.id === node.parentId);
                    assert.ok(node.x > parent.x && node.y > parent.y && node.x + node.width < parent.x + parent.width && node.y + node.height < parent.y + parent.height);
                }
            }
            const ownerIds = rootId ? [rootId] : view.roots;
            assert.deepEqual(scene.routes.map(r => r.id), Object.values(view.relations).filter(r => ownerIds.includes(r.ownerOccurrenceId)).map(r => r.id));
            for (const route of scene.routes) { families.add(route.kind); assert.ok(Layout.entity(view, route.from.id)); assert.ok(Layout.entity(view, route.to.id)); }
            assert.ok(scene.anchors.every(a => view.boundaries[a.id]));
            for (const anchor of scene.anchors.filter(a => a.kind === 'interface-boundary')) {
                const owner = view.occurrences[anchor.ownerId];
                assert.equal(anchor.label, owner.declaredType === 'inferred' ? owner.compilerType || view.boundaries[anchor.id].interfaceType : owner.declaredType || view.boundaries[anchor.id].interfaceType);
            }
        }
        for (const table of ['occurrences', 'storage', 'boundaries', 'behaviors', 'relations']) {
            for (const item of Object.values(view[table])) item.sourceEvidence.forEach((ref, index) => {
                const source = bsvSourceSlice(build, item.id, index), original = fs.readFileSync(source.path, 'utf8');
                assert.equal(source.hash, hash(original)); assert.equal(source.text, original.slice(ref.range.start, ref.range.end));
                assert.equal(source.sliceHash, hash(source.text)); assert.deepEqual(source.range, ref.range); sources++;
            });
        }
        assert.equal(JSON.stringify(build.model), before);
    }
    assert.equal(modules, 11); assert.equal(storage, 8); assert.ok(sources > 100);
    assert.deepEqual([...families].sort(), ['argument-flow', 'forwarding', 'invocation', 'result-flow', 'state-read', 'state-write']);
});

test('BSV HTTP source and context APIs retain allowlist, hash, selected entity and stage boundaries', async t => {
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => new Promise(r => server.close(r)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const view = await (await fetch(`${origin}/api/bsv-model?build=A`)).json();
    const relation = Object.values(view.relations).find(r => r.kind === 'state-write');
    const query = new URLSearchParams({ build: 'A', entity: relation.id, index: '0' });
    const source = await (await fetch(`${origin}/api/bsv-source?${query}`)).json();
    assert.equal(source.text, relation.sourceEvidence[0].text); assert.equal(source.snapshotId, view.snapshotId);
    const context = await (await fetch(`${origin}/api/bsv-context?${query}`)).json();
    assert.equal(context.ownerOccurrenceId, relation.ownerOccurrenceId); assert.deepEqual(context.highlightEntityIds, []);
    assert.equal((await fetch(`${origin}/api/bsv-source?build=A&entity=foreign&index=0`)).status, 404);
    assert.equal((await fetch(`${origin}/api/bsv-source?${query}`, { headers: { Origin: 'https://foreign.example' } })).status, 403);
    query.set('index', '-1'); assert.equal((await fetch(`${origin}/api/bsv-source?${query}`)).status, 400);
    assert.equal((await fetch(`${origin}/?mode=rtl`)).status, 200);
    assert.equal((await fetch(`${origin}/?path=/etc/passwd`)).status, 404);
});
