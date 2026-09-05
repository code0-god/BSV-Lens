'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeConfig, parseJsonc } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');
const { buildSourceReferenceIndex } = require('../src/architecture/semantic/source-references');
const { simpleGlobToRegExp } = require('../src/architecture/source-utils');
const { getWebviewHtml } = require('../src/panel/html');

const root = path.resolve(__dirname, '..');
const exampleRoot = path.join(root, 'examples', 'bsv-mini-accelerator');
const workspaceRoot = process.env.BSV_TEST_WORKSPACE
    ? path.resolve(process.env.BSV_TEST_WORKSPACE)
    : exampleRoot;
const previewToken = process.env.BSV_PREVIEW_TOKEN;
if (!previewToken) throw new Error('BSV_PREVIEW_TOKEN is required.');
const model = buildModel();

const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (request.headers.host !== expectedHost) return send(response, 403, 'text/plain', 'invalid host\n');
    if (url.pathname === '/health') return send(response, 200, 'text/plain', 'ready\n');
    if (request.headers['x-bsv-preview-token'] !== previewToken) {
        return send(response, 403, 'text/plain', 'invalid capability\n');
    }
    if (url.pathname === '/favicon.ico') return send(response, 204, 'image/x-icon', '');
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

server.listen(Number.parseInt(process.env.PORT || '0', 10), '127.0.0.1', () => {
    console.log(`READY http://127.0.0.1:${server.address().port}`);
});

function buildModel() {
    const workspaceName = process.env.BSV_TEST_WORKSPACE_NAME || path.basename(workspaceRoot);
    const activeFile = process.env.BSV_TEST_ACTIVE_FILE
        || (workspaceRoot === exampleRoot
            ? 'hw/bsv/src/control/AcceleratorController.bsv'
            : null);
    const configPath = path.join(workspaceRoot, '.bsv-arch.json');
    const config = normalizeConfig(
        fs.existsSync(configPath)
            ? parseJsonc(fs.readFileSync(configPath, 'utf8'))
            : {},
        { workspaceName }
    );
    const detectedRoots = ['hw/bsv/src', 'bsv/src', 'src']
        .filter((candidate) => fs.existsSync(path.join(workspaceRoot, candidate)));
    const sourceRoots = config.sourceRoots.length > 0
        ? config.sourceRoots
        : detectedRoots.length > 0 ? detectedRoots : ['.'];
    const workspaceRealPath = fs.realpathSync(workspaceRoot);
    const excluded = config.exclude.flatMap((pattern) => [
        simpleGlobToRegExp(pattern),
        pattern.startsWith('**/') ? simpleGlobToRegExp(pattern.slice(3)) : null
    ]).filter(Boolean);
    const sourceFiles = sourceRoots.flatMap((configuredRoot) => {
        const rootPath = path.resolve(workspaceRoot, configuredRoot);
        if (!fs.existsSync(rootPath)) return [];
        const rootRealPath = fs.realpathSync(rootPath);
        if (!isInside(workspaceRealPath, rootRealPath)) return [];
        return walk(rootPath);
    }).filter((filePath) => {
        if (!filePath.endsWith('.bsv') || !fs.lstatSync(filePath).isFile()) return false;
        const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
        return isInside(workspaceRealPath, fs.realpathSync(filePath))
            && !excluded.some((pattern) => pattern.test(relativePath));
    });
    const parsed = [...new Set(sourceFiles)]
        .map((filePath) => parseBsvFile(fs.readFileSync(filePath, 'utf8'), {
            uri: pathToFileURL(filePath).toString(),
            relativePath: path.relative(workspaceRoot, filePath).replace(/\\/g, '/')
        }));
    const result = buildArchitectureModel(parsed, config, {
        workspaceName,
        workspaceUri: pathToFileURL(workspaceRoot).toString(),
        activeFile,
        scheduleProvider: 'source'
    });
    result.sourceReferences = buildSourceReferenceIndex(result).references;
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
    const workspaceTrusted = url.searchParams.get('trusted') !== 'false';
    const cjk = url.searchParams.get('cjk') === 'true';
    const cjkModuleName = model.nodes.some((node) => node.name === 'mkAquaLoopMatmul')
        ? 'mkAquaLoopMatmul'
        : 'mkAcceleratorController';
    const cycle = url.searchParams.get('cycle') === 'true';
    const cycleRules = model.nodes
        .filter((node) => node.kind === 'rule' && /AcceleratorController\.bsv$/.test(node.relativePath || ''))
        .slice(0, 3);
    const cycleEdges = cycle && cycleRules.length === 3
        ? cycleRules.map((node, index) => ({
            id: `preview-cycle-${index}`,
            source: node.id,
            target: cycleRules[(index + 1) % cycleRules.length].id,
            kind: 'execution-order',
            label: 'execution order',
            mode: 'scheduling',
            origin: 'source-attribute',
            confidence: 'explicit',
            evidence: 'preview scheduling cycle',
            bidirectional: false,
            inferred: true
        }))
        : [];
    const pageModel = {
        ...model,
        title: cjk ? 'AQuA BSV 구조 검증' : model.title,
        nodes: cjk
            ? model.nodes.map((node) => node.name === cjkModuleName
                ? { ...node, label: '행렬 가속기 제어 파이프라인' }
                : node)
            : model.nodes,
        edges: [...model.edges, ...cycleEdges],
        viewDefaults: {
            ...model.viewDefaults,
            showMethodPorts: url.searchParams.get('ports') !== 'false'
        },
        security: {
            workspaceTrusted,
            restrictedMode: !workspaceTrusted,
            sourceAnalysisAvailable: true,
            bscExecutionEnabled: workspaceTrusted,
            externalScheduleReportsEnabled: workspaceTrusted
        }
    };
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
        workspaceUri: null,
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
        window.__initial = ${safeJson({
            sourceScope: state.sourceScope,
            level: state.level,
            analysisMode: state.analysisMode,
            hopScope: state.hopScope
        })};
        window.__model = ${safeJson(pageModel)};
        window.acquireVsCodeApi = () => ({
            getState: () => window.__savedState,
            setState: (value) => {
                window.__savedState = value;
                window.dispatchEvent(new CustomEvent('bsv-webview-state', { detail: value }));
            },
            postMessage: (message) => {
                window.__hostMessages.push(message);
                window.dispatchEvent(new CustomEvent('bsv-host-message', { detail: message }));
                if (message.type === 'ready') {
                    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
                        data: { type: 'model', model: window.__model, initial: window.__initial }
                    })));
                }
                if (message.type === 'refresh') {
                    window.dispatchEvent(new MessageEvent('message', { data: { type: 'busy', value: true } }));
                    queueMicrotask(() => {
                        window.dispatchEvent(new MessageEvent('message', {
                            data: { type: 'model', model: window.__model, initial: window.__initial }
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

function isInside(rootPath, candidatePath) {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
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
