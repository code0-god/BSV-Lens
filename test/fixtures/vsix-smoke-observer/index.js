'use strict';

const net = require('node:net');
const path = require('node:path');
const vscode = require('vscode');

const TARGET_ID = 'code0-god.bsv-lens';

async function run() {
    const port = Number.parseInt(process.env.BSV_VSIX_SMOKE_PORT || '', 10);
    const extensionsDir = path.resolve(requiredEnvironment('BSV_VSIX_EXTENSIONS_DIR'));
    const sourcePath = path.resolve(requiredEnvironment('BSV_VSIX_SOURCE'));
    if (!Number.isInteger(port)) throw new Error('BSV_VSIX_SMOKE_PORT must be an integer.');

    const channel = await connect(port);
    let complete;
    const completed = new Promise((resolve) => { complete = resolve; });
    const subscriptions = [];
    try {
        const target = vscode.extensions.getExtension(TARGET_ID);
        if (!target) throw new Error(`${TARGET_ID} is not installed in the isolated profile.`);
        const extensionPath = path.resolve(target.extensionPath);
        if (extensionPath !== extensionsDir && !extensionPath.startsWith(`${extensionsDir}${path.sep}`)) {
            throw new Error(`Target resolved outside isolated extensions directory: ${extensionPath}`);
        }
        await target.activate();

        subscriptions.push(vscode.window.onDidChangeTextEditorSelection((event) => {
            const selection = event.selections[0];
            channel.send({
                type: 'selection',
                uri: event.textEditor.document.uri.toString(),
                range: rangeValue(selection),
                text: selection ? event.textEditor.document.getText(selection) : ''
            });
        }));

        channel.onMessage(async (message) => {
            try {
                if (message.type === 'openPanel') {
                    const source = vscode.Uri.file(sourcePath);
                    const document = await vscode.workspace.openTextDocument(source);
                    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
                    await vscode.commands.executeCommand('bsvArchitecture.openWorkspace');
                    channel.send({ type: 'panelCommandReturned' });
                } else if (message.type === 'complete') {
                    complete();
                }
            } catch (error) {
                channel.send({ type: 'observerError', message: error?.stack || String(error) });
                complete();
            }
        });

        channel.send({
            type: 'observerReady',
            target: {
                id: target.id,
                version: target.packageJSON.version,
                extensionPath,
                apiExtensionMode: target.extensionMode ?? null,
                isActive: target.isActive
            }
        });
        await completed;
    } finally {
        for (const subscription of subscriptions) subscription.dispose();
        channel.close();
    }
}

function requiredEnvironment(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

function rangeValue(selection) {
    if (!selection) return null;
    return {
        start: { line: selection.start.line, character: selection.start.character },
        end: { line: selection.end.line, character: selection.end.character },
        active: { line: selection.active.line, character: selection.active.character },
        anchor: { line: selection.anchor.line, character: selection.anchor.character }
    };
}

function connect(port) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.setEncoding('utf8');
        socket.once('error', reject);
        socket.once('connect', () => {
            socket.removeListener('error', reject);
            let buffer = '';
            const listeners = new Set();
            socket.on('data', (chunk) => {
                buffer += chunk;
                let newline = buffer.indexOf('\n');
                while (newline >= 0) {
                    const line = buffer.slice(0, newline);
                    buffer = buffer.slice(newline + 1);
                    if (line) {
                        const message = JSON.parse(line);
                        for (const listener of listeners) listener(message);
                    }
                    newline = buffer.indexOf('\n');
                }
            });
            resolve({
                send(message) { socket.write(`${JSON.stringify(message)}\n`); },
                onMessage(listener) { listeners.add(listener); },
                close() { socket.end(); }
            });
        });
    });
}

module.exports = { run };
