'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRun } = require('./run.cjs');
const { loadNativeInput } = require('../../../src/hardware/native-input');
const { HardwareProtocol } = require('../../../src/panel/hardware-protocol');
const { createHardwareSession } = require('../../../src/panel/hardware-session');
const { inspectHardwareBuild, PROTOCOL } = require('../../../src/panel/hardware-build');
const { hash, stable, DEFAULT_LIMITS } = require('../../../src/hardware/json');
const { layout, fitViewport } = require('../../../media/hardware-layout');
const { projectAnalysis } = require('../../../media/hardware-analysis');
const ROOT = path.resolve(__dirname, '../../..');
const BUDGETS = Object.freeze({ importMs: 30000, attachMs: 30000, sceneMs: 5000, layoutMs: 5000,
    queryMs: 5000, roundtripMs: 5000, cancelTargetMs: 2000, cancelDeadlineMs: 5000, hostHeapDeltaBytes: 768 * 1024 * 1024 });
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const fileIdentity = file => ({ path: file, bytes: fs.statSync(file).size, sha256: hash(fs.readFileSync(file)) });
const modelCounts = model => Object.fromEntries(['definitions', 'occurrences', 'cells', 'ports', 'pins', 'bits', 'aliases', 'memories', 'boundaries', 'entities']
    .map(key => [key, Object.keys(model[key]).length]));

