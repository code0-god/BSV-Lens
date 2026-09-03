'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const {
    SourceScheduleProvider,
    parseSourceScheduling
} = require('../src/architecture/scheduling');
const {
    BscScheduleProvider,
    parseBscScheduleReport
} = require('../src/compiler/bsc-schedule-provider');

const FIXTURES = path.join(__dirname, 'fixtures');

async function fixture(name) {
    return fs.readFile(path.join(FIXTURES, name), 'utf8');
}

test('source scheduling attributes preserve direction, evidence, and location while ignoring fakes', async () => {
    const relations = parseSourceScheduling(await fixture('scheduling-attributes.bsv'), {
        uri: 'file:///workspace/SchedulingAttributes.bsv'
    });

    assert.equal(relations.length, 10);
    assert.deepEqual(
        relations.filter((item) => item.kind === 'descending-urgency').map(({ from, to }) => [from, to]),
        [['chooseFast', 'chooseSlow'], ['chooseFast', 'fallback'], ['chooseSlow', 'fallback']]
    );
    assert.deepEqual(
        relations.filter((item) => item.kind === 'preempts').map(({ from, to }) => [from, to]),
        [['reset', 'producer'], ['reset', 'consumer']]
    );
    assert.equal(relations.filter((item) => item.bidirectional).length, 4);
    assert.ok(relations.every((item) => item.origin === 'source-attribute'));
    assert.ok(relations.every((item) => item.confidence === 'explicit'));
    assert.ok(relations.every((item) => item.evidence.startsWith('(*')));
    assert.deepEqual(relations[0].location, {
        uri: 'file:///workspace/SchedulingAttributes.bsv',
        line: 6,
        column: 0,
        endLine: 6,
        endColumn: 61
    });
    assert.ok(relations.every((item) => !item.from.startsWith('fake')));
});

test('SourceScheduleProvider reports availability and combines source files', async () => {
    const provider = new SourceScheduleProvider();
    assert.equal(provider.isAvailable({}), false);
    const context = {
        sourceFiles: [
            { uri: 'one.bsv', text: '(* conflict_free = "a, b" *)' },
            { uri: 'two.bsv', text: '(* execution_order = "b, c" *)' }
        ]
    };
    assert.equal(provider.isAvailable(context), true);
    const result = await provider.analyze(context);
    assert.equal(result.available, true);
    assert.deepEqual(result.relations.map(({ from, to, kind }) => ({ from, to, kind })), [
        { from: 'a', to: 'b', kind: 'conflict-free' },
        { from: 'b', to: 'c', kind: 'execution-order' }
    ]);
});

test('BSC report parser accepts realistic and compact relation forms', async () => {
    const realistic = parseBscScheduleReport(await fixture('realistic.sched'), { uri: 'mkPipeline.sched' });
    assert.deepEqual(realistic.map(({ from, to, kind, bidirectional }) => ({ from, to, kind, bidirectional })), [
        { from: 'RL_load', to: 'RL_drain', kind: 'conflict-free', bidirectional: true },
        { from: 'RL_load', to: 'RL_reset', kind: 'conflict', bidirectional: true },
        { from: 'RL_stage', to: 'RL_commit', kind: 'execution-order', bidirectional: false },
        { from: 'RL_commit', to: 'RL_reset', kind: 'sequential-before-reverse', bidirectional: false },
        { from: 'RL_load', to: 'RL_stage', kind: 'execution-order', bidirectional: false }
    ]);
    assert.ok(realistic.every((item) => item.origin === 'bsc' && item.confidence === 'authoritative'));
    assert.ok(realistic.every((item) => item.location.uri === 'mkPipeline.sched'));

    const compact = parseBscScheduleReport(await fixture('compact.sched'));
    assert.deepEqual(new Set(compact.map((item) => item.kind)), new Set([
        'conflict', 'conflict-free', 'sequential-before',
        'sequential-before-reverse', 'execution-order'
    ]));
    assert.equal(compact.length, 8);

    const current = parseBscScheduleReport(await fixture('bsc-2026.sched'), { uri: 'mkSystolicArray.sched' });
    assert.deepEqual(current.map(({ from, to, kind }) => ({ from, to, kind })), [
        { from: 'done', to: 'start', kind: 'sequential-before' },
        { from: 'done', to: 'start', kind: 'execution-order' },
        { from: 'start', to: 'step', kind: 'execution-order' }
    ]);
    assert.ok(current.every((item) => item.origin === 'bsc' && item.confidence === 'authoritative'));
});

