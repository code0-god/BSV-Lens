'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

class Disposable {
    dispose() {}
}

class EventEmitter {
    constructor() {
        this.event = () => new Disposable();
    }
    fire() {}
    dispose() {}
}

class Uri {
    constructor(value) {
        this.value = value;
        this.scheme = value.split(':')[0] || 'file';
        this.path = value.replace(/^file:\/\//, '');
        this.fsPath = this.path;
    }
    toString() { return this.value; }
    static parse(value) { return new Uri(value); }
    static joinPath(base, ...parts) {
        const prefix = base.toString().replace(/\/$/, '');
        return new Uri(`${prefix}/${parts.join('/')}`);
    }
}

class Position {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

class Range {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}

class DocumentSymbol {
    constructor(name, detail, kind, range, selectionRange) {
        Object.assign(this, { name, detail, kind, range, selectionRange, children: [] });
    }
}

class CodeLens {
    constructor(range, command) {
        Object.assign(this, { range, command });
    }
}

function createMockVscode() {
    const registeredCommands = new Map();
    const symbolProviders = [];
    const codeLensProviders = [];
    const messages = [];
    const status = {
        visible: false,
        show() { this.visible = true; },
        hide() { this.visible = false; },
        dispose() {}
    };
    const api = {
        Uri,
        Position,
        Range,
        Selection: class Selection {},
        DocumentSymbol,
        CodeLens,
        EventEmitter,
        SymbolKind: new Proxy({}, { get: (_target, key) => String(key) }),
        StatusBarAlignment: { Right: 1 },
        ViewColumn: { One: 1, Beside: -2 },
        FileType: { Directory: 2 },
        window: {
            activeTextEditor: undefined,
            createOutputChannel() { return { appendLine() {}, dispose() {} }; },
            createStatusBarItem() { return status; },
            onDidChangeActiveTextEditor() { return new Disposable(); },
            registerWebviewPanelSerializer() { return new Disposable(); },
            showWarningMessage(message) { messages.push(message); },
            showErrorMessage(message) { messages.push(message); }
        },
        workspace: {
            workspaceFolders: [],
            getWorkspaceFolder() { return null; },
            getConfiguration() { return { get(_key, fallback) { return fallback; } }; },
            onDidChangeConfiguration() { return new Disposable(); }
        },
        commands: {
            registerCommand(id, callback) {
                registeredCommands.set(id, callback);
                return new Disposable();
            },
            async executeCommand() {}
        },
        languages: {
            registerDocumentSymbolProvider(selector, provider) {
                symbolProviders.push({ selector, provider });
                return new Disposable();
            },
            registerCodeLensProvider(selector, provider) {
                codeLensProviders.push({ selector, provider });
                return new Disposable();
            }
        }
    };
    return { api, registeredCommands, symbolProviders, codeLensProviders, messages, status };
}

test('extension activates and registers its architecture commands and BSV providers', async () => {
    const mock = createMockVscode();
    const originalLoad = Module._load;
    Module._load = function patched(request, parent, isMain) {
        if (request === 'vscode') return mock.api;
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const extensionPath = require.resolve('../src/extension');
        delete require.cache[extensionPath];
        const extension = require(extensionPath);
        const context = {
            extensionUri: Uri.parse('file:///extension'),
            subscriptions: []
        };
        extension.activate(context);

        for (const command of [
            'bsvArchitecture.openWorkspace',
            'bsvArchitecture.openCurrentFile',
            'bsvArchitecture.openSymbol',
            'bsvArchitecture.refresh',
            'bsvArchitecture.createConfig',
            'bsvArchitecture.exportJson'
        ]) assert.ok(mock.registeredCommands.has(command), `Missing ${command}`);
        assert.equal(mock.symbolProviders.length, 1);
        assert.equal(mock.codeLensProviders.length, 1);
        assert.equal(mock.status.visible, false);

        await mock.registeredCommands.get('bsvArchitecture.openCurrentFile')();
        assert.ok(mock.messages.some((message) => message.includes('.bsv')));

        const filePath = path.join(__dirname, '..', 'examples', 'bsv-mini-accelerator', 'hw', 'bsv', 'src', 'common', 'LocalAddress.bsv');
        const text = fs.readFileSync(filePath, 'utf8');
        const lines = text.split('\n');
        const document = {
            uri: Uri.parse(`file://${filePath}`),
            fileName: filePath,
            getText() { return text; },
            positionAt(offset) {
                const before = text.slice(0, offset).split('\n');
                return new Position(before.length - 1, before.at(-1).length);
            },
            lineAt(line) { return { text: lines[line] || '' }; }
        };
        const symbols = mock.symbolProviders[0].provider.provideDocumentSymbols(document);
        assert.equal(symbols[0].name, 'LocalAddress');
        assert.ok(symbols[0].children.some((symbol) => symbol.name === 'mapGlobalRow'));
    } finally {
        Module._load = originalLoad;
    }
});
