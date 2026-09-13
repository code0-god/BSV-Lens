'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchNative } = require('./native-driver.cjs');
const { createRun } = require('./run.cjs');
const { prepare, retain, verifyInventory, digest, json } = require('./native-security-inputs.cjs');
const { attack, inputFailure, openWorkspacePanel, registerBundle } = require('./native-security-attacks.cjs');
const { runSourceCases, runLifecycleCases } = require('./native-security-lifecycle.cjs');
const { identity, enter, analyze } = require('./native-acceptance.cjs');
const { settled, chooseObject } = require('./development-smoke.cjs');

async function requestCases(context) {
    const { native, frame, page, inputs, pass } = context;
    assert.equal(native.receipt.environment.workspaceTrusted, false, 'S01 requires actual Restricted Mode');
    const blocked = await attack({ native, frame, id: 'restricted-execution', change: { action: 'executeCommand' }, expectedCode: 'FORBIDDEN' });
    await registerBundle({ native, frame, page, fixture: inputs.fixtures.A, needsSourceRoot: true });
    await pass('S01', { trusted: false, boundedRegistration: identity(await settled(frame)), blocked,
        contract: 'Actual Restricted Mode permits explicitly approved bounded reads. No compiler/task/process action exists in the native allowlist.' });
    const rootChoice = path.basename(inputs.workspace), rejection = [];
    rejection.push(await inputFailure({ native, frame, page, action: 'choose-manifest', path: 'traversal.json', rootChoice, expectedCode: 'INVALID_INPUT' }));
    rejection.push(await attack({ native, frame, id: 'forged-source-root', action: 'choose-source', payload: { path: inputs.outside }, expectedCode: 'INVALID_INPUT' }));
    await pass('S02', { rejection, contract: 'Manifest traversal and Webview-supplied path authority are rejected by the installed Host.' });
    const symlinks = [];
    for (const [action, relative] of [['choose-source', 'source-escape'], ['choose-artifact', 'artifact-escape.json']]) {
        symlinks.push(await inputFailure({ native, frame, page, action, path: relative, rootChoice, expectedCode: 'PATH_DENIED' }));
    }
    context.symlinks = symlinks;
    const foreign = [];
    for (const change of [{ panelId: 'foreign-panel' }, { sessionId: 'foreign-session' }, { generation: 10000 }, { snapshotId: 'foreign-snapshot' }]) {
        foreign.push(await attack({ native, frame, id: `foreign-${Object.keys(change)[0]}`, change,
            expectedCode: change.snapshotId ? 'SNAPSHOT_MISMATCH' : 'FORBIDDEN' }));
    }
    const state = await settled(frame);
    const sceneRequest = await frame.evaluate(() => window.__bsvVsixSmoke.posts.filter(message => message.action === 'scene').at(-1).payload);
    foreign.push(await attack({ native, frame, id: 'foreign-entity', action: 'scene',
        payload: { ...sceneRequest, intent: { ...sceneRequest.intent, selectedEntityId: 'foreign-entity' } }, expectedCode: 'INVALID_INPUT' }));
    await pass('S04', { foreign, original: identity(state) });
    const limits = [];
    for (const [id, options, expectedCode] of [['oversized-message', { oversized: true }, 'LIMIT_EXCEEDED'],
        ['deep-json', { deep: true }, 'LIMIT_EXCEEDED'], ['prototype-json', { prototype: true }, 'INVALID_INPUT']]) {
        limits.push(await attack({ native, frame, id, ...options, expectedCode }));
    }
    await pass('S06', { limits, resultLimits: 'Actual M/L result byte limits and pagination are recorded in the separate scale lane; no synthetic Host result replaces the worker here.' });
    const mismatch = [];
    for (const change of [{ buildId: 'different-installed-build' }, { protocol: 999 }]) {
        mismatch.push(await attack({ native, frame, id: `mismatch-${Object.keys(change)[0]}`, change, expectedCode: 'BUILD_MISMATCH' }));
    }
    await pass('S13', { mismatch, after: await frame.evaluate(() => window.BsvHardwareTransport.identity()) });
}

