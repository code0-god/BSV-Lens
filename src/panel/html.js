'use strict';

function getWebviewHtml(webview, extensionUri, vscode) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css'));
    const nonce = createNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${styleUri}">
    <title>BSV Architecture Explorer</title>
</head>
<body>
    <header class="toolbar" role="toolbar" aria-label="Architecture controls">
        <div class="brand">
            <span class="brand-mark" aria-hidden="true">B</span>
            <div>
                <strong id="architecture-title">BSV Architecture</strong>
                <span id="architecture-subtitle">Waiting for analysis…</span>
            </div>
        </div>
        <div class="toolbar-group view-controls">
            <label for="view-mode">View</label>
            <select id="view-mode" aria-label="Architecture view">
                <option value="system">System</option>
                <option value="file">Current file</option>
            </select>
            <nav id="breadcrumbs" aria-label="Architecture breadcrumb"></nav>
        </div>
        <div class="toolbar-group search-controls">
            <input id="search" type="search" placeholder="Find node…" aria-label="Find architecture node">
        </div>
        <div class="toolbar-group icon-controls">
            <button id="zoom-out" type="button" title="Zoom out" aria-label="Zoom out">−</button>
            <button id="zoom-in" type="button" title="Zoom in" aria-label="Zoom in">+</button>
            <button id="fit" type="button" title="Fit diagram (0)" aria-label="Fit diagram">Fit</button>
            <button id="refresh" type="button" title="Refresh analysis" aria-label="Refresh analysis">↻</button>
            <button id="export-svg" type="button" title="Export visible diagram as SVG">SVG</button>
            <button id="export-json" type="button" title="Export complete architecture IR as JSON">JSON</button>
        </div>
    </header>

    <section class="filterbar" aria-label="Diagram filters">
        <label><input id="show-packages" type="checkbox" checked> Contracts / packages</label>
        <label><input id="show-imports" type="checkbox"> Imports</label>
        <label><input id="show-rules" type="checkbox" checked> Rules / methods</label>
        <label><input id="show-primitives" type="checkbox"> Registers / FIFOs</label>
        <span id="stats" class="stats"></span>
        <span id="diagnostic-summary" class="diagnostic-summary" role="status"></span>
    </section>

    <div class="workspace">
        <main id="canvas-shell" class="canvas-shell">
            <svg id="architecture-canvas" role="img" aria-label="BSV architecture diagram" tabindex="0">
                <defs>
                    <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L9,4.5 L0,9 Z" class="arrow-head"></path>
                    </marker>
                    <marker id="arrow-muted" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L8,4 L0,8 Z" class="arrow-head-muted"></path>
                    </marker>
                    <filter id="selected-shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.25"></feDropShadow>
                    </filter>
                </defs>
                <g id="viewport">
                    <g id="group-layer"></g>
                    <g id="edge-layer"></g>
                    <g id="node-layer"></g>
                </g>
            </svg>
            <div id="empty-state" class="empty-state" hidden>
                <strong>No architecture nodes to display</strong>
                <span>Open a BSV file, adjust filters, or refresh the workspace analysis.</span>
            </div>
            <div class="canvas-help">Drag to pan · Wheel to zoom · Double-click a block to drill down · Enter opens source</div>
        </main>

        <aside id="inspector" class="inspector" aria-label="Selected architecture element">
            <div class="inspector-empty">
                <strong>Select a block</strong>
                <span>Details, relationships, and source navigation appear here.</span>
            </div>
        </aside>
    </div>

    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function createNonce() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let index = 0; index < 32; index += 1) {
        value += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return value;
}

module.exports = { getWebviewHtml };
