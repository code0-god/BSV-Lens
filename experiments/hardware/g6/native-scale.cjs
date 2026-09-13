'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadNativeInput } = require('../../../src/hardware/native-input');
const { createArchitecture } = require('../../../src/hardware/architecture');
const { launchNative } = require('./native-driver.cjs');
const { createRun } = require('./run.cjs');
const { settled, chooseObject } = require('./development-smoke.cjs');
const { registerBundle, analyze } = require('./native-acceptance.cjs');
const { captureNative } = require('./native-oracle.cjs');
const BUDGETS = Object.freeze({ importMs: 30000, attachMs: 30000, sceneMs: 5000, queryMs: 5000, roundtripMs: 5000,
    cancelTargetMs: 2000, cancelDeadlineMs: 5000, hostHeapDeltaBytes: 768 * 1024 * 1024, webviewHeapBytes: 512 * 1024 * 1024 });
const NAMES = ['S-A', 'S-B', 'S-C', 'M', 'L'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const identity = file => { const bytes = fs.readFileSync(file); return { path: path.resolve(file), bytes: bytes.length, sha256: hash(bytes) }; };
const read = file => JSON.parse(fs.readFileSync(file));
const elapsedPhase = (events, first, second) => {
    const a = events.find(row => row.phase === first), b = events.find(row => row.phase === second);
    return a && b ? b.time - a.time : null;
};
async function poll(operation, accept, title, timeout = 5000) {
    const deadline = performance.now() + timeout;
    do { const result = await operation(); if (accept(result)) return result; await new Promise(resolve => setTimeout(resolve, 25)); }
    while (performance.now() < deadline);
    throw new Error(`${title} did not reach its observed completion condition`);
}
function prepare(catalog, output) {
    assert.ok(Array.isArray(catalog));
    return NAMES.map(name => {
        const item = catalog.find(row => row.name === name); assert.ok(item, `Missing ${name} scale input`);
        const directory = path.join(output, name, 'g6'), workspace = path.join(directory, 'workspace'); fs.mkdirSync(workspace, { recursive: true });
        const manifest = read(item.manifestFile); assert.deepEqual(manifest, item.options.manifest);
        const files = [...(manifest.sources || []).map(row => ({ ...row, root: item.options.sourceRoot })),
            ...[manifest.artifact, manifest.metadata, ...(manifest.generatedRtl || [])].filter(Boolean).map(row => ({ ...row, root: item.options.artifactRoot }))];
        const copies = [];
        for (const descriptor of files) {
            assert.ok(descriptor.root && !path.isAbsolute(descriptor.path) && !descriptor.path.split(/[\\/]/).includes('..'));
            const original = identity(path.join(descriptor.root, descriptor.path)), declared = item.originalInputs.find(row => row.path === original.path);
            assert.deepEqual(original, declared, 'Historical scale input changed');
            const destination = path.join(workspace, descriptor.path); fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(original.path, destination, fs.constants.COPYFILE_EXCL);
            copies.push({ original, copy: identity(destination) }); assert.equal(copies.at(-1).copy.sha256, original.sha256);
        }
        write(path.join(workspace, 'native.json'), manifest);
        return { ...item, manifest, directory, workspace, copies, originalManifest: identity(item.manifestFile),
            copiedManifest: identity(path.join(workspace, 'native.json')) };
    });
}
async function observe(frame) {
    await frame.evaluate(() => {
        const data = window.__g6Scale = { posts: [], replies: [], frames: [], running: true };
        for (const [eventName, destination] of [['bsv-vsix-post', data.posts], ['bsv-vsix-host', data.replies]]) {
            window.addEventListener(eventName, event => {
                const message = event.detail; if (message.kind === 'event') return;
                destination.push({ atMs: performance.now(), requestId: message.requestId, action: message.action,
                    generation: message.generation, status: message.status || null, error: message.error || null,
                    queryKind: message.payload?.query?.kind || message.payload?.kind || null,
                    limits: message.payload?.query?.limits || null, resultBytes: message.payload?.metrics?.resultBytes || null });
            });
        }
        let previous = null;
        const tick = at => { if (previous !== null && data.frames.length < 2400) data.frames.push(at - previous); previous = at;
            if (data.running) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
    });
}
async function heap(native, frame) {
    let cdp;
    try { cdp = await native.context.newCDPSession(frame); return { status: 'measured', method: 'Runtime.getHeapUsage',
        scope: 'V8 isolate for the actual Webview target, including observation objects; not total native memory',
        target: await cdp.send('Target.getTargetInfo'), ...await cdp.send('Runtime.getHeapUsage') }; }
    catch (error) { const memory = await frame.evaluate(() => performance.memory ? { usedSize: performance.memory.usedJSHeapSize,
        totalSize: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null);
        return { status: memory ? 'measured' : 'NOT RUN', method: 'performance.memory', scope: 'Chromium-reported JS heap; may aggregate shared contexts',
            cdpError: error.message, ...memory }; }
    finally { await cdp?.detach(); }
}
function summary(state) {
    const result = state.current.analysis?.result, labels = state.runtime.readability;
    return { snapshotId: state.current.snapshotId, ownerInstanceId: state.current.ownerInstanceId,
        occurrenceId: state.current.implementationContext.contextOccurrenceId, viewport: state.current.viewport,
        sceneNodes: state.geometry.nodes.length, sceneContacts: state.geometry.contacts.length, sceneRoutes: state.geometry.routes.length,
        actuallyVisibleObjects: state.runtime.visibleSemanticIds.length, labelCandidates: labels?.labels.length,
        labelsVisible: labels?.visibleCount, labelsHidden: labels?.hiddenCount,
        rendererSelfTiming: { labelPreparationMs: labels?.preparationMs, routingMetrics: state.geometry.metrics,
            layoutDurationMs: null, layoutDurationStatus: 'NOT EXPOSED: observed scene-to-settled timing includes layout and rendering' },
        analysis: result ? { id: result.id, queryId: result.queryId, kind: result.kind, status: result.status,
            scope: result.scope, metrics: result.metrics, limits: result.limits, objects: result.objects.length,
            relations: result.relations.length, frontier: result.frontier.length, boundaries: result.boundaries.length,
            projectionCounts: state.analysisProjection.counts } : null };
}
function designRootEntry(input, topName) {
    assert.equal(typeof topName, 'string', 'Explicit artifact top name required');
    const model = input.importResult.implementation, roots = model.roots.map(id => model.occurrences[id]).filter(root => root.name === topName);
    assert.equal(roots.length, 1, 'Declared top must identify one actual design root');
    const root = roots[0], entries = input.catalog.map(query => query.getCatalogEntry());
    const sourceRoots = input.analysis ? input.summary.roots.filter(candidate => candidate.label === topName) : [];
    if (input.analysis) assert.equal(sourceRoots.length, 1, 'Declared source top must identify one BSV root');
    const matches = entries.filter(entry => entry.snapshotId === model.snapshot.id && (input.analysis
        ? entry.rootInstanceId === sourceRoots[0].id && entry.sceneKind !== 'rtl'
        : entry.rootInstanceId === root.id && entry.entryOccurrenceId === root.id));
    assert.equal(matches.length, 1, 'Catalog must contain exactly one intended design-root entry');
    return { designRootId: root.id, path: root.path, entry: matches[0], registeredChoices: entries,
        quickPick: entries.length > 1 ? matches[0].label : undefined };
}
async function runCase(item, options) {
    const report = { name: item.name, inputKind: item.kind, shape: item.shape, status: 'running', targetMode: 'installed', checks: [],
        captures: [], queries: [], samples: [], timings: [], userVisualDesignAcceptance: 'PENDING' };
    const check = (name, actual, budget, pass) => report.checks.push({ name, actual, budget, pass });
    let native, frame, page;
    try {
        const input = await loadNativeInput({ sourceRoot: item.manifest.sources?.length ? item.workspace : undefined,
            artifactRoot: item.workspace, manifest: item.manifest });
        const model = input.importResult.implementation;
        const authority = { model, architecture: input.analysis ? createArchitecture({ importResult: input.importResult, analysis: input.analysis }) : undefined };
        report.authority = { inputIdentity: input.inputIdentity, snapshotId: model.snapshot.id,
            model: Object.fromEntries(['entities', 'cells', 'occurrences', 'ports', 'pins', 'bits', 'aliases'].map(key => [key, Object.keys(model[key]).length])) };
        assert.equal(item.manifest.artifact.manifest.tops.length, 1, 'Scale manifest must declare its intended top');
        report.entrySelection = designRootEntry(input, item.manifest.artifact.manifest.tops[0]);
        native = await launchNative({ vsix: options.vsix, observerVsix: options.observerVsix, workspace: item.workspace, output: item.directory,
            harnessFiles: [__filename, path.resolve(__dirname, '../g5-readability/oracle.cjs'), path.resolve(__dirname, '../g4-fix/oracle/geometry.cjs')] });
        report.vsixSha256 = native.receipt.vsixSha256; report.environment = native.receipt.environment;
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview()); await frame.waitForFunction(() => !!window.BsvHardwareTransport?.identity()); await observe(frame);
        const sample = async name => { const row = { name, host: await native.channel.request('observeResources'), webview: await heap(native, frame) };
            report.samples.push(row); return row; };
        await sample('before-input');
        let state = await registerBundle({ native, frame, page, needsSourceRoot: !!item.manifest.sources?.length,
            fixture: { manifest: item.manifest, manifestRelative: 'native.json', workspaceRootChoice: 'workspace',
                rootChoice: report.entrySelection.quickPick } });
        assert.equal(state.current.snapshotId, model.snapshot.id);
        assert.equal(state.current.buildId, report.entrySelection.entry.buildId);
        const resources = await sample('registered'), events = resources.host.product.sessions.flatMap(session => session.events);
        report.registration = { importMs: elapsedPhase(events, 'artifact-import', 'correspondence-attach'),
            attachAndVerificationMs: input.analysis ? elapsedPhase(events, 'correspondence-attach', 'scene-preparation') : null,
            boundary: 'Actual Host progress timestamps after input dialogs; phase intervals exclude user selection wait', events };
        for (const [field, budget] of [['importMs', BUDGETS.importMs], ['attachAndVerificationMs', BUDGETS.attachMs]]) {
            const value = report.registration[field]; if (field === 'importMs' || input.analysis) check(field, value, budget, Number.isFinite(value) && value <= budget);
        }
        if (state.current.sceneKind === 'bsv') { await frame.locator('#rtl').click(); state = await settled(frame); }
        const root = model.occurrences[state.current.implementationContext.contextOccurrenceId];
        assert.equal(root.parentId, null); assert.equal(root.id, report.entrySelection.designRootId); report.rootScene = summary(state);
        const capture = async (name, expectations) => {
            const result = await captureNative({ native, frame, page, output: item.directory, name, expectations, authority });
            report.captures.push({ name, inventory: result.inventory, verdict: result.verdict });
        };
        await capture('root-overview', { root: root.name, children: root.children.map(id => model.occurrences[id].name), fitAll: true });
        const port = root.ports.map(id => model.ports[id]).filter(row => row.direction === 'output')
            .sort((a, b) => b.bits.length - a.bits.length || a.id.localeCompare(b.id))[0]; assert.ok(port);
        assert.deepEqual(state.scene.contacts.find(row => row.id === port.id).bits, port.bits);
        await chooseObject(frame, port.id); await settled(frame);
        const positions = frame.locator('.analysis-controls select').filter({ has: frame.locator('option[value="indices"]') });
        assert.equal(await positions.count(), 1, 'Expected one actual ordered-position control');
        await positions.selectOption('indices');
        await frame.getByLabel('Zero-based positions (order and repeats kept)', { exact: true }).fill(port.bits.length > 1 ? '1, 0, 1' : '0');
        const scope = frame.locator('.analysis-controls select').filter({ has: frame.locator('option[value="design"]') });
        assert.equal(await scope.count(), 1, 'Expected one actual analysis scope control');
        await scope.selectOption('design');
        state = await analyze(frame, 'same-net');
        assert.deepEqual(state.current.analysis.result.seed.positions.map(row => row.index), port.bits.length > 1 ? [1, 0, 1] : [0]);
        report.queries.push(summary(state)); write(path.join(item.directory, 'same-net.json'), state.current.analysis);
        await frame.getByLabel('Zero-based positions (order and repeats kept)', { exact: true }).fill('0');
        state = await analyze(frame, 'dependencies', 'backward');
        const result = state.current.analysis.result; report.queries.push(summary(state)); write(path.join(item.directory, 'dependencies.json'), state.current.analysis);
        check('unchanged maxCells', result.limits.maxCells, 512, result.limits.maxCells === 512);
        check('unchanged result budget', result.limits.maxResultBytes, 4194304, result.limits.maxResultBytes === 4194304);
        check('bounded result', result.metrics.resultBytes, result.limits.maxResultBytes, result.metrics.resultBytes <= result.limits.maxResultBytes);
        if (item.name === 'M') check('M default-budget cone completes', result.status, 'complete', result.status === 'complete');
        await frame.locator('#fit-selection').click(); state = await settled(frame);
        await capture('selected-dependency', { root: false, selected: true }); await sample('after-query');
        await frame.locator('#fit').click(); await settled(frame);
        if (root.children.length) {
            const childId = root.children[0], started = performance.now(); await chooseObject(frame, childId);
            await frame.waitForFunction(id => window.bsvHardware.getState().scene?.shell.id === id, childId); state = await settled(frame);
            report.expansion = { durationMs: performance.now() - started, boundary: 'Pointer click through settled scene; includes UI automation', ...summary(state) };
            check('detail reveal', report.expansion.durationMs, BUDGETS.sceneMs, report.expansion.durationMs <= BUDGETS.sceneMs);
            await capture('child-detail', { root: model.occurrences[childId].name, detail: true });
            await frame.locator('#back').click(); state = await settled(frame); assert.equal(state.scene.shell.id, root.id);
        }
        const bounds = await frame.locator('#viewport').boundingBox(), beforeScale = state.current.viewport.scale;
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.wheel(0, 80);
        await frame.waitForFunction(scale => window.bsvHardware.getState().current.viewport.scale !== scale, beforeScale);
        await page.mouse.wheel(0, -80); await settled(frame); await sample('after-navigation');
        const observed = await frame.evaluate(() => { window.__g6Scale.running = false; return window.__g6Scale; });
        report.timings = observed.posts.map(post => { const reply = observed.replies.find(row => row.requestId === post.requestId);
            return { ...post, reply, roundtripMs: reply ? reply.atMs - post.atMs : null, includesUserDialog: post.action.startsWith('choose-') }; });
        report.rafIntervalsMs = observed.frames;
        for (const row of report.timings.filter(row => ['scene', 'analysis', 'analysis-context'].includes(row.action)))
            check(`${row.action} native roundtrip ${row.requestId}`, row.roundtripMs, BUDGETS.roundtripMs, row.roundtripMs !== null && row.roundtripMs <= BUDGETS.roundtripMs);
        const baselineHeap = report.samples[0].host.memory.heapUsed;
        for (const row of report.samples) {
            check(`${row.name} Host heap delta`, row.host.memory.heapUsed - baselineHeap, BUDGETS.hostHeapDeltaBytes, row.host.memory.heapUsed - baselineHeap <= BUDGETS.hostHeapDeltaBytes);
            check(`${row.name} Webview heap`, row.webview.usedSize ?? null, BUDGETS.webviewHeapBytes,
                Number.isFinite(row.webview.usedSize) && row.webview.usedSize <= BUDGETS.webviewHeapBytes);
        }
        const panelId = await frame.evaluate(() => window.BsvHardwareTransport.identity().panelId), closeStarted = performance.now();
        await native.channel.request('uiCommand', { command: 'workbench.action.closeActiveEditor' });
        const hardware = await poll(() => native.channel.request('observeHardware'), value => value.retired.some(row => row.protocol.panelId === panelId
            && row.state.disposed && row.state.activeOperations === 0 && !row.state.loading), 'Panel disposal');
        const retired = hardware.retired.find(row => row.protocol.panelId === panelId);
        report.disposal = { durationMs: performance.now() - closeStarted, retired, resources: await native.channel.request('observeResources') };
        check('disposed watchers/listeners', { watchers: retired.watchers, listeners: retired.listeners }, 0, retired.watchers === 0 && retired.listeners === 0);
        check('disposal target', report.disposal.durationMs, BUDGETS.cancelTargetMs, report.disposal.durationMs <= BUDGETS.cancelTargetMs);
        await native.close(); assert.equal(native.receipt.status, 'passed');
        report.status = report.checks.every(row => row.pass) && report.captures.every(row => row.verdict.status === 'pass') ? 'PASS' : 'FAIL';
    } catch (error) {
        report.status = 'FAIL'; report.failure = error.stack || String(error);
        if (native) { try { report.hardwareAtFailure = await native.channel.request('observeHardware'); await native.capture('scale-failure', page); } catch (_) {}
            await native.close('failed', error); }
    } finally {
        report.preserved = [...item.copies.flatMap(row => [row.original, row.copy]), item.originalManifest, item.copiedManifest]
            .every(before => JSON.stringify(identity(before.path)) === JSON.stringify(before));
        report.displaySupport = report.captures.length ? report.captures.every(row => row.verdict.status === 'pass') ? 'PASS' : 'FAIL' : 'NOT RUN';
        report.installedExecution = native?.receipt.status === 'passed' ? 'PASS' : 'FAIL';
        report.queryCancellation = { status: 'NOT RUN', reason: 'This lane uses UI queries and idle close; separate installed security/lifecycle lane owns active cancellation.' };
        if (!report.preserved) report.status = 'FAIL'; write(path.join(item.directory, 'native-scale.json'), report);
    }
    return report;
}
async function run({ vsix, observerVsix, scaleCatalog, output = process.env.G6_OUTPUT_DIR || createRun('native-scale'), prepareOnly = false }) {
    assert.ok(scaleCatalog && (prepareOnly || vsix && observerVsix), 'Explicit product VSIX, installed observer VSIX and scale catalog required');
    const baseline = identity(scaleCatalog), cases = prepare(read(scaleCatalog), output);
    const contract = { schema: 'g6-native-scale-v1', status: 'NOT RUN', budgets: BUDGETS, catalog: baseline,
        vsix: vsix ? identity(vsix) : null, observerVsix: observerVsix ? identity(observerVsix) : null,
        measuredScope: 'Installed native UI messages, real source/artifact registration, actual Extension Host and Webview memory; source core only supplies independent geometry membership authority.',
        limitations: ['No UI maxCells control: native runs default 512; the 16-cell result belongs to the separate core lane.',
            'M complete-cone expectation remains a failing expectation when the unchanged 4 MiB result cap limits it.',
            'RAF intervals describe JS scheduling, not physical compositor frames. Renderer self timing is separate from the DOM oracle.'],
        officialMeasurementReferences: ['https://playwright.dev/docs/api/class-browsercontext#browser-context-new-cdp-session',
            'https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage'],
        cases: cases.map(({ name, kind, shape, directory, workspace, copies, originalManifest, copiedManifest }) =>
            ({ name, kind, shape, directory, workspace, copies, originalManifest, copiedManifest })) };
    write(path.join(output, 'native-scale-contract.json'), contract);
    if (prepareOnly) return { ...contract, output, preparationStatus: 'PASS' };
    const results = [];
    for (const item of cases) { console.log(`NATIVE_SCALE ${item.name}`); results.push(await runCase(item, { vsix, observerVsix })); }
    const report = { ...contract, status: results.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL', cases: results,
        catalogPreserved: JSON.stringify(identity(scaleCatalog)) === JSON.stringify(baseline), finishedAt: new Date().toISOString() };
    if (!report.catalogPreserved) report.status = 'FAIL'; write(path.join(output, 'native-scale.json'), report); return report;
}
if (require.main === module) {
    if (process.argv.includes('--help')) console.log('Usage: native-scale.cjs PRODUCT.vsix OBSERVER.vsix SCALE-CATALOG.json\n       native-scale.cjs --prepare SCALE-CATALOG.json');
    else { const prepareOnly = process.argv[2] === '--prepare', [vsix, observerVsix, scaleCatalog] = process.argv.slice(2);
        run(prepareOnly ? { prepareOnly, scaleCatalog: process.argv[3] } : { vsix, observerVsix, scaleCatalog })
            .then(report => { console.log(JSON.stringify({ status: report.status, preparationStatus: report.preparationStatus, cases: report.cases.map(row => ({ name: row.name, status: row.status })) }));
                if (!prepareOnly && report.status !== 'PASS') process.exitCode = 1; }).catch(error => { console.error(error.stack || error); process.exitCode = 1; }); }
}
module.exports = { run, prepare, BUDGETS, summary, designRootEntry };
