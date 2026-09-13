'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { serialize, deserialize } = require('node:v8');
const { sealGeneratedBundle } = require('../src/hardware/correspondence/generated-bundle');
const { checkedJson, seal } = require('../src/hardware/correspondence/schema');
const { validateBundle } = require('../src/hardware/correspondence');
const { hash, stable, deepFreeze, DEFAULT_LIMITS } = require('../src/hardware/json');

function sharedBundle() {
    const range = { unit: 'utf16', start: 0, end: 1024 * 1024,
        text: 'x'.repeat(1024 * 1024), sliceHash: hash('x'.repeat(1024 * 1024)) };
    return { claims: Array.from({ length: 20 }, (_, index) => ({
        id: `claim-${index}`, tuple: { source: { kind: 'source', range }, target: { kind: 'source-range', range } }
    })), evidence: [{ id: 'evidence', range }] };
}

test('generated shared source ranges fit the existing payload budget without changing any public JSON value', () => {
    const payload = sharedBundle(), before = hash(stable(payload));
    assert.throws(() => checkedJson(payload), { code: 'LIMIT_EXCEEDED' });
    const { bundle, metrics } = sealGeneratedBundle(payload);
    const sealedHash = hash(stable(bundle));
    assert.ok(metrics.correspondenceSharedBytes <= DEFAULT_LIMITS.maxBytes);
    assert.equal(hash(stable(payload)), before);
    assert.equal(sealedHash, hash(stable(seal('correspondence', payload))));
    assert.equal(hash(stable(deserialize(serialize(bundle)))), sealedHash);
    assert.deepEqual(deserialize(serialize(bundle)), bundle);
    assert.equal(bundle.claims.length, 20);
    assert.equal(bundle.claims[0].tuple.source.range, bundle.evidence[0].range);
    assert.equal(metrics.correspondenceSharedBytes, serialize(bundle).byteLength);
    assert.equal(metrics.correspondenceSharedBytes, serialize(deepFreeze(structuredClone(bundle))).byteLength);
    assert.ok(Object.isFrozen(bundle) && Object.isFrozen(bundle.claims) && Object.isFrozen(bundle.claims[0]));
    assert.throws(() => checkedJson(JSON.parse(JSON.stringify(bundle))), { code: 'LIMIT_EXCEEDED' });
    assert.throws(() => validateBundle(bundle, { correspondence: bundle }), { code: 'INVALID_INPUT' });
});

test('generated payloads still reject excessive shared bytes and excessive expanded bytes', () => {
    const distinct = Array.from({ length: 17 }, (_, index) => ({ text: String(index).padStart(2, '0') + 'x'.repeat(1024 * 1024) }));
    assert.throws(() => sealGeneratedBundle({ distinct }), { code: 'LIMIT_EXCEEDED' });
    const shared = { text: 'x'.repeat(1024 * 1024) };
    assert.ok(serialize({ repeated: Array(70).fill(shared) }).byteLength < DEFAULT_LIMITS.maxBytes);
    assert.throws(() => sealGeneratedBundle({ repeated: Array(70).fill(shared) }), { code: 'LIMIT_EXCEEDED' });
});

test('a bundle whose sealed serialization exceeds the byte cap is rejected before publication', () => {
    const shared = { n: 1 }, value = { repeated: Array(30000).fill(shared), padding: '' };
    value.padding = 'x'.repeat(DEFAULT_LIMITS.maxBytes - 64 - serialize(value).byteLength);
    assert.ok(serialize(value).byteLength < DEFAULT_LIMITS.maxBytes);
    assert.ok(serialize(deepFreeze(seal('correspondence', value))).byteLength > DEFAULT_LIMITS.maxBytes);
    assert.throws(() => sealGeneratedBundle(value), { code: 'LIMIT_EXCEEDED' });
});

test('the generated seal reserves its ID node within the existing JSON node limit', () => {
    const oneTooMany = { values: Array(DEFAULT_LIMITS.maxJsonNodes - 2).fill(0) };
    assert.throws(() => sealGeneratedBundle(oneTooMany), { code: 'LIMIT_EXCEEDED' });
    const maximum = { values: Array(DEFAULT_LIMITS.maxJsonNodes - 3).fill(0) };
    const { bundle } = sealGeneratedBundle(maximum);
    assert.doesNotThrow(() => checkedJson(bundle, { ...DEFAULT_LIMITS, maxBytes: 64 * 1024 * 1024 }));
});

test('shared payload validation retains the JSON trust and structural boundaries', () => {
    const cycle = {}; cycle.self = cycle;
    let getterReads = 0;
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { getterReads++; return 'unsafe'; } });
    const hostile = JSON.parse('{"__proto__":{"injected":true}}');
    const decorated = []; decorated.extra = 1;
    for (const value of [cycle, getter, hostile, { constructor: 1 }, { prototype: 1 }, new Date(),
        { value: undefined }, { value: NaN }, { value: () => 1 }, { [Symbol('key')]: 1 }, decorated, Array(2)]) {
        assert.throws(() => sealGeneratedBundle(value), { code: 'INVALID_INPUT' });
    }
    assert.equal(getterReads, 0);
    let deep = {};
    for (let i = 0; i < 66; i++) deep = { child: deep };
    assert.throws(() => sealGeneratedBundle(deep), { code: 'LIMIT_EXCEEDED' });
    assert.throws(() => sealGeneratedBundle({ values: Array(DEFAULT_LIMITS.maxJsonNodes).fill(0) }), { code: 'LIMIT_EXCEEDED' });
    assert.throws(() => sealGeneratedBundle({ id: 'caller-seal' }), { code: 'INVALID_INPUT' });
});
