'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Importer = require('../importer');
const ROOT = path.resolve(__dirname, '../../..');
const EVIDENCE = 'docs/hardware/evidence/toolchain';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const STATIC = new Map(['index.html', 'app.js', 'style.css', 'navigation.js', 'layout.js', 'bsv-layout.js', 'bsv-renderer.js'].map(name => [`/${name}`, path.join(__dirname, name)]));
STATIC.set('/importer.js', path.resolve(__dirname, '../importer.js'));
function readLocal(relative) {
    const full = path.resolve(ROOT, relative);
    const real = fs.realpathSync(full);
    if (real !== full || !real.startsWith(`${ROOT}${path.sep}`)) throw new Error('Source path is outside the read-only allowlist');
    if (fs.statSync(real).size > 16 * 1024 * 1024) throw new Error('Artifact/source size limit');
    return fs.readFileSync(real, 'utf8');
}
function createCatalog(read = readLocal) {
    const manifest = JSON.parse(read(`${EVIDENCE}/manifest.json`));
    const approved = new Map(manifest.files.map(file => [file.path, file.sha256]));
    const checked = relative => {
        if (!approved.has(relative)) throw new Error('File is not in evidence manifest');
        const text = read(relative);
        if (hash(text) !== approved.get(relative)) throw new Error(`Evidence hash mismatch: ${relative}`);
        return text;
    };
    const catalog = [];
    for (const key of ['A', 'B', 'C']) {
        const base = `${EVIDENCE}/${key}`;
        try {
            const recipe = JSON.parse(checked(`${base}/recipe.json`));
            const text = checked(`${base}/design.json`);
            const raw = JSON.parse(text);
            const tops = Object.entries(raw.modules).filter(([, m]) => /^0*1$/.test(m.attributes?.top)).map(([name]) => name);
            const artifact = { hash: hash(text), pathRef: `${base}/design.json` };
            const toolchain = [['bsc', 'bsc-installation-inventory.json'], ['yosys', 'reader-installation-inventory.json']].map(([name, inventory]) => {
                const inventoryPath = `${EVIDENCE}/${inventory}`;
                const inventoryText = checked(inventoryPath);
                return { name, version: checked(`${EVIDENCE}/${name}-version.txt`).trim(), identity: hash(inventoryText),
                    identityEvidence: { pathRef: inventoryPath, hash: hash(inventoryText), scope: 'recorded installation inventory including binaries and libraries' } };
            });
            const dependencyInputs = { source: recipe.source, toolInventories: toolchain.map(tool => tool.identityEvidence),
                bscDirectPackageDependencies: recipe.bscDirectPackageDependencies,
                externalRtlLibraryInputs: recipe.externalRtlLibraryInputs,
                generatedRtlInputs: manifest.files.filter(file => file.path.startsWith(`${base}/rtl/`) && file.path.endsWith('.v'))
                    .map(file => ({ path: file.path, sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path)) };
            const escape = value => value.replace(/~/g, '~0').replace(/\//g, '~1');
            const concreteParameters = Object.create(null);
            for (const [name, definition] of Object.entries(raw.modules)) {
                const modulePointer = `/modules/${escape(name)}`;
                if (definition.parameter_default_values) concreteParameters[`${modulePointer}/parameter_default_values`] = definition.parameter_default_values;
                for (const [cell, value] of Object.entries(definition.cells || {})) {
                    concreteParameters[`${modulePointer}/cells/${escape(cell)}/parameters`] = value.parameters || {};
                }
            }
            const snapshot = { artifact, stage: recipe.stage, tops, sourceInputs: [recipe.source], passSequence: recipe.passes,
                buildOptionsFingerprint: hash(JSON.stringify(recipe)), dependencyFingerprint: hash(JSON.stringify(dependencyInputs)),
                dependencyInputs, toolchain, concreteParameters,
                parameterEvidence: { artifact, convention: 'keys are exact artifact JSON pointers; values are emitted dictionaries, including empty dictionaries',
                    topOverrides: { status: 'not-supplied-by-recipe', values: null } }, status: 'ready' };
            const started = performance.now();
            const model = Importer.importYosys(text, snapshot);
            const importMs = performance.now() - started;
            const correspondence = JSON.parse(checked(`${base}/correspondence.json`));
            if (correspondence.artifactSha256 !== hash(text)) throw new Error('Correspondence artifact mismatch');
            const sourceFiles = new Map();
            for (const [relative, sha256] of approved) {
                if (relative.startsWith(`${base}/rtl/`) && relative.endsWith('.v')) sourceFiles.set(relative, { text: checked(relative), sha256 });
            }
            const bsv = read(recipe.source.path);
            if (hash(bsv) !== recipe.source.sha256) throw new Error('Compiled source hash mismatch');
            sourceFiles.set(recipe.source.path, { text: bsv, sha256: recipe.source.sha256 });
            const compilerPath = `${base}/bluetcl.json`, compilerText = checked(compilerPath);
            catalog.push({ key, label: `${tops.join(', ')} - ${key}`, status: 'ready', model, correspondence, sourceFiles, importMs,
                compilerMetadata: compilerText, compilerArtifact: { pathRef: compilerPath, hash: hash(compilerText), sourceInputs: [recipe.source] } });
        } catch (error) { catalog.push({ key, label: `Design ${key} unavailable`, status: 'failed', error: error.message }); }
    }
    return catalog;
}
function bsvArchitecture(build) {
    if (!build.architecture) {
        const Adapter = require('../bsv-architecture');
        build.architecture = Adapter.buildFromCatalog(build, { read: relative => {
            if (relative !== build.compilerArtifact.pathRef) throw new Error('Compiler metadata is not allowlisted');
            return build.compilerMetadata;
        } });
    }
    return build.architecture;
}
function bsvSourceSlice(build, entityId, index) {
    const architecture = bsvArchitecture(build);
    const ref = require('../bsv-architecture').getSourceRefs(architecture, entityId)[index];
    if (!ref) throw new Error('BSV source mapping unavailable');
    const file = build.sourceFiles.get(ref.pathRef);
    if (!file || file.sha256 !== ref.revision || hash(file.text) !== ref.revision) throw new Error('BSV source revision mismatch');
    const { start, end } = ref.range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > file.text.length) throw new Error('Invalid BSV source range');
    const text = file.text.slice(start, end);
    if (text !== ref.text || hash(text) !== ref.sha256) throw new Error('BSV source slice mismatch');
    return { role: 'bsv-source', path: ref.pathRef, hash: ref.revision, sliceHash: ref.sha256, range: ref.range,
        line1: ref.sourceRange.line + 1, column1: ref.sourceRange.column + 1,
        endLine1: ref.sourceRange.endLine + 1, endColumn1: ref.sourceRange.endColumn + 1,
        convention: 'Source Model UTF-16 offsets, half-open; displayed positions 1-based', scope: ref.role,
        relation: entityId, text, fullText: file.text, readOnly: true, snapshotId: build.model.snapshot.id };
}
function sourceCandidates(build, entityId) {
    const entity = build.model.entities[entityId];
    if (!entity) throw new Error('Unknown hardware entity');
    const result = [];
    const generated = Importer.getGeneratedEvidence(build.model, entityId);
    for (const evidence of generated.generatedRtl) {
        for (const raw of evidence.raw.split('|')) {
            const match = /^(.*):(\d+)\.(\d+)-(\d+)\.(\d+)$/.exec(raw);
            if (!match || !build.sourceFiles.has(match[1])) continue;
            result.push({ role: 'generated-rtl', path: match[1], line1: +match[2], column1: +match[3],
                endLine1: +match[4], endColumn1: +match[5], convention: 'Yosys src: 1-based ASCII columns, end exclusive',
                scope: entity.providerRefs.some(ref => `${ref.pointer}/attributes/src` === evidence.providerRefs[0].pointer)
                    ? 'object-attribute' : 'enclosing-rtl-context-not-selected-object-origin',
                relation: evidence.providerRefs[0].pointer, evidenceRefs: evidence.providerRefs });
        }
    }
    const cell = entity.kind === 'occurrence' ? build.model.cells[entity.cellId] : entity.kind === 'cell' ? entity : null;
    if (cell) {
        const owner = build.model.occurrences[cell.occurrenceId];
        const definition = build.model.definitions[owner.definitionId];
        for (const mapping of build.correspondence.mappings) {
            if (mapping.kind !== 'instance-declaration' || mapping.status !== 'verified-fixture-boundary' ||
                mapping.module !== definition.name || mapping.cell !== cell.name || !mapping.source) continue;
            const source = build.sourceFiles.get(mapping.source.path);
            if (!source || source.sha256 !== mapping.source.sha256 || source.text.split('\n')[mapping.source.line1 - 1] !== mapping.source.lineText) continue;
            result.push({ role: 'original-bsv', path: mapping.source.path, line1: mapping.source.line1,
                endLine1: mapping.source.line1, column1: null, endColumn1: null,
                convention: 'Verified compiler instance declaration; whole line; no exact source range supplied',
                relation: mapping.kind, evidenceRefs: mapping.evidence });
        }
    }
    if (entity.kind === 'port') {
        const occurrence = build.model.occurrences[entity.occurrenceId];
        const definition = build.model.definitions[occurrence.definitionId];
        for (const mapping of build.correspondence.mappings) {
            if (mapping.kind !== 'method-port' || mapping.status !== 'verified-port-contract/source-context-only' ||
                mapping.module !== definition.name || mapping.port !== entity.name ||
                JSON.stringify(mapping.bits) !== JSON.stringify(entity.rawBits) || !mapping.sourceContext) continue;
            const context = mapping.sourceContext, source = build.sourceFiles.get(context.path);
            if (!source || source.sha256 !== context.sha256 || source.text.split('\n')[context.line1 - 1] !== context.lineText) continue;
            result.push({ role: 'original-bsv-context', path: context.path, line1: context.line1, endLine1: context.line1,
                column1: null, endColumn1: null, scope: 'compiler-module-context-not-method-source-range',
                convention: 'Compiler-verified port contract; whole module-context line; exact method source range unknown',
                relation: 'verified-method-port/compiler-module-context', evidenceRefs: mapping.evidence });
        }
    }
    return result.map((candidate, index) => ({ ...candidate, index, hash: build.sourceFiles.get(candidate.path).sha256 }));
}
function sourceSlice(build, entityId, index) {
    const candidate = sourceCandidates(build, entityId)[index];
    if (!candidate) throw new Error('Source mapping unavailable');
    const file = build.sourceFiles.get(candidate.path);
    const lines = file.text.split('\n');
    if (candidate.line1 < 1 || candidate.endLine1 > lines.length || candidate.endLine1 < candidate.line1) throw new Error('Invalid evidence range');
    const selected = lines.slice(candidate.line1 - 1, candidate.endLine1);
    if (candidate.column1 !== null) {
        if (candidate.column1 < 1 || candidate.endColumn1 < 1 || candidate.column1 > selected[0].length + 1 ||
            candidate.endColumn1 > selected.at(-1).length + 1 || (selected.length === 1 && candidate.endColumn1 < candidate.column1)) throw new Error('Invalid evidence columns');
        if (selected.some(line => /[^\x00-\x7f]/.test(line))) throw new Error('Non-ASCII source columns require an explicit provider conversion');
        selected[selected.length - 1] = selected.at(-1).slice(0, candidate.endColumn1 - 1);
        selected[0] = selected[0].slice(candidate.column1 - 1);
    }
    return { ...candidate, text: selected.join('\n'), fullText: file.text, readOnly: true, hostIntegration: 'prototype-source-browser-not-vscode' };
}
function createServer(options = {}) {
    let catalog;
    try { catalog = createCatalog(); } catch (error) { catalog = ['A', 'B', 'C'].map(key => ({ key, status: 'failed', label: `Design ${key}`, error: error.message })); }
    if (options.catalog) catalog = options.catalog;
    const server = http.createServer((req, res) => {
        const host = `127.0.0.1:${server.address().port}`;
        const headers = { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
        const send = (status, body, type = 'application/json') => { res.writeHead(status, { ...headers, 'Content-Type': `${type}; charset=utf-8` }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
        if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) return send(403, { error: 'Localhost Host/Origin required' });
        if (req.method !== 'GET') return send(405, { error: 'Read-only server' });
        try {
            const url = new URL(req.url, `http://${host}`);
            if (url.pathname === '/api/builds') return send(200, catalog.map(({ key, label, status, error, model, importMs }) =>
                ({ key, label, status, error, tops: model?.snapshot.tops, stage: model?.snapshot.stage, importMs })));
            if (url.pathname.startsWith('/api/')) {
                const build = catalog.find(item => item.key === url.searchParams.get('build'));
                if (!build || build.status !== 'ready') return send(409, { error: build?.error || 'Unknown build' });
                if (url.pathname === '/api/model') return send(200, build.model);
                if (url.pathname === '/api/bsv-model') return send(200, bsvArchitecture(build));
                const entityId = url.searchParams.get('entity');
                if (['/api/bsv-context', '/api/bsv-source'].includes(url.pathname)) {
                    const architecture = bsvArchitecture(build);
                    const tables = ['occurrences', 'storage', 'boundaries', 'behaviors', 'relations'];
                    if (!tables.some(table => Object.hasOwn(architecture[table], entityId))) return send(404, { error: 'Unknown BSV entity' });
                    if (url.pathname === '/api/bsv-source') {
                        const index = Number(url.searchParams.get('index'));
                        if (!Number.isSafeInteger(index) || index < 0) return send(400, { error: 'Invalid evidence index' });
                        return send(200, bsvSourceSlice(build, entityId, index));
                    }
                    return send(200, require('../bsv-architecture').getRtlContext(architecture, entityId));
                }
                if (!Object.hasOwn(build.model.entities, entityId)) return send(404, { error: 'Unknown entity' });
                if (url.pathname === '/api/evidence') return send(200, sourceCandidates(build, entityId));
                if (url.pathname === '/api/source') {
                    const index = Number(url.searchParams.get('index'));
                    if (!Number.isSafeInteger(index) || index < 0) return send(400, { error: 'Invalid evidence index' });
                    return send(200, sourceSlice(build, entityId, index));
                }
                return send(404, { error: 'Unknown read-only API' });
            }
            const file = STATIC.get(url.pathname === '/' ? '/index.html' : url.pathname);
            if (!file || (url.search && !(url.pathname === '/' && url.search === '?mode=rtl'))) return send(404, { error: 'Not allowlisted' });
            return send(200, fs.readFileSync(file, 'utf8'), file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'text/javascript');
        } catch (error) { return send(400, { error: error.message }); }
    });
    return server;
}
if (require.main === module) {
    const port = process.env.PORT === undefined ? 4178 : Number(process.env.PORT);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    const server = createServer();
    server.listen(port, '127.0.0.1', () => console.log(`Hardware prototype http://127.0.0.1:${server.address().port}`));
}
module.exports = { createServer, createCatalog, sourceCandidates, sourceSlice, bsvArchitecture, bsvSourceSlice };
