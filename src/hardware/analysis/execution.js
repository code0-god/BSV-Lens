'use strict';
const { Worker } = require('node:worker_threads');
const { failure, deepFreeze } = require('../json');
async function runWorker(data, signal, onProgress) {
    if (signal?.aborted) throw failure('CANCELLED', 'Analysis cancelled');
    const started = performance.now();
    const worker = new Worker(require.resolve('./worker'), { workerData: data,
        resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 4 } });
    const threadId = worker.threadId;
    return new Promise((resolve,reject) => {
        let result, error, stopped = false, stopTime = null, workerStartupMs = null;
        const stop = cause => {
            if (stopped) return;
            stopped = true; error = cause; stopTime = performance.now();
            worker.terminate().catch(cause => { error = cause; });
        };
        const abort = () => stop(failure('CANCELLED', 'Analysis cancelled'));
        const deadline = setTimeout(() => stop(failure('TIMEOUT', 'Analysis deadline exceeded')), Math.max(0, data.query.limits.timeoutMs - (performance.now() - started)));
        const progress = event => { try { onProgress?.(deepFreeze({ ...event, threadId })); }
            catch (cause) { stop(cause); } };
        worker.on('message', message => {
            if (stopped) return;
            if (message.type === 'ready') {
                workerStartupMs = performance.now() - started;
                progress({ phase: 'ready' });
                if (!stopped) worker.postMessage({ type: 'execute' });
            } else if (message.type === 'result') result = message.value;
            else if (message.type === 'failure') error = failure(message.error.code, message.error.message);
        });
        worker.on('error', cause => { error = cause; });
        worker.once('exit', code => {
            clearTimeout(deadline); signal?.removeEventListener('abort', abort);
            const elapsedMs = performance.now() - started, cancellationMs = stopTime === null ? 0 : performance.now() - stopTime;
            progress({ phase: 'exited', exitCode: code, cancelled: error?.code === 'CANCELLED', timedOut: error?.code === 'TIMEOUT', elapsedMs, cancellationMs });
            if (error) {
                error.metrics = { elapsedMs, cancellationMs, workerExited: true };
                error.frontier = data.query.seed.positions.map(seed => ({ kind: 'frontier', reason: error.code === 'TIMEOUT' ? 'deadline' : error.code === 'CANCELLED' ? 'cancelled' : 'execution-failure', seed }));
                reject(error);
            } else if (signal?.aborted) reject(failure('CANCELLED', 'Analysis cancelled'));
            else if (code !== 0 || !result) reject(failure('WORKER_FAILED', `Analysis worker exited without result (${code})`));
            else {
                Object.assign(result.metrics, { workerStartupMs, elapsedMs });
                for (let i=0; i<3; i++) result.metrics.resultBytes = Buffer.byteLength(JSON.stringify(result));
                if (result.metrics.resultBytes > data.query.limits.maxResultBytes) reject(failure('LIMIT_EXCEEDED', 'Result envelope exceeds byte budget'));
                else resolve(deepFreeze(result));
            }
        });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        progress({ phase: 'started' });
    });
}
module.exports = { runWorker };
