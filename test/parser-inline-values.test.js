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
    for (const method of parsed.modules[0].methods) {
        assert.equal(method.codeAnalysis.statements.length, 1);
        assert.equal(method.codeAnalysis.statements[0].kind, 'return');
        assert.equal(method.codeAnalysis.statements[0].inline, true);
        assert.equal(method.codeAnalysis.expressions.find((item) =>
            item.id === method.codeAnalysis.statements[0].expressionId).text,
        method.name === 'startReady' ? '!isValid(activeDescriptor)'
            : method.name === 'workValid' ? 'isValid(activeDescriptor) && isValid(activeStripe)'
                : 'makeFoo(x)');
    }
});

test('guarded inline method separates predicate from return expression', () => {
    const source = 'package GuardedInline;\n'
        + 'module mkTop(Empty);\n'
        + '    method Bit#(8) value if (ready) = state + 1;\n'
        + 'endmodule\nendpackage';
    const parsed = parseBsvFile(source, {
        uri: 'file:///GuardedInline.bsv',
        relativePath: 'GuardedInline.bsv'
    });
    const method = parsed.modules[0].methods[0];
    const predicate = method.codeAnalysis.expressions.find((item) => item.id === method.predicateExpressionId);
    const returned = method.codeAnalysis.statements.find((item) => item.kind === 'return');
    assert.equal(predicate.text, 'ready');
    assert.equal(method.codeAnalysis.expressions.find((item) => item.id === returned.expressionId).text, 'state + 1');
});
