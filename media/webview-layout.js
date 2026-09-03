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

    function layoutByRanks(nodes, edges, sizes, direction, focusId) {
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
        return positionByRanks(nodes, sizes, direction, rank, relevant);
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

    function positionByRanks(nodes, sizes, direction, rank, edges = [], crossGap = 28) {
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
