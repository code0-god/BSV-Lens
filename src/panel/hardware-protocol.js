'use strict';
const { randomUUID } = require('node:crypto');
const { checkedJson } = require('../hardware/correspondence/schema');
const { DEFAULT_LIMITS, failure, copyJson } = require('../hardware/json');
const { PROTOCOL } = require('./hardware-build');
const actions = new Set(['catalog', 'scene', 'analysis-context', 'analysis', 'analysis-reveal', 'source', 'source-open',
    'choose-source', 'choose-artifact', 'choose-manifest', 'choose-origin', 'choose-design', 'refresh-input', 'discover-workspace', 'copy-diagnostics', 'open-settings', 'export-svg', 'persist']);
const fields = new Set(['protocol', 'kind', 'panelId', 'sessionId', 'buildId', 'requestId', 'generation', 'snapshotId', 'action', 'payload']);
const MAX_SESSION_REQUESTS = 50000;
const responsePayload = value => copyJson(value ?? null, { ...DEFAULT_LIMITS, maxBytes: 8388608 });
function message(input) {
    const maxBytes = input && Object.getOwnPropertyDescriptor(input, 'action')?.value === 'export-svg' ? 1048576 : 65536;
    const value = checkedJson(input, { ...DEFAULT_LIMITS, maxBytes, maxJsonDepth: 16, maxJsonNodes: 4096 });
    if (!value || Array.isArray(value) || Object.keys(value).some(key => !fields.has(key))
        || value.kind !== undefined && value.kind !== 'request'
        || typeof value.action !== 'string' || typeof value.requestId !== 'string'
        || !/^[A-Za-z0-9:_-]{1,80}$/.test(value.requestId)
        || !Number.isSafeInteger(value.generation) || value.generation < 0
        || value.snapshotId !== null && typeof value.snapshotId !== 'string'
        || !value.payload || Array.isArray(value.payload) || typeof value.payload !== 'object') throw failure('INVALID_INPUT', 'Invalid native message envelope');
    return value;
}
const errorStatus = code => ({ CANCELLED: 'cancelled', SUPERSEDED: 'cancelled', FORBIDDEN: 'forbidden', PATH_DENIED: 'forbidden',
    UNSUPPORTED: 'unsupported', AMBIGUOUS_ROOT: 'ambiguous', AMBIGUOUS_SOURCE: 'ambiguous',
    ENOENT: 'unresolved', ENOTDIR: 'unresolved', ARTIFACT_HASH_MISMATCH: 'stale', CONTRADICTION: 'invalid', LIMIT_EXCEEDED: 'limited', STALE_SOURCE: 'stale', SOURCE_REVISION_MISMATCH: 'stale',
    SNAPSHOT_MISMATCH: 'stale', BUILD_MISMATCH: 'stale', INVALID_RANGE: 'invalid', INVALID_INPUT: 'invalid' })[code] || 'host-error';
