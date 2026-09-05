(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SourceResolution = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const SEMANTIC_ROLES = new Set(['endpoint', 'behavior', 'occurrence']);
    const ROLE_PRIORITY = new Map([
        ['endpoint', 0],
        ['behavior', 1],
        ['occurrence', 2],
        ['definition', 3]
    ]);

    function resolve(model, sourceReference, context = {}) {
        const references = sourceReference?.status === 'unresolved'
            ? []
            : sourceReference?.references || [];
        const semanticIds = references.map((reference) => reference.id).sort(compareText);
        if (references.length === 0) return result('unresolved', semanticIds, []);

        const visible = idSet(context.visibleNodeIds);
        const view = idSet(context.viewNodeIds);
        const nodes = new Map((model?.nodes || []).map((node) => [node.id, node]));
        const focusId = context.focusInstanceId || null;
        const selectedId = context.selectedNodeId || null;
        const all = uniqueCandidates(references.flatMap((reference) => reference.presentations || []));
        if (all.length === 0) return result('outside-view', semanticIds, []);

        const semantic = all.filter((candidate) => SEMANTIC_ROLES.has(candidate.role));
        const definitions = all.filter((candidate) => candidate.role === 'definition');
        const semanticVisible = semantic.filter((candidate) => visible.has(candidate.id));
        const semanticInView = semantic.filter((candidate) => view.has(candidate.id));
        const definitionVisible = definitions.filter((candidate) => visible.has(candidate.id));
        const definitionInView = definitions.filter((candidate) => view.has(candidate.id));
        const useDefinitions = semanticVisible.length === 0
            && semanticInView.length === 0
            && (definitionVisible.length > 0 || definitionInView.length > 0);
        const canonical = useDefinitions ? definitions : semantic.length > 0 ? semantic : definitions;

        const focusHierarchy = focusId ? hierarchyIds(focusId, nodes) : new Set();
        const focused = focusHierarchy.size > 0
            ? canonical.filter((candidate) => candidateInHierarchy(candidate, focusId, focusHierarchy, nodes))
            : [];
        const focusedBest = bestPerOwner(focused);
        if (focusedBest.length === 1) return classifyUnique(focusedBest[0], semanticIds, visible, view, focusId);
        if (focusedBest.length > 1) return classifyMultiple(focusedBest, semanticIds, visible, view, focusId);

        const parentIds = new Set([selectedId, focusId].filter(Boolean));
        const parentMatches = bestPerOwner(canonical.filter((candidate) =>
            parentIds.has(candidate.ownerId) || parentIds.has(candidate.parentId)
        ));
        if (parentMatches.length === 1) return classifyUnique(parentMatches[0], semanticIds, visible, view, focusId);
        if (parentMatches.length > 1) return classifyMultiple(parentMatches, semanticIds, visible, view, focusId);

        const best = bestPerOwner(canonical);
        if (best.length === 1) return classifyUnique(best[0], semanticIds, visible, view, focusId);
        return classifyMultiple(best, semanticIds, visible, view, focusId);
    }

    function classifyUnique(candidate, semanticIds, visible, view, focusId) {
        if (visible.has(candidate.id)) return result('visible-exact', semanticIds, [candidate], candidate.id);
        if (focusId && view.has(candidate.id)) return result('outside-focus', semanticIds, [candidate]);
        return result('outside-view', semanticIds, [candidate]);
    }

    function classifyMultiple(candidates, semanticIds, visible, view, focusId) {
        const visibleCandidates = candidates.filter((candidate) => visible.has(candidate.id));
        if (visibleCandidates.length > 0) {
            // Preserve the complete canonical ambiguity, including collapsed or filtered peers.
            return result('visible-multiple', semanticIds, candidates);
        }
        const viewCandidates = candidates.filter((candidate) => view.has(candidate.id));
        if (focusId && viewCandidates.length > 0) {
            return result('outside-focus', semanticIds, viewCandidates);
        }
        return result('outside-view', semanticIds, candidates);
    }

    function bestPerOwner(candidates) {
        const byContext = new Map();
        for (const candidate of candidates) {
            const key = candidate.ownerId || candidate.parentId || candidate.id;
            const priority = rolePriority(candidate.role);
            const current = byContext.get(key);
            if (!current || priority < current.priority) {
                byContext.set(key, { priority, candidates: [candidate] });
            } else if (priority === current.priority) {
                current.candidates.push(candidate);
            }
        }
        return [...byContext.values()]
            .flatMap((entry) => entry.candidates)
            .sort((left, right) => compareText(left.id, right.id));
    }

    function candidateInHierarchy(candidate, focusId, hierarchy, nodes) {
        if (hierarchy.has(candidate.id) || hierarchy.has(candidate.ownerId) || hierarchy.has(candidate.parentId)) return true;
        for (const id of [candidate.ownerId, candidate.parentId]) {
            if (id && hierarchyIds(id, nodes).has(focusId)) return true;
        }
        return false;
    }

    function hierarchyIds(startId, nodes) {
        const result = new Set();
        let id = startId;
        while (id && !result.has(id)) {
            result.add(id);
            id = nodes.get(id)?.parentId || null;
        }
        return result;
    }

    function uniqueCandidates(candidates) {
        const result = new Map();
        for (const candidate of candidates.filter((item) => item?.id)) {
            const previous = result.get(candidate.id);
            if (!previous || rolePriority(candidate.role) < rolePriority(previous.role)) {
                result.set(candidate.id, candidate);
            }
        }
        return [...result.values()].sort((left, right) => compareText(left.id, right.id));
    }

    function rolePriority(role) {
        return ROLE_PRIORITY.get(role) ?? 9;
    }

    function idSet(values) {
        if (!values) return new Set();
        return values instanceof Set ? values : new Set(values);
    }

    function result(status, semanticIds, candidates, presentationNodeId = null) {
        return {
            status,
            semanticIds,
            candidates,
            presentationNodeIds: candidates.map((candidate) => candidate.id),
            presentationNodeId
        };
    }

    function compareText(left, right) {
        return String(left).localeCompare(String(right));
    }

    return { resolve };
}));
