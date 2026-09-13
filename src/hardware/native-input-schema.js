'use strict';

const path = require('node:path');
const { copyJson, DEFAULT_LIMITS, failure } = require('./json');
const { logicalRef, isHash, normalizeManifest } = require('./snapshot');
const LIMITS = Object.freeze({ maxFiles: 256, maxSourceBytes: 16 * 1024 * 1024,
    maxEvidenceBytes: 64 * 1024 * 1024, maxEntries: 65536,
    maxDirectories: 4096, maxDepth: 32, maxManifestBytes: 1024 * 1024 });
const invalid = message => { throw failure('INVALID_INPUT', message); };

function keys(value, allowed, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} object required`);
    if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`Unknown ${name} field`);
}
function relative(value) {
    if (typeof value !== 'string' || path.isAbsolute(value) || value.includes('%')) invalid('Relative input path required');
    return logicalRef(value);
}
function descriptor(value, extra = [], hashRequired = false) {
    keys(value, ['path', 'pathRef', 'contentHash', ...extra], 'file descriptor');
    const file = relative(value.path), pathRef = logicalRef(value.pathRef ?? file);
    if ((hashRequired || value.contentHash !== undefined) && !isHash(value.contentHash)) invalid('Input SHA256 required');
    return { ...value, path: file, pathRef };
}
function array(value, name, limit = LIMITS.maxFiles) {
    if (!Array.isArray(value) || value.length > limit) throw failure('LIMIT_EXCEEDED', `${name} document limit`);
    return value;
}
function artifact(value) {
    const result = descriptor(value, ['manifest']);
    return { ...result, manifest: normalizeManifest(result.manifest) };
}
function validateNativeManifest(value = { version: 1 }) {
    const raw = copyJson(value, { ...DEFAULT_LIMITS, maxBytes: LIMITS.maxManifestBytes, maxJsonDepth: 16, maxJsonNodes: 30000 });
    const pending = [raw];
    while (pending.length) {
        const item = pending.pop();
        if (!item || typeof item !== 'object') continue;
        if (Object.keys(item).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) invalid('Hostile manifest key');
        pending.push(...Object.values(item));
    }
    keys(raw, ['version', 'label', 'sources', 'artifact', 'metadata', 'generatedRtl', 'origin', 'sourceBindings'], 'native manifest');
    if (raw.version !== 1) throw failure('UNSUPPORTED', 'Native input manifest version 1 required');
    if (raw.label !== undefined && (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 256)) invalid('Invalid input label');
    const result = { ...raw };
    if (raw.sources !== undefined) result.sources = array(raw.sources, 'Source').map(value => descriptor(value));
    if (raw.artifact) result.artifact = artifact(raw.artifact);
    if (raw.metadata) {
        result.metadata = descriptor(raw.metadata, ['provider', 'sourceInputs'], true);
        if (raw.metadata.provider !== 'stock-bluetcl-v1') throw failure('UNSUPPORTED', 'Unsupported metadata provider');
        array(raw.metadata.sourceInputs, 'Metadata source');
        for (const source of raw.metadata.sourceInputs) {
            keys(source, ['pathRef', 'contentHash'], 'metadata source');
            logicalRef(source.pathRef);
            if (!isHash(source.contentHash)) invalid('Metadata source SHA256 required');
        }
    }
    if (raw.generatedRtl !== undefined) result.generatedRtl = array(raw.generatedRtl, 'Generated RTL').map(value => descriptor(value, [], true));
    if ((result.metadata || result.generatedRtl?.length) && !result.artifact) invalid('Compiler metadata requires an implementation artifact');
    if (result.generatedRtl?.length && !result.metadata) invalid('Generated RTL requires metadata');
    if (raw.origin) {
        keys(raw.origin, ['artifact', 'sidecar', 'files', 'authority'], 'origin');
        const authority = raw.origin.authority;
        keys(authority, ['provider', 'compilerBinarySha256', 'patchSha256', 'originAdapterSha256', 'sourcePin'], 'origin authority');
        if (authority.provider !== 'isolated-bsc-ghc96-root-observer-v1') throw failure('UNSUPPORTED', 'Unsupported origin provider');
        for (const field of ['compilerBinarySha256', 'patchSha256', 'originAdapterSha256']) if (!isHash(authority[field])) invalid('Origin provenance SHA256 required');
        if (typeof authority.sourcePin !== 'string' || !authority.sourcePin || authority.sourcePin.length > 1024) invalid('Origin source pin required');
        const files = array(raw.origin.files, 'Origin', 512).map(value => {
            const file = descriptor(value, ['captureRef', 'kind'], true);
            logicalRef(file.captureRef);
            if (!['source', 'artifact'].includes(file.kind)) invalid('Invalid origin file kind');
            return file;
        });
        result.origin = { artifact: artifact(raw.origin.artifact), sidecar: descriptor(raw.origin.sidecar, [], true), files, authority };
    }
    if (raw.sourceBindings !== undefined) {
        array(raw.sourceBindings, 'Source binding');
        if (!result.origin && raw.sourceBindings.length) invalid('Source bindings require origin capture');
        for (const binding of raw.sourceBindings) {
            keys(binding, ['sourcePathRef', 'sourceRevision', 'originPathRef', 'originRevision'], 'source binding');
            logicalRef(binding.sourcePathRef); logicalRef(binding.originPathRef);
            if (!isHash(binding.sourceRevision) || !isHash(binding.originRevision)) invalid('Binding source SHA256 required');
        }
    }
    return result;
}

module.exports = { validateNativeManifest, LIMITS, relative };
