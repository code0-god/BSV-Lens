'use strict';

const { protocolChannelId } = require('./ids');

const INFERENCE_ORIGIN = 'source-derived';
const ANALYSIS_ORIGIN = 'Source-derived';

function buildProtocolChannels(endpoints) {
    const channels = [];
    const diagnostics = [];
    for (const [ownerId, owned] of groupBy(endpoints, (item) => item.ownerInstanceId)) {
        const methods = owned.filter(isExactTopLevelMethod);
        inferReadyChannels(ownerId, methods, channels, diagnostics);
        inferValidChannels(ownerId, methods, channels, diagnostics);
        inferRequestResponseChannels(ownerId, owned, channels, diagnostics);
    }
    return { channels, diagnostics };
}

function inferReadyChannels(ownerId, methods, channels, diagnostics) {
    const anchors = methods.filter(isBoolValue).map((endpoint) => ({
        endpoint,
        base: suffixBase(endpoint.name, 'Ready')
    })).filter((item) => item.base);
    const actions = methods.filter((endpoint) => isAction(endpoint) && endpoint.parameters.length > 0);
    const candidates = candidateMap(anchors, actions,
        (anchor, action) => matchesBasePrefix(action.name, anchor.base));
    emitUniqueProposals(ownerId, 'ready/action', anchors, candidates, channels, diagnostics,
        (anchor, action) => makeChannel(ownerId, anchor.base, 'input', action.parameters[0].type, {
            ready: anchor.endpoint.id,
            action: action.id
        }));
}

function inferValidChannels(ownerId, methods, channels, diagnostics) {
    const anchors = methods.filter(isBoolValue).map((endpoint) => ({
        endpoint,
        base: suffixBase(endpoint.name, 'Valid')
    })).filter((item) => item.base);
    const payloads = methods.filter((endpoint) => isValue(endpoint) && !isBool(endpoint));
    const consumes = methods.filter((endpoint) => isAction(endpoint) && endpoint.parameters.length === 0);
    const payloadCandidates = candidateMap(anchors, payloads,
        (anchor, payload) => matchesPayload(payload.name, anchor.base));
    const consumeCandidates = candidateMap(anchors, consumes,
        (anchor, consume) => matchesConsume(consume.name, anchor.base));

    for (const anchor of anchors) {
        const payload = uniqueCandidate(anchor, payloadCandidates);
        const consume = uniqueCandidate(anchor, consumeCandidates);
        if (isAmbiguous(anchor, payloadCandidates) || isShared(anchor, payloadCandidates)
            || isAmbiguous(anchor, consumeCandidates) || isShared(anchor, consumeCandidates)) {
            diagnostics.push(ambiguityDiagnostic(ownerId, 'valid/payload/consume', anchor,
                combinedCandidates(anchor, payloadCandidates, consumeCandidates)));
            continue;
        }
        if (!payload && !consume) continue;
        const methodIds = { valid: anchor.endpoint.id };
        if (payload) methodIds.payload = payload.id;
        if (consume) methodIds.consume = consume.id;
        channels.push(makeChannel(
            ownerId,
            anchor.base,
            payload ? (consume ? 'output-with-ack' : 'output') : 'ack',
            payload?.resultType || null,
            methodIds
        ));
    }
}

function inferRequestResponseChannels(ownerId, endpoints, channels, diagnostics) {
    const exact = endpoints.filter((endpoint) => endpoint.kind === 'subinterface-endpoint'
        && endpoint.resolutionStatus === 'exact' && endpoint.interfacePath.length > 0);
    for (const [parentKey, siblings] of groupBy(exact, (endpoint) =>
        endpoint.interfacePath.slice(0, -1).join('.'))) {
        const requests = siblings.filter((endpoint) => endpoint.name === 'requests');
        const responses = siblings.filter((endpoint) => endpoint.name === 'responses');
        if (!requests.length || !responses.length) continue;
        if (requests.length !== 1 || responses.length !== 1) {
            diagnostics.push(ambiguityDiagnostic(ownerId, 'request/response',
                { base: parentKey || rootChannelName(endpoints), endpoint: requests[0] || responses[0] },
                [...requests, ...responses]));
            continue;
        }
        const base = parentKey.split('.').filter(Boolean).pop() || rootChannelName(endpoints);
        channels.push(makeChannel(ownerId, base, 'request-response', null, {
            request: requests[0].id,
            response: responses[0].id
        }, `request-response:${parentKey || '$interface'}`));
    }
}

