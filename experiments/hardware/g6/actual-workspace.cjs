'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadNativeInput } = require('../../../src/hardware/native-input');
const { createArchitecture } = require('../../../src/hardware/architecture');
const { workspaceInventory } = require('./live-compiler.cjs');
const { launchNative } = require('./native-driver.cjs');
const { createRun } = require('./run.cjs');
const { settled, chooseObject } = require('./development-smoke.cjs');
const { enter, analyze, sourceReveal, identity } = require('./native-acceptance.cjs');
const { captureNative } = require('./native-oracle.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const position = (text, offset) => { const lines = text.slice(0, offset).split('\n'); return { line: lines.length - 1, character: lines.at(-1).length }; };
function selectedOffset(state, canvas) {
    const node = state.geometry.nodes.find(item => item.id === state.current.selectedEntityId); assert.ok(node);
    const { x, y, scale } = state.current.viewport;
    return { x: x + (node.x + node.width / 2) * scale - canvas.width / 2,
        y: y + (node.y + node.height / 2) * scale - canvas.height / 2 };
}
async function title(page, text) { await page.locator('.quick-input-title').filter({ hasText: text }).waitFor({ state: 'visible', timeout: 60000 }); }
async function controls(frame) { if (!await frame.locator('#native-inputs').evaluate(node => node.open)) await frame.locator('#native-inputs > summary').click(); }
async function closeControls(frame) { if (await frame.locator('#native-inputs').evaluate(node => node.open)) await frame.locator('#native-inputs > summary').click(); }
async function contextAndPersistence(frame) {
    return frame.evaluate(() => (window.__bsvVsixSmoke?.posts || []).filter(request => ['analysis-context', 'persist'].includes(request.action)).map(request => {
        const response = window.__bsvVsixSmoke.host.find(row => row.requestId === request.requestId && row.sessionId === request.sessionId && row.kind === 'response');
        const view = request.payload.state?.view;
        return { action: request.action, requestId: request.requestId, buildId: request.payload.buildId || view?.buildId,
            provider: request.payload.provider, selectedEntityId: view?.selectedEntityId,
            queryKind: view?.query?.kind,
            sourceContext: view ? view.sourceContext === null ? 'null' : view.sourceContext === undefined ? 'absent' : 'present' : undefined,
            status: response?.status || 'pending', code: response?.error?.code || null };
    }));
}

async function run({ vsix, observerVsix, workspace, mode, manifestPath, rtlPath, output = process.env.G6_OUTPUT_DIR || createRun('actual-workspace') }) {
    assert.ok(vsix && observerVsix && workspace && ['source-only', 'live-artifact'].includes(mode));
    assert.ok(mode !== 'live-artifact' || manifestPath, 'Live artifact requires its explicit manifest');
    assert.ok(mode !== 'live-artifact' || typeof rtlPath === 'string' && rtlPath.includes('/'), 'Live artifact requires an explicit retained RTL path');
    workspace = fs.realpathSync(workspace);
    const sourceManifest = mode === 'source-only' && Boolean(manifestPath);
    const sourceRoot = path.join(workspace, mode === 'source-only' && !sourceManifest ? 'hw/bsv/src' : 'hw/bsv');
    const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath)) : { version: 1 };
    assert.ok(!sourceManifest || !manifest.artifact, 'Explicit source-only manifest must not contain an artifact');
    const artifactRoot = manifestPath ? path.dirname(fs.realpathSync(manifestPath)) : undefined;
    const inputFolderName = sourceManifest ? 'G6 source bundle' : 'G6 live artifact';
    const workspaceFile = artifactRoot ? path.join(output, 'actual.code-workspace') : undefined;
    if (workspaceFile) write(output, path.basename(workspaceFile), { folders: [
        { path: workspace, name: path.basename(workspace) }, { path: artifactRoot, name: inputFolderName } ] });
    const before = workspaceInventory(workspace);
    write(output, 'workspace-before.json', before);
    const report = { schema: 'g6-actual-workspace-v1', status: 'running', targetMode: 'installed', mode,
        startedAt: new Date().toISOString(), workspace, workspaceFile, sourceRoot, artifactRoot, manifestPath, rtlPath,
        vsix: path.resolve(vsix), vsixSha256: hash(fs.readFileSync(vsix)), steps: [], captures: [],
        scope: sourceManifest ? 'Explicit source-only bundle: all 14 current production source files plus existing MemorySynthTop wrapper; initialized/initialize source-editor roundtrip.'
            : mode === 'source-only' ? 'All current hw/bsv/src input; independent root selection and a selected real module source/editor roundtrip.'
            : `Existing source wrapper and separately generated live stock artifact; explicit retained RTL module ${rtlPath}, no original-BSV implementation mapping.`,
        contract: 'Core preparation supplies independent comparison authority only. Installed product receives inputs exclusively through real UI and native messages.',
        userVisualDesignAcceptance: 'PENDING' };
    write(output, 'workspace-contract.json', { ...report, requiredOriginalSourceFingerprint: before.sourceFingerprint,
        limitsChanged: false, compilerRunDuringNative: false, originalWorkspaceWritesAllowed: false });
    let native, frame, page;
    const pass = (name, detail) => { report.steps.push({ name, status: 'pass', ...detail }); write(output, `${name}.json`, detail); console.log(`ACTUAL_WORKSPACE_PASS ${name}`); };
    try {
        const start = performance.now();
        const input = await loadNativeInput({ sourceRoot, artifactRoot, manifest,
            onProgress: progress => fs.appendFileSync(path.join(output, 'authority-phases.jsonl'), `${JSON.stringify({ ...progress, elapsedMs: performance.now() - start })}\n`) });
        report.authority = { durationMs: performance.now() - start, inputIdentity: input.inputIdentity, summary: input.summary };
        const authority = { architecture: createArchitecture({ importResult: input.importResult, analysis: input.analysis }), model: input.importResult?.implementation };
        const sourceFiles = [...input.sources.values()].filter(source => source.kind === 'source').map(source => ({ pathRef: source.pathRef, path: source.path }));
        if (!sourceFiles.length) for (const row of mode === 'source-only' ? before.sources : manifest.sources) {
            const relative = mode === 'source-only' ? path.relative(sourceRoot, path.join(workspace, row.path)) : row.path;
            sourceFiles.push({ pathRef: row.pathRef || relative, path: path.join(sourceRoot, relative) });
        }
        native = await launchNative({ vsix, observerVsix, workspace, workspaceFile, output, restricted: true, harnessFiles: [__filename,
            path.resolve(__dirname, '../g5-readability/oracle.cjs'), path.resolve(__dirname, '../g4-fix/oracle/geometry.cjs')] });
        page = native.context.pages()[0];
        const rejectTrust = page.getByRole('button', { name: "No, I don't trust the authors", exact: true });
        const trustBefore = (await native.channel.request('observeEditors')).trusted;
        const promptVisible = await rejectTrust.isVisible();
        if (promptVisible) await rejectTrust.click();
        else assert.equal(trustBefore, false, 'Absent trust prompt requires independently observed Restricted Mode');
        const trustAfter = (await native.channel.request('observeEditors')).trusted;
        assert.equal(trustAfter, false, 'Actual workspace must remain in Restricted Mode');
        report.restrictedModeEntry = { promptVisible, trustBefore, trustAfter,
            source: 'Actual VS Code workspace.isTrusted observed by installed driver; no trust override' };
        const opening = native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        if (workspaceFile) await native.nativeInput({ choice: path.basename(workspace) }, page);
        await opening;
        ({ frame, page } = await native.findWebview());
        report.resourcesBeforeInput = await native.channel.request('observeResources');
        await frame.locator('#native-empty').waitFor({ state: 'visible' });
        await frame.waitForFunction(() => !!window.BsvHardwareTransport.identity());
        const capture = async (name, expectations) => {
            const result = await captureNative({ native, frame, page, output, name, authority, expectations });
            report.captures.push({ name, inventory: result.inventory, verdict: result.verdict });
            assert.equal(result.verdict.status, 'pass', `${name}: ${JSON.stringify(result.verdict.findings.slice(0, 10))}`);
        };
        const registerManifest = async () => {
            await controls(frame); await frame.locator('#native-inputs [data-native-action="choose-manifest"]').click();
            await title(page, 'Choose artifact authority root'); await native.nativeInput({ choice: inputFolderName }, page);
            await title(page, 'Hardware input manifest'); await native.nativeInput({ text: path.basename(manifestPath) }, page);
            await title(page, 'Choose source authority root for this bundle'); await native.nativeInput({ choice: path.basename(workspace) }, page);
            await title(page, 'Bundle source folder'); await native.nativeInput({ text: 'hw/bsv' }, page);
            await title(page, 'Choose an actual root');
            return page.locator('.quick-input-list .label-name').allTextContents();
        };
        if (mode === 'source-only') {
            let candidates;
            if (sourceManifest) candidates = await registerManifest();
            else {
                await frame.locator('#native-empty [data-native-action="choose-source"]').click();
                await native.nativeInput({ choice: path.basename(workspace) }, page);
                await title(page, 'Source folder'); await native.nativeInput({ text: 'hw/bsv/src' }, page);
                await title(page, 'Choose an actual root'); candidates = await page.locator('.quick-input-list .label-name').allTextContents();
            }
            assert.ok(candidates.some(name => name.includes('mkAquaLoopMatmul')));
            assert.ok(candidates.some(name => name.includes('mkAquaMemorySubsystem')));
            const rootName = sourceManifest ? 'mkMemorySynthTop' : 'mkAquaMemorySubsystem';
            const chosenRoot = candidates.filter(name => name.endsWith(`: ${rootName}`)); assert.equal(chosenRoot.length, 1);
            await native.nativeInput({ choice: chosenRoot[0] }, page);
            await frame.waitForFunction(name => window.bsvHardware.getState().scene?.shell.label === name
                && !window.bsvHardware.getState().pending, rootName);
            await settled(frame); await closeControls(frame); let state = await settled(frame);
            assert.equal(state.current.snapshotId, null); assert.equal(state.scene.sceneKind, 'bsv');
            const childNames = sourceManifest ? ['scratchpad', 'accumulator'] : ['load', 'staging', 'accumulators', 'store'];
            assert.deepEqual(state.scene.children.map(child => child.label), childNames);
            if (!sourceManifest) assert.ok(state.scene.contacts.some(contact => contact.label === 'scheduleLoad'));
            pass('workspace-source-registration', { candidates, current: state.current, summary: input.summary,
                displayedInput: await frame.locator('#native-input-status').innerText() });
            await frame.locator('#fit').click(); state = await settled(frame);
            await capture('workspace-memory-overall', { root: rootName, children: childNames, fitAll: true, allowOverviewAbbreviation: true });
            const owner = state.scene.shell.id, load = state.scene.children.find(child => child.label === 'load');
            if (!sourceManifest) state = await enter(frame, 'load');
            const storage = state.scene.storages.find(item => item.label === (sourceManifest ? 'initialized' : 'active')); assert.ok(storage);
            await chooseObject(frame, storage.id); state = await analyze(frame, 'state-accesses');
            assert.ok(state.current.analysis.result.writers.length); const stateIdentity = identity(state);
            const canvasBeforeSource = await frame.locator('#viewport').boundingBox();
            const clientBeforeSource = await frame.locator('#viewport').evaluate(node => ({ width: node.clientWidth, height: node.clientHeight }));
            const selectedOffsetBefore = selectedOffset(state, canvasBeforeSource);
            const clientOffsetBefore = selectedOffset(state, clientBeforeSource);
            await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').first().click();
            await frame.waitForFunction(() => window.bsvHardware.getState().current.analysis?.result.kind === 'behavior');
            state = await settled(frame);
            const referenceId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
            const reveal = await sourceReveal({ native, frame, fixture: { sourceFiles }, referenceId });
            pass('workspace-editor-source', { current: state.current, reveal });
            await native.capture('workspace-editor-source-window', page);
            await frame.locator('#back').click(); state = await settled(frame);
            const restored = identity(state), canvasAfterSource = await frame.locator('#viewport').boundingBox();
            const clientAfterSource = await frame.locator('#viewport').evaluate(node => ({ width: node.clientWidth, height: node.clientHeight }));
            const withoutViewport = ({ viewport, ...semantic }) => semantic;
            assert.deepEqual(withoutViewport(restored), withoutViewport(stateIdentity));
            if (canvasBeforeSource.width === canvasAfterSource.width && canvasBeforeSource.height === canvasAfterSource.height)
                assert.deepEqual(restored.viewport, stateIdentity.viewport);
            const selectedOffsetAfter = selectedOffset(state, canvasAfterSource);
            const clientOffsetAfter = selectedOffset(state, clientAfterSource);
            const sourceBackObservation = { before: stateIdentity, restored, canvasBeforeSource, canvasAfterSource,
                clientBeforeSource, clientAfterSource, selectedOffsetBefore, selectedOffsetAfter, clientOffsetBefore, clientOffsetAfter };
            write(output, 'source-back-observation.json', sourceBackObservation);
            assert.equal(restored.viewport.scale, stateIdentity.viewport.scale);
            for (const [axis, dimension] of [['x', 'width'], ['y', 'height']]) {
                assert.ok(Math.abs(clientOffsetBefore[axis] - clientOffsetAfter[axis]) < 1e-6,
                    `Back failed to preserve the independent DOM client-coordinate anchor on ${axis}`);
                const quantization = ((clientBeforeSource[dimension] - canvasBeforeSource[dimension])
                    - (clientAfterSource[dimension] - canvasAfterSource[dimension])) / 2;
                assert.ok(Math.abs(selectedOffsetBefore[axis] - selectedOffsetAfter[axis] - quantization) < 1e-6,
                    `Bounding-box anchor difference exceeds observed client-size quantization on ${axis}`);
            }
            pass('workspace-source-back', { ...sourceBackObservation,
                viewportPolicy: 'Exact transform for equal size; exact client-coordinate anchor across editor resize. Fractional CSS bounding-box offset equals observed client-size quantization only.' });
            const sourcePath = path.join(sourceRoot, sourceManifest ? 'tb/MemorySynthTop.bsv' : 'memory/AquaMemorySubsystem.bsv'), text = fs.readFileSync(sourcePath, 'utf8');
            const offset = text.indexOf(sourceManifest ? 'initialized <- mkReg' : 'load <- mkLoadController'); assert.ok(offset >= 0);
            const reverseTarget = sourceManifest ? storage.id : load.id;
            await native.channel.request('moveCursor', { path: sourcePath, start: position(text, offset + 2) });
            await frame.waitForFunction(id => window.bsvHardware.getState().current.selectedEntityId === id, reverseTarget);
            state = await settled(frame); assert.equal(state.current.sceneKind, 'bsv');
            assert.equal(state.current.rootInstanceId, owner);
            pass('workspace-editor-reverse', { actualEditor: await native.channel.request('observeEditors'), current: state.current, expectedEntity: reverseTarget });
            await frame.locator('#fit-selection').click(); await settled(frame);
            await capture('workspace-reverse-selection', { root: false, selected: true });
        } else {
            const candidates = await registerManifest();
            const top = rtlPath.split('/')[0];
            assert.ok(manifest.artifact.manifest.tops.includes(top), 'Selected RTL module must retain a declared real design root');
            const root = candidates.find(name => name.endsWith(`: ${top}`) && !name.includes('RTL'));
            assert.ok(root, 'Actual wrapper must be an explicit source root candidate');
            await native.nativeInput({ choice: root }, page);
            await frame.waitForFunction(name => window.bsvHardware.getState().scene?.shell.label === name
                && !window.bsvHardware.getState().pending, top);
            await settled(frame); await closeControls(frame); let state = await settled(frame);
            assert.equal(state.scene.sceneKind, 'bsv'); assert.equal(state.scene.shell.label, top);
            pass('workspace-live-registration', { candidates, current: state.current, summary: input.summary,
                displayedInput: await frame.locator('#native-input-status').innerText() });
            const contextRows = (await contextAndPersistence(frame)).filter(row => row.action === 'analysis-context');
            assert.equal(new Set(contextRows.filter(row => row.status === 'ok').map(row => row.buildId)).size, input.catalog.length);
            assert.ok(contextRows.every(row => row.status === 'ok' && row.code === null));
            write(output, 'native-contexts.json', { expected: input.catalog.length, actual: contextRows });
            await controls(frame);
            const options = await frame.locator('#build-select option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent })));
            const retained = input.summary.entrypoints.find(entry => entry.isDesignRoot === false && entry.path.join('/') === rtlPath);
            assert.ok(retained, 'Explicit retained entry must be an actual immediate module in this snapshot');
            const choices = options.filter(option => option.text.includes(`RTL module · ${rtlPath}`)); assert.equal(choices.length, 1);
            const rtl = choices[0];
            await frame.locator('#build-select').selectOption(rtl.value);
            await frame.waitForFunction(id => window.bsvHardware.getState().current?.buildId === id
                && window.bsvHardware.getState().scene?.sceneKind === 'rtl' && !window.bsvHardware.getState().pending, rtl.value);
            await settled(frame); await closeControls(frame); state = await settled(frame);
            assert.equal(state.scene.sceneKind, 'rtl'); assert.equal(state.current.snapshotId, input.importResult.snapshot.id);
            assert.equal(state.scene.shell.id, retained.id); assert.equal(state.current.implementationContext.rootOccurrenceId, retained.designRootId);
            assert.equal(state.current.ownerInstanceId, null);
            assert.equal(state.current.sourceContext, null);
            const visibleContext = await frame.locator('#readability-context').innerText();
            assert.match(visibleContext, /BSV owner: Not attached/); assert.ok(visibleContext.includes(`RTL: ${rtlPath}`));
            assert.equal(input.summary.metadata, 'not-provided'); assert.equal(input.summary.origin, 'not-provided');
            const contact = state.scene.contacts.find(item => item.ownerId === state.scene.shell.id && item.label === 'D_IN'); assert.ok(contact?.bits.length > 1);
            await chooseObject(frame, contact.id); await settled(frame);
            const scopeSelect = frame.locator('.analysis-controls select').filter({ has: frame.locator('option[value="occurrence"]') });
            assert.equal(await scopeSelect.count(), 1); await scopeSelect.selectOption('occurrence');
            await frame.locator('.analysis-controls select').filter({ has: frame.locator('option[value="indices"]') }).selectOption('indices');
            await frame.getByLabel('Zero-based positions (order and repeats kept)', { exact: true }).fill('1, 0, 1');
            state = await analyze(frame, 'same-net');
            assert.deepEqual(state.current.analysis.result.seed.positions.map(bit => bit.index), [1, 0, 1]);
            assert.deepEqual(state.current.analysis.result.seed.positions.map(bit => bit.bitId), [contact.bits[1], contact.bits[0], contact.bits[1]]);
            assert.deepEqual(state.current.analysis.result.scope, { kind: 'occurrence', rootOccurrenceId: retained.id });
            pass('workspace-live-same-net', { current: state.current, selectedPort: contact, metadata: 'not-provided',
                origin: 'not-provided', sourceImplementationJoin: 'not-claimed' });
            await frame.locator('#fit-selection').click(); await settled(frame);
            await capture('workspace-live-selected-signal', { root: false, selected: true });
            state = await analyze(frame, 'dependencies', 'forward');
            const stops = state.current.analysis.result.boundaries.filter(boundary => ['memory', 'unsupported-cell', 'sequential'].includes(boundary.reason));
            assert.ok(stops.length, 'Memory analysis must retain its actual unsupported/sequential boundary');
            pass('workspace-live-memory-boundary', { current: state.current, stops });
            await frame.waitForFunction(({ buildId, selected }) => {
                const observed = window.__bsvVsixSmoke;
                return observed.posts.some(request => request.action === 'persist' && request.payload.state?.view?.buildId === buildId
                    && request.payload.state.view.selectedEntityId === selected && request.payload.state.view.sourceContext == null
                    && request.payload.state.view.query?.kind === 'dependencies' && request.payload.state.view.query.scope.kind === 'occurrence'
                    && observed.host.some(response => response.requestId === request.requestId && response.sessionId === request.sessionId && response.status === 'ok'));
            }, { buildId: state.current.buildId, selected: state.current.selectedEntityId }, { timeout: 5000 });
            report.nativeContextAndPersistence = await contextAndPersistence(frame);
            assert.ok(report.nativeContextAndPersistence.every(row => row.status === 'ok' && row.code === null));
            const beforeUp = identity(state), historyBeforeUp = state.history;
            await frame.locator('#up').click();
            await frame.waitForFunction(() => window.bsvHardware.getState().outcome?.code === 'ROUTING_BUDGET_EXCEEDED');
            const rejected = await frame.evaluate(() => window.bsvHardware.getState());
            assert.deepEqual(identity(rejected), beforeUp); assert.deepEqual(rejected.history, historyBeforeUp);
            report.fullDesignRoot = { status: 'limited', code: rejected.outcome.code, message: rejected.outcome.message,
                retainedChild: retained.id, designRoot: retained.designRootId };
            pass('workspace-live-parent-limit', { ...report.fullDesignRoot, lastValid: identity(rejected) });
            await native.capture('workspace-live-parent-limit-window', page);
        }
        report.hardware = await native.channel.request('observeHardware');
        report.resourcesAfterJourneys = await native.channel.request('observeResources');
        report.hostHeapDeltaBytes = report.resourcesAfterJourneys.memory.heapUsed - report.resourcesBeforeInput.memory.heapUsed;
        await native.close(); assert.equal(native.receipt.status, 'passed'); report.status = 'pass';
    } catch (error) {
        report.status = 'fail'; report.error = error?.stack || String(error);
        if (native) {
            try { await native.capture('workspace-failure', page); } catch (failure) { report.captureError = failure.message; }
            if (frame) try { write(output, 'failure.state.json', await frame.evaluate(() => window.bsvHardware?.getState()));
                write(output, 'failure.native-contexts.json', await contextAndPersistence(frame));
                fs.writeFileSync(path.join(output, 'failure.dom.txt'), await frame.locator('body').innerText(), { flag: 'wx' }); } catch (failure) { report.stateError = failure.message; }
            try { report.hardware = await native.channel.request('observeHardware'); } catch (failure) { report.hardwareError = failure.message; }
            await native.close('failed', error);
        }
        console.error(report.error); process.exitCode = 1;
    } finally {
        const after = workspaceInventory(workspace); write(output, 'workspace-after.json', after);
        report.preservation = { before: before.inventoryFingerprint, after: after.inventoryFingerprint,
            sourceBefore: before.sourceFingerprint, sourceAfter: after.sourceFingerprint, files: before.files.length,
            identical: before.inventoryFingerprint === after.inventoryFingerprint,
            gitStateUnchanged: before.head === after.head && before.branch === after.branch && before.status === after.status };
        if (!report.preservation.identical || !report.preservation.gitStateUnchanged) { report.status = 'fail'; process.exitCode = 1; }
        report.finishedAt = new Date().toISOString(); write(output, 'actual-workspace.json', report);
        console.log(JSON.stringify({ output, status: report.status, mode, steps: report.steps.map(step => step.name), preservation: report.preservation, error: report.error }));
    }
    return report;
}
if (require.main === module) {
    const [mode, vsix, observerVsix, workspace, manifestPath, rtlPath] = process.argv.slice(2);
    run({ mode, vsix, observerVsix, workspace, manifestPath, rtlPath }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { run };