async function hostileCase(context) {
    const { native, frame, page, inputs, pass } = context;
    await registerBundle({ native, frame, page, fixture: inputs.synthetic });
    let state = await settled(frame);
    await chooseObject(frame, state.scene.storages.find(item => item.label === 'state').id);
    await analyze(frame, 'state-accesses');
    await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click();
    await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result.kind === 'behavior');
    state = await settled(frame);
    const rendered = await frame.locator('#code-drawer').innerText();
    assert.match(rendered, /<svg onload='globalThis\.__g6Executed=true'>/);
    const result = await frame.evaluate(() => ({ executed: globalThis.__g6Executed === true,
        hostileNodes: document.querySelectorAll('#code-drawer [onload], #native-input-status img').length,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content }));
    assert.equal(result.executed, false); assert.equal(result.hostileNodes, 0);
    assert.doesNotMatch(result.csp, /unsafe-eval/); assert.match(result.csp, /default-src 'none'/);
    await native.capture('S07-hostile-text', page);
    await pass('S07', { ...result, rendered, selected: identity(state), fixtureKind: 'Synthetic malicious display input; not compiler evidence' });
}

async function cancellationCase(context) {
    const { native, frame, page, inputs, pass } = context;
    await registerBundle({ native, frame, page, fixture: inputs.fixtures.A });
    await frame.locator('#rtl').click(); let state = await settled(frame);
    const get = state.scene.contacts.find(item => item.ownerId === state.scene.shell.id && item.label === 'get'); assert.ok(get);
    await chooseObject(frame, get.id); state = await analyze(frame, 'same-net');
    const result = await attack({ native, frame, id: 'cancel-actual-worker', action: 'analysis',
        payload: { buildId: state.current.buildId, query: state.current.analysis.request }, cancel: 'worker' });
    const hardware = await require('./native-security-attacks.cjs').poll(() => native.channel.request('observeHardware'), value =>
        value.sessions.every(session => session.state.activeOperations === 0), 'Cancelled worker settlement');
    const exited = hardware.sessions.flatMap(session => session.events).filter(event => event.action === 'analysis' && event.phase === 'exited' && event.cancelled);
    assert.ok(exited.length, 'S08 must observe actual cancelled worker exit');
    const late = await frame.evaluate(id => window.__bsvVsixSmoke.host.filter(message => message.requestId === id && message.status === 'ok'), result.sent.requestId);
    assert.equal(late.length, 0);
    await pass('S08', { result, exited, activeOperations: hardware.sessions.map(session => session.state.activeOperations), lateSuccessResponses: late.length });
}

