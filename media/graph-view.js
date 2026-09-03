'use strict';

(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BsvArchitectureGraph = api;
}(typeof globalThis === 'undefined' ? null : globalThis, function createApi() {
    const STATE_VERSION = 3;
    const SOURCE_SCOPES = Object.freeze({ WORKSPACE: 'workspace', CURRENT_FILE: 'current-file' });
    const LEVELS = Object.freeze({ SYSTEM: 'system', MODULE: 'module', BEHAVIOR: 'behavior' });
    const ANALYSIS_MODES = Object.freeze({
        STRUCTURE: 'structure',
        DATA_FLOW: 'data-flow',
        SCHEDULING: 'scheduling'
    });
    const MODE_EDGE_KINDS = Object.freeze({
        structure: new Set(['instantiate', 'implements', 'contains', 'import', 'control', 'structure']),
        'data-flow': new Set(['read', 'write', 'invoke', 'return', 'value', 'producer', 'consumer', 'access', 'call', 'data']),
        scheduling: new Set([
            'conflict', 'conflict-free', 'sequential-before', 'sequential-before-reverse',
            'mutually-exclusive', 'descending-urgency', 'execution-order', 'preempts',
            'potential-state-dependency'
        ])
    });
    const BUCKETS = Object.freeze([
        { kind: 'interfaces', collapsed: false },
        { kind: 'methods', collapsed: true },
        { kind: 'rules', collapsed: true },
        { kind: 'local-functions', collapsed: true },
        { kind: 'state', collapsed: true },
        { kind: 'child-instances', collapsed: false },
        { kind: 'types', collapsed: false }
    ]);
    const STATE_KINDS = new Set(['register', 'fifo', 'memory', 'wire', 'vector']);
    const TYPE_KINDS = new Set(['type', 'enum', 'struct', 'union']);
    const BEHAVIOR_KINDS = new Set(['rule', 'method', 'function']);

    function compareText(left, right) {
        return String(left || '').localeCompare(String(right || ''));
    }

    function compareNodes(left, right) {
        return compareText(left.label || left.name, right.label || right.name)
            || compareText(left.id, right.id);
    }

    function compareEdges(left, right) {
        return compareText(left.id, right.id)
            || compareText(left.source, right.source)
            || compareText(left.target, right.target)
            || compareText(left.kind, right.kind);
    }

    function normalizeSourceScope(value) {
        return ['file', 'current-file', 'currentFile'].includes(value)
            ? SOURCE_SCOPES.CURRENT_FILE
            : SOURCE_SCOPES.WORKSPACE;
    }

    function normalizeLevel(value) {
        const normalized = String(value || '').toLowerCase();
        return Object.values(LEVELS).includes(normalized) ? normalized : LEVELS.SYSTEM;
    }

    function normalizeAnalysisMode(value) {
        const normalized = String(value || '').toLowerCase().replace(/\s+/g, '-');
        if (normalized === 'dataflow') return ANALYSIS_MODES.DATA_FLOW;
        return Object.values(ANALYSIS_MODES).includes(normalized)
            ? normalized
            : ANALYSIS_MODES.STRUCTURE;
    }

    function normalizeHopScope(value) {
        if (value === 'all' || value === 'All' || value === Infinity) return 'all';
        const numeric = Number(value);
        return [1, 2, 3].includes(numeric) ? numeric : 'all';
    }

    function normalizeTransform(value) {
        return {
            x: Number.isFinite(value?.x) ? value.x : 40,
            y: Number.isFinite(value?.y) ? value.y : 40,
            scale: Number.isFinite(value?.scale) ? Math.min(3.5, Math.max(0.08, value.scale)) : 1
        };
    }

    function edgeMode(edge) {
        if (Object.values(ANALYSIS_MODES).includes(edge?.mode)) return edge.mode;
        for (const [mode, kinds] of Object.entries(MODE_EDGE_KINDS)) {
            if (kinds.has(edge?.kind)) return mode;
        }
        return null;
    }

    function buildIndexes(model) {
        const nodes = (model?.nodes || []).filter(Boolean).slice().sort(compareNodes);
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const visibleNodes = nodes.filter((node) => !node.hidden);
        const edges = (model?.edges || [])
            .filter((edge) => edge && nodeById.has(edge.source) && nodeById.has(edge.target))
            .slice()
            .sort(compareEdges);
        const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
        const children = mapOfArrays(nodes.map((node) => node.id));
        const relationsByNode = mapOfArrays(nodes.map((node) => node.id));
        for (const node of nodes) {
            if (node.parentId && children.has(node.parentId)) children.get(node.parentId).push(node);
        }
        for (const edge of edges) {
            relationsByNode.get(edge.source).push({ direction: 'out', edge });
            relationsByNode.get(edge.target).push({ direction: 'in', edge });
        }
        for (const values of children.values()) values.sort(compareNodes);
        for (const values of relationsByNode.values()) values.sort((left, right) => compareEdges(left.edge, right.edge));

        const edgesByMode = new Map();
        const adjacencyByMode = new Map();
        for (const mode of Object.values(ANALYSIS_MODES)) {
            const active = filterEdgesByMode(edges, mode, { nodeById });
            edgesByMode.set(mode, active);
            const adjacency = new Map(nodes.map((node) => [node.id, []]));
            for (const edge of active) {
                adjacency.get(edge.source).push(edge.target);
                adjacency.get(edge.target).push(edge.source);
            }
            for (const [id, values] of adjacency) {
                adjacency.set(id, [...new Set(values)].sort(compareText));
            }
            adjacencyByMode.set(mode, adjacency);
        }
        return {
            nodes,
            visibleNodes,
            edges,
            edgeById,
            nodeById,
            children,
            relationsByNode,
            edgesByMode,
            adjacencyByMode
        };
    }

    function mapOfArrays(keys) {
        return new Map([...keys].map((key) => [key, []]));
    }

    function filterEdgesByMode(edges, mode, indexes = null) {
        const normalized = normalizeAnalysisMode(mode);
        const nodeById = indexes?.nodeById || indexes;
        return (edges || []).filter((edge) => {
            if (edgeMode(edge) !== normalized) return false;
            if (!nodeById?.get) return true;
            return !nodeById.get(edge.source)?.hidden && !nodeById.get(edge.target)?.hidden;
        }).slice().sort(compareEdges);
    }

    function restoreFocus(saved, indexes) {
        const source = Array.isArray(saved)
            ? saved
            : saved?.focusStack || saved?.focusPath || saved?.breadcrumbs
                || (saved?.focusId ? [saved.focusId] : []);
        const result = [];
        const seen = new Set();
        for (const value of source || []) {
            const id = typeof value === 'string' ? value : value?.id || value?.value;
            if (!id || seen.has(id) || indexes && !indexes.nodeById.has(id)) continue;
            seen.add(id);
            result.push(id);
        }
        return result;
    }

    function migrateState(saved, indexes = null) {
        const old = saved && typeof saved === 'object' ? saved : {};
        const collapsedGroups = normalizeCollapsedGroups(old);
        const oldMode = String(old.mode || '').toLowerCase();
        return {
            version: STATE_VERSION,
            workspaceUri: old.workspaceUri || null,
            activeWorkspace: old.activeWorkspace || old.workspaceUri || null,
            activeFile: old.activeFile || null,
            sourceScope: normalizeSourceScope(old.sourceScope || old.scope || oldMode),
            level: normalizeLevel(old.level || (['module', 'behavior'].includes(oldMode) ? oldMode : 'system')),
            analysisMode: normalizeAnalysisMode(old.analysisMode || old.analysis || 'structure'),
            hopScope: normalizeHopScope(old.hopScope ?? old.depth ?? old.hops),
            focusStack: restoreFocus(old, indexes),
            selectedId: old.selectedId || old.selection || null,
            collapseModuleMembers: old.collapseModuleMembers !== false,
            showMethodPorts: old.showMethodPorts !== false,
            collapsedGroups,
            expandedAggregations: { ...(old.expandedAggregations || {}) },
            filters: old.filters && typeof old.filters === 'object' ? { ...old.filters } : {},
            trace: normalizeTrace(old.trace),
            transform: normalizeTransform(old.transform),
            search: typeof old.search === 'string' ? old.search : ''
        };
    }

    function normalizeCollapsedGroups(old) {
        const result = {};
        for (const [moduleId, value] of Object.entries(old.collapsedGroups || {})) {
            if (value && typeof value === 'object') result[moduleId] = { ...value };
        }
        for (const [key, value] of Object.entries(old.collapsedBuckets || old.collapsedMembers || {})) {
            const split = key.lastIndexOf(':');
            if (split < 0) continue;
            const moduleId = key.slice(0, split);
            const bucket = normalizeBucketName(key.slice(split + 1));
            if (!result[moduleId]) result[moduleId] = {};
            result[moduleId][bucket] = Boolean(value);
        }
        for (const moduleId of old.expandedModules || []) {
            if (!result[moduleId]) result[moduleId] = {};
            for (const bucket of BUCKETS) result[moduleId][bucket.kind] = false;
        }
        return result;
    }

    function normalizeTrace(value) {
        if (!value || typeof value !== 'object') {
            return {
                startId: null,
                targetId: null,
                paths: [],
                index: 0,
                truncated: false,
                visitedNodes: 0,
                elapsedMs: 0,
                limitReason: null
            };
        }
        return {
            startId: value.startId || null,
            targetId: value.targetId || null,
            paths: Array.isArray(value.paths) ? value.paths.map((path) => path.slice()) : [],
            index: Number.isInteger(value.index) && value.index >= 0 ? value.index : 0,
            truncated: value.truncated === true,
            visitedNodes: Number.isInteger(value.visitedNodes) ? Math.max(0, value.visitedNodes) : 0,
            elapsedMs: Number.isFinite(value.elapsedMs) ? Math.max(0, value.elapsedMs) : 0,
            limitReason: typeof value.limitReason === 'string' ? value.limitReason : null
        };
    }

    function normalizeBucketName(value) {
        const aliases = {
            functions: 'local-functions',
            localFunctions: 'local-functions',
            instances: 'child-instances',
            childInstances: 'child-instances',
            members: 'types'
        };
        return aliases[value] || value;
    }

    function bucketFor(node) {
        if (node.kind === 'interface') return 'interfaces';
        if (node.kind === 'method') return 'methods';
        if (node.kind === 'rule') return 'rules';
        if (node.kind === 'function') return 'local-functions';
        if (node.primitive || STATE_KINDS.has(node.kind)) return 'state';
        if (node.kind === 'instance') return 'child-instances';
        if (TYPE_KINDS.has(node.kind)) return 'types';
        return null;
    }

    function aggregateInstances(moduleId, instances) {
        const groups = new Map();
        for (const node of (instances || []).filter((item) => item.kind === 'instance' && !item.primitive)) {
            const details = node.details || {};
            const status = details.targetId
                ? 'exact'
                : details.parameterized || details.parameterizedTargetId || /#\s*\(/.test(details.targetName || details.constructor || details.type || '')
                    ? 'parameterized'
                    : 'unresolved';
            const target = details.targetId || details.parameterizedTargetId
                || details.targetName || details.constructor || details.type || 'unresolved';
            const key = stableIdentity([
                status,
                target,
                details.declaredType ?? details.type ?? null,
                details.constructor ?? null,
                details.constructorExpression ?? null,
                details.staticArguments ?? null,
                details.arguments ?? null,
                details.specialization ?? null,
                details.role ?? null,
                details.config ?? null,
                details.multiplicity ?? null
            ]);
            if (!groups.has(key)) groups.set(key, { key, status, target, members: [] });
            groups.get(key).members.push(node);
        }
        return [...groups.values()].sort((left, right) => compareText(left.target, right.target)).map((group) => {
            const members = group.members.slice().sort(compareNodes);
            const targetName = members[0].details?.targetName || members[0].details?.constructor || group.target;
            const exact = group.status === 'exact';
            return {
                id: `instance-group:${moduleId}:${encodeURIComponent(group.key)}`,
                kind: 'instance-group',
                label: `${targetName || 'unresolved'} × ${exact ? members.length : 'N'}`,
                parentId: moduleId,
                ownerId: moduleId,
                targetId: exact ? group.target : null,
                sourceIds: members.map((member) => member.id),
                multiplicity: {
                    status: group.status,
                    count: exact ? members.length : null
                },
                synthetic: true
            };
        });
    }

    function stableIdentity(value) {
        if (value === null || typeof value !== 'object') return String(value);
        if (Array.isArray(value)) return `[${value.map(stableIdentity).join(',')}]`;
        return `{${Object.keys(value).sort().map((key) => `${key}:${stableIdentity(value[key])}`).join(',')}}`;
    }

    function layoutModuleHierarchy(nodes, edges, sizes, options = {}) {
        const direction = options.direction === 'TB' ? 'TB' : 'LR';
        const root = nodes.find((node) => node.id === options.focusId && node.kind === 'module')
            || nodes.find((node) => node.kind === 'module');
        if (!root) return emptyHierarchyLayout(direction);

        const spacing = {
            outer: 40,
            moduleGap: 96,
            busOffset: 36,
            panelPadding: 12,
            headerGap: 32,
            memberGap: 24,
            rowGap: 18,
            panelGap: 24,
            childGap: 28,
            childRowGap: 12
        };
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const outgoing = mapOfArrays(nodes.map((node) => node.id));
        for (const edge of edges) {
            if (outgoing.has(edge.source)) outgoing.get(edge.source).push(edge.target);
        }
        const bucketOrder = new Map(BUCKETS.map((bucket, index) => [bucket.kind, index]));
        const groups = nodes
            .filter((node) => node.kind === 'member-group' && node.parentId === root.id)
            .sort((left, right) =>
                (bucketOrder.get(left.bucket) ?? 99) - (bucketOrder.get(right.bucket) ?? 99)
                || compareNodes(left, right)
            );
        const records = groups.map((group) => {
            const members = (outgoing.get(group.id) || [])
                .map((id) => nodeById.get(id))
                .filter(Boolean)
                .sort(compareNodes);
            return {
                group,
                groupSize: sizes.get(group.id),
                members,
                envelopes: members.map((node) =>
                    hierarchyEnvelope(node, outgoing, nodeById, sizes, direction, spacing)
                )
            };
        });
        const maxMembers = Math.max(1, ...records.map((record) => record.members.length));
        const viewport = {
            width: Number.isFinite(options.viewport?.width) ? options.viewport.width : 1000,
            height: Number.isFinite(options.viewport?.height) ? options.viewport.height : 700
        };
        const rootSize = sizes.get(root.id);
        const plans = Array.from({ length: maxMembers }, (_, index) =>
            planHierarchy(records, rootSize, index + 1, direction, viewport, spacing)
        );
        const best = plans.sort(compareHierarchyPlans)[0];
        const positions = new Map();
        const panels = [];
        const rootAxisSize = axisSize(rootSize, direction);
        const contentCross = Math.max(rootAxisSize.cross, best.panelSpanCross);
        const rootCross = spacing.outer + (contentCross - rootAxisSize.cross) / 2;
        const panelPrimary = spacing.outer + rootAxisSize.primary + spacing.moduleGap;
        let panelCross = spacing.outer + (contentCross - best.panelSpanCross) / 2;
        positions.set(root.id, axisRect(spacing.outer, rootCross, rootSize, direction));

        for (const planned of best.panels) {
            const panel = axisRect(
                panelPrimary,
                panelCross,
                physicalSize(planned.primary, planned.cross, direction),
                direction
            );
            const groupSize = sizes.get(planned.record.group.id);
            const groupAxisSize = axisSize(groupSize, direction);
            const innerCross = planned.cross - spacing.panelPadding * 2;
            const groupPrimary = panelPrimary + spacing.panelPadding;
            const groupCross = panelCross + spacing.panelPadding + (innerCross - groupAxisSize.cross) / 2;
            positions.set(
                planned.record.group.id,
                axisRect(groupPrimary, groupCross, groupSize, direction)
            );
            const nodeIds = [planned.record.group.id];
            const membersPrimary = groupPrimary + groupAxisSize.primary + spacing.headerGap;
            const membersCross = panelCross + spacing.panelPadding;
            planned.grid.placements.forEach((placement, index) => {
                const envelope = planned.record.envelopes[index];
                placeHierarchyEnvelope(
                    envelope,
                    membersPrimary + placement.primary,
                    membersCross + placement.cross,
                    positions,
                    nodeIds,
                    direction,
                    spacing
                );
            });
            panels.push({
                ...panel,
                id: `member-panel:${planned.record.group.id}`,
                kind: 'member-panel',
                ownerId: planned.record.group.id,
                nodeIds
            });
            panelCross += planned.cross + spacing.panelGap;
        }

        const edgeRoutes = new Map();
        const rootPosition = positions.get(root.id);
        const rootAxis = axisBox(rootPosition, direction);
        const groupAxes = groups
            .map((group) => ({ group, box: axisBox(positions.get(group.id), direction) }))
            .filter((entry) => entry.box);
        const busPrimary = rootAxis.end + Math.min(
            spacing.busOffset,
            Math.max(18, (panelPrimary - rootAxis.end) / 2)
        );
        const centers = [rootAxis.centerCross, ...groupAxes.map((entry) => entry.box.centerCross)];
        const hierarchyBus = groupAxes.length === 0 ? null : {
            path: [
                axisPath([
                    { primary: rootAxis.end, cross: rootAxis.centerCross },
                    { primary: busPrimary, cross: rootAxis.centerCross }
                ], direction),
                axisPath([
                    { primary: busPrimary, cross: Math.min(...centers) },
                    { primary: busPrimary, cross: Math.max(...centers) }
                ], direction)
            ].join(' ')
        };
        for (const edge of edges) {
            const target = nodeById.get(edge.target);
            if (edge.source !== root.id || target?.kind !== 'member-group') continue;
            const targetAxis = axisBox(positions.get(edge.target), direction);
            edgeRoutes.set(edge.id, {
                path: axisPath([
                    { primary: busPrimary, cross: targetAxis.centerCross },
                    { primary: targetAxis.start, cross: targetAxis.centerCross }
                ], direction),
                labelX: direction === 'TB' ? targetAxis.centerCross : (busPrimary + targetAxis.start) / 2,
                labelY: direction === 'TB' ? (busPrimary + targetAxis.start) / 2 : targetAxis.centerCross,
                marker: 'hierarchy'
            });
        }
        const bounds = geometryBounds([...positions.values(), ...panels]);
        return {
            positions,
            groups: panels,
            bounds,
            direction,
            edgeRoutes,
            hierarchyBus,
            columns: best.columns
        };
    }

    function emptyHierarchyLayout(direction) {
        return {
            positions: new Map(),
            groups: [],
            bounds: { x: 0, y: 0, width: 1, height: 1 },
            direction,
            edgeRoutes: new Map(),
            hierarchyBus: null,
            columns: 1
        };
    }

    function hierarchyEnvelope(node, outgoing, nodeById, sizes, direction, spacing) {
        const size = sizes.get(node.id);
        const own = axisSize(size, direction);
        const children = node.kind === 'instance-group'
            ? (outgoing.get(node.id) || [])
                .map((id) => nodeById.get(id))
                .filter(Boolean)
                .sort(compareNodes)
                .map((child) => ({
                    node: child,
                    size: sizes.get(child.id),
                    axis: axisSize(sizes.get(child.id), direction)
                }))
            : [];
        if (children.length === 0) {
            return { node, size, own, children, primary: own.primary, cross: own.cross };
        }
        const childPrimary = Math.max(...children.map((child) => child.axis.primary));
        const childCross = children.reduce((sum, child) => sum + child.axis.cross, 0)
            + (children.length - 1) * spacing.childRowGap;
        return {
            node,
            size,
            own,
            children,
            primary: own.primary + spacing.childGap + childPrimary,
            cross: Math.max(own.cross, childCross)
        };
    }

    function placeHierarchyEnvelope(envelope, primary, cross, positions, nodeIds, direction, spacing) {
        const ownCross = cross + (envelope.cross - envelope.own.cross) / 2;
        positions.set(envelope.node.id, axisRect(primary, ownCross, envelope.size, direction));
        nodeIds.push(envelope.node.id);
        if (envelope.children.length === 0) return;
        const childrenCross = envelope.children.reduce((sum, child) => sum + child.axis.cross, 0)
            + (envelope.children.length - 1) * spacing.childRowGap;
        let childCross = cross + (envelope.cross - childrenCross) / 2;
        const childPrimary = primary + envelope.own.primary + spacing.childGap;
        for (const child of envelope.children) {
            positions.set(child.node.id, axisRect(childPrimary, childCross, child.size, direction));
            nodeIds.push(child.node.id);
            childCross += child.axis.cross + spacing.childRowGap;
        }
    }

    function planHierarchy(records, rootSize, columns, direction, viewport, spacing) {
        const panels = records.map((record) => {
            const grid = packHierarchyGrid(record.envelopes, columns, spacing);
            const group = axisSize(record.groupSize, direction);
            const innerCross = Math.max(group.cross, grid.cross);
            return {
                record,
                grid,
                primary: spacing.panelPadding * 2 + group.primary
                    + (record.members.length > 0 ? spacing.headerGap + grid.primary : 0),
                cross: spacing.panelPadding * 2 + innerCross
            };
        });
        const root = axisSize(rootSize, direction);
        const panelSpanCross = panels.reduce((sum, panel) => sum + panel.cross, 0)
            + Math.max(0, panels.length - 1) * spacing.panelGap;
        const maxPanelPrimary = Math.max(0, ...panels.map((panel) => panel.primary));
        const totalPrimary = spacing.outer * 2 + root.primary + spacing.moduleGap + maxPanelPrimary;
        const totalCross = spacing.outer * 2 + Math.max(root.cross, panelSpanCross);
        const width = direction === 'TB' ? totalCross : totalPrimary;
        const height = direction === 'TB' ? totalPrimary : totalCross;
        const fit = Math.min(1, viewport.width / width, viewport.height / height);
        const branchLength = panels.reduce((sum, panel, index) =>
            sum + panel.primary + index * spacing.panelGap, 0);
        return {
            panels,
            columns,
            panelSpanCross,
            fit,
            area: width * height,
            branchLength
        };
    }

    function packHierarchyGrid(envelopes, columnLimit, spacing) {
        if (envelopes.length === 0) {
            return { primary: 0, cross: 0, placements: [] };
        }
        const columns = Math.min(columnLimit, envelopes.length);
        const rows = Math.ceil(envelopes.length / columns);
        const columnSizes = Array.from({ length: columns }, (_, column) =>
            Math.max(...envelopes
                .filter((_, index) => index % columns === column)
                .map((envelope) => envelope.primary))
        );
        const rowSizes = Array.from({ length: rows }, (_, row) =>
            Math.max(...envelopes
                .slice(row * columns, (row + 1) * columns)
                .map((envelope) => envelope.cross))
        );
        const columnOffsets = offsets(columnSizes, spacing.memberGap);
        const rowOffsets = offsets(rowSizes, spacing.rowGap);
        return {
            primary: columnSizes.reduce((sum, value) => sum + value, 0)
                + Math.max(0, columns - 1) * spacing.memberGap,
            cross: rowSizes.reduce((sum, value) => sum + value, 0)
                + Math.max(0, rows - 1) * spacing.rowGap,
            placements: envelopes.map((envelope, index) => {
                const column = index % columns;
                const row = Math.floor(index / columns);
                return {
                    primary: columnOffsets[column] + (columnSizes[column] - envelope.primary) / 2,
                    cross: rowOffsets[row] + (rowSizes[row] - envelope.cross) / 2
                };
            })
        };
    }

    function offsets(values, gap) {
        const result = [];
        let cursor = 0;
        for (const value of values) {
            result.push(cursor);
            cursor += value + gap;
        }
        return result;
    }

    function compareHierarchyPlans(left, right) {
        return right.fit - left.fit
            || left.area - right.area
            || left.branchLength - right.branchLength
            || left.columns - right.columns;
    }

    function axisSize(size, direction) {
        return direction === 'TB'
            ? { primary: size.height, cross: size.width }
            : { primary: size.width, cross: size.height };
    }

    function physicalSize(primary, cross, direction) {
        return direction === 'TB'
            ? { width: cross, height: primary }
            : { width: primary, height: cross };
    }

    function axisRect(primary, cross, size, direction) {
        return direction === 'TB'
            ? { x: cross, y: primary, width: size.width, height: size.height }
            : { x: primary, y: cross, width: size.width, height: size.height };
    }

    function axisBox(rect, direction) {
        if (!rect) return null;
        return direction === 'TB'
            ? {
                start: rect.y,
                end: rect.y + rect.height,
                centerCross: rect.x + rect.width / 2
            }
            : {
                start: rect.x,
                end: rect.x + rect.width,
                centerCross: rect.y + rect.height / 2
            };
    }

    function axisPath(points, direction) {
        return points.map((point, index) => {
            const x = direction === 'TB' ? point.cross : point.primary;
            const y = direction === 'TB' ? point.primary : point.cross;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
        }).join(' ');
    }

    function geometryBounds(items) {
        if (items.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
        const minX = Math.min(...items.map((item) => item.x));
        const minY = Math.min(...items.map((item) => item.y));
        const maxX = Math.max(...items.map((item) => item.x + item.width));
        const maxY = Math.max(...items.map((item) => item.y + item.height));
        return {
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY)
        };
    }

    function shortestPaths(sourceId, targetId, edges, options = {}) {
        const now = typeof options.now === 'function'
            ? options.now
            : () => globalThis.performance?.now?.() ?? Date.now();
        const startedAt = now();
        const maxPaths = positiveInteger(options.maxPaths, 50);
        const maxVisitedNodes = positiveInteger(options.maxVisitedNodes, 10000);
        const timeBudgetMs = nonNegativeNumber(options.timeBudgetMs, 100);
        const finish = (paths, truncated = false, limitReason = null, visitedNodes = 0) => ({
            paths,
            truncated,
            visitedNodes,
            elapsedMs: Math.max(0, now() - startedAt),
            limitReason
        });
        if (!sourceId || !targetId) return finish([]);
        if (sourceId === targetId) return finish([[sourceId]], false, null, 1);
        const directed = options.directed !== false;
        const outgoing = new Map();
        for (const edge of (edges || []).slice().sort(compareEdges)) {
            if (now() - startedAt >= timeBudgetMs) {
                return finish([], true, 'time-budget');
            }
            addAdjacent(outgoing, edge.source, edge.target);
            if (!directed || edge.bidirectional) addAdjacent(outgoing, edge.target, edge.source);
        }
        const distance = new Map([[sourceId, 0]]);
        const predecessors = new Map();
        const queue = [sourceId];
        let limitReason = null;
        let targetDistance = null;
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            if (now() - startedAt >= timeBudgetMs) {
                limitReason = 'time-budget';
                break;
            }
            const current = queue[cursor];
            const currentDistance = distance.get(current);
            if (targetDistance !== null && currentDistance >= targetDistance) continue;
            for (const next of [...(outgoing.get(current) || [])].sort(compareText)) {
                if (now() - startedAt >= timeBudgetMs) {
                    limitReason = 'time-budget';
                    break;
                }
                const candidate = currentDistance + 1;
                if (!distance.has(next)) {
                    if (distance.size >= maxVisitedNodes) {
                        limitReason = 'max-visited-nodes';
                        break;
                    }
                    distance.set(next, candidate);
                    predecessors.set(next, [current]);
                    queue.push(next);
                    if (next === targetId) targetDistance = candidate;
                } else if (distance.get(next) === candidate) {
                    predecessors.get(next).push(current);
                }
            }
            if (limitReason) break;
        }
        if (!distance.has(targetId)) {
            return finish([], Boolean(limitReason), limitReason, distance.size);
        }
        const paths = [];
        const stack = [{ id: targetId, reversePath: [targetId] }];
        while (stack.length > 0) {
            if (now() - startedAt >= timeBudgetMs) {
                limitReason = limitReason || 'time-budget';
                break;
            }
            const current = stack.pop();
            if (current.id === sourceId) {
                if (paths.length >= maxPaths) {
                    limitReason = limitReason || 'max-paths';
                    break;
                }
                paths.push(current.reversePath.slice().reverse());
                continue;
            }
            const previousNodes = [...new Set(predecessors.get(current.id) || [])].sort(compareText);
            for (let index = previousNodes.length - 1; index >= 0; index -= 1) {
                stack.push({
                    id: previousNodes[index],
                    reversePath: [...current.reversePath, previousNodes[index]]
                });
            }
        }
        paths.sort((left, right) => compareText(left.join('\u0000'), right.join('\u0000')));
        return finish(paths, Boolean(limitReason), limitReason, distance.size);
    }

    function positiveInteger(value, fallback) {
        return Number.isInteger(value) && value > 0 ? value : fallback;
    }

    function nonNegativeNumber(value, fallback) {
        return Number.isFinite(value) && value >= 0 ? value : fallback;
    }

    function addAdjacent(index, source, target) {
        if (!index.has(source)) index.set(source, []);
        index.get(source).push(target);
    }

    function createPathNavigator(value) {
        const result = Array.isArray(value)
            ? { paths: value, truncated: false, visitedNodes: 0, elapsedMs: 0, limitReason: null }
            : value || { paths: [], truncated: false, visitedNodes: 0, elapsedMs: 0, limitReason: null };
        const ordered = (result.paths || []).map((path) => path.slice())
            .sort((left, right) => compareText(left.join('\u0000'), right.join('\u0000')));
        let index = 0;
        return {
            get paths() { return ordered.map((path) => path.slice()); },
            get index() { return index; },
            get current() { return ordered[index] ? ordered[index].slice() : null; },
            get label() { return ordered.length ? `${index + 1} of ${ordered.length}${result.truncated ? '+' : ''}` : '0 of 0'; },
            get truncated() { return result.truncated === true; },
            get visitedNodes() { return result.visitedNodes || 0; },
            get elapsedMs() { return result.elapsedMs || 0; },
            get limitReason() { return result.limitReason || null; },
            next() {
                if (ordered.length) index = (index + 1) % ordered.length;
                return this.current;
            },
            previous() {
                if (ordered.length) index = (index - 1 + ordered.length) % ordered.length;
                return this.current;
            }
        };
    }

    class GraphViewModel {
        constructor(model, savedState = {}) {
            this.model = model || { nodes: [], edges: [] };
            this.indexes = buildIndexes(this.model);
            this.state = migrateState(savedState, this.indexes);
            if (this.state.selectedId && !this.indexes.nodeById.has(this.state.selectedId)) {
                this.state.selectedId = null;
            }
        }

        setSourceScope(value) { this.state.sourceScope = normalizeSourceScope(value); return this.state.sourceScope; }
        setLevel(value) { this.state.level = normalizeLevel(value); return this.state.level; }
        setAnalysisMode(value) { this.state.analysisMode = normalizeAnalysisMode(value); return this.state.analysisMode; }
        setHopScope(value) { this.state.hopScope = normalizeHopScope(value); return this.state.hopScope; }
        setFocus(value) { this.state.focusStack = restoreFocus(value, this.indexes); return this.breadcrumbs(); }
        breadcrumbs() { return this.state.focusStack.map((id) => this.indexes.nodeById.get(id)).filter(Boolean); }
        activeEdges(mode = this.state.analysisMode) { return this.indexes.edgesByMode.get(normalizeAnalysisMode(mode)) || []; }
        relations(nodeId) { return this.indexes.relationsByNode.get(nodeId) || []; }

        memberBuckets(moduleId) {
            const moduleNode = this.indexes.nodeById.get(moduleId);
            const children = (this.indexes.children.get(moduleId) || []).filter((node) => !node.hidden);
            const implemented = this.activeEdges('structure')
                .filter((edge) => edge.source === moduleId && edge.kind === 'implements')
                .map((edge) => this.indexes.nodeById.get(edge.target))
                .filter((node) => node && !node.hidden);
            return BUCKETS.map((descriptor) => {
                const hiddenMethods = descriptor.kind === 'methods' && this.state.showMethodPorts === false;
                const members = hiddenMethods
                    ? []
                    : descriptor.kind === 'interfaces'
                    ? uniqueNodes([...children.filter((node) => bucketFor(node) === descriptor.kind), ...implemented])
                    : children.filter((node) => bucketFor(node) === descriptor.kind);
                const configured = moduleNode?.memberBuckets?.[configuredBucketName(descriptor.kind)];
                const defaultCollapsed = this.state.collapseModuleMembers === false && descriptor.collapsed
                    ? false
                    : configured?.collapsed ?? descriptor.collapsed;
                const collapsed = this.state.collapsedGroups[moduleId]?.[descriptor.kind] ?? defaultCollapsed;
                const totalCount = hiddenMethods
                    ? 0
                    : Number.isInteger(configured?.totalCount)
                    ? configured.totalCount
                    : members.length;
                return {
                    id: `${moduleId}:${descriptor.kind}`,
                    moduleId,
                    kind: descriptor.kind,
                    members,
                    memberNodeIds: members.map((node) => node.id),
                    totalCount,
                    visibleCount: collapsed ? 0 : members.length,
                    collapsed
                };
            });
        }

        collapse(moduleId, bucket) { this.setCollapsed(moduleId, bucket, true); }
        expand(moduleId, bucket) { this.setCollapsed(moduleId, bucket, false); }
        setCollapsed(moduleId, bucket, collapsed) {
            if (!this.state.collapsedGroups[moduleId]) this.state.collapsedGroups[moduleId] = {};
            this.state.collapsedGroups[moduleId][normalizeBucketName(bucket)] = Boolean(collapsed);
        }
        toggleAggregation(id) {
            this.state.expandedAggregations[id] = !this.state.expandedAggregations[id];
            return this.state.expandedAggregations[id];
        }

        neighborhood(startId, depth = this.state.hopScope, mode = this.state.analysisMode, allowedIds = null) {
            const limit = normalizeHopScope(depth);
            const adjacency = this.indexes.adjacencyByMode.get(normalizeAnalysisMode(mode)) || new Map();
            if (allowedIds && !allowedIds.has(startId)) return [];
            const distance = new Map([[startId, 0]]);
            const queue = [startId];
            for (let cursor = 0; cursor < queue.length; cursor += 1) {
                const current = queue[cursor];
                if (limit !== 'all' && distance.get(current) >= limit) continue;
                for (const next of adjacency.get(current) || []) {
                    if (allowedIds && !allowedIds.has(next)) continue;
                    if (distance.has(next)) continue;
                    distance.set(next, distance.get(current) + 1);
                    queue.push(next);
                }
            }
            return [...distance.entries()]
                .sort((left, right) => left[1] - right[1] || compareText(left[0], right[0]))
                .map(([id]) => id);
        }

        shortestPaths(sourceId, targetId, options = {}) {
            const mode = options.analysisMode || options.mode || this.state.analysisMode;
            return shortestPaths(sourceId, targetId, this.activeEdges(mode), options);
        }
        pathNavigator(sourceId, targetId, options = {}) {
            return createPathNavigator(this.shortestPaths(sourceId, targetId, options));
        }

        visible(options = {}) {
            const sourceScope = normalizeSourceScope(options.sourceScope || this.state.sourceScope);
            const level = normalizeLevel(options.level || this.state.level);
            const analysisMode = normalizeAnalysisMode(options.analysisMode || this.state.analysisMode);
            const hopScope = normalizeHopScope(options.hopScope ?? this.state.hopScope);
            const focusId = options.focusId || this.state.focusStack.at(-1) || null;
            const activeFile = options.activeFile || this.state.activeFile || this.model.activeFile;
            const scoped = this.indexes.visibleNodes.filter((node) =>
                sourceScope === SOURCE_SCOPES.WORKSPACE || !activeFile || node.relativePath === activeFile
            );
            const scopedIds = new Set(scoped.map((node) => node.id));
            let nodes = this.levelNodes(level, analysisMode, focusId, scoped, scopedIds);

            if (focusId) {
                const allowed = this.focusNeighborhood(focusId, hopScope, analysisMode, nodes);
                nodes = nodes.filter((node) =>
                    node.synthetic
                    || allowed.has(node.id)
                    || node.kind === 'member-group' && node.sourceIds.some((id) => allowed.has(id))
                );
            }

            nodes = uniqueNodes(nodes).sort(compareNodes);
            const ids = new Set(nodes.map((node) => node.id));
            let edges = this.activeEdges(analysisMode)
                .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edgeAllowedByFilters(edge, this.state.filters));
            if (level === LEVELS.MODULE && analysisMode === ANALYSIS_MODES.STRUCTURE) {
                const moduleId = ownerModuleId(focusId, this.indexes)
                    || nodes.find((node) => node.kind === 'module')?.id;
                edges = this.moduleStructureEdges(moduleId, nodes);
            }
            return { sourceScope, level, analysisMode, hopScope, focusId, nodes, edges, indexes: this.indexes };
        }

        levelNodes(level, analysisMode, focusId, scoped, scopedIds) {
            if (analysisMode === ANALYSIS_MODES.SCHEDULING && focusId) {
                const ownerId = ownerModuleId(focusId, this.indexes);
                const members = (this.indexes.children.get(ownerId) || [])
                    .filter((node) =>
                        !node.hidden
                        && ['rule', 'method'].includes(node.kind)
                        && (this.state.showMethodPorts !== false || node.kind !== 'method')
                    );
                return members.filter((node) => scopedIds.has(node.id));
            }
            if (level === LEVELS.SYSTEM) {
                return scoped.filter((node) =>
                    node.virtual || ['module', 'interface', 'package'].includes(node.kind)
                ).filter((node) => this.state.filters.packages !== false || node.kind !== 'package');
            }
            const moduleId = ownerModuleId(focusId, this.indexes)
                || scoped.find((node) => node.kind === 'module')?.id;
            const moduleNode = this.indexes.nodeById.get(moduleId);
            if (!moduleNode || !scopedIds.has(moduleNode.id)) return [];
            if (level === LEVELS.BEHAVIOR) {
                const members = (this.indexes.children.get(moduleId) || []).filter((node) =>
                    !node.hidden
                    && (BEHAVIOR_KINDS.has(node.kind) || node.primitive || STATE_KINDS.has(node.kind) || node.kind === 'instance')
                    && (this.state.showMethodPorts !== false || node.kind !== 'method')
                    && scopedIds.has(node.id)
                );
                return [moduleNode, ...members];
            }
            return this.moduleLevelNodes(moduleNode, scopedIds);
        }

        moduleLevelNodes(moduleNode, scopedIds) {
            const nodes = [moduleNode];
            const buckets = this.memberBuckets(moduleNode.id)
                .filter((bucket) => bucket.totalCount > 0 || bucket.members.length > 0);
            for (const bucket of buckets) {
                const group = {
                    id: `member-group:${bucket.id}`,
                    kind: 'member-group',
                    label: bucketLabel(bucket.kind),
                    parentId: moduleNode.id,
                    ownerId: moduleNode.id,
                    bucket: bucket.kind,
                    collapsed: bucket.collapsed,
                    totalCount: bucket.totalCount,
                    visibleCount: bucket.visibleCount,
                    sourceIds: bucket.memberNodeIds,
                    synthetic: true
                };
                nodes.push(group);
                if (bucket.collapsed) continue;
                if (bucket.kind === 'child-instances') {
                    for (const aggregate of aggregateInstances(moduleNode.id, bucket.members)) {
                        nodes.push(aggregate);
                        if (this.state.expandedAggregations[aggregate.id]) {
                            nodes.push(...bucket.members.filter((member) => aggregate.sourceIds.includes(member.id)));
                        }
                    }
                } else {
                    nodes.push(...bucket.members.filter((member) => scopedIds.has(member.id)));
                }
            }
            return nodes;
        }

        moduleStructureEdges(moduleId, nodes) {
            if (!moduleId) return [];
            const visibleById = new Map(nodes.map((node) => [node.id, node]));
            const groups = nodes
                .filter((node) => node.kind === 'member-group' && node.parentId === moduleId)
                .sort(compareNodes);
            const edges = [];
            for (const group of groups) {
                edges.push(viewEdge(
                    `view:${moduleId}:${group.bucket}`,
                    moduleId,
                    group.id,
                    'contains',
                    '',
                    true
                ));
                if (group.bucket === 'child-instances') {
                    for (const aggregate of nodes.filter((node) =>
                        node.kind === 'instance-group'
                        && node.parentId === moduleId
                        && node.sourceIds.some((id) => group.sourceIds.includes(id))
                    )) {
                        edges.push(viewEdge(
                            `view:${group.id}:${aggregate.id}`,
                            group.id,
                            aggregate.id,
                            'instantiate',
                            aggregate.label,
                            false
                        ));
                        for (const instanceId of aggregate.sourceIds) {
                            if (!visibleById.has(instanceId)) continue;
                            edges.push(viewEdge(
                                `view:${aggregate.id}:${instanceId}`,
                                aggregate.id,
                                instanceId,
                                'contains',
                                '',
                                true
                            ));
                        }
                    }
                    continue;
                }
                for (const memberId of group.sourceIds) {
                    if (!visibleById.has(memberId)) continue;
                    const kind = group.bucket === 'interfaces' ? 'implements' : 'contains';
                    edges.push(viewEdge(
                        `view:${group.id}:${memberId}`,
                        group.id,
                        memberId,
                        kind,
                        '',
                        kind === 'contains'
                    ));
                }
            }
            return edges.sort(compareEdges);
        }

        focusNeighborhood(focusId, hopScope, analysisMode, visibleNodes) {
            const materializedIds = new Set(visibleNodes.filter((node) => !node.synthetic).map((node) => node.id));
            const ownerId = ownerModuleId(focusId, this.indexes);
            const rootId = materializedIds.has(focusId) ? focusId : ownerId || focusId;
            const direct = this.neighborhood(rootId, hopScope, analysisMode, materializedIds);
            if (direct.length > 1 || this.indexes.nodeById.get(rootId)?.kind !== 'module') return new Set(direct);
            const childIds = new Set((this.indexes.children.get(rootId) || []).map((node) => node.id));
            const seeds = visibleNodes.filter((node) => childIds.has(node.id) && !node.synthetic);
            const allowed = new Set([rootId]);
            for (const seed of seeds) {
                allowed.add(seed.id);
                const remaining = hopScope === 'all' ? 'all' : Math.max(0, hopScope - 1);
                if (remaining === 0) continue;
                for (const id of this.neighborhood(seed.id, remaining, analysisMode, materializedIds)) {
                    allowed.add(id);
                }
            }
            return allowed;
        }
    }

    function ownerModuleId(id, indexes) {
        let node = indexes.nodeById.get(id);
        if (!node) return null;
        if (node.kind === 'module') return node.id;
        if (node.kind === 'instance' && node.details?.targetId) {
            const target = indexes.nodeById.get(node.details.targetId);
            if (target?.kind === 'module') return target.id;
        }
        while (node?.parentId) {
            node = indexes.nodeById.get(node.parentId);
            if (node?.kind === 'module') return node.id;
        }
        return null;
    }

    function configuredBucketName(kind) {
        return {
            'local-functions': 'localFunctions',
            'child-instances': 'childInstances'
        }[kind] || kind;
    }

    function bucketLabel(kind) {
        return {
            interfaces: 'Interfaces',
            methods: 'Methods',
            rules: 'Rules',
            'local-functions': 'Local Functions',
            state: 'State',
            'child-instances': 'Child Instances',
            types: 'Types'
        }[kind] || kind;
    }

    function edgeAllowedByFilters(edge, filters) {
        if (filters?.imports === false && edge.kind === 'import') return false;
        if (filters?.rules === false && ['rule', 'method'].includes(edge.kind)) return false;
        return true;
    }

    function viewEdge(id, source, target, kind, label, layoutOnly) {
        return {
            id,
            source,
            target,
            kind,
            label,
            mode: 'structure',
            origin: 'view-model',
            confidence: 'explicit',
            evidence: `${source} ${kind} ${target}`,
            bidirectional: false,
            inferred: true,
            layoutOnly,
            suppressLabel: true
        };
    }

    function uniqueNodes(nodes) {
        return [...new Map((nodes || []).filter(Boolean).map((node) => [node.id, node])).values()];
    }

    function createViewModel(model, state) {
        return new GraphViewModel(model, state);
    }

    return {
        STATE_VERSION,
        SOURCE_SCOPES,
        LEVELS,
        ANALYSIS_MODES,
        MODE_EDGE_KINDS,
        BUCKETS,
        GraphViewModel,
        createViewModel,
        createGraphView: createViewModel,
        buildIndexes,
        edgeMode,
        classifyEdge: edgeMode,
        filterEdgesByMode,
        filterModeEdges: filterEdgesByMode,
        migrateState,
        restoreFocus,
        normalizeSourceScope,
        normalizeLevel,
        normalizeAnalysisMode,
        normalizeHopScope,
        normalizeDepth: normalizeHopScope,
        aggregateInstances,
        layoutModuleHierarchy,
        shortestPaths,
        createPathNavigator
    };
}));
