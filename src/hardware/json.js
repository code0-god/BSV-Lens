'use strict';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const table = () => Object.create(null);
const keys = object => Object.keys(object).sort();
const DEFAULT_LIMITS = Object.freeze({ maxBytes: 16777216, maxJsonDepth: 64,
    maxJsonNodes: 1000000, maxHierarchyDepth: 64, maxOccurrences: 10000,
    maxEntities: 250000, maxVectorWidth: 65536 });

function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('INVALID_INPUT', `Invalid object: ${label}`);
    return value;
}

// Clone and freeze plain JSON, checking limits before stringify or recursive materialization.
function copyJson(value, limits) {
    let nodes = 0;
    let bytes = 0;
    const ancestors = new Set();
    function visit(item, depth) {
        if (++nodes > limits.maxJsonNodes || depth > limits.maxJsonDepth) throw failure('LIMIT_EXCEEDED', 'JSON depth/size limit');
        if (typeof item === 'string') {
            if (Buffer.byteLength(item) > limits.maxBytes) throw failure('LIMIT_EXCEEDED', 'JSON byte size limit');
            bytes += Buffer.byteLength(JSON.stringify(item));
        }
        else if (item === null || typeof item === 'boolean') bytes += 5;
        else if (typeof item === 'number' && Number.isFinite(item)) bytes += 24;
        else if (item && typeof item === 'object') {
            bytes += 2;
            if (bytes > limits.maxBytes) throw failure('LIMIT_EXCEEDED', 'JSON byte size limit');
            if (ancestors.has(item)) throw failure('INVALID_INPUT', 'Cyclic JSON');
            if (Object.getOwnPropertySymbols(item).length) throw failure('INVALID_INPUT', 'Non-JSON symbol key');
            const prototype = Object.getPrototypeOf(item);
            if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw failure('INVALID_INPUT', 'Non-JSON object');
            if (Array.isArray(item) && (Object.keys(item).length !== item.length || Object.keys(item).some((key, i) => key !== String(i)))) throw failure('INVALID_INPUT', 'Non-JSON sparse or decorated array');
            ancestors.add(item);
            const result = Array.isArray(item) ? [] : table();
            for (const key of Object.keys(item)) {
                const descriptor = Object.getOwnPropertyDescriptor(item, key);
                if (!descriptor || !own(descriptor, 'value')) throw failure('INVALID_INPUT', 'JSON accessor unsupported');
                bytes += Buffer.byteLength(JSON.stringify(key)) + 2;
                if (bytes > limits.maxBytes) throw failure('LIMIT_EXCEEDED', 'JSON byte size limit');
                result[key] = visit(descriptor.value, depth + 1);
            }
            ancestors.delete(item);
            return Object.freeze(result);
        } else throw failure('INVALID_INPUT', 'Non-JSON value');
        if (bytes > limits.maxBytes) throw failure('LIMIT_EXCEEDED', 'JSON byte size limit');
        return item;
    }
    return visit(value, 0);
}

function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${keys(value).map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
    return JSON.stringify(value);
}

function deepFreeze(value) {
    const seen = new Set();
    const pending = [value];
    while (pending.length) {
        const item = pending.pop();
        if (!item || typeof item !== 'object' || seen.has(item)) continue;
        seen.add(item);
        for (const value of Object.values(item)) pending.push(value);
        Object.freeze(item);
    }
    return value;
}
const hash = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function classify(error) {
    if (error.code) return error;
    return Object.assign(error, { code: 'INVALID_INPUT' });
}
module.exports = { own, table, keys, record, copyJson, stable, deepFreeze, hash, failure, classify, DEFAULT_LIMITS };
