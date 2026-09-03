'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { WorkspaceAnalyzer } = require('../src/architecture/analyzer');

test('analysis reports deterministic phase timing and file metrics', async () => {
    const { vscode, folder } = workspaceFixture({
        'Top.bsv': 'package Top; module mkTop(Empty); endmodule endpackage'
    });
    let tick = 0;
    const analyzer = new WorkspaceAnalyzer(vscode, { clock: () => tick++ * 5 });
    const model = await analyzer.analyze({ folder });

    assert.deepEqual(model.analysisTiming, {
        totalMs: 55,
        configMs: 5,
        discoveryMs: 5,
        readParseMs: 5,
        schedulingMs: 5,
        graphBuildMs: 5
    });
    assert.deepEqual(model.analysisMetrics, {
        discoveredFiles: 1,
        eligibleFiles: 1,
        parsedFiles: 1,
        skippedFiles: 0,
        nodes: model.stats.nodes,
        edges: model.stats.edges
    });
});

test('analysis enforces source size and reports structured skip metadata', async () => {
    const { vscode, folder } = workspaceFixture({
        'Small.bsv': 'package Small; module mkSmall(Empty); endmodule endpackage',
        'Large.bsv': `package Large; ${' '.repeat(256)} endpackage`
    }, { maxSourceBytes: 96 });
    const model = await new WorkspaceAnalyzer(vscode).analyze({ folder });

    assert.equal(model.stats.files, 1);
    assert.deepEqual(model.limits, {
        ...model.limits,
        maxFiles: 750,
        maxSourceBytes: 96,
        maxNodes: 10000,
        maxEdges: 25000,
        sourceFilesSkipped: 1
    });
    assert.ok(model.diagnostics.some((item) => /larger than 96 bytes/.test(item.message)));
});

test('analysis truncates nodes and edges deterministically without dangling edges', async () => {
    const { vscode, folder } = workspaceFixture({
        'Top.bsv': `
package Top;
module mkTop(Empty);
    rule first; noAction; endrule
    rule second; noAction; endrule
    rule third; noAction; endrule
endmodule
endpackage
`
    }, { maxNodes: 3, maxEdges: 1 });
    const model = await new WorkspaceAnalyzer(vscode).analyze({ folder });
    const nodeIds = new Set(model.nodes.map((node) => node.id));

    assert.equal(model.nodes.length, 3);
    assert.equal(model.edges.length, 1);
    assert.ok(model.limits.nodesTruncated > 0);
    assert.ok(model.limits.edgesTruncated > 0);
    assert.ok(model.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)));
    assert.ok(model.diagnostics.some((item) => item.code === 'limit.nodes'));
    assert.ok(model.diagnostics.some((item) => item.code === 'limit.edges'));
});

test('large synthetic graph truncation is deterministic without timing sleeps', async () => {
    const rules = Array.from({ length: 1000 }, (_, index) =>
        `rule rule${index}; noAction; endrule`
    ).join('\n');
    const fixture = workspaceFixture({
        'Large.bsv': `package Large; module mkLarge(Empty); ${rules} endmodule endpackage`
    }, { maxNodes: 500, maxEdges: 200 });

    const first = await new WorkspaceAnalyzer(fixture.vscode).analyze({ folder: fixture.folder });
    const second = await new WorkspaceAnalyzer(fixture.vscode).analyze({ folder: fixture.folder });

    assert.equal(first.nodes.length, 500);
    assert.equal(first.edges.length, 200);
    assert.deepEqual(first.nodes.map((node) => node.id), second.nodes.map((node) => node.id));
    assert.deepEqual(
        first.edges.map(({ source, target, kind }) => ({ source, target, kind })),
        second.edges.map(({ source, target, kind }) => ({ source, target, kind }))
    );
    assert.equal(first.limits.originalNodes, 1002);
    assert.equal(first.limits.originalEdges, 1001);
});

function workspaceFixture(files, settings = {}) {
    const root = '/workspace';
    const uri = (relativePath) => ({
        scheme: 'file',
        fsPath: `${root}/${relativePath}`,
        path: `${root}/${relativePath}`,
        toString: () => `file://${root}/${relativePath}`
    });
    const folder = { name: 'workspace', uri: uri('') };
    const entries = new Map(Object.entries(files));
    const vscode = {
        FileType: { Directory: 2 },
        RelativePattern: class RelativePattern {
            constructor(base, pattern) {
                this.base = base;
                this.pattern = pattern;
            }
        },
        Uri: {
            joinPath(_base, ...parts) {
                return uri(parts.join('/'));
            }
        },
        workspace: {
            isTrusted: true,
            getConfiguration() {
                return {
                    get(key, fallback) {
                        return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
                    },
                    inspect() {
                        return null;
                    }
                };
            },
            async findFiles(_include, _exclude, limit) {
                return [...entries.keys()].slice(0, limit).map(uri);
            },
            fs: {
                async readFile(resource) {
                    if (resource.fsPath.endsWith('.bsv-arch.json')) {
                        return Buffer.from('{"sourceRoots":["."],"scheduling":{"provider":"source"}}');
                    }
                    return Buffer.from(entries.get(resource.fsPath.slice(root.length + 1)));
                }
            }
        }
    };
    return { vscode, folder };
}

module.exports = { workspaceFixture };
