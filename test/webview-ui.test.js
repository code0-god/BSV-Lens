'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { getWebviewHtml } = require('../src/panel/html');

const root = path.join(__dirname, '..');

function html() {
    const uri = {
        value: 'file:///extension',
        toString() { return this.value; }
    };
    const vscode = {
        Uri: {
            joinPath(base, ...parts) {
                return {
                    value: `${base.toString()}/${parts.join('/')}`,
                    toString() { return this.value; }
                };
            }
        }
    };
    const webview = {
        cspSource: 'vscode-webview://test',
        asWebviewUri(value) { return value.toString(); }
    };
    return getWebviewHtml(webview, uri, vscode);
}

test('webview declares independent source level mode and hop controls', () => {
    const content = html();
    for (const id of [
        'source-scope',
        'level-control',
        'analysis-mode-control',
        'hop-control',
        'focus-summary',
        'focus-back',
        'clear-focus'
    ]) assert.match(content, new RegExp(`id="${id}"`));
    assert.match(content, /data-level="system"/);
    assert.match(content, /data-analysis-mode="scheduling"/);
    assert.match(content, /data-hop="3"/);
    assert.match(content, /data-hop="all"[^>]*>Component<\/button>/);
});

test('webview retains CSP offline scripts exports and accessible graph semantics', () => {
    const content = html();
    assert.match(content, /default-src 'none'/);
    assert.doesNotMatch(content, /https?:\/\/(?:cdn|unpkg|jsdelivr)/);
    assert.ok(content.indexOf('media/graph-view.js') < content.indexOf('media/text-metrics.js'));
    assert.ok(content.indexOf('media/text-metrics.js') < content.indexOf('media/webview-layout.js'));
    assert.ok(content.indexOf('media/webview-layout.js') < content.indexOf('media/webview.js'));
    assert.match(content, /id="export-svg"/);
    assert.match(content, /id="export-json"/);
    assert.match(content, /role="application"/);
    assert.match(content, /aria-describedby="diagram-help"/);
    assert.match(content, /id="restricted-mode"/);
});

test('webview runtime uses indexed graph helper and actual SVG chevrons', () => {
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    assert.match(source, /Graph\.createViewModel/);
    assert.match(source, /runtime\.view\.indexes\.nodeById/);
    assert.match(source, /class: 'group-chevron'/);
    assert.match(source, /marker-start/);
    assert.match(source, /Graph\.shortestPaths/);
    assert.match(source, /result\.truncated/);
    assert.match(source, /result\.limitReason/);
    assert.match(source, /function compareNodes/);
    assert.doesNotMatch(source, /\.append\(svgElement\('title'\)\)\.textContent/);
    assert.match(source, /aria-expanded/);
    assert.match(source, /aria-controls/);
    assert.match(source, /function controlledRegionId/);
    assert.match(source, /runtime\.graph\.edgeById/);
});

test('Scheduling mode ships legend origin badge and actionable empty state', () => {
    const content = html();
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    assert.match(content, /id="schedule-legend"/);
    assert.match(content, /id="schedule-origin"/);
    for (const kind of [
        'conflict',
        'conflict-free',
        'sequential-before',
        'mutually-exclusive',
        'descending-urgency',
        'preempts',
        'execution-order',
        'cycle',
        'potential-state-dependency'
    ]) assert.match(content, new RegExp(`data-kind="${kind}"`));
    assert.match(source, /runtime\.model\.scheduling\?\.badge/);
    assert.match(source, /configure a BSC schedule provider/);
});

test('inspector summarizes and groups deduplicated relation evidence', () => {
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    assert.match(source, /className = 'relation-summary'/);
    assert.match(source, /className = 'relation-details'/);
    assert.match(source, /className = 'relation-group'/);
    assert.match(source, /function dedupeRelations/);
    assert.match(source, /relation\.edge\.evidence/);
    assert.match(source, /Open evidence/);
});

test('module selection has no inline method sub-selection state', () => {
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    assert.match(source, /Interface Contract/);
    assert.doesNotMatch(source, /selectedPort|renderMethodPorts|method-port-row/);
});

test('Module card keeps one stable summary while Methods owns disclosure', () => {
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    const layoutSource = fs.readFileSync(path.join(root, 'media', 'webview-layout.js'), 'utf8');
    const measureNode = layoutSource.slice(
        layoutSource.indexOf('function measureNode('),
        layoutSource.indexOf('function computeBounds(')
    );
    const renderModule = source.slice(
        source.indexOf('function renderModuleNode('),
        source.indexOf('function renderMethodPorts(')
    );
    assert.match(measureNode, /level === 'module'.*width: 300, height: 88/s);
    assert.match(renderModule, /moduleMemberSummary\(node\)/);
    assert.match(renderModule, /truncate\(moduleSubtitle\(node\), 40\)/);
    assert.doesNotMatch(renderModule, /renderMethodPorts|moduleMethodsCollapsed/);
    assert.match(source, /node\.kind === 'module'.*moduleSubtitle\(node\)/s);
    assert.match(source, /preserveNodeAnchor\(node\.parentId\)/);
    assert.match(source, /anchorAfterRender/);
});