async function run({ vsix, observerVsix, fixturePath, output = process.env.G6_OUTPUT_DIR || createRun('native-security') }) {
    for (const file of [vsix, observerVsix, fixturePath]) assert.ok(file && fs.statSync(file).isFile(), 'Explicit existing product VSIX, observer VSIX and fixtures are required');
    const inputs = prepare(fixturePath, output), vsixSha256 = digest(fs.readFileSync(vsix));
    const report = { schema: 'g6-native-security-v1', status: 'running', startedAt: new Date().toISOString(), targetMode: 'installed',
        vsix: path.resolve(vsix), vsixSha256, observerVsix: path.resolve(observerVsix), observerSha256: digest(fs.readFileSync(observerVsix)),
        fixturePath: inputs.fixturePath, fixtureSha256: inputs.fixtureSha256, workspace: inputs.workspace, steps: [],
        contract: 'Actual installed product Host/Webview messages, native choosers and TextDocuments. Attack mutations affect outbound envelopes only; no scene/query/worker mocks. Original inputs immutable.' };
    json(path.join(output, 'security-contract.json'), { ...report, requiredCases: Array.from({ length: 14 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`) });
    let native, context;
    try {
        native = await launchNative({ vsix, observerVsix, workspace: inputs.workspace, workspaceFile: inputs.workspaceFile, output, restricted: true,
            harnessFiles: ['native-security.cjs', 'native-security-inputs.cjs', 'native-security-attacks.cjs', 'native-security-lifecycle.cjs'].map(file => path.join(__dirname, file)) });
        const page = native.context.pages()[0];
        const refuseTrust = page.getByRole('button', { name: /No, I don.t trust the authors/ });
        const promptVisible = await refuseTrust.isVisible();
        const trustBefore = (await native.channel.request('observeEditors')).trusted;
        if (promptVisible) await refuseTrust.click();
        else assert.equal(trustBefore, false, 'Absent trust prompt requires independently observed Restricted Mode');
        assert.equal((await native.channel.request('observeEditors')).trusted, false, 'Actual Code workspace must remain untrusted');
        report.trust = { action: promptVisible ? 'Clicked the actual No, I don’t trust the authors dialog button'
            : 'Observed existing Restricted Mode without a startup dialog', promptVisible, trustBefore, trusted: false,
            validatedWorkspace: inputs.workspace, placementReason: inputs.placementReason };
        const { frame } = await openWorkspacePanel(native, path.basename(inputs.workspace));
        await frame.waitForFunction(() => !!window.BsvHardwareTransport?.identity());
        const pass = async (id, detail) => {
            assert.ok(!report.steps.some(step => step.id === id), `Duplicate security case ${id}`);
            const step = { id, status: 'pass', executed: true, targetMode: 'installed', vsixSha256, ...detail };
            json(path.join(output, `${id}.json`), step); report.steps.push({ id, status: 'pass', evidence: `${id}.json` });
            await native.traceCheckpoint(id);
            console.log(`NATIVE_SECURITY_PASS ${id}`);
        };
        context = { native, frame, page, inputs, pass, output };
        await requestCases(context); await runSourceCases(context); await hostileCase(context);
        await cancellationCase(context); await runLifecycleCases(context);
        assert.deepEqual(report.steps.map(row => row.id).sort(), Array.from({ length: 14 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
        report.hardware = await native.channel.request('observeHardware');
        await native.close(); assert.equal(native.receipt.status, 'passed', JSON.stringify(native.receipt.errors)); report.status = 'pass';
    } catch (error) {
        report.status = 'fail'; report.error = error?.stack || String(error); process.exitCode = 1;
        if (native) {
            try { await native.capture('security-failure', context?.page); report.hardware = await native.channel.request('observeHardware');
                if (context?.frame) { json(path.join(output, 'failure.state.json'), await context.frame.evaluate(() => window.bsvHardware?.getState()));
                    json(path.join(output, 'failure.layout.json'), { frameBounds: await (await context.frame.frameElement()).boundingBox(),
                        layout: await context.frame.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio,
                            visualViewport: visualViewport && { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale },
                            elements: ['html', 'body', 'header', '#native-inputs', '#native-input-status', '#canvas', '#viewport', '#inspector'].map(selector => {
                                const element = document.querySelector(selector); if (!element) return { selector, missing: true };
                                const box = element.getBoundingClientRect(), style = getComputedStyle(element);
                                return { selector, rect: { x: box.x, y: box.y, width: box.width, height: box.height },
                                    display: style.display, overflow: style.overflow, minHeight: style.minHeight, flex: style.flex };
                            }) })) });
                    fs.writeFileSync(path.join(output, 'failure.dom.txt'), await context.frame.locator('body').innerText(), { flag: 'wx' }); }
            } catch (failure) { report.captureError = failure.message; }
            await native.close('failed', error);
        }
        console.error(report.error);
    } finally {
        report.originalInputsPreserved = verifyInventory(inputs.original.workspace, inputs.original.inventory);
        report.copiedCapturedInputsPreserved = verifyInventory(inputs.workspace, inputs.original.inventory);
        report.vsixUnchanged = digest(fs.readFileSync(vsix)) === vsixSha256;
        if (!report.originalInputsPreserved || !report.copiedCapturedInputsPreserved || !report.vsixUnchanged) { report.status = 'fail'; process.exitCode = 1; }
        report.retention = retain(inputs, output, native?.receipt.shutdown || null);
        report.finishedAt = new Date().toISOString(); json(path.join(output, 'native-security.json'), report);
        console.log(JSON.stringify({ output, status: report.status, completed: report.steps.map(step => step.id), error: report.error }));
    }
    return report;
}
if (require.main === module) {
    const [vsix, observerVsix, fixturePath] = process.argv.slice(2);
    run({ vsix, observerVsix, fixturePath }).catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
}
module.exports = { run };
