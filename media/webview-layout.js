'use strict';

((root, factory) => {
    const text = root.BsvArchitectureText
        || (typeof require === 'function' ? require('./text-metrics') : null);
    const api = factory(text);
    root.BsvArchitectureLayout = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis, (Text) => {
    function layoutGraph(nodes, edges, groups, options) {
        const sizes = new Map(nodes.map((node) => [node.id, measureNode(node, options.level)]));
        if (options.level === 'module' && options.analysisMode === 'structure') {
            return options.layoutModuleHierarchy(nodes, edges, sizes, options);
        }
        if (options.level === 'system' && ['structure', 'data-flow'].includes(options.analysisMode) && options.topology?.roots?.length) {
            return layoutHierarchyForest(nodes, edges, sizes, options);
        }
        if (options.analysisMode === 'data-flow') {
            return layoutByRanks(nodes, edges, sizes, options.direction, options.focusId);
        }
        if (options.analysisMode === 'scheduling') {
            return layoutScheduling(nodes, edges, sizes, options);
        }
        if (options.level === 'behavior') {
            return layoutCompactGrid(nodes, sizes, options);
        }
        return options.grouped && groups.length > 1
            ? layoutByGroups(nodes, groups, sizes, options.direction)
            : layoutByRanks(nodes, edges, sizes, options.direction, options.focusId);
    }

    function layoutHierarchyForest(nodes, edges, sizes, options) {
        const direction = options.direction === 'TB' ? 'TB' : 'LR';
        const topology = options.topology;
        const visibleIds = new Set(nodes.map((node) => node.id));
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const spacing = { outer: 40, header: 54, inset: 22, rank: 92, sibling: 24, component: 54 };
        const positions = new Map();
        const groups = [];
        const edgeRoutes = new Map();
        const components = topology.roots
            .map((root) => options.analysisMode === 'data-flow'
                ? rankedComponent(root, root.nodeIds.filter((id) => visibleIds.has(id)), nodeById, edges, sizes, options, spacing)
                : hierarchyComponent(root, topology, visibleIds, nodeById, sizes, direction, spacing))
            .filter((component) => component.nodeIds.length)
            .sort((left, right) => compareText(left.root.label, right.root.label) || compareText(left.root.id, right.root.id));
        for (const component of components) {
            const origin = component.root.reason === 'configured' ? 'Configured Architecture Root'
                : component.root.reason === 'uninstantiated' ? 'Natural Root Candidate' : 'Architecture Root';
            component.label = `${origin}: ${component.root.label}`;
            component.width = Math.max(component.width, Text.displayWidth(component.label) * 7 + spacing.inset * 2);
        }
        let packVertical = direction === 'TB';
        if (components.length > 1 && options.viewportWidth && options.viewportHeight) {
            const gap = spacing.component * (components.length - 1);
            const horizontalScale = Math.min(
                options.viewportWidth / (components.reduce((sum, item) => sum + item.width, gap)),
                options.viewportHeight / Math.max(...components.map((item) => item.height))
            );
            const verticalScale = Math.min(
                options.viewportWidth / Math.max(...components.map((item) => item.width)),
                options.viewportHeight / (components.reduce((sum, item) => sum + item.height, gap))
            );
            if (horizontalScale !== verticalScale) packVertical = verticalScale > horizontalScale;
        }
        let cursor = spacing.outer;
        for (const component of components) {
            const origin = packVertical
                ? { x: spacing.outer, y: cursor }
                : { x: cursor, y: spacing.outer };
            const rootNode = nodeById.get(component.root.id);
            const instanceCount = component.nodeIds.filter((id) => nodeById.get(id).architectureInstance).length;
            const boundary = {
                id: `root-boundary:${component.root.id}`,
                kind: 'root-boundary',
                ownerId: component.root.id,
                nodeIds: component.nodeIds,
                label: component.label,
                description: `${instanceCount} instances · External channels ${rootNode?.details?.externalChannelCount || 0}`,
                x: origin.x,
                y: origin.y,
                width: component.width,
                height: component.height
            };
            groups.push(boundary);
            for (const [id, rect] of component.positions) {
                positions.set(id, { ...rect, x: rect.x + origin.x, y: rect.y + origin.y });
            }
            cursor += (packVertical ? component.height : component.width) + spacing.component;
        }
        const secondaryIds = nodes.filter((node) => !positions.has(node.id)).map((node) => node.id);
        if (secondaryIds.length) {
            const source = rankedComponent({ id: 'source-map', label: 'Source Map' }, secondaryIds, nodeById, edges, sizes, options, spacing);
            const hardwareBounds = computeBounds([...positions.values()], groups);
            const origin = { x: spacing.outer, y: hardwareBounds.y + hardwareBounds.height + spacing.component };
            groups.push({
                id: 'source-map', kind: 'source-map', label: 'Source Map',
                description: 'Secondary source projection', nodeIds: secondaryIds,
                ...origin, width: source.width, height: source.height
            });
            for (const [id, rect] of source.positions) {
                positions.set(id, { ...rect, x: rect.x + origin.x, y: rect.y + origin.y });
            }
        }
        for (const edge of edges) {
            if (options.analysisMode === 'structure' && edge.kind !== 'instance-child') continue;
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            const rootId = topology.rootById.get(edge.source);
            if (!source || !target || !rootId || rootId !== topology.rootById.get(edge.target)) continue;
            const route = hierarchyRoute(source, target, direction);
            if (options.analysisMode === 'data-flow') {
                const group = groups.find((item) => item.ownerId === rootId);
                if (direction === 'TB' && target.y < source.y + source.height) {
                    const lane = group.y + group.height - spacing.inset / 2;
                    const sx = source.x + source.width / 2;
                    const tx = target.x + target.width / 2;
                    route.path = `M ${sx} ${source.y + source.height} V ${lane} H ${tx} V ${target.y + target.height}`;
                    route.labelX = (sx + tx) / 2;
                    route.labelY = lane - 3;
                } else if (direction === 'LR' && target.x < source.x + source.width) {
                    const lane = group.x + group.width - spacing.inset / 2;
                    const sy = source.y + source.height / 2;
                    const ty = target.y + target.height / 2;
                    route.path = `M ${source.x + source.width} ${sy} H ${lane} V ${ty} H ${target.x + target.width}`;
                    route.labelX = lane;
                    route.labelY = (sy + ty) / 2 - 3;
                }
                route.bounds = {
                    x: group.x, y: group.y + spacing.header,
                    width: group.width, height: group.height - spacing.header
                };
            }
            edgeRoutes.set(edge.id, route);
        }
        return {
            positions,
            groups,
            bounds: computeBounds([...positions.values()], groups),
            direction,
            edgeRoutes
        };
    }

    function rankedComponent(root, nodeIds, nodeById, edges, sizes, options, spacing) {
        const ids = new Set(nodeIds);
        const localEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
        const rankGap = options.analysisMode === 'data-flow'
            ? Math.max(110, ...localEdges.map((edge) =>
                Math.min(34, Text.displayWidth(edge.label || edge.kind)) * 5.5 + 26))
            : 110;
        const ranked = layoutByRanks(nodeIds.map((id) => nodeById.get(id)),
            localEdges, sizes, options.direction, options.focusId, rankGap);
        const positions = new Map([...ranked.positions].map(([id, rect]) => [id, {
            ...rect,
            x: rect.x - ranked.bounds.x + spacing.inset,
            y: rect.y - ranked.bounds.y + spacing.header + spacing.inset
        }]));
        return {
            root, nodeIds, positions,
            width: Math.max(280, ranked.bounds.width + spacing.inset * 2),
            height: Math.max(180, ranked.bounds.height + spacing.header + spacing.inset * 2)
        };
    }

    function hierarchyComponent(root, topology, visibleIds, nodeById, sizes, direction, spacing) {
        const nodeIds = root.nodeIds.filter((id) => visibleIds.has(id));
        const byDepth = new Map();
        for (const id of nodeIds) {
            const depth = topology.depthById.get(id) || 0;
            if (!byDepth.has(depth)) byDepth.set(depth, []);
            byDepth.get(depth).push(nodeById.get(id));
        }
        for (const layer of byDepth.values()) layer.sort(compareNodes);
        const depths = [...byDepth.keys()].sort((left, right) => left - right);
        const primarySizes = new Map(depths.map((depth) => [depth, Math.max(...byDepth.get(depth).map((node) =>
            direction === 'TB' ? sizes.get(node.id).height : sizes.get(node.id).width
        ))]));
        const layerCross = new Map(depths.map((depth) => [depth, byDepth.get(depth).reduce((sum, node) =>
            sum + (direction === 'TB' ? sizes.get(node.id).width : sizes.get(node.id).height), 0
        ) + Math.max(0, byDepth.get(depth).length - 1) * spacing.sibling]));
        const maxCross = Math.max(1, ...layerCross.values());
        const primaryOffsets = new Map();
        let primary = spacing.inset;
        for (const depth of depths) {
            primaryOffsets.set(depth, primary);
            primary += primarySizes.get(depth) + spacing.rank;
        }
        const positions = new Map();
        for (const depth of depths) {
            let cross = spacing.inset + (maxCross - layerCross.get(depth)) / 2;
            for (const node of byDepth.get(depth)) {
                const size = sizes.get(node.id);
                const rect = direction === 'TB'
                    ? { x: cross, y: spacing.header + primaryOffsets.get(depth), ...size }
                    : { x: primaryOffsets.get(depth), y: spacing.header + cross, ...size };
                positions.set(node.id, rect);
                cross += (direction === 'TB' ? size.width : size.height) + spacing.sibling;
            }
        }
        const content = computeBounds([...positions.values()], []);
        return {
            root,
            nodeIds,
            positions,
            width: Math.max(280, content.x + content.width + spacing.inset),
            height: Math.max(180, content.y + content.height + spacing.inset)
        };
    }

    function hierarchyRoute(source, target, direction) {
        if (direction === 'TB') {
            const sx = source.x + source.width / 2;
            const sy = source.y + source.height;
            const tx = target.x + target.width / 2;
            const ty = target.y;
            const mid = (sy + ty) / 2;
            return { path: `M ${sx} ${sy} V ${mid} H ${tx} V ${ty}`, labelX: (sx + tx) / 2, labelY: mid - 3 };
        }
        const sx = source.x + source.width;
        const sy = source.y + source.height / 2;
        const tx = target.x;
        const ty = target.y + target.height / 2;
        const mid = (sx + tx) / 2;
        return { path: `M ${sx} ${sy} H ${mid} V ${ty} H ${tx}`, labelX: mid, labelY: (sy + ty) / 2 - 3 };
    }

    function layoutCompactGrid(nodes, sizes, options) {
        const compact = options.viewportWidth < 700;
        const margin = compact ? 20 : 40;
        const horizontalGap = compact ? 20 : 46;
        const verticalGap = compact ? 18 : 42;
        const sorted = nodes.slice().sort((left, right) =>
            (left.id === options.focusId ? -1 : right.id === options.focusId ? 1 : 0)
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
        return { positions, groups: [], bounds: computeBounds([...positions.values()], []), direction: options.direction };
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

    function layoutByRanks(nodes, edges, sizes, direction, focusId, rankGap = 110) {
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
        return positionByRanks(nodes, sizes, direction, rank, relevant, 28, rankGap);
    }

    function layoutScheduling(nodes, edges, sizes, options) {
        const ids = new Set(nodes.map((node) => node.id));
        const precedence = edges
            .filter((edge) =>
                ids.has(edge.source)
                && ids.has(edge.target)
                && !edge.bidirectional
                && [
                    'sequential-before',
                    'sequential-before-reverse',
                    'descending-urgency',
                    'execution-order',
                    'preempts'
                ].includes(edge.kind)
            )
            .slice()
            .sort((left, right) => compareText(left.id, right.id));
        const components = stronglyConnectedComponents([...ids].sort(compareText), precedence);
        const componentByNode = new Map();
        components.forEach((component, index) => {
            for (const nodeId of component) componentByNode.set(nodeId, index);
        });
        const outgoing = new Map(components.map((_, index) => [index, new Set()]));
        const indegree = new Map(components.map((_, index) => [index, 0]));
        for (const edge of precedence) {
            const source = componentByNode.get(edge.source);
            const target = componentByNode.get(edge.target);
            if (source === target || outgoing.get(source).has(target)) continue;
            outgoing.get(source).add(target);
            indegree.set(target, indegree.get(target) + 1);
        }
        const componentKey = (index) => components[index].join('|');
        const ready = [...indegree]
            .filter(([, value]) => value === 0)
            .map(([index]) => index)
            .sort((left, right) => compareText(componentKey(left), componentKey(right)));
        const componentRanks = new Map(components.map((_, index) => [index, 0]));
        while (ready.length > 0) {
            const current = ready.shift();
            for (const target of [...outgoing.get(current)].sort((left, right) =>
                compareText(componentKey(left), componentKey(right))
            )) {
                componentRanks.set(target, Math.max(
                    componentRanks.get(target),
                    componentRanks.get(current) + 1
                ));
                indegree.set(target, indegree.get(target) - 1);
                if (indegree.get(target) === 0) {
                    ready.push(target);
                    ready.sort((left, right) => compareText(componentKey(left), componentKey(right)));
                }
            }
        }
        const ranks = new Map([...componentByNode].map(([nodeId, component]) => [
            nodeId,
            componentRanks.get(component)
        ]));
        const layout = positionByRanks(nodes, sizes, options.direction, ranks, precedence, 14);
        const cycles = components
            .filter((members) => members.length > 1)
            .map((members) => ({
                id: `cycle:${members.join('|')}`,
                members,
                edgeIds: precedence
                    .filter((edge) => members.includes(edge.source) && members.includes(edge.target))
                    .map((edge) => edge.id)
                    .sort(compareText),
                bounds: enclosingBounds(members, layout.positions, 24)
            }));
        return {
            ...layout,
            bounds: computeBounds([...layout.positions.values(), ...cycles.map((cycle) => cycle.bounds)], []),
            cycles
        };
    }

    function enclosingBounds(nodeIds, positions, padding) {
        const members = nodeIds.map((id) => positions.get(id)).filter(Boolean);
        const minX = Math.min(...members.map((item) => item.x));
        const minY = Math.min(...members.map((item) => item.y));
        const maxX = Math.max(...members.map((item) => item.x + item.width));
        const maxY = Math.max(...members.map((item) => item.y + item.height));
        return {
            x: minX - padding,
            y: minY - padding,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2
        };
    }

    function stronglyConnectedComponents(nodeIds, edges) {
        const adjacent = new Map(nodeIds.map((id) => [id, new Set()]));
        const reverse = new Map(nodeIds.map((id) => [id, new Set()]));
        for (const edge of edges) {
            adjacent.get(edge.source).add(edge.target);
            reverse.get(edge.target).add(edge.source);
        }
        const finish = [];
        const visited = new Set();
        for (const start of nodeIds) {
            if (visited.has(start)) continue;
            visited.add(start);
            const stack = [{ id: start, index: 0, neighbors: [...adjacent.get(start)].sort(compareText) }];
            while (stack.length > 0) {
                const frame = stack.at(-1);
                if (frame.index < frame.neighbors.length) {
                    const next = frame.neighbors[frame.index++];
                    if (visited.has(next)) continue;
                    visited.add(next);
                    stack.push({ id: next, index: 0, neighbors: [...adjacent.get(next)].sort(compareText) });
                } else {
                    finish.push(frame.id);
                    stack.pop();
                }
            }
        }
        const assigned = new Set();
        const components = [];
        for (const start of finish.toReversed()) {
            if (assigned.has(start)) continue;
            const members = [];
            const stack = [start];
            assigned.add(start);
            while (stack.length > 0) {
                const current = stack.pop();
                members.push(current);
                for (const next of [...reverse.get(current)].sort(compareText).toReversed()) {
                    if (assigned.has(next)) continue;
                    assigned.add(next);
                    stack.push(next);
                }
            }
            components.push(members.sort(compareText));
        }
        return components.sort((left, right) => compareText(left.join('|'), right.join('|')));
    }

    function positionByRanks(nodes, sizes, direction, rank, edges = [], crossGap = 28, rankGap = 110) {
        const positions = new Map();
        const layers = new Map();
        for (const node of nodes) {
            const value = rank.get(node.id) || 0;
            if (!layers.has(value)) layers.set(value, []);
            layers.get(value).push(node);
        }
        for (const layer of layers.values()) {
            layer.sort((left, right) => nodePriority(left) - nodePriority(right) || compareNodes(left, right));
        }
        reduceCrossings(layers, rank, edges);
        const ordered = [...layers].sort((left, right) => left[0] - right[0]);
        const dimensions = [];
        let primary = 40;
        let maxCross = 0;
        for (const [value, layer] of ordered) {
            const primarySize = Math.max(...layer.map((node) =>
                direction === 'TB' ? sizes.get(node.id).height : sizes.get(node.id).width
            ));
            const crossSize = layer.reduce((sum, node) =>
                sum + (direction === 'TB' ? sizes.get(node.id).width : sizes.get(node.id).height), 0
            ) + Math.max(0, layer.length - 1) * crossGap;
            dimensions.push({ value, layer, primary, primarySize, crossSize });
            primary += primarySize + rankGap;
            maxCross = Math.max(maxCross, crossSize);
        }
        for (const layer of dimensions) {
            let cross = 40 + (maxCross - layer.crossSize) / 2;
            for (const node of layer.layer) {
                const size = sizes.get(node.id);
                positions.set(node.id, direction === 'TB'
                    ? { x: cross, y: layer.primary, ...size }
                    : { x: layer.primary, y: cross, ...size });
                cross += (direction === 'TB' ? size.width : size.height) + crossGap;
            }
        }
        return { positions, groups: [], bounds: computeBounds([...positions.values()], []), direction };
    }

    function reduceCrossings(layers, ranks, edges) {
        const orderedRanks = [...layers.keys()].sort((left, right) => left - right);
        for (let iteration = 0; iteration < 2; iteration += 1) {
            for (let index = 1; index < orderedRanks.length; index += 1) {
                const currentRank = orderedRanks[index];
                reorderLayer(layers.get(currentRank), nodeOrder(layers), (nodeId) =>
                    edges
                        .filter((edge) => edge.target === nodeId && ranks.get(edge.source) < currentRank)
                        .map((edge) => edge.source)
                );
            }
            for (let index = orderedRanks.length - 2; index >= 0; index -= 1) {
                const currentRank = orderedRanks[index];
                reorderLayer(layers.get(currentRank), nodeOrder(layers), (nodeId) =>
                    edges
                        .filter((edge) => edge.source === nodeId && ranks.get(edge.target) > currentRank)
                        .map((edge) => edge.target)
                );
            }
        }
    }

    function reorderLayer(layer, order, neighborsFor) {
        const score = new Map(layer.map((node) => {
            const neighbors = neighborsFor(node.id).map((id) => order.get(id)).filter(Number.isInteger);
            return [node.id, neighbors.length
                ? neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length
                : null];
        }));
        layer.sort((left, right) => {
            const leftScore = score.get(left.id);
            const rightScore = score.get(right.id);
            if (leftScore !== null && rightScore !== null && leftScore !== rightScore) return leftScore - rightScore;
            if (leftScore !== null && rightScore === null) return -1;
            if (leftScore === null && rightScore !== null) return 1;
            return nodePriority(left) - nodePriority(right) || compareNodes(left, right);
        });
    }

    function nodeOrder(layers) {
        const order = new Map();
        for (const layer of layers.values()) {
            layer.forEach((node, index) => order.set(node.id, index));
        }
        return order;
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

    function measureNode(node, level) {
        if (node.kind === 'member-group') return { width: 220, height: 52 };
        if (node.kind === 'instance-group') return { width: 230, height: 66 };
        if (level === 'module' && node.kind === 'method') return { width: 154, height: 58 };
        if (node.kind === 'module') {
            if (level === 'system') return { width: 230, height: 112 };
            return { width: 300, height: 88 };
        }
        const labelWidth = Text.displayWidth(node.label || node.name || '');
        return { width: clamp(180 + Math.max(0, labelWidth - 18) * 4.2, 180, 230), height: 78 };
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

    function titleCase(value) {
        return String(value || '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, (character) => character.toUpperCase());
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

    return { layoutGraph };
});
