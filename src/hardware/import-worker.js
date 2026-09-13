'use strict';

const { parentPort, workerData, threadId } = require('node:worker_threads');
const { buildSnapshot } = require('./snapshot');
const { classify } = require('./json');
// Emitted by the worker immediately before its CPU-bound parse/materialization.
parentPort.postMessage({ type: 'progress', phase: 'importing', threadId });
try {
    const { text, artifactRef, manifest, limits, expectedArtifactHash } = workerData;
    parentPort.postMessage({ type: 'result', value: buildSnapshot(text, artifactRef, manifest, limits, expectedArtifactHash) });
} catch (error) {
    classify(error);
    parentPort.postMessage({ type: 'failure', error: { code: error.code, message: error.message } });
}
parentPort.close();
