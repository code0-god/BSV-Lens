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
    ArchitecturePanel.currentPanel.dispose();
}

module.exports = { run };
