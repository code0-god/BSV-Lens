'use strict';

const path = require('path');
const { simpleGlobToRegExp } = require('./source-utils');

const DEFAULT_EXCLUDE = [
    '**/.git/**',
    '**/node_modules/**',
    '**/build/**',
    '**/out/**',
    '**/generated/**',
    '**/target/**'
];

function parseJsonc(text, source = '.bsv-arch.json') {
    try {
        return JSON.parse(stripJsonComments(text));
    } catch (error) {
        const wrapped = new Error(`Cannot parse ${source}: ${error.message}`);
        wrapped.cause = error;
        throw wrapped;
    }
}

function stripJsonComments(text) {
    let result = '';
    let state = 'normal';
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
        const current = text[index];
        const next = text[index + 1];

        if (state === 'line-comment') {
            if (current === '\n') {
                result += current;
                state = 'normal';
            } else {
                result += ' ';
            }
            continue;
        }

        if (state === 'block-comment') {
            if (current === '*' && next === '/') {
                result += '  ';
                index += 1;
                state = 'normal';
            } else {
                result += current === '\n' ? '\n' : ' ';
            }
            continue;
        }

        if (state === 'string') {
            result += current;
            if (!escaped && current === '"') state = 'normal';
            if (current === '\\' && !escaped) escaped = true;
            else escaped = false;
            continue;
        }

        if (current === '"') {
            result += current;
            state = 'string';
            escaped = false;
        } else if (current === '/' && next === '/') {
            result += '  ';
            index += 1;
            state = 'line-comment';
        } else if (current === '/' && next === '*') {
            result += '  ';
            index += 1;
            state = 'block-comment';
        } else {
            result += current;
        }
    }

    return result;
}

function normalizeConfig(raw = {}, context = {}) {
    const settingsExclude = Array.isArray(context.settingsExclude) ? context.settingsExclude : [];
    const sourceRoots = normalizeStringArray(raw.sourceRoots);
    const exclude = uniqueStrings([
        ...DEFAULT_EXCLUDE,
        ...settingsExclude,
        ...normalizeStringArray(raw.exclude)
    ]);

    const groups = Array.isArray(raw.groups)
        ? raw.groups.map(normalizeGroup).filter(Boolean)
        : [];
    const virtualNodes = Array.isArray(raw.virtualNodes)
        ? raw.virtualNodes.map(normalizeVirtualNode).filter(Boolean)
        : [];
    const edges = Array.isArray(raw.edges)
        ? raw.edges.map(normalizeEdge).filter(Boolean)
        : [];

    return {
        version: Number.isInteger(raw.version) ? raw.version : 1,
        title: typeof raw.title === 'string' && raw.title.trim()
            ? raw.title.trim()
            : (context.workspaceName ? `${context.workspaceName} BSV Architecture` : 'BSV Architecture'),
        sourceRoots,
        exclude,
        entrypoints: normalizeStringArray(raw.entrypoints),
        groups,
        nodes: raw.nodes && typeof raw.nodes === 'object' && !Array.isArray(raw.nodes) ? raw.nodes : {},
        virtualNodes,
        edges,
        view: {
            direction: raw.view?.direction === 'TB' ? 'TB' : 'LR',
            showImports: raw.view?.showImports === true,
            showPackages: raw.view?.showPackages === true,
            showPrimitives: raw.view?.showPrimitives === undefined
                ? context.settingsShowPrimitives === true
                : raw.view.showPrimitives === true
        },
        configPath: context.configPath || null
    };
}

function normalizeGroup(group, index) {
    if (!group || typeof group !== 'object') return null;
    const id = String(group.id || `group-${index + 1}`).trim();
    const label = String(group.label || id).trim();
    const match = String(group.match || '**').replace(/\\/g, '/');
    if (!id || !label) return null;
    return {
        id,
        label,
        match,
        description: typeof group.description === 'string' ? group.description.trim() : '',
        order: Number.isFinite(group.order) ? group.order : index
    };
}

