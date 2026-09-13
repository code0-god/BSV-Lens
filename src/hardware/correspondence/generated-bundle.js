'use strict';

const { checkedJson, seal } = require('./schema');
const { DEFAULT_LIMITS, failure, record, deepFreeze } = require('../json');
const { serialize } = require('node:v8');

const GENERATED_LIMITS = Object.freeze({ ...DEFAULT_LIMITS, maxBytes: 64 * 1024 * 1024 - 128,
    maxJsonNodes: DEFAULT_LIMITS.maxJsonNodes - 1 });

function sealGeneratedBundle(payload) {
    // Generated bundles share range objects: bound expanded JSON at 64 MiB before
    // measuring the bundle's V8 serialization at 16 MiB. External JSON stays at 16 MiB.
    record(payload, 'generated correspondence payload');
    checkedJson(payload, GENERATED_LIMITS);
    if (Object.prototype.hasOwnProperty.call(payload, 'id')) throw failure('INVALID_INPUT', 'Generated payload cannot supply its seal');
    const bundle = deepFreeze(seal('correspondence', payload));
    const correspondenceSharedBytes = serialize(bundle).byteLength;
    if (correspondenceSharedBytes > DEFAULT_LIMITS.maxBytes)
        throw failure('LIMIT_EXCEEDED', 'Generated correspondence shared payload byte limit');
    return { bundle, metrics: { correspondenceSharedBytes } };
}

module.exports = { sealGeneratedBundle };
