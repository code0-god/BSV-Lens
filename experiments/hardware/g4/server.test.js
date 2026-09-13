'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('./server');

test('G4 read-only host keeps query identity and rejects foreign inputs', async t => {
    const calls = [];
    const catalog = [{
        getCatalogEntry: () => ({ buildId: 'captured', snapshotId: 'snapshot', rootInstanceId: 'root' }),
        getScene: intent => {
            calls.push(intent);
            if (intent.snapshotId !== 'snapshot') throw Object.assign(new Error('Foreign snapshot'), { code: 'SNAPSHOT_MISMATCH' });
            return { requestSnapshotId: intent.snapshotId, queryGeneration: intent.queryGeneration,
                scene: { sceneKind: 'bsv', ownerInstanceId: 'root' } };
        }
    }];
    const server = await createServer({ catalog });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const port = server.address().port;
    const request = (pathname, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers, method }, response => {
            let body = '';
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
    const scenePath = intent => `/api/scene?build=captured&intent=${encodeURIComponent(JSON.stringify(intent))}`;
    const intent = { snapshotId: 'snapshot', queryGeneration: 7, sceneKind: 'bsv', ownerInstanceId: 'root' };
    const response = await request(scenePath(intent));
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { requestSnapshotId: 'snapshot', queryGeneration: 7,
        scene: { sceneKind: 'bsv', ownerInstanceId: 'root' } });
    assert.match(response.headers['content-security-policy'], /default-src 'none'/);
    assert.doesNotMatch(response.headers['content-security-policy'], /unsafe-inline/);
    assert.equal((await request('/api/catalog')).status, 200);
    assert.equal((await request('/api/catalog', { Host: 'foreign.example' })).status, 403);
    assert.equal((await request('/api/catalog', { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await request(scenePath(intent), {}, 'POST')).status, 405);
    assert.equal((await request('/api/scene?build=missing&intent=%7B%7D')).status, 404);
    assert.equal((await request(scenePath({ ...intent, snapshotId: 'foreign' }))).status, 409);
    assert.equal((await request(scenePath({ ...intent, queryGeneration: -1 }))).status, 400);
    assert.equal((await request(scenePath({ ...intent, queryGeneration: 0.5 }))).status, 400);
    assert.equal((await request(scenePath({ ...intent, file: '/etc/passwd' }))).status, 400);
    assert.equal((await request('/api/scene?build=captured&intent=%7B%22__proto__%22:%7B%7D%7D')).status, 400);
    assert.equal((await request('/api/scene?build=captured&intent=not-json')).status, 400);
    assert.equal((await request('/api/scene?build=captured&intent=' + 'x'.repeat(17000))).status, 414);
    assert.equal((await request('/../../package.json')).status, 404);
    assert.equal((await request('/api/source?path=/etc/passwd')).status, 404);
    assert.equal(calls.length, 2, 'Rejected input must not reach the product query');
});
