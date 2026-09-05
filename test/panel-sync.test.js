'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ArchitecturePanel } = require('../src/panel/architecture-panel');
const { buildFlowFixture } = require('./semantic-fixture');
const { createSemanticQueries } = require('../media/semantic-query');

function makePanel(enabled = true) {
    const messages = [];
    const instance = Object.create(ArchitecturePanel.prototype);
    const moduleRange = {
        uri: 'file:///Top.bsv', line: 0, column: 0, endLine: 20, endColumn: 9
    };
    const ruleRange = {
        uri: 'file:///Top.bsv', line: 5, column: 4, endLine: 9, endColumn: 11
    };
    instance.model = {
        definitions: [{
            id: 'def:Top:mkTop', kind: 'module-definition', packageName: 'Top', name: 'mkTop',
            location: { ...moduleRange, endLine: 0, endColumn: 5 }, sourceRange: moduleRange,
            methods: [],
            rules: [{
                name: 'tick',
                location: { ...ruleRange, endLine: 5, endColumn: 8 },
                sourceRange: ruleRange
            }],
            childInstanceDeclarations: []
        }],
        instances: [],
        endpoints: [],
        stateBehaviors: [],
        nodes: [
            {
                id: 'module', kind: 'module', name: 'mkTop',
                location: { ...moduleRange, endLine: 0, endColumn: 5 }, sourceRange: moduleRange
            },
            {
                id: 'rule', kind: 'rule', name: 'tick',
                location: { ...ruleRange, endLine: 5, endColumn: 8 }, sourceRange: ruleRange
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
    instance.sourceReferenceIndex = null;
    instance.modelRevision = 1;
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

test('editor selection sends canonical source references without host first-match suppression', () => {
    const { instance, messages } = makePanel(true);
    instance.revealEditorSelection(selection(6, 8));

    assert.equal(messages[0].type, 'revealSource');
    assert.equal(messages[0].revision, 1);
    assert.equal(messages[0].sourceReference.status, 'exact');
    assert.equal(messages[0].sourceReference.references[0].kind, 'rule');
    assert.deepEqual(
        messages[0].sourceReference.references[0].presentations.map((item) => item.id),
        ['rule']
    );
    instance.revealEditorSelection(selection(6, 8));
    assert.equal(messages.length, 2);
});

test('initial name focus does not choose among duplicate presentations', () => {
    const { instance } = makePanel(true);
    instance.request = { focusName: 'duplicate', focusKind: 'method' };
    instance.model.nodes.push(
        { id: 'left', name: 'duplicate', kind: 'method', relativePath: 'Top.bsv' },
        { id: 'right', name: 'duplicate', kind: 'method', relativePath: 'Top.bsv' }
    );
    instance.model.activeFile = 'Top.bsv';

    assert.equal(instance.resolveInitialFocus(instance.model), null);
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
        column: 4,
        endLine: 8,
        endColumn: 16
    };
    instance.model = {
        nodes: [{ id: 'top', location: modelLocation }],
        edges: [{
            id: 'flow',
            sourceLocation: {
                uri: 'file:///workspace/Flow.bsv',
                line: 2,
                column: 1,
                endLine: 2,
                endColumn: 20
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
            constructor(anchor, active) {
                this.anchor = anchor;
                this.active = active;
                const reversed = anchor.line > active.line
                    || (anchor.line === active.line && anchor.column > active.column);
                this.start = reversed ? active : anchor;
                this.end = reversed ? anchor : active;
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
    assert.deepEqual(
        [selected[0].start.line, selected[0].start.column,
            selected[0].end.line, selected[0].end.column],
        [2, 1, 2, 20]
    );
    await assert.rejects(
        instance.openSource(null, { ...instance.model.edges[0].sourceLocation, endColumn: 200 }),
        /not owned by the current architecture model/
    );
    await assert.rejects(
        instance.openSource(null, {
            uri: 'file:///outside/Injected.bsv',
            line: 0,
            column: 0
        }),
        /not owned by the current architecture model/
    );
    assert.deepEqual(opened, ['file:///workspace/Flow.bsv']);

    instance.model = { ...buildFlowFixture(), nodes: [], edges: [] };
    const payload = instance.model.semanticFlows.find((flow) => flow.kind === 'payload');
    const evidence = createSemanticQueries(instance.model).getFlowEvidence(payload.id).evidenceRefs;
    for (const reference of evidence) {
        await instance.openSource(null, reference.sourceRange);
        const selection = selected.at(-1);
        assert.deepEqual(
            [selection.start.line, selection.start.column, selection.end.line, selection.end.column],
            [reference.sourceRange.line, reference.sourceRange.column,
                reference.sourceRange.endLine, reference.sourceRange.endColumn]
        );
    }
    await assert.rejects(
        instance.openSource(null, { ...evidence[0].sourceRange, endColumn: 999 }),
        /not owned by the current architecture model/
    );
});

test('source navigation rejects stale revisions before opening an editor', async () => {
    const { instance, messages } = makePanel(true);
    instance.modelRevision = 2;
    const opened = [];
    instance.openSource = async (...arguments_) => opened.push(arguments_);
    instance.reportError = () => {};

    await instance.handleMessage({ type: 'openSource', nodeId: 'rule', revision: 1 });

    assert.deepEqual(opened, []);
    assert.equal(messages.at(-1).error, true);

    await instance.handleMessage({ type: 'openSource', nodeId: 'rule', revision: 2 });
    assert.equal(opened.length, 1);
});

test('missing source entity cannot fall back to a formerly borrowed location', async () => {
    const { instance } = makePanel(true);
    await assert.rejects(
        instance.openSource('removed-rule', instance.model.nodes[0].location),
        /no longer exists/
    );
});

test('refresh during source opening cannot select an old source range', async () => {
    const { instance } = makePanel(true);
    const opened = Promise.withResolvers();
    const editor = { selection: null, revealRange() {} };
    instance.vscode.Uri = { parse: (uri) => uri };
    instance.vscode.workspace.openTextDocument = () => opened.promise;
    instance.vscode.window = { showTextDocument: async () => editor };
    instance.vscode.ViewColumn = { One: 1 };
    instance.vscode.Position = class {};
    instance.vscode.Selection = class {};
    instance.vscode.Range = class {};
    instance.vscode.TextEditorRevealType = { InCenterIfOutsideViewport: 0 };

    const navigation = instance.openSource('rule');
    instance.modelRevision += 1;
    opened.resolve({});

    await assert.rejects(navigation, /stale/);
    assert.equal(editor.selection, null);
});
