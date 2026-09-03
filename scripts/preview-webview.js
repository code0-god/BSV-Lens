'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { normalizeConfig, parseJsonc } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');
const { getWebviewHtml } = require('../src/panel/html');

const root = path.resolve(__dirname, '..');
const exampleRoot = path.join(root, 'examples', 'bsv-mini-accelerator');
const model = buildModel();

const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/health') return send(response, 200, 'text/plain', 'ready\n');
    if (url.pathname === '/model.json') {
        return send(response, 200, 'application/json', `${JSON.stringify(model, null, 2)}\n`);
    }
    if (url.pathname.startsWith('/media/')) {
        const relative = url.pathname.slice(1);
        const filePath = path.join(root, relative);
        if (!filePath.startsWith(path.join(root, 'media')) || !fs.existsSync(filePath)) {
            return send(response, 404, 'text/plain', 'not found\n');
        }
        return send(response, 200, contentType(filePath), fs.readFileSync(filePath));
    }
    if (url.pathname !== '/') return send(response, 404, 'text/plain', 'not found\n');
    return send(response, 200, 'text/html; charset=utf-8', harnessHtml(server.address().port, url));
});

server.listen(0, '127.0.0.1', () => {
    console.log(`READY http://127.0.0.1:${server.address().port}`);
});

function buildModel() {
    const sourceRoot = path.join(exampleRoot, 'hw', 'bsv', 'src');
    const parsed = walk(sourceRoot)
        .filter((filePath) => filePath.endsWith('.bsv'))
        .map((filePath) => parseBsvFile(fs.readFileSync(filePath, 'utf8'), {
            uri: `file://${filePath}`,
            relativePath: path.relative(exampleRoot, filePath).replace(/\\/g, '/')
        }));
    const config = normalizeConfig(
        parseJsonc(fs.readFileSync(path.join(exampleRoot, '.bsv-arch.json'), 'utf8')),
        { workspaceName: 'Mini BSV Accelerator' }
    );
    const result = buildArchitectureModel(parsed, config, {
        workspaceName: 'Mini BSV Accelerator',
        workspaceUri: 'file:///bsv-mini-accelerator',
        activeFile: 'hw/bsv/src/control/AcceleratorController.bsv',
        scheduleProvider: 'source'
    });
    result.viewDefaults = {
        sourceScope: 'workspace',
        level: 'system',
        analysisMode: 'structure',
        hopScope: 'all',
        showMethodPorts: true,
        collapseModuleMembers: true,
        includePotentialScheduleDependencies: true
    };
    return result;
}

function harnessHtml(port, url) {
    const origin = `http://127.0.0.1:${port}`;
    const extensionUri = { relative: '' };
    const vscode = {
        Uri: {
            joinPath(_base, ...parts) {
                return { relative: parts.join('/') };
            }
        }
    };
    const webview = {
        cspSource: origin,
        asWebviewUri(value) {
            return `${origin}/${value.relative}`;
        }
    };
    let html = getWebviewHtml(webview, extensionUri, vscode);
    const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
    const state = {
        workspaceUri: model.workspaceUri,
        sourceScope: url.searchParams.get('scope') || 'workspace',
        level: url.searchParams.get('level') || 'system',
        analysisMode: url.searchParams.get('mode') || 'structure',
        hopScope: url.searchParams.get('hops') || 'all',
        focusStack: [],
        selectedId: null,
        filters: { packages: false, imports: false, rules: true, primitives: true },
        transform: { x: 40, y: 40, scale: 1 }
    };
    const boot = `<script nonce="${nonce}">
        window.__hostMessages = [];
        window.__savedState = ${safeJson(state)};
        window.__model = ${safeJson(model)};
        window.acquireVsCodeApi = () => ({
            getState: () => window.__savedState,
            setState: (value) => { window.__savedState = value; },
            postMessage: (message) => {
                window.__hostMessages.push(message);
                if (message.type === 'ready') {
                    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
                        data: { type: 'model', model: window.__model, initial: {} }
                    })));
                }
                if (message.type === 'refresh') {
                    window.dispatchEvent(new MessageEvent('message', { data: { type: 'busy', value: true } }));
                    queueMicrotask(() => {
                        window.dispatchEvent(new MessageEvent('message', {
                            data: { type: 'model', model: window.__model, initial: {} }
                        }));
                        window.dispatchEvent(new MessageEvent('message', { data: { type: 'busy', value: false } }));
                    });
                }
                if (message.type === 'exportSvg') window.__lastSvg = message.svg;
                if (message.type === 'exportJson') window.__lastJsonExport = true;
            }
        });
    </script>`;
    html = html.replace(`<script nonce="${nonce}" src="${origin}/media/graph-view.js"></script>`, `${boot}\n    <script nonce="${nonce}" src="${origin}/media/graph-view.js"></script>`);
    return html;
}

function safeJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const filePath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(filePath) : [filePath];
    });
}

function send(response, status, type, body) {
    response.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store'
    });
    response.end(body);
}

function contentType(filePath) {
    if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.png')) return 'image/png';
    return 'application/octet-stream';
}
