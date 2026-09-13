'use strict';

function editorColumn(vscode, document, reverse) {
    const visible = [vscode.window.activeTextEditor, ...vscode.window.visibleTextEditors]
        .find(editor => editor?.document.uri.toString() === document.uri.toString() && editor.viewColumn !== undefined);
    return visible?.viewColumn ?? (reverse ? vscode.ViewColumn.Beside : vscode.ViewColumn.One);
}
module.exports = { editorColumn };
