'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    groupForPath,
    makeStarterConfig,
    normalizeConfig,
    parseJsonc,
    stripJsonComments
} = require('../src/architecture/config');

test('JSONC parser keeps comment-like text inside strings', () => {
    const raw = parseJsonc(`{
        // workspace title
        "title": "https://example.invalid/a//b",
        /* roots */
        "sourceRoots": ["hw/bsv/src"]
    }`);
    assert.equal(raw.title, 'https://example.invalid/a//b');
    assert.deepEqual(raw.sourceRoots, ['hw/bsv/src']);
});

test('group matching uses the first configured path match', () => {
    const config = normalizeConfig({
        groups: [
            { id: 'memory', label: 'Memory', match: 'hw/bsv/src/memory/**', order: 10 },
            { id: 'fallback', label: 'Fallback', match: '**', order: 100 }
        ]
    });
    assert.equal(groupForPath(config, 'hw/bsv/src/memory/Scratchpad.bsv'), 'memory');
    assert.equal(groupForPath(config, 'hw/bsv/src/control/AcceleratorTop.bsv'), 'fallback');
});

test('starter configuration is generic and source-layout neutral', () => {
    const config = makeStarterConfig('Example Project');
    assert.equal(config.title, 'Example Project BSV Architecture');
    assert.deepEqual(config.sourceRoots, []);
    assert.deepEqual(config.groups, []);
    assert.ok(config.exclude.includes('**/testbench/**'));
    assert.equal(config.view.direction, 'LR');
});


test('workspace primitive setting is used unless the project config overrides it', () => {
    const fromSetting = normalizeConfig({}, { settingsShowPrimitives: true });
    assert.equal(fromSetting.view.showPrimitives, true);

    const overridden = normalizeConfig({ view: { showPrimitives: false } }, { settingsShowPrimitives: true });
    assert.equal(overridden.view.showPrimitives, false);
});

test('comment stripping preserves line count for parse diagnostics', () => {
    const source = '{\n// one\n"a": 1, /* two\nthree */\n"b": 2\n}';
    assert.equal(stripJsonComments(source).split('\n').length, source.split('\n').length);
});

test('version 1 project configuration gains safe scheduling defaults', () => {
    const config = normalizeConfig({
        version: 1,
        sourceRoots: ['src'],
        edges: [{ from: 'producer', to: 'consumer', kind: 'data' }]
    });

    assert.equal(config.version, 1);
    assert.equal(config.schemaVersion, 3);
    assert.deepEqual(config.sourceRoots, ['src']);
    assert.equal(config.edges[0].mode, 'data-flow');
    assert.equal(config.edges[0].origin, 'config');
    assert.deepEqual(config.scheduling, {
        provider: 'auto',
        bscExecutable: 'bsc',
        topModule: '',
        workingDirectory: '.',
        sourcePaths: [],
        arguments: [],
        reportFiles: [],
        timeoutMs: 30000,
        includePotentialDependencies: true
    });
});

test('scheduling configuration is bounded and normalized', () => {
    const config = normalizeConfig({
        scheduling: {
            provider: 'bsc',
            bscExecutable: '/opt/tools/bsc',
            topModule: 'mkTop',
            workingDirectory: 'hw',
            sourcePaths: ['src', 'lib'],
            arguments: ['-D', 'TRACE'],
            reportFiles: ['build/mkTop.sched'],
            timeoutMs: 999999,
            includePotentialDependencies: false
        }
    });

    assert.equal(config.scheduling.provider, 'bsc');
    assert.equal(config.scheduling.timeoutMs, 120000);
    assert.equal(config.scheduling.includePotentialDependencies, false);
    assert.deepEqual(config.scheduling.sourcePaths, ['src', 'lib']);
    assert.deepEqual(config.scheduling.arguments, ['-D', 'TRACE']);
});
