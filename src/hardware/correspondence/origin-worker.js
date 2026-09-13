'use strict';
const { parentPort, workerData, threadId } = require('node:worker_threads');
const { buildOrigins } = require('./origin-data');
try {
    parentPort.postMessage({ type: 'progress', phase: 'origin-validating', threadId });
    parentPort.postMessage({ type: 'result', result: buildOrigins(workerData) });
} catch (error) {
    parentPort.postMessage({ type: 'error', code: error.code || 'INVALID_INPUT', message: error.message });
}
