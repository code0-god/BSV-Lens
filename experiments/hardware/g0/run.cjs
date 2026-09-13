'use strict';

// Isolated audit: expected failures are evidence, not skipped or red default tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright');
const { parseBsvFile } = require('../../../src/architecture/parser');
const { normalizeConfig } = require('../../../src/architecture/config');
const { buildArchitectureModel } = require('../../../src/architecture/graph-builder');
const { createSemanticQueries } = require('../../../media/semantic-query');
const { ArchitecturePanel } = require('../../../src/panel/architecture-panel');
const { getBuildInfo } = require('../../../src/build-info');
const root = path.resolve(__dirname, '../../..');
const out = path.join(root, '.build/hardware/g0');
fs.mkdirSync(out, { recursive: true });
const records = [];
const snapshots = [];
const failures = [];
function save(name, value) {
    fs.writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);
}
function check(id, expectedFailure, observed, assertion) {
    try {
        assertion();
        records.push({ id, status: expectedFailure ? 'UNEXPECTED-PASS' : 'PASS', observed });
        if (expectedFailure) failures.push(id);
    } catch (error) {
        if (!(error instanceof assert.AssertionError)) throw error;
        records.push({ id, status: expectedFailure ? 'EXPECTED-FAILURE' : 'FAIL', observed,
            assertion: { message: error.message, actual: error.actual, expected: error.expected,
                operator: error.operator, stack: error.stack } });
        if (!expectedFailure) failures.push(id);
    }
}
function modelFor(file, top) {
    const source = fs.readFileSync(file, 'utf8');
    return buildArchitectureModel([parseBsvFile(source, {
        uri: `file://${file}`, relativePath: path.basename(file)
    })], normalizeConfig({ entrypoints: [top] }), { workspaceName: 'G0 audit', workspaceUri: 'file:///g0-audit' });
}
function semanticEvidence() {
    const model = modelFor(path.join(__dirname, 'delegation.bsv'), 'mkTop');
    const proxy = model.instances.find((item) => item.name === 'proxy');
    const behavior = model.stateBehaviors.find((item) => item.ownerInstanceId === proxy.id && item.name === 'value');
    const accesses = model.bindings.filter((item) => item.behaviorId === behavior.id);
    const incoming = model.semanticFlows.filter((item) => item.toBehaviorId === behavior.id);
    const structural = model.bindings.filter((item) => item.kind === 'constructor-binding' && item.targetInstanceId === proxy.id);
    const implementation = model.semanticFlows.find((item) => item.implementationLink && item.fromBehaviorId === behavior.id);
    check('G0-07-constant-delegation-fixed', false, { accesses, incoming, structural, implementation }, () => {
        assert.deepEqual(accesses, []);
        assert.deepEqual(incoming, []);
        assert.equal(structural.length, 1);
        assert.ok(implementation);
        assert.equal(JSON.stringify(model).includes('return upstream.value;'), false);
    });
    const queries = createSemanticQueries(model);
    const trace = queries.traceSemanticFlow({ fromId: implementation.fromId, toId: implementation.toId, kinds: ['return'] });
    const projected = model.edges.filter((edge) => edge.semanticFlowId === implementation.id);
    check('S32-08-hidden-implementation-trace', false, { trace, projected }, () => {
        assert.deepEqual(projected, []);
        assert.equal(trace.status, 'exact');
        assert.equal(trace.paths[0].steps[0].flowId, implementation.id);
    });
    save('delegation-model.json', model);
}
async function hostIdentityEvidence() {
    const model = modelFor(path.join(__dirname, 'delegation.bsv'), 'mkTop');
    const sent = [];
    const panel = Object.create(ArchitecturePanel.prototype);
    Object.assign(panel, {
        panel: { webview: { postMessage: (message) => { sent.push(message); return Promise.resolve(true); } } },
        request: {}, refreshToken: 0, modelRevision: 0,
        context: { buildInfo: getBuildInfo({ extensionPath: root, extensionMode: 2 }) },
        analyzer: { analyze: async () => model }, vscode: {},
        defaultView: () => 'system', defaultViewState: () => ({}),
        resolveInitialFocus: () => null,
        reportError: (error) => { throw error; }
    });
    await panel.refresh();
    const refreshed = sent.find((item) => item.type === 'model');
    sent.length = 0;
    await panel.handleMessage({ type: 'ready' });
    const ready = sent.find((item) => item.type === 'model');
    check('S32-10-refresh-build-envelope', true,
        { refreshBuildInfo: refreshed.buildInfo ?? null, readyBuildInfo: ready.buildInfo },
        () => assert.deepEqual(refreshed.buildInfo, ready.buildInfo));
}
async function startPreview() {
    const token = crypto.randomBytes(18).toString('hex');
    const child = spawn(process.execPath, ['scripts/preview-webview.js'], {
        cwd: root, env: { ...process.env, PORT: '0', BSV_PREVIEW_TOKEN: token,
            BSV_TEST_WORKSPACE: path.join(root, 'test/fixtures/semantic-workspace') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const url = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { child.kill(); reject(new Error(`Preview readiness timeout: ${stderr}`)); }, 15000);
        child.once('error', (error) => { clearTimeout(timeout); reject(error); });
        child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Preview exit ${code}: ${stderr}`)); });
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            const ready = /READY (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
            if (ready) { clearTimeout(timeout); resolve(ready[1]); }
        });
    });
    return { child, url, token, logs: () => ({ stdout, stderr }) };
}
async function browserEvidence() {
    const preview = await startPreview();
    let browser;
    try {
        browser = await chromium.launch(process.env.CHROMIUM_PATH
            ? { executablePath: process.env.CHROMIUM_PATH, headless: true }
            : { channel: 'chrome', headless: true });
        const page = await browser.newPage({ viewport: { width: 1600, height: 1100 },
            reducedMotion: 'reduce', extraHTTPHeaders: { 'x-bsv-preview-token': preview.token } });
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', (error) => { errors.push(error.message); save('browser-errors.json', errors); });
        // Install before navigation/action; completion is the production setState event.
        await page.addInitScript(() => {
            window.__g0Initial = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Initial state event missing')), 10000);
                window.addEventListener('bsv-webview-state', () => { clearTimeout(timeout); resolve(true); }, { once: true });
            });
        });
        const load = async () => {
            await page.goto(preview.url);
            await page.evaluate(() => window.__g0Initial.then(() => true));
        };
        const action = async (perform) => {
            await page.evaluate(() => {
                window.__g0Action = new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => { window.removeEventListener('bsv-webview-state', done); reject(new Error('State event missing')); }, 10000);
                    function done() { clearTimeout(timeout); resolve(true); }
                    window.addEventListener('bsv-webview-state', done, { once: true });
                });
            });
            await perform();
            await page.evaluate(() => window.__g0Action);
        };
        const node = (name, kind) => page.locator(`.arch-node.kind-${kind}`).filter({
            has: page.locator('.node-title', { hasText: new RegExp(`^${name}$`) })
        });
        const snap = async (name) => {
            const value = await page.evaluate(() => {
                const state = window.__savedState;
                const projected = window.BsvArchitectureGraph.createViewModel(window.__model, state).visible({
                    focusId: state.projectionFocusId || state.focusStack.at(-1) || null
                });
                const elements = [...document.querySelectorAll('.arch-node')];
                const ids = new Set(elements.map((element) => element.dataset.nodeId));
                return { state, header: document.querySelector('#focus-summary').textContent,
                    subtitle: document.querySelector('#architecture-subtitle').textContent,
                    breadcrumb: document.querySelector('#breadcrumbs').textContent,
                    empty: !document.querySelector('#empty-state').hidden,
                    nodes: elements.map((element) => ({ id: element.dataset.nodeId,
                        title: element.querySelector('.node-title')?.textContent,
                        dimmed: element.classList.contains('selection-dimmed'),
                        aria: element.getAttribute('aria-label') })),
                    effectiveFocusId: projected.focusId,
                    groups: projected.nodes.filter((item) => item.kind === 'member-group').map((item) => ({
                        id: item.id, bucket: item.bucket, reported: item.visibleCount, total: item.totalCount,
                        actual: item.sourceIds.filter((id) => ids.has(id)).length
                    })),
                    inspector: document.querySelector('#inspector').innerText };
            });
            snapshots.push({ name, ...value });
            return value;
        };
        await load();
        await action(() => node('mkFlowTop', 'instance').dblclick());
        let value = await snap('root-entry');
        check('S32-09-root-entry-fixed', false, { level: value.state.level, path: value.state.focusStack, empty: value.empty }, () => {
            assert.equal(value.state.level, 'module');
            assert.equal(value.state.focusStack.length, 1);
            assert.ok(value.state.focusStack[0].startsWith('instance:'));
            assert.equal(value.empty, false);
        });
        await load();
        await action(() => node('scheduler', 'instance').dblclick());
        value = await snap('scheduler-entry');
        check('S32-09-occurrence-entry-fixed', false, value, () => {
            assert.equal(value.state.level, 'module');
            assert.ok(value.state.focusStack.at(-1).startsWith('instance:'));
            assert.equal(value.empty, false);
            assert.ok(value.nodes.some((item) => item.title === 'Work'));
        });
        const internal = value.nodes.filter((item) => item.id !== value.state.selectedId && !item.id.startsWith('member-group:'));
        assert.ok(internal.length > 0);
        check('G0-04-parent-selection-dimming', true, internal,
            () => assert.deepEqual(internal.filter((item) => item.dimmed).map((item) => item.id), []));
        await page.screenshot({ path: path.join(out, 'parent-dimming.png') });
        await action(() => page.getByRole('button', { name: 'Enter scheduler', exact: true }).click());
        const entered = await snap('repeated-entry');
        check('G0-01-repeated-entry', true,
            { before: value.state.navigationHistory.back.length, after: entered.state.navigationHistory.back.length },
            () => assert.equal(entered.state.navigationHistory.back.length, value.state.navigationHistory.back.length));

        const before = entered.state.navigationHistory.back.length;
        await action(() => page.getByRole('button', { name: 'Set as focus', exact: true }).click());
        const first = await snap('first-focus');
        await action(() => page.getByRole('button', { name: 'Set as focus', exact: true }).click());
        const second = await snap('repeated-focus');
        check('G0-01-repeated-focus', true,
            { before, first: first.state.navigationHistory.back.length, second: second.state.navigationHistory.back.length },
            () => assert.equal(second.state.navigationHistory.back.length, first.state.navigationHistory.back.length));
        await action(() => page.locator('#focus-back').click());
        const back = await snap('back-after-repeated-focus');
        check('G0-01-back-revisits-same-scene', true,
            { before: second.state.focusStack, after: back.state.focusStack },
            () => assert.notDeepEqual(back.state.focusStack, second.state.focusStack));

        await action(() => node('Methods', 'member-group').click());
        await action(() => node('currentWork', 'method').click());
        await action(() => page.getByRole('button', { name: 'Set as focus', exact: true }).click());
        // Structure membership is connected through the owner; data-flow exposes the late filter seam.
        await action(() => page.locator('[data-analysis-mode="data-flow"]').click());
        value = await snap('method-projection');
        const mismatch = value.groups.filter((group) => group.actual !== group.reported);
        check('G0-06-final-visible-count', true, value.groups, () => assert.deepEqual(mismatch, []));
        await page.screenshot({ path: path.join(out, 'count-mismatch.png') });
        const methodFocus = value.state.projectionFocusId;
        assert.ok(methodFocus);
        // Ascent is independent of repeated Focus history: start from this valid method scene.
        const historyBeforeBreadcrumb = value.state.navigationHistory.back.length;
        await action(() => page.locator('#breadcrumbs').getByRole('button', { name: 'mkFlowTop', exact: true }).click());
        value = await snap('parent-breadcrumb');
        check('G0-02-breadcrumb-residual-focus', true,
            { previousMethod: methodFocus, focusStack: value.state.focusStack, projectionFocusId: value.state.projectionFocusId },
            () => assert.equal(value.state.projectionFocusId, null));
        check('G0-03-header-scene-mismatch', true,
            { header: value.header, headerOwner: value.state.focusStack.at(-1), actualFilter: value.effectiveFocusId,
                selection: value.state.selectedId, visibleIds: value.nodes.map((item) => item.id) },
            () => assert.equal(value.effectiveFocusId, value.state.focusStack.at(-1)));
        check('G0-02-breadcrumb-history', true,
            { before: historyBeforeBreadcrumb, after: value.state.navigationHistory.back.length },
            () => assert.equal(value.state.navigationHistory.back.length, historyBeforeBreadcrumb + 1));
        await page.screenshot({ path: path.join(out, 'breadcrumb-mismatch.png') });

        // The separate literal Focus button enters behavior, rather than focusEntity.
        await load();
        await action(() => node('scheduler', 'instance').dblclick());
        await action(() => node('Methods', 'member-group').click());
        await action(() => node('currentWork', 'method').click());
        await action(() => page.getByRole('button', { name: 'Focus', exact: true }).click());
        const behaviorFirst = await snap('first-behavior-focus');
        await action(() => page.getByRole('button', { name: 'Focus', exact: true }).click());
        const behaviorAgain = await snap('repeated-behavior-focus');
        assert.equal(behaviorFirst.state.level, 'behavior');
        assert.equal(behaviorAgain.state.selectedId, behaviorFirst.state.selectedId);
        assert.deepEqual(behaviorAgain.state.focusStack, behaviorFirst.state.focusStack);
        check('G0-01-repeated-behavior-focus', true,
            { before: behaviorFirst.state.navigationHistory.back.length,
                after: behaviorAgain.state.navigationHistory.back.length,
                selectedId: behaviorAgain.state.selectedId, focusStack: behaviorAgain.state.focusStack },
            () => assert.equal(behaviorAgain.state.navigationHistory.back.length, behaviorFirst.state.navigationHistory.back.length));

        await load();
        await action(() => node('loose', 'instance').dblclick());
        value = await snap('unresolved-interface-entry');
        check('S32-04-leaf-unresolved-interface', false, value, () => {
            assert.equal(value.empty, false);
            assert.ok(value.state.focusStack.at(-1).startsWith('instance:'));
        });

        const payloadModel = modelFor(path.join(__dirname, 'payload.bsv'), 'mkPort');
        const channel = payloadModel.protocolChannels[0];
        assert.equal(channel.direction, 'request-response');
        const typedLegs = payloadModel.endpoints.flatMap((item) => [item.resultType, ...(item.parameters || []).map((parameter) => parameter.type)])
            .filter((type) => type && /^Bit#/.test(type));
        assert.deepEqual([...new Set(typedLegs)].sort(), ['Bit#(16)', 'Bit#(8)']);
        await action(() => page.evaluate((model) => {
            window.__model = model;
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'model', model, revision: 5,
                initial: { level: 'module', focusId: model.architectureRoots[0] } } }));
        }, payloadModel));
        await action(() => node('Port', 'protocol-channel').dblclick());
        value = await snap('composite-null-payload');
        const payloadField = await page.evaluate(() => {
            const term = [...document.querySelectorAll('#inspector dt')].find((item) => item.textContent === 'Payload Type');
            return term?.nextElementSibling?.textContent;
        });
        // Assert machine-consumed HDL types, not wording of explanatory prose.
        check('G0-05-composite-null-payload', true, { canonical: channel, typedLegs, payloadField,
            inspector: value.inspector }, () => assert.ok(typedLegs.every((type) => payloadField.includes(type))));
        await page.screenshot({ path: path.join(out, 'composite-null-payload.png') });
        save('payload-model.json', payloadModel);
        const unknownModel = modelFor(path.join(__dirname, 'unknown.bsv'), 'mkOpaque');
        unknownModel.workspaceUri = 'file:///g0-unknown';
        await action(() => page.evaluate((model) => {
            window.__model = model;
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'model', model, revision: 6,
                initial: { level: 'module', focusId: model.architectureRoots[0] } } }));
        }, unknownModel));
        await action(() => node('opaque', 'endpoint').dblclick());
        value = await snap('unknown-interface-payload');
        const unknown = unknownModel.endpoints.find((item) => item.name === 'opaque');
        assert.equal(unknown.resolutionStatus, 'unresolved');
        const unknownField = await page.evaluate(() => {
            const term = [...document.querySelectorAll('#inspector dt')].find((item) => item.textContent === 'Payload Type');
            return term?.nextElementSibling?.textContent;
        });
        check('G0-05-unknown-payload', true, { canonical: unknown, payloadField: unknownField, inspector: value.inspector },
            () => assert.ok(unknownField.includes(unknown.interfaceType)));
        await page.screenshot({ path: path.join(out, 'unknown-payload.png') });

        const blackboxModel = modelFor(path.join(__dirname, 'blackbox.bsv'), 'mkTop');
        blackboxModel.workspaceUri = 'file:///g0-blackbox';
        const blackbox = blackboxModel.instances.find((item) => item.name === 'blackbox');
        assert.equal(blackbox.targetResolutionStatus, 'unresolved');
        await action(() => page.evaluate((model) => {
            window.__model = model;
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'model', model, revision: 6, initial: { level: 'system' } } }));
        }, blackboxModel));
        await action(() => node('blackbox', 'instance').dblclick());
        value = await snap('blackbox-entry');
        check('S32-04-blackbox-entry', false, { canonical: blackbox, nodes: value.nodes, empty: value.empty }, () => {
            assert.equal(value.empty, false);
            assert.ok(value.nodes.some((item) => item.id === blackbox.id));
            assert.equal(value.state.focusStack.at(-1), blackbox.id);
        });

        const metadata = require('../../../media/build-metadata');
        await action(() => page.evaluate((metadata) => {
            globalThis.BsvLensBuildInfo = metadata;
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'model', model: window.__model,
                buildInfo: { ...metadata, buildId: 'g0-mixed-build', buildVersion: metadata.version }, revision: 6 } }));
        }, metadata));
        let buildState = await page.locator('#build-about').getAttribute('data-status');
        check('S32-10-mixed-build-diagnostic', false, { buildState }, () => assert.equal(buildState, 'mismatch'));
        await action(() => page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'model', model: window.__model, revision: 7 }
        }))));
        buildState = await page.locator('#build-about').getAttribute('data-status');
        check('S32-10-missing-host-false-match', true, { buildState }, () => assert.notEqual(buildState, 'matched'));
        check('browser-page-errors', false, errors, () => assert.deepEqual(errors, []));
        save('browser-errors.json', errors);
        save('browser-runtime.json', { browserVersion: browser.version(), preview: preview.logs(), snapshots });
    } finally {
        if (browser) await browser.close();
        const exited = once(preview.child, 'exit', { signal: AbortSignal.timeout(10000) });
        preview.child.kill('SIGTERM');
        await exited;
    }
}
async function main() {
    save('baseline.json', {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
        node: process.version, platform: process.platform, arch: process.arch,
        host: getBuildInfo({ extensionPath: root, extensionMode: 2 }),
        installed: getBuildInfo({ extensionPath: path.join(process.env.HOME, '.vscode/extensions/code0-god.bsv-lens-0.4.1'), extensionMode: 1 }),
        aqua: require('../../../scripts/aqua-fixture').assertAquaFixture(path.join(root, '.build/aqua-041-pinned'))
    });
    semanticEvidence();
    await hostIdentityEvidence();
    await browserEvidence();
    save('results.json', { records, unexpected: failures });
    for (const item of records) console.log(`${item.status} ${item.id}`);
    assert.deepEqual(failures, [], 'Audit baseline changed or unexpected harness failure; inspect results.json');
}
main().catch((error) => {
    save('results.json', { records, unexpected: failures, fatal: error.stack, snapshots });
    console.error(error);
    process.exitCode = 1;
});