test('disclosure groups activate once per click and with either activation key', () => {
    const content = html();
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    assert.match(source, /const disclosure = node\.kind === 'member-group' \|\| node\.kind === 'instance-group'/);
    assert.match(source, /if \(disclosure\) \{\s*drillInto\(node\.id\)/);
    assert.doesNotMatch(source, /event\.detail > 1/);
    assert.match(source, /if \(!disclosure\) drillInto\(node\.id\)/);
    assert.match(source, /\(event\.key === 'Enter' \|\| event\.key === ' '\) && disclosure/);
    assert.match(content, /Click group to expand or collapse/);
});

test('dense fit preserves full containment and wraps canvas actions', () => {
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'media', 'webview.css'), 'utf8');
    const resizeHandler = source.slice(
        source.indexOf("window.addEventListener('resize'"),
        source.indexOf('elements.sourceScope.addEventListener')
    );
    assert.match(source, /,\s*0\.08,\s*1\.35/);
    assert.match(source, /runtime\.graph\.layout\?\.positions\.has\(selectedId\)/);
    assert.match(source, /const targetId = focusId \|\| viewState\(\)\.selectedId/);
    assert.match(resizeHandler, /preserveNodeAnchor/);
    assert.match(resizeHandler, /clampToViewport: true/);
    assert.match(resizeHandler, /render\(\)/);
    assert.doesNotMatch(resizeHandler, /fitDiagram/);
    assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.icon-controls\s*\{[\s\S]*flex: 1 1 100%/);
});

test('Module layout delegates adaptive panels with no inline method fallback', () => {
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    assert.match(source, /Layout\.layoutGraph/);
    assert.match(source, /layoutModuleHierarchy: Graph\.layoutModuleHierarchy/);
    assert.match(source, /viewport: elements\.svg\.getBoundingClientRect\(\)/);
    assert.match(source, /kind-\$\{cssKind\(group\.kind\)\}/);
    assert.match(source, /dense-method/);
    assert.doesNotMatch(source, /MAX_INLINE_METHODS|compactGroups/);
});

test('Module hierarchy paints one fixed marker bus and uses panel containment', () => {
    const content = html();
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'media', 'webview.css'), 'utf8');
    assert.match(content, /id="hierarchy-arrow"[^>]*markerWidth="6"[^>]*markerHeight="6"/);
    assert.match(content, /id="hierarchy-arrow"[^>]*markerUnits="userSpaceOnUse"/);
    assert.match(source, /renderHierarchyBus\(layout\.hierarchyBus\)/);
    assert.match(source, /renderCycles\(layout\.cycles\)/);
    assert.match(source, /cycle-edge/);
    assert.match(source, /edge\.origin === 'view-model' && !hierarchyRoute/);
    assert.match(source, /hierarchyRoute\?\.marker === 'hierarchy'/);
    assert.match(styles, /\.hierarchy-bus,\s*\.edge\.hierarchy-branch\s*\{[\s\S]*vector-effect: non-scaling-stroke/);
});

test('standalone SVG export removes live interaction semantics', () => {
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    assert.match(source, /clone\.setAttribute\('role', 'img'\)/);
    assert.match(source, /clone\.removeAttribute\('aria-describedby'\)/);
    assert.match(source, /querySelectorAll\('\[role=\"button\"\], \[aria-selected\], \[aria-expanded\]'\)/);
    assert.match(source, /\.cycle-region\{fill:/);
    assert.match(source, /\.cycle-label\{fill:/);
    assert.match(source, /\.edge-group\.cycle-edge \.edge/);
});

test('responsive accessibility styles cover compact high-contrast and reduced-motion use', () => {
    const source = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'media', 'webview.css'), 'utf8');
    assert.match(styles, /@media \(max-width: 900px\)/);
    assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.inspector:has\(\.inspector-empty\)\s*\{[\s\S]*display: none/);
    assert.match(styles, /@media \(max-width: 680px\)/);
    assert.match(styles, /@media \(forced-colors: active\)/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(styles, /\.segmented button:focus-visible/);
    assert.match(styles, /\.workspace\s*\{[\s\S]*min-height: 0/);
    assert.match(source, /model\?\.security\?\.restrictedMode/);
});
