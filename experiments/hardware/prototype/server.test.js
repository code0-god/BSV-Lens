'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const { createCatalog, createServer, sourceCandidates, sourceSlice } = require('./server');
const { layout } = require('./layout');
const { createNavigation } = require('./navigation');

test('snapshot excludes unrelated logs/designs, includes installation identities, and preserves emitted parameter dictionaries', () => {
    const manifestPath = 'docs/hardware/evidence/toolchain/manifest.json';
    const read = relative => fs.readFileSync(relative, 'utf8');
    const original = createCatalog();
    const unrelated = JSON.parse(read(manifestPath));
    unrelated.files.push({ path: 'unrelated-debug.log', sha256: '0'.repeat(64), bytes: 8 });
    const withLog = createCatalog(relative => relative === manifestPath ? JSON.stringify(unrelated) : read(relative));
    assert.deepEqual(withLog.map(b => b.model.snapshot.id), original.map(b => b.model.snapshot.id));
    const changedOther = JSON.parse(read(manifestPath));
    changedOther.files.find(file => file.path.endsWith('/B/design.json')).sha256 = '0'.repeat(64);
    const withOther = createCatalog(relative => relative === manifestPath ? JSON.stringify(changedOther) : read(relative));
    assert.equal(withOther[0].model.snapshot.id, original[0].model.snapshot.id);
    assert.equal(withOther[1].status, 'failed');
    const inventory = 'docs/hardware/evidence/toolchain/bsc-installation-inventory.json';
    const alteredInventory = `${read(inventory)}\n`;
    const changedInventory = JSON.parse(read(manifestPath));
    changedInventory.files.find(file => file.path === inventory).sha256 = crypto.createHash('sha256').update(alteredInventory).digest('hex');
    const withInventory = createCatalog(relative => relative === manifestPath ? JSON.stringify(changedInventory) : relative === inventory ? alteredInventory : read(relative));
    for (let i = 0; i < original.length; i++) assert.notEqual(withInventory[i].model.snapshot.id, original[i].model.snapshot.id);
    const snapshot = original[2].model.snapshot;
    assert.equal(snapshot.parameterEvidence.topOverrides.values, null);
    const raw = original[2].model.raw;
    const unescape = value => value.replace(/~1/g, '/').replace(/~0/g, '~');
    for (const [pointer, parameters] of Object.entries(snapshot.concreteParameters)) {
        const emitted = pointer.slice(1).split('/').map(unescape).reduce((value, key) => value[key], raw);
        assert.deepEqual(parameters, emitted);
    }
    assert.ok(Object.values(snapshot.concreteParameters).some(parameters => Object.hasOwn(parameters, 'bias')));
    for (const tool of snapshot.toolchain) {
        assert.equal(tool.identity, crypto.createHash('sha256').update(read(tool.identityEvidence.pathRef)).digest('hex'));
    }
});

test('three compiled artifacts: layout is a projection, ordered formal/actual membership remains canonical', () => {
    const builds = createCatalog();
    assert.equal(builds.length, 3);
    for (const build of builds) {
        assert.equal(build.status, 'ready', build.error);
        const model = build.model, before = JSON.stringify(model);
        const nav = createNavigation(model, { mode: 'rtl' });
        for (const occurrence of Object.values(model.occurrences)) {
            nav.go(occurrence.id);
            const scene = layout(model, nav.state);
            assert.deepEqual([...scene.representedBits].sort(), occurrence.bits.filter(id => model.bits[id].endpoints.length).sort());
            for (const anchor of scene.anchors) assert.deepEqual(anchor.bits, model.entities[anchor.id].bits);
            for (const continuation of scene.continuations) {
                assert.deepEqual(continuation.bindings.map(b => b.formalBitId), model.ports[continuation.portId].bits);
                const pin = model.pins[continuation.bindings[0].pinId];
                assert.deepEqual(continuation.bindings.map(b => b.actualBitId), pin.bits);
            }
        }
        assert.equal(JSON.stringify(model), before);
    }
});

test('hashed RTL ranges equal actual file slices; parent src is explicitly context; BSV only verified sidecar declarations', () => {
    const builds = createCatalog();
    let rtl = 0, contexts = 0, bsv = 0, portContexts = 0;
    for (const build of builds) {
        for (const entity of Object.values(build.model.entities)) {
            for (const candidate of sourceCandidates(build, entity.id)) {
                const source = sourceSlice(build, entity.id, candidate.index);
                const text = fs.readFileSync(source.path, 'utf8');
                assert.equal(crypto.createHash('sha256').update(text).digest('hex'), source.hash);
                const lines = text.split('\n');
                const start = lines.slice(0, source.line1 - 1).reduce((sum, line) => sum + line.length + 1, 0) + (source.column1 === null ? 0 : source.column1 - 1);
                const end = lines.slice(0, source.endLine1 - 1).reduce((sum, line) => sum + line.length + 1, 0) + (source.endColumn1 === null ? lines[source.endLine1 - 1].length : source.endColumn1 - 1);
                assert.equal(source.text, text.slice(start, end));
                if (source.role === 'generated-rtl') { rtl++; if (source.scope !== 'object-attribute') contexts++; }
                else if (source.role === 'original-bsv-context') {
                    portContexts++; assert.equal(source.column1, null);
                    assert.equal(source.scope, 'compiler-module-context-not-method-source-range');
                    assert.equal(source.relation, 'verified-method-port/compiler-module-context');
                } else { bsv++; assert.equal(source.column1, null); assert.equal(source.relation, 'instance-declaration'); }
            }
        }
    }
    assert.ok(rtl > 0 && contexts > 0 && bsv > 0 && portContexts > 0);
});

test('localhost server rejects Host/Origin forgery, writes, arbitrary files and foreign source objects', async t => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const port = server.address().port;
    const request = (pathname, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers, method }, response => {
            let body = ''; response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
        }); req.on('error', reject); req.end();
    });
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-security-policy'], /default-src 'none'/);
    assert.equal((await request('/', { Host: 'attacker.example' })).status, 403);
    assert.equal((await request('/', { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await request('/api/model?build=A', {}, 'POST')).status, 405);
    assert.equal((await request('/../../package.json')).status, 404);
    assert.equal((await request('/api/file?build=A&path=/etc/passwd')).status, 404);
    assert.equal((await request('/api/source?build=A&entity=foreign&index=0')).status, 404);
    assert.equal((await request('/api/model?build=missing')).status, 409);
});

test('leaf and black box entry cannot create empty scenes; inspection does not add history', () => {
    const nav = createNavigation({ snapshot: { id: 'unit', stage: 'unit' }, occurrences: {
        leaf: { id: 'leaf', cells: [], parentId: null }, box: { id: 'box', cells: ['opaque'], blackbox: true, parentId: null }
    } }, { mode: 'rtl' });
    assert.equal(nav.enter('leaf'), false); assert.equal(nav.enter('box'), false);
    nav.inspect('box'); assert.equal(nav.state.selectedId, 'box');
    assert.equal(nav.history.back.length, 0); assert.equal(nav.state.rootId, null);
});
