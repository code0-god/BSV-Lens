'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    parseBsvFile,
    parseCallableSignature
} = require('../src/architecture/parser');

test('callable signatures exclude inline bodies from name and parameter parsing', () => {
    const cases = [
        ['Bool workValid = isValid(current)', 'workValid', 'Bool', [], ''],
        ['Bool startReady = !isValid(activeDescriptor)', 'startReady', 'Bool', [], ''],
        ['SomeType foo = bar(value)', 'foo', 'SomeType', [], ''],
        [
            'Action start(AquaMatmulDescriptor descriptor)',
            'start',
            'Action',
            [{ name: 'descriptor', type: 'AquaMatmulDescriptor' }],
            ''
        ],
        [
            'Action publishStripe(ActivationStripe stripe)',
            'publishStripe',
            'Action',
            [{ name: 'stripe', type: 'ActivationStripe' }],
            ''
        ],
        ['ArrayWork#(arrayDim) currentWork', 'currentWork', 'ArrayWork#(arrayDim)', [], ''],
        ['Bool ready if (condition)', 'ready', 'Bool', [], 'condition'],
        ['Bool ready = expression', 'ready', 'Bool', [], ''],
        ['Foo#(n) value = makeFoo(x)', 'value', 'Foo#(n)', [], ''],
        [
            'SomeType foo(Type a, Type b)',
            'foo',
            'SomeType',
            [{ name: 'a', type: 'Type' }, { name: 'b', type: 'Type' }],
            ''
        ],
        ['SomeType foo = expression', 'foo', 'SomeType', [], '']
    ];

    for (const [signature, name, returnType, parameters, guard] of cases) {
        assert.deepEqual(parseCallableSignature(signature), {
            name,
            nameOffset: signature.indexOf(name),
            returnType,
            parameters,
            guard
        });
    }
});

test('inline value methods and functions retain declared semantic names', () => {
    const parsed = parseBsvFile(`
package InlineValues;
interface InlineValuesIfc;
    method Bool startReady;
    method Bool workValid;
    method Foo#(n) value;
endinterface
module mkInlineValues(InlineValuesIfc);
    method Bool startReady = !isValid(activeDescriptor);
    method Bool workValid = isValid(activeDescriptor) && isValid(activeStripe);
    method Foo#(n) value = makeFoo(x);
endmodule
function SomeType foo = bar(x);
endpackage
`, {
        uri: 'file:///InlineValues.bsv',
        relativePath: 'InlineValues.bsv'
    });

    assert.deepEqual(parsed.modules[0].methods.map((method) => ({
        name: method.name,
        returnType: method.returnType,
        parameters: method.parameters,
        inline: method.inline,
        calls: method.calls.map((call) => call.name)
    })), [
        {
            name: 'startReady',
            returnType: 'Bool',
            parameters: [],
            inline: true,
            calls: ['isValid']
        },
        {
            name: 'workValid',
            returnType: 'Bool',
            parameters: [],
            inline: true,
            calls: ['isValid']
        },
        {
            name: 'value',
            returnType: 'Foo#(n)',
            parameters: [],
            inline: true,
            calls: ['makeFoo']
        }
    ]);
    assert.deepEqual(parsed.functions.map((fn) => ({
        name: fn.name,
        returnType: fn.returnType,
        parameters: fn.parameters,
        calls: fn.calls.map((call) => call.name)
    })), [{
        name: 'foo',
        returnType: 'SomeType',
        parameters: [],
        calls: ['bar']
    }]);
});