class HardwareProtocol {
    constructor({ build, send, dispatch, welcome, reset = () => {}, diagnostic = () => {} }) {
        Object.assign(this, { build, send, dispatch, welcome, reset, diagnostic });
        this.panelId = randomUUID(); this.sessionId = randomUUID(); this.generation = 0;
        this.pending = new Map(); this.seen = new Set(); this.disposed = false; this.connected = false; this.handshake = 0;
    }
    identity() { return { protocol: PROTOCOL, panelId: this.panelId, sessionId: this.sessionId,
        buildId: this.build.buildId, generation: this.generation }; }
    event(action, payload, snapshotId = null) {
        if (!this.disposed && this.connected) this.send({ ...this.identity(), kind: 'event', action, snapshotId, payload });
    }
    async receive(raw) {
        if (this.disposed) return;
        let input, bootstrapGeneration;
        try {
            input = message(raw);
            if (input.action === 'hello' && (input.panelId !== null || input.sessionId !== null
                || input.requestId !== 'hello' || input.generation !== 0 || input.snapshotId !== null
                || Object.keys(input.payload).some(key => !['expectedBuildId', 'expectedProtocol'].includes(key))))
                throw failure('FORBIDDEN', 'Handshake requires an unbound bootstrap envelope');
            if (input.protocol !== PROTOCOL || input.buildId !== this.build.buildId) throw failure('BUILD_MISMATCH', 'Host/Webview build or protocol mismatch');
            if (input.action === 'hello') {
                if (input.payload.expectedBuildId !== this.build.buildId || input.payload.expectedProtocol !== PROTOCOL)
                    throw failure('BUILD_MISMATCH', 'Webview expected build differs');
                const handshake = ++this.handshake; bootstrapGeneration = handshake; this.connected = false;
                await this.cancelAll();
                if (this.disposed || handshake !== this.handshake) return;
                this.sessionId = randomUUID(); this.seen.clear(); this.connected = true; this.reset(this.sessionId);
                const welcome = await this.welcome();
                if (!this.disposed && handshake === this.handshake) this.event('welcome', welcome);
                return;
            }
            if (!this.connected || input.panelId !== this.panelId || input.sessionId !== this.sessionId || input.generation !== this.generation)
                throw failure('FORBIDDEN', 'Foreign or stale native session/generation');
            if (this.seen.has(input.requestId)) {
                this.diagnostic({ phase: 'message-rejected', code: 'FORBIDDEN', action: input.action, reason: 'replayed-request' });
                return;
            }
            if (input.action === 'cancel') {
                if (Object.keys(input.payload).some(key => key !== 'targetRequestId') || typeof input.payload.targetRequestId !== 'string')
                    throw failure('INVALID_INPUT', 'Invalid cancellation target');
                this.pending.get(input.payload.targetRequestId)?.controller.abort(); return;
            }
            if (!actions.has(input.action)) throw failure('FORBIDDEN', 'Native action is not allowed');
            if (this.pending.size >= 4) throw failure('LIMIT_EXCEEDED', 'Native concurrent request limit');
            if (this.seen.size >= MAX_SESSION_REQUESTS) throw failure('LIMIT_EXCEEDED', 'Native session request limit; reopen the panel');
            this.seen.add(input.requestId);
            const controller = new AbortController(), sessionId = this.sessionId;
            const deferred = [];
            const entry = { controller, promise: null }; this.pending.set(input.requestId, entry);
            const valid = () => !this.disposed && sessionId === this.sessionId && !controller.signal.aborted;
            entry.promise = Promise.resolve().then(() => this.dispatch(input.action, input.payload,
                { signal: controller.signal, input, isCurrent: valid, afterReply: callback => deferred.push(callback) })).then(async result => {
                if (!valid()) throw failure('CANCELLED', 'Native request cancelled');
                const payload = responsePayload(result);
                if (input.generation !== this.generation && !input.action.startsWith('choose-') && !['refresh-input', 'discover-workspace'].includes(input.action))
                    throw failure('SUPERSEDED', 'Native input was replaced');
                if (!this.disposed && sessionId === this.sessionId) await this.send({ ...this.identity(), generation: input.generation,
                    kind: 'response', requestId: input.requestId, action: input.action, snapshotId: input.snapshotId, status: 'ok', payload });
                if (valid()) for (const callback of deferred) await callback();
            }).catch(error => { if (!this.disposed && sessionId === this.sessionId) this.replyError(input, error); })
                .finally(() => { this.pending.delete(input.requestId); });
            await entry.promise;
        } catch (error) {
            this.diagnostic({ phase: 'message-rejected', code: error.code || 'INVALID_INPUT', action: input?.action || null });
            if (input && (bootstrapGeneration === undefined || bootstrapGeneration === this.handshake)) this.replyError(input, error);
        }
    }
    replyError(input, error) {
        if (this.disposed) return;
        this.send({ protocol: input.protocol, panelId: input.panelId, sessionId: input.sessionId,
            buildId: input.buildId, generation: input.generation, kind: 'response', requestId: input.requestId,
            action: input.action, snapshotId: input.snapshotId, status: errorStatus(error.code),
            error: { code: error.code || 'HOST_ERROR', message: String(error.message || 'Native host error').slice(0, 1024) } });
    }
    async abortExcept(requestId) {
        const active = [...this.pending].filter(([id]) => id !== requestId).map(([, entry]) => entry);
        for (const entry of active) entry.controller.abort();
        await Promise.allSettled(active.map(entry => entry.promise));
    }
    async cancelAll() {
        const active = [...this.pending.values()]; for (const item of active) item.controller.abort();
        await Promise.allSettled(active.map(item => item.promise));
    }
    async dispose() { this.disposed = true; this.connected = false; await this.cancelAll(); this.seen.clear(); }
}
module.exports = { HardwareProtocol, message, errorStatus, responsePayload };
