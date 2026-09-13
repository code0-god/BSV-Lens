'use strict';
const { parentPort, workerData, threadId } = require('node:worker_threads');
// The handshake lets cancellation observe a real worker before analysis begins.
parentPort.once('message', () => {
    try {
        const engine = workerData.query.kind === 'dependencies' ? require('./dependencies') : require('./connectivity');
        const value = engine.execute(workerData.model, workerData.query);
        {
            const { hash, stable } = require('../json');
            const { id, request, metrics, ...semantic } = value;
            value.id = `analysis-result-${hash(stable(require('./input').identityValue(semantic)))}`;
        }
        parentPort.postMessage({ type: 'result', value });
    }
    catch (error) { parentPort.postMessage({ type: 'failure', error: { code: error.code || 'INVALID_INPUT', message: error.message } }); }
    finally { parentPort.close(); }
});
parentPort.postMessage({ type: 'ready', threadId });
