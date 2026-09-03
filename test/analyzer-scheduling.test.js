'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { WorkspaceAnalyzer, resolveDefaultSourceScope } = require('../src/architecture/analyzer');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');

function context(config, overrides = {}) {
    return {
        folder: { uri: { fsPath: '/workspace', toString: () => 'file:///workspace' } },
        config: normalizeConfig(config),
        parsedFiles: [{
            packageName: 'Top',
            modules: [{ name: 'mkTop' }]
        }],
        uris: [{
            fsPath: '/workspace/Top.bsv',
            path: '/workspace/Top.bsv',
            toString: () => 'file:///workspace/Top.bsv'
        }],
        sourceFiles: [{ uri: 'file:///workspace/Top.bsv', text: 'package Top; endpackage' }],
        ...overrides
    };
}

test('auto scheduling stays source-derived without sufficient BSC build information', async () => {
    let called = false;
    const analyzer = new WorkspaceAnalyzer({ workspace: { isTrusted: true } }, {
        bscScheduleProvider: { async analyze() { called = true; return { available: true, relations: [] }; } }
    });

    const result = await analyzer.analyzeScheduling(context({
        scheduling: { provider: 'auto' }
    }));

    assert.equal(called, false);
    assert.equal(result.provider, 'source');
    assert.deepEqual(result.relations, []);
});

test('configured BSC provider passes trusted context and authoritative relations', async () => {
    const output = [];
    let received;
    const analyzer = new WorkspaceAnalyzer({ workspace: { isTrusted: true } }, {
        output: { append(value) { output.push(value); } },
        bscScheduleProvider: {
            async analyze(value, token) {
                received = { value, token };
                value.onOutput('compiler output');
                return {
                    available: true,
                    provider: 'bsc',
                    source: 'compiler-report',
                    diagnostics: [],
                    relations: [{
                        from: 'first',
                        to: 'second',
                        kind: 'conflict',
                        origin: 'bsc',
                        confidence: 'authoritative'
                    }]
                };
            }
        }
    });
    const token = { isCancellationRequested: false };
    const result = await analyzer.analyzeScheduling(context({
        scheduling: {
            provider: 'bsc',
            topModule: 'mkTop',
            sourcePaths: ['lib']
        }
    }, { token }));

    assert.equal(result.provider, 'bsc');
    assert.equal(result.relations[0].confidence, 'authoritative');
    assert.equal(received.value.workspaceTrusted, true);
    assert.deepEqual(received.value.inputFiles, ['/workspace/Top.bsv']);
    assert.equal(received.token, token);
    assert.equal(output.join(''), 'compiler output');
});

test('configured BSC scheduling retains normalized source attributes', async () => {
    const parsed = parseBsvFile(`
package Top;
(* descending_urgency = "first, second" *)
module mkTop(Empty);
    rule first; noAction; endrule
    rule second; noAction; endrule
endmodule
endpackage
`, { uri: 'file:///workspace/Top.bsv', relativePath: 'Top.bsv' });
    const analyzer = new WorkspaceAnalyzer({ workspace: { isTrusted: true } }, {
        bscScheduleProvider: {
            async analyze() {
                return {
                    available: true,
                    source: 'compiler-report',
                    diagnostics: [],
                    relations: [{
                        from: 'first',
                        to: 'second',
                        moduleName: 'mkTop',
                        kind: 'conflict',
                        origin: 'bsc',
                        confidence: 'authoritative'
                    }]
                };
            }
        }
    });

    const result = await analyzer.analyzeScheduling(context({
        scheduling: { provider: 'bsc', topModule: 'mkTop' }
    }, { parsedFiles: [parsed] }));

    assert.deepEqual(new Set(result.relations.map((item) => item.origin)), new Set([
        'source-attribute',
        'bsc'
    ]));
});

test('unavailable BSC falls back to source relations without throwing', async () => {
    const analyzer = new WorkspaceAnalyzer({ workspace: { isTrusted: true } }, {
        bscScheduleProvider: {
            async analyze() {
                return {
                    available: false,
                    relations: [],
                    diagnostics: [],
                    reason: 'BSC executable not found'
                };
            }
        }
    });
    const result = await analyzer.analyzeScheduling(context({
        scheduling: { provider: 'bsc', topModule: 'mkTop' }
    }));

    assert.equal(result.provider, 'source');
    assert.match(result.diagnostics[0].message, /BSC executable not found/);
});

test('deprecated defaultView migrates unless new source scope is explicitly configured', () => {
    const legacy = {
        get(key) {
            return key === 'defaultView' ? 'file' : 'workspace';
        },
        inspect() {
            return { defaultValue: 'workspace' };
        }
    };
    assert.equal(resolveDefaultSourceScope(legacy), 'current-file');

    const explicit = {
        get(key) {
            return key === 'defaultView' ? 'system' : 'workspace';
        },
        inspect() {
            return { defaultValue: 'workspace', globalValue: 'current-file' };
        }
    };
    assert.equal(resolveDefaultSourceScope(explicit), 'current-file');
});