function synthetic({ groups, tiles, cells, width }) {
    function chain(count, type, leaf) {
        const vector = stage => Array.from({ length: width }, (_, bit) => 2 + stage * width + bit);
        const result = { ports: { A: { direction: 'input', bits: vector(0) }, Y: { direction: 'output', bits: vector(count) } }, cells: {}, netnames: {} };
        for (let i = 0; i <= count; i++) result.netnames[`signal_${i}`] = { bits: vector(i) };
        for (let i = 0; i < count; i++) result.cells[`${leaf ? 'add' : type.toLowerCase()}_${String(i).padStart(3, '0')}`] = {
            type, connections: { A: vector(i), ...(leaf ? { B: Array(width).fill('0') } : {}), Y: vector(i + 1) },
            port_directions: { A: 'input', ...(leaf ? { B: 'input' } : {}), Y: 'output' }, attributes: {},
            parameters: leaf ? { A_WIDTH: width, B_WIDTH: width, Y_WIDTH: width, A_SIGNED: 0, B_SIGNED: 0 } : {} };
        return result;
    }
    return { creator: 'G6 synthetic resource stress; no compiler or origin evidence', modules: {
        StressRoot: chain(groups, 'Group', false), Group: chain(tiles, 'Tile', false), Tile: chain(cells, '$add', true) } };
}
function prepareInputs(output, root = ROOT) {
    const inputs = path.join(output, 'inputs'); fs.mkdirSync(inputs);
    const cases = [];
    for (const key of ['A', 'B', 'C']) {
        const base = `docs/hardware/evidence/toolchain/${key}`, recipe = JSON.parse(fs.readFileSync(path.join(root, base, 'recipe.json')));
        const descriptor = file => ({ path: file, pathRef: file, contentHash: hash(fs.readFileSync(path.join(root, file))) });
        const source = descriptor(recipe.source.path), metadata = descriptor(`${base}/bluetcl.json`);
        const sourceInputs = [{ pathRef: source.pathRef, contentHash: source.contentHash }];
        const manifest = { version: 1, label: `S ${key} actual captured input`, sources: [source],
            artifact: { ...descriptor(`${base}/design.json`), manifest: { stage: recipe.stage,
                tops: [JSON.parse(fs.readFileSync(path.join(root, metadata.path))).top], sourceInputs: sourceInputs.map(value => ({ ...value, role: 'source' })) } },
            metadata: { ...metadata, provider: 'stock-bluetcl-v1', sourceInputs },
            generatedRtl: fs.readdirSync(path.join(root, base, 'rtl')).filter(name => name.endsWith('.v')).sort().map(name => descriptor(`${base}/rtl/${name}`)) };
        const file = path.join(inputs, `S-${key}.native.json`); write(file, manifest);
        cases.push({ name: `S-${key}`, kind: 'actual-captured-compiler', manifestFile: file,
            options: { sourceRoot: root, artifactRoot: root, manifest }, originalInputs: [source, manifest.artifact, metadata, ...manifest.generatedRtl].map(row => fileIdentity(path.join(root, row.path))) });
    }
    for (const [name, shape] of [['M', { groups: 2, tiles: 4, cells: 32, width: 8 }], ['L', { groups: 8, tiles: 8, cells: 128, width: 1 }],
        ['positive-control', { groups: 1, tiles: 1, cells: 24, width: 1 }]]) {
        const artifact = path.join(inputs, `${name}.json`); write(artifact, synthetic(shape));
        const manifest = { version: 1, label: `${name} synthetic stress; no compiler/source correspondence`, sources: [],
            artifact: { path: `${name}.json`, contentHash: hash(fs.readFileSync(artifact)), manifest: { tops: ['StressRoot'] } } };
        const file = path.join(inputs, `${name}.native.json`); write(file, manifest);
        cases.push({ name, kind: 'synthetic-resource-only', shape, manifestFile: file,
            options: { artifactRoot: inputs, manifest }, originalInputs: [fileIdentity(artifact)] });
    }
    write(path.join(inputs, 'catalog.json'), cases); return cases;
}
async function channel(options, build) {
    let session, sequence = 0, hook = null;
    const responses = new Map(), events = [], diagnostics = [], start = performance.now();
    const protocol = new HardwareProtocol({ build, send: response => {
        if (response.kind === 'response') responses.set(response.requestId, response);
        else events.push({ elapsedMs: performance.now() - start, ...response });
    }, dispatch: (...args) => session.dispatch(...args), welcome: () => ({ catalog: session.getCatalog() }) });
    session = createHardwareSession({ protocol, chooseInput: async () => options,
        selectBuild: entries => { assert.equal(entries.length, 1, 'Scale input requires its one explicit top'); return entries[0].buildId; },
        openSource: async () => { throw new Error('Editor is outside this Node scale lane'); },
        exportSvg: async () => { throw new Error('Export is outside this Node scale lane'); }, saveState: async () => {},
        onDiagnostic: event => { const row = { ...event, elapsedMsObserved: performance.now() - start }; diagnostics.push(row); hook?.(row); } });
    const envelope = (action, payload, snapshotId, requestId) => ({ ...protocol.identity(), requestId, snapshotId, action, payload });
    await protocol.receive(envelope('hello', { expectedBuildId: build.buildId, expectedProtocol: PROTOCOL }, null, 'hello'));
    async function request(action, payload = {}, control = {}) {
        const requestId = `scale-${++sequence}`, began = performance.now();
        const snapshotId = session.getInput()?.importResult?.snapshot.id ?? null;
        let cancellation = null;
        hook = control.cancel ? event => {
            if (event.action !== 'analysis' || event.phase !== 'ready' || cancellation) return;
            const cancelStarted = performance.now();
            cancellation = { trigger: 'actual-query-worker-ready', startedAtMs: cancelStarted };
            protocol.receive(envelope('cancel', { targetRequestId: requestId }, snapshotId, `cancel-${sequence}`));
        } : null;
        await protocol.receive(envelope(action, payload, snapshotId, requestId)); hook = null;
        const response = responses.get(requestId); responses.delete(requestId);
        assert.ok(response, `Native protocol response missing: ${action}`);
        return { response, elapsedMs: performance.now() - began,
            cancellation: cancellation ? { trigger: cancellation.trigger, settlementMs: performance.now() - cancellation.startedAtMs } : null };
    }
    return { session, protocol, request, events, diagnostics,
        async close() { const began = performance.now(); await Promise.all([protocol.dispose(), session.dispose()]);
            return { elapsedMs: performance.now() - began, pendingRequests: protocol.pending.size,
                seenRequests: protocol.seen.size, session: session.getDiagnostics() }; } };
}
function phaseTime(events, first, second) {
    const start = events.find(row => row.phase === first), end = events.find(row => row.phase === second);
    return start && end ? end.elapsedMsObserved - start.elapsedMsObserved : null;
}
async function measureCase(item, output, build) {
    const directory = path.join(output, item.name); fs.mkdirSync(directory); global.gc?.();
    const memoryBefore = process.memoryUsage(), wire = await channel(item.options, build);
    const result = { name: item.name, kind: item.kind, shape: item.shape || null, host: 'Node harness; not Extension Host', checks: [] };
    const check = (name, pass, actual, budget) => { result.checks.push({ name, pass, actual, budget }); };
    try {
        const registration = await wire.request('choose-manifest'); assert.equal(registration.response.status, 'ok');
        const input = wire.session.getInput(), entry = wire.session.getCatalog()[0], model = input.importResult.implementation;
        result.inputIdentity = input.inputIdentity; result.snapshotId = model.snapshot.id; result.model = modelCounts(model);
        result.registration = { protocolRoundtripMs: registration.elapsedMs, summary: input.summary,
            importMs: phaseTime(wire.diagnostics, 'artifact-import', 'correspondence-attach'),
            attachAndEvidenceVerificationMs: input.analysis ? phaseTime(wire.diagnostics, 'correspondence-attach', 'scene-preparation') : null };
        check('artifact import', result.registration.importMs <= BUDGETS.importMs, result.registration.importMs, BUDGETS.importMs);
        if (input.analysis) check('correspondence attach', result.registration.attachAndEvidenceVerificationMs <= BUDGETS.attachMs,
            result.registration.attachAndEvidenceVerificationMs, BUDGETS.attachMs);
        const intent = { buildId: entry.buildId, snapshotId: entry.snapshotId, queryGeneration: 1, rootInstanceId: entry.rootInstanceId,
            ownerInstanceId: entry.sceneKind === 'rtl' ? null : entry.rootInstanceId, sceneKind: 'rtl', implementationProvider: 'stock' };
        const measured = await wire.request('scene', { buildId: entry.buildId, intent }); assert.equal(measured.response.status, 'ok');
        const scene = measured.response.payload.scene; write(path.join(directory, 'scene.json'), scene);
        const layoutStarted = performance.now(), geometry = layout(scene, { width: 1140, height: 677 });
        result.scene = { protocolRoundtripMs: measured.elapsedMs, layoutMs: performance.now() - layoutStarted, viewport: { width: 1140, height: 677 },
            ownerInstanceId: scene.ownerInstanceId, occurrenceId: scene.implementationContext.contextOccurrenceId,
            nodes: geometry.nodes.length, contacts: geometry.contacts.length, routes: geometry.routes.length, labelCandidates: geometry.labels.length,
            fit: fitViewport(geometry, { width: 1140, height: 677 }), bounds: geometry.bounds, routingMetrics: geometry.metrics || null,
            labelPreparation: 'NOT RUN: requires actual browser font metrics', actualDisplayedObjects: 'NOT RUN: no Webview in this lane' };
        check('scene roundtrip', measured.elapsedMs <= BUDGETS.sceneMs, measured.elapsedMs, BUDGETS.sceneMs);
        check('layout', result.scene.layoutMs <= BUDGETS.layoutMs, result.scene.layoutMs, BUDGETS.layoutMs);
        write(path.join(directory, 'geometry.json'), geometry);
        const contextMessage = await wire.request('analysis-context', { buildId: entry.buildId, provider: 'stock' });
        assert.equal(contextMessage.response.status, 'ok'); const context = contextMessage.response.payload;
        const occurrence = model.occurrences[scene.implementationContext.contextOccurrenceId];
        const seed = occurrence.ports.map(id => model.ports[id]).filter(port => port.direction === 'output')
            .sort((a, b) => b.bits.length - a.bits.length || a.id.localeCompare(b.id))[0];
        assert.ok(seed, 'Output probe absent');
        const common = { analysisId: context.analysisId, snapshotId: context.snapshotId, implementationProvider: 'stock',
            ownerInstanceId: scene.ownerInstanceId, implementationOccurrenceId: occurrence.id, queryGeneration: 2,
            scope: { kind: 'design', rootOccurrenceId: scene.implementationContext.rootOccurrenceId }, seed: { entityId: seed.id, indices: [0] } };
        result.probePolicy = 'Largest output vector; one selected bit for dependency, repeated ordered positions for same-net. Explicit whole-design scope.';
        result.queries = [];
        for (const [name, addition] of [['same-net', { kind: 'same-net', seed: { entityId: seed.id, indices: seed.bits.length > 1 ? [1, 0, 1] : [0] } }],
            ['dependencies-16', { kind: 'dependencies', direction: 'backward', semanticsProfile: 'yosys-0.68-structural-v1', limits: { maxCells: 16 } }],
            ['dependencies-512', { kind: 'dependencies', direction: 'backward', semanticsProfile: 'yosys-0.68-structural-v1', limits: { maxCells: 512 } }]]) {
            const query = { ...common, ...addition }, started = await wire.request('analysis', { buildId: entry.buildId, query });
            assert.equal(started.response.status, 'ok', JSON.stringify(started.response.error)); const answer = started.response.payload;
            const projectionStarted = performance.now(), projection = projectAnalysis(scene, answer), projectionMs = performance.now() - projectionStarted;
            const row = { name, query, id: answer.id, status: answer.status, protocolRoundtripMs: started.elapsedMs,
                metrics: answer.metrics, objects: answer.objects.length, relations: answer.relations.length, boundaries: answer.boundaries.length,
                frontier: answer.frontier.length, reasons: [...new Set(answer.frontier.map(value => value.reason))], stopReasons: answer.limits.stopReasons,
                presentationProjection: { counts: projection.counts, preparationMs: projectionMs, meaning: 'Canonical scene membership only; no DOM visibility claim' } };
            result.queries.push(row); write(path.join(directory, `${name}.json`), { query, result: answer });
            check(`${name} query roundtrip`, started.elapsedMs <= BUDGETS.queryMs, started.elapsedMs, BUDGETS.queryMs);
            check(`${name} preserved result budget`, answer.metrics.resultBytes <= answer.limits.maxResultBytes, answer.metrics.resultBytes, answer.limits.maxResultBytes);
            if (name !== 'same-net') check(`${name} cell budget`, answer.metrics.visitedCells <= query.limits.maxCells, answer.metrics.visitedCells, query.limits.maxCells);
            if (item.kind === 'synthetic-resource-only' && name === 'dependencies-16') {
                check(`${name} explicit resource frontier`, answer.status === 'partial' && answer.frontier.some(value => value.reason === 'resource-limit'),
                    { status: answer.status, stopReasons: answer.limits.stopReasons }, 'partial with actual limiting budget');
            }
        }
        if (item.name === 'M') check('M default-budget cone completes', result.queries[2].status === 'complete', result.queries[2].status, 'complete');
        if (item.name === 'positive-control') check('Scalar positive-control cone completes', result.queries[2].status === 'complete', result.queries[2].status, 'complete');
        if (item.name === 'L') {
            const current = wire.session.getCurrent(), snapshot = wire.session.getInput();
            const cancelled = await wire.request('analysis', { buildId: entry.buildId, query: { ...common, kind: 'dependencies',
                direction: 'backward', semanticsProfile: 'yosys-0.68-structural-v1' } }, { cancel: true });
            assert.equal(cancelled.response.status, 'cancelled'); assert.ok(cancelled.cancellation);
            assert.equal(wire.session.getInput(), snapshot); assert.equal(wire.session.getCurrent(), current);
            result.queryCancellation = { ...cancelled.cancellation, response: cancelled.response,
                exited: wire.diagnostics.some(event => event.action === 'analysis' && event.phase === 'exited' && event.cancelled), preserved: true };
            check('query cancellation target', cancelled.cancellation.settlementMs <= BUDGETS.cancelTargetMs, cancelled.cancellation.settlementMs, BUDGETS.cancelTargetMs);
        }
        result.memory = { before: memoryBefore, afterOperations: process.memoryUsage(), meaning: 'Node process samples, includes retained harness responses; not Extension Host/Webview' };
        result.memory.heapDeltaBytes = result.memory.afterOperations.heapUsed - memoryBefore.heapUsed;
        check('Node heap delta', result.memory.heapDeltaBytes <= BUDGETS.hostHeapDeltaBytes, result.memory.heapDeltaBytes, BUDGETS.hostHeapDeltaBytes);
    } catch (error) { result.failure = { code: error.code || null, message: error.message, stack: error.stack }; }
    finally {
        result.disposal = await wire.close(); check('disposed resource cleanup', result.disposal.pendingRequests === 0 && result.disposal.seenRequests === 0
            && result.disposal.session.activeOperations === 0 && !result.disposal.session.loading, result.disposal.session.activeOperations, 0);
        const workers = new Set();
        for (const event of wire.diagnostics) if (event.threadId != null) {
            if (event.phase === 'exited') workers.delete(event.threadId); else workers.add(event.threadId);
        }
        result.disposal.workersAwaitingExit = [...workers]; check('actual worker exits', workers.size === 0, workers.size, 0);
        check('disposal target', result.disposal.elapsedMs <= BUDGETS.cancelTargetMs, result.disposal.elapsedMs, BUDGETS.cancelTargetMs);
        result.events = wire.events; result.diagnostics = wire.diagnostics;
        result.originalInputs = item.originalInputs.map(before => ({ before, after: fileIdentity(before.path) }));
        assert.ok(result.originalInputs.every(row => stable(row.before) === stable(row.after)), 'Original scale inputs changed');
        result.status = !result.failure && result.checks.every(row => row.pass) ? 'PASS' : 'FAIL'; write(path.join(directory, 'receipt.json'), result);
    }
    return result;
}
async function importCancellation(item) {
    const controller = new AbortController(), events = []; let abortTime = null, error = null;
    try { await loadNativeInput({ ...item.options, signal: controller.signal, onProgress: event => {
        events.push({ ...event, atMs: performance.now() });
        if (event.phase === 'importing') { abortTime = performance.now(); controller.abort(); }
    } }); } catch (cause) { error = { code: cause.code, message: cause.message }; }
    const settlementMs = abortTime === null ? null : performance.now() - abortTime;
    return { trigger: 'actual-import-worker-importing', error, settlementMs, events,
        status: error?.code === 'CANCELLED' && events.some(event => event.phase === 'exited' && event.cancelled)
            && settlementMs !== null && settlementMs <= BUDGETS.cancelTargetMs ? 'PASS' : 'FAIL' };
}
async function runScale({ output = createRun('scale'), root = ROOT } = {}) {
    assert.equal(path.basename(output), 'g6'); fs.mkdirSync(output, { recursive: true });
    const build = inspectHardwareBuild(root), cases = prepareInputs(output, root);
    const receipt = { schema: 'g6-scale-core-v1', status: 'RUNNING', startedAt: new Date().toISOString(), output, budgets: BUDGETS,
        environment: { node: process.version, platform: process.platform, arch: process.arch, os: os.release(), gcExposed: typeof global.gc === 'function' },
        execution: 'Actual native input/session/protocol classes and core workers in Node; no Extension Host, Webview or compiler execution',
        runtimeBefore: build, inputCatalog: path.join(output, 'inputs/catalog.json'), cases: [] };
    for (const item of cases) { console.log(`G6_SCALE ${item.name}`); receipt.cases.push(await measureCase(item, output, build)); }
    receipt.importCancellation = await importCancellation(cases.find(item => item.name === 'L'));
    const oversized = path.join(output, 'inputs/oversized-negative.json'); fs.writeFileSync(oversized, ' '.repeat(DEFAULT_LIMITS.maxBytes + 1), { flag: 'wx' });
    try { await loadNativeInput({ artifactRoot: path.dirname(oversized), artifactPath: path.basename(oversized) }); receipt.oversize = { status: 'FAIL', reason: 'oversized artifact accepted' }; }
    catch (error) { receipt.oversize = { status: error.code === 'LIMIT_EXCEEDED' ? 'PASS' : 'FAIL', expected: 'LIMIT_EXCEEDED', actual: error.code, input: fileIdentity(oversized) }; }
    receipt.runtimeAfter = inspectHardwareBuild(root); receipt.runtimeUnchanged = stable(receipt.runtimeBefore) === stable(receipt.runtimeAfter);
    receipt.status = receipt.cases.every(item => item.status === 'PASS') && receipt.importCancellation.status === 'PASS' && receipt.oversize.status === 'PASS' ? 'PASS' : 'FAIL';
    receipt.nativeExtensionHost = 'NOT RUN'; receipt.nativeWebview = 'NOT RUN'; receipt.finishedAt = new Date().toISOString();
    write(path.join(output, 'scale.json'), receipt); console.log(`G6_SCALE_RECEIPT ${path.join(output, 'scale.json')}`); return receipt;
}
if (require.main === module) runScale({ output: process.env.G6_OUTPUT_DIR || createRun('scale') })
    .then(result => { process.exitCode = result.status === 'PASS' ? 0 : 1; }).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { synthetic, prepareInputs, runScale, BUDGETS };
