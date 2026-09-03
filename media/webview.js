'use strict';

(() => {
    const vscode = acquireVsCodeApi();
    const Graph = globalThis.BsvArchitectureGraph;
    const NS = 'http://www.w3.org/2000/svg';
    const saved = Graph.migrateState(vscode.getState() || {});

    const elements = {
        body: document.body,
        title: document.getElementById('architecture-title'),
        subtitle: document.getElementById('architecture-subtitle'),
        sourceScope: document.getElementById('source-scope'),
        levelButtons: [...document.querySelectorAll('[data-level]')],
        modeButtons: [...document.querySelectorAll('[data-analysis-mode]')],
        hopButtons: [...document.querySelectorAll('[data-hop]')],
        focusSummary: document.getElementById('focus-summary'),
        focusBack: document.getElementById('focus-back'),
        clearFocus: document.getElementById('clear-focus'),
        breadcrumbs: document.getElementById('breadcrumbs'),
        search: document.getElementById('search'),
        zoomOut: document.getElementById('zoom-out'),
        zoomIn: document.getElementById('zoom-in'),
        fit: document.getElementById('fit'),
        refresh: document.getElementById('refresh'),
        exportSvg: document.getElementById('export-svg'),
        exportJson: document.getElementById('export-json'),
        showPackages: document.getElementById('show-packages'),
        showImports: document.getElementById('show-imports'),
        showRules: document.getElementById('show-rules'),
        showPrimitives: document.getElementById('show-primitives'),
        packagesFilter: document.getElementById('packages-filter'),
        importsFilter: document.getElementById('imports-filter'),
        rulesFilter: document.getElementById('rules-filter'),
        primitivesFilter: document.getElementById('primitives-filter'),
        stats: document.getElementById('stats'),
        diagnostics: document.getElementById('diagnostic-summary'),
        tracebar: document.getElementById('tracebar'),
        traceSummary: document.getElementById('trace-summary'),
        tracePrevious: document.getElementById('trace-previous'),
        traceNext: document.getElementById('trace-next'),
        traceClear: document.getElementById('trace-clear'),
        scheduleLegend: document.getElementById('schedule-legend'),
        scheduleOrigin: document.getElementById('schedule-origin'),
        restrictedMode: document.getElementById('restricted-mode'),
        workspace: document.querySelector('.workspace'),
        shell: document.getElementById('canvas-shell'),
        svg: document.getElementById('architecture-canvas'),
        viewport: document.getElementById('viewport'),
        groups: document.getElementById('group-layer'),
        edges: document.getElementById('edge-layer'),
        nodes: document.getElementById('node-layer'),
        empty: document.getElementById('empty-state'),
        inspector: document.getElementById('inspector'),
        revealNotice: document.getElementById('reveal-notice'),
        revealNoticeText: document.getElementById('reveal-notice-text'),
        revealCurrentView: document.getElementById('reveal-current-view'),
        toast: document.getElementById('toast')
    };

    const runtime = {
        model: null,
        view: null,
        graph: { nodes: [], edges: [], groups: [], layout: null, byId: new Map() },
        transform: saved.transform,
        firstModel: true,
        fitOnNextRender: true,
        pointer: null,
        toastTimer: null,
        pendingRevealId: null,
        editorRevealId: null,
        editorRevealTimer: null,
        selectedEdgeId: null,
        anchorAfterRender: null
    };

    initializeControls(saved);
    installEventHandlers();
    applyTransform();
    vscode.postMessage({ type: 'ready' });

    function viewState() {
        return runtime.view?.state || saved;
    }

    function initializeControls(state) {
        elements.sourceScope.value = state.sourceScope;
        elements.search.value = state.search || '';
        syncPressed(elements.levelButtons, 'level', state.level);
        syncPressed(elements.modeButtons, 'analysisMode', state.analysisMode);
        syncPressed(elements.hopButtons, 'hop', String(state.hopScope));
        syncFilterControls(state.filters);
    }

    function installEventHandlers() {
        window.addEventListener('message', (event) => handleHostMessage(event.data));
        window.addEventListener('resize', debounce(() => {
            if (runtime.graph.nodes.length > 0) fitDiagram(false);
        }, 140));

        elements.sourceScope.addEventListener('change', () => {
            if (!runtime.view) return;
            runtime.view.setSourceScope(elements.sourceScope.value);
            reconcileCurrentFileFocus();
            clearTrace(false);
            runtime.fitOnNextRender = true;
            render();
            persistState();
        });
        for (const button of elements.levelButtons) {
            button.addEventListener('click', () => setLevel(button.dataset.level));
        }
        for (const button of elements.modeButtons) {
            button.addEventListener('click', () => setAnalysisMode(button.dataset.analysisMode));
        }
        for (const button of elements.hopButtons) {
            button.addEventListener('click', () => setHopScope(button.dataset.hop));
        }
        elements.focusBack.addEventListener('click', navigateBack);
        elements.clearFocus.addEventListener('click', clearFocus);

        const updateSearch = debounce(() => {
            viewState().search = elements.search.value.trim().toLowerCase();
            applySearchHighlight();
            persistState();
        }, 150);
        elements.search.addEventListener('input', updateSearch);
        elements.search.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const first = runtime.graph.nodes.find((node) => nodeMatchesSearch(node, elements.search.value));
                if (first) selectNode(first.id, true);
            } else if (event.key === 'Escape') {
                elements.search.value = '';
                viewState().search = '';
                applySearchHighlight();
                elements.svg.focus();
                persistState();
            }
        });

        elements.zoomIn.addEventListener('click', () => zoomAtCenter(1.18));
        elements.zoomOut.addEventListener('click', () => zoomAtCenter(1 / 1.18));
        elements.fit.addEventListener('click', () => fitDiagram(true));
        elements.refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
        elements.exportSvg.addEventListener('click', requestSvgExport);
        elements.exportJson.addEventListener('click', () => vscode.postMessage({ type: 'exportJson' }));
        for (const control of [
            elements.showPackages,
            elements.showImports,
            elements.showRules,
            elements.showPrimitives
        ]) control.addEventListener('change', updateFilters);

        elements.tracePrevious.addEventListener('click', () => changeTracePath(-1));
        elements.traceNext.addEventListener('click', () => changeTracePath(1));
        elements.traceClear.addEventListener('click', clearTrace);
        elements.revealCurrentView.addEventListener('click', revealPendingNode);

        elements.svg.addEventListener('wheel', onWheel, { passive: false });
        elements.svg.addEventListener('pointerdown', onPointerDown);
        elements.svg.addEventListener('pointermove', onPointerMove);
        elements.svg.addEventListener('pointerup', onPointerUp);
        elements.svg.addEventListener('pointercancel', onPointerUp);
        elements.svg.addEventListener('dblclick', (event) => {
            if (!event.target.closest('.arch-node')) fitDiagram(true);
        });
        elements.svg.addEventListener('keydown', onCanvasKeyDown);
    }

    function handleHostMessage(message) {
        switch (message?.type) {
            case 'model':
                receiveModel(message.model, message.initial || {});
                break;
            case 'busy':
                elements.body.classList.toggle('busy', Boolean(message.value));
                elements.workspace.setAttribute('aria-busy', String(Boolean(message.value)));
                if (message.value && message.message) elements.subtitle.textContent = message.message;
                break;
            case 'activeFile':
                if (!runtime.view) break;
                runtime.view.state.activeFile = message.activeFile || null;
                if (runtime.view.state.sourceScope === 'current-file') {
                    reconcileCurrentFileFocus();
                    clearTrace(false);
                    runtime.fitOnNextRender = true;
                    render();
                } else updateHeader();
                persistState();
                break;
            case 'revealNode':
                revealNodeFromEditor(message.nodeId);
                break;
            case 'toast':
                showToast(message.message, Boolean(message.error));
                break;
            case 'error':
                showError(message.message);
                break;
            default:
                break;
        }
    }

    function receiveModel(model, initial) {
        const previous = runtime.view?.state || saved;
        const sameWorkspace = Boolean(
            previous.workspaceUri
            && previous.workspaceUri === model?.workspaceUri
        );
        const defaults = model?.viewDefaults || {};
        const base = sameWorkspace || runtime.firstModel && saved.workspaceUri === model?.workspaceUri
            ? previous
            : {
                sourceScope: initial.sourceScope || defaults.sourceScope || legacySourceScope(initial.mode),
                level: initial.level || defaults.level || 'system',
                analysisMode: initial.analysisMode || defaults.analysisMode || 'structure',
                hopScope: initial.hopScope || defaults.hopScope || 'all',
                filters: {
                    packages: model?.config?.view?.showPackages === true,
                    imports: model?.config?.view?.showImports === true,
                    rules: true,
                    primitives: model?.config?.view?.showPrimitives === true
                },
                collapseModuleMembers: defaults.collapseModuleMembers !== false,
                transform: { x: 40, y: 40, scale: 1 }
            };
        runtime.model = model;
        elements.restrictedMode.hidden = model?.security?.restrictedMode !== true;
        runtime.view = Graph.createViewModel(model, {
            ...base,
            workspaceUri: model?.workspaceUri || null,
            activeWorkspace: model?.workspaceUri || null,
            activeFile: initial.activeFile || model?.activeFile || base.activeFile || null
        });
        const state = runtime.view.state;
        if (initial.focusId && runtime.view.indexes.nodeById.has(initial.focusId)) {
            state.focusStack = [initial.focusId];
            state.selectedId = initial.focusId;
        }
        runtime.transform = state.transform;
        runtime.firstModel = false;
        runtime.fitOnNextRender = !sameWorkspace && !(saved.workspaceUri === model?.workspaceUri && saved.transform);
        initializeControls(state);
        render();
        persistState();
    }

    function legacySourceScope(value) {
        return value === 'file' ? 'current-file' : 'workspace';
    }

    function showError(message) {
        elements.body.classList.remove('busy');
        elements.workspace.setAttribute('aria-busy', 'false');
        elements.title.textContent = 'BSV Lens';
        elements.subtitle.textContent = message || 'Analysis failed.';
        elements.nodes.replaceChildren();
        elements.edges.replaceChildren();
        elements.groups.replaceChildren();
        elements.empty.hidden = false;
        elements.empty.querySelector('strong').textContent = 'Architecture analysis failed';
        elements.empty.querySelector('span').textContent = message || 'See BSV Lens Output Channel.';
        showToast(message || 'Analysis failed.', true);
    }

    function setLevel(level) {
        if (!runtime.view) return;
        runtime.view.setLevel(level);
        const state = runtime.view.state;
        if (level !== 'system' && state.focusStack.length === 0) {
            const candidate = selectedModelNode();
            const moduleId = moduleOwnerId(candidate?.id)
                || runtime.model.roots?.[0]
                || runtime.view.indexes.visibleNodes.find((node) => node.kind === 'module')?.id;
            if (moduleId) state.focusStack = [moduleId];
        }
        clearTrace(false);
        runtime.fitOnNextRender = true;
        syncPressed(elements.levelButtons, 'level', state.level);
        render();
        persistState();
    }

    function setAnalysisMode(mode) {
        if (!runtime.view) return;
        runtime.view.setAnalysisMode(mode);
        runtime.selectedEdgeId = null;
        clearTrace(false);
        runtime.fitOnNextRender = true;
        syncPressed(elements.modeButtons, 'analysisMode', runtime.view.state.analysisMode);
        render();
        persistState();
    }

    function setHopScope(scope) {
        if (!runtime.view) return;
        runtime.view.setHopScope(scope);
        clearTrace(false);
        runtime.fitOnNextRender = true;
        syncPressed(elements.hopButtons, 'hop', String(runtime.view.state.hopScope));
        render();
        persistState();
    }

    function syncPressed(buttons, dataKey, value) {
        for (const button of buttons) {
            button.setAttribute('aria-pressed', String(button.dataset[dataKey] === String(value)));
        }
    }

    function updateFilters() {
        if (!runtime.view) return;
        runtime.view.state.filters = {
            packages: elements.showPackages.checked,
            imports: elements.showImports.checked,
            rules: elements.showRules.checked,
            primitives: elements.showPrimitives.checked
        };
        clearTrace(false);
        runtime.fitOnNextRender = true;
        render();
        persistState();
    }

    function syncFilterControls(filters = {}) {
        elements.showPackages.checked = filters.packages === true;
        elements.showImports.checked = filters.imports === true;
        elements.showRules.checked = filters.rules !== false;
        elements.showPrimitives.checked = filters.primitives === true;
    }

    function syncFilterAvailability() {
        const state = viewState();
        const system = state.level === 'system';
        const scheduling = state.analysisMode === 'scheduling';
        toggleFilter(elements.packagesFilter, elements.showPackages, scheduling);
        toggleFilter(elements.importsFilter, elements.showImports, scheduling);
        toggleFilter(elements.rulesFilter, elements.showRules, system);
        toggleFilter(elements.primitivesFilter, elements.showPrimitives, system || scheduling);
    }

    function toggleFilter(label, input, disabled) {
        label.classList.toggle('is-disabled', disabled);
        input.disabled = disabled;
    }

    function render() {
        if (!runtime.view || !runtime.model) return;
        const visible = deriveVisibleGraph();
        const grouped = viewState().level === 'system'
            && viewState().analysisMode === 'structure'
            && viewState().focusStack.length === 0;
        const layout = layoutGraph(visible.nodes, visible.edges, visible.groups, {
            direction: runtime.model.config?.view?.direction || 'LR',
            grouped,
            focusId: viewState().focusStack.at(-1) || null,
            viewport: elements.svg.getBoundingClientRect()
        });
        runtime.graph = {
            ...visible,
            layout,
            byId: new Map(visible.nodes.map((node) => [node.id, node])),
            edgeById: new Map(visible.edges.map((edge) => [edge.id, edge]))
        };

        elements.groups.replaceChildren();
        elements.edges.replaceChildren();
        elements.nodes.replaceChildren();
        renderGroups(layout.groups);
        renderHierarchyBus(layout.hierarchyBus);
        renderEdges(visible.edges, layout.positions);
        renderNodes(visible.nodes, layout.positions);
        renderEmptyState();
        renderBreadcrumbs();
        renderInspector();
        updateHeader();
        updateLegend();
        updateTraceUi();
        syncFilterAvailability();
        applySearchHighlight();
        applySelectionHighlight();
        applyEditorReveal();

        if (runtime.anchorAfterRender) {
            const anchor = runtime.anchorAfterRender;
            const position = layout.positions.get(anchor.nodeId);
            runtime.anchorAfterRender = null;
            if (position) {
                runtime.transform.x = anchor.x - position.x * runtime.transform.scale;
                runtime.transform.y = anchor.y - position.y * runtime.transform.scale;
            }
            applyTransform();
            persistState();
        } else if (runtime.fitOnNextRender) {
            requestAnimationFrame(() => {
                const selectedId = viewState().selectedId;
                const focusId = runtime.graph.layout?.positions.has(selectedId)
                    ? selectedId
                    : viewState().focusStack.at(-1);
                fitDiagram(false, focusId);
            });
            runtime.fitOnNextRender = false;
        } else applyTransform();
    }

    function deriveVisibleGraph() {
        const state = runtime.view.state;
        let result = runtime.view.visible({
            sourceScope: state.sourceScope,
            level: state.level,
            analysisMode: state.analysisMode,
            hopScope: state.hopScope,
            focusId: state.focusStack.at(-1) || null,
            activeFile: state.activeFile
        });
        let nodes = result.nodes.filter(nodeAllowed);
        const ids = new Set(nodes.map((node) => node.id));
        let edges = result.edges
            .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
            .filter(edgeAllowed);
        if (state.focusStack.length === 0 && state.level === 'system') {
            const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
            nodes = nodes.filter((node) =>
                ['module', 'package', 'interface'].includes(node.kind)
                || node.virtual
                || connected.has(node.id)
            );
        }
        const finalIds = new Set(nodes.map((node) => node.id));
        edges = edges.filter((edge) => finalIds.has(edge.source) && finalIds.has(edge.target));
        const groupIds = new Set(nodes.map((node) => node.group || 'root'));
        const groups = result.level === 'system'
            ? (runtime.model.groups || []).filter((group) => groupIds.has(group.id))
            : [];
        return { ...result, nodes, edges, groups };
    }

    function nodeAllowed(node) {
        const filters = viewState().filters;
        if (filters.packages === false && node.kind === 'package') return false;
        if (filters.rules === false && ['rule', 'method'].includes(node.kind)) return false;
        if (filters.primitives !== true && (node.primitive || ['register', 'fifo', 'wire', 'memory', 'vector'].includes(node.kind))) {
            return viewState().analysisMode === 'data-flow';
        }
        return !node.hidden;
    }

    function edgeAllowed(edge) {
        const filters = viewState().filters;
        if (filters.imports !== true && edge.kind === 'import') return false;
        if (filters.rules === false && ['call', 'access', 'invoke', 'return', 'value'].includes(edge.kind)) return false;
        return true;
    }

    function renderEmptyState() {
        const empty = runtime.graph.nodes.length === 0 || runtime.graph.edges.length === 0
            && viewState().analysisMode === 'scheduling';
        elements.empty.hidden = !empty;
        if (!empty) return;
        if (viewState().analysisMode === 'scheduling' && runtime.graph.edges.length === 0) {
            const hasRelations = (runtime.model.scheduling?.relationCount || 0) > 0;
            elements.empty.querySelector('strong').textContent = hasRelations
                ? 'Scheduling relations are outside the current focus'
                : 'No explicit scheduling relations were found';
            elements.empty.querySelector('span').textContent = hasRelations
                ? 'Set a module as focus or switch to Behavior level.'
                : 'Enable potential state dependencies or configure a BSC schedule provider.';
        } else {
            elements.empty.querySelector('strong').textContent = 'No architecture nodes to display';
            elements.empty.querySelector('span').textContent = 'Adjust source scope, focus, or filters.';
        }
    }

    function layoutGraph(nodes, edges, groups, options) {
        const sizes = new Map(nodes.map((node) => [node.id, measureNode(node)]));
        if (viewState().level === 'module' && viewState().analysisMode === 'structure') {
            return Graph.layoutModuleHierarchy(nodes, edges, sizes, options);
        }
        if (viewState().level === 'behavior' || viewState().analysisMode === 'scheduling') {
            return layoutCompactGrid(nodes, sizes, options.direction, options.focusId);
        }
        return options.grouped && groups.length > 1
            ? layoutByGroups(nodes, groups, sizes, options.direction)
            : layoutByRanks(nodes, edges, sizes, options.direction, options.focusId);
    }

    function layoutCompactGrid(nodes, sizes, direction, focusId) {
        const compact = elements.svg.getBoundingClientRect().width < 700;
        const margin = compact ? 20 : 40;
        const horizontalGap = compact ? 20 : 46;
        const verticalGap = compact ? 18 : 42;
        const sorted = nodes.slice().sort((left, right) =>
            (left.id === focusId ? -1 : right.id === focusId ? 1 : 0)
            || nodePriority(left) - nodePriority(right)
            || compareNodes(left, right)
        );
        const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(sorted.length))));
        const rows = Math.ceil(sorted.length / columns);
        const columnWidths = Array.from({ length: columns }, (_, column) =>
            Math.max(190, ...sorted.filter((_, index) => index % columns === column).map((node) => sizes.get(node.id).width))
        );
        const rowHeights = Array.from({ length: rows }, (_, row) =>
            Math.max(78, ...sorted.slice(row * columns, (row + 1) * columns).map((node) => sizes.get(node.id).height))
        );
        const xOffsets = columnWidths.map((_, index) =>
            margin + columnWidths.slice(0, index).reduce((sum, width) => sum + width + horizontalGap, 0)
        );
        const yOffsets = rowHeights.map((_, index) =>
            margin + rowHeights.slice(0, index).reduce((sum, height) => sum + height + verticalGap, 0)
        );
        const positions = new Map();
        sorted.forEach((node, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const size = sizes.get(node.id);
            positions.set(node.id, {
                x: xOffsets[column] + (columnWidths[column] - size.width) / 2,
                y: yOffsets[row],
                ...size
            });
        });
        return { positions, groups: [], bounds: computeBounds([...positions.values()], []), direction };
    }

    function layoutByGroups(nodes, groups, sizes, direction) {
        const positions = new Map();
        const layouts = [];
        const order = new Map(groups.map((group, index) => [group.id, group.order ?? index]));
        const grouped = new Map();
        for (const node of nodes) {
            const id = node.group || 'root';
            if (!grouped.has(id)) grouped.set(id, []);
            grouped.get(id).push(node);
        }
        const entries = [...grouped].sort((left, right) =>
            (order.get(left[0]) ?? 10000) - (order.get(right[0]) ?? 10000)
            || compareText(left[0], right[0])
        );
        let cursor = 40;
        for (const [groupId, members] of entries) {
            const sorted = members.slice().sort(compareNodes);
            const columns = sorted.length > 8 ? 2 : 1;
            const rows = Math.ceil(sorted.length / columns);
            const cellWidth = Math.max(230, ...sorted.map((node) => sizes.get(node.id).width)) + 26;
            const rowHeight = Math.max(100, ...sorted.map((node) => sizes.get(node.id).height)) + 22;
            const width = columns * cellWidth + 32;
            const height = Math.max(130, rows * rowHeight + 62);
            const metadata = groups.find((group) => group.id === groupId) || { id: groupId, label: titleCase(groupId) };
            const x = direction === 'TB' ? 40 : cursor;
            const y = direction === 'TB' ? cursor : 40;
            layouts.push({ ...metadata, x, y, width, height });
            sorted.forEach((node, index) => {
                const column = Math.floor(index / rows);
                const row = index % rows;
                const size = sizes.get(node.id);
                positions.set(node.id, {
                    x: x + 20 + column * cellWidth,
                    y: y + 48 + row * rowHeight,
                    ...size
                });
            });
            cursor += (direction === 'TB' ? height : width) + 90;
        }
        return { positions, groups: layouts, bounds: computeBounds([...positions.values()], layouts), direction };
    }

    function layoutByRanks(nodes, edges, sizes, direction, focusId) {
        const positions = new Map();
        const ids = new Set(nodes.map((node) => node.id));
        const rank = new Map(nodes.map((node) => [node.id, initialRank(node, focusId)]));
        const relevant = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.kind !== 'import');
        for (let iteration = 0; iteration < Math.min(nodes.length, 12); iteration += 1) {
            let changed = false;
            for (const edge of relevant) {
                if (edge.target === focusId || edge.bidirectional) continue;
                const candidate = Math.min(8, (rank.get(edge.source) || 0) + 1);
                if (candidate > (rank.get(edge.target) || 0)) {
                    rank.set(edge.target, candidate);
                    changed = true;
                }
            }
            if (!changed) break;
        }
        const layers = new Map();
        for (const node of nodes) {
            const value = rank.get(node.id) || 0;
            if (!layers.has(value)) layers.set(value, []);
            layers.get(value).push(node);
        }
        const ordered = [...layers].sort((left, right) => left[0] - right[0]);
        const dimensions = [];
        let primary = 40;
        let maxCross = 0;
        for (const [value, layer] of ordered) {
            layer.sort((left, right) => nodePriority(left) - nodePriority(right) || compareNodes(left, right));
            const primarySize = Math.max(...layer.map((node) =>
                direction === 'TB' ? sizes.get(node.id).height : sizes.get(node.id).width
            ));
            const crossSize = layer.reduce((sum, node) =>
                sum + (direction === 'TB' ? sizes.get(node.id).width : sizes.get(node.id).height), 0
            ) + Math.max(0, layer.length - 1) * 28;
            dimensions.push({ value, layer, primary, primarySize, crossSize });
            primary += primarySize + 110;
            maxCross = Math.max(maxCross, crossSize);
        }
        for (const layer of dimensions) {
            let cross = 40 + (maxCross - layer.crossSize) / 2;
            for (const node of layer.layer) {
                const size = sizes.get(node.id);
                positions.set(node.id, direction === 'TB'
                    ? { x: cross, y: layer.primary, ...size }
                    : { x: layer.primary, y: cross, ...size });
                cross += (direction === 'TB' ? size.width : size.height) + 28;
            }
        }
        return { positions, groups: [], bounds: computeBounds([...positions.values()], []), direction };
    }

    function initialRank(node, focusId) {
        if (node.id === focusId || node.kind === 'module') return 0;
        if (node.kind === 'member-group') return 1;
        if (node.kind === 'instance-group') return 2;
        if (focusId && node.parentId === focusId) return 2;
        return 0;
    }

    function nodePriority(node) {
        return {
            module: 0,
            package: 1,
            interface: 2,
            'member-group': 3,
            rule: 4,
            method: 5,
            function: 6,
            'instance-group': 7,
            instance: 8,
            register: 9,
            fifo: 9,
            memory: 9,
            wire: 9
        }[node.kind] ?? 10;
    }

    function measureNode(node) {
        if (node.kind === 'member-group') return { width: 220, height: 52 };
        if (node.kind === 'instance-group') return { width: 230, height: 66 };
        if (viewState().level === 'module' && node.kind === 'method') return { width: 154, height: 58 };
        if (node.kind === 'module') {
            if (viewState().level === 'system') return { width: 230, height: 112 };
            return { width: 300, height: 88 };
        }
        const labelLength = String(node.label || node.name || '').length;
        return { width: clamp(180 + Math.max(0, labelLength - 18) * 4.2, 180, 230), height: 78 };
    }

    function computeBounds(positions, groups) {
        const items = [...positions, ...groups];
        if (items.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
        const minX = Math.min(...items.map((item) => item.x));
        const minY = Math.min(...items.map((item) => item.y));
        const maxX = Math.max(...items.map((item) => item.x + item.width));
        const maxY = Math.max(...items.map((item) => item.y + item.height));
        return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    }

    function renderGroups(groups) {
        for (const group of groups) {
            const wrapper = svgElement('g', {
                class: `architecture-group${group.kind ? ` kind-${cssKind(group.kind)}` : ''}`
            });
            wrapper.append(svgElement('rect', {
                class: 'group-box',
                x: group.x,
                y: group.y,
                width: group.width,
                height: group.height,
                rx: 10,
                ry: 10
            }));
            if (group.label) {
                const title = svgElement('text', { class: 'group-title', x: group.x + 16, y: group.y + 23 });
                title.textContent = group.label;
                wrapper.append(title);
            }
            if (group.description) {
                const description = svgElement('text', { class: 'group-description', x: group.x + 16, y: group.y + 39 });
                description.textContent = truncate(group.description, Math.floor((group.width - 32) / 6));
                wrapper.append(description);
            }
            elements.groups.append(wrapper);
        }
    }

    function renderEdges(edges, positions) {
        for (const edge of edges) {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) continue;
            const hierarchyRoute = runtime.graph.layout?.edgeRoutes?.get(edge.id);
            if (edge.origin === 'view-model' && !hierarchyRoute) continue;
            const route = hierarchyRoute || routeEdge(
                source,
                target,
                runtime.graph.layout?.direction || 'LR',
                edge.id
            );
            const group = svgElement('g', {
                class: 'edge-group',
                'data-edge-id': edge.id,
                tabindex: edge.origin === 'view-model' ? '-1' : '0',
                role: edge.origin === 'view-model' ? 'presentation' : 'button',
                'aria-label': `${edge.kind} from ${nodeLabel(edge.source)} to ${nodeLabel(edge.target)}`
            });
            const attributes = {
                class: `edge ${cssKind(edge.kind)}${hierarchyRoute ? ' hierarchy-branch' : ''}`,
                d: route.path,
                'data-source': edge.source,
                'data-target': edge.target,
                'marker-end': hierarchyRoute?.marker === 'hierarchy'
                    ? 'url(#hierarchy-arrow)'
                    : edge.kind === 'contains' ? 'url(#arrow-muted)' : 'url(#arrow)'
            };
            if (edge.bidirectional) attributes['marker-start'] = 'url(#arrow-start)';
            const path = svgElement('path', attributes);
            group.append(path);
            if (!edge.suppressLabel && (edge.label || edge.kind)) {
                const label = truncate(edge.label || titleCase(edge.kind), 34);
                const width = Math.max(34, label.length * 5.5 + 10);
                group.append(
                    svgElement('rect', {
                        class: 'edge-label-bg',
                        x: route.labelX - width / 2,
                        y: route.labelY - 9,
                        width,
                        height: 15,
                        rx: 3
                    }),
                    textElement('edge-label', route.labelX, route.labelY + 2, label, { 'text-anchor': 'middle' })
                );
            }
            group.addEventListener('click', (event) => {
                event.stopPropagation();
                selectEdge(edge.id);
            });
            group.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectEdge(edge.id);
                }
            });
            elements.edges.append(group);
        }
    }

    function renderHierarchyBus(bus) {
        if (!bus?.path) return;
        elements.edges.append(svgElement('path', {
            class: 'hierarchy-bus',
            d: bus.path,
            role: 'presentation'
        }));
    }

    function routeEdge(source, target, direction, seed) {
        const jitter = (hashString(seed) % 17) - 8;
        if (direction === 'TB') {
            const forward = target.y >= source.y;
            const sx = source.x + source.width / 2;
            const sy = forward ? source.y + source.height : source.y;
            const tx = target.x + target.width / 2;
            const ty = forward ? target.y : target.y + target.height;
            const mid = (sy + ty) / 2 + jitter;
            return { path: `M ${sx} ${sy} V ${mid} H ${tx} V ${ty}`, labelX: (sx + tx) / 2, labelY: mid - 3 };
        }
        const forward = target.x >= source.x;
        const sx = forward ? source.x + source.width : source.x;
        const sy = source.y + source.height / 2;
        const tx = forward ? target.x : target.x + target.width;
        const ty = target.y + target.height / 2;
        const mid = (sx + tx) / 2 + jitter;
        return { path: `M ${sx} ${sy} H ${mid} V ${ty} H ${tx}`, labelX: mid, labelY: (sy + ty) / 2 - 4 };
    }

    function renderNodes(nodes, positions) {
        for (const node of nodes) {
            const position = positions.get(node.id);
            if (!position) continue;
            const denseMethod = viewState().level === 'module' && node.kind === 'method';
            const group = svgElement('g', {
                class: `arch-node kind-${cssKind(node.kind)}${denseMethod ? ' dense-method' : ''}`,
                transform: `translate(${position.x} ${position.y})`,
                tabindex: node.id === (viewState().selectedId || nodes[0]?.id) ? '0' : '-1',
                role: 'button',
                'aria-label': nodeAriaLabel(node),
                'aria-selected': String(node.id === viewState().selectedId),
                'data-node-id': node.id
            });
            if (node.kind === 'member-group') group.setAttribute('aria-expanded', String(!node.collapsed));
            if (node.kind === 'instance-group') {
                group.setAttribute('aria-expanded', String(Boolean(viewState().expandedAggregations[node.id])));
            }
            const tooltip = svgElement('title');
            tooltip.textContent = nodeTooltip(node);
            group.append(tooltip);
            group.append(
                svgElement('rect', {
                    class: 'node-body',
                    x: 0,
                    y: 0,
                    width: position.width,
                    height: position.height,
                    rx: 7,
                    ry: 7
                }),
                svgElement('rect', {
                    class: 'node-accent',
                    x: 0,
                    y: 0,
                    width: 5,
                    height: position.height,
                    rx: 3,
                    ry: 3
                })
            );
            if (node.kind === 'member-group') renderMemberGroup(group, node, position);
            else if (node.kind === 'module') renderModuleNode(group, node, position);
            else if (denseMethod) renderDenseMethodNode(group, node, position);
            else renderStandardNode(group, node, position);
            installNodeHandlers(group, node);
            elements.nodes.append(group);
        }
    }

    function renderMemberGroup(group, node, position) {
        const chevron = svgElement('path', {
            class: 'group-chevron',
            d: node.collapsed ? 'M 17 19 L 22 24 L 17 29' : 'M 15 21 L 20 26 L 25 21'
        });
        group.append(chevron);
        group.append(textElement('node-title', 35, 25, node.label));
        group.append(textElement(
            'bucket-count',
            position.width - 14,
            25,
            `${node.visibleCount}/${node.totalCount}`,
            { 'text-anchor': 'end' }
        ));
        group.append(textElement(
            'node-subtitle',
            35,
            41,
            `${memberGroupRelationship(node.bucket)} · ${node.collapsed ? 'Collapsed' : 'Expanded'}`
        ));
    }

    function renderModuleNode(group, node, position) {
        group.append(textElement('node-kind', 15, 18, 'MODULE'));
        group.append(textElement('node-title', 15, 39, truncate(node.label || node.name, 40)));
        group.append(textElement('node-subtitle', 15, 56, truncate(moduleSubtitle(node), 40)));
        if (viewState().level === 'system') {
            const details = node.details || {};
            const lines = [
                ['Instances', details.childInstanceCount ?? details.instanceCount ?? 0],
                ['Methods', details.methodCount || 0],
                ['Rules', details.ruleCount || 0],
                ['State', details.stateCount || 0]
            ];
            lines.forEach(([label, value], index) => {
                const y = 74 + index * 10;
                group.append(textElement('node-detail', 15, y, label));
                group.append(textElement('node-detail', position.width - 15, y, value, { 'text-anchor': 'end' }));
            });
        } else {
            group.append(textElement('node-detail', 15, 75, moduleMemberSummary(node)));
        }
        group.append(
            svgElement('circle', { class: 'node-port', cx: 0, cy: position.height / 2, r: 3.2 }),
            svgElement('circle', { class: 'node-port', cx: position.width, cy: position.height / 2, r: 3.2 })
        );
    }

    function moduleSubtitle(node) {
        return node.details?.returnInterface || node.packageName || 'module';
    }

    function moduleMemberSummary(node) {
        const details = node.details || {};
        const counts = [
            [details.methodCount ?? node.ports?.length, 'method'],
            [details.ruleCount, 'rule'],
            [details.stateCount, 'state'],
            [details.childInstanceCount, 'child']
        ];
        const visible = counts
            .filter(([count]) => Number.isInteger(count) && count > 0)
            .map(([count, label]) => `${count} ${label}${count === 1 ? '' : 's'}`);
        return visible.join(' · ') || 'No members';
    }

    function renderStandardNode(group, node, position) {
        group.append(
            textElement('node-kind', 15, 18, displayKind(node)),
            textElement('node-title', 15, 39, truncate(node.label || node.name, Math.floor((position.width - 28) / 7.2))),
            textElement('node-subtitle', 15, 57, truncate(nodeSubtitle(node), Math.floor((position.width - 28) / 5.8))),
            textElement('node-detail', 15, 73, truncate(nodeDetail(node), Math.floor((position.width - 28) / 5.3))),
            svgElement('circle', { class: 'node-port', cx: 0, cy: position.height / 2, r: 3.2 }),
            svgElement('circle', { class: 'node-port', cx: position.width, cy: position.height / 2, r: 3.2 })
        );
        if (node.kind === 'instance-group') {
            group.append(svgElement('path', {
                class: 'group-chevron',
                d: viewState().expandedAggregations[node.id]
                    ? `M ${position.width - 25} 30 L ${position.width - 20} 35 L ${position.width - 15} 30`
                    : `M ${position.width - 23} 28 L ${position.width - 18} 33 L ${position.width - 23} 38`
            }));
        }
    }

    function renderDenseMethodNode(group, node, position) {
        group.append(
            textElement('node-kind', 12, 14, 'METHOD'),
            textElement('node-title', 12, 32, truncate(node.label || node.name, 21)),
            textElement(
                'node-subtitle',
                12,
                48,
                truncate(`${node.details?.returnType || 'unknown'} · ${node.reads?.length || 0}R/${node.writes?.length || 0}W`, 25)
            ),
            svgElement('circle', { class: 'node-port', cx: 0, cy: position.height / 2, r: 3.2 }),
            svgElement('circle', { class: 'node-port', cx: position.width, cy: position.height / 2, r: 3.2 })
        );
    }

    function installNodeHandlers(group, node) {
        const disclosure = node.kind === 'member-group' || node.kind === 'instance-group';
        group.addEventListener('click', (event) => {
            event.stopPropagation();
            if (disclosure) {
                drillInto(node.id);
                return;
            }
            selectNode(node.id, false);
        });
        group.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            if (!disclosure) drillInto(node.id);
        });
        group.addEventListener('keydown', (event) => {
            if ((event.key === 'Enter' || event.key === ' ') && disclosure) {
                event.preventDefault();
                drillInto(node.id);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                openNodeSource(node.id);
            } else if (event.key === ' ') {
                event.preventDefault();
                selectNode(node.id, false);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                drillInto(node.id);
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                navigateBack();
            } else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                focusAdjacentNode(node.id, event.key === 'ArrowDown' ? 1 : -1);
            }
        });
    }

    function nodeAriaLabel(node) {
        if (node.kind === 'member-group') {
            return `${node.label}, ${memberGroupRelationship(node.bucket)} ${node.totalCount} members, ${node.collapsed ? 'collapsed' : 'expanded'}`;
        }
        const relations = node.synthetic ? 0 : runtime.view.relations(node.id).length;
        const drill = canDrill(node) ? ', expandable' : '';
        return `${displayKind(node)} ${node.label || node.name}, ${relations} relationships${drill}`;
    }

    function memberGroupRelationship(bucket) {
        if (bucket === 'interfaces') return 'Implements';
        if (bucket === 'child-instances') return 'Instantiates';
        return 'Contains';
    }

    function nodeTooltip(node) {
        if (node.kind === 'member-group') return `${node.label}: ${node.visibleCount} visible of ${node.totalCount}`;
        if (node.kind === 'module') {
            return [node.label || node.name, moduleSubtitle(node), moduleMemberSummary(node)]
                .filter(Boolean)
                .join('\n');
        }
        return [node.label || node.name, nodeSubtitle(node), nodeDetail(node)].filter(Boolean).join('\n');
    }

    function displayKind(node) {
        if (node.virtual) return String(node.kind || 'external').toUpperCase();
        if (node.kind === 'member-group') return 'MEMBER GROUP';
        if (node.kind === 'instance-group') return 'INSTANCE GROUP';
        if (node.primitive) return `${String(node.kind).toUpperCase()} INSTANCE`;
        return String(node.kind || 'node').toUpperCase();
    }

    function nodeSubtitle(node) {
        if (node.kind === 'package') return node.relativePath || 'package';
        if (node.kind === 'interface') return `${node.ports?.length || node.details?.methods?.length || 0} Interface Methods`;
        if (node.kind === 'rule') return node.details?.guard ? `guard: ${node.details.guard}` : 'unguarded rule';
        if (node.kind === 'method') return node.details?.returnType || 'method';
        if (node.kind === 'function') return node.details?.returnType || 'function';
        if (node.primitive || node.kind === 'instance') return node.details?.constructor || node.details?.type || 'instance';
        if (node.kind === 'instance-group') return multiplicityText(node.multiplicity);
        return node.packageName || node.description || '';
    }

    function nodeDetail(node) {
        if (node.kind === 'package') {
            const details = node.details || {};
            return `${details.modules || 0} modules · ${details.functions || 0} functions · ${details.types || 0} types`;
        }
        if (node.kind === 'function') return `${node.details?.parameters?.length || 0} parameters`;
        if (node.kind === 'rule' || node.kind === 'method') {
            return `${node.reads?.length || 0} reads · ${node.writes?.length || 0} writes`;
        }
        if (node.description) return node.description;
        return node.relativePath || '';
    }

    function renderBreadcrumbs() {
        const state = viewState();
        elements.breadcrumbs.replaceChildren();
        appendBreadcrumb(state.sourceScope === 'current-file'
            ? state.activeFile?.split('/').pop() || 'Current File'
            : 'Workspace', -1);
        state.focusStack.forEach((id, index) => {
            const node = runtime.view.indexes.nodeById.get(id);
            if (!node) return;
            const separator = document.createElement('span');
            separator.className = 'breadcrumb-separator';
            separator.textContent = '/';
            elements.breadcrumbs.append(separator);
            appendBreadcrumb(node.label || node.name, index);
        });
        elements.focusBack.disabled = state.focusStack.length === 0;
        elements.clearFocus.disabled = state.focusStack.length === 0;
    }

    function appendBreadcrumb(label, index) {
        const button = makeButton(label, () => {
            const state = viewState();
            state.focusStack = index < 0 ? [] : state.focusStack.slice(0, index + 1);
            state.selectedId = state.focusStack.at(-1) || null;
            runtime.fitOnNextRender = true;
            render();
            persistState();
        }, 'breadcrumb');
        button.title = label;
        elements.breadcrumbs.append(button);
    }

    function renderInspector() {
        const edge = runtime.view?.indexes.edgeById.get(runtime.selectedEdgeId);
        if (edge) {
            renderEdgeInspector(edge);
            return;
        }
        const node = selectedNode();
        if (!node) {
            elements.inspector.innerHTML = '<div class="inspector-empty"><strong>Select a block</strong><span>Details, relationships, and source navigation appear here.</span></div>';
            return;
        }
        const content = document.createElement('div');
        content.className = 'inspector-content';
        const header = document.createElement('div');
        header.className = 'inspector-header';
        const title = document.createElement('h2');
        title.textContent = node.label || node.name;
        const kind = document.createElement('span');
        kind.className = 'inspector-kind';
        kind.textContent = displayKind(node);
        header.append(title, kind);
        content.append(header);
        appendBadges(content, node.analysisOrigin, node.confidence);

        if (node.description) content.append(paragraph(node.description, 'inspector-description'));
        const sourcePath = [node.packageName, node.relativePath, formatLocation(node.location)].filter(Boolean).join(' · ');
        if (sourcePath) content.append(paragraph(sourcePath, 'inspector-path'));

        const actions = document.createElement('div');
        actions.className = 'inspector-actions';
        if (node.location?.uri) actions.append(makeButton('Open source', () => openNodeSource(node.id), 'primary'));
        if (!node.synthetic) actions.append(makeButton('Set as focus', () => setFocus(node.id)));
        if (canDrill(node)) actions.append(makeButton(drillLabel(node), () => drillInto(node.id)));
        actions.append(makeButton('Set trace start', () => setTraceStart(node.id)));
        if (viewState().trace.startId && viewState().trace.startId !== node.id) {
            actions.append(makeButton('Trace to…', () => traceTo(node.id)));
        }
        appendDirectionalTraceActions(actions, node);
        actions.append(makeButton('Copy ID', async () => {
            await navigator.clipboard.writeText(node.id);
            showToast('Architecture node ID copied.');
        }));
        content.append(actions);

        if (node.kind === 'module') {
            renderInterfaceContract(content, node);
        }
        if (node.signature) {
            const section = inspectorSection('Signature');
            const code = document.createElement('pre');
            code.className = 'inspector-code';
            code.textContent = node.signature;
            section.append(code);
            content.append(section);
        }
        const details = flattenDetails(node.details || {});
        if (details.length) content.append(detailSection('Details', details));
        renderRelationInspector(content, node);
        elements.inspector.replaceChildren(content);
    }

    function renderEdgeInspector(edge) {
        const content = document.createElement('div');
        content.className = 'inspector-content';
        const header = document.createElement('div');
        header.className = 'inspector-header';
        const title = document.createElement('h2');
        title.textContent = titleCase(edge.kind);
        const kind = document.createElement('span');
        kind.className = 'inspector-kind';
        kind.textContent = 'RELATION';
        header.append(title, kind);
        content.append(header);
        appendBadges(content, originLabel(edge.origin), edge.confidence);
        content.append(detailSection('Relation', [
            ['Source', nodeLabel(edge.source)],
            ['Target', nodeLabel(edge.target)],
            ['Kind', edge.kind],
            ['Label', edge.label || '—'],
            ['Direction', edge.bidirectional ? 'Bidirectional' : 'Source to target'],
            ['Evidence', evidenceText(edge.evidence)],
            ['Source location', formatLocation(edge.sourceLocation)],
            ['Compiler location', formatLocation(edge.compilerLocation)]
        ]));
        const actions = document.createElement('div');
        actions.className = 'inspector-actions';
        const location = edge.compilerLocation || edge.sourceLocation;
        if (location?.uri) actions.append(makeButton('Open evidence', () => {
            vscode.postMessage({ type: 'openSource', location });
        }, 'primary'));
        actions.append(makeButton('Select source', () => selectNode(edge.source, true)));
        actions.append(makeButton('Select target', () => selectNode(edge.target, true)));
        content.append(actions);
        elements.inspector.replaceChildren(content);
    }

    function appendBadges(content, origin, confidence) {
        if (!origin && !confidence) return;
        const badges = document.createElement('div');
        badges.className = 'inspector-badges';
        for (const value of [origin, confidence].filter(Boolean)) {
            const badge = document.createElement('span');
            badge.className = 'origin-badge';
            badge.textContent = String(value);
            badges.append(badge);
        }
        content.append(badges);
    }

    function renderInterfaceContract(content, moduleNode) {
        const interfaceName = moduleNode.details?.returnInterface
            || moduleNode.ports?.[0]?.interface
            || 'unresolved';
        const selectionHint = viewState().level === 'module'
            ? 'Expand Methods and select a Method card.'
            : 'Open Module level to inspect individual interface methods.';
        content.append(detailSection('Interface Contract', [
            ['Interface', interfaceName],
            ['Interface methods', moduleNode.ports?.length || moduleNode.details?.methodCount || 0],
            ['Method selection', selectionHint]
        ]));
    }

    function renderRelationInspector(content, node) {
        if (node.synthetic) return;
        const relations = dedupeRelations(runtime.view.relations(node.id).map((relation) => {
            const otherId = relation.direction === 'out' ? relation.edge.target : relation.edge.source;
            return { ...relation, otherId, other: runtime.view.indexes.nodeById.get(otherId) };
        }));
        const counts = relationSummary(node, relations);
        if (!counts.length) return;
        const section = inspectorSection('Relationships');
        const summary = document.createElement('dl');
        summary.className = 'relation-summary';
        for (const [label, count] of counts) {
            const term = document.createElement('dt');
            term.textContent = label;
            const definition = document.createElement('dd');
            definition.textContent = String(count);
            summary.append(term, definition);
        }
        section.append(summary);
        const details = document.createElement('details');
        details.className = 'relation-details';
        const toggle = document.createElement('summary');
        toggle.textContent = 'Show details';
        details.append(toggle);
        const byKind = groupBy(relations, (relation) => relation.edge.kind);
        for (const [kind, values] of [...byKind].sort((left, right) => compareText(left[0], right[0]))) {
            const group = document.createElement('details');
            group.className = 'relation-group';
            const heading = document.createElement('summary');
            heading.textContent = `${titleCase(kind)} (${values.length})`;
            group.append(heading);
            const list = document.createElement('div');
            list.className = 'relation-list';
            for (const relation of values) list.append(relationButton(relation));
            group.append(list);
            details.append(group);
        }
        section.append(details);
        content.append(section);
    }

    function relationButton(relation) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'relation-button';
        const kind = document.createElement('span');
        kind.className = 'relation-kind';
        kind.textContent = `${relation.direction === 'out' ? 'OUT' : 'IN'} · ${relation.edge.kind}`;
        const name = document.createElement('span');
        name.className = 'relation-name';
        name.textContent = relation.other?.label || relation.other?.name || relation.otherId;
        const evidence = document.createElement('span');
        evidence.className = 'relation-evidence';
        evidence.textContent = `${originLabel(relation.edge.origin)} · ${evidenceText(relation.edge.evidence)}`;
        button.append(kind, name, evidence);
        button.addEventListener('click', () => navigateToRelated(relation.otherId));
        return button;
    }

    function relationSummary(node, relations) {
        const counts = new Map();
        for (const relation of relations) {
            const label = relationSummaryLabel(relation.edge.kind);
            counts.set(label, (counts.get(label) || 0) + 1);
        }
        if (node.memberBuckets) {
            for (const [key, label] of [['methods', 'Methods'], ['rules', 'Rules'], ['state', 'State']]) {
                const count = node.memberBuckets[key]?.totalCount;
                if (Number.isInteger(count)) counts.set(label, count);
            }
        }
        return [...counts].sort((left, right) => compareText(left[0], right[0]));
    }

    function relationSummaryLabel(kind) {
        return {
            implements: 'Implements',
            instantiate: 'Instances',
            read: 'Reads',
            write: 'Writes',
            call: 'Calls',
            invoke: 'Calls',
            conflict: 'Scheduling conflicts',
            'potential-state-dependency': 'Potential dependencies'
        }[kind] || titleCase(kind);
    }

    function appendDirectionalTraceActions(actions, node) {
        const relations = runtime.view.relations(node.id);
        const add = (label, direction, kinds) => {
            if (relations.some((relation) => relation.direction === direction && kinds.includes(relation.edge.kind))) {
                actions.append(makeButton(label, () => traceRelations(node.id, direction, kinds)));
            }
        };
        add('Trace callers', 'in', ['call', 'invoke']);
        add('Trace callees', 'out', ['call', 'invoke']);
        add('Trace readers', 'out', ['read']);
        add('Trace writers', 'in', ['write']);
    }

    function inspectorSection(titleText) {
        const section = document.createElement('section');
        section.className = 'inspector-section';
        const heading = document.createElement('h3');
        heading.textContent = titleText;
        section.append(heading);
        return section;
    }

    function detailSection(title, entries) {
        const section = inspectorSection(title);
        const list = document.createElement('dl');
        list.className = 'detail-grid';
        for (const [key, value] of entries) {
            if (value === undefined || value === null || value === '') continue;
            const term = document.createElement('dt');
            term.textContent = key;
            const definition = document.createElement('dd');
            definition.textContent = String(value);
            list.append(term, definition);
        }
        section.append(list);
        return section;
    }

    function flattenDetails(details) {
        const hidden = new Set([
            'calls', 'references', 'methods', 'subinterfaces', 'locals', 'parameters',
            'operations', 'returns', 'targetId', 'methodPorts', 'accesses'
        ]);
        return Object.entries(details).flatMap(([key, value]) => {
            if (hidden.has(key) || value === null || value === undefined || value === '') return [];
            if (typeof value === 'object') return [[titleCase(key), truncate(JSON.stringify(value), 240)]];
            return [[titleCase(key), value]];
        }).slice(0, 18);
    }

    function dedupeRelations(relations) {
        const seen = new Set();
        return relations.filter((relation) => {
            const key = [
                relation.direction,
                relation.otherId,
                relation.edge.kind,
                evidenceText(relation.edge.evidence)
            ].join('|');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function canDrill(node) {
        return node.kind === 'member-group'
            || node.kind === 'instance-group'
            || Boolean(node.details?.targetId)
            || runtime.view.indexes.children.get(node.id)?.length > 0
            || ['package', 'module', 'rule', 'method', 'function'].includes(node.kind);
    }

    function drillLabel(node) {
        if (node.kind === 'member-group') return node.collapsed ? 'Expand group' : 'Collapse group';
        if (node.kind === 'instance-group') return viewState().expandedAggregations[node.id] ? 'Collapse instances' : 'Expand instances';
        return node.details?.targetId ? `Open ${node.details.targetName || 'implementation'}` : 'Focus';
    }

    function drillInto(nodeId) {
        const node = runtime.graph.byId.get(nodeId) || runtime.view.indexes.nodeById.get(nodeId);
        if (!node) return;
        if (node.kind === 'member-group') {
            selectNode(node.id, false);
            preserveNodeAnchor(node.parentId);
            runtime.view.setCollapsed(node.parentId, node.bucket, !node.collapsed);
            runtime.fitOnNextRender = false;
            render();
            elements.nodes.querySelector(`[data-node-id="${cssEscape(node.id)}"]`)?.focus();
            persistState();
            return;
        }
        if (node.kind === 'instance-group') {
            selectNode(node.id, false);
            preserveNodeAnchor(node.parentId);
            runtime.view.toggleAggregation(node.id);
            runtime.fitOnNextRender = false;
            render();
            elements.nodes.querySelector(`[data-node-id="${cssEscape(node.id)}"]`)?.focus();
            persistState();
            return;
        }
        const targetId = node.details?.targetId || node.id;
        if (node.kind === 'module') runtime.view.setLevel('module');
        else if (['rule', 'method', 'function'].includes(node.kind)) runtime.view.setLevel('behavior');
        syncPressed(elements.levelButtons, 'level', runtime.view.state.level);
        setFocus(targetId);
    }

    function preserveNodeAnchor(nodeId) {
        const position = runtime.graph.layout?.positions.get(nodeId);
        if (!position) return;
        runtime.anchorAfterRender = {
            nodeId,
            x: runtime.transform.x + position.x * runtime.transform.scale,
            y: runtime.transform.y + position.y * runtime.transform.scale
        };
    }

    function setFocus(nodeId) {
        if (!runtime.view.indexes.nodeById.has(nodeId)) return;
        const stack = viewState().focusStack;
        if (stack.at(-1) !== nodeId) stack.push(nodeId);
        clearTrace(false);
        viewState().selectedId = nodeId;
        runtime.selectedEdgeId = null;
        runtime.fitOnNextRender = true;
        render();
        persistState();
    }

    function clearFocus() {
        if (!runtime.view) return;
        viewState().focusStack = [];
        viewState().selectedId = null;
        runtime.selectedEdgeId = null;
        clearTrace(false);
        runtime.fitOnNextRender = true;
        render();
        persistState();
    }

    function navigateBack() {
        if (!runtime.view || viewState().focusStack.length === 0) return;
        viewState().focusStack.pop();
        viewState().selectedId = viewState().focusStack.at(-1) || null;
        runtime.selectedEdgeId = null;
        clearTrace(false);
        runtime.fitOnNextRender = true;
        render();
        persistState();
    }

    function navigateToRelated(nodeId) {
        if (runtime.graph.byId.has(nodeId)) selectNode(nodeId, true);
        else setFocus(moduleOwnerId(nodeId) || nodeId);
    }

    function selectNode(nodeId, center) {
        if (!runtime.graph.byId.has(nodeId) && !runtime.view.indexes.nodeById.has(nodeId)) return;
        viewState().selectedId = nodeId;
        runtime.selectedEdgeId = null;
        renderInspector();
        applySelectionHighlight();
        if (center) centerNode(nodeId);
        persistState();
    }

    function selectEdge(edgeId) {
        runtime.selectedEdgeId = edgeId;
        viewState().selectedId = null;
        renderInspector();
        applySelectionHighlight();
    }

    function selectedNode() {
        return runtime.graph.byId.get(viewState().selectedId)
            || runtime.view?.indexes.nodeById.get(viewState().selectedId)
            || null;
    }

    function selectedModelNode() {
        return runtime.view?.indexes.nodeById.get(viewState().selectedId) || null;
    }

    function openNodeSource(nodeId) {
        const node = runtime.view.indexes.nodeById.get(nodeId);
        if (!node?.location?.uri) {
            showToast('This element has no source location.', true);
            return;
        }
        vscode.postMessage({ type: 'openSource', nodeId });
    }

    function revealNodeFromEditor(nodeId) {
        if (!runtime.view?.indexes.nodeById.has(nodeId)) return;
        if (runtime.graph.byId.has(nodeId)) {
            runtime.editorRevealId = nodeId;
            selectNode(nodeId, true);
            applyEditorReveal();
            return;
        }
        runtime.pendingRevealId = nodeId;
        const node = runtime.view.indexes.nodeById.get(nodeId);
        elements.revealNoticeText.textContent = `${node.label || node.name} is outside current focus.`;
        elements.revealNotice.hidden = false;
    }

    function revealPendingNode() {
        const nodeId = runtime.pendingRevealId;
        const node = runtime.view?.indexes.nodeById.get(nodeId);
        if (!node) return;
        viewState().sourceScope = 'workspace';
        viewState().level = ['rule', 'method', 'function', 'register', 'fifo', 'wire', 'memory'].includes(node.kind)
            ? 'behavior'
            : node.kind === 'module' ? 'module' : 'system';
        viewState().hopScope = 'all';
        viewState().focusStack = [moduleOwnerId(nodeId) || nodeId];
        runtime.pendingRevealId = null;
        elements.revealNotice.hidden = true;
        runtime.fitOnNextRender = true;
        initializeControls(viewState());
        render();
        runtime.editorRevealId = nodeId;
        selectNode(nodeId, true);
        persistState();
    }

    function applyEditorReveal() {
        clearTimeout(runtime.editorRevealTimer);
        for (const element of elements.nodes.querySelectorAll('.arch-node')) {
            element.classList.toggle('editor-reveal', element.dataset.nodeId === runtime.editorRevealId);
        }
        if (runtime.editorRevealId) {
            runtime.editorRevealTimer = setTimeout(() => {
                runtime.editorRevealId = null;
                for (const element of elements.nodes.querySelectorAll('.editor-reveal')) {
                    element.classList.remove('editor-reveal');
                }
            }, 1200);
        }
    }

    function setTraceStart(nodeId) {
        viewState().trace = { startId: nodeId, targetId: null, paths: [], index: 0 };
        updateTraceUi();
        applySelectionHighlight();
        persistState();
        showToast(`Trace start: ${nodeLabel(nodeId)}`);
    }

    function traceTo(targetId) {
        const trace = viewState().trace;
        const paths = Graph.shortestPaths(trace.startId, targetId, runtime.graph.edges, { directed: true });
        trace.targetId = targetId;
        trace.paths = paths;
        trace.index = 0;
        updateTraceUi();
        applySelectionHighlight();
        persistState();
        showToast(paths.length ? `${paths.length} shortest path${paths.length === 1 ? '' : 's'} found.` : 'No path in current view.', paths.length === 0);
    }

    function traceRelations(nodeId, direction, kinds) {
        const paths = runtime.graph.edges
            .filter((edge) => kinds.includes(edge.kind) && (
                direction === 'out' ? edge.source === nodeId : edge.target === nodeId
            ))
            .map((edge) => direction === 'out' ? [nodeId, edge.target] : [edge.source, nodeId]);
        viewState().trace = {
            startId: paths[0]?.[0] || nodeId,
            targetId: paths[0]?.at(-1) || null,
            paths,
            index: 0
        };
        updateTraceUi();
        applySelectionHighlight();
        persistState();
    }

    function changeTracePath(delta) {
        const trace = viewState().trace;
        if (!trace.paths.length) return;
        trace.index = (trace.index + delta + trace.paths.length) % trace.paths.length;
        updateTraceUi();
        applySelectionHighlight();
        persistState();
    }

    function clearTrace(persist = true) {
        if (!runtime.view) return;
        viewState().trace = { startId: null, targetId: null, paths: [], index: 0 };
        updateTraceUi();
        applySelectionHighlight();
        if (persist) persistState();
    }

    function updateTraceUi() {
        const trace = viewState().trace;
        const active = Boolean(trace.startId);
        elements.tracebar.hidden = !active;
        if (!active) return;
        const count = trace.paths.length;
        const activePath = trace.paths[trace.index] || [];
        const activeTarget = activePath.at(-1) || trace.targetId;
        elements.traceSummary.textContent = count
            ? `${nodeLabel(activePath[0] || trace.startId)} to ${nodeLabel(activeTarget)} · ${trace.index + 1} of ${count}`
            : `Start: ${nodeLabel(trace.startId)}${trace.targetId ? ' · no path' : ''}`;
        elements.tracePrevious.disabled = count < 2;
        elements.traceNext.disabled = count < 2;
    }

    function applySelectionHighlight() {
        const selected = viewState().selectedId;
        const tracePath = viewState().trace.paths[viewState().trace.index] || [];
        const tracedNodes = new Set(tracePath);
        const tracedPairs = new Set(tracePath.slice(0, -1).map((id, index) => `${id}|${tracePath[index + 1]}`));
        const connected = new Set(selected ? [selected] : []);
        const selectedNode = runtime.view?.indexes.nodeById.get(selected);
        if (selected) {
            for (const edge of runtime.graph.edges) {
                if (edge.source === selected) connected.add(edge.target);
                if (edge.target === selected) connected.add(edge.source);
            }
        }
        for (const element of elements.nodes.querySelectorAll('.arch-node')) {
            const id = element.dataset.nodeId;
            const node = runtime.graph.byId.get(id);
            if (selectedNode?.kind === 'module' && node?.parentId === selected) connected.add(id);
            element.classList.toggle('selected', id === selected);
            element.classList.toggle('connected', Boolean(selected) && connected.has(id) && id !== selected);
            const selectionDim = Boolean(selected) && !connected.has(id);
            const traceDim = tracedNodes.size > 0 && !tracedNodes.has(id);
            element.classList.toggle('selection-dimmed', selectionDim || traceDim);
            element.setAttribute('aria-selected', String(id === selected));
            const roving = selected && runtime.graph.byId.has(selected)
                ? selected
                : runtime.graph.nodes[0]?.id;
            element.setAttribute('tabindex', id === roving ? '0' : '-1');
        }
        for (const group of elements.edges.querySelectorAll('.edge-group')) {
            const edge = runtime.graph.edgeById.get(group.dataset.edgeId);
            const selectedEdge = runtime.selectedEdgeId === edge?.id;
            const ownedEdge = selectedNode?.kind === 'module'
                && moduleOwnerId(edge?.source) === selected
                && moduleOwnerId(edge?.target) === selected;
            const connectedEdge = selected && (edge?.source === selected || edge?.target === selected || ownedEdge);
            const traced = tracedPairs.has(`${edge?.source}|${edge?.target}`)
                || edge?.bidirectional && tracedPairs.has(`${edge?.target}|${edge?.source}`);
            group.classList.toggle('connected', Boolean(connectedEdge || selectedEdge));
            group.classList.toggle('trace-path', traced);
            group.querySelector('.edge')?.classList.toggle('trace-path', traced);
            group.classList.toggle('selection-dimmed', Boolean(selected || tracedNodes.size) && !connectedEdge && !traced && !selectedEdge);
        }
        updateCombinedDimming();
    }

    function applySearchHighlight() {
        const query = String(viewState().search || elements.search.value || '').trim().toLowerCase();
        for (const element of elements.nodes.querySelectorAll('.arch-node')) {
            const node = runtime.graph.byId.get(element.dataset.nodeId);
            element.classList.toggle('search-dimmed', Boolean(query) && !nodeMatchesSearch(node, query));
        }
        for (const group of elements.edges.querySelectorAll('.edge-group')) {
            const edge = runtime.graph.edgeById.get(group.dataset.edgeId);
            const match = nodeMatchesSearch(runtime.graph.byId.get(edge?.source), query)
                || nodeMatchesSearch(runtime.graph.byId.get(edge?.target), query)
                || String(edge?.kind || '').toLowerCase().includes(query);
            group.classList.toggle('search-dimmed', Boolean(query) && !match);
        }
        updateCombinedDimming();
    }

    function updateCombinedDimming() {
        for (const element of elements.nodes.querySelectorAll('.arch-node')) {
            element.classList.toggle('dimmed',
                element.classList.contains('selection-dimmed') || element.classList.contains('search-dimmed')
            );
        }
        for (const group of elements.edges.querySelectorAll('.edge-group')) {
            group.classList.toggle('dimmed',
                group.classList.contains('selection-dimmed') || group.classList.contains('search-dimmed')
            );
        }
    }

    function nodeMatchesSearch(node, query) {
        if (!query) return true;
        if (!node) return false;
        return [
            node.label, node.name, node.kind, node.packageName, node.relativePath,
            node.description, node.signature, JSON.stringify(node.ports || [])
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    }

    function updateHeader() {
        const state = viewState();
        elements.title.textContent = runtime.model.title || 'BSV Architecture';
        const focus = runtime.view.indexes.nodeById.get(state.focusStack.at(-1));
        elements.subtitle.textContent = focus
            ? `${displayKind(focus)} · ${focus.label || focus.name}`
            : state.sourceScope === 'current-file'
                ? state.activeFile || 'Current BSV file'
                : `${runtime.model.workspaceName || 'Workspace'} · generated ${formatTimestamp(runtime.model.generatedAt)}`;
        const focusName = focus?.label || focus?.name || 'none';
        const hops = state.hopScope === 'all' ? 'All' : `${state.hopScope} hop${state.hopScope === 1 ? '' : 's'}`;
        elements.focusSummary.textContent = `Focus: ${focusName} · ${titleCase(state.analysisMode)} · ${hops} · ${runtime.graph.nodes.length}/${runtime.model.stats.nodes} nodes · ${runtime.graph.edges.length} edges`;
        elements.stats.textContent = `${runtime.graph.nodes.length}/${runtime.model.stats.nodes} nodes · ${runtime.graph.edges.length} edges · ${runtime.model.stats.files} files`;
        const diagnostics = runtime.model.diagnostics || [];
        const errors = diagnostics.filter((item) => item.severity === 'error').length;
        const warnings = diagnostics.filter((item) => item.severity === 'warning').length;
        elements.diagnostics.textContent = errors || warnings ? `${errors} errors · ${warnings} warnings` : 'No parser diagnostics';
        elements.diagnostics.classList.toggle('has-issues', Boolean(errors || warnings));
        elements.diagnostics.title = diagnostics.slice(0, 10).map((item) => item.message).join('\n');
    }

    function updateLegend() {
        const scheduling = viewState().analysisMode === 'scheduling';
        elements.scheduleLegend.hidden = !scheduling;
        if (scheduling) elements.scheduleOrigin.textContent = runtime.model.scheduling?.badge || 'SOURCE-DERIVED';
    }

    function fitDiagram(announce, focusId = null) {
        const bounds = runtime.graph.layout?.bounds;
        if (!bounds || bounds.width <= 1 || bounds.height <= 1) return;
        const rect = elements.svg.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) return;
        const padding = rect.width < 700 ? 18 : 54;
        const minimumScale = rect.width < 700 ? 0.75 : 0.08;
        runtime.transform.scale = clamp(
            Math.min((rect.width - padding * 2) / bounds.width, (rect.height - padding * 2) / bounds.height),
            minimumScale,
            1.35
        );
        runtime.transform.x = (rect.width - bounds.width * runtime.transform.scale) / 2 - bounds.x * runtime.transform.scale;
        runtime.transform.y = (rect.height - bounds.height * runtime.transform.scale) / 2 - bounds.y * runtime.transform.scale;
        const targetId = focusId || viewState().selectedId;
        const focus = targetId ? runtime.graph.layout?.positions.get(targetId) : null;
        if (focus) {
            const desiredX = rect.width / 2 - (focus.x + focus.width / 2) * runtime.transform.scale;
            const desiredY = rect.height / 2 - (focus.y + focus.height / 2) * runtime.transform.scale;
            const minimumX = rect.width - padding - (bounds.x + bounds.width) * runtime.transform.scale;
            const maximumX = padding - bounds.x * runtime.transform.scale;
            const minimumY = rect.height - padding - (bounds.y + bounds.height) * runtime.transform.scale;
            const maximumY = padding - bounds.y * runtime.transform.scale;
            runtime.transform.x = clamp(desiredX, minimumX, maximumX);
            runtime.transform.y = clamp(desiredY, minimumY, maximumY);
        }
        applyTransform();
        persistState();
        if (announce) showToast('Diagram fitted to canvas.');
    }

    function centerNode(nodeId) {
        const position = runtime.graph.layout?.positions.get(nodeId);
        if (!position) return;
        const rect = elements.svg.getBoundingClientRect();
        runtime.transform.x = rect.width / 2 - (position.x + position.width / 2) * runtime.transform.scale;
        runtime.transform.y = rect.height / 2 - (position.y + position.height / 2) * runtime.transform.scale;
        applyTransform();
    }

    function zoomAtCenter(factor) {
        const rect = elements.svg.getBoundingClientRect();
        zoomAt(factor, rect.width / 2, rect.height / 2);
    }

    const persistTransform = debounce(persistState, 120);

    function zoomAt(factor, clientX, clientY) {
        const previous = runtime.transform.scale;
        const next = clamp(previous * factor, 0.08, 3.5);
        const worldX = (clientX - runtime.transform.x) / previous;
        const worldY = (clientY - runtime.transform.y) / previous;
        runtime.transform.scale = next;
        runtime.transform.x = clientX - worldX * next;
        runtime.transform.y = clientY - worldY * next;
        applyTransform();
        persistTransform();
    }

    function applyTransform() {
        elements.viewport.setAttribute(
            'transform',
            `translate(${runtime.transform.x} ${runtime.transform.y}) scale(${runtime.transform.scale})`
        );
    }

    function onWheel(event) {
        event.preventDefault();
        const rect = elements.svg.getBoundingClientRect();
        zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    }

    function onPointerDown(event) {
        if (event.button !== 0 || event.target.closest('.arch-node, .edge-group')) return;
        runtime.pointer = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: runtime.transform.x,
            originY: runtime.transform.y
        };
        elements.svg.setPointerCapture(event.pointerId);
        elements.svg.classList.add('panning');
        viewState().selectedId = null;
        runtime.selectedEdgeId = null;
        renderInspector();
        applySelectionHighlight();
    }

    function onPointerMove(event) {
        if (!runtime.pointer || event.pointerId !== runtime.pointer.id) return;
        runtime.transform.x = runtime.pointer.originX + event.clientX - runtime.pointer.startX;
        runtime.transform.y = runtime.pointer.originY + event.clientY - runtime.pointer.startY;
        applyTransform();
    }

    function onPointerUp(event) {
        if (!runtime.pointer || event.pointerId !== runtime.pointer.id) return;
        try {
            elements.svg.releasePointerCapture(event.pointerId);
        } catch (_) {
            // Host may release pointer capture first.
        }
        runtime.pointer = null;
        elements.svg.classList.remove('panning');
        persistState();
    }

    function onCanvasKeyDown(event) {
        if (event.target.closest('.arch-node, .edge-group')) return;
        if (event.key === '0') {
            event.preventDefault();
            fitDiagram(true);
        } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomAtCenter(1.18);
        } else if (event.key === '-') {
            event.preventDefault();
            zoomAtCenter(1 / 1.18);
        } else if (event.key === 'Escape' || event.altKey && event.key === 'ArrowLeft') {
            event.preventDefault();
            navigateBack();
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            elements.search.focus();
        }
    }

    function focusAdjacentNode(nodeId, direction) {
        const nodes = runtime.graph.nodes;
        const index = nodes.findIndex((node) => node.id === nodeId);
        if (index < 0 || nodes.length < 2) return;
        const next = nodes[(index + direction + nodes.length) % nodes.length];
        selectNode(next.id, true);
        elements.nodes.querySelector(`[data-node-id="${cssEscape(next.id)}"]`)?.focus();
    }

    function requestSvgExport() {
        const focus = runtime.view.indexes.nodeById.get(viewState().focusStack.at(-1));
        vscode.postMessage({
            type: 'exportSvg',
            svg: serializeSvg(),
            suggestedName: `${safeName(focus?.label || runtime.model?.title || 'bsv-architecture')}.svg`
        });
    }

    function serializeSvg() {
        const bounds = runtime.graph.layout?.bounds || { x: 0, y: 0, width: 100, height: 100 };
        const padding = 28;
        const width = Math.ceil(bounds.width + padding * 2);
        const height = Math.ceil(bounds.height + padding * 2);
        const clone = elements.svg.cloneNode(true);
        clone.removeAttribute('tabindex');
        clone.setAttribute('xmlns', NS);
        clone.setAttribute('role', 'img');
        clone.setAttribute('aria-label', elements.svg.getAttribute('aria-label') || 'BSV architecture diagram');
        clone.removeAttribute('aria-describedby');
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
        clone.querySelector('#viewport').setAttribute('transform', `translate(${padding - bounds.x} ${padding - bounds.y})`);
        for (const element of clone.querySelectorAll('[tabindex], [data-node-id], [data-edge-id], [data-source], [data-target]')) {
            for (const attribute of ['tabindex', 'data-node-id', 'data-edge-id', 'data-source', 'data-target']) {
                element.removeAttribute(attribute);
            }
        }
        for (const element of clone.querySelectorAll('[role="button"], [aria-selected], [aria-expanded]')) {
            element.removeAttribute('role');
            element.removeAttribute('aria-selected');
            element.removeAttribute('aria-expanded');
        }
        for (const element of clone.querySelectorAll('.dimmed, .connected, .selected, .selection-dimmed, .search-dimmed, .editor-reveal')) {
            element.classList.remove('dimmed', 'connected', 'selected', 'selection-dimmed', 'search-dimmed', 'editor-reveal');
        }
        const style = document.createElementNS(NS, 'style');
        style.textContent = exportStyles();
        clone.insertBefore(style, clone.firstChild);
        return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
    }

    function exportStyles() {
        return `
            #architecture-canvas{background:#fff}.group-box{fill:#f7f8fa;stroke:#98a2b3;stroke-dasharray:5 4}
            .kind-member-panel .group-box{fill:#f7f8fa;stroke:#d0d5dd;stroke-dasharray:none}
            .group-title,.node-title{fill:#101828;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:700}
            .group-description,.node-kind,.node-subtitle,.node-detail,.bucket-count{fill:#667085}
            .edge{fill:none;stroke:#667085;stroke-width:1.35}.edge.contains{stroke:#98a2b3;stroke-dasharray:4 4}.edge.import{stroke:#9b51e0;stroke-dasharray:7 5}
            .hierarchy-bus,.edge.hierarchy-branch{fill:none;stroke:#667085;stroke-width:1.25;stroke-dasharray:none}.hierarchy-arrow-head{fill:none;stroke:#667085;stroke-width:1.2}
            .edge.implements{stroke:#1570ef;stroke-dasharray:3 3}.edge.read{stroke:#2e90fa}.edge.write,.edge.descending-urgency,.edge.preempts{stroke:#dc6803;stroke-width:1.8}
            .edge.conflict{stroke:#d92d20;stroke-width:2}.edge.conflict-free{stroke:#039855;stroke-dasharray:2 3}.edge.mutually-exclusive{stroke:#7f56d9;stroke-dasharray:7 4}
            .edge.potential-state-dependency{stroke:#667085;stroke-dasharray:5 5}.edge-label-bg{fill:#fff;stroke:#d0d5dd}.edge-label{fill:#667085;font-size:9px}
            .arrow-head{fill:#667085}.arrow-head-muted{fill:#98a2b3}.node-body{fill:#fff;stroke:#98a2b3;stroke-width:1.2}
            .node-title{font-size:13px}.node-kind{font-size:9px;font-weight:700}.node-subtitle{font-size:10px}.node-detail{font-size:9px}
            .node-port{fill:#fff;stroke:#667085}.group-chevron{fill:none;stroke:#344054;stroke-width:1.5}
            .kind-module .node-accent{fill:#f79009}.kind-interface .node-accent{fill:#2e90fa}.kind-rule .node-accent{fill:#d92d20}
            .kind-method .node-accent,.kind-function .node-accent{fill:#7f56d9}.kind-instance .node-accent{fill:#079455}
            .node-accent{fill:#667085}.kind-package .node-accent{fill:#98a2b3}.kind-host .node-accent,.kind-member-group .node-accent,.kind-instance-group .node-accent{fill:#7f56d9}
            .kind-register .node-accent,.kind-wire .node-accent{fill:#2e90fa}.kind-fifo .node-accent{fill:#667085}.kind-memory .node-accent{fill:#039855}
            .kind-type .node-accent,.kind-enum .node-accent,.kind-struct .node-accent,.kind-union .node-accent{fill:#475467}
            .edge.sequential-before,.edge.sequential-before-reverse,.edge.execution-order{stroke:#1570ef}
            .edge.data,.edge.control{stroke:#039855;stroke-width:1.8}
        `;
    }

    function persistState() {
        if (!runtime.view) return;
        const state = runtime.view.state;
        state.transform = { ...runtime.transform };
        const value = {
            version: Graph.STATE_VERSION,
            workspaceUri: runtime.model?.workspaceUri || null,
            activeWorkspace: runtime.model?.workspaceUri || null,
            activeFile: state.activeFile,
            sourceScope: state.sourceScope,
            level: state.level,
            analysisMode: state.analysisMode,
            hopScope: state.hopScope,
            focusStack: state.focusStack,
            selectedId: state.selectedId,
            collapsedGroups: state.collapsedGroups,
            expandedAggregations: state.expandedAggregations,
            filters: state.filters,
            trace: state.trace,
            transform: state.transform,
            search: state.search
        };
        vscode.setState(value);
        vscode.postMessage({ type: 'state', state: value });
    }

    function moduleOwnerId(id) {
        let node = runtime.view?.indexes.nodeById.get(id);
        if (!node) return null;
        if (node.kind === 'module') return node.id;
        if (node.kind === 'instance' && node.details?.targetId) return node.details.targetId;
        while (node?.parentId) {
            node = runtime.view.indexes.nodeById.get(node.parentId);
            if (node?.kind === 'module') return node.id;
        }
        return null;
    }

    function reconcileCurrentFileFocus() {
        const state = viewState();
        if (state.sourceScope !== 'current-file' || !state.activeFile || state.focusStack.length === 0) return;
        const focus = runtime.view.indexes.nodeById.get(state.focusStack.at(-1));
        const owner = runtime.view.indexes.nodeById.get(moduleOwnerId(focus?.id));
        const source = owner || focus;
        if (source?.relativePath === state.activeFile) return;
        state.focusStack = [];
        state.selectedId = null;
        runtime.selectedEdgeId = null;
    }

    function nodeLabel(id) {
        const node = runtime.graph.byId.get(id) || runtime.view?.indexes.nodeById.get(id);
        return node?.label || node?.name || id || 'unknown';
    }

    function multiplicityText(value) {
        if (!value) return 'unresolved multiplicity';
        if (value.status === 'exact') return `${value.count} instances`;
        if (value.status === 'parameterized') return 'parameterized';
        return 'unresolved multiplicity';
    }

    function originLabel(origin) {
        if (origin === 'bsc') return 'BSC AUTHORITATIVE';
        if (origin === 'source-heuristic') return 'HEURISTIC';
        if (origin === 'source-attribute' || origin === 'source-derived') return 'SOURCE-DERIVED';
        if (origin === 'config') return 'CONFIGURED';
        return origin || 'SOURCE-DERIVED';
    }

    function evidenceText(value) {
        if (typeof value === 'string') return value;
        if (value === null || value === undefined) return '';
        try {
            return JSON.stringify(value);
        } catch (_) {
            return String(value);
        }
    }

    function formatLocation(location) {
        if (!location || !Number.isInteger(location.line)) return '';
        const file = location.uri ? location.uri.split('/').pop() : '';
        return `${file ? `${file}:` : ''}${location.line + 1}`;
    }

    function formatTimestamp(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? ''
            : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function showToast(message, error = false) {
        if (!message) return;
        clearTimeout(runtime.toastTimer);
        elements.toast.textContent = message;
        elements.toast.classList.toggle('error', error);
        elements.toast.classList.add('visible');
        runtime.toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2600);
    }

    function makeButton(label, listener, className = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.title = label;
        button.addEventListener('click', listener);
        return button;
    }

    function paragraph(text, className) {
        const value = document.createElement('p');
        value.className = className;
        value.textContent = text;
        return value;
    }

    function groupBy(values, keyFor) {
        const result = new Map();
        for (const value of values) {
            const key = keyFor(value);
            if (!result.has(key)) result.set(key, []);
            result.get(key).push(value);
        }
        return result;
    }

    function textElement(className, x, y, content, attributes = {}) {
        const element = svgElement('text', { class: className, x, y, ...attributes });
        element.textContent = String(content ?? '');
        return element;
    }

    function svgElement(name, attributes = {}) {
        const element = document.createElementNS(NS, name);
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
        return element;
    }

    function titleCase(value) {
        return String(value || '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, (character) => character.toUpperCase());
    }

    function truncate(value, length) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        return text.length <= length ? text : `${text.slice(0, Math.max(1, length - 1))}…`;
    }

    function safeName(value) {
        return String(value || 'bsv-architecture')
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'bsv-architecture';
    }

    function cssKind(value) {
        return String(value || 'node').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    }

    function cssEscape(value) {
        return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
    }

    function compareText(left, right) {
        return String(left || '').localeCompare(String(right || ''));
    }

    function compareNodes(left, right) {
        return compareText(left?.label || left?.name, right?.label || right?.name)
            || compareText(left?.id, right?.id);
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function hashString(value) {
        let hash = 0;
        for (let index = 0; index < value.length; index += 1) {
            hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
        }
        return Math.abs(hash);
    }

    function debounce(callback, delay) {
        let timer = null;
        return (...argumentsList) => {
            clearTimeout(timer);
            timer = setTimeout(() => callback(...argumentsList), delay);
        };
    }
})();