test('BscScheduleProvider reads workspace-contained reports without process execution', async () => {
    let executions = 0;
    const provider = new BscScheduleProvider({
        realpath: async (filePath) => filePath,
        readFile: async (filePath) => {
            assert.equal(filePath, path.resolve('/workspace/build/mkTop.sched'));
            return fixture('compact.sched');
        },
        execFile() { executions += 1; }
    });
    const context = {
        workspacePath: '/workspace',
        workspaceTrusted: false,
        scheduling: {
            workingDirectory: '.',
            reportFiles: ['build/mkTop.sched']
        }
    };

    assert.equal(await provider.isAvailable(context), true);
    const result = await provider.analyze(context);
    assert.equal(result.available, true);
    assert.equal(result.source, 'report-files');
    assert.equal(result.relations.length, 8);
    assert.equal(executions, 0);
});

test('BscScheduleProvider blocks external reports in an untrusted workspace', async () => {
    let reads = 0;
    const provider = new BscScheduleProvider({
        realpath: async (filePath) => filePath,
        readFile: async () => { reads += 1; return fixture('compact.sched'); }
    });
    const result = await provider.analyze({
        workspacePath: '/workspace',
        workspaceTrusted: false,
        scheduling: {
            workingDirectory: '.',
            reportFiles: ['/outside/mkTop.sched']
        }
    });

    assert.equal(result.available, false);
    assert.equal(reads, 0);
    assert.match(result.diagnostics[0].message, /trusted workspace/);
});

test('BscScheduleProvider probes help then invokes supported flags with executable separate from argv', async () => {
    const calls = [];
    const output = [];
    const provider = new BscScheduleProvider({
        readFile: async () => { throw new Error('missing'); },
        makeTempDirectory: async () => '/tmp/bsv-arch-test',
        removeDirectory: async () => {},
        output: (text) => output.push(text),
        execFile(executable, argv, options, callback) {
            calls.push({ executable, argv: [...argv], cwd: options.cwd });
            if (argv[0] === '-help') {
                callback(null, 'options: -show-schedule -show-rule-rel-all -g -u\n', '');
            } else {
                callback(null, 'left CF right\nleft SB finish\n', '');
            }
            return { kill() {} };
        }
    });
    const result = await provider.analyze({
        workspacePath: '/workspace',
        workspaceTrusted: true,
        inputFiles: ['Top.bsv'],
        scheduling: {
            bscExecutable: '/opt/bsc/bin/bsc',
            workingDirectory: 'hardware',
            topModule: 'mkTop',
            sourcePaths: ['lib'],
            arguments: ['-D', 'TRACE'],
            reportFiles: [],
            timeoutMs: 1000
        }
    });

    assert.equal(result.available, true);
    assert.deepEqual(calls, [
        { executable: '/opt/bsc/bin/bsc', argv: ['-help'], cwd: '/workspace/hardware' },
        {
            executable: '/opt/bsc/bin/bsc',
            argv: [
                '-D', 'TRACE', '-sim', '-show-schedule', '-show-rule-rel-all',
                '-bdir', '/tmp/bsv-arch-test', '-simdir', '/tmp/bsv-arch-test',
                '-info-dir', '/tmp/bsv-arch-test', '-p', '+:lib',
                '-g', 'mkTop', '-u', 'Top.bsv'
            ],
            cwd: '/workspace/hardware'
        }
    ]);
    assert.deepEqual(result.relations.map((item) => item.kind), ['conflict-free', 'sequential-before']);
    assert.ok(output.join('').includes('left CF right'));
});

