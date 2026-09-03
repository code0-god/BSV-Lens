'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { analyzeTypeWidth } = require('../src/architecture/type-analysis');

const types = [
    { kind: 'alias', name: 'Word', details: { target: 'UInt#(32)' } },
    {
        kind: 'struct',
        name: 'Packet',
        details: {
            fields: [
                { name: 'valid', type: 'Bool' },
                { name: 'payload', type: 'Word' },
                { name: 'metadata', type: 'Maybe#(Tuple2#(Bit#(3), Int#(4)))' }
            ]
        }
    },
    { kind: 'enum', name: 'State', details: { variants: ['Idle', 'Load', 'Run', 'Done', 'Error'] } }
];

test('Bool has exact width 1', () => {
    assert.deepEqual(analyzeTypeWidth('Bool'), { bits: 1, status: 'exact', origin: 'Bool' });
});

test('Bit numeric literal and balanced parentheses resolve exactly', () => {
    assert.deepEqual(analyzeTypeWidth('Bit#(((32)))'), {
        bits: 32,
        status: 'exact',
        origin: 'Bit#(((32)))'
    });
});

test('UInt numeric literal resolves exactly', () => {
    assert.deepEqual(analyzeTypeWidth('UInt#(16)'), { bits: 16, status: 'exact', origin: 'UInt#(16)' });
});

test('Int numeric literal resolves exactly', () => {
    assert.deepEqual(analyzeTypeWidth('Int#(8)'), { bits: 8, status: 'exact', origin: 'Int#(8)' });
});

test('direct typedef aliases resolve to their exact target width', () => {
    assert.deepEqual(analyzeTypeWidth('Word', types), { bits: 32, status: 'exact', origin: 'Word' });
});

test('struct resolves only when every field resolves', () => {
    assert.deepEqual(analyzeTypeWidth('Packet', types), { bits: 41, status: 'exact', origin: 'Packet' });
    assert.deepEqual(analyzeTypeWidth('Tuple4#(Bool, Bit#(2), UInt#(3), Int#(4))'), {
        bits: 10,
        status: 'exact',
        origin: 'Tuple4#(Bool, Bit#(2), UInt#(3), Int#(4))'
    });
});

test('enum uses minimum width needed for its tag', () => {
    assert.deepEqual(analyzeTypeWidth('State', types), { bits: 3, status: 'exact', origin: 'State' });
});

test('enum width accounts for explicit values and never returns zero bits', () => {
    const encoded = [
        {
            kind: 'enum',
            name: 'Encoded',
            details: {
                variants: ['Idle', 'Busy', 'Error'],
                variantValues: [
                    { name: 'Idle', value: '0' },
                    { name: 'Busy', value: '3' },
                    { name: 'Error', value: '7' }
                ]
            }
        },
        {
            kind: 'enum',
            name: 'Singleton',
            details: {
                variants: ['Only'],
                variantValues: [{ name: 'Only', value: null }]
            }
        }
    ];

    assert.deepEqual(analyzeTypeWidth('Encoded', encoded), {
        bits: 3,
        status: 'exact',
        origin: 'Encoded'
    });
    assert.deepEqual(analyzeTypeWidth('Singleton', encoded), {
        bits: 1,
        status: 'exact',
        origin: 'Singleton'
    });
});

test('symbolic enum encodings remain unresolved instead of using variant count', () => {
    const symbolic = [{
        kind: 'enum',
        name: 'Symbolic',
        details: {
            variants: ['Idle', 'Dynamic'],
            variantValues: [
                { name: 'Idle', value: '0' },
                { name: 'Dynamic', value: 'encodingWidth' }
            ]
        }
    }];

    assert.deepEqual(analyzeTypeWidth('Symbolic', symbolic), {
        bits: null,
        status: 'unresolved',
        reason: 'enum Symbolic has nonliteral encoding encodingWidth'
    });
});

test('unresolved numeric parameters remain unresolved', () => {
    assert.deepEqual(analyzeTypeWidth('Bit#(weightWidth)'), {
        bits: null,
        status: 'unresolved',
        reason: 'numeric type parameter weightWidth'
    });
});

test('unsupported and external type expressions remain unresolved', () => {
    for (const expression of ['Vector#(4, Bit#(8))', 'TAdd#(8, 24)', 'Other::Word']) {
        const result = analyzeTypeWidth(expression, types);
        assert.equal(result.bits, null);
        assert.equal(result.status, 'unresolved');
        assert.ok(result.reason);
    }
});

test('failed and cyclic resolution never returns a guessed width', () => {
    const cyclic = [
        { kind: 'alias', name: 'A', details: { target: 'B' } },
        { kind: 'alias', name: 'B', details: { target: 'A' } },
        { kind: 'struct', name: 'Partial', details: { fields: [{ name: 'value', type: 'Unknown' }] } }
    ];
    for (const expression of ['A', 'Partial', 'Bit#(TLog#(32))', 'Bit#((32) + 1)']) {
        const result = analyzeTypeWidth(expression, cyclic);
        assert.equal(result.bits, null);
        assert.equal(result.status, 'unresolved');
        assert.ok(result.reason);
    }
});
