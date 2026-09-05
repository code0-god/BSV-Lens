'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ArchitecturePanel } = require('../src/panel/architecture-panel');

function sourcePanel(content) {
    const range = { uri: 'file:///Code.bsv', line: 0, column: 0, endLine: 0, endColumn: content.length };
    const editor = { selection: null, revealRange() {} };
    const document = { getText: () => content };
    const panel = Object.create(ArchitecturePanel.prototype);
    panel.modelRevision = 1;
    panel.model = {
        nodes: [{ id: 'rule', location: range }],
        sourceDocuments: [{ id: 'source:Code', uri: range.uri, content, revision: 'source-revision' }],
        statements: [{ id: 'statement:1', sourceRange: range }]
    };
    panel.vscode = {
        Uri: { parse: (uri) => uri },
        workspace: { openTextDocument: async () => document },
        window: { showTextDocument: async () => editor },
        Position: class Position { constructor(line, character) { Object.assign(this, { line, character }); } },
        Range: class Range {},
        Selection: class Selection {},
        ViewColumn: { One: 1 },
        TextEditorRevealType: { InCenterIfOutsideViewport: 0 }
    };
    return { panel, range, document, editor };
}

test('canonical code source ranges can open without a hardware presentation node', async () => {
    const { panel, range, editor } = sourcePanel('return 42;');
    panel.model.nodes = [];
    await panel.openSource(null, range);
    assert.ok(editor.selection);
    await assert.rejects(panel.openSource(null, { ...range, endColumn: 99 }), /not owned/);
});

test('changed editor content cannot open coordinates from an older analysis', async () => {
    const { panel, document, editor } = sourcePanel('return 42;');
    document.getText = () => 'return 123;';
    await assert.rejects(panel.openSource('rule'), /changed since this analysis/);
    assert.equal(editor.selection, null);
});

test('source edits while the editor opens are checked before range selection', async () => {
    const { panel, document, editor } = sourcePanel('return 42;');
    panel.vscode.window.showTextDocument = async () => {
        document.getText = () => 'return 123;';
        return editor;
    };
    await assert.rejects(panel.openSource('rule'), /changed since this analysis/);
    assert.equal(editor.selection, null);
});
