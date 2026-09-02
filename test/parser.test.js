'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseBsvFile } = require('../src/architecture/parser');

const ROOT = path.join(__dirname, '..');

function parseExample(relativePath) {
    const filePath = path.join(ROOT, 'examples', 'bsv-mini-accelerator', relativePath);
    return parseBsvFile(fs.readFileSync(filePath, 'utf8'), {
        uri: `file://${filePath}`,
        relativePath
    });
}

test('LocalAddress is recognized as a utility package with address types and functions', () => {
    const parsed = parseExample('hw/bsv/src/common/LocalAddress.bsv');

    assert.equal(parsed.packageName, 'LocalAddress');
    assert.equal(parsed.modules.length, 0);
    assert.deepEqual(parsed.types.map((item) => [item.kind, item.name]), [
        ['enum', 'LocalRegion'],
        ['struct', 'LocalAddress'],
        ['struct', 'BankedRow']
    ]);
    assert.deepEqual(parsed.functions.map((item) => item.name), [
        'mapGlobalRow',
        'offsetBankedAddress'
    ]);
    assert.equal(parsed.diagnostics.length, 0);

    const map = parsed.functions[0];
    assert.deepEqual(map.parameters.map((item) => item.name), ['globalRow', 'bankCount']);
    assert.ok(map.locals.some((item) => item.name === 'localRow'));
    assert.ok(map.operations.some((item) => item.symbol === '%'));
    assert.ok(map.operations.some((item) => item.symbol === '/'));
});

test('module members, implementation instances, rules, and annotations are extracted', () => {
    const parsed = parseExample('hw/bsv/src/control/AcceleratorTop.bsv');
    assert.equal(parsed.modules.length, 1);

    const module = parsed.modules[0];
    assert.equal(module.name, 'mkAcceleratorTop');
    assert.equal(module.returnInterface, 'AcceleratorTopIfc');
    assert.equal(module.annotations.group, 'control');
    assert.equal(module.annotations.label, 'Mini Accelerator Top');
    assert.equal(module.annotations.entry, true);
    assert.deepEqual(module.instances.map((item) => item.constructor), [
        'mkAcceleratorController',
        'mkMemorySubsystem',
        'mkVectorQuantizer',
        'mkSystolicArray'
    ]);
    assert.deepEqual(module.rules.map((item) => item.name), ['dispatch']);
    assert.ok(module.rules[0].references.includes('controller'));
    assert.ok(module.rules[0].references.includes('array'));
    assert.deepEqual(module.providedInterfaces.map((item) => item.name), ['control']);
});

test('primitive storage instances are classified for behavior-level filtering', () => {
    const parsed = parseExample('hw/bsv/src/control/AcceleratorController.bsv');
    const module = parsed.modules[0];
    const byName = new Map(module.instances.map((item) => [item.name, item]));

    assert.equal(byName.get('commandQueue').primitiveKind, 'fifo');
    assert.equal(byName.get('acceptedCommands').primitiveKind, 'register');
    assert.deepEqual(module.methods.map((item) => item.name), [
        'ready',
        'put',
        'issueValid',
        'issue',
        'consume'
    ]);
});

test('comments and strings cannot manufacture false BSV declarations', () => {
    const source = `
package Safe;
// module mkFake(Empty); endmodule
/* function Bool fake(); return True; endfunction */
function String message();
    return "module mkStringFake(Empty); endmodule";
endfunction
endpackage
`;
    const parsed = parseBsvFile(source, {
        uri: 'file:///Safe.bsv',
        relativePath: 'Safe.bsv'
    });

    assert.equal(parsed.modules.length, 0);
    assert.deepEqual(parsed.functions.map((item) => item.name), ['message']);
});

test('a missing package is diagnosed and the filename becomes the fallback package name', () => {
    const parsed = parseBsvFile('function Bool valid() = True;', {
        uri: 'file:///Fallback.bsv',
        relativePath: 'Fallback.bsv'
    });
    assert.equal(parsed.packageName, 'Fallback');
    assert.equal(parsed.diagnostics[0].severity, 'warning');
});
