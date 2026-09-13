#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchNative } = require('../g6/native-driver.cjs');
const { createRun } = require('../g6/run.cjs');
const { settled } = require('../g6/development-smoke.cjs');
const { poll, openWorkspacePanel } = require('../g6/native-security-attacks.cjs');
const { validateGeometry } = require('../g4-fix/oracle/geometry.cjs');
const { prepare, digest } = require('./native-lifecycle-inputs.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const facts = scene => ({ owner: scene.ownerInstanceId, sourceRevision: scene.sourceRevision,
    children: scene.children.map(item => ({ id: item.id, sourceRefs: item.sourceRefs })),
    storages: scene.storages.map(item => ({ id: item.id, sourceRefs: item.sourceRefs })),
    contacts: scene.contacts.map(item => ({ id: item.id, ownerId: item.ownerId, interfacePath: item.interfacePath })),
    connections: scene.connections.map(item => ({ id: item.id, endpointIds: item.endpointIds, memberRelationIds: item.memberRelationIds })) });

async function run({ vsix, output = process.env.G6_OUTPUT_DIR || createRun('usability-native-routing-fault'),
    observerVsix = path.join(ROOT, '.build/hardware/runs/g6-observer-resources-final-xQD0Ig/g6/bsv-lens-g6-observer-0.0.1.vsix') }) {
    assert.ok(vsix); const inputs = prepare(output); inputs.write(inputs.sourceRelative, inputs.design);
    const report = { schema: 'g6-usability-native-routing-fault-v1', startedAt: new Date().toISOString(), status: 'running',
        vsix: path.resolve(vsix), vsixSha256: digest(fs.readFileSync(vsix)), steps: [],
        scope: 'Explicit fault-only installed Webview lane. Debugger empties one local search queue; loaded script and canonical data stay unchanged.',
        cspChanged: false, installedRuntimeEdited: false, queryModelEdited: false, userVisualDesignAcceptance: 'PENDING',
        debuggerReference: 'https://chromedevtools.github.io/devtools-protocol/tot/Debugger/#method-evaluateOnCallFrame' };
    write(output, 'fault-contract.json', report);
    let native, frame, page, debuggerSession, script, original, installedFile, breakpointId, pauseFailure;
    let pausedWork = Promise.resolve();
    const pauses = [];
    const parsed = [];
    const selectController = async () => {
        await poll(async () => {
            const title = page.locator('.quick-input-title').filter({ hasText: 'Choose a source design' });
            if (await title.isVisible()) { await native.nativeInput({ choice: 'mkController' }, page); return false; }
            return frame.evaluate(() => window.bsvHardware?.getState().scene?.shell.label === 'mkController');
        }, Boolean, 'Actual controller source choice', 60000);
        return settled(frame);
    };
    const attachDebugger = async () => {
        parsed.length = 0;
        let target = frame;
        while (!debuggerSession) {
            try { debuggerSession = await native.context.newCDPSession(target); }
            catch (error) {
                if (!error.message.includes('part of the parent frame') || target === page) throw error;
                target = target.parentFrame?.() || page;
            }
        }
        const contexts = []; debuggerSession.on('Runtime.executionContextCreated', event => contexts.push(event.context));
        debuggerSession.on('Debugger.scriptParsed', value => parsed.push(value));
        await debuggerSession.send('Runtime.enable');
        await debuggerSession.send('Debugger.enable', { maxScriptsCacheSize: 8388608 });
        const panelId = await frame.evaluate(() => window.BsvHardwareTransport.identity().panelId);
        let contextId;
        for (const context of contexts.slice(0, 64)) {
            try {
                const result = await debuggerSession.send('Runtime.callFunctionOn', { executionContextId: context.id, returnByValue: true,
                    functionDeclaration: 'function() { return globalThis.BsvHardwareTransport?.identity()?.panelId; }' });
                if (result.result.value === panelId) { contextId = context.id; break; }
            } catch (_) { /* A disposed non-product execution context is not a target. */ }
        }
        assert.ok(contextId, 'CDP execution context must identify this exact native panel');
        script = await poll(async () => parsed.find(value => value.executionContextId === contextId
            && /\/hardware-layout\.js(?:\?|$)/.test(value.url)), Boolean, 'Loaded native layout script');
        return (await debuggerSession.send('Debugger.getScriptSource', { scriptId: script.scriptId })).scriptSource;
    };
    const capture = async label => {
        const state = await settled(frame), geometry = validateGeometry(state.scene, state.geometry);
        const exported = await frame.evaluate(() => {
            const svg = window.bsvHardware.serializeSceneSvg(), parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
            if (parsed.querySelector('parsererror')) throw new Error('Product SVG export is not valid XML');
            return { svg, metadata: JSON.parse(parsed.querySelector('metadata').textContent),
                routes: [...parsed.querySelectorAll('.connection[data-active="true"]')].map(node => node.getAttribute('data-semantic-id')) };
        });
        assert.match(exported.metadata.displayScope, /BSV overview/);
        assert.deepEqual(exported.metadata.routing, state.geometry.routing);
        assert.deepEqual(exported.routes.sort(), state.geometry.routes.map(route => route.id).sort());
        assert.deepEqual(exported.metadata.connections.map(item => ({ id: item.id, members: item.memberRelationIds })),
            state.scene.connections.map(item => ({ id: item.id, members: item.memberRelationIds })));
        fs.writeFileSync(path.join(output, `${label}.svg`), exported.svg, { flag: 'wx' });
        write(output, `${label}.json`, { state, geometry, host: await native.channel.request('observeHardware'),
            svg: { bytes: Buffer.byteLength(exported.svg), sha256: digest(Buffer.from(exported.svg)), metadata: exported.metadata,
                scope: 'Product serialization API and exact SVG bytes; native save dialog not exercised in this lane' },
            dom: await frame.evaluate(() => ({ feedback: document.getElementById('navigation-feedback').innerText,
                display: document.getElementById('display-status').innerText, inspector: document.getElementById('inspector').innerText,
                activeRoutes: [...document.querySelectorAll('.connection[data-active="true"]')].map(node => node.dataset.semanticId),
                fault: window.__bsvLifecycleRouteFault || null })) });
        await native.capture(`${label}-window`, page); await frame.locator('body').screenshot({ path: path.join(output, `${label}-webview.png`) });
        await native.traceCheckpoint(label); assert.equal(geometry.valid, true, JSON.stringify(geometry.findings)); return state;
    };
    try {
        native = await launchNative({ vsix, observerVsix, workspace: inputs.main, workspaceFile: inputs.workspaceFile, output,
            restricted: true, harnessFiles: [__filename, require.resolve('./native-lifecycle-inputs.cjs')] });
        page = native.context.pages()[0]; const trust = page.getByRole('button', { name: "No, I don't trust the authors", exact: true });
        if (await trust.isVisible()) await trust.click();
        ({ frame, page } = await openWorkspacePanel(native, path.basename(inputs.main))); await selectController();
        const before = await capture('F01-original-normal'), actualSource = await attachDebugger();
        installedFile = path.join(native.receipt.installedTarget.extensionPath, 'media/hardware-layout.js'); original = fs.readFileSync(installedFile, 'utf8');
        assert.equal(digest(Buffer.from(actualSource)), digest(Buffer.from(original)), 'Loaded original layout does not match installed bytes');
        const connection = before.scene.connections.find(item => item.style === 'semantic' && item.memberRelationIds?.length && before.geometry.routes.some(route => route.id === item.id));
        assert.ok(connection, 'A real canonical semantic relation is required');
        const anchor = 'while (heap.items.length) {'; assert.equal(original.split(anchor).length, 2);
        const lineNumber = original.slice(0, original.indexOf(anchor)).split('\n').length - 1;
        const columnNumber = original.split('\n')[lineNumber].indexOf('while');
        const condition = `overview && routes[owner - 1].id === ${JSON.stringify(connection.id)}`;
        await debuggerSession.send('Debugger.setPauseOnExceptions', { state: 'none' });
        debuggerSession.on('Debugger.paused', event => {
            pausedWork = pausedWork.then(async () => {
                try {
                    assert.ok(event.hitBreakpoints.includes(breakpointId), 'Only the scoped test breakpoint may mutate local working state');
                    const callFrame = event.callFrames[0]; assert.equal(callFrame.functionName, 'search');
                    assert.equal(callFrame.location.scriptId, script.scriptId); assert.equal(callFrame.location.lineNumber, lineNumber);
                    const before = await debuggerSession.send('Debugger.evaluateOnCallFrame', { callFrameId: callFrame.callFrameId,
                        expression: '({connectionId:routes[owner - 1].id, queueLength:heap.items.length, owner, attempt:counts.passes})', returnByValue: true });
                    assert.equal(before.exceptionDetails, undefined); assert.equal(before.result.value.connectionId, connection.id);
                    assert.ok(before.result.value.queueLength > 0);
                    const after = await debuggerSession.send('Debugger.evaluateOnCallFrame', { callFrameId: callFrame.callFrameId,
                        expression: 'heap.items.length = 0', returnByValue: true });
                    assert.equal(after.exceptionDetails, undefined); assert.equal(after.result.value, 0);
                    pauses.push({ location: callFrame.location, functionName: callFrame.functionName,
                        original: before.result.value, resultingQueueLength: after.result.value });
                } catch (error) { pauseFailure = error; }
                finally { await debuggerSession.send('Debugger.resume'); }
            });
        });
        const breakpoint = await debuggerSession.send('Debugger.setBreakpoint', { location: { scriptId: script.scriptId, lineNumber, columnNumber }, condition });
        breakpointId = breakpoint.breakpointId; assert.equal(breakpoint.actualLocation.lineNumber, lineNumber, 'Breakpoint must stop before the original while condition');
        report.injectionMethod = 'debugger-local-working-queue';
        write(output, 'instrumentation.json', { scriptId: script.scriptId, observedResourceUrl: script.url, loadedSha256: digest(Buffer.from(original)),
            anchor, breakpoint, condition, mutation: 'heap.items.length = 0', connectionId: connection.id, memberRelationIds: connection.memberRelationIds,
            canonicalSceneMutation: false, loadedScriptMutation: false });
        native.receipt.testOnlyRouterFault = { method: report.injectionMethod, loadedLayoutSha256: digest(Buffer.from(original)),
            normalExecutionClaimDuringFault: false }; native.save();
        await frame.locator('#toggle-inspector').click();
        await frame.waitForFunction(id => window.bsvHardware.getState().geometry?.routing?.deferred.some(item => item.connectionId === id), connection.id);
        await frame.locator('#toggle-inspector').click();
        const partial = await capture('F02-secondary-route-deferred');
        assert.deepEqual(facts(partial.scene), facts(before.scene)); assert.equal(partial.geometry.routing.status, 'partial');
        assert.equal(partial.geometry.routing.deferred.length, 1); assert.ok(partial.geometry.routes.length > 0);
        assert.deepEqual(partial.geometry.routing.deferred[0].memberRelationIds, connection.memberRelationIds);
        assert.equal(await frame.locator('#navigation-feedback').isVisible(), true);
        assert.match(await frame.locator('#navigation-feedback').innerText(), /connections could not be placed/);
        const deferredList = frame.locator('#unrouted-connections'); assert.equal(await deferredList.isVisible(), true);
        if (!await deferredList.evaluate(node => node.open)) await deferredList.locator(':scope > summary').click();
        const deferredButton = frame.locator(`[data-unrouted-id=${JSON.stringify(connection.id)}]`);
        const readyButton = await frame.waitForFunction(id => {
            const nodes = [...document.querySelectorAll('[data-unrouted-id]')].filter(node => node.dataset.unroutedId === id);
            if (nodes.length !== 1 || !nodes[0].getClientRects().length || !nodes[0].textContent.trim()) return false;
            return JSON.stringify({ id: nodes[0].dataset.unroutedId, caption: nodes[0].textContent, count: nodes.length });
        }, connection.id, { timeout: 30000 });
        const ready = JSON.parse(await readyButton.jsonValue());
        assert.equal(ready.id, connection.id); assert.equal(ready.count, 1); assert.ok(ready.caption.trim());
        write(output, 'unrouted-button-ready.json', ready);
        await deferredButton.click();
        await frame.waitForFunction(id => window.bsvHardware.getState().current.selectedRelationId === id, connection.id);
        await capture('F02-deferred-list-selection');
        const list = frame.locator('details[data-disclosure-id^="inspector-relations:"]'); assert.equal(await list.count(), 1);
        if (!await list.evaluate(node => node.open)) await list.locator(':scope > summary').click();
        const member = connection.memberRelationIds[0], button = frame.locator(`[data-relation-member-id=${JSON.stringify(member)}]`);
        assert.equal(await button.count(), 1); await button.click();
        await frame.waitForFunction(id => window.bsvHardware.getState().current.selectedRelationId === id, member);
        const selected = await capture('F03-original-relation-access');
        assert.ok(selected.scene.inspector.sourceRefs?.length || selected.scene.inspector.sections.some(section => section.id.includes('source')));
        await debuggerSession.send('Debugger.removeBreakpoint', { breakpointId }); breakpointId = null; await pausedWork;
        if (pauseFailure) throw pauseFailure; assert.ok(pauses.length >= 3, 'Every routing pass must encounter the same intended failure');
        await frame.locator('#retry-navigation').click();
        await frame.waitForFunction(() => window.bsvHardware.getState().geometry.routing.status === 'complete');
        const recovered = await capture('F03-retry-recovered');
        assert.deepEqual(facts(recovered.scene), facts(before.scene)); assert.deepEqual(recovered.geometry.routing.deferred, []);
        assert.equal(recovered.geometry.routes.length, recovered.scene.connections.length);
        report.steps.push({ id: 'F01-F03', status: 'PASS', connectionId: connection.id, member, originalRelationsPreserved: true,
            deferred: partial.geometry.routing.deferred, recoveredRoutes: recovered.geometry.routes.length });
        report.status = 'passed';
    } catch (error) {
        report.status = error.code === 'FAULT_TOOL_BLOCKED' || /CDP|script|Debugger|intercept/i.test(error.message) && !report.injectionMethod ? 'blocked' : 'failed';
        report.failure = error.stack; console.error('NATIVE_FAULT_FAILURE', error.stack);
        if (native && frame) { write(output, 'failure-state.json', await frame.evaluate(() => window.bsvHardware?.getState()).catch(() => null)); await native.capture('fault-failure', page).catch(() => {}); }
    } finally {
        if (debuggerSession && breakpointId) await debuggerSession.send('Debugger.removeBreakpoint', { breakpointId }).catch(error => { report.breakpointCleanupError = error.message; });
        await pausedWork.catch(error => { report.pauseCleanupError = error.message; });
        if (debuggerSession && original && script) {
            try {
                const bytes = (await debuggerSession.send('Debugger.getScriptSource', { scriptId: script.scriptId })).scriptSource;
                report.restoration = { scriptId: script.scriptId, sha256: digest(Buffer.from(bytes)), expected: digest(Buffer.from(original)), breakpointRemoved: true };
                assert.equal(report.restoration.sha256, report.restoration.expected);
            } catch (error) { report.status = 'failed'; report.restoreError = error.stack; }
        }
        if (debuggerSession) await debuggerSession.detach().catch(() => {});
        write(output, 'debugger-pauses.json', pauses);
        if (installedFile) { report.installedLayoutPreserved = digest(fs.readFileSync(installedFile)) === digest(Buffer.from(original)); assert.equal(report.installedLayoutPreserved, true); }
        if (native) await native.close(report.status === 'passed' ? 'passed' : 'failed', report.failure || report.status);
        report.finishedAt = new Date().toISOString(); write(output, 'routing-fault-report.json', report); console.log('NATIVE_FAULT_REPORT', path.join(output, 'routing-fault-report.json'));
    }
    assert.equal(report.status, 'passed', report.failure); return report;
}
if (require.main === module) {
    if (process.argv.includes('--help')) console.log('Usage: node native-routing-fault.cjs FINAL.vsix\nExplicit fault-only native layout instrumentation; installed files and CSP remain unchanged.');
    else run({ vsix: process.argv[2] }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { run };
