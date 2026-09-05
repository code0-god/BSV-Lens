#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { chromium } = require('playwright');
const { runTests, runVSCodeCommand } = require('@vscode/test-electron');

const ROOT = path.resolve(__dirname, '..');
const TARGET_ID = 'code0-god.bsv-lens';
const TARGET_VERSION = '0.4.1';
const VSCODE = path.join(ROOT, '.vscode-test', 'vscode-darwin-arm64-1.136.1',
    'Visual Studio Code.app', 'Contents', 'MacOS', 'Code');
const OBSERVER = path.join(ROOT, 'test', 'fixtures', 'vsix-smoke-observer');
const SOURCE = path.join(ROOT, 'test', 'fixtures', 'semantic-workspace', 'src', 'SemanticFlowFixture.bsv');
const OUTPUT = path.join(ROOT, '.build', 'system-code');
const DEFAULT_VSIX = path.join(ROOT, 'dist', 'bsv-lens-0.4.1.vsix');
const TIMEOUT = 20_000;

async function main() {
    const vsix = path.resolve(process.argv[2] || DEFAULT_VSIX);
    validateInputs(vsix);
    fs.mkdirSync(OUTPUT, { recursive: true });
    const runId = `${Date.now()}-${process.pid}`;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blv-'));
    const userDataDir = path.join(profile, 'u');
    const extensionsDir = path.join(profile, 'e');
    const receiptPath = path.join(OUTPUT, 'vsix-smoke-receipt.json');
    const receipt = {
        schemaVersion: 1,
        status: 'running',
        startedAt: new Date().toISOString(),
        runId,
        vsix,
        vsixSha256: sha256(vsix),
        vscodeExecutable: VSCODE,
        isolation: { profile, userDataDir, extensionsDir },
        installation: null,
        installedTarget: null,
        buildIdentity: null,
        navigation: [],
        nativeHostMessages: [],
        editorRevealSource: null,
        postSourceState: null,
        editorSelections: [],
        browserErrors: [],
        cdpTargets: [],
        frameTree: [],
        screenshots: [],
        shutdownExitCode: null
    };

    let signalServer;
    let browser;
    let testsPromise;
    try {
        const archive = readArchiveIdentity(vsix);
        receipt.archive = archive;
        const install = await runVSCodeCommand([
            `--user-data-dir=${userDataDir}`,
            `--extensions-dir=${extensionsDir}`,
            '--install-extension', vsix,
            '--force'
        ], { vscodeExecutablePath: VSCODE, reuseMachineInstall: true });
        receipt.installation = { exitCode: 0, stdout: install.stdout.trim(), stderr: install.stderr.trim() };
        const listed = await runVSCodeCommand([
            `--user-data-dir=${userDataDir}`,
            `--extensions-dir=${extensionsDir}`,
            '--list-extensions', '--show-versions'
        ], { vscodeExecutablePath: VSCODE, reuseMachineInstall: true });
        assert.match(listed.stdout, new RegExp(`(?:^|\\n)${escapeRegExp(TARGET_ID)}@${TARGET_VERSION}(?:\\n|$)`, 'i'),
            `isolated CLI listing does not contain ${TARGET_ID}@${TARGET_VERSION}`);
        receipt.installation.listExtensions = listed.stdout.trim().split(/\r?\n/).filter(Boolean);
        writeReceipt(receiptPath, receipt);

        signalServer = await createSignalServer();
        const cdpPort = await reservePort();
        const output = outputMonitor();
        testsPromise = runTests({
            vscodeExecutablePath: VSCODE,
            extensionDevelopmentPath: OBSERVER,
            extensionTestsPath: path.join(OBSERVER, 'index.js'),
            extensionTestsEnv: {
                BSV_VSIX_SMOKE_PORT: String(signalServer.port),
                BSV_VSIX_EXTENSIONS_DIR: extensionsDir,
                BSV_VSIX_SOURCE: SOURCE
            },
            stdout: output.stdout,
            stderr: output.stderr,
            launchArgs: [
                path.dirname(path.dirname(SOURCE)),
                `--user-data-dir=${userDataDir}`,
                `--extensions-dir=${extensionsDir}`,
                `--remote-debugging-port=${cdpPort}`,
                '--disable-workspace-trust',
                '--skip-welcome',
                '--skip-release-notes',
                '--disable-updates',
                '--no-cached-data'
            ],
            reuseMachineInstall: true
        });
        testsPromise.catch(() => {});

        const observer = await signalServer.waitFor('observerReady', () => true, TIMEOUT);
        validateInstalledTarget(observer.target, extensionsDir);
        receipt.installedTarget = observer.target;
        assert.ok(archive.buildInfo,
            'Installed VSIX omits media/build-metadata.js; refusing to treat this old artifact as final validation.');
        await output.waitFor(/DevTools listening on ws:\/\//, TIMEOUT);
        browser = await withTimeout(chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`), TIMEOUT,
            'Timed out connecting Playwright to VS Code CDP.');
        const context = browser.contexts()[0];
        assert.ok(context, 'VS Code CDP did not expose a browser context.');
        await context.addInitScript({ content: observationScript() });
        for (const workbench of context.pages()) observeBrowserErrors(workbench, receipt);
        context.on('page', (page) => observeBrowserErrors(page, receipt));

        const frameSignal = waitForWebviewFrame(context, TIMEOUT);
        signalServer.send({ type: 'openPanel' });
        await signalServer.waitFor('panelCommandReturned', () => true, TIMEOUT);
        let webview;
        try {
            webview = await frameSignal;
        } finally {
            const evidence = await collectCdpEvidence(browser, context);
            receipt.cdpTargets = evidence.targets;
            receipt.frameTree = evidence.frames;
            writeReceipt(receiptPath, receipt);
        }
        const { frame: page, page: workbenchPage } = webview;
        const modelMessage = await waitForObserved(page, 'host',
            (value) => value?.type === 'model' && value?.buildInfo, TIMEOUT);
        const model = modelMessage.value.model;
        receipt.buildIdentity = validateBuildIdentity(archive, observer.target, modelMessage.value.buildInfo,
            await page.evaluate(() => globalThis.BsvLensBuildInfo || null), gitHead());
        receipt.model = summarizeModel(model);

        const ids = await page.evaluate(() => {
            const modelValue = globalThis.__bsvVsixSmoke.lastModel;
            const root = modelValue.nodes.find((node) => node.architectureInstance && node.details?.root
                && node.name === 'mkFlowTop');
            const child = modelValue.nodes.find((node) => node.architectureInstance && node.parentId === root?.id
                && node.name === 'scheduler');
            const channel = modelValue.protocolChannels.find((item) => item.ownerInstanceId === child?.id
                && item.name === 'Work');
            const endpoint = modelValue.endpoints.find((item) => item.ownerInstanceId === child?.id
                && item.name === 'currentWork');
            const queryApi = globalThis.BsvArchitectureSemanticQuery;
            if (typeof queryApi?.createSemanticQueries !== 'function') {
                throw new Error('Installed webview omits the canonical semantic query API.');
            }
            const queries = queryApi.createSemanticQueries(modelValue);
            const resolved = queries.resolveEndpointImplementation(endpoint?.id, {
                ownerInstanceId: child?.id
            });
            const implementation = resolved.behavior;
            const slice = queries.getBehaviorSlice(implementation?.id, {
                ownerInstanceId: child?.id
            });
            const returned = slice.statements?.find((item) => item.kind === 'return');
            const returnExpression = slice.expressions?.find((item) => item.id === returned?.expressionId);
            return { root: root?.id, child: child?.id, channel: channel?.id,
                endpoint: endpoint?.id, implementation: implementation?.id,
                implementationStatus: resolved.status, behaviorSliceStatus: slice.status,
                returnExpression: returnExpression?.id, returnKind: returnExpression?.kind,
                sourceRevision: returnExpression?.sourceRevision, sourceRange: returnExpression?.sourceRange };
        });
        assert.equal(ids.implementationStatus, 'exact',
            'canonical currentWork endpoint implementation is not exact');
        assert.equal(ids.behaviorSliceStatus, 'exact', 'canonical currentWork behavior slice is not exact');
        for (const name of [
            'root', 'child', 'channel', 'endpoint', 'implementation',
            'returnExpression', 'returnKind', 'sourceRevision', 'sourceRange'
        ]) assert.ok(ids[name], `real analyzer model lacks ${name} identity`);

        await navigationDblClick(page, 'mkFlowTop', 'instance', ids.root, receipt);
        await navigationDblClick(page, 'scheduler', 'instance', ids.child, receipt);
        await navigationDblClick(page, 'Work', 'protocol-channel', ids.channel, receipt);
        await clickState(page, page.getByRole('button', { name: 'Inspect currentWork endpoint', exact: true }),
            (state) => state.selectedId === ids.endpoint, 'currentWork endpoint', receipt);
        await clickState(page, page.getByRole('button', { name: 'Inspect currentWork implementation', exact: true }),
            (state) => state.selectedId === ids.implementation && state.level === 'behavior',
            'currentWork implementation', receipt);

        const returnButton = page.getByRole('button', { name: 'Inspect return expression', exact: true });
        await returnButton.waitFor({ state: 'visible', timeout: TIMEOUT });
        await clickState(page, returnButton,
            (state) => state.selectedId === ids.implementation
                && state.analysisContext?.subject?.kind === ids.returnKind
                && state.analysisContext.subject.id === ids.returnExpression
                && state.analysisContext.presentationId === ids.implementation
                && state.analysisContext.ownerInstanceId === ids.child
                && state.analysisContext.rootInstanceId === ids.root
                && JSON.stringify(state.analysisContext.occurrencePath) === JSON.stringify([ids.root, ids.child])
                && state.analysisContext.sourceRevision === ids.sourceRevision,
            'Code return expression', receipt);
        const codeState = receipt.navigation.at(-1).state;
        const sourceButton = page.getByRole('button', { name: 'Open selected source', exact: true });
        await sourceButton.waitFor({ state: 'visible', timeout: TIMEOUT });
        const expectedOpenSource = waitForObserved(page, 'post',
            (message) => message?.type === 'openSource', TIMEOUT);
        const expectedSelection = signalServer.waitFor('selection',
            (event) => selectionMatchesRange(event, ids.sourceRange), TIMEOUT);
        const expectedRevealSource = waitForObserved(page, 'host',
            (message) => message?.type === 'revealSource', TIMEOUT);
        await sourceButton.click();
        const openSource = (await expectedOpenSource).value;
        assert.equal(openSource.context?.subject?.id, codeState.analysisContext.subject.id,
            'openSource lost the inspected Code subject');
        const selection = await expectedSelection;
        validateSourceSelection(openSource, selection, ids.sourceRange);
        const revealSource = (await expectedRevealSource).value;
        assert.ok(revealSource.sourceReference?.references?.some((reference) =>
            reference.id === ids.returnExpression),
        'native editor revealSource did not reference the currentWork return expression');
        await withTimeout(page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve))),
            TIMEOUT, 'The native editor revealSource did not reach the rendered webview state.');
        const postSourceState = await page.evaluate(() => globalThis.__bsvVsixSmoke.states.at(-1));
        receipt.nativeHostMessages = await page.evaluate(() => globalThis.__bsvVsixSmoke.posts);
        receipt.editorRevealSource = revealSource;
        receipt.postSourceState = postSourceState;
        receipt.editorSelections.push(selection);
        await capture(workbenchPage, 'vsix-smoke-code-source.png', receipt);
        assert.deepEqual({
            analysisContext: postSourceState?.analysisContext,
            navigationHistory: postSourceState?.navigationHistory
        }, {
            analysisContext: codeState.analysisContext,
            navigationHistory: codeState.navigationHistory
        }, 'native editor revealSource changed the exact Code context or navigation history');

        await historyClick(page, 'Back', (state) => state.selectedId === ids.channel
            && state.analysisContext?.subject?.kind === 'protocol-channel'
            && state.analysisContext.subject.id === ids.channel
            && state.analysisContext.presentationId === ids.channel
            && state.analysisContext.ownerInstanceId === ids.child
            && state.analysisContext.rootInstanceId === ids.root
            && JSON.stringify(state.analysisContext.occurrencePath) === JSON.stringify([ids.root, ids.child]),
        'Back to Work channel', receipt);
        await historyClick(page, 'Back', (state) => state.selectedId === ids.child
            && state.analysisContext?.subject?.kind === 'instance'
            && state.analysisContext.subject.id === ids.child
            && state.analysisContext.ownerInstanceId === ids.child
            && state.analysisContext.rootInstanceId === ids.root
            && JSON.stringify(state.analysisContext.occurrencePath) === JSON.stringify([ids.root, ids.child]),
        'Back to scheduler', receipt);
        await historyClick(page, 'Forward', (state) => state.selectedId === ids.channel
            && state.analysisContext?.subject?.kind === 'protocol-channel'
            && state.analysisContext.subject.id === ids.channel,
        'Forward to Work channel', receipt);
        await historyClick(page, 'Forward', (state) => state.selectedId === ids.implementation
            && state.analysisContext?.subject?.kind === ids.returnKind
            && state.analysisContext.subject.id === ids.returnExpression
            && state.analysisContext.presentationId === ids.implementation
            && state.analysisContext.ownerInstanceId === ids.child
            && state.analysisContext.rootInstanceId === ids.root
            && JSON.stringify(state.analysisContext.occurrencePath) === JSON.stringify([ids.root, ids.child])
            && state.analysisContext.sourceRevision === ids.sourceRevision,
        'Forward to Code return expression', receipt);
        await capture(workbenchPage, 'vsix-smoke-final.png', receipt);
        assert.deepEqual(receipt.browserErrors, [], 'installed webview emitted browser errors');

        signalServer.send({ type: 'complete' });
        const exitCode = await withTimeout(testsPromise, TIMEOUT, 'VS Code did not shut down after observer completion.');
        assert.equal(exitCode, 0, 'VS Code extension-host process did not exit cleanly.');
        receipt.shutdownExitCode = exitCode;
        receipt.status = 'passed';
        receipt.finishedAt = new Date().toISOString();
        writeReceipt(receiptPath, receipt);
        console.log(`VSIX smoke passed: ${receiptPath}`);
    } catch (error) {
        receipt.status = 'failed';
        receipt.finishedAt = new Date().toISOString();
        receipt.failure = error?.stack || String(error);
        if (browser) {
            const context = browser.contexts()[0];
            if (context) {
                const evidence = await collectCdpEvidence(browser, context);
                receipt.cdpTargets = evidence.targets;
                receipt.frameTree = evidence.frames;
            }
        }
        if (testsPromise) {
            try {
                signalServer?.send({ type: 'complete' });
                receipt.shutdownExitCode = await withTimeout(testsPromise, TIMEOUT,
                    'VS Code did not shut down after smoke failure.');
            } catch (shutdownError) {
                receipt.shutdownFailure = shutdownError?.stack || String(shutdownError);
            }
        }
        writeReceipt(receiptPath, receipt);
        throw error;
    } finally {
        await browser?.close().catch(() => {});
        await signalServer?.close().catch(() => {});
    }
}

function validateInputs(vsix) {
    for (const candidate of [vsix, VSCODE, path.join(OBSERVER, 'package.json'), SOURCE]) {
        assert.ok(fs.existsSync(candidate), `Required smoke input is absent: ${candidate}`);
    }
}

function readArchiveIdentity(vsix) {
    const manifest = JSON.parse(execFileSync('unzip', ['-p', vsix, 'extension/package.json'], { encoding: 'utf8' }));
    assert.equal(`${manifest.publisher}.${manifest.name}`, TARGET_ID, 'VSIX extension id mismatch');
    assert.equal(manifest.version, TARGET_VERSION, 'VSIX extension version mismatch');
    let buildInfo = null;
    try {
        const source = execFileSync('unzip', ['-p', vsix, 'extension/media/build-metadata.js'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
        });
        const sandbox = { globalThis: {} };
        vm.runInNewContext(source, sandbox, { filename: 'build-metadata.js', timeout: 1000 });
        buildInfo = sandbox.globalThis.BsvLensBuildInfo || sandbox.BsvLensBuildInfo || null;
    } catch {
        buildInfo = null;
    }
    return { extensionId: TARGET_ID, version: manifest.version, buildInfo };
}

function validateInstalledTarget(target, extensionsDir) {
    assert.equal(target.id.toLowerCase(), TARGET_ID);
    assert.equal(target.version, TARGET_VERSION);
    const installed = path.resolve(target.extensionPath);
    const isolated = path.resolve(extensionsDir);
    assert.ok(installed.startsWith(`${isolated}${path.sep}`), 'installed extension path is not isolated');
}

function validateBuildIdentity(archive, target, host, webview, expectedHead = archive.buildInfo?.sourceCommit) {
    assert.ok(archive.buildInfo, 'VSIX omits media/build-metadata.js or its BsvLensBuildInfo global.');
    assert.ok(host, 'real analyzer model omits model.buildInfo.');
    assert.ok(webview, 'installed webview omits global BsvLensBuildInfo.');
    const expected = {
        extensionId: TARGET_ID,
        version: TARGET_VERSION,
        sourceCommit: archive.buildInfo.sourceCommit,
        buildId: archive.buildInfo.buildId,
        dirty: archive.buildInfo.dirty
    };
    for (const [surface, value] of [['archive', archive.buildInfo], ['host', host], ['webview', webview]]) {
        assert.equal(value.extensionId, expected.extensionId, `${surface} extensionId mismatch`);
        assert.equal(value.version, expected.version, `${surface} version mismatch`);
        assert.equal(value.sourceCommit, expected.sourceCommit, `${surface} sourceCommit mismatch`);
        assert.equal(value.buildId, expected.buildId, `${surface} buildId mismatch`);
    }
    assert.equal(host.metadataStatus, 'packaged', 'host metadataStatus is not packaged');
    assert.equal(host.extensionMode, 'installed', 'host extensionMode is not installed');
    assert.equal(host.sourceCommit, expectedHead, 'packaged sourceCommit is not final HEAD');
    assert.equal(host.dirty, archive.buildInfo.dirty,
        'host dirty metadata differs from the installed VSIX archive');
    assert.equal(webview.dirty, archive.buildInfo.dirty,
        'webview dirty metadata differs from the installed VSIX archive');
    assert.equal(path.resolve(host.extensionPath), path.resolve(target.extensionPath),
        'host extensionPath differs from installed target path');
    return { expected, archive: archive.buildInfo, host, webview };
}

function summarizeModel(model) {
    return {
        title: model.title,
        stats: model.stats,
        codeAnalysisVersion: model.codeAnalysisVersion,
        sourceDocuments: (model.sourceDocuments || []).map((item) => ({ uri: item.uri, revision: item.revision }))
    };
}

function selectionMatchesRange(selection, expectedRange) {
    return Boolean(selection?.text && expectedRange?.uri
        && selection.uri === expectedRange.uri
        && selection.range?.start?.line === expectedRange.line
        && selection.range.start.character === expectedRange.column
        && selection.range?.end?.line === expectedRange.endLine
        && selection.range.end.character === expectedRange.endColumn);
}

function validateSourceSelection(message, selection, expectedRange = message.location) {
    assert.equal(message.type, 'openSource');
    assert.ok(message.location?.uri || message.nodeId, 'openSource omitted both location and nodeId');
    assert.ok(selection.text, 'native editor selection is empty');
    assert.match(selection.text, /return\s+makeArrayWork|makeArrayWork/,
        'native editor selection is not the currentWork return source');
    if (expectedRange?.uri) {
        assert.equal(message.location?.uri, expectedRange.uri, 'openSource URI differs from Code subject');
        assert.equal(selection.uri, expectedRange.uri, 'native editor URI differs from Code subject');
        assert.deepEqual(selection.range?.start, {
            line: expectedRange.line,
            character: expectedRange.column
        }, 'native editor selection start differs from Code source range');
        assert.deepEqual(selection.range?.end, {
            line: expectedRange.endLine,
            character: expectedRange.endColumn
        }, 'native editor selection end differs from Code source range');
    }
}

async function navigationDblClick(page, name, kind, selectedId, receipt) {
    const locator = exactNode(page, name, kind);
    await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
    await clickState(page, locator, (state) => state.selectedId === selectedId,
        `double-click ${name}`, receipt, true);
}

async function historyClick(page, name, predicate, label, receipt) {
    await clickState(page, page.getByRole('button', { name, exact: true }), predicate, label, receipt);
}

async function clickState(page, locator, predicate, label, receipt, double = false) {
    const start = await page.evaluate(() => globalThis.__bsvVsixSmoke.states.length);
    if (double) await locator.dblclick();
    else await locator.click();
    await withTimeout(page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve))),
        TIMEOUT, `${label} did not reach the next rendered frame.`);
    const observed = await page.evaluate((startValue) =>
        globalThis.__bsvVsixSmoke.states.slice(startValue), start);
    const state = observed.at(-1) || null;
    const matched = Boolean(state && predicate(state));
    receipt.navigation.push({ label, matched, state });
    assert.ok(matched, `${label} did not persist and render the expected state`);
}

function exactNode(page, name, kind) {
    return page.locator(`.arch-node.kind-${kind}`).filter({
        has: page.locator('.node-title', { hasText: new RegExp(`^${escapeRegExp(name)}$`) })
    }).first();
}

async function waitForObserved(page, kind, predicate, timeout) {
    const expression = predicate.toString();
    return page.evaluate(({ kindValue, expressionValue, timeoutValue }) => {
        const test = (0, eval)(`(${expressionValue})`);
        const smoke = globalThis.__bsvVsixSmoke;
        if (!smoke) throw new Error('VSIX smoke observation hook is absent.');
        const values = kindValue === 'host' ? smoke.host : kindValue === 'post' ? smoke.posts : smoke.states;
        const existing = values.find((value) => test(value));
        if (existing) return { value: existing, existing: true };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                removeEventListener(`bsv-vsix-${kindValue}`, listener);
                reject(new Error(`Timed out waiting for observed ${kindValue}.`));
            }, timeoutValue);
            const listener = (event) => {
                if (!test(event.detail)) return;
                clearTimeout(timer);
                removeEventListener(`bsv-vsix-${kindValue}`, listener);
                resolve({ value: event.detail, existing: false });
            };
            addEventListener(`bsv-vsix-${kindValue}`, listener);
        });
    }, { kindValue: kind, expressionValue: expression, timeoutValue: timeout });
}

function observationScript() {
    return `(() => {
        const smoke = globalThis.__bsvVsixSmoke = { host: [], posts: [], states: [], lastModel: null };
        const nativeAddEventListener = globalThis.addEventListener.bind(globalThis);
        const nativeRemoveEventListener = globalThis.removeEventListener.bind(globalThis);
        const messageListeners = new WeakMap();
        const recordHost = (value) => {
            smoke.host.push(value);
            if (value?.type === 'model') smoke.lastModel = value.model;
            dispatchEvent(new CustomEvent('bsv-vsix-host', { detail: value }));
        };
        globalThis.addEventListener = function observedAddEventListener(type, listener, options) {
            if (type !== 'message' || !listener) {
                return nativeAddEventListener(type, listener, options);
            }
            const observed = function observedMessageListener(event) {
                recordHost(event.data);
                if (typeof listener === 'function') return listener.call(this, event);
                return listener.handleEvent(event);
            };
            messageListeners.set(listener, observed);
            return nativeAddEventListener(type, observed, options);
        };
        globalThis.removeEventListener = function observedRemoveEventListener(type, listener, options) {
            return nativeRemoveEventListener(type,
                type === 'message' ? messageListeners.get(listener) || listener : listener, options);
        };
        const wrap = (nativeAcquire) => function observedAcquireVsCodeApi() {
            const native = nativeAcquire.call(globalThis);
            return {
                postMessage(message) {
                    smoke.posts.push(message);
                    dispatchEvent(new CustomEvent('bsv-vsix-post', { detail: message }));
                    return native.postMessage(message);
                },
                getState() { return native.getState(); },
                setState(state) {
                    smoke.states.push(state);
                    dispatchEvent(new CustomEvent('bsv-vsix-state', { detail: state }));
                    return native.setState(state);
                }
            };
        };
        const nativeAcquire = globalThis.acquireVsCodeApi;
        if (typeof nativeAcquire === 'function') {
            globalThis.acquireVsCodeApi = wrap(nativeAcquire);
            return;
        }
        Object.defineProperty(globalThis, 'acquireVsCodeApi', {
            configurable: true,
            get() { return undefined; },
            set(value) {
                Object.defineProperty(globalThis, 'acquireVsCodeApi', {
                    configurable: true, writable: true, value: wrap(value)
                });
            }
        });
    })();`;
}

async function waitForWebviewFrame(context, timeout) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const pages = new Map();
        const cleanup = () => {
            clearTimeout(timer);
            context.removeListener('page', attachPage);
            for (const [page, listeners] of pages) {
                page.removeListener('frameattached', listeners.frame);
                page.removeListener('framenavigated', listeners.frame);
            }
        };
        const consider = async (frame) => {
            if (settled || !isCandidateWebviewFrame(frame)) return;
            try {
                await frame.locator('#architecture-title').waitFor({ state: 'attached', timeout });
            } catch (error) {
                if (!settled && !String(error).includes('Timeout')) fail(error);
                return;
            }
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ frame, page: frame.page() });
        };
        const attachPage = (page) => {
            const frame = (candidate) => { consider(candidate).catch(fail); };
            pages.set(page, { frame });
            page.on('frameattached', frame);
            page.on('framenavigated', frame);
            for (const candidate of page.frames()) frame(candidate);
        };
        const fail = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };
        const timer = setTimeout(() => fail(new Error(
            'Timed out waiting for the real BSV Lens webview frame in the VS Code workbench.')), timeout);
        context.on('page', attachPage);
        for (const page of context.pages()) attachPage(page);
    });
}

function isCandidateWebviewFrame(frame) {
    try {
        const url = new URL(frame.url());
        return url.protocol === 'vscode-webview:';
    } catch {
        return false;
    }
}

function observeBrowserErrors(page, receipt) {
    page.on('pageerror', (error) => receipt.browserErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') receipt.browserErrors.push(message.text());
    });
}

async function collectCdpEvidence(browser, context) {
    let targets = [];
    try {
        const session = await browser.newBrowserCDPSession();
        const result = await session.send('Target.getTargets');
        targets = result.targetInfos.map(({ targetId, type, title, url, attached }) => ({
            targetId, type, title, url, attached
        }));
        await session.detach();
    } catch (error) {
        targets = [{ error: error?.message || String(error) }];
    }
    const frames = [];
    for (const [pageIndex, page] of context.pages().entries()) {
        for (const frame of page.frames()) {
            let details = { title: null, readyState: null, hasArchitectureTitle: false,
                architectureTitleLayout: null, hasObservationHook: false, observationCounts: null,
                hasObservedModel: false, acquireVsCodeApiType: null, childFrameSources: [] };
            try {
                details = await frame.evaluate(() => ({
                    title: document.title,
                    readyState: document.readyState,
                    hasArchitectureTitle: Boolean(document.getElementById('architecture-title')),
                    architectureTitleLayout: (() => {
                        const element = document.getElementById('architecture-title');
                        if (!element) return null;
                        const style = getComputedStyle(element);
                        return { display: style.display, visibility: style.visibility,
                            width: element.getBoundingClientRect().width,
                            height: element.getBoundingClientRect().height };
                    })(),
                    hasObservationHook: Boolean(globalThis.__bsvVsixSmoke),
                    observationCounts: globalThis.__bsvVsixSmoke ? {
                        host: globalThis.__bsvVsixSmoke.host.length,
                        posts: globalThis.__bsvVsixSmoke.posts.length,
                        states: globalThis.__bsvVsixSmoke.states.length
                    } : null,
                    hasObservedModel: Boolean(globalThis.__bsvVsixSmoke?.lastModel),
                    acquireVsCodeApiType: typeof globalThis.acquireVsCodeApi,
                    childFrameSources: [...document.querySelectorAll('iframe')].map((item) => ({
                        id: item.id, title: item.title, src: item.src
                    }))
                }));
            } catch { /* frame may detach during collection */ }
            frames.push({
                pageIndex,
                name: frame.name(),
                url: frame.url(),
                parentUrl: frame.parentFrame()?.url() || null,
                ...details
            });
        }
    }
    return { targets, frames };
}

async function capture(page, fileName, receipt) {
    const output = path.join(OUTPUT, fileName);
    await page.screenshot({ path: output, fullPage: true });
    receipt.screenshots.push(output);
}

function outputMonitor() {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let text = '';
    const waiters = new Set();
    const consume = (chunk, destination) => {
        const value = chunk.toString();
        text += value;
        destination.write(value);
        for (const waiter of [...waiters]) {
            if (!waiter.pattern.test(text)) continue;
            clearTimeout(waiter.timer);
            waiters.delete(waiter);
            waiter.resolve();
        }
    };
    stdout.on('data', (chunk) => consume(chunk, process.stdout));
    stderr.on('data', (chunk) => consume(chunk, process.stderr));
    return {
        stdout,
        stderr,
        waitFor(pattern, timeout) {
            if (pattern.test(text)) return Promise.resolve();
            return new Promise((resolve, reject) => {
                const waiter = { pattern, resolve, timer: null };
                waiter.timer = setTimeout(() => {
                    waiters.delete(waiter);
                    reject(new Error(`Timed out waiting for VS Code output matching ${pattern}.`));
                }, timeout);
                waiters.add(waiter);
            });
        }
    };
}

async function createSignalServer() {
    const messages = [];
    const waiters = new Set();
    let socket;
    const server = net.createServer((connection) => {
        socket = connection;
        connection.setEncoding('utf8');
        let buffer = '';
        connection.on('data', (chunk) => {
            buffer += chunk;
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                if (line) deliver(JSON.parse(line));
                newline = buffer.indexOf('\n');
            }
        });
    });
    const deliver = (message) => {
        messages.push(message);
        if (message.type === 'observerError') console.error(message.message);
        for (const waiter of [...waiters]) {
            if (waiter.type !== message.type || !waiter.predicate(message)) continue;
            clearTimeout(waiter.timer);
            waiters.delete(waiter);
            waiter.resolve(message);
        }
    };
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return {
        port: server.address().port,
        send(message) {
            assert.ok(socket, 'observer signal socket is not connected');
            socket.write(`${JSON.stringify(message)}\n`);
        },
        waitFor(type, predicate, timeout) {
            const existing = messages.find((message) => message.type === type && predicate(message));
            if (existing) return Promise.resolve(existing);
            return new Promise((resolve, reject) => {
                const waiter = { type, predicate, resolve, timer: null };
                waiter.timer = setTimeout(() => {
                    waiters.delete(waiter);
                    reject(new Error(`Timed out waiting for observer signal ${type}.`));
                }, timeout);
                waiters.add(waiter);
            });
        },
        close() { return new Promise((resolve) => server.close(resolve)); }
    };
}

async function reservePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    return port;
}

function withTimeout(promise, timeout, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeout);
        promise.then((value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); });
    });
}

function writeReceipt(file, receipt) {
    fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gitHead() {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error?.stack || error);
        process.exitCode = 1;
    });
}

module.exports = {
    TARGET_ID,
    TARGET_VERSION,
    observationScript,
    readArchiveIdentity,
    validateBuildIdentity,
    validateInstalledTarget,
    selectionMatchesRange,
    validateSourceSelection
};
