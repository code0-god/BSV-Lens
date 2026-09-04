'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ArchitecturePanel } = require('../src/panel/architecture-panel');

function makePanel(enabled = true) {
    const messages = [];
    const instance = Object.create(ArchitecturePanel.prototype);
    instance.model = {
        nodes: [
            {
                id: 'module',
                kind: 'module',
                sourceRange: {
                    uri: 'file:///Top.bsv',
                    line: 0,
                    column: 0,
                    endLine: 20,
                    endColumn: 9
                }
            },
            {
                id: 'rule',
                kind: 'rule',
                sourceRange: {
                    uri: 'file:///Top.bsv',
                    line: 5,
                    column: 4,
                    endLine: 9,
                    endColumn: 11
                }
            }
        ]
    };
    instance.panel = {
        webview: {
            postMessage(message) {
                messages.push(message);
                return Promise.resolve(true);
            }
        }
    };
    instance.vscode = {
        workspace: {
            getConfiguration() {
                return { get(_key, fallback) { return enabled ?? fallback; } };
            }
        }
    };
    instance.lastRevealedNodeId = null;
    return { instance, messages };
}

function selection(line, character) {
    return {
        textEditor: {
            document: {
                uri: {
                    path: '/Top.bsv',
                    toString() { return 'file:///Top.bsv'; }
                }
            }
        },
        selections: [{ active: { line, character } }]
    };
}

test('editor selection reveals smallest matching architecture node', () => {
    const { instance, messages } = makePanel(true);
    instance.revealEditorSelection(selection(6, 8));

    assert.deepEqual(messages, [{ type: 'revealNode', nodeId: 'rule' }]);
    instance.revealEditorSelection(selection(6, 8));
    assert.equal(messages.length, 1);
});

test('editor synchronization respects setting and BSV files', () => {
    const disabled = makePanel(false);
    disabled.instance.revealEditorSelection(selection(6, 8));
    assert.equal(disabled.messages.length, 0);

    const other = makePanel(true);
    const event = selection(6, 8);
    event.textEditor.document.uri.path = '/Top.txt';
    other.instance.revealEditorSelection(event);
    assert.equal(other.messages.length, 0);
});

test('stale webview state cannot overwrite a newer host request', async () => {
    const { instance } = makePanel(true);
    instance.refreshToken = 2;
    instance.modelRevision = 2;
    instance.request = {
        initialSourceScope: 'current-file',
        initialLevel: 'module',
        initialAnalysisMode: 'structure',
        initialHopScope: 'all',
        focusId: 'module'
    };

    await instance.handleMessage({
        type: 'state',
        revision: 1,
        state: {
            sourceScope: 'workspace',
            level: 'system',
            analysisMode: 'scheduling',
            hopScope: '1',
            focusStack: []
        }
    });
    await instance.handleMessage({
        type: 'state',
        state: {
            sourceScope: 'workspace',
            level: 'system',
            analysisMode: 'scheduling',
            hopScope: '1',
            focusStack: []
        }
    });

    assert.deepEqual(instance.request, {
        initialSourceScope: 'current-file',
        initialLevel: 'module',
        initialAnalysisMode: 'structure',
        initialHopScope: 'all',
        focusId: 'module'
    });

    await instance.handleMessage({
        type: 'state',
        revision: 2,
        state: {
            sourceScope: 'workspace',
            level: 'system',
            analysisMode: 'scheduling',
            hopScope: '1',
            focusStack: ['rule']
        }
    });

    assert.deepEqual(instance.request, {
        initialSourceScope: 'workspace',
        initialLevel: 'system',
        initialAnalysisMode: 'scheduling',
        initialHopScope: '1',
        focusId: 'rule'
    });
});

test('ready model message carries current refresh revision', async () => {
    const { instance, messages } = makePanel(true);
    instance.refreshToken = 3;
    instance.modelRevision = 2;
    instance.request = {};
    instance.defaultView = () => 'system';
    instance.defaultViewState = () => ({
        sourceScope: 'workspace',
        level: 'system',
        analysisMode: 'structure',
        hopScope: 'all'
    });
    instance.resolveInitialFocus = () => null;

    await instance.handleMessage({ type: 'ready' });

    assert.equal(messages[0].type, 'model');
    assert.equal(messages[0].revision, 2);
    assert.equal(messages[0].resetView, false);
});

test('direct source navigation accepts only locations owned by current model', async () => {
    // Given
    const opened = [];
    const selected = [];
    const instance = Object.create(ArchitecturePanel.prototype);
    const modelLocation = {
        uri: 'file:///workspace/Top.bsv',
        line: 8,
        column: 4
    };
    instance.model = {
        nodes: [{ id: 'top', location: modelLocation }],
        edges: [{
            id: 'flow',
            sourceLocation: {
                uri: 'file:///workspace/Flow.bsv',
                line: 2,
                column: 1
            }
        }],
        diagnostics: [],
        semanticDiagnostics: []
    };
    instance.vscode = {
        Uri: { parse(uri) { return { uri }; } },
        Position: class Position {
            constructor(line, column) {
                this.line = line;
                this.column = column;
            }
        },
        Selection: class Selection {
            constructor(start, end) {
                this.start = start;
                this.end = end;
            }
        },
        Range: class Range {
            constructor(start, end) {
                this.start = start;
                this.end = end;
            }
        },
        TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
        ViewColumn: { One: 1 },
        workspace: {
            async openTextDocument(uri) {
                opened.push(uri.uri);
                return { uri };
            }
        },
        window: {
            async showTextDocument() {
                return {
                    set selection(value) { selected.push(value); },
                    revealRange() {}
                };
            }
        }
    };

    // When
    await instance.openSource(null, instance.model.edges[0].sourceLocation);

    // Then
    assert.deepEqual(opened, ['file:///workspace/Flow.bsv']);
    assert.equal(selected.length, 1);
    await assert.rejects(
        instance.openSource(null, {
            uri: 'file:///outside/Injected.bsv',
            line: 0,
            column: 0
        }),
        /not owned by the current architecture model/
    );
    assert.deepEqual(opened, ['file:///workspace/Flow.bsv']);
});
