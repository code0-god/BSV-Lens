'use strict';

(() => {
    const vscode = acquireVsCodeApi();
    const NS = 'http://www.w3.org/2000/svg';
    const saved = vscode.getState() || {};

    const elements = {
        body: document.body,
        title: document.getElementById('architecture-title'),
        subtitle: document.getElementById('architecture-subtitle'),
        viewMode: document.getElementById('view-mode'),
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
        stats: document.getElementById('stats'),
        diagnostics: document.getElementById('diagnostic-summary'),
        shell: document.getElementById('canvas-shell'),
        svg: document.getElementById('architecture-canvas'),
        viewport: document.getElementById('viewport'),
        groups: document.getElementById('group-layer'),
        edges: document.getElementById('edge-layer'),
        nodes: document.getElementById('node-layer'),
        empty: document.getElementById('empty-state'),
        inspector: document.getElementById('inspector'),
        toast: document.getElementById('toast')
    };

    const state = {
        model: null,
        workspaceUri: saved.workspaceUri || null,
        activeFile: saved.activeFile || null,
        mode: saved.mode || 'system',
        focusStack: Array.isArray(saved.focusStack) ? saved.focusStack : [],
        selectedId: saved.selectedId || null,
        filters: {
            packages: saved.filters?.packages ?? true,
            imports: saved.filters?.imports ?? false,
            rules: saved.filters?.rules ?? true,
            primitives: saved.filters?.primitives ?? false
        },
        search: '',
        transform: normalizeTransform(saved.transform),
        graph: { nodes: [], edges: [], layout: null },
        firstModel: true,
        fitOnNextRender: true,
        pointer: null,
        toastTimer: null
    };

    initializeControls();
    installEventHandlers();
    applyTransform();
    vscode.postMessage({ type: 'ready' });

    function initializeControls() {
        elements.viewMode.value = state.mode === 'file' ? 'file' : 'system';
        elements.showPackages.checked = state.filters.packages;
        elements.showImports.checked = state.filters.imports;
        elements.showRules.checked = state.filters.rules;
        elements.showPrimitives.checked = state.filters.primitives;
    }

    function installEventHandlers() {
        window.addEventListener('message', (event) => handleHostMessage(event.data));
        window.addEventListener('resize', debounce(() => {
            if (state.graph.nodes.length > 0) fitDiagram(false);
        }, 120));

        elements.viewMode.addEventListener('change', () => {
            state.mode = elements.viewMode.value === 'file' ? 'file' : 'system';
            state.focusStack = [];
            state.selectedId = null;
            state.fitOnNextRender = true;
            render();
            persistState();
        });
        elements.search.addEventListener('input', () => {
            state.search = elements.search.value.trim().toLowerCase();
            applySearchHighlight();
        });
        elements.search.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const first = state.graph.nodes.find((node) => nodeMatchesSearch(node, state.search));
                if (first) selectNode(first.id, true);
            } else if (event.key === 'Escape') {
                elements.search.value = '';
                state.search = '';
                applySearchHighlight();
                elements.svg.focus();
            }
        });

        elements.zoomIn.addEventListener('click', () => zoomAtCenter(1.18));
        elements.zoomOut.addEventListener('click', () => zoomAtCenter(1 / 1.18));
        elements.fit.addEventListener('click', () => fitDiagram(true));
        elements.refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
        elements.exportSvg.addEventListener('click', requestSvgExport);
        elements.exportJson.addEventListener('click', () => vscode.postMessage({ type: 'exportJson' }));

        elements.showPackages.addEventListener('change', updateFilters);
        elements.showImports.addEventListener('change', updateFilters);
        elements.showRules.addEventListener('change', updateFilters);
        elements.showPrimitives.addEventListener('change', updateFilters);

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
                if (message.value && message.message) elements.subtitle.textContent = message.message;
                break;
            case 'activeFile':
                state.activeFile = message.activeFile || null;
                if (state.mode === 'file') {
                    state.focusStack = [];
                    state.selectedId = null;
                    state.fitOnNextRender = true;
                    render();
                } else {
                    updateSubtitle();
                }
                persistState();
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
        const sameWorkspace = Boolean(state.model && state.workspaceUri === model?.workspaceUri);
        state.model = model;
        state.workspaceUri = model?.workspaceUri || null;
        state.activeFile = initial.activeFile || model?.activeFile || state.activeFile;

        const validIds = new Set((model?.nodes || []).map((node) => node.id));
        state.focusStack = sameWorkspace
            ? state.focusStack.filter((id) => validIds.has(id))
            : [];
        if (state.selectedId && !validIds.has(state.selectedId)) state.selectedId = null;

        if (!sameWorkspace || state.firstModel) {
            state.mode = ['file', 'system'].includes(initial.mode) ? initial.mode : state.mode;
            elements.viewMode.value = state.mode;
            const configView = model?.config?.view || {};
            state.filters.packages = saved.filters?.packages ?? configView.showPackages ?? true;
            state.filters.imports = saved.filters?.imports ?? configView.showImports ?? false;
            state.filters.primitives = saved.filters?.primitives ?? configView.showPrimitives ?? false;
            state.filters.rules = saved.filters?.rules ?? true;
            syncFilterControls();
            if (initial.focusId && validIds.has(initial.focusId)) state.focusStack = [initial.focusId];
        }

        state.firstModel = false;
        state.fitOnNextRender = true;
        render();
        persistState();
    }

    function showError(message) {
        elements.body.classList.remove('busy');
        elements.title.textContent = 'BSV Architecture';
        elements.subtitle.textContent = message || 'Analysis failed.';
        elements.nodes.replaceChildren();
        elements.edges.replaceChildren();
        elements.groups.replaceChildren();
        elements.empty.hidden = false;
        elements.empty.querySelector('strong').textContent = 'Architecture analysis failed';
        elements.empty.querySelector('span').textContent = message || 'See the BSV Architecture Explorer output channel.';
        showToast(message || 'Analysis failed.', true);
    }

    function updateFilters() {
        state.filters = {
            packages: elements.showPackages.checked,
            imports: elements.showImports.checked,
            rules: elements.showRules.checked,
            primitives: elements.showPrimitives.checked
        };
        state.fitOnNextRender = true;
        render();
        persistState();
    }

    function syncFilterControls() {
        elements.showPackages.checked = state.filters.packages;
        elements.showImports.checked = state.filters.imports;
        elements.showRules.checked = state.filters.rules;
        elements.showPrimitives.checked = state.filters.primitives;
    }

    function render() {
        if (!state.model) return;
        const visible = deriveVisibleGraph();
        const layout = layoutGraph(visible.nodes, visible.edges, visible.groups, {
            direction: state.model.config?.view?.direction || 'LR',
            grouped: state.mode === 'system' && state.focusStack.length === 0
        });
        state.graph = { ...visible, layout };

        elements.groups.replaceChildren();
        elements.edges.replaceChildren();
        elements.nodes.replaceChildren();

        renderGroups(layout.groups);
        renderEdges(visible.edges, layout.positions);
        renderNodes(visible.nodes, layout.positions);
        elements.empty.hidden = visible.nodes.length > 0;

        renderBreadcrumbs();
        renderInspector();
        updateHeader();
        applySearchHighlight();
        applySelectionHighlight();

        if (state.fitOnNextRender) {
            requestAnimationFrame(() => fitDiagram(false));
            state.fitOnNextRender = false;
        } else {
            applyTransform();
        }
    }

    function deriveVisibleGraph() {
        const allNodes = state.model.nodes.filter((node) => !node.hidden);
        const byId = new Map(allNodes.map((node) => [node.id, node]));
        const focusId = state.focusStack.at(-1) || null;
        let ids;

        if (focusId && byId.has(focusId)) {
            ids = scopeForNode(byId.get(focusId), allNodes, state.model.edges, byId);
        } else if (state.mode === 'file') {
            ids = fileScope(allNodes, state.activeFile || state.model.activeFile);
        } else {
            ids = systemScope(allNodes);
        }

        let nodes = allNodes.filter((node) => ids.has(node.id) && nodeAllowed(node));
        const allowedIds = new Set(nodes.map((node) => node.id));
        let edges = state.model.edges.filter((edge) => allowedIds.has(edge.source) && allowedIds.has(edge.target));
        edges = edges.filter(edgeAllowed);

        const edgeNodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
        if (focusId && allowedIds.has(focusId)) edgeNodeIds.add(focusId);
        nodes = nodes.filter((node) => {
            if (state.mode === 'file') return true;
            if (focusId) return true;
            if (node.kind === 'module' || node.virtual || node.kind === 'package') return true;
            return edgeNodeIds.has(node.id) || isStandaloneUtility(node, allNodes);
        });

        const finalIds = new Set(nodes.map((node) => node.id));
        edges = edges.filter((edge) => finalIds.has(edge.source) && finalIds.has(edge.target));
        const groupIds = new Set(nodes.map((node) => node.group || 'root'));
        const groups = (state.model.groups || []).filter((group) => groupIds.has(group.id));
        return { nodes, edges, groups, byId };
    }

    function systemScope(nodes) {
        const packageModuleCount = new Map();
        for (const node of nodes) {
            if (node.kind === 'module') packageModuleCount.set(node.packageName, (packageModuleCount.get(node.packageName) || 0) + 1);
        }
        return new Set(nodes.filter((node) => {
            if (node.virtual) return true;
            if (node.kind === 'module' || node.kind === 'package') return true;
            if (node.kind === 'interface') return true;
            if (node.kind === 'function' && !node.details?.parentModuleName) {
                return (packageModuleCount.get(node.packageName) || 0) === 0;
            }
            return false;
        }).map((node) => node.id));
    }

    function fileScope(nodes, activeFile) {
        if (!activeFile) return systemScope(nodes);
        return new Set(nodes.filter((node) => node.relativePath === activeFile).map((node) => node.id));
    }

    function scopeForNode(focus, nodes, edges, byId) {
        const ids = new Set([focus.id]);
        const children = nodes.filter((node) => node.parentId === focus.id);
        for (const child of children) ids.add(child.id);

        if (focus.kind === 'package') {
            for (const node of nodes) {
                if (node.packageName === focus.packageName && node.parentId === focus.id) ids.add(node.id);
            }
        }

        if (focus.kind === 'module') {
            for (const edge of edges) {
                if (edge.source === focus.id && ['instantiate', 'implements', 'data', 'control'].includes(edge.kind)) ids.add(edge.target);
            }
        } else if (focus.kind === 'rule' || focus.kind === 'method' || focus.kind === 'function') {
            if (focus.parentId) ids.add(focus.parentId);
            for (const edge of edges) {
                if (edge.source === focus.id) ids.add(edge.target);
                if (edge.target === focus.id) ids.add(edge.source);
            }
        } else if (focus.kind === 'instance' || focus.primitive) {
            if (focus.parentId) ids.add(focus.parentId);
            if (focus.details?.targetId) ids.add(focus.details.targetId);
        } else if (focus.virtual) {
            for (const edge of edges) {
                if (edge.source === focus.id) ids.add(edge.target);
                if (edge.target === focus.id) ids.add(edge.source);
            }
        }

        for (const edge of edges) {
            if (!ids.has(edge.source) && !ids.has(edge.target)) continue;
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            if (source?.parentId === focus.id || target?.parentId === focus.id) {
                ids.add(edge.source);
                ids.add(edge.target);
            }
        }
        return ids;
    }

    function nodeAllowed(node) {
        const systemRoot = state.mode === 'system' && state.focusStack.length === 0;
        const contractKinds = new Set(['package', 'interface', 'function', 'enum', 'struct', 'union', 'type']);
        if (!state.filters.packages && (node.kind === 'package' || systemRoot && contractKinds.has(node.kind))) return false;
        if (!state.filters.rules && ['rule', 'method'].includes(node.kind)) return false;
        if (!state.filters.primitives && (node.primitive || ['register', 'fifo', 'wire', 'memory', 'vector'].includes(node.kind))) return false;
        return true;
    }

    function edgeAllowed(edge) {
        if (!state.filters.imports && edge.kind === 'import') return false;
        if (!state.filters.rules && ['call', 'access'].includes(edge.kind)) return false;
        if (!state.filters.packages && edge.kind === 'contains') {
            const source = state.model.nodes.find((node) => node.id === edge.source);
            if (source?.kind === 'package') return false;
        }
        return true;
    }

    function isStandaloneUtility(node, allNodes) {
        if (node.kind !== 'function') return false;
        return !allNodes.some((candidate) => candidate.packageName === node.packageName && candidate.kind === 'module');
    }

    function layoutGraph(nodes, edges, groups, options) {
        const sizes = new Map(nodes.map((node) => [node.id, measureNode(node)]));
        return options.grouped && groups.length > 1
            ? layoutByGroups(nodes, edges, groups, sizes, options.direction)
            : layoutByRanks(nodes, edges, sizes, options.direction, state.focusStack.at(-1));
    }

    function layoutByGroups(nodes, edges, groups, sizes, direction) {
        const positions = new Map();
        const groupLayouts = [];
        const groupOrder = new Map(groups.map((group, index) => [group.id, group.order ?? index]));
        const grouped = new Map();
        for (const node of nodes) {
            const id = node.group || 'root';
            if (!grouped.has(id)) grouped.set(id, []);
            grouped.get(id).push(node);
        }

        const orderedGroups = [...grouped.entries()].sort((left, right) => {
            const leftOrder = groupOrder.get(left[0]) ?? 10000;
            const rightOrder = groupOrder.get(right[0]) ?? 10000;
            return leftOrder - rightOrder || left[0].localeCompare(right[0]);
        });

        const gap = 90;
        let cursor = 40;
        let maxCross = 0;
        for (const [groupId, members] of orderedGroups) {
            const sorted = sortNodesForGroup(members, edges);
            const columns = sorted.length > 8 ? 2 : 1;
            const rows = Math.ceil(sorted.length / columns);
            const cellWidth = Math.max(230, ...sorted.map((node) => sizes.get(node.id).width)) + 26;
            const rowHeight = Math.max(92, ...sorted.map((node) => sizes.get(node.id).height)) + 22;
            const width = columns * cellWidth + 32;
            const height = Math.max(128, rows * rowHeight + 62);
            const group = groups.find((candidate) => candidate.id === groupId) || {
                id: groupId,
                label: titleCase(groupId),
                description: ''
            };
            const x = direction === 'TB' ? 40 : cursor;
            const y = direction === 'TB' ? cursor : 40;
            groupLayouts.push({ ...group, x, y, width, height });

            sorted.forEach((node, index) => {
                const column = Math.floor(index / rows);
                const row = index % rows;
                const size = sizes.get(node.id);
                positions.set(node.id, {
                    x: x + 20 + column * cellWidth,
                    y: y + 48 + row * rowHeight,
                    width: size.width,
                    height: size.height
                });
            });

            cursor += (direction === 'TB' ? height : width) + gap;
            maxCross = Math.max(maxCross, direction === 'TB' ? width : height);
        }

        const bounds = computeBounds([...positions.values()], groupLayouts);
        return { positions, groups: groupLayouts, bounds, direction };
    }

    function sortNodesForGroup(nodes, edges) {
        const incoming = new Map(nodes.map((node) => [node.id, 0]));
        for (const edge of edges) {
            if (incoming.has(edge.target) && ['instantiate', 'call', 'data', 'control'].includes(edge.kind)) {
                incoming.set(edge.target, incoming.get(edge.target) + 1);
            }
        }
        const priority = {
            external: 0,
            host: 0,
            package: 1,
            module: 2,
            interface: 3,
            function: 4,
            struct: 5,
            enum: 5,
            type: 5
        };
        return [...nodes].sort((left, right) => {
            if (left.entry !== right.entry) return left.entry ? -1 : 1;
            const leftRoot = incoming.get(left.id) === 0;
            const rightRoot = incoming.get(right.id) === 0;
            if (leftRoot !== rightRoot) return leftRoot ? -1 : 1;
            return (priority[left.kind] ?? 9) - (priority[right.kind] ?? 9)
                || left.label.localeCompare(right.label);
        });
    }

    function layoutByRanks(nodes, edges, sizes, direction, focusId) {
        const positions = new Map();
        const ids = new Set(nodes.map((node) => node.id));
        const relevantEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.kind !== 'import');
        const rank = new Map(nodes.map((node) => [node.id, 0]));
        const incoming = new Map(nodes.map((node) => [node.id, []]));
        const outgoing = new Map(nodes.map((node) => [node.id, []]));
        for (const edge of relevantEdges) {
            incoming.get(edge.target).push(edge.source);
            outgoing.get(edge.source).push(edge.target);
        }

        if (focusId && rank.has(focusId)) rank.set(focusId, 0);
        for (let iteration = 0; iteration < nodes.length; iteration += 1) {
            let changed = false;
            for (const edge of relevantEdges) {
                if (edge.target === focusId) continue;
                const candidate = Math.min(nodes.length - 1, (rank.get(edge.source) || 0) + 1);
                if (candidate > (rank.get(edge.target) || 0)) {
                    rank.set(edge.target, candidate);
                    changed = true;
                }
            }
            if (!changed) break;
        }

        // Collapse pathological cycle ranks while preserving focus-centric structure.
        const maxUsefulRank = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(nodes.length))));
        for (const node of nodes) rank.set(node.id, Math.min(rank.get(node.id) || 0, maxUsefulRank));

        const layers = new Map();
        for (const node of nodes) {
            let value = rank.get(node.id) || 0;
            if (focusId && node.id !== focusId && node.parentId === focusId) {
                if (['rule', 'method', 'function'].includes(node.kind)) value = 1;
                else if (node.primitive || node.kind === 'instance') value = 2;
            }
            if (focusId && node.details?.targetId && node.details.targetId !== focusId) value = Math.max(value, 2);
            if (!layers.has(value)) layers.set(value, []);
            layers.get(value).push(node);
        }

        const orderedRanks = [...layers.keys()].sort((a, b) => a - b);
        let previousOrder = new Map();
        for (const value of orderedRanks) {
            const layer = layers.get(value);
            layer.sort((left, right) => nodePriority(left) - nodePriority(right) || left.label.localeCompare(right.label));
            if (previousOrder.size > 0) {
                layer.sort((left, right) => barycenter(left.id, incoming, previousOrder) - barycenter(right.id, incoming, previousOrder)
                    || nodePriority(left) - nodePriority(right)
                    || left.label.localeCompare(right.label));
            }
            previousOrder = new Map(layer.map((node, index) => [node.id, index]));
        }

        const layerGap = 115;
        const nodeGap = 28;
        let primary = 40;
        let maxCross = 0;
        const layerDimensions = [];
        for (const value of orderedRanks) {
            const layer = layers.get(value);
            const primarySize = Math.max(...layer.map((node) => direction === 'TB' ? sizes.get(node.id).height : sizes.get(node.id).width));
            const crossSize = layer.reduce((sum, node) => sum + (direction === 'TB' ? sizes.get(node.id).width : sizes.get(node.id).height), 0)
                + Math.max(0, layer.length - 1) * nodeGap;
            layerDimensions.push({ value, layer, primary, primarySize, crossSize });
            primary += primarySize + layerGap;
            maxCross = Math.max(maxCross, crossSize);
        }

        for (const layerInfo of layerDimensions) {
            let cross = 40 + (maxCross - layerInfo.crossSize) / 2;
            for (const node of layerInfo.layer) {
                const size = sizes.get(node.id);
                if (direction === 'TB') {
                    positions.set(node.id, { x: cross, y: layerInfo.primary, width: size.width, height: size.height });
                    cross += size.width + nodeGap;
                } else {
                    positions.set(node.id, { x: layerInfo.primary, y: cross, width: size.width, height: size.height });
                    cross += size.height + nodeGap;
                }
            }
        }

        const bounds = computeBounds([...positions.values()], []);
        return { positions, groups: [], bounds, direction };
    }

    function nodePriority(node) {
        const priority = {
            module: 0,
            package: 1,
            interface: 2,
            rule: 3,
            method: 4,
            function: 5,
            instance: 6,
            register: 7,
            fifo: 7,
            memory: 7,
            wire: 7,
            struct: 8,
            enum: 8,
            type: 8
        };
        return priority[node.kind] ?? 9;
    }

    function barycenter(id, incoming, previousOrder) {
        const candidates = (incoming.get(id) || []).map((source) => previousOrder.get(source)).filter(Number.isFinite);
        if (candidates.length === 0) return Number.MAX_SAFE_INTEGER;
        return candidates.reduce((sum, value) => sum + value, 0) / candidates.length;
    }

    function measureNode(node) {
        const labelLength = String(node.label || node.name).length;
        const width = clamp(190 + Math.max(0, labelLength - 18) * 5.2, 190, 286);
        let detailLines = 1;
        if (node.kind === 'module') detailLines = 2;
        else if (node.kind === 'package' || node.kind === 'interface') detailLines = 1;
        else if (node.description) detailLines = 2;
        return { width, height: 64 + detailLines * 14 };
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
            const wrapper = svgElement('g', { class: 'architecture-group' });
            wrapper.append(svgElement('rect', {
                class: 'group-box',
                x: group.x,
                y: group.y,
                width: group.width,
                height: group.height,
                rx: 10,
                ry: 10
            }));
            const title = svgElement('text', { class: 'group-title', x: group.x + 16, y: group.y + 23 });
            title.textContent = group.label;
            wrapper.append(title);
            if (group.description) {
                const description = svgElement('text', { class: 'group-description', x: group.x + 16, y: group.y + 38 });
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
            const route = routeEdge(source, target, state.graph.layout?.direction || 'LR', edge.id);
            const group = svgElement('g', { class: 'edge-group', 'data-edge-id': edge.id });
            const path = svgElement('path', {
                class: `edge ${cssKind(edge.kind)}`,
                d: route.path,
                'data-source': edge.source,
                'data-target': edge.target,
                'marker-end': edge.kind === 'contains' ? 'url(#arrow-muted)' : 'url(#arrow)'
            });
            group.append(path);
            if (edge.label) {
                const label = truncate(edge.label, 30);
                const width = Math.max(30, label.length * 5.5 + 10);
                const background = svgElement('rect', {
                    class: 'edge-label-bg',
                    x: route.labelX - width / 2,
                    y: route.labelY - 9,
                    width,
                    height: 15,
                    rx: 3
                });
                const text = svgElement('text', {
                    class: 'edge-label',
                    x: route.labelX,
                    y: route.labelY + 2,
                    'text-anchor': 'middle',
                    'data-source': edge.source,
                    'data-target': edge.target
                });
                text.textContent = label;
                group.append(background, text);
            }
            elements.edges.append(group);
        }
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
            return {
                path: `M ${sx} ${sy} V ${mid} H ${tx} V ${ty}`,
                labelX: (sx + tx) / 2,
                labelY: mid - 3
            };
        }
        const forward = target.x >= source.x;
        const sx = forward ? source.x + source.width : source.x;
        const sy = source.y + source.height / 2;
        const tx = forward ? target.x : target.x + target.width;
        const ty = target.y + target.height / 2;
        const mid = (sx + tx) / 2 + jitter;
        return {
            path: `M ${sx} ${sy} H ${mid} V ${ty} H ${tx}`,
            labelX: mid,
            labelY: (sy + ty) / 2 - 4
        };
    }

    function renderNodes(nodes, positions) {
        for (const node of nodes) {
            const position = positions.get(node.id);
            if (!position) continue;
            const group = svgElement('g', {
                class: `arch-node kind-${cssKind(node.kind)}`,
                transform: `translate(${position.x} ${position.y})`,
                tabindex: '0',
                role: 'button',
                'aria-label': `${node.kind} ${node.label}`,
                'data-node-id': node.id
            });
            const body = svgElement('rect', {
                class: 'node-body',
                x: 0,
                y: 0,
                width: position.width,
                height: position.height,
                rx: 7,
                ry: 7
            });
            const accent = svgElement('rect', {
                class: 'node-accent',
                x: 0,
                y: 0,
                width: 5,
                height: position.height,
                rx: 3,
                ry: 3
            });
            const kind = svgElement('text', { class: 'node-kind', x: 15, y: 18 });
            kind.textContent = displayKind(node);
            const title = svgElement('text', { class: 'node-title', x: 15, y: 39 });
            title.textContent = truncate(node.label || node.name, Math.floor((position.width - 28) / 7.2));
            const subtitle = svgElement('text', { class: 'node-subtitle', x: 15, y: 56 });
            subtitle.textContent = truncate(nodeSubtitle(node), Math.floor((position.width - 28) / 5.8));
            const detail = svgElement('text', { class: 'node-detail', x: 15, y: 70 });
            detail.textContent = truncate(nodeDetail(node), Math.floor((position.width - 28) / 5.3));
            const inputPort = svgElement('circle', { class: 'node-port', cx: 0, cy: position.height / 2, r: 3.2 });
            const outputPort = svgElement('circle', { class: 'node-port', cx: position.width, cy: position.height / 2, r: 3.2 });
            group.append(body, accent, kind, title, subtitle, detail, inputPort, outputPort);

            group.addEventListener('click', (event) => {
                event.stopPropagation();
                selectNode(node.id, false);
            });
            group.addEventListener('dblclick', (event) => {
                event.stopPropagation();
                drillInto(node.id);
            });
            group.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    openNodeSource(node.id);
                } else if (event.key === ' ') {
                    event.preventDefault();
                    selectNode(node.id, false);
                } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    drillInto(node.id);
                }
            });
            elements.nodes.append(group);
        }
    }

    function displayKind(node) {
        if (node.virtual) return String(node.kind || 'external').toUpperCase();
        if (node.primitive) return `${String(node.kind).toUpperCase()} INSTANCE`;
        return String(node.kind || 'node').toUpperCase();
    }

    function nodeSubtitle(node) {
        if (node.kind === 'package') return node.relativePath || 'package';
        if (node.kind === 'module') return node.details?.returnInterface || node.packageName || 'module';
        if (node.kind === 'interface') return `${node.details?.methods?.length || 0} methods`;
        if (node.kind === 'rule') return node.details?.guard ? `guard: ${node.details.guard}` : 'unguarded rule';
        if (node.kind === 'method') return node.details?.returnType || 'method';
        if (node.kind === 'function') return node.details?.returnType || 'function';
        if (node.primitive || node.kind === 'instance') return node.details?.constructor || node.details?.type || 'instance';
        if (node.packageName) return node.packageName;
        return node.description || '';
    }

    function nodeDetail(node) {
        if (node.kind === 'module') {
            const details = node.details || {};
            return `${details.instanceCount || 0} instances · ${details.ruleCount || 0} rules · ${details.methodCount || 0} methods`;
        }
        if (node.kind === 'package') {
            const details = node.details || {};
            return `${details.modules || 0} modules · ${details.functions || 0} functions · ${details.types || 0} types`;
        }
        if (node.kind === 'function') {
            const operations = node.details?.operations || [];
            return operations.length ? operations.join(' · ') : `${node.details?.parameters?.length || 0} parameters`;
        }
        if (node.description) return node.description;
        if (node.relativePath && !['package'].includes(node.kind)) return node.relativePath;
        return '';
    }

    function renderBreadcrumbs() {
        elements.breadcrumbs.replaceChildren();
        const rootLabel = state.mode === 'file'
            ? (state.activeFile?.split('/').pop() || 'Current file')
            : 'System';
        appendBreadcrumb(rootLabel, -1);
        for (let index = 0; index < state.focusStack.length; index += 1) {
            const node = nodeById(state.focusStack[index]);
            if (!node) continue;
            const separator = document.createElement('span');
            separator.className = 'breadcrumb-separator';
            separator.textContent = '›';
            elements.breadcrumbs.append(separator);
            appendBreadcrumb(node.label || node.name, index);
        }
    }

    function appendBreadcrumb(label, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'breadcrumb';
        button.textContent = label;
        button.title = label;
        button.addEventListener('click', () => {
            state.focusStack = index < 0 ? [] : state.focusStack.slice(0, index + 1);
            state.selectedId = state.focusStack.at(-1) || null;
            state.fitOnNextRender = true;
            render();
            persistState();
        });
        elements.breadcrumbs.append(button);
    }

    function renderInspector() {
        const node = nodeById(state.selectedId);
        if (!node || !state.graph.nodes.some((candidate) => candidate.id === node.id)) {
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

        if (node.description) {
            const description = document.createElement('p');
            description.className = 'inspector-description';
            description.textContent = node.description;
            content.append(description);
        }

        const path = document.createElement('p');
        path.className = 'inspector-path';
        path.textContent = [node.packageName, node.relativePath, formatLocation(node.location)].filter(Boolean).join(' · ');
        if (path.textContent) content.append(path);

        const actions = document.createElement('div');
        actions.className = 'inspector-actions';
        if (node.location?.uri) {
            actions.append(makeButton('Open source', () => openNodeSource(node.id), 'primary'));
        }
        if (canDrill(node)) {
            actions.append(makeButton(drillLabel(node), () => drillInto(node.id)));
        }
        actions.append(makeButton('Copy ID', async () => {
            await navigator.clipboard.writeText(node.id);
            showToast('Architecture node ID copied.');
        }));
        actions.append(makeButton('Copy SVG', () => {
            const svg = serializeSvg();
            vscode.postMessage({ type: 'copySvg', svg });
        }));
        content.append(actions);

        if (node.signature) {
            const section = inspectorSection('Signature');
            const code = document.createElement('pre');
            code.className = 'inspector-code';
            code.textContent = node.signature;
            section.append(code);
            content.append(section);
        }

        const details = flattenDetails(node.details || {});
        if (details.length > 0) {
            const section = inspectorSection('Details');
            const list = document.createElement('dl');
            list.className = 'detail-grid';
            for (const [key, value] of details) {
                const term = document.createElement('dt');
                term.textContent = titleCase(key);
                const definition = document.createElement('dd');
                definition.textContent = value;
                list.append(term, definition);
            }
            section.append(list);
            content.append(section);
        }

        const relations = relationshipsFor(node.id);
        if (relations.length > 0) {
            const section = inspectorSection('Relationships');
            const list = document.createElement('div');
            list.className = 'relation-list';
            for (const relation of relations.slice(0, 24)) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'relation-button';
                const kindText = document.createElement('span');
                kindText.className = 'relation-kind';
                kindText.textContent = relation.direction === 'out' ? `→ ${relation.edge.kind}` : `← ${relation.edge.kind}`;
                const name = document.createElement('span');
                name.className = 'relation-name';
                name.textContent = relation.node?.label || relation.node?.name || relation.nodeId;
                button.append(kindText, name);
                button.addEventListener('click', () => navigateToRelated(relation.nodeId));
                list.append(button);
            }
            section.append(list);
            content.append(section);
        }

        elements.inspector.replaceChildren(content);
    }

    function inspectorSection(titleText) {
        const section = document.createElement('section');
        section.className = 'inspector-section';
        const heading = document.createElement('h3');
        heading.textContent = titleText;
        section.append(heading);
        return section;
    }

    function makeButton(label, listener, className = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', listener);
        return button;
    }

    function flattenDetails(details) {
        const hidden = new Set(['calls', 'references', 'methods', 'subinterfaces', 'locals', 'parameters', 'operations', 'returns', 'targetId']);
        const entries = [];
        for (const [key, value] of Object.entries(details)) {
            if (hidden.has(key) || value === null || value === undefined || value === '') continue;
            if (Array.isArray(value)) {
                if (value.length === 0) continue;
                const rendered = value.map((item) => typeof item === 'string' ? item : item.name || item.value || JSON.stringify(item)).join(', ');
                entries.push([key, truncate(rendered, 220)]);
            } else if (typeof value === 'object') {
                entries.push([key, truncate(JSON.stringify(value), 220)]);
            } else {
                entries.push([key, String(value)]);
            }
        }
        const arrayDetails = [
            ['parameters', details.parameters],
            ['operations', details.operations],
            ['calls', details.calls],
            ['references', details.references]
        ];
        for (const [key, value] of arrayDetails) {
            if (!Array.isArray(value) || value.length === 0) continue;
            const rendered = value.map((item) => typeof item === 'string' ? item : item.name || item.value || item.type || JSON.stringify(item)).join(', ');
            entries.push([key, truncate(rendered, 260)]);
        }
        return entries.slice(0, 18);
    }

    function relationshipsFor(nodeId) {
        const relations = [];
        for (const edge of state.model?.edges || []) {
            if (edge.source === nodeId) relations.push({ direction: 'out', edge, nodeId: edge.target, node: nodeById(edge.target) });
            else if (edge.target === nodeId) relations.push({ direction: 'in', edge, nodeId: edge.source, node: nodeById(edge.source) });
        }
        const priority = { instantiate: 0, implements: 1, data: 2, control: 2, call: 3, access: 4, contains: 5, import: 6 };
        return relations.sort((left, right) => (priority[left.edge.kind] ?? 9) - (priority[right.edge.kind] ?? 9)
            || (left.node?.label || '').localeCompare(right.node?.label || ''));
    }

    function navigateToRelated(nodeId) {
        const visible = state.graph.nodes.some((node) => node.id === nodeId);
        if (visible) {
            selectNode(nodeId, true);
            return;
        }
        const node = nodeById(nodeId);
        if (!node) return;
        state.focusStack.push(node.id);
        state.selectedId = node.id;
        state.fitOnNextRender = true;
        render();
        persistState();
    }

    function canDrill(node) {
        if (node.details?.targetId) return true;
        return state.model.nodes.some((candidate) => candidate.parentId === node.id)
            || ['package', 'module', 'function', 'rule', 'method'].includes(node.kind);
    }

    function drillLabel(node) {
        return node.details?.targetId ? `Open ${node.details.targetName || 'implementation'}` : 'Drill down';
    }

    function drillInto(nodeId) {
        const node = nodeById(nodeId);
        if (!node) return;
        const targetId = node.details?.targetId || node.id;
        const target = nodeById(targetId);
        if (!target) {
            openNodeSource(nodeId);
            return;
        }
        if (!canDrill(target) && target.id === node.id) {
            openNodeSource(nodeId);
            return;
        }
        if (state.focusStack.at(-1) !== target.id) state.focusStack.push(target.id);
        state.selectedId = target.id;
        state.fitOnNextRender = true;
        render();
        persistState();
    }

    function selectNode(nodeId, center) {
        state.selectedId = nodeId;
        renderInspector();
        applySelectionHighlight();
        if (center) centerNode(nodeId);
        persistState();
    }

    function openNodeSource(nodeId) {
        const node = nodeById(nodeId);
        if (!node?.location?.uri) {
            showToast('This element has no source location.', true);
            return;
        }
        vscode.postMessage({ type: 'openSource', nodeId });
    }

    function applySelectionHighlight() {
        const selected = state.selectedId;
        const connected = new Set();
        if (selected) {
            connected.add(selected);
            for (const edge of state.graph.edges) {
                if (edge.source === selected) connected.add(edge.target);
                if (edge.target === selected) connected.add(edge.source);
            }
        }

        for (const element of elements.nodes.querySelectorAll('.arch-node')) {
            const id = element.dataset.nodeId;
            element.classList.toggle('selected', id === selected);
            element.classList.toggle('connected', selected && connected.has(id) && id !== selected);
            element.classList.toggle('selection-dimmed', Boolean(selected) && !connected.has(id));
        }
        for (const path of elements.edges.querySelectorAll('.edge')) {
            const isConnected = selected && (path.dataset.source === selected || path.dataset.target === selected);
            path.classList.toggle('connected', Boolean(isConnected));
            path.classList.toggle('selection-dimmed', Boolean(selected) && !isConnected);
        }
        updateCombinedDimming();
    }

    function applySearchHighlight() {
        const query = state.search;
        for (const element of elements.nodes.querySelectorAll('.arch-node')) {
            const node = nodeById(element.dataset.nodeId);
            element.classList.toggle('search-dimmed', Boolean(query) && !nodeMatchesSearch(node, query));
        }
        for (const path of elements.edges.querySelectorAll('.edge')) {
            const source = nodeById(path.dataset.source);
            const target = nodeById(path.dataset.target);
            const match = nodeMatchesSearch(source, query) || nodeMatchesSearch(target, query);
            path.classList.toggle('search-dimmed', Boolean(query) && !match);
        }
        updateCombinedDimming();
    }

    function updateCombinedDimming() {
        for (const element of elements.nodes.querySelectorAll('.arch-node')) {
            element.classList.toggle('dimmed', element.classList.contains('selection-dimmed') || element.classList.contains('search-dimmed'));
        }
        for (const path of elements.edges.querySelectorAll('.edge')) {
            path.classList.toggle('dimmed', path.classList.contains('selection-dimmed') || path.classList.contains('search-dimmed'));
        }
    }

    function nodeMatchesSearch(node, query) {
        if (!query) return true;
        if (!node) return false;
        return [node.label, node.name, node.kind, node.packageName, node.relativePath, node.description, node.signature]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query));
    }

    function updateHeader() {
        elements.title.textContent = state.model.title || 'BSV Architecture';
        updateSubtitle();
        const shown = state.graph.nodes.length;
        elements.stats.textContent = `${shown}/${state.model.stats.nodes} nodes · ${state.graph.edges.length} edges · ${state.model.stats.files} files`;
        const diagnostics = state.model.diagnostics || [];
        const errors = diagnostics.filter((item) => item.severity === 'error').length;
        const warnings = diagnostics.filter((item) => item.severity === 'warning').length;
        elements.diagnostics.textContent = errors || warnings ? `${errors} errors · ${warnings} warnings` : 'No parser diagnostics';
        elements.diagnostics.title = diagnostics.slice(0, 10).map((item) => item.message).join('\n');
    }

    function updateSubtitle() {
        if (!state.model) return;
        const focus = nodeById(state.focusStack.at(-1));
        const context = focus
            ? `${displayKind(focus)} · ${focus.label || focus.name}`
            : state.mode === 'file'
                ? (state.activeFile || 'Current BSV file')
                : `${state.model.workspaceName || 'Workspace'} · generated ${formatTimestamp(state.model.generatedAt)}`;
        elements.subtitle.textContent = context;
    }

    function fitDiagram(announce) {
        const bounds = state.graph.layout?.bounds;
        if (!bounds || bounds.width <= 1 || bounds.height <= 1) return;
        const rect = elements.svg.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) return;
        const padding = 54;
        const scale = clamp(Math.min((rect.width - padding * 2) / bounds.width, (rect.height - padding * 2) / bounds.height), 0.12, 1.35);
        state.transform.scale = scale;
        state.transform.x = (rect.width - bounds.width * scale) / 2 - bounds.x * scale;
        state.transform.y = (rect.height - bounds.height * scale) / 2 - bounds.y * scale;
        applyTransform();
        persistState();
        if (announce) showToast('Diagram fitted to the canvas.');
    }

    function centerNode(nodeId) {
        const position = state.graph.layout?.positions.get(nodeId);
        if (!position) return;
        const rect = elements.svg.getBoundingClientRect();
        state.transform.x = rect.width / 2 - (position.x + position.width / 2) * state.transform.scale;
        state.transform.y = rect.height / 2 - (position.y + position.height / 2) * state.transform.scale;
        applyTransform();
    }

    function zoomAtCenter(factor) {
        const rect = elements.svg.getBoundingClientRect();
        zoomAt(factor, rect.width / 2, rect.height / 2);
    }

    function zoomAt(factor, clientX, clientY) {
        const previous = state.transform.scale;
        const next = clamp(previous * factor, 0.08, 3.5);
        const worldX = (clientX - state.transform.x) / previous;
        const worldY = (clientY - state.transform.y) / previous;
        state.transform.scale = next;
        state.transform.x = clientX - worldX * next;
        state.transform.y = clientY - worldY * next;
        applyTransform();
        persistState();
    }

    function applyTransform() {
        elements.viewport.setAttribute('transform', `translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.scale})`);
    }

    function onWheel(event) {
        event.preventDefault();
        const rect = elements.svg.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        zoomAt(Math.exp(-event.deltaY * 0.0015), x, y);
    }

    function onPointerDown(event) {
        if (event.button !== 0 || event.target.closest('.arch-node')) return;
        state.pointer = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: state.transform.x,
            originY: state.transform.y
        };
        elements.svg.setPointerCapture(event.pointerId);
        elements.svg.classList.add('panning');
        state.selectedId = null;
        renderInspector();
        applySelectionHighlight();
    }

    function onPointerMove(event) {
        if (!state.pointer || event.pointerId !== state.pointer.id) return;
        state.transform.x = state.pointer.originX + event.clientX - state.pointer.startX;
        state.transform.y = state.pointer.originY + event.clientY - state.pointer.startY;
        applyTransform();
    }

    function onPointerUp(event) {
        if (!state.pointer || event.pointerId !== state.pointer.id) return;
        try {
            elements.svg.releasePointerCapture(event.pointerId);
        } catch {
            // Pointer capture may already have been released by the host.
        }
        state.pointer = null;
        elements.svg.classList.remove('panning');
        persistState();
    }

    function onCanvasKeyDown(event) {
        if (event.target.closest('.arch-node')) return;
        if (event.key === '0') {
            event.preventDefault();
            fitDiagram(true);
        } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomAtCenter(1.18);
        } else if (event.key === '-') {
            event.preventDefault();
            zoomAtCenter(1 / 1.18);
        } else if (event.key === 'Escape' || (event.altKey && event.key === 'ArrowLeft')) {
            event.preventDefault();
            navigateBack();
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            elements.search.focus();
        }
    }

    function navigateBack() {
        if (state.focusStack.length === 0) return;
        state.focusStack.pop();
        state.selectedId = state.focusStack.at(-1) || null;
        state.fitOnNextRender = true;
        render();
        persistState();
    }

    function requestSvgExport() {
        const svg = serializeSvg();
        const focus = nodeById(state.focusStack.at(-1));
        const base = focus?.label || state.model?.title || 'bsv-architecture';
        vscode.postMessage({
            type: 'exportSvg',
            svg,
            suggestedName: `${safeName(base)}.svg`
        });
    }

    function serializeSvg() {
        const bounds = state.graph.layout?.bounds || { x: 0, y: 0, width: 100, height: 100 };
        const padding = 28;
        const width = Math.ceil(bounds.width + padding * 2);
        const height = Math.ceil(bounds.height + padding * 2);
        const clone = elements.svg.cloneNode(true);
        clone.removeAttribute('tabindex');
        clone.setAttribute('xmlns', NS);
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
        clone.setAttribute('role', 'img');
        clone.setAttribute('aria-label', state.model?.title || 'BSV architecture diagram');
        const viewport = clone.querySelector('#viewport');
        viewport.setAttribute('transform', `translate(${padding - bounds.x} ${padding - bounds.y})`);
        for (const element of clone.querySelectorAll('[tabindex], [data-node-id], [data-edge-id], [data-source], [data-target]')) {
            element.removeAttribute('tabindex');
            element.removeAttribute('data-node-id');
            element.removeAttribute('data-edge-id');
            element.removeAttribute('data-source');
            element.removeAttribute('data-target');
        }
        for (const element of clone.querySelectorAll('.dimmed, .connected, .selected, .selection-dimmed, .search-dimmed')) {
            element.classList.remove('dimmed', 'connected', 'selected', 'selection-dimmed', 'search-dimmed');
        }
        const style = document.createElementNS(NS, 'style');
        style.textContent = exportStyles();
        clone.insertBefore(style, clone.firstChild);
        return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
    }

    function exportStyles() {
        return `
            #architecture-canvas { background: #ffffff; }
            .group-box { fill: #f7f8fa; stroke: #9aa4b2; stroke-width: 1; stroke-dasharray: 5 4; }
            .group-title { fill: #1f2937; font: 700 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
            .group-description { fill: #667085; font: 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
            .edge { fill: none; stroke: #667085; stroke-width: 1.35; }
            .edge.contains { stroke: #98a2b3; stroke-dasharray: 4 4; }
            .edge.import { stroke: #9b51e0; stroke-dasharray: 7 5; }
            .edge.implements { stroke: #1570ef; stroke-dasharray: 3 3; }
            .edge.call,.edge.access { stroke: #7f56d9; }
            .edge.data,.edge.control,.edge.manual { stroke: #1570ef; stroke-width: 1.8; }
            .edge-label-bg { fill: #ffffff; stroke: #d0d5dd; stroke-width: .7; }
            .edge-label { fill: #667085; font: 9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
            .arrow-head { fill: #667085; } .arrow-head-muted { fill: #98a2b3; }
            .node-body { fill: #ffffff; stroke: #98a2b3; stroke-width: 1.2; }
            .kind-module .node-accent { fill: #f79009; } .kind-package .node-accent { fill: #b54708; }
            .kind-interface .node-accent { fill: #2e90fa; } .kind-function .node-accent,.kind-method .node-accent { fill: #7f56d9; }
            .kind-rule .node-accent { fill: #d92d20; } .kind-register .node-accent { fill: #2e90fa; }
            .kind-fifo .node-accent { fill: #667085; } .kind-memory .node-accent { fill: #039855; }
            .kind-wire .node-accent { fill: #dc6803; } .kind-instance .node-accent { fill: #079455; }
            .kind-struct .node-accent,.kind-enum .node-accent,.kind-type .node-accent { fill: #16a34a; }
            .kind-external .node-accent,.kind-host .node-accent { fill: #7f56d9; }
            .node-title { fill: #101828; font: 700 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
            .node-kind { fill: #667085; font: 700 9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; letter-spacing: .08em; }
            .node-subtitle { fill: #667085; font: 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
            .node-detail { fill: #344054; font: 9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
            .node-port { fill: #ffffff; stroke: #667085; stroke-width: 1; }
        `;
    }

    function persistState() {
        const value = {
            workspaceUri: state.workspaceUri,
            activeFile: state.activeFile,
            mode: state.mode,
            focusStack: state.focusStack,
            selectedId: state.selectedId,
            filters: state.filters,
            transform: state.transform
        };
        vscode.setState(value);
        vscode.postMessage({
            type: 'state',
            state: {
                workspaceUri: state.workspaceUri,
                activeUri: null,
                mode: state.mode,
                focusId: state.focusStack.at(-1) || null
            }
        });
    }

    function nodeById(id) {
        if (!id || !state.model) return null;
        return state.model.nodes.find((node) => node.id === id) || null;
    }

    function formatLocation(location) {
        if (!location || !Number.isInteger(location.line)) return '';
        return `line ${location.line + 1}`;
    }

    function formatTimestamp(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function showToast(message, error = false) {
        if (!message) return;
        clearTimeout(state.toastTimer);
        elements.toast.textContent = message;
        elements.toast.classList.toggle('error', error);
        elements.toast.classList.add('visible');
        state.toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2600);
    }

    function svgElement(name, attributes = {}) {
        const element = document.createElementNS(NS, name);
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
        return element;
    }

    function normalizeTransform(value) {
        return {
            x: Number.isFinite(value?.x) ? value.x : 40,
            y: Number.isFinite(value?.y) ? value.y : 40,
            scale: Number.isFinite(value?.scale) ? clamp(value.scale, 0.08, 3.5) : 1
        };
    }

    function cssKind(value) {
        return String(value || 'node').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    }

    function titleCase(value) {
        return String(value || '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, (character) => character.toUpperCase());
    }

    function truncate(value, length) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (text.length <= length) return text;
        return `${text.slice(0, Math.max(1, length - 1))}…`;
    }

    function safeName(value) {
        return String(value || 'bsv-architecture')
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'bsv-architecture';
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function hashString(value) {
        let hash = 0;
        for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
        return Math.abs(hash);
    }

    function debounce(fn, delay) {
        let timer = null;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }
})();