function emitUniqueProposals(ownerId, kind, anchors, candidates, channels, diagnostics, build) {
    for (const anchor of anchors) {
        if (isAmbiguous(anchor, candidates) || isShared(anchor, candidates)) {
            diagnostics.push(ambiguityDiagnostic(ownerId, kind, anchor, candidates.get(anchor) || []));
            continue;
        }
        const candidate = uniqueCandidate(anchor, candidates);
        if (candidate) channels.push(build(anchor, candidate));
    }
}

function candidateMap(anchors, candidates, matches) {
    const result = new Map(anchors.map((anchor) => [anchor, candidates.filter((item) => matches(anchor, item))]));
    result.uses = new Map();
    for (const values of result.values()) for (const value of values) {
        result.uses.set(value.id, (result.uses.get(value.id) || 0) + 1);
    }
    return result;
}

function uniqueCandidate(anchor, candidates) {
    const values = candidates.get(anchor) || [];
    return values.length === 1 ? values[0] : null;
}
function isAmbiguous(anchor, candidates) { return (candidates.get(anchor) || []).length > 1; }
function isShared(anchor, candidates) {
    const values = candidates.get(anchor) || [];
    return values.length === 1 && candidates.uses.get(values[0].id) > 1;
}
function combinedCandidates(anchor, ...maps) {
    return maps.flatMap((map) => map.get(anchor) || []);
}

function makeChannel(ownerId, base, direction, payloadType, methods, key = `${direction}:${base}`) {
    const name = upperFirst(base);
    return {
        id: protocolChannelId(ownerId, key),
        kind: 'protocol-channel',
        name,
        ownerInstanceId: ownerId,
        direction,
        payloadType,
        methods,
        inferenceOrigin: INFERENCE_ORIGIN,
        confidence: INFERENCE_ORIGIN,
        evidence: {
            rule: direction === 'request-response' ? 'exact-sibling-request-response' : 'exact-method-contract',
            endpointIds: Object.values(methods)
        },
        analysisOrigin: ANALYSIS_ORIGIN
    };
}

function ambiguityDiagnostic(ownerId, kind, anchor, candidates) {
    return {
        code: 'protocol.ambiguous',
        severity: 'info',
        message: `Ambiguous ${kind} protocol candidates for ${anchor.base}.`,
        ownerInstanceId: ownerId,
        endpointId: anchor.endpoint?.id || null,
        evidence: { candidateEndpointIds: [...new Set(candidates.map((item) => item.id))].sort() },
        location: anchor.endpoint?.location || null,
        analysisOrigin: ANALYSIS_ORIGIN
    };
}

function isExactTopLevelMethod(endpoint) {
    return endpoint.kind === 'method-endpoint' && endpoint.contractStatus === 'exact'
        && endpoint.interfacePath.length === 1;
}
function isValue(endpoint) {
    return endpoint.category === 'value' && endpoint.direction === 'output'
        && endpoint.parameters.length === 0;
}
function isBoolValue(endpoint) { return isValue(endpoint) && isBool(endpoint); }
function isBool(endpoint) { return String(endpoint.resultType || endpoint.returnType).trim() === 'Bool'; }
function isAction(endpoint) {
    return endpoint.category === 'action' && endpoint.direction === 'input'
        && endpoint.returnType === 'Action';
}
function suffixBase(name, suffix) {
    return name.endsWith(suffix) && name.length > suffix.length ? name.slice(0, -suffix.length) : null;
}
function matchesBasePrefix(name, base) {
    return name === base || (name.startsWith(base) && /^[A-Z0-9_$]/.test(name.slice(base.length, base.length + 1)));
}
function matchesPayload(name, base) {
    return matchesBasePrefix(name, base) || name === `current${upperFirst(base)}`;
}
function matchesConsume(name, base) {
    const titled = upperFirst(base);
    return name === `consume${titled}` || name === `complete${titled}`;
}
function rootChannelName(endpoints) {
    const root = endpoints.find((endpoint) => endpoint.kind === 'subinterface-endpoint'
        && endpoint.interfacePath.length === 0 && endpoint.resolutionStatus === 'exact');
    return String(root?.interfaceType || root?.name || 'RequestResponse').replace(/Ifc$/, '');
}
function upperFirst(value) { return value ? value[0].toUpperCase() + value.slice(1) : value; }
function groupBy(items, key) {
    const result = new Map();
    for (const item of items) {
        const value = key(item);
        result.set(value, [...(result.get(value) || []), item]);
    }
    return result;
}

module.exports = { buildProtocolChannels };
