'use strict';

(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (!root?.document) return;
    const vscode = root.acquireVsCodeApi();
    root.BsvHardwareTransport = api.createTransport({
        expectedBuildId: document.querySelector('meta[name="bsv-build-id"]').content,
        expectedProtocol: Number(document.querySelector('meta[name="bsv-protocol"]').content),
        postMessage: message => vscode.postMessage(message),
        listen: callback => { const handler = event => callback(event.data); root.addEventListener('message', handler);
            return () => root.removeEventListener('message', handler); },
        setState: state => vscode.setState(state)
    });
}(typeof window === 'undefined' ? null : window, function createApi() {
    const ACTIONS = new Set(['catalog', 'scene', 'analysis-context', 'analysis', 'analysis-reveal', 'source',
        'source-open', 'choose-source', 'choose-artifact', 'choose-manifest', 'choose-origin', 'refresh-input',
        'export-svg', 'persist', 'discover-workspace', 'choose-design', 'copy-diagnostics', 'open-settings']);
    const SUCCESS = new Set(['ok', 'complete', 'empty', 'partial', 'limited']);
    const failure = (message, code) => Object.assign(new Error(message), { code });
    const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

    function createTransport({ postMessage, listen, expectedBuildId, expectedProtocol = 1, setState = () => {} }) {
        let identity = null, snapshotId = null, counter = 0, disposed = false, welcomed = false;
        const pending = new Map(), subscribers = new Set();
        let resolveReady, rejectReady;
        const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
        // Handshake can fail before the renderer subscribes; retain the rejected promise.
        ready.catch(() => {});
        function clear(cause) {
            for (const entry of pending.values()) { entry.cleanup(); entry.reject(cause); }
            pending.clear();
        }
        function send(message) {
            const limit = message.action === 'export-svg' ? 1024 * 1024 : 64 * 1024;
            if (bytes(message) > limit) throw failure(`Native message exceeds ${limit / 1024} KiB limit`, 'LIMIT_EXCEEDED');
            postMessage(message);
        }
        function matches(message) {
            return identity && message.protocol === expectedProtocol && message.buildId === expectedBuildId
                && message.panelId === identity.panelId && message.sessionId === identity.sessionId;
        }
        const unlisten = listen(message => {
            if (disposed || !message || typeof message !== 'object') return;
            if (!welcomed && message.kind === 'response' && message.requestId === 'hello' && message.action === 'hello'
                && message.error) {
                rejectReady(failure(message.error.message || 'Host/Webview handshake rejected', message.error.code || 'BUILD_MISMATCH'));
                disposed = true; return;
            }
            if (message.kind === 'event' && message.action === 'welcome') {
                if (welcomed) return;
                if (message.protocol !== expectedProtocol || expectedProtocol !== 1 || message.buildId !== expectedBuildId
                    || typeof message.panelId !== 'string' || !message.panelId || typeof message.sessionId !== 'string'
                    || !message.sessionId || !Number.isSafeInteger(message.generation) || message.generation < 0) {
                    rejectReady(failure('Host/Webview build or protocol mismatch', 'BUILD_MISMATCH'));
                    disposed = true; return;
                }
                welcomed = true;
                identity = { protocol: expectedProtocol, panelId: message.panelId, sessionId: message.sessionId,
                    buildId: expectedBuildId, generation: message.generation };
                resolveReady(message.payload || {}); return;
            }
            if (!matches(message)) return;
            if (message.kind === 'event') {
                if (!Number.isSafeInteger(message.generation) || message.generation < identity.generation) return;
                if (message.generation !== identity.generation) {
                    if (message.action !== 'catalog') return;
                    identity.generation = message.generation; snapshotId = null;
                    clear(failure('Registered input changed; old request discarded', 'STALE_RESPONSE'));
                }
                for (const subscriber of subscribers) subscriber(message.action, message.payload || {});
                return;
            }
            const entry = pending.get(message.requestId);
            if (message.kind !== 'response' || !entry || message.action !== entry.message.action
                || message.generation !== entry.message.generation || message.generation !== identity.generation
                || message.snapshotId !== entry.message.snapshotId) return;
            pending.delete(message.requestId); entry.cleanup();
            if (!message.error && SUCCESS.has(message.status)) entry.resolve(message.payload);
            else entry.reject(failure(message.error?.message || message.payload?.error || `Native request ${message.status}`,
                message.error?.code || message.payload?.code || String(message.status || 'HOST_ERROR').toUpperCase()));
        });
        send({ protocol: expectedProtocol, panelId: null, sessionId: null, buildId: expectedBuildId,
            requestId: 'hello', generation: 0, snapshotId: null, action: 'hello',
            payload: { expectedBuildId, expectedProtocol } });
        return {
            native: true, ready,
            identity: () => identity && { ...identity },
            setSnapshot(value) { snapshotId = value ?? null; },
            subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
            saveState(state) {
                if (bytes(state) > 16 * 1024) throw failure('Saved view state exceeds 16 KiB limit', 'STATE_LIMIT');
                setState(state);
            },
            async request(action, payload = {}, { signal } = {}) {
                if (!ACTIONS.has(action)) throw failure('Native action is not allowed', 'FORBIDDEN');
                await ready;
                if (disposed) throw failure('Native transport disposed', 'CANCELLED');
                if (signal?.aborted) throw failure('Native request cancelled', 'CANCELLED');
                const message = { ...identity, requestId: `request-${++counter}`, snapshotId, action, payload };
                return new Promise((resolve, reject) => {
                    const abort = () => {
                        const entry = pending.get(message.requestId);
                        if (!entry) return;
                        pending.delete(message.requestId); entry.cleanup();
                        send({ ...identity, requestId: `cancel-${++counter}`, snapshotId,
                            action: 'cancel', payload: { targetRequestId: message.requestId } });
                        reject(failure('Native request cancelled', 'CANCELLED'));
                    };
                    const cleanup = () => signal?.removeEventListener('abort', abort);
                    pending.set(message.requestId, { message, resolve, reject, cleanup });
                    signal?.addEventListener('abort', abort, { once: true });
                    try { send(message); } catch (error) { pending.delete(message.requestId); cleanup(); reject(error); }
                });
            },
            dispose() {
                disposed = true; unlisten(); subscribers.clear();
                const cause = failure('Native transport disposed', 'CANCELLED');
                rejectReady(cause); clear(cause);
            }
        };
    }
    return { createTransport };
}));
