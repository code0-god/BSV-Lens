'use strict';
const { checkedJson } = require('../hardware/correspondence/schema');
const { DEFAULT_LIMITS, failure, hash, stable } = require('../hardware/json');
const VIEW_FIELDS = ['buildId', 'snapshotId', 'sourceRevision', 'sceneKind', 'provider', 'rootInstanceId', 'ownerInstanceId',
    'selectedEntityId', 'selectedRelationId', 'viewport', 'viewportSize', 'viewportAnchor', 'activePanel', 'sourceContext', 'implementationContext', 'disclosureState', 'query'];
const QUERY_FIELDS = ['kind', 'analysisId', 'snapshotId', 'implementationProvider', 'stage', 'ownerInstanceId', 'implementationOccurrenceId',
    'seed', 'scope', 'direction', 'semanticsProfile', 'limits', 'mode'];
function fields(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
        throw failure('INVALID_INPUT', `Invalid ${name} fields`);
    }
}
function json(value) { return checkedJson(value, { ...DEFAULT_LIMITS, maxBytes: 16384, maxJsonDepth: 12, maxJsonNodes: 2048 }); }
function number(value, name, min = 0) {
    if (!Number.isFinite(value) || value < min || Math.abs(value) > 1e9) throw failure('INVALID_INPUT', `Invalid ${name}`);
}
function scalarMap(value, type, name) {
    fields(value, Object.keys(value || {}), name);
    if (Object.keys(value).length > 128) throw failure('LIMIT_EXCEEDED', `${name} count limit`);
    for (const item of Object.values(value)) {
        if (type === 'number') number(item, name);
        else if (typeof item !== type) throw failure('INVALID_INPUT', `Invalid ${name} value`);
    }
}
function stateValue(input) {
    const state = json(input); fields(state, ['schema', 'view'], 'saved state');
    if (state.schema !== 1) throw failure('UNSUPPORTED', 'Saved hardware state schema 1 required');
    if (state.view === null) return state;
    const view = state.view; fields(view, VIEW_FIELDS, 'saved view');
    for (const key of VIEW_FIELDS.filter(key => !['viewport', 'viewportSize', 'viewportAnchor', 'sourceContext', 'implementationContext', 'disclosureState', 'query'].includes(key))) {
        if (view[key] != null && (typeof view[key] !== 'string' || view[key].length > 4096)) throw failure('INVALID_INPUT', `Invalid saved ${key}`);
    }
    if (!['bsv', 'rtl'].includes(view.sceneKind) || !['stock', 'instrumented'].includes(view.provider)) throw failure('INVALID_INPUT', 'Invalid saved scene/provider');
    if (view.viewport != null) {
        fields(view.viewport, ['x', 'y', 'scale'], 'viewport'); number(view.viewport.x, 'viewport x', -1e9); number(view.viewport.y, 'viewport y', -1e9);
        number(view.viewport.scale, 'viewport scale', Number.EPSILON);
    }
    if ((view.viewportSize != null) !== (view.viewportAnchor != null)) throw failure('INVALID_INPUT', 'Viewport size and anchor must be stored together');
    if (view.viewportSize != null) {
        if (!view.viewport) throw failure('INVALID_INPUT', 'Viewport frame requires a transform');
        fields(view.viewportSize, ['width', 'height'], 'viewport size'); fields(view.viewportAnchor, ['x', 'y'], 'viewport anchor');
        for (const axis of ['width', 'height']) if (!Number.isSafeInteger(view.viewportSize[axis]) || view.viewportSize[axis] <= 0 || view.viewportSize[axis] > 65536)
            throw failure('INVALID_INPUT', 'Viewport size must be positive bounded CSS client pixels');
        number(view.viewportAnchor.x, 'viewport anchor x', -1e9); number(view.viewportAnchor.y, 'viewport anchor y', -1e9);
    }
    if (view.sourceContext != null) fields(view.sourceContext, ['buildId', 'snapshotId', 'provider', 'rootInstanceId', 'ownerInstanceId',
        'occurrencePath', 'selectedEntityId', 'selectedRelationId'], 'source context');
    if (view.implementationContext != null) fields(view.implementationContext, ['snapshotId', 'provider', 'modelId', 'stage',
        'contextOccurrenceId', 'rootOccurrenceId', 'parentOccurrenceId', 'occurrencePath'], 'implementation context');
    if (view.disclosureState != null) {
        const detail = view.disclosureState; fields(detail, ['capabilities', 'presentation', 'inspector', 'analysis'], 'disclosure');
        if (detail.capabilities !== undefined && typeof detail.capabilities !== 'boolean') throw failure('INVALID_INPUT', 'Invalid capabilities disclosure');
        if (detail.presentation != null) {
            const p = detail.presentation; fields(p, ['fit', 'inspectorOpen', 'selectionIds', 'preferredImplementationProvider'], 'presentation');
            if (p.fit !== undefined && !['structure', 'selection', 'manual'].includes(p.fit)
                || p.inspectorOpen !== undefined && typeof p.inspectorOpen !== 'boolean'
                || p.preferredImplementationProvider !== undefined && !['stock', 'instrumented'].includes(p.preferredImplementationProvider)
                || p.selectionIds !== undefined && (!Array.isArray(p.selectionIds) || p.selectionIds.some(id => typeof id !== 'string'))) throw failure('INVALID_INPUT', 'Invalid presentation state');
        }
        if (detail.inspector != null) {
            fields(detail.inspector, ['key', 'scrollTop'], 'inspector');
            if (detail.inspector.key != null && typeof detail.inspector.key !== 'string') throw failure('INVALID_INPUT', 'Invalid inspector key');
            if (detail.inspector.scrollTop !== undefined) number(detail.inspector.scrollTop, 'inspector scroll');
        }
        if (detail.analysis != null) {
            const a = detail.analysis; fields(a, ['codeSelection', 'sourceMode', 'codeOpen', 'codeScroll', 'disclosures'], 'analysis disclosure');
            if (a.codeSelection != null && typeof a.codeSelection !== 'string'
                || a.sourceMode !== undefined && !['build', 'current-source'].includes(a.sourceMode)
                || a.codeOpen !== undefined && typeof a.codeOpen !== 'boolean') throw failure('INVALID_INPUT', 'Invalid code disclosure');
            if (a.codeScroll != null) {
                fields(a.codeScroll, Object.keys(a.codeScroll), 'code scroll');
                const positions = Object.values(a.codeScroll);
                if (positions.length > 128) throw failure('LIMIT_EXCEEDED', 'code scroll count limit');
                for (const position of positions) {
                    fields(position, ['top', 'left'], 'code scroll position');
                    number(position.top, 'code scroll top'); number(position.left, 'code scroll left');
                }
            }
            if (a.disclosures != null) scalarMap(a.disclosures, 'boolean', 'code disclosures');
        }
    }
    if (view.query != null) fields(view.query, QUERY_FIELDS, 'saved query');
    return state;
}
function queryKey(buildId, query) {
    const copy = Object.fromEntries(QUERY_FIELDS.filter(key => query[key] !== undefined).map(key => [key, query[key]]));
    return hash(stable({ buildId, query: copy }));
}
function intentFor(view) {
    const intent = { buildId: view.buildId, snapshotId: view.snapshotId ?? null, queryGeneration: 0,
        sceneKind: view.sceneKind, implementationProvider: view.provider };
    for (const key of ['rootInstanceId', 'ownerInstanceId', 'selectedEntityId', 'selectedRelationId', 'sourceContext',
        'implementationContext', 'viewport', 'activePanel', 'disclosureState']) if (view[key] !== undefined) intent[key] = view[key];
    return intent;
}
function visitFor(scene, intent) {
    return { buildId: scene.provenance.buildId, snapshotId: scene.snapshotId, sceneId: scene.id,
        sourceRevision: scene.sourceRevision, sceneKind: scene.sceneKind, provider: scene.header.provider,
        rootInstanceId: scene.rootInstanceId, ownerInstanceId: scene.ownerInstanceId, ...scene.selection,
        sourceContext: scene.sourceContext, implementationContext: scene.implementationContext,
        disclosureState: scene.disclosureState, activePanel: scene.activePanel, viewport: intent.viewport || null };
}
module.exports = { fields, json, stateValue, queryKey, intentFor, visitFor };
