'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { loadNativeInput } = require('../../../src/hardware/native-input');
const { createArchitecture } = require('../../../src/hardware/architecture');
const { launchNative } = require('./native-driver.cjs');
const { registerBundle, runTypography, sourceReveal, enter, analyze, identity } = require('./native-acceptance.cjs');
const { captureNative, measureNative } = require('./native-oracle.cjs');
const { settled, chooseObject } = require('./development-smoke.cjs');
const { createRun } = require('./run.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

async function theme({ frame, page }, name, expected) {
    await page.keyboard.press('ControlOrMeta+K'); await page.keyboard.press('ControlOrMeta+T');
    const picker = page.locator('.quick-input-widget'); await picker.waitFor({ state: 'visible' });
    await picker.locator('input').fill(name);
    const option = picker.getByRole('option').filter({ hasText: name });
    await option.first().waitFor({ state: 'visible' }); assert.equal(await option.count(), 1, 'Theme choice is ambiguous');
    const actualChoice = await option.innerText(); await option.click(); await picker.waitFor({ state: 'hidden' });
    await frame.waitForFunction(value => document.documentElement.dataset.theme === value, expected);
    await settled(frame); return { requested: name, actualChoice, expected, source: 'Actual VS Code Color Theme QuickPick' };
}
async function resize({ native, page }, requested) {
    if (requested.width === 1280 && process.env.G6_PRIOR_NORMAL_RESIZE) {
        const file = path.resolve(process.env.G6_PRIOR_NORMAL_RESIZE), bytes = fs.readFileSync(file), prior = JSON.parse(bytes);
        const verdictFile = file.replace(/\.measurement\.json$/, '.verdict.json'), verdictBytes = fs.readFileSync(verdictFile);
        assert.equal(prior.schema, 'g6-native-readability-measurement-v1');
        assert.equal(prior.native.vsixSha256, native.receipt.vsixSha256); assert.equal(JSON.parse(verdictBytes).status, 'pass');
        return { requested, actual: prior.native.hostWindow, status: 'pass', execution: 'Prior same-VSIX actual CUA resize, not repeated in this run',
            evidence: [{ path: file, sha256: hash(bytes) }, { path: verdictFile, sha256: hash(verdictBytes) }] };
    }
    if (process.env.G6_WINDOW_RESIZE_HANDOFF !== '1') return { requested, status: 'NOT RUN',
        reason: 'Electron CDP omits Browser.getWindowForTarget. CUA handoff not enabled; no CSS or OS scripting substitute.' };
    const previous = await page.evaluate(() => ({ innerWidth, innerHeight, outerWidth, outerHeight, screenX, screenY }));
    const name = `window-resize-${requested.width}x${requested.height}`, ackFile = path.join(native.output, `${name}.completed.json`);
    write(native.output, `${name}.request.json`, { requested, previous, targetPid: native.receipt.launch.pid,
        executable: native.receipt.vscodeExecutable, profile: native.receipt.isolation.profile,
        windowTitle: await page.title(),
        action: 'Use CUA on this isolated Code window only; record performed action and evidence in the matching completed JSON.' });
    console.log(`NATIVE_CUA_RESIZE_REQUEST ${path.join(native.output, `${name}.request.json`)}`);
    const deadline = Date.now() + 120000;
    while (!fs.existsSync(ackFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
    assert.ok(fs.existsSync(ackFile), 'CUA window-resize handoff timed out');
    const action = JSON.parse(fs.readFileSync(ackFile));
    assert.ok(['complete', 'unavailable'].includes(action.status) && typeof action.method === 'string'
        && (typeof action.evidence === 'string' || action.evidence && typeof action.evidence === 'object' && !Array.isArray(action.evidence)));
    if (action.status === 'unavailable') return { requested, previous, action, status: 'NOT RUN' };
    await page.evaluate(() => new Promise(resolve => {
        let last = '', stable = 0;
        function tick() { const next = `${innerWidth}:${innerHeight}`; stable = next === last ? stable + 1 : 0; last = next;
            if (stable >= 4) resolve(); else requestAnimationFrame(tick); } requestAnimationFrame(tick);
    }));
    const actual = await page.evaluate(() => ({ innerWidth, innerHeight, outerWidth, outerHeight, screenX, screenY }));
    assert.ok(actual.outerWidth !== previous.outerWidth || actual.outerHeight !== previous.outerHeight
        || actual.outerWidth === requested.width && actual.outerHeight === requested.height, 'CUA completion did not change observed window size');
    return { requested, actual, previous, action, status: 'pass', method: 'Actual CUA window resize; observed bounds, not CSS viewport injection' };
}
async function closeSource(native, uri) {
    const before = await native.channel.request('observeEditors'), editor = before.visible.find(item => item.uri === uri);
    assert.ok(editor && [1, 2].includes(editor.viewColumn), 'Expected actual source editor is not visible in a supported group');
    await native.channel.request('uiCommand', { command: editor.viewColumn === 1
        ? 'workbench.action.focusFirstEditorGroup' : 'workbench.action.focusSecondEditorGroup' });
    const focused = await native.channel.request('observeEditors'); assert.equal(focused.active?.uri, uri, 'Refusing to close a different editor');
    const closed = await native.channel.request('uiCommand', { command: 'workbench.action.closeActiveEditor' });
    assert.notEqual(closed.before.label, 'Hardware Schematic (Experimental)', 'Source close targeted the product panel');
    return { action: 'close-exact-source-editor', uri, column: editor.viewColumn, closed };
}
async function writer(frame) {
    let state = await settled(frame);
    if (state.scene.shell.label !== 'left') state = await enter(frame, 'left');
    const storage = state.scene.storages.find(item => item.label === 'state'); assert.ok(storage);
    await chooseObject(frame, storage.id); await analyze(frame, 'state-accesses');
    await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click();
    await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result.kind === 'behavior');
    state = await settled(frame);
    return { state, referenceId: await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id') };
}
async function sourceDelay({ frame }) {
    await analyze(frame, 'state-accesses');
    await frame.evaluate(() => {
        const hold = window.__g6TypographyHold = { messages: [], active: true, sourceEvents: [] };
        hold.sourceListener = event => hold.sourceEvents.push(structuredClone(event.detail));
        window.addEventListener('hardware:source', hold.sourceListener);
        hold.listener = event => {
            if (!hold.active || event.data?.kind !== 'response' || event.data.action !== 'source') return;
            event.stopImmediatePropagation(); hold.messages.push({ data: structuredClone(event.data), origin: event.origin });
        };
        window.addEventListener('message', hold.listener, true);
    });
    try {
        await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click();
        await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result.kind === 'behavior');
        await settled(frame);
        const button = frame.locator('[data-source-open-id]').first();
        for (let depth = 0; depth < 8; depth++) {
            const closed = button.locator('xpath=ancestor::details[not(@open)]').first();
            if (!await closed.count()) break; await closed.locator('summary').first().click();
        }
        const referenceId = await button.getAttribute('data-source-open-id');
        await button.scrollIntoViewIfNeeded(); await button.click();
        await frame.waitForFunction(() => window.__g6TypographyHold.messages.length > 0);
        const before = await frame.evaluate(() => ({ identity: window.BsvHardwareTransport.identity(),
            current: window.bsvHardware.getState().current, messages: window.__g6TypographyHold.messages.map(item => JSON.stringify(item.data)) }));
        await frame.locator('#toggle-inspector').click(); await frame.locator('#toggle-inspector').click();
        await frame.locator('#inspector').hover(); await frame.page().mouse.wheel(0, 120);
        const drawer = frame.locator('#code-drawer');
        if (await drawer.count()) { const open = await drawer.evaluate(node => node.open); await drawer.locator(':scope > summary').click();
            if (await drawer.evaluate(node => node.open) !== open) await drawer.locator(':scope > summary').click(); }
        const released = await frame.evaluate(() => {
            const hold = window.__g6TypographyHold; hold.active = false; window.removeEventListener('message', hold.listener, true);
            const messages = hold.messages.map(item => JSON.stringify(item.data));
            for (const item of hold.messages) window.dispatchEvent(new MessageEvent('message', { data: item.data, origin: item.origin }));
            return messages;
        });
        assert.deepEqual(released, before.messages, 'Delayed native response bytes/envelopes changed');
        await frame.waitForFunction(id => window.bsvHardware.getState().current?.disclosureState.analysis?.source?.referenceId === id
            && window.bsvHardware.getState().current.disclosureState.analysis.source.result?.readOnly === true, referenceId);
        await frame.waitForFunction(() => window.__g6TypographyHold.sourceEvents.some(event => event.status === 'complete'));
        const sourceEvents = await frame.evaluate(() => window.__g6TypographyHold.sourceEvents);
        assert.ok(!sourceEvents.some(event => ['cancelled', 'error'].includes(event.status)));
        const state = await settled(frame);
        assert.equal(state.current.analysis.result.queryId, before.current.analysis.result.queryId);
        assert.equal(state.current.snapshotId, before.current.snapshotId);
        return { status: 'pass', scope: 'Test-only delivery latency after actual native IPC arrival; no query/source mock or OS latency claim',
            queryId: state.current.analysis.result.queryId, beforeIdentity: before.identity, sourceEvents,
            responseHashes: before.messages.map(message => ({ bytes: Buffer.byteLength(message), sha256: hash(message) })) };
    } finally {
        await frame.evaluate(() => { const hold = window.__g6TypographyHold; if (hold) { hold.active = false;
            window.removeEventListener('message', hold.listener, true); window.removeEventListener('hardware:source', hold.sourceListener);
            delete window.__g6TypographyHold; } });
    }
}

async function run({ vsix, fixturePath, observerVsix, output = process.env.G6_OUTPUT_DIR || createRun('native-typography') }) {
    assert.ok(vsix && fixturePath && observerVsix, 'Explicit product VSIX, external fixtures and installed observer VSIX required');
    const fixtureBytes = fs.readFileSync(fixturePath), fixtures = JSON.parse(fixtureBytes), vsixHash = hash(fs.readFileSync(vsix));
    assert.equal(fixtures.schema, 'g6-native-fixtures-v1'); assert.equal(fixtures.status, 'pass');
    const report = { schema: 'g6-installed-typography-run-v1', status: 'running', startedAt: new Date().toISOString(),
        vsix: path.resolve(vsix), vsixSha256: vsixHash, fixturePath: path.resolve(fixturePath), fixtureSha256: hash(fixtureBytes),
        scope: 'Installed native Webview DOM, real editor, actual workbench themes and window bounds',
        actions: [], captures: [], userVisualDesignAcceptance: 'PENDING',
        nativeCjkFixture: { status: 'NOT RUN', reason: 'Controlled captured A/C use their unchanged actual source; prior G5 synthetic CJK is a separate display-only lane.' } };
    write(output, 'typography-contract.json', { ...report, fontFloorCssPx: 9, detailTargetCssPx: 12,
        requestedWindows: [{ width: 1280, height: 960 }, { width: 1600, height: 1000 }],
        narrowPolicy: 'Actual source-reveal split pane measured; do not call a different width 420px', productEditsAllowed: false });
    let native, frame, page;
    try {
        for (const key of ['A', 'C']) {
            const fixture = fixtures.fixtures[key], input = await loadNativeInput({ sourceRoot: fixtures.workspace,
                artifactRoot: fixtures.workspace, manifest: fixture.manifest, originApproved: true });
            fixture.authority = { architecture: createArchitecture({ importResult: input.importResult, analysis: input.analysis }),
                models: { stock: input.importResult.implementation, instrumented: input.originCase.request.importResult.implementation } };
        }
        native = await launchNative({ vsix, observerVsix, workspace: fixtures.workspace, output,
            harnessFiles: [__filename, path.resolve(__dirname, '../g5-readability/oracle.cjs'), path.resolve(__dirname, '../g4-fix/oracle/geometry.cjs')] });
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview());
        const capture = async (name, fixture, expectations) => {
            const row = await captureNative({ native, frame, page, output, name, authority: fixture.authority, expectations });
            report.captures.push({ name, inventory: row.inventory, verdict: row.verdict, mandatory: row.mandatory,
                window: row.measurement.native.hostWindow, frame: row.measurement.native.frameBounds, canvas: row.measurement.canvas });
            assert.equal(row.verdict.status, 'pass', `${name}: ${JSON.stringify(row.verdict.findings.slice(0, 12))}`);
            console.log(`NATIVE_TYPOGRAPHY_PASS ${name}`); return row;
        };
        const A = fixtures.fixtures.A, C = fixtures.fixtures.C;
        await registerBundle({ native, frame, page, fixture: A, needsSourceRoot: true });
        const selectedWriter = await writer(frame);
        report.sourceReveal = await sourceReveal({ native, frame, fixture: A, referenceId: selectedWriter.referenceId });
        await capture('T01-source-writer-split', A, { root: 'left', detail: true, selected: true });
        const cases = ['Dark Modern', 'Light Modern', 'Dark High Contrast'].map((name, index) => ({
            name: `T0${index + 2}-${['dark', 'light', 'contrast'][index]}`,
            apply: async context => report.actions.push(await theme(context, name, ['dark', 'light', 'high-contrast'][index])) }));
        cases.push({ name: 'T05-reduced-motion', apply: async () => {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await frame.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
            report.actions.push({ type: 'reduced-motion', scope: 'Per-page Chromium UA emulation; OS preference unchanged', actualMatch: true });
        } });
        await frame.locator('#breadcrumb button').first().click(); await settled(frame);
        report.typography = await runTypography({ native, frame, page, fixture: A, output, cases });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await frame.waitForFunction(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
        report.actions.push(await theme({ frame, page }, 'Dark Modern', 'dark'));
        let state = await settled(frame), before = identity(state); delete before.viewport;
        await frame.locator('#fit-selection').click(); await settled(frame);
        await capture('T06-selection-fit', A, { root: false, storages: ['state'], selected: true });
        await frame.locator('#fit').click(); state = await settled(frame);
        const after = identity(state); delete after.viewport; assert.deepEqual(after, before);
        await capture('T07-structure-fit', A, { root: 'left', storages: ['state'], contacts: ['put', 'get'], detail: true, fitAll: true });
        const normalResize = await resize({ native, page }, { width: 1280, height: 960 }); report.actions.push(normalResize);
        await frame.locator('#fit').click(); await settled(frame);
        await capture(process.env.G6_PRIOR_NORMAL_RESIZE ? 'T08-current-window-prior-resize-linked'
            : normalResize.status === 'pass' ? 'T08-normal-window' : 'T08-current-window', A,
            { root: 'left', storages: ['state'], detail: true, fitAll: true });
        report.actions.push(await closeSource(native, report.sourceReveal.editor.uri));
        if (await page.locator('.part.sidebar').isVisible()) await native.channel.request('uiCommand', { command: 'workbench.action.toggleSidebarVisibility' });
        const wideResize = await resize({ native, page }, { width: 1600, height: 1000 }); report.actions.push(wideResize);
        await frame.locator('#fit').click(); await settled(frame);
        await capture(wideResize.status === 'pass' ? 'T09-wide-window' : 'T09-wide-pane', A, { root: 'left', storages: ['state'], contacts: ['put', 'get'], detail: true, fitAll: true });
        report.sourceDelay = await sourceDelay({ frame });
        assert.match(await frame.locator('#readability-context').innerText(), /BSV owner: mkConnected\.left/);
        await capture('T10-delayed-source-restored', A, { root: false, storages: ['state'], selected: true });
        const wideWriter = await writer(frame);
        report.wideSourceReveal = await sourceReveal({ native, frame, fixture: A, referenceId: wideWriter.referenceId });
        assert.match(await frame.locator('#readability-context').innerText(), /BSV owner: mkConnected\.left/);
        await capture('T11-wide-editor-source', A, { root: false, storages: ['state'], selected: true });
        report.actions.push(await closeSource(native, report.wideSourceReveal.editor.uri));
        await registerBundle({ native, frame, page, fixture: C }); report.widths = [];
        for (const [name, width] of [['narrow', 8], ['wide', 12]]) {
            await frame.locator('#breadcrumb button').first().click(); await settled(frame); await enter(frame, name); await enter(frame, 'implementation');
            await capture(`T12-C-${name}-source`, C, { root: 'implementation', contacts: ['get'], detail: true, fitAll: true });
            await frame.locator('#rtl').click(); state = await settled(frame);
            const port = state.scene.contacts.find(item => item.ownerId === state.scene.shell.id && item.label === 'get'); assert.ok(port);
            assert.equal(port.bits.length, width); assert.equal(state.current.implementationContext.occurrencePath.at(-1), name);
            await chooseObject(frame, port.id); state = await analyze(frame, 'same-net');
            await frame.locator('#fit').click(); await settled(frame);
            const positions = frame.locator('.analysis-result p').filter({ hasText: /^Seed: .*; positions \[/ });
            await positions.scrollIntoViewIfNeeded();
            assert.match(await positions.innerText(), new RegExp(`positions \\[${Array.from({ length: width }, (_, index) => index).join(', ')}\\]`));
            const row = await capture(`T13-C-${name}-rtl-width`, C, { root: name, contacts: ['get'], selected: true, fitAll: true });
            report.widths.push({ name, width, current: row.state.current, inspector: await frame.locator('#inspector').innerText() });
            await frame.locator('#return-bsv').click(); await settled(frame);
        }
        report.hardware = await native.channel.request('observeHardware');
        await native.close(); assert.equal(native.receipt.status, 'passed'); report.status = 'pass';
    } catch (error) {
        report.status = 'fail'; report.error = error?.stack || String(error); process.exitCode = 1;
        if (native) {
            try { await native.capture('typography-failure', page); if (frame) { write(output, 'failure.measurement.json', await measureNative({ native, frame, page }));
                write(output, 'failure.state.json', await frame.evaluate(() => window.bsvHardware.getState()));
                fs.writeFileSync(path.join(output, 'failure.dom.txt'), await frame.locator('body').innerText(), { flag: 'wx' }); } }
            catch (failure) { report.captureError = failure.message; }
            await native.close('failed', error);
        }
        console.error(report.error);
    } finally {
        report.vsixUnchanged = hash(fs.readFileSync(vsix)) === vsixHash;
        report.fixtureUnchanged = hash(fs.readFileSync(fixturePath)) === hash(fixtureBytes);
        report.inputsPreserved = fixtures.inventory.every(row => { const bytes = fs.readFileSync(path.join(fixtures.workspace, row.path));
            return bytes.length === row.bytes && hash(bytes) === row.sha256; });
        if (!report.vsixUnchanged || !report.fixtureUnchanged || !report.inputsPreserved) { report.status = 'fail'; process.exitCode = 1; }
        report.finishedAt = new Date().toISOString(); write(output, 'native-typography.json', report);
        console.log(JSON.stringify({ output, status: report.status, error: report.error }));
    }
    return report;
}
if (require.main === module) {
    if (process.argv.includes('--help')) console.log('node native-typography.cjs PRODUCT.vsix EXTERNAL_FIXTURES.json OBSERVER.vsix\nUses a fresh isolated installed VSIX and actual native UI; all evidence goes to a unique G6 run.');
    else { const [vsix, fixturePath, observerVsix] = process.argv.slice(2); run({ vsix, fixturePath, observerVsix })
        .catch(error => { console.error(error?.stack || error); process.exitCode = 1; }); }
}
module.exports = { run };