function normalizeVirtualNode(node, index) {
    if (!node || typeof node !== 'object') return null;
    const id = String(node.id || `virtual-${index + 1}`).trim();
    const label = String(node.label || node.name || id).trim();
    if (!id || !label) return null;
    return {
        id: `virtual:${id}`,
        sourceId: id,
        name: String(node.name || label),
        label,
        kind: String(node.kind || 'external'),
        group: node.group ? String(node.group) : 'external',
        description: typeof node.description === 'string' ? node.description : '',
        annotations: {
            entry: node.entry === true,
            hide: node.hide === true
        },
        virtual: true,
        location: null,
        relativePath: null,
        packageName: null
    };
}

function normalizeEdge(edge, index) {
    if (!edge || typeof edge !== 'object' || !edge.from || !edge.to) return null;
    return {
        id: `manual:${index}:${edge.from}->${edge.to}`,
        from: String(edge.from),
        to: String(edge.to),
        kind: String(edge.kind || 'data'),
        label: typeof edge.label === 'string' ? edge.label : '',
        description: typeof edge.description === 'string' ? edge.description : '',
        manual: true
    };
}

function resolveNodeOverride(config, node) {
    const candidates = [
        node.id,
        node.name,
        node.packageName && node.name ? `${node.packageName}.${node.name}` : null
    ].filter(Boolean);
    for (const key of candidates) {
        const override = config.nodes[key];
        if (override && typeof override === 'object') return override;
    }
    return null;
}

function applyNodeConfiguration(node, config) {
    const override = resolveNodeOverride(config, node) || {};
    const annotations = node.annotations || {};
    const group = override.group || annotations.group || node.group || groupForPath(config, node.relativePath);
    return {
        ...node,
        label: override.label || annotations.label || node.label || node.name,
        kind: override.kind || annotations.kind || node.kind,
        group,
        description: override.description || annotations.description || node.description || '',
        hidden: override.hide === true || annotations.hide === true || node.hidden === true,
        entry: override.entry === true || annotations.entry === true || config.entrypoints.includes(node.name)
    };
}

function groupForPath(config, relativePath) {
    const normalized = String(relativePath || '').replace(/\\/g, '/');
    for (const group of [...config.groups].sort((left, right) => left.order - right.order)) {
        if (simpleGlobToRegExp(group.match).test(normalized)) return group.id;
    }

    const directory = path.posix.dirname(normalized);
    const segments = directory.split('/').filter(Boolean);
    if (segments.length === 0) return 'root';
    const sourceIndex = segments.lastIndexOf('src');
    return sourceIndex >= 0 && segments[sourceIndex + 1]
        ? segments[sourceIndex + 1]
        : segments[segments.length - 1];
}

function matchesAnyGlob(relativePath, patterns) {
    const normalized = String(relativePath || '').replace(/\\/g, '/');
    return patterns.some((pattern) => simpleGlobToRegExp(String(pattern).replace(/\\/g, '/')).test(normalized));
}

function makeStarterConfig(workspaceName = 'BSV Project') {
    return {
        version: 1,
        title: `${workspaceName} BSV Architecture`,
        sourceRoots: [],
        exclude: [
            '**/tb/**',
            '**/test/**',
            '**/tests/**',
            '**/testbench/**',
            '**/experimental/**'
        ],
        entrypoints: [],
        groups: [],
        nodes: {},
        virtualNodes: [],
        edges: [],
        view: {
            direction: 'LR',
            showPackages: false,
            showImports: false,
            showPrimitives: false
        }
    };
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item).trim()).filter(Boolean);
}

function uniqueStrings(values) {
    return [...new Set(values)];
}

module.exports = {
    DEFAULT_EXCLUDE,
    applyNodeConfiguration,
    groupForPath,
    makeStarterConfig,
    matchesAnyGlob,
    normalizeConfig,
    parseJsonc,
    resolveNodeOverride,
    stripJsonComments
};
