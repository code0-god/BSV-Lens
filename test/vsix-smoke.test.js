'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
    TARGET_ID,
    TARGET_VERSION,
    observationScript,
    selectionMatchesRange,
    validateBuildIdentity,
    validateInstalledTarget,
    validateSourceSelection
} = require('../scripts/run-vsix-smoke');

const root = path.resolve(__dirname, '..');

test('smoke observer is the only development extension and does not depend on target internals', () => {
    const script = fs.readFileSync(path.join(root, 'scripts', 'run-vsix-smoke.js'), 'utf8');
    const observer = fs.readFileSync(path.join(
        root, 'test', 'fixtures', 'vsix-smoke-observer', 'index.js'
    ), 'utf8');
    assert.match(script, /extensionDevelopmentPath: OBSERVER/);
    assert.doesNotMatch(script, /extensionDevelopmentPath:\s*ROOT/);
    assert.match(script, /--install-extension/);
    assert.match(script, /--extensions-dir/);
    assert.match(script, /--user-data-dir/);
    assert.match(script, /queries\.resolveEndpointImplementation\(endpoint\?\.id/);
    assert.match(script, /queries\.getBehaviorSlice\(implementation\?\.id/);
    assert.doesNotMatch(observer, /src[/\\]panel|architecture-panel|handleMessage/);
    assert.match(observer, /onDidChangeTextEditorSelection/);
    assert.match(observer, /executeCommand\('bsvArchitecture\.openWorkspace'\)/);
});

test('browser observation forwards a native API installed after the init hook and preserves CSP', () => {
    const source = observationScript();
    const calls = [];
    const listeners = new Map();
    const sandbox = {
        globalThis: null,
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type) { listeners.delete(type); },
        dispatchEvent() {},
        CustomEvent: class CustomEvent {},
        nativeApi: {
            postMessage(message) { calls.push(['post', message]); return 'posted'; },
            getState() { calls.push(['get']); return { native: true }; },
            setState(state) { calls.push(['set', state]); return 'set'; }
        }
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox);
    sandbox.acquireVsCodeApi = function nativeAcquireVsCodeApi() {
        calls.push(['acquire']);
        return sandbox.nativeApi;
    };
    const received = [];
    sandbox.addEventListener('message', (event) => received.push(event.data));
    listeners.get('message')({ data: { type: 'model', model: { title: 'real' } } });
    assert.deepEqual(received, [{ type: 'model', model: { title: 'real' } }]);
    assert.equal(sandbox.__bsvVsixSmoke.lastModel.title, 'real');
    const api = sandbox.acquireVsCodeApi();
    assert.equal(api.postMessage({ type: 'ready' }), 'posted');
    assert.deepEqual(api.getState(), { native: true });
    assert.equal(api.setState({ selectedId: 'real' }), 'set');
    assert.deepEqual(calls, [
        ['acquire'], ['post', { type: 'ready' }], ['get'], ['set', { selectedId: 'real' }]
    ]);
    assert.match(source, /native\.postMessage\(message\)/);
    assert.match(source, /native\.setState\(state\)/);
    assert.doesNotMatch(source, /Content-Security-Policy|removeAttribute\(['"]content/);
    assert.doesNotMatch(source, /\.textContent\s*=/);
    assert.doesNotMatch(source, /window\.postMessage\(/);
});

test('installed and build identities must agree across archive host and webview', () => {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blv-id-'));
    const extensionPath = path.join(extensionsDir, `${TARGET_ID}-${TARGET_VERSION}`);
    const target = {
        id: TARGET_ID,
        version: TARGET_VERSION,
        extensionPath,
        apiExtensionMode: null
    };
    validateInstalledTarget(target, extensionsDir);
    const common = {
        extensionId: TARGET_ID,
        version: TARGET_VERSION,
        sourceCommit: '104460c1234567890',
        buildId: 'smoke-build',
        dirty: false
    };
    const host = {
        ...common,
        extensionMode: 'installed',
        extensionPath,
        metadataStatus: 'packaged',
        dirty: false
    };
    assert.deepEqual(validateBuildIdentity({ buildInfo: common }, target, host, common).expected, common);
    assert.throws(() => validateBuildIdentity({ buildInfo: null }, target, host, common),
        /omits media\/build-metadata/);
    assert.throws(() => validateBuildIdentity({ buildInfo: common }, target,
        { ...host, extensionMode: 'development' }, common), /not installed/);
});

test('source receipt subscribes to the exact native currentWork return selection', () => {
    const sourceRange = {
        uri: 'file:///fixture.bsv', line: 1, column: 11, endLine: 1, endColumn: 24
    };
    const selection = {
        text: 'makeArrayWork',
        uri: sourceRange.uri,
        range: { start: { line: 1, character: 11 }, end: { line: 1, character: 24 } }
    };
    assert.equal(selectionMatchesRange(selection, sourceRange), true);
    assert.equal(selectionMatchesRange({ ...selection, uri: 'file:///other.bsv' }, sourceRange), false);
    assert.equal(selectionMatchesRange({
        ...selection,
        range: { ...selection.range, end: { line: 1, character: 23 } }
    }, sourceRange), false);
    validateSourceSelection({ type: 'openSource', nodeId: 'return-code', location: sourceRange },
        selection, sourceRange);
    assert.throws(() => validateSourceSelection({ type: 'openSource', nodeId: 'return-code' }, {
        text: '', uri: sourceRange.uri
    }), /selection is empty/);
});
