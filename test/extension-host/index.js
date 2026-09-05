'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
    const root = path.resolve(__dirname, '..', '..');
    const extension = vscode.extensions.getExtension('code0-god.bsv-lens');
    assert.ok(extension, 'development extension is discoverable');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
        'bsvArchitecture.openWorkspace',
        'bsvArchitecture.openCurrentFile',
        'bsvArchitecture.openSymbol',
        'bsvArchitecture.refresh',
        'bsvArchitecture.exportJson'
    ]) assert.ok(commands.includes(command), `${command} is registered`);

    const source = vscode.Uri.file(path.join(
        root,
        'examples',
        'bsv-mini-accelerator',
        'hw',
        'bsv',
        'src',
        'control',
        'AcceleratorController.bsv'
    ));
    const document = await vscode.workspace.openTextDocument(source);
    await vscode.window.showTextDocument(document);
    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', source);
    assert.ok(symbols.some((symbol) => symbol.name === 'AcceleratorController'));

    await vscode.commands.executeCommand('bsvArchitecture.openCurrentFile', source);
    const { ArchitecturePanel } = require(path.join(root, 'src', 'panel', 'architecture-panel'));
    assert.ok(ArchitecturePanel.currentPanel, 'architecture panel opened');
    assert.ok(ArchitecturePanel.currentPanel.model.stats.files > 0);
    assert.ok(ArchitecturePanel.currentPanel.model.stats.nodes > 0);
    assert.match(ArchitecturePanel.currentPanel.model.activeFile, /AcceleratorController\.bsv$/);
    assert.match(ArchitecturePanel.currentPanel.panel.webview.html, /media\/webview-layout\.js/);
    const panel = ArchitecturePanel.currentPanel;
    const rule = panel.model.nodes.find((node) =>
        node.kind === 'rule' && node.name === 'countAccepted' && node.semanticId
    );
    assert.ok(rule, 'source target is an occurrence behavior');
    const selectionChanged = nextSelection(source, rule.location);
    await panel.handleMessage({
        type: 'openSource', nodeId: rule.id, revision: panel.modelRevision
    });
    const event = await selectionChanged;
    const selection = event.selections[0];
    assert.deepEqual(
        [selection.start.line, selection.start.character, selection.end.line, selection.end.character],
        [rule.location.line, rule.location.column, rule.location.endLine, rule.location.endColumn]
    );
    assert.equal(document.getText(selection), 'countAccepted');
    const reference = panel.model.semanticFlows.flatMap((flow) => flow.evidenceRefs || [])
        .find((item) => item.sourceRange && item.text);
    assert.ok(reference, 'semantic flow retains an original source evidence range');
    const evidenceChanged = nextSelection(vscode.Uri.parse(reference.sourceRange.uri), reference.sourceRange);
    await panel.handleMessage({
        type: 'openSource', location: reference.sourceRange, revision: panel.modelRevision
    });
    const evidenceEvent = await evidenceChanged;
    assert.equal(evidenceEvent.textEditor.document.getText(evidenceEvent.selections[0]), reference.text);
    ArchitecturePanel.currentPanel.dispose();
}

function nextSelection(uri, location) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            listener.dispose();
            reject(new Error('Timed out waiting for the source range selection event.'));
        }, 5000);
        const listener = vscode.window.onDidChangeTextEditorSelection((event) => {
            const selection = event.selections[0];
            if (event.textEditor.document.uri.toString() !== uri.toString()
                || selection?.start.line !== location.line
                || selection?.start.character !== location.column
                || selection?.end.line !== location.endLine
                || selection?.end.character !== location.endColumn) return;
            clearTimeout(timer);
            listener.dispose();
            resolve(event);
        });
    });
}

module.exports = { run };
