'use strict';

function getWebviewHtml(webview, extensionUri, vscode) {
    const graphViewUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'graph-view.js'));
    const textMetricsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'text-metrics.js'));
    const layoutUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview-layout.js'));
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
    <title>BSV Lens</title>
</head>
<body>
    <header class="toolbar" aria-label="Architecture controls">
        <div class="brand">
            <span class="brand-mark" aria-hidden="true">B</span>
            <div>
                <strong id="architecture-title">BSV Lens</strong>
                <span id="architecture-subtitle">Waiting for analysis…</span>
            </div>
        </div>
        <div class="view-controls" role="toolbar" aria-label="Diagram view controls">
            <div class="control-field source-field">
                <label for="source-scope">Source</label>
                <select id="source-scope" aria-label="Source scope" title="Choose analyzed source scope">
                    <option value="workspace">Workspace</option>
                    <option value="current-file">Current File</option>
                </select>
            </div>
            <fieldset class="control-field segmented-field">
                <legend>Level</legend>
                <div class="segmented" id="level-control">
                    <button type="button" data-level="system" aria-pressed="true" title="Architecture modules and relations">System</button>
                    <button type="button" data-level="module" aria-pressed="false" title="Focused module and collapsible members">Module</button>
                    <button type="button" data-level="behavior" aria-pressed="false" title="Rules, methods, functions, and state">Behavior</button>
                </div>
            </fieldset>
            <fieldset class="control-field segmented-field">
                <legend>Mode</legend>
                <div class="segmented" id="analysis-mode-control">
                    <button type="button" data-analysis-mode="structure" aria-pressed="true" title="Instantiation and structural relations">Structure</button>
                    <button type="button" data-analysis-mode="data-flow" aria-pressed="false" title="Reads, writes, calls, and values">Data Flow</button>
                    <button type="button" data-analysis-mode="scheduling" aria-pressed="false" title="Rule and method scheduling relations">Scheduling</button>
                </div>
            </fieldset>
            <fieldset class="control-field segmented-field scope-field">
                <legend>Scope</legend>
                <div class="segmented" id="hop-control">
                    <button type="button" data-hop="1" aria-pressed="false" title="Show one-hop neighborhood">1</button>
                    <button type="button" data-hop="2" aria-pressed="false" title="Show two-hop neighborhood">2</button>
                    <button type="button" data-hop="3" aria-pressed="false" title="Show three-hop neighborhood">3</button>
                    <button type="button" data-hop="all" aria-pressed="true" title="Show connected component">Component</button>
                </div>
            </fieldset>
        </div>
        <div class="focus-row">
            <button id="focus-back" class="icon-button" type="button" title="Back to previous focus" aria-label="Back to previous focus" disabled>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.75 3.25 5 8l4.75 4.75M5.25 8h6"></path></svg>
            </button>
            <div class="focus-context">
                <span id="focus-summary">Focus: none</span>
                <nav id="breadcrumbs" aria-label="Focus breadcrumb"></nav>
            </div>
            <button id="clear-focus" type="button" title="Clear graph focus" disabled>Clear focus</button>
        </div>
        <div class="toolbar-group search-controls">
            <label class="sr-only" for="search">Find architecture node</label>
            <input id="search" type="search" placeholder="Find node…" aria-label="Find architecture node" autocomplete="off">
        </div>
        <div class="toolbar-group icon-controls" role="toolbar" aria-label="Canvas and export controls">
            <button id="zoom-out" type="button" title="Zoom out" aria-label="Zoom out">Zoom −</button>
            <button id="zoom-in" type="button" title="Zoom in" aria-label="Zoom in">Zoom +</button>
            <button id="fit" type="button" title="Fit diagram (0)" aria-label="Fit diagram">Fit</button>
            <button id="refresh" type="button" title="Refresh analysis" aria-label="Refresh analysis">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.4 5.3A5 5 0 1 0 13 9M12.4 2.6v2.9H9.5"></path></svg>
                Refresh
            </button>
            <button id="export-svg" type="button" title="Export visible diagram as SVG" aria-label="Export visible SVG">SVG</button>
            <button id="export-json" type="button" title="Export complete Architecture IR as JSON" aria-label="Export complete architecture JSON">JSON</button>
        </div>
    </header>

    <section id="restricted-mode" class="restricted-mode" role="status" hidden>
        <strong>RESTRICTED MODE</strong>
        <span>Source analysis remains available. BSC execution and external schedule reports are disabled.</span>
    </section>

    <section class="filterbar" aria-label="Diagram filters">
        <label id="packages-filter" title="Show the secondary package/module source projection"><input id="show-packages" type="checkbox"> Source Map</label>
        <label id="imports-filter"><input id="show-imports" type="checkbox"> Imports</label>
        <label id="rules-filter"><input id="show-rules" type="checkbox" checked> Rules / Methods</label>
        <label id="primitives-filter"><input id="show-primitives" type="checkbox"> State primitives</label>
        <span id="stats" class="stats" aria-live="polite"></span>
        <span id="diagnostic-summary" class="diagnostic-summary" role="status"></span>
    </section>

    <section id="tracebar" class="tracebar" aria-label="Path trace controls" hidden>
        <span id="trace-summary">No active trace</span>
        <button id="trace-previous" type="button" title="Previous shortest path" disabled>Previous path</button>
        <button id="trace-next" type="button" title="Next shortest path" disabled>Next path</button>
        <button id="trace-clear" type="button" title="Clear path trace">Clear trace</button>
    </section>

    <section id="schedule-legend" class="schedule-legend" aria-label="Scheduling relation legend" hidden>
        <span id="schedule-origin" class="origin-badge">SOURCE-DERIVED</span>
        <ul>
            <li data-kind="conflict">Conflict</li>
            <li data-kind="conflict-free">Conflict-free</li>
            <li data-kind="sequential-before">Sequential before</li>
            <li data-kind="mutually-exclusive">Mutually exclusive</li>
            <li data-kind="descending-urgency">Urgency</li>
            <li data-kind="preempts">Preemption</li>
            <li data-kind="execution-order">Execution order</li>
            <li data-kind="cycle">Cycle SCC</li>
            <li data-kind="potential-state-dependency">Potential dependency</li>
        </ul>
    </section>

    <div class="workspace" aria-busy="false">
        <main id="canvas-shell" class="canvas-shell">
            <p id="diagram-help" class="sr-only">Interactive architecture graph. Use Tab to reach nodes, Enter or Space to toggle groups, Enter to open source, and arrow keys to navigate.</p>
            <svg id="architecture-canvas" role="application" aria-label="BSV architecture diagram" aria-describedby="diagram-help" tabindex="0">
                <defs>
                    <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L9,4.5 L0,9 Z" class="arrow-head"></path>
                    </marker>
                    <marker id="arrow-start" markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto-start-reverse" markerUnits="strokeWidth">
                        <path d="M0,0 L9,4.5 L0,9 Z" class="arrow-head"></path>
                    </marker>
                    <marker id="arrow-muted" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L8,4 L0,8 Z" class="arrow-head-muted"></path>
                    </marker>
                    <marker id="hierarchy-arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                        <path d="M0,0 L6,3 L0,6" class="hierarchy-arrow-head"></path>
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
                <span>Open a BSV file, adjust filters, or refresh workspace analysis.</span>
            </div>
            <div id="reveal-notice" class="reveal-notice" hidden>
                <span id="reveal-notice-text"></span>
                <button id="reveal-current-view" type="button">Reveal in current view</button>
            </div>
            <div class="canvas-help">Drag to pan · Wheel to zoom · Click group to expand or collapse · Double-click block to focus</div>
        </main>

        <aside id="inspector" class="inspector" aria-label="Selected architecture element">
            <div class="inspector-empty">
                <strong>Select a block</strong>
                <span>Details, relationships, and source navigation appear here.</span>
            </div>
        </aside>
    </div>

    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <script nonce="${nonce}" src="${graphViewUri}"></script>
    <script nonce="${nonce}" src="${textMetricsUri}"></script>
    <script nonce="${nonce}" src="${layoutUri}"></script>
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
