'use strict';

function resolveArchitectureSymbol(reference, options = {}) {
    const value = String(reference || '').trim();
    if (!value) return unresolved('Reference is empty.');
    const nodes = (options.nodes || []).filter((node) =>
        !options.kinds || options.kinds.includes(node.kind)
    );
    const nodeById = options.nodeById || new Map(nodes.map((node) => [node.id, node]));
    const exactId = nodeById.get(value) || nodeById.get(`virtual:${value}`);
    if (exactId && eligible(exactId, options)) return exact(exactId, 'architecture-id');

    const normalizeName = options.normalizeName || String;
    const normalizedReference = normalizeName(value);
    const matching = nodes.filter((node) =>
        normalizeName(node.name) === normalizedReference
        || normalizeName(node.sourceId) === normalizedReference
    );
    const qualified = value.replace(/::/g, '.').split('.').filter(Boolean);

    if (qualified.length === 2) {
        const result = decide(nodes.filter((node) =>
            node.packageName === qualified[0]
            && normalizeName(node.name) === normalizeName(qualified[1])
        ), 'package-qualified');
        if (result.status !== 'unresolved') return result;
    }

    if (qualified.length >= 3) {
        const packageName = qualified[0];
        const moduleName = qualified.at(-2);
        const memberName = qualified.at(-1);
        const result = decide(nodes.filter((node) =>
            node.packageName === packageName
            && normalizeName(node.name) === normalizeName(memberName)
            && ownerName(node, nodeById) === moduleName
        ), 'package-module-member');
        if (result.status !== 'unresolved') return result;
    }

    if (options.packageName) {
        const result = decide(matching.filter((node) => node.packageName === options.packageName), 'same-package');
        if (result.status !== 'unresolved') return result;
    }

    if (options.importedPackages?.length) {
        const imports = new Set(options.importedPackages);
        const result = decide(matching.filter((node) => imports.has(node.packageName)), 'imported-package');
        if (result.status !== 'unresolved') return result;
    }

    if (options.topModule) {
        const result = decide(matching.filter((node) =>
            node.name === options.topModule || ownerName(node, nodeById) === options.topModule
        ), 'top-module');
        if (result.status !== 'unresolved') return result;
    }

    if (matching.length === 1) return exact(matching[0], 'unique-global');
    if (matching.length > 1) return ambiguous(matching);
    return unresolved(`No architecture symbol matches ${value}.`);
}

function decide(candidates, scope) {
    if (candidates.length === 1) return exact(candidates[0], scope);
    if (candidates.length > 1) return ambiguous(candidates);
    return unresolved(`No candidate in ${scope} scope.`);
}

function ownerName(node, nodeById) {
    return node.parentId ? nodeById.get(node.parentId)?.name || null : null;
}

function eligible(node, options) {
    return !options.kinds || options.kinds.includes(node.kind);
}

function exact(node, scope) {
    return { status: 'exact', node, scope };
}

function ambiguous(candidates) {
    return {
        status: 'ambiguous',
        candidates: [...candidates].sort((left, right) => left.id.localeCompare(right.id))
    };
}

function unresolved(reason) {
    return { status: 'unresolved', reason };
}

module.exports = {
    resolveArchitectureSymbol
};