test('BscScheduleProvider ignores generated report paths outside its output directory', async () => {
    let reads = 0;
    const provider = new BscScheduleProvider({
        realpath: async (filePath) => filePath,
        readFile: async () => { reads += 1; return fixture('compact.sched'); },
        makeTempDirectory: async () => '/tmp/bsv-lens-output',
        removeDirectory: async () => {},
        execFile(_executable, argv, _options, callback) {
            if (argv[0] === '-help') {
                callback(null, '-show-schedule -show-rule-rel-all', '');
            } else {
                callback(null, 'Schedule dump file created: /outside/leak.sched', '');
            }
            return { kill() {} };
        }
    });

    const result = await provider.analyze({
        workspacePath: '/workspace',
        workspaceTrusted: true,
        inputFiles: ['/workspace/Top.bsv'],
        scheduling: { topModule: 'mkTop', timeoutMs: 1000 }
    });

    assert.equal(result.available, true);
    assert.equal(reads, 0);
    assert.match(result.diagnostics[0].message, /compiler output directory/);
});

test('BscScheduleProvider discovers hidden relation-report capability', async () => {
    const calls = [];
    const provider = new BscScheduleProvider({
        readFile: async () => { throw new Error('missing'); },
        makeTempDirectory: async () => '/tmp/bsv-arch-hidden-test',
        removeDirectory: async () => {},
        execFile(_executable, argv, _options, callback) {
            calls.push([...argv]);
            if (argv[0] === '-help') callback(null, '-show-schedule', '');
            else if (argv[0] === '-help-hidden') callback(null, '-show-rule-rel-all', '');
            else callback(null, 'left CF right', '');
            return { kill() {} };
        }
    });

    const result = await provider.analyze({
        workspaceTrusted: true,
        inputFiles: ['Top.bsv'],
        scheduling: { topModule: 'mkTop', timeoutMs: 1000 }
    });

    assert.equal(result.available, true);
    assert.deepEqual(calls.map((argv) => argv[0]), ['-help', '-help-hidden', '-sim']);
});

test('BscScheduleProvider gracefully declines unsupported BSC and honors cancellation', async () => {
    const unsupportedCalls = [];
    const unsupported = new BscScheduleProvider({
        execFile(_executable, argv, _options, callback) {
            unsupportedCalls.push(argv);
            callback(null, 'usage: bsc -sim -u', '');
            return { kill() {} };
        }
    });
    const unavailable = await unsupported.analyze({
        workspaceTrusted: true,
        inputFiles: ['Top.bsv'],
        scheduling: { timeoutMs: 1000 }
    });
    assert.equal(unavailable.available, false);
    assert.deepEqual(unsupportedCalls, [['-help'], ['-help-hidden']]);
    assert.match(unavailable.reason, /does not advertise/);

    const listeners = new Set();
    const token = {
        isCancellationRequested: false,
        onCancellationRequested(listener) {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        }
    };
    let invocationStarted;
    const started = new Promise((resolve) => { invocationStarted = resolve; });
    let killed = false;
    const cancellable = new BscScheduleProvider({
        execFile(_executable, argv, _options, callback) {
            if (argv[0] === '-help') {
                callback(null, '-show-schedule -show-rule-rel-all', '');
                return { kill() {} };
            }
            invocationStarted();
            return { kill() { killed = true; } };
        }
    });
    const pending = cancellable.analyze({
        workspaceTrusted: true,
        inputFiles: ['Top.bsv'],
        scheduling: { timeoutMs: 1000 }
    }, token);
    await started;
    token.isCancellationRequested = true;
    for (const listener of [...listeners]) listener();
    const cancelled = await pending;
    assert.equal(cancelled.available, false);
    assert.match(cancelled.reason, /cancelled/);
    assert.equal(killed, true);
});
