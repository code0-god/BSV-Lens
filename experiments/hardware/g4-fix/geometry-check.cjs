"use strict";

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(process.env.G4_REVIEW_ROOT || path.join(__dirname, '../../..'));
const { validateGeometry, validateMembership, selectionIdentity, stable, EPS } = require('./oracle/geometry.cjs');
const { createCatalog } = require(path.join(root, 'experiments/hardware/g4/server.js'));
const { loadCapturedCase } = require(path.join(root, 'experiments/hardware/g3/query.js'));
const { loadOriginCase } = require(path.join(root, 'experiments/hardware/g3/origin-query.js'));
const { createArchitecture } = require(path.join(root, 'src/hardware/architecture.js'));
const { layout, fitViewport } = require(path.join(root, 'media/hardware-layout.js'));
const { createRunOutput } = require('../g4/run-output');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fingerprint = () => Object.fromEntries(['src/hardware/scene.js', 'src/hardware/scene-summary.js', 'media/hardware-layout.js',
    'experiments/hardware/g4-fix/oracle/geometry.cjs', 'experiments/hardware/g4-fix/geometry-check.cjs']
    .map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
const sizes = [{ width: 1100, height: 650 }, { width: 640, height: 800 }];

async function loadCorpus() {
    const [catalog, authority] = await Promise.all([createCatalog(), Promise.all(['A', 'B', 'C'].map(async buildId => {
        const [stock, origin] = await Promise.all([loadCapturedCase(buildId), loadOriginCase(buildId)]);
        return [buildId, { models: { stock: stock.request.importResult.implementation, instrumented: origin.request.importResult.implementation },
            architecture: createArchitecture({ importResult: stock.request.importResult, analysis: stock.analysis }) }];
    }))]);
    return { catalog, authority: new Map(authority) };
}
function sceneRequests(query, authority) {
    const entry = query.getCatalogEntry(), requests = [];
    const base = { buildId: entry.buildId, snapshotId: entry.snapshotId, rootInstanceId: entry.rootInstanceId, ownerInstanceId: entry.rootInstanceId };
    for (const provider of ['stock', 'instrumented']) {
        const model = authority.models[provider];
        // Enumerate real imported occurrences, not source child names or inferred RTL wrappers.
        const queue = [...model.roots];
        while (queue.length) {
            const id = queue.shift(), occurrence = model.occurrences[id];
            const intent = { ...base, sceneKind: 'rtl', implementationProvider: provider,
                implementationContext: { snapshotId: model.snapshot.id, provider, contextOccurrenceId: id } };
            requests.push({ provider, intent, expectedShellId: id });
            queue.push(...occurrence.children.filter(id => !model.occurrences[id].blackbox && model.occurrences[id].cells.length));
        }
    }
    const queue = [...authority.architecture.roots];
    while (queue.length) {
        const id = queue.shift();
        requests.push({ provider: 'bsv', expectedShellId: id, intent: { ...base, sceneKind: 'bsv', rootInstanceId: id, ownerInstanceId: id } });
        queue.push(...authority.architecture.occurrences[id].children);
    }
    return requests;
}
function fitFindings(geometry, size) {
    const view = fitViewport(geometry, size), b = geometry.bounds;
    const extents = { left: b.x * view.scale + view.x, top: b.y * view.scale + view.y,
        right: (b.x + b.width) * view.scale + view.x, bottom: (b.y + b.height) * view.scale + view.y };
    const valid = [view.x, view.y, view.scale, ...Object.values(extents)].every(Number.isFinite) && view.scale > 0
        && extents.left >= -EPS && extents.top >= -EPS && extents.right <= size.width + EPS && extents.bottom <= size.height + EPS;
    return { view, extents, findings: valid ? [] : [{ code: 'G10', kind: 'fit-clipping', size, view, extents }] };
}
async function runCorpus({ beforePath = null } = {}) {
    const loadedFingerprint = fingerprint(), { catalog, authority } = await loadCorpus();
    const results = [], corpusFindings = [];
    let generation = 1, rtl = 0, bsv = 0;
    if (beforePath) {
        const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
        for (const item of before.results) {
            const facts = authority.get(item.buildId), membership = validateMembership(item.scene, { model: facts.models[item.provider], architecture: facts.architecture });
            const geometry = validateGeometry(item.scene, item.geometry);
            const findings = [...membership.findings, ...geometry.findings];
            results.push({ buildId: item.buildId, provider: item.provider, shellId: item.scene.shell.id,
                occurrencePath: item.scene.implementationContext?.occurrencePath, size: sizes[0], scene: item.scene, geometry: item.geometry,
                valid: !findings.length, findings, metrics: geometry.metrics, previousMetrics: item.metrics });
            item.provider === 'bsv' ? bsv++ : rtl++;
        }
    } else for (const query of catalog) {
        const entry = query.getCatalogEntry(), facts = authority.get(entry.buildId);
        for (const request of sceneRequests(query, facts)) {
            request.provider === 'bsv' ? bsv++ : rtl++;
            const intent = { ...request.intent, queryGeneration: generation++ };
            const scene = query.getScene(intent).scene, membership = validateMembership(scene, { model: facts.models[request.provider], architecture: facts.architecture });
            const sceneFindings = [...membership.findings];
            if (scene.shell.id !== request.expectedShellId) sceneFindings.push({ code: 'R02', kind: 'wrong-actual-occurrence', expected: request.expectedShellId, actual: scene.shell.id });
            // Every selectable net is re-queried: highlights and inspector state cannot regroup it.
            for (const c of scene.connections) {
                const selected = query.getScene({ ...intent, queryGeneration: generation++, selectedRelationId: c.id }).scene;
                if (selectionIdentity(scene) !== selectionIdentity(selected)) sceneFindings.push({ code: 'G11', kind: 'selection-membership-change', connectionId: c.id });
            }
            for (const size of sizes) {
                const result = { buildId: entry.buildId, provider: request.provider, shellId: scene.shell.id,
                    occurrencePath: scene.implementationContext?.occurrencePath, sourcePath: scene.occurrencePath, size, scene,
                    findings: [...sceneFindings] };
                const immutable = stable(scene);
                try {
                    const geometry = layout(scene, size), report = validateGeometry(scene, geometry), fit = fitFindings(geometry, size);
                    result.geometry = geometry; result.metrics = report.metrics; result.fit = fit;
                    result.findings.push(...report.findings, ...fit.findings);
                    if (stable(layout(scene, size)) !== stable(geometry)) result.findings.push({ code: 'R11', kind: 'nondeterministic-layout' });
                    // Exercise actual selection -> layout, not merely the scene fingerprint.
                    if (scene.connections.length) {
                        const selected = query.getScene({ ...intent, queryGeneration: generation++, selectedRelationId: scene.connections[0].id }).scene;
                        const selectedGeometry = layout(selected, size);
                        if (stable(selectedGeometry) !== stable(geometry)) result.findings.push({ code: 'G11', kind: 'selection-changed-final-geometry' });
                    }
                } catch (error) {
                    result.findings.push({ code: 'R02', kind: 'actual-layout-failed', errorCode: error.code || null,
                        message: error.message, connectionId: error.connectionId || null, budget: error.budget || null, counts: error.counts || null });
                }
                if (stable(scene) !== immutable) result.findings.push({ code: 'G11', kind: 'layout-mutated-input' });
                result.valid = !result.findings.length; results.push(result);
            }
        }
    }
    if (rtl !== 18 || bsv !== 11) corpusFindings.push({ code: 'R02', kind: 'incomplete-real-corpus', expected: { rtl: 18, bsv: 11 }, actual: { rtl, bsv } });
    const finalFingerprint = fingerprint();
    return { schema: 'g4-independent-geometry-oracle-v1', epsilon: EPS, beforePath, uniqueScenes: { rtl, bsv },
        valid: !corpusFindings.length && results.every(r => r.valid), corpusFindings, loadedFingerprint, finalFingerprint,
        concurrentRuntimeEdits: stable(loadedFingerprint) !== stable(finalFingerprint), results };
}
async function main() {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--before')) throw new Error('Usage: geometry-check.cjs [--before product-probe.json]');
    const beforePath = args[0] === '--before' ? path.resolve(args[1]) : null;
    const output = await createRunOutput(root, beforePath ? 'g4-fix-geometry-oracle-before' : 'g4-fix-geometry-oracle-corpus');
    const report = await runCorpus({ beforePath });
    const file = path.join(output, 'geometry-oracle.json');
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ output: file, valid: report.valid, uniqueScenes: report.uniqueScenes,
        concurrentRuntimeEdits: report.concurrentRuntimeEdits, corpusFindings: report.corpusFindings,
        results: report.results.map(r => ({ buildId: r.buildId, provider: r.provider, path: r.occurrencePath, size: r.size, valid: r.valid,
            metrics: r.metrics, findingCount: r.findings.length, examples: r.findings.slice(0, 2) })) }, null, 2));
    process.exitCode = report.valid ? 0 : 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { loadCorpus, sceneRequests, runCorpus, fitFindings };
