'use strict';

(() => {
    const vscode = acquireVsCodeApi();
    const Graph = globalThis.BsvArchitectureGraph;
    const Navigation = globalThis.BsvArchitectureNavigation;
    const SemanticQuery = globalThis.BsvArchitectureSemanticQuery;
    const Text = globalThis.BsvArchitectureText;
    const Layout = globalThis.BsvArchitectureLayout;
    const SourceResolution = globalThis.SourceResolution;
    const NS = 'http://www.w3.org/2000/svg';
    const saved = Navigation.migrateState(Graph.migrateState(vscode.getState() || {}));

    const elements = {
        body: document.body,
        title: document.getElementById('architecture-title'),
        subtitle: document.getElementById('architecture-subtitle'),
        sourceScope: document.getElementById('source-scope'),
        rootField: document.getElementById('root-field'),
        rootLabel: document.getElementById('root-label'),
        rootSelect: document.getElementById('root-select'),
        levelButtons: [...document.querySelectorAll('[data-level]')],
        modeButtons: [...document.querySelectorAll('[data-analysis-mode]')],
        hopButtons: [...document.querySelectorAll('[data-hop]')],
        focusSummary: document.getElementById('focus-summary'),
        focusBack: document.getElementById('focus-back'),
        focusForward: document.getElementById('focus-forward'),
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
        pendingSourceResolution: null,
        editorRevealId: null,
        editorRevealTimer: null,
        selectedEdgeId: null,
        revision: 0,
        navigation: null,
        queries: null,
        clickSequenceSelection: null,
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

    function syncRootSelector() {
        if (!runtime.view) return;
        const roots = runtime.view.architectureRoots();
        elements.rootField.hidden = roots.length < 2;
        elements.rootLabel.textContent = `Architecture Roots: ${roots.length}`;
        elements.rootSelect.replaceChildren();
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'All Roots';
        elements.rootSelect.append(all);
        for (const root of roots) {
            const option = document.createElement('option');
            option.value = root.id;
            option.textContent = root.label || root.name;
            elements.rootSelect.append(option);
        }
        const focusId = viewState().focusStack.at(-1);
        elements.rootSelect.value = runtime.view.rootFor(moduleOwnerId(focusId) || focusId)?.id || '';
        const component = elements.hopButtons.find((button) => button.dataset.hop === 'all');
        const allRoots = !focusId && roots.length > 0;
        component.textContent = allRoots ? 'All Roots' : 'Component';
        component.title = allRoots
            ? 'Show all architecture roots'
            : 'Show the focused semantic component';
    }

    function installEventHandlers() {
        window.addEventListener('message', (event) => handleHostMessage(event.data));
        window.addEventListener('resize', debounce(() => {
            if (runtime.graph.nodes.length === 0) return;
            const anchorId = viewState().selectedId
                || viewState().focusStack.at(-1)
                || runtime.graph.nodes[0]?.id;
            if (anchorId) preserveNodeAnchor(anchorId, { clampToViewport: true });
            runtime.fitOnNextRender = false;
            render();
        }, 140));

        elements.sourceScope.addEventListener('change', () => {
            if (!runtime.view) return;
            const focus = runtime.view.indexes.nodeById.get(viewState().focusStack.at(-1));
            const owner = runtime.view.indexes.nodeById.get(moduleOwnerId(focus?.id));
            const source = owner || focus;
            const outsideCurrentFile = elements.sourceScope.value === 'current-file'
                && viewState().activeFile
                && source?.relativePath !== viewState().activeFile;
            const result = runtime.navigation.setProjection({
                sourceScope: elements.sourceScope.value,
                focusStack: outsideCurrentFile ? [] : viewState().focusStack,
                selectedId: outsideCurrentFile ? null : viewState().selectedId,
                trace: emptyTrace()
            });
            if (result.status !== 'committed') {
                elements.sourceScope.value = viewState().sourceScope;
                showToast('The requested source scope has no exact presentation.', true);
                return;
            }
            finishNavigation();
        });
        elements.rootSelect.addEventListener('change', () => {
            if (!runtime.view) return;
            const rootId = elements.rootSelect.value;
            if (rootId) setFocus(rootId);
            else clearFocus();
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
        elements.focusForward.addEventListener('click', navigateForward);
        elements.clearFocus.addEventListener('click', clearFocus);

        const updateSearch = debounce(() => {
            viewState().search = elements.search.value.trim().toLowerCase();
            applySearchHighlight();
            persistState();
        }, 150);
        elements.search.addEventListener('input', updateSearch);
        elements.search.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const query = elements.search.value.trim().toLowerCase();
                const first = runtime.graph.nodes
                    .filter((node) => nodeMatchesSearch(node, query))
                    .sort((left, right) =>
                        nodeSearchScore(left, query) - nodeSearchScore(right, query)
                        || compareNodes(left, right)
                    )[0];
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
                receiveModel(
                    message.model,
                    message.initial || {},
                    message.revision,
                    message.resetView === true
                );
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
            case 'revealSource':
                revealSourceReference(message.sourceReference, message.revision);
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

    function receiveModel(model, initial, revision, resetView) {
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
                showMethodPorts: defaults.showMethodPorts !== false,
                transform: { x: 40, y: 40, scale: 1 }
            };
        runtime.model = model;
        runtime.queries = SemanticQuery.createSemanticQueries(model);
        elements.restrictedMode.hidden = model?.security?.restrictedMode !== true;
        runtime.view = Graph.createViewModel(model, {
            ...base,
            showMethodPorts: defaults.showMethodPorts !== false,
            workspaceUri: model?.workspaceUri || null,
            activeWorkspace: model?.workspaceUri || null,
            activeFile: initial.activeFile || model?.activeFile || base.activeFile || null
        });
        const state = runtime.view.state;
        runtime.revision = Number.isInteger(revision) ? revision : runtime.revision;
        if (resetView) {
            state.sourceScope = initial.sourceScope || defaults.sourceScope || state.sourceScope;
            state.level = initial.level || defaults.level || state.level;
            state.analysisMode = initial.analysisMode || defaults.analysisMode || state.analysisMode;
            state.hopScope = initial.hopScope || defaults.hopScope || state.hopScope;
            state.focusStack = [];
            state.selectedId = null;
            state.trace = null;
            state.navigationHistory = { back: [], forward: [] };
        }
        if (initial.focusId && runtime.view.indexes.nodeById.has(initial.focusId)) {
            state.focusStack = runtime.view.focusPath(initial.focusId);
            state.selectedId = initial.focusId;
        } else if (state.level !== 'system' && state.focusStack.length === 0) {
            const contextual = runtime.view.indexes.nodeById.get(state.selectedId);
            const initialModule = contextual
                ? runtime.view.indexes.nodeById.get(moduleOwnerId(contextual.id))
                : runtime.view.architectureRoots().length === 1
                    ? runtime.view.architectureRoots()[0]
                    : null;
            if (initialModule) state.focusStack = runtime.view.focusPath(initialModule.id);
        }
        runtime.navigation = Navigation.createIntentController({
            state,
            modelRevision: runtime.revision,
            getNode: (id) => runtime.view.indexes.nodeById.get(id),
            focusPath: (id) => runtime.view.focusPath(id),
            rootFor: (id) => runtime.view.rootFor(id),
            project: navigationProjectionIsValid
        });
        runtime.navigation.reconcileModel(runtime.revision);
        syncRootSelector();
        runtime.transform = state.transform;
        runtime.firstModel = false;
        runtime.fitOnNextRender = resetView
            || !sameWorkspace && !(saved.workspaceUri === model?.workspaceUri && saved.transform);
        initializeControls(state);
        render();
        persistState();
    }

    function navigationProjectionIsValid(candidate) {
        try {
            const projection = Graph.createViewModel(runtime.model, candidate).visible();
            const ids = new Set(projection.nodes.map((node) => node.id));
            if (candidate.analysisContext?.subject?.kind === 'endpoint') {
                const endpoint = runtime.queries.resolveEndpointImplementation(
                    candidate.analysisContext.subject.id
                ).endpoint;
                return Boolean(endpoint && runtime.view.indexes.nodeById.has(candidate.selectedId));
            }
            return projection.nodes.length > 0
                && (!candidate.selectedId || ids.has(candidate.selectedId));
        } catch (_) {
            return false;
        }
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
        const state = viewState();
        let focusStack = state.focusStack;
        if (level !== 'system' && focusStack.length === 0) {
            const ownerId = moduleOwnerId(selectedModelNode()?.id);
            if (ownerId) focusStack = runtime.view.focusPath(ownerId);
            else {
                const roots = runtime.view.architectureRoots();
                if (roots.length !== 1) {
                    showToast('Choose an architecture root before opening this level.');
                    syncPressed(elements.levelButtons, 'level', state.level);
                    return;
                }
                focusStack = runtime.view.focusPath(roots[0].id);
            }
        }
        const result = runtime.navigation.setProjection({
            level,
            focusStack,
            trace: emptyTrace()
        });
        if (result.status !== 'committed') {
            showToast('The requested level has no exact presentation.', true);
            syncPressed(elements.levelButtons, 'level', state.level);
            return;
        }
        finishNavigation();
    }

    function setAnalysisMode(mode) {
        if (!runtime.view) return;
        const result = runtime.navigation.setProjection({
            analysisMode: mode,
            selectedId: null,
            trace: emptyTrace()
        });
        if (result.status !== 'committed') {
            showToast('The requested analysis mode has no exact presentation.', true);
            return;
        }
        runtime.selectedEdgeId = null;
        finishNavigation();
    }

    function setHopScope(scope) {
        if (!runtime.view) return;
        const result = runtime.navigation.setProjection({
            hopScope: scope === 'all' ? 'all' : Number(scope),
            trace: emptyTrace()
        });
        if (result.status !== 'committed') return;
        finishNavigation();
    }

    function syncPressed(buttons, dataKey, value) {
        for (const button of buttons) {
            button.setAttribute('aria-pressed', String(button.dataset[dataKey] === String(value)));
        }
    }

    function updateFilters() {
        if (!runtime.view) return;
        const result = runtime.navigation.setProjection({
            filters: {
                packages: elements.showPackages.checked,
                imports: elements.showImports.checked,
                rules: elements.showRules.checked,
                primitives: elements.showPrimitives.checked
            },
            selectedId: null,
            trace: emptyTrace()
        });
        if (result.status !== 'committed') {
            syncFilterControls(viewState().filters);
            return;
        }
        finishNavigation();
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
        const visibleNodeIds = new Set(visible.nodes.map((node) => node.id));
        const visibleEdgeIds = new Set(visible.edges.map((edge) => edge.id));
        if (viewState().selectedId && !visibleNodeIds.has(viewState().selectedId)) {
            viewState().selectedId = null;
            runtime.navigation?.reconcileModel(runtime.revision);
        }
        if (runtime.selectedEdgeId && !visibleEdgeIds.has(runtime.selectedEdgeId)) {
            runtime.selectedEdgeId = null;
        }
        const grouped = viewState().level === 'system'
            && viewState().analysisMode === 'structure'
            && viewState().focusStack.length === 0;
        const layout = Layout.layoutGraph(visible.nodes, visible.edges, visible.groups, {
            direction: runtime.model.config?.view?.direction || 'LR',
            grouped,
            focusId: viewState().focusStack.at(-1) || null,
            viewport: elements.svg.getBoundingClientRect(),
            viewportWidth: elements.svg.getBoundingClientRect().width,
            viewportHeight: elements.svg.getBoundingClientRect().height,
            level: viewState().level,
            analysisMode: viewState().analysisMode,
            topology: visible.topology,
            layoutModuleHierarchy: Graph.layoutModuleHierarchy
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
        renderCycles(layout.cycles);
        renderHierarchyBus(layout.hierarchyBus);
        renderEdges(visible.edges, layout.positions);
        renderNodes(visible.nodes, layout.positions);
        renderEmptyState();
        renderBreadcrumbs();
        syncRootSelector();
        renderInspector();
        renderNavigationRecovery();
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
                if (anchor.clampToViewport) clampNodeToViewport(position);
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
        result = semanticDetailProjection(result, state);
        let nodes = result.nodes.filter(nodeAllowed);
        const ids = new Set(nodes.map((node) => node.id));
        let edges = result.edges
            .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
            .filter(edgeAllowed);
        const finalIds = new Set(nodes.map((node) => node.id));
        edges = edges.filter((edge) => finalIds.has(edge.source) && finalIds.has(edge.target));
        const groupIds = new Set(nodes.map((node) => node.group || 'root'));
        const groups = result.level === 'system'
            ? (runtime.model.groups || []).filter((group) => groupIds.has(group.id))
            : [];
        return { ...result, nodes, edges, groups };
    }

    function semanticDetailProjection(result, state) {
        const subject = state.analysisContext?.subject;
        if (!['protocol-channel', 'endpoint'].includes(subject?.kind)) return result;
        const endpointId = subject.kind === 'endpoint' ? subject.id : null;
        const endpointResult = endpointId
            ? runtime.queries.resolveEndpointImplementation(endpointId)
            : null;
        const composition = endpointResult?.endpoint
            ? runtime.queries.getInstanceComposition(endpointResult.endpoint.ownerInstanceId)
            : null;
        const channelId = subject.kind === 'protocol-channel'
            ? subject.id
            : composition?.channels.find((channel) =>
                runtime.queries.getChannelMembers(channel.id).members
                    ?.some((member) => member.endpoint.id === endpointId)
            )?.id;
        const queried = channelId && runtime.queries.getChannelMembers(channelId);
        if (queried?.status !== 'exact') return result;
        const channelNode = runtime.view.indexes.nodeById.get(channelId);
        const ownerNode = runtime.view.indexes.nodeById.get(queried.channel.ownerInstanceId);
        const members = queried.members.map((member) => ({
            ...member,
            node: runtime.view.indexes.nodeById.get(member.endpoint.id)
        })).filter((member) => member.node);
        if (!channelNode || !ownerNode) return result;
        const groupId = `member-group:${ownerNode.id}:semantic-channel-detail`;
        const sourceIds = [channelNode.id, ...members.map((member) => member.node.id)];
        const group = {
            id: groupId,
            kind: 'member-group',
            label: `${queried.channel.name} Channel Detail`,
            parentId: ownerNode.id,
            ownerId: ownerNode.id,
            bucket: 'protocol-channels',
            collapsed: false,
            totalCount: sourceIds.length,
            visibleCount: sourceIds.length,
            sourceIds,
            synthetic: true
        };
        const edges = [viewDetailEdge(ownerNode.id, groupId, 'contains')];
        for (const id of sourceIds) edges.push(viewDetailEdge(groupId, id, 'contains'));
        return {
            ...result,
            focusId: ownerNode.id,
            nodes: [ownerNode, group, channelNode, ...members.map((member) => member.node)],
            edges
        };
    }

    function viewDetailEdge(source, target, kind) {
        return {
            id: `semantic-detail:${source}:${target}`,
            source,
            target,
            kind,
            mode: 'structure',
            origin: 'view-model',
            evidence: `${source} ${kind} ${target}`,
            inferred: true,
            layoutOnly: true,
            suppressLabel: true
        };
    }

    function nodeAllowed(node) {
        return Graph.nodeAllowedByFilters(
            node,
            viewState().filters,
            viewState().analysisMode
        );
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

    function renderGroups(groups) {
        for (const group of groups) {
            const wrapper = svgElement('g', {
                class: `architecture-group${group.kind ? ` kind-${cssKind(group.kind)}` : ''}`,
                'data-owner-id': group.ownerId || ''
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

    function renderCycles(cycles = []) {
        for (const cycle of cycles) {
            const bounds = cycle.bounds;
            const group = svgElement('g', {
                class: 'cycle-overlay',
                'data-cycle-id': cycle.id,
                role: 'group',
                'aria-label': `Scheduling cycle with ${cycle.members.length} members`
            });
            group.append(
                svgElement('rect', {
                    class: 'cycle-region',
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    rx: 12,
                    ry: 12
                }),
                textElement(
                    'cycle-label',
                    bounds.x + 12,
                    bounds.y + 17,
                    `Scheduling cycle · ${cycle.members.length} members`
                )
            );
            elements.groups.append(group);
        }
    }

    function renderEdges(edges, positions) {
        const cycleEdges = new Set((runtime.graph.layout?.cycles || []).flatMap((cycle) => cycle.edgeIds));
        const direction = runtime.graph.layout?.direction || 'LR';
        const sameRankLanes = assignSameRankLanes(edges, positions, direction);
        const occupiedLabels = [];
        for (const edge of edges) {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) continue;
            const hierarchyRoute = runtime.graph.layout?.edgeRoutes?.get(edge.id);
            if (edge.origin === 'view-model' && !hierarchyRoute) continue;
            const route = hierarchyRoute || routeEdge(
                source,
                target,
                direction,
                edge.id,
                sameRankLanes.get(edge.id)
            );
            const group = svgElement('g', {
                class: `edge-group${cycleEdges.has(edge.id) ? ' cycle-edge' : ''}`,
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
                const label = truncate(
                    edge.label || titleCase(edge.kind),
                    edge.kind === 'interface-forward' ? 72 : 34
                );
                const width = Math.max(34, Text.displayWidth(label) * 5.5 + 10);
                const proposedLabelX = route.labelOutside === 'right'
                    ? route.labelBoundary + 8 + width / 2
                    : route.labelX;
                const labelX = route.bounds
                    ? Math.max(route.bounds.x + width / 2 + 4,
                        Math.min(route.bounds.x + route.bounds.width - width / 2 - 4, proposedLabelX))
                    : proposedLabelX;
                const proposedLabelY = route.labelOutside === 'bottom'
                    ? route.labelBoundary + 17
                    : route.labelY;
                const initialLabelY = route.bounds
                    ? Math.max(route.bounds.y + 10,
                        Math.min(route.bounds.y + route.bounds.height - 10, proposedLabelY))
                    : proposedLabelY;
                const labelY = reserveLabelLane(
                    labelX,
                    initialLabelY,
                    width,
                    occupiedLabels,
                    route.bounds
                );
                group.append(
                    svgElement('rect', {
                        class: 'edge-label-bg',
                        x: labelX - width / 2,
                        y: labelY - 9,
                        width,
                        height: 15,
                        rx: 3
                    }),
                    textElement('edge-label', labelX, labelY + 2, label, { 'text-anchor': 'middle' })
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

    function reserveLabelLane(x, y, width, occupied, bounds) {
        for (let attempt = 0; attempt < 64; attempt += 1) {
            const offset = attempt === 0
                ? 0
                : Math.ceil(attempt / 2) * 19 * (attempt % 2 ? 1 : -1);
            const candidateY = y + offset;
            const box = {
                left: x - width / 2 - 3,
                right: x + width / 2 + 3,
                top: candidateY - 10,
                bottom: candidateY + 9
            };
            if (bounds && (box.top < bounds.y || box.bottom > bounds.y + bounds.height)) continue;
            if (occupied.every((other) =>
                box.right <= other.left
                || box.left >= other.right
                || box.bottom <= other.top
                || box.top >= other.bottom
            )) {
                occupied.push(box);
                return candidateY;
            }
        }
        return y;
    }

    function renderHierarchyBus(bus) {
        if (!bus?.path) return;
        elements.edges.append(svgElement('path', {
            class: 'hierarchy-bus',
            d: bus.path,
            role: 'presentation'
        }));
    }

    function assignSameRankLanes(edges, positions, direction) {
        const groups = new Map();
        for (const edge of edges) {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) continue;
            const sameRank = direction === 'TB'
                ? Math.abs(source.y - target.y) < 1
                : Math.abs(source.x - target.x) < 1;
            if (!sameRank) continue;
            const key = String(Math.round(direction === 'TB' ? source.y : source.x));
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(edge);
        }
        const lanes = new Map();
        for (const group of groups.values()) {
            group.sort((left, right) => compareText(left.id, right.id))
                .forEach((edge, index) => lanes.set(edge.id, index));
        }
        return lanes;
    }

    function routeEdge(source, target, direction, seed, sameRankLane) {
        const jitter = (hashString(seed) % 17) - 8;
        if (direction === 'TB') {
            if (Number.isInteger(sameRankLane)) {
                const sx = source.x + source.width / 2;
                const sy = source.y + source.height;
                const tx = target.x + target.width / 2;
                const ty = target.y + target.height;
                const lane = Math.max(sy, ty) + 24 + sameRankLane * 18;
                return {
                    path: `M ${sx} ${sy} V ${lane} H ${tx} V ${ty}`,
                    labelX: (sx + tx) / 2 + sameRankLane * 18,
                    labelY: lane - 4,
                    labelOutside: 'bottom',
                    labelBoundary: Math.max(sy, ty)
                };
            }
            const forward = target.y >= source.y;
            const sx = source.x + source.width / 2;
            const sy = forward ? source.y + source.height : source.y;
            const tx = target.x + target.width / 2;
            const ty = forward ? target.y : target.y + target.height;
            const mid = (sy + ty) / 2 + jitter;
            return { path: `M ${sx} ${sy} V ${mid} H ${tx} V ${ty}`, labelX: (sx + tx) / 2, labelY: mid - 3 };
        }
        if (Number.isInteger(sameRankLane)) {
            const sx = source.x + source.width;
            const sy = source.y + source.height / 2;
            const tx = target.x + target.width;
            const ty = target.y + target.height / 2;
            const lane = Math.max(sx, tx) + 24 + sameRankLane * 18;
            return {
                path: `M ${sx} ${sy} H ${lane} V ${ty} H ${tx}`,
                labelX: lane,
                labelY: (sy + ty) / 2 - 4 + sameRankLane * 18,
                labelOutside: 'right',
                labelBoundary: Math.max(sx, tx)
            };
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
        const disclosures = nodes
            .filter((node) => node.kind === 'member-group' || node.kind === 'instance-group')
            .sort((left, right) => Number(right.kind === 'instance-group') - Number(left.kind === 'instance-group'));
        const controlledRegions = new Map(disclosures.map((node) => {
            const expanded = node.kind === 'member-group'
                ? !node.collapsed
                : Boolean(viewState().expandedAggregations[node.id]);
            const region = svgElement('g', {
                id: controlledRegionId(node.id),
                class: 'controlled-member-region',
                role: 'group',
                'aria-label': `${node.label} members`,
                'aria-hidden': String(!expanded)
            });
            elements.nodes.append(region);
            return [node.id, region];
        }));
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
            if (node.kind === 'member-group') {
                group.setAttribute('aria-expanded', String(!node.collapsed));
                group.setAttribute('aria-controls', controlledRegionId(node.id));
            }
            if (node.kind === 'instance-group') {
                group.setAttribute('aria-expanded', String(Boolean(viewState().expandedAggregations[node.id])));
                group.setAttribute('aria-controls', controlledRegionId(node.id));
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
            const controller = disclosures.find((candidate) => controlsNode(candidate, node));
            (controlledRegions.get(controller?.id) || elements.nodes).append(group);
        }
    }

    function controlsNode(disclosure, node) {
        if (disclosure.id === node.id) return false;
        if (disclosure.kind === 'instance-group') return disclosure.sourceIds.includes(node.id);
        if (disclosure.sourceIds.includes(node.id)) return true;
        return node.kind === 'instance-group'
            && disclosure.bucket === 'child-instances'
            && node.sourceIds.some((id) => disclosure.sourceIds.includes(id));
    }

    function controlledRegionId(nodeId) {
        return `controlled-${encodeURIComponent(nodeId)}`;
    }

    function renderMemberGroup(group, node, position) {
        const chevron = svgElement('path', {
            class: 'group-chevron',
            d: node.collapsed ? 'M 17 19 L 22 24 L 17 29' : 'M 15 21 L 20 26 L 25 21'
        });
        group.append(chevron);
        group.append(textElement('node-title', 35, 25, truncate(node.label, 22)));
        group.append(textElement(
            'bucket-count',
            position.width - 14,
            25,
            `${node.visibleCount}/${node.totalCount} visible`,
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
            if (event.detail === 1) runtime.clickSequenceSelection = viewState().selectedId;
            if (event.detail >= 2) {
                restoreClickSequenceSelection();
                return;
            }
            selectNode(node.id, false);
        });
        group.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            if (!disclosure) drillInto(node.id);
            runtime.clickSequenceSelection = null;
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
            return `${node.label}, ${node.visibleCount} visible of ${node.totalCount} members, ${node.collapsed ? 'collapsed' : 'expanded'}`;
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
        if (node.architectureInstance) {
            return node.details?.targetName || node.details?.constructor || 'unresolved target';
        }
        if (node.primitive || node.kind === 'instance') {
            return node.details?.constructor || node.details?.type || 'instance';
        }
        if (node.kind === 'instance-group') return multiplicityText(node.multiplicity);
        return node.packageName || node.description || '';
    }

    function nodeDetail(node) {
        if (node.architectureInstance && node.details?.root) {
            return `External channels ${node.details.externalChannelCount || 0}`;
        }
        if (node.rootBoundary) return 'Unbound in analyzed source';
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
        elements.focusBack.disabled = state.navigationHistory.back.length === 0;
        elements.focusForward.disabled = state.navigationHistory.forward.length === 0;
        elements.clearFocus.disabled = state.focusStack.length === 0;
    }

    function appendBreadcrumb(label, index) {
        const button = makeButton(label, () => {
            const result = runtime.navigation.navigateBreadcrumb(index);
            if (result.status === 'committed') finishNavigation();
        }, 'breadcrumb');
        button.title = label;
        elements.breadcrumbs.append(button);
    }

    function renderNavigationRecovery() {
        const recovery = viewState().navigationRecovery;
        if (recovery?.status !== 'stale') return;
        const ownerRecovered = recovery.reason === 'subject-missing-owner-recovered';
        elements.revealNoticeText.textContent = ownerRecovered
            ? `${recovery.missingIdentity} is stale after refresh. Recovered its owning instance.`
            : `${recovery.missingIdentity || 'The previous focus'} is stale after refresh. Recovered the workspace view.`;
        elements.revealCurrentView.hidden = true;
        elements.revealNotice.hidden = false;
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
        actions.append(makeButton('Trace from here', () => setTraceStart(node.id)));
        if (viewState().trace.startId && viewState().trace.startId !== node.id) {
            actions.append(makeButton('Trace to here', () => traceTo(node.id)));
        }
        appendDirectionalTraceActions(actions, node);
        actions.append(makeButton('Copy ID', async () => {
            await navigator.clipboard.writeText(node.id);
            showToast('Architecture node ID copied.');
        }));
        content.append(actions);

        const semanticSubject = viewState().analysisContext?.subject;
        if (semanticSubject?.kind === 'protocol-channel' && semanticSubject.id === node.semanticId) {
            renderSemanticChannelDetails(content, semanticSubject.id);
        } else if (semanticSubject?.kind === 'endpoint' && semanticSubject.id === node.semanticId) {
            renderSemanticEndpointDetails(content, semanticSubject.id);
        } else if (node.kind === 'module') {
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
        if (node.architectureInstance) {
            const details = node.details || {};
            const children = (runtime.view.indexes.children.get(node.id) || [])
                .filter((child) => child.architectureInstance);
            content.append(detailSection('Instance hierarchy', [
                ['Target definition', details.targetName],
                ['Path', details.path],
                ['Parent', node.parentId ? nodeLabel(node.parentId) : null],
                ['Constructor', details.constructor || details.targetName],
                ['Children', children.length],
                ['Analysis', 'Source-derived'],
                ['Source evidence', node.sourceEvidence]
            ]));
            if (details.root) {
                content.append(detailSection('Root origin', [
                    ['Root status', rootOriginLabel(node)],
                    ['Reason', details.rootReason === 'configured'
                        ? 'Selected by an analyzed entrypoint configuration.'
                        : details.rootReason === 'uninstantiated'
                            ? 'No analyzed module instantiates this definition.'
                            : 'Source hierarchy cycle prevents a natural root selection.']
                ]));
                renderBoundaryDetails(content, runtime.model.semanticBoundaries?.find((boundary) =>
                    boundary.rootInstanceId === node.id));
            }
        } else if (node.rootBoundary) {
            renderBoundaryDetails(content, runtime.model.semanticBoundaries?.find((boundary) =>
                boundary.rootInstanceId === node.boundaryRootId));
        } else if (node.semanticBehavior) {
            renderSemanticBehaviorDetails(content, node);
        } else if (!['protocol-channel', 'endpoint'].includes(semanticSubject?.kind)) {
            const details = flattenDetails(node.details || {});
            if (details.length) content.append(detailSection('Details', details));
        }
        renderRelationInspector(content, node);
        elements.inspector.replaceChildren(content);
    }

    function renderSemanticChannelDetails(content, channelId) {
        const result = runtime.queries.getChannelMembers(channelId);
        if (result.status !== 'exact') {
            content.append(paragraph('Channel detail is unresolved.', 'inspector-description'));
            return;
        }
        content.append(detailSection('Channel', [
            ['Owner', nodeLabel(result.channel.ownerInstanceId)],
            ['Direction', result.channel.direction],
            ['Payload Type', result.channel.payloadType || 'No payload'],
            ['Provenance', 'Source-derived interface declarations'],
            ['Grouping confidence', 'Heuristic'],
            ['Inference basis', channelInferenceBasis(result.channel.evidence?.rule)]
        ]));
        const members = inspectorSection('Members');
        for (const member of result.members) {
            const row = document.createElement('div');
            row.className = 'relation-list';
            row.append(paragraph(`${member.role} · ${member.endpoint.name} · ${
                member.endpoint.resultType || member.endpoint.parameters?.map((item) => item.type).join(', ') || 'control'
            }`, 'inspector-description'));
            row.append(makeButton(
                `Inspect ${member.endpoint.name} endpoint`,
                () => inspectSemanticEndpoint(member.endpoint)
            ));
            members.append(row);
        }
        content.append(members);
        const evidence = inspectorSection('Source evidence');
        for (const member of result.members) {
            const declaration = member.endpoint.evidence?.declaration;
            if (!declaration) continue;
            const row = document.createElement('div');
            row.className = 'relation-list';
            row.append(paragraph(declaration, 'inspector-description'));
            if (member.endpoint.location?.uri) {
                row.append(makeButton(`Open ${member.endpoint.name} source`, () =>
                    openNodeSource(member.endpoint.id)
                ));
            }
            evidence.append(row);
        }
        content.append(evidence);
    }

    function channelInferenceBasis(rule) {
        if (rule === 'exact-sibling-request-response') {
            return 'Sibling request/response name and type convention';
        }
        return 'Method name and type convention';
    }

    function renderSemanticEndpointDetails(content, endpointId) {
        const result = runtime.queries.resolveEndpointImplementation(endpointId, {
            ownerInstanceId: viewState().analysisContext?.ownerInstanceId
        });
        const endpoint = result.endpoint;
        if (!endpoint) {
            content.append(paragraph('Endpoint detail is unresolved.', 'inspector-description'));
            return;
        }
        const composition = runtime.queries.getInstanceComposition(endpoint.ownerInstanceId);
        const relatedFlows = composition.status === 'exact'
            ? [...composition.relationRoles.payload, ...composition.relationRoles.control,
                ...composition.relationRoles.implementation]
                .filter((flow) => flow.fromEndpointId === endpoint.id || flow.toEndpointId === endpoint.id)
            : [];
        const incoming = relatedFlows.filter((flow) => flow.toEndpointId === endpoint.id);
        const outgoing = relatedFlows.filter((flow) => flow.fromEndpointId === endpoint.id);
        content.append(detailSection('Endpoint', [
            ['Owner', nodeLabel(endpoint.ownerInstanceId)],
            ['Declaration', endpoint.evidence?.declaration],
            ['Role', endpoint.category],
            ['Payload Type', endpoint.resultType || endpoint.parameters?.map((item) => item.type).join(', ') || 'No payload'],
            ['Provenance', endpoint.analysisOrigin || 'Source-derived'],
            ['Implementation', result.status === 'exact'
                ? `${result.behavior.kind} ${result.behavior.name}`
                : 'Unresolved implementation'],
            ['Incoming uses', incoming.length],
            ['Outgoing uses', outgoing.length],
            ['Source evidence', endpoint.evidence?.declaration]
        ]));
        if (result.status === 'exact') {
            content.append(makeButton(
                `Inspect ${endpoint.name} implementation`,
                () => enterEndpointImplementation(result)
            ));
        } else {
            content.append(paragraph('Unresolved implementation', 'inspector-description'));
        }
    }

    function inspectSemanticEndpoint(endpoint) {
        const presentation = runtime.view.indexes.nodeById.get(endpoint.id);
        const subject = { ...endpoint, kind: 'endpoint' };
        const result = presentation
            ? runtime.navigation.inspectEndpoint(subject, presentation.id)
            : { status: 'unresolved' };
        if (result.status === 'committed') finishNavigation();
        else showToast('No exact endpoint presentation is available.', true);
    }

    function enterEndpointImplementation(resolution) {
        if (resolution.status !== 'exact' || !resolution.behavior) return;
        const behavior = runtime.view.indexes.nodeById.get(resolution.behavior.id);
        if (!behavior) {
            showToast('No exact implementation presentation is available.', true);
            return;
        }
        const result = runtime.navigation.enterBehavior(behavior.id, {
            fromSemanticParent: true,
            subject: resolution.behavior
        });
        if (result.status === 'committed') finishNavigation();
    }

    function rootOriginLabel(node) {
        if (node.details?.rootReason === 'configured') return 'Configured Architecture Root';
        if (node.details?.rootReason === 'uninstantiated') return 'Natural Root Candidate';
        return 'Architecture Root Candidate';
    }

    function renderBoundaryDetails(content, boundary) {
        if (!boundary) return;
        const disclosure = document.createElement('details');
        disclosure.className = 'boundary-disclosure';
        const summary = document.createElement('summary');
        const channels = boundary.channels || [];
        summary.textContent = `External channels ${channels.length}`;
        disclosure.append(summary);
        disclosure.append(paragraph('External / workspace boundary. No source-derived parent binding found.'));
        for (const channel of channels) {
            const legs = [...new Set(channel.legs.map((leg) =>
                `${leg.direction === 'inbound' ? 'IN' : 'OUT'} ${leg.payloadType || 'unspecified type'}`))];
            const section = detailSection(channel.name, [
                ['Protocol', channel.direction],
                ['Payload', channel.payloadType],
                ['Boundary transfers', legs.join('; ') || 'Unresolved protocol transfers'],
                ['Status', 'Unbound in analyzed source']
            ]);
            if (runtime.view.indexes.nodeById.has(channel.channelId)) {
                section.append(makeButton('Open source', () => openNodeSource(channel.channelId)));
            }
            disclosure.append(section);
        }
        content.append(disclosure);
        const unmatchedEndpoints = boundary.unmatchedEndpoints || [];
        if (unmatchedEndpoints.length) {
            const unmatched = document.createElement('details');
            unmatched.className = 'boundary-disclosure';
            const heading = document.createElement('summary');
            heading.textContent = `Ungrouped public endpoints ${unmatchedEndpoints.length}`;
            unmatched.append(heading);
            unmatched.append(paragraph('Public endpoints not assigned to an inferred protocol channel.'));
            for (const endpoint of unmatchedEndpoints) {
                unmatched.append(detailSection(endpoint.interfacePath.join('.'), [
                    ['Category', endpoint.category],
                    ['Transfers', endpoint.legs.map((leg) =>
                        `${leg.direction === 'inbound' ? 'IN' : 'OUT'} ${leg.payloadType || 'unspecified type'}`).join('; ')]
                ]));
            }
            content.append(unmatched);
        }
    }

    function renderSemanticBehaviorDetails(container, node) {
        const details = node.details || {};
        const relations = runtime.view.relations(node.id);
        const incoming = relations
            .filter((relation) => relation.direction === 'in')
            .map((relation) => relation.edge);
        const outgoing = relations
            .filter((relation) => relation.direction === 'out')
            .map((relation) => relation.edge);
        const sections = [
            ['Summary', details.summary || node.description],
            ['Guard', details.guard || 'Always eligible'],
            ['Category', details.category],
            ['Return Type', details.returnType],
            ['Inputs', semanticList(details.inputs)],
            ['Outputs', semanticList(details.outputs)],
            ['State reads', semanticList(details.stateReads)],
            ['State writes', semanticList(details.stateWrites)],
            ['Invocations', semanticList(details.invocations)],
            ['Protocol membership', semanticList(details.protocolMembership)],
            ['Upstream', semanticRelations(incoming)],
            ['Downstream', semanticRelations(outgoing)],
            ['Source evidence', semanticList(details.sourceEvidence)]
        ];
        for (const [label, value] of sections) {
            const section = inspectorSection(label);
            section.append(paragraph(value || 'None', 'inspector-description'));
            container.append(section);
        }
    }

    function semanticList(value) {
        if (!Array.isArray(value) || value.length === 0) return 'None';
        return value.map((item) => {
            if (typeof item !== 'object' || item === null) return String(item);
            if (item.name && item.type) return `${item.name}: ${item.type}`;
            return item.name || item.type || item.effect || JSON.stringify(item);
        }).join('\n');
    }

    function semanticRelations(edges) {
        if (!edges.length) return 'None';
        return edges.map((edge) => edge.label || relationSummaryLabel(edge.kind)).join('\n');
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
        const flowEvidence = edge.semanticFlowId
            ? runtime.queries.getFlowEvidence(edge.semanticFlowId)
            : null;
        const causeSlice = flowEvidence?.causeBehaviorId
            ? runtime.queries.getBehaviorSlice(flowEvidence.causeBehaviorId)
            : null;
        content.append(detailSection('Relation', [
            ['Semantic Flow ID', edge.semanticFlowId],
            ['Source', nodeLabel(edge.source)],
            ['Target', nodeLabel(edge.target)],
            ['Kind', edge.kind],
            ['Label', edge.label || '—'],
            ['Direction', edge.bidirectional ? 'Bidirectional' : 'Source to target'],
            ['Producer', flowEvidence?.producer?.endpoint?.name],
            ['Consumer', flowEvidence?.consumer?.endpoint?.name],
            ['Consumer argument', flowEvidence?.mapping?.sourceExpression],
            ['Parameter', flowEvidence?.mapping?.parameterName],
            ['Cause behavior', causeSlice?.behavior?.name || flowEvidence?.causeBehaviorId],
            ['Call site', flowEvidence?.callSiteId],
            ['Payload type', flowEvidence?.mapping?.payloadType],
            ['Provenance', flowEvidence?.provenance?.analysisOrigin],
            ['Source evidence', flowEvidence?.evidenceRefs?.map((item) => item.text).join('\n')],
            ['Evidence', evidenceText(edge.evidence)],
            ['Source location', formatLocation(edge.sourceLocation)],
            ['Compiler location', formatLocation(edge.compilerLocation)]
        ]));
        const actions = document.createElement('div');
        actions.className = 'inspector-actions';
        const evidenceReference = flowEvidence?.evidenceRefs?.find((item) =>
            item.sourceRange?.uri || item.location?.uri
        );
        const location = evidenceReference?.sourceRange || evidenceReference?.location
            || edge.compilerLocation || edge.sourceLocation;
        const evidenceOwnerId = causeSlice?.behavior?.id || edge.source;
        if (location?.uri) actions.append(makeButton('Open evidence', () => {
            vscode.postMessage({
                type: 'openSource',
                nodeId: evidenceOwnerId,
                location,
                modelRevision: runtime.revision,
                revision: runtime.revision,
                context: viewState().analysisContext
            });
        }, 'primary'));
        if (flowEvidence?.producer?.endpoint) actions.append(makeButton('Inspect producer', () =>
            inspectSemanticEndpoint(flowEvidence.producer.endpoint)
        ));
        if (flowEvidence?.consumer?.endpoint) actions.append(makeButton('Inspect consumer', () =>
            inspectSemanticEndpoint(flowEvidence.consumer.endpoint)
        ));
        if (causeSlice?.status === 'exact') actions.append(makeButton('Inspect transfer code', () => {
            const result = runtime.navigation.enterBehavior(causeSlice.behavior.id, {
                subject: causeSlice.behavior,
                entryCallSiteId: flowEvidence.callSiteId,
                bindingEnvironmentId: flowEvidence.flow?.bindingId || null
            });
            if (result.status === 'committed') finishNavigation();
        }));
        if (evidenceReference && causeSlice?.behavior) {
            actions.append(makeButton('Open source evidence', () => {
                vscode.postMessage({
                    type: 'openSource',
                    nodeId: causeSlice.behavior.id,
                    location: evidenceReference.sourceRange || evidenceReference.location,
                    modelRevision: runtime.revision,
                    revision: runtime.revision,
                    context: viewState().analysisContext
                });
            }));
        }
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
            if (typeof value === 'object' && Object.keys(value).length === 0) return [];
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
        if (node.architectureInstance) return `Enter ${node.label || node.name}`;
        return 'Focus';
    }

    function drillInto(nodeId) {
        const node = runtime.graph.byId.get(nodeId) || runtime.view.indexes.nodeById.get(nodeId);
        if (!node) return;
        if (node.kind === 'member-group') {
            preserveNodeAnchor(node.parentId);
            runtime.view.setCollapsed(node.parentId, node.bucket, !node.collapsed);
            runtime.fitOnNextRender = false;
            render();
            elements.nodes.querySelector(`[data-node-id="${cssEscape(node.id)}"]`)?.focus();
            persistState();
            return;
        }
        if (node.kind === 'instance-group') {
            preserveNodeAnchor(node.parentId);
            runtime.view.toggleAggregation(node.id);
            runtime.fitOnNextRender = false;
            render();
            elements.nodes.querySelector(`[data-node-id="${cssEscape(node.id)}"]`)?.focus();
            persistState();
            return;
        }
        let result;
        if (node.architectureInstance) result = runtime.navigation.enterInstance(node.id);
        else if (['rule', 'method', 'function'].includes(node.kind)) {
            result = runtime.navigation.enterBehavior(node.id);
        } else if (['protocol-channel', 'endpoint'].includes(node.kind)) {
            if (node.kind === 'protocol-channel') {
                const queried = runtime.queries.getChannelMembers(node.semanticId || node.id);
                result = queried.status === 'exact'
                    ? runtime.navigation.inspectChannel(queried.channel, node.id)
                    : { status: 'unresolved' };
            } else {
                const queried = runtime.queries.resolveEndpointImplementation(node.semanticId || node.id, {
                    ownerInstanceId: viewState().analysisContext?.ownerInstanceId
                });
                result = queried.endpoint
                    ? runtime.navigation.inspectEndpoint({ ...queried.endpoint, kind: 'endpoint' }, node.id)
                    : { status: 'unresolved' };
            }
        } else if (node.kind === 'module') {
            result = runtime.navigation.setProjection({
                level: 'module',
                focusStack: [node.id],
                selectedId: node.id,
                trace: emptyTrace()
            });
        } else result = runtime.navigation.focusEntity(node.id);
        if (result.status === 'committed') finishNavigation();
        else showToast('No exact navigation target is available.', true);
    }

    function preserveNodeAnchor(nodeId, options = {}) {
        const position = runtime.graph.layout?.positions.get(nodeId);
        if (!position) return;
        runtime.anchorAfterRender = {
            nodeId,
            x: runtime.transform.x + position.x * runtime.transform.scale,
            y: runtime.transform.y + position.y * runtime.transform.scale,
            clampToViewport: options.clampToViewport === true
        };
    }

    function clampNodeToViewport(position) {
        const rect = elements.svg.getBoundingClientRect();
        const padding = 16;
        const left = runtime.transform.x + position.x * runtime.transform.scale;
        const top = runtime.transform.y + position.y * runtime.transform.scale;
        const right = left + position.width * runtime.transform.scale;
        const bottom = top + position.height * runtime.transform.scale;
        if (left < padding) runtime.transform.x += padding - left;
        else if (right > rect.width - padding) runtime.transform.x -= right - (rect.width - padding);
        if (top < padding) runtime.transform.y += padding - top;
        else if (bottom > rect.height - padding) runtime.transform.y -= bottom - (rect.height - padding);
    }

    function setFocus(nodeId) {
        if (!runtime.view) return;
        const result = runtime.navigation.focusEntity(nodeId);
        if (result.status === 'committed') finishNavigation();
        else showToast('No exact focus target is available.', true);
    }

    function clearFocus() {
        if (!runtime.view) return;
        const result = runtime.navigation.setProjection({
            focusStack: [],
            selectedId: null,
            trace: emptyTrace()
        });
        if (result.status === 'committed') finishNavigation();
    }

    function navigateBack() {
        if (!runtime.view) return;
        if (runtime.navigation.goBack().status === 'committed') finishNavigation(false);
    }

    function navigateForward() {
        if (!runtime.view) return;
        if (runtime.navigation.goForward().status === 'committed') finishNavigation(false);
    }

    function finishNavigation(fit = true) {
        runtime.selectedEdgeId = null;
        runtime.transform = { ...viewState().transform };
        runtime.fitOnNextRender = fit;
        initializeControls(viewState());
        render();
        persistState();
    }

    function navigateToRelated(nodeId) {
        if (runtime.graph.byId.has(nodeId)) selectNode(nodeId, true);
        else setFocus(moduleOwnerId(nodeId) || nodeId);
    }

    function restoreClickSequenceSelection() {
        const selectedId = runtime.clickSequenceSelection;
        if (selectedId) selectNode(selectedId, false);
        else {
            runtime.navigation.clearSelection();
            runtime.selectedEdgeId = null;
            renderInspector();
            applySelectionHighlight();
            persistState();
        }
    }

    function selectNode(nodeId, center) {
        if (!runtime.view) return;
        const result = runtime.navigation.selectEntity(nodeId);
        if (result.status !== 'committed') return;
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
        const result = runtime.navigation.openSource(nodeId);
        if (result.status === 'effect') vscode.postMessage(result.effect);
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

    function revealSourceReference(sourceReference, revision) {
        if (!runtime.view || Number.isInteger(revision) && revision !== runtime.revision) return;
        const supplied = sourceReference?.references?.[0];
        const range = supplied?.sourceRange || supplied?.location;
        const reference = range?.uri ? {
            uri: range.uri,
            line: range.line,
            column: range.column
        } : supplied?.id || null;
        const resolution = runtime.queries.resolveSourceReference(reference, {
            ownerInstanceId: viewState().analysisContext?.ownerInstanceId
        });
        const candidates = (resolution.references || []).filter((candidate) =>
            runtime.view.indexes.nodeById.has(candidate.id)
        );
        runtime.pendingSourceResolution = resolution;
        runtime.pendingRevealId = null;
        elements.revealNotice.querySelector('.reveal-candidates')?.remove();
        elements.revealNotice.dataset.resolutionStatus = resolution.status;
        if (resolution.status === 'exact' && candidates.length === 1) {
            revealCanonicalReference(candidates[0]);
            return;
        }
        const name = supplied?.name || 'Source selection';
        elements.revealNoticeText.textContent = candidates.length > 1
            ? `${name}: ${candidates.length} semantic matches. Choose an occurrence.`
            : `${name} has no resolved semantic presentation.`;
        elements.revealNotice.hidden = false;
        elements.revealCurrentView.hidden = true;
        elements.revealCurrentView.disabled = true;
        if (candidates.length > 1) {
            const choices = document.createElement('div');
            choices.className = 'reveal-candidates';
            for (const candidate of candidates) {
                const owner = runtime.view.indexes.nodeById.get(candidate.ownerInstanceId);
                choices.append(makeButton(
                    owner?.details?.path || candidate.ownerInstanceId || candidate.id,
                    () => revealCanonicalReference(candidate)
                ));
            }
            elements.revealNotice.append(choices);
        }
    }

    function revealCanonicalReference(reference) {
        elements.revealNotice.hidden = true;
        const node = runtime.view.indexes.nodeById.get(reference.id);
        if (!node) return;
        let result;
        if (['method', 'rule', 'function'].includes(reference.kind)) {
            result = runtime.navigation.enterBehavior(reference.id, {
                subject: reference.entity
            });
        } else if (['method-endpoint', 'subinterface-endpoint', 'endpoint'].includes(reference.kind)) {
            result = runtime.navigation.inspectEndpoint(
                { ...reference.entity, kind: 'endpoint' },
                reference.id
            );
        } else if (node.architectureInstance) {
            result = runtime.navigation.enterInstance(reference.id);
        } else result = runtime.navigation.inspectCode(reference.id);
        if (result.status !== 'committed') return;
        runtime.editorRevealId = reference.id;
        finishNavigation();
        centerNode(reference.id);
        applyEditorReveal();
    }

    function revealPendingNode() {
        const nodeId = runtime.pendingRevealId;
        const node = runtime.view?.indexes.nodeById.get(nodeId);
        if (!node) return;
        const ownerId = moduleOwnerId(nodeId);
        const level = ['rule', 'method', 'function', 'register', 'fifo', 'wire', 'memory'].includes(node.kind)
            ? 'behavior'
            : ['module', 'endpoint', 'protocol-channel'].includes(node.kind) ? 'module' : 'system';
        const filters = { ...viewState().filters };
        if (node.primitive) filters.primitives = true;
        if (['rule', 'method'].includes(node.kind)) filters.rules = true;
        const result = runtime.navigation.setProjection({
            sourceScope: 'workspace',
            level,
            hopScope: 'all',
            focusStack: ownerId ? runtime.view.focusPath(ownerId) : [],
            selectedId: nodeId,
            filters,
            trace: emptyTrace()
        });
        if (result.status !== 'committed') {
            showToast('No exact presentation exists in the current model.', true);
            return;
        }
        runtime.pendingRevealId = null;
        elements.revealNotice.hidden = true;
        runtime.editorRevealId = nodeId;
        finishNavigation();
        centerNode(nodeId);
        applyEditorReveal();
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
        viewState().trace = {
            startId: nodeId,
            targetId: null,
            paths: [],
            semanticPaths: [],
            index: 0,
            truncated: false,
            visitedNodes: 0,
            elapsedMs: 0,
            limitReason: null,
            status: null,
            scope: null,
            uncertainty: null
        };
        updateTraceUi();
        applySelectionHighlight();
        persistState();
        showToast(`Trace start: ${nodeLabel(nodeId)}`);
    }

    function traceTo(targetId) {
        const trace = viewState().trace;
        const result = traceSemanticBetween(trace.startId, targetId);
        trace.targetId = targetId;
        trace.semanticPaths = result.paths;
        trace.paths = result.paths.map((path) => [
            path.fromId,
            ...path.steps.map((step) => step.toId)
        ]);
        trace.index = 0;
        trace.truncated = result.truncated;
        trace.visitedNodes = result.visitedCount;
        trace.elapsedMs = 0;
        trace.limitReason = null;
        trace.status = result.status;
        trace.scope = result.paths[0]?.scope || result.scope || null;
        trace.uncertainty = result.uncertainty || result.paths.find((path) => path.uncertainty)?.uncertainty || null;
        updateTraceUi();
        applySelectionHighlight();
        persistState();
        const messages = {
            unresolved: 'Semantic trace endpoints are unresolved.',
            'no-path': 'No canonical semantic payload path.',
            'search-limit': 'Canonical semantic path search limit reached.'
        };
        const exactMessage = `${result.paths.length} canonical semantic path${
            result.paths.length === 1 ? '' : 's'
        } found${trace.uncertainty ? ` with uncertainty: ${trace.uncertainty}` : '.'}`;
        showToast(messages[result.status] || exactMessage, result.status !== 'exact');
    }

    function traceSemanticBetween(fromId, toId) {
        const direct = runtime.queries.traceSemanticFlow({ fromId, toId });
        if (direct.status === 'exact' || direct.status === 'search-limit') return direct;
        const fromComposition = runtime.queries.getInstanceComposition(fromId);
        const toComposition = runtime.queries.getInstanceComposition(toId);
        if (fromComposition.status !== 'exact' || toComposition.status !== 'exact') return direct;
        const results = [];
        let visitedCount = 0;
        let truncated = false;
        const uncertainty = new Set();
        for (const source of fromComposition.endpoints) {
            for (const target of toComposition.endpoints) {
                const result = runtime.queries.traceSemanticFlow({
                    fromId: source.id,
                    toId: target.id
                });
                visitedCount += result.visitedCount || 0;
                truncated ||= result.truncated === true;
                if (result.uncertainty) uncertainty.add(result.uncertainty);
                if (result.status === 'exact') results.push(...result.paths);
            }
        }
        const paths = [...new Map(results.map((path) => [
            path.steps.map((step) => step.flowId).join('\u0000'), path
        ])).values()];
        return {
            status: paths.length ? 'exact' : truncated ? 'search-limit' : 'no-path',
            paths,
            visitedCount,
            truncated,
            uncertainty: [...uncertainty].join(', ') || null
        };
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
            semanticPaths: [],
            index: 0,
            truncated: false,
            visitedNodes: 0,
            elapsedMs: 0,
            limitReason: null,
            status: paths.length ? 'exact' : 'no-path',
            scope: null,
            uncertainty: null
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

    function emptyTrace() {
        return {
            startId: null,
            targetId: null,
            paths: [],
            semanticPaths: [],
            index: 0,
            truncated: false,
            visitedNodes: 0,
            elapsedMs: 0,
            limitReason: null,
            status: null,
            scope: null,
            uncertainty: null
        };
    }

    function clearTrace(persist = true) {
        if (!runtime.view) return;
        viewState().trace = emptyTrace();
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
        if (count) {
            const semanticSteps = trace.semanticPaths?.[trace.index]?.steps || [];
            const pathEdges = semanticSteps.length ? semanticSteps : activePath.slice(0, -1).map((source, index) =>
                runtime.graph.edges.find((edge) =>
                    edge.source === source && edge.target === activePath[index + 1]
                )
            ).filter(Boolean);
            const payloads = [...new Set(pathEdges
                .map((edge) => edge.mapping?.payloadType || edge.label)
                .filter(Boolean))];
            const payloadNotice = payloads.length
                ? ` · Payload ${payloads.join(', ')}`
                : '';
            const evidenceNotice = pathEdges.some((edge) =>
                edge.sourceLocation || edge.evidence || edge.evidenceRefs?.length
            ) ? ' · Source evidence' : '';
            const limitNotice = trace.truncated ? ' · Canonical query search limit reached' : '';
            const uncertaintyNotice = trace.uncertainty
                ? ` · Uncertainty ${trace.uncertainty}` : '';
            const scope = trace.semanticPaths?.[trace.index]?.scope || trace.scope;
            const scopeNotice = scope
                ? ` · Query scope ${scope.fromRootInstanceId || 'unresolved'} to ${
                    scope.toRootInstanceId || 'unresolved'
                }`
                : '';
            elements.traceSummary.textContent = `Path ${trace.index + 1} of ${count}${
                trace.truncated ? '+' : ''
            } · ${nodeLabel(activePath[0] || trace.startId)} to ${
                nodeLabel(activeTarget)
            }${payloadNotice}${evidenceNotice}${scopeNotice}${uncertaintyNotice}${limitNotice}`;
        } else {
            const statusText = {
                unresolved: 'Semantic trace endpoints are unresolved',
                'no-path': 'No canonical semantic payload path',
                'search-limit': 'Canonical semantic path search limit reached'
            }[trace.status];
            elements.traceSummary.textContent = `Start: ${nodeLabel(trace.startId)}${
                trace.targetId && statusText ? ` · ${statusText}` : ''
            }`;
        }
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
        const semanticDetail = ['protocol-channel', 'endpoint'].includes(
            viewState().analysisContext?.subject?.kind
        );
        if (semanticDetail) {
            for (const node of runtime.graph.nodes) connected.add(node.id);
        }
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
            const connectedEdge = semanticDetail || selected
                && (edge?.source === selected || edge?.target === selected || ownedEdge);
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
            node.description, node.signature, node.details?.targetName,
            node.details?.constructor, node.details?.targetDefinitionId, node.details?.path,
            JSON.stringify(node.ports || [])
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    }

    function nodeSearchScore(node, query) {
        const primary = [node.label, node.name, node.details?.targetName]
            .filter(Boolean)
            .map((value) => String(value).toLowerCase());
        if (primary.some((value) => value === query)) return 0;
        if (primary.some((value) => value.startsWith(query))) return 1;
        if (primary.some((value) => value.includes(query))) return 2;
        return 3;
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
        const roots = runtime.view.architectureRoots();
        const hops = state.hopScope === 'all'
            ? focus || roots.length === 0 ? 'Component' : 'All Roots'
            : `${state.hopScope} hop${state.hopScope === 1 ? '' : 's'}`;
        const instances = runtime.graph.nodes.filter((node) => node.architectureInstance).length;
        const rootCount = runtime.graph.topology?.roots?.length
            || runtime.graph.nodes.filter((node) => node.architectureInstance && node.details?.root).length;
        let counts;
        if (state.analysisMode === 'scheduling') {
            const behaviors = runtime.graph.nodes.filter((node) => node.semanticBehavior
                || ['rule', 'method'].includes(node.kind)).length;
            counts = `${behaviors} behaviors · ${runtime.graph.edges.length} scheduling relations`;
        } else if (state.level === 'system' && roots.length) {
            const relations = runtime.graph.edges.filter((edge) => state.analysisMode !== 'structure'
                || edge.kind === 'instance-child').length;
            counts = `${rootCount} root${rootCount === 1 ? '' : 's'} · ${instances} instances · ${relations} ${state.analysisMode === 'structure' ? 'structural' : 'flow'} relations`;
        } else {
            const channels = runtime.graph.nodes.filter((node) => node.kind === 'protocol-channel').length;
            const behaviors = runtime.graph.nodes.filter((node) => ['rule', 'method'].includes(node.kind)).length;
            const stateCount = runtime.graph.nodes.filter((node) => node.primitive).length;
            counts = `${instances} instances · ${channels} channels · ${behaviors} behaviors · ${stateCount} state instances`;
        }
        elements.focusSummary.textContent = `Focus: ${focusName} · ${titleCase(state.analysisMode)} · ${hops}`;
        elements.stats.textContent = `${counts} · ${runtime.model.stats.files} files`;
        const diagnostics = [...new Map([
            ...(runtime.model.diagnostics || []),
            ...(runtime.model.semanticDiagnostics || []).filter((item) =>
                item.severity !== 'info'
            )
        ].map((item) => [
            `${item.severity}|${item.code || ''}|${item.message}|${formatLocation(item.location)}`,
            item
        ])).values()];
        const errors = diagnostics.filter((item) => item.severity === 'error').length;
        const warnings = diagnostics.filter((item) => item.severity === 'warning').length;
        elements.diagnostics.textContent = errors || warnings
            ? `${errors} errors · ${warnings} warnings`
            : 'No analysis diagnostics';
        elements.diagnostics.classList.toggle('has-issues', Boolean(errors || warnings));
        elements.diagnostics.title = diagnostics.slice(0, 10).map((item) => item.message).join('\n');
    }

    function updateLegend() {
        const scheduling = viewState().analysisMode === 'scheduling';
        elements.scheduleLegend.hidden = !scheduling;
        if (scheduling) elements.scheduleOrigin.textContent = runtime.model.scheduling?.badge || 'SOURCE-DERIVED';
    }

    function fitDiagram(announce, focusId = null) {
        const renderedBounds = elements.viewport.getBBox();
        const layoutBounds = runtime.graph.layout?.bounds;
        const routeOverflow = 96;
        const bounds = layoutBounds && renderedBounds.width > 1 && renderedBounds.height > 1
            ? {
                x: Math.max(renderedBounds.x, layoutBounds.x - routeOverflow),
                y: Math.max(renderedBounds.y, layoutBounds.y - routeOverflow),
                width: Math.min(
                    renderedBounds.x + renderedBounds.width,
                    layoutBounds.x + layoutBounds.width + routeOverflow
                ) - Math.max(renderedBounds.x, layoutBounds.x - routeOverflow),
                height: Math.min(
                    renderedBounds.y + renderedBounds.height,
                    layoutBounds.y + layoutBounds.height + routeOverflow
                ) - Math.max(renderedBounds.y, layoutBounds.y - routeOverflow)
            }
            : layoutBounds || renderedBounds;
        if (!bounds || bounds.width <= 1 || bounds.height <= 1) return;
        const rect = elements.svg.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) return;
        const padding = rect.width < 700 ? 18 : 54;
        runtime.transform.scale = clamp(
            Math.min((rect.width - padding * 2) / bounds.width, (rect.height - padding * 2) / bounds.height),
            0.08,
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
        if (runtime.view) runtime.view.state.transform = { ...runtime.transform };
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
        runtime.navigation.clearSelection();
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
        const renderedBounds = elements.viewport.getBBox();
        const bounds = renderedBounds.width > 1 && renderedBounds.height > 1
            ? renderedBounds
            : runtime.graph.layout?.bounds || { x: 0, y: 0, width: 100, height: 100 };
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
            .cycle-region{fill:#fffaeb;fill-opacity:.35;stroke:#dc6803;stroke-width:1.5;stroke-dasharray:6 4}
            .cycle-label{fill:#b54708;font-size:10px;font-weight:700}.edge-group.cycle-edge .edge{stroke-width:2.4}
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
            search: state.search,
            navigationVersion: state.navigationVersion,
            analysisContext: state.analysisContext,
            navigationHistory: state.navigationHistory,
            navigationRecovery: state.navigationRecovery
        };
        vscode.setState(value);
        vscode.postMessage({ type: 'state', revision: runtime.revision, state: value });
    }

    function moduleOwnerId(id) {
        let node = runtime.view?.indexes.nodeById.get(id);
        if (!node) return null;
        if (node.architectureInstance) return node.id;
        if (node.kind === 'module') return node.id;
        if (node.kind === 'instance' && node.details?.targetId) return node.details.targetId;
        while (node?.parentId) {
            node = runtime.view.indexes.nodeById.get(node.parentId);
            if (node?.architectureInstance || node?.kind === 'module') return node.id;
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
        runtime.navigation.setProjection({
            focusStack: [],
            selectedId: null,
            trace: emptyTrace()
        });
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
        return Text.truncateWidth(value, length);
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
