'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { copyJson, DEFAULT_LIMITS, failure } = require('../../../src/hardware/json');

const root = path.resolve(__dirname, '../../..');
const staticFiles = new Map([
    ['/', path.join(__dirname, 'index.html')],
    ...['hardware-view.js', 'hardware-navigation.js', 'hardware-layout.js', 'hardware-readability.js',
        'hardware-inspector.js', 'hardware-analysis.js', 'hardware.css'].map(name => [`/${name}`, path.join(root, 'media', name)])
]);
const inputFields = new Set(['buildId', 'snapshotId', 'queryGeneration', 'sceneId', 'sceneKind',
    'rootInstanceId', 'ownerInstanceId', 'occurrencePath', 'selectedEntityId', 'selectedRelationId',
    'sourceContext', 'implementationContext', 'implementationProvider', 'viewport',
    'disclosureState', 'activePanel']);

async function createCatalog() {
    const { loadCapturedCase } = require('../g3/query');
    const { loadOriginCase } = require('../g3/origin-query');
    const { createSceneQuery } = require('../../../src/hardware/scene-query');
    const inputs = [
        { buildId: 'A', sourceFile: 'Connected.bsv' },
        { buildId: 'B', sourceFile: 'Control.bsv' },
        { buildId: 'C', sourceFile: 'Reuse.bsv' }
    ];
    return Promise.all(inputs.map(async ({ buildId, sourceFile }) => {
        const [stock, originCase] = await Promise.all([loadCapturedCase(buildId), loadOriginCase(buildId)]);
        const source = stock.request.sources.find(item => item.pathRef === `experiments/hardware/fixtures/${sourceFile}`);
        const captured = originCase.request.files.find(item =>
            item.kind === 'source' && item.captureRef === `inputs/fixtures/${sourceFile}`);
        if (!source || !captured || source.revision !== captured.contentHash) {
            throw failure('SOURCE_REVISION_MISMATCH', 'Stock and origin capture input revisions differ');
        }
        const top = stock.analysis.sourceModel.instances.find(item => item.root);
        return createSceneQuery({
            buildId, label: `${top.name} / ${buildId}`,
            importResult: stock.request.importResult, analysis: stock.analysis, originCase,
            sourceBindings: [{ sourcePathRef: source.pathRef, sourceRevision: source.revision,
                originPathRef: captured.pathRef, originRevision: captured.contentHash }]
        });
    }));
}

function parseIntent(value) {
    const intent = copyJson(JSON.parse(value), { ...DEFAULT_LIMITS, maxBytes: 16384, maxJsonDepth: 12, maxJsonNodes: 1024 });
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)
        || Object.keys(intent).some(key => !inputFields.has(key))
        || typeof intent.snapshotId !== 'string' || !intent.snapshotId
        || !Number.isSafeInteger(intent.queryGeneration) || intent.queryGeneration < 0
        || (intent.sceneKind !== undefined && !['bsv', 'rtl'].includes(intent.sceneKind))) {
        throw failure('INVALID_INPUT', 'Invalid scene intent identity');
    }
    return intent;
}

async function createServer(options = {}) {
    const catalog = options.catalog || await createCatalog();
    const server = http.createServer({ maxHeaderSize: 32768 }, async (req, res) => {
        const host = `127.0.0.1:${server.address().port}`;
        const headers = {
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Cache-Control': 'no-store'
        };
        const send = (status, body, type = 'application/json') => {
            if (res.destroyed) return;
            res.writeHead(status, { ...headers, 'Content-Type': `${type}; charset=utf-8` });
            res.end(type === 'application/json' ? JSON.stringify(body) : body);
        };
        if (req.headers.host !== host || req.headers.origin && req.headers.origin !== `http://${host}`) {
            return send(403, { error: 'Localhost Host/Origin required' });
        }
        if (req.method !== 'GET') return send(405, { error: 'Read-only server' });
        if (Buffer.byteLength(req.url) > 16384) return send(414, { error: 'Scene intent too large' });
        try {
            const url = new URL(req.url, `http://${host}`);
            if (url.pathname === '/api/catalog') return send(200, catalog.map(item => item.getCatalogEntry()));
            if (url.pathname === '/api/scene') {
                const query = catalog.find(item => item.getCatalogEntry().buildId === url.searchParams.get('build'));
                if (!query) return send(404, { error: 'Unknown registered build' });
                const intent = parseIntent(url.searchParams.get('intent'));
                if (intent.buildId && intent.buildId !== query.getCatalogEntry().buildId) {
                    return send(409, { error: 'Foreign build identity', code: 'BUILD_MISMATCH' });
                }
                return send(200, await query.getScene(intent));
            }
            if (url.pathname === '/api/analysis-context' || url.pathname === '/api/analysis' || url.pathname === '/api/analysis-reveal'
                || url.pathname === '/api/source') {
                const query = catalog.find(item => item.getCatalogEntry().buildId === url.searchParams.get('build'));
                if (!query) return send(404, { error: 'Unknown registered build' });
                if (url.pathname === '/api/analysis-context') {
                    return send(200, query.getAnalysisContext(url.searchParams.get('provider') || 'stock'));
                }
                const input = copyJson(JSON.parse(url.searchParams.get(url.pathname === '/api/source' ? 'reference' : 'query')),
                    { ...DEFAULT_LIMITS, maxBytes: 16384, maxJsonDepth: 12, maxJsonNodes: 1024 });
                if (url.pathname === '/api/source') return send(200, query.getSource(input));
                if (url.pathname === '/api/analysis-reveal') return send(200, query.revealAnalysisTarget(input));
                const controller = new AbortController();
                const disconnect = () => controller.abort();
                res.once('close', disconnect);
                try { return send(200, await query.analyze(input, { signal: controller.signal })); }
                finally { res.off('close', disconnect); }
            }
            const file = staticFiles.get(url.pathname);
            if (!file || url.search) return send(404, { error: 'Not allowlisted' });
            const text = await fs.readFile(file, 'utf8');
            return send(200, text, file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'text/javascript');
        } catch (error) {
            const status = ['SNAPSHOT_MISMATCH', 'SOURCE_REVISION_MISMATCH', 'STALE_SOURCE'].includes(error.code) ? 409 : 400;
            return send(status, { error: error.message, code: error.code || 'INVALID_INPUT' });
        }
    });
    return server;
}

if (require.main === module) {
    const port = process.env.PORT === undefined ? 4179 : Number(process.env.PORT);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    createServer().then(server => server.listen(port, '127.0.0.1', () =>
        console.log(`G4_READY http://127.0.0.1:${server.address().port}`))).catch(error => {
        console.error(error.code || 'INVALID_INPUT', error.message);
        process.exitCode = 1;
    });
}

module.exports = { createCatalog, createServer };
