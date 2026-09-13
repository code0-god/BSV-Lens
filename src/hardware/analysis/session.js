'use strict';
const { EventEmitter } = require('node:events');
const { deepFreeze, failure } = require('../json');
const { checkedJson } = require('../correspondence/schema');
class AnalysisSession extends EventEmitter {
    #query; #revision = 0; #pending = new Set();
    #state = deepFreeze({ revision: 0, status: 'idle', current: null, error: null });
    constructor(query) { super(); this.#query = query; }
    getState() { return this.#state; }
    getContext(provider) { return this.#query.getContext(provider); }
    #publish(status, current, error = null) {
        this.#state = deepFreeze({ revision: this.#revision, status, current, error }); this.emit('state', this.#state);
    }
    query(input, { signal, onProgress } = {}) {
        let validationError;
        try { input = checkedJson(input, { maxBytes: 1048576, maxJsonNodes: 20000, maxJsonDepth: 12 }); }
        catch (error) { validationError = error; }
        const revision = ++this.#revision;
        for (const pending of this.#pending) pending.controller.abort();
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
        const entry = { controller, promise: null }; this.#pending.add(entry);
        entry.promise = Promise.resolve().then(async () => {
            try {
                if (validationError) throw validationError;
                const result = await this.#query.query(input, { signal: controller.signal, onProgress: event => {
                    // Exit notifications include superseded workers: observers can prove termination.
                    this.emit('worker', deepFreeze({ revision, ...event }));
                    if (revision === this.#revision) onProgress?.(event);
                } });
                if (revision !== this.#revision) throw failure('SUPERSEDED', 'A newer analysis owns publication');
                if (result.status === 'stale') throw failure('STALE_SOURCE', 'Stale analysis cannot replace the last valid result');
                this.#publish(result.status, result); return result;
            } catch (error) {
                if (revision !== this.#revision) throw failure('SUPERSEDED', 'A newer analysis owns publication');
                this.#publish(error.code === 'CANCELLED' ? 'cancelled' : error.code === 'TIMEOUT' ? 'timeout' : error.code === 'STALE_SOURCE' ? 'stale' : 'failed',
                    this.#state.current, { code: error.code || 'INVALID_INPUT', message: error.message,
                        metrics: error.metrics || null, frontier: error.frontier || [] });
                throw error;
            } finally { signal?.removeEventListener('abort', abort); this.#pending.delete(entry); }
        });
        this.#publish('querying', this.#state.current); return entry.promise;
    }
    async cancel() {
        const entries = [...this.#pending]; for (const entry of entries) entry.controller.abort();
        await Promise.allSettled(entries.map(entry => entry.promise));
    }
}
module.exports = { AnalysisSession };
