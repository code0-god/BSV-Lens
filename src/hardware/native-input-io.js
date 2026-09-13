'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createArtifactRegistry } = require('./registry');
const { hash, failure } = require('./json');
const { isPathInsideWorkspace } = require('../security/workspace-boundary');
const { LIMITS, relative } = require('./native-input-schema');
const excluded = new Set(['node_modules', 'build', 'out']);
function cancelled(signal) { if (signal?.aborted) throw failure('CANCELLED', 'Native input preparation cancelled'); }

async function approvedRoot(value, grant) {
    if (value === undefined || value === null) {
        if (grant != null) throw failure('PATH_DENIED', 'Root grant has no selected path');
        return null;
    }
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw failure('PATH_DENIED', 'Absolute host-approved local root required');
    if (grant != null && (!grant || typeof grant !== 'object' || Array.isArray(grant)
        || Object.keys(grant).some(key => !['path', 'dev', 'ino'].includes(key))
        || grant.path !== value || path.resolve(value) !== value || !Number.isSafeInteger(grant.dev) || grant.dev < 0
        || !Number.isSafeInteger(grant.ino) || grant.ino < 0)) throw failure('PATH_DENIED', 'Invalid pinned root grant');
    const resolved = await fs.realpath(value);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw failure('PATH_DENIED', 'Input root must be a directory');
    if (grant != null && (resolved !== grant.path || stat.dev !== grant.dev || stat.ino !== grant.ino)) throw failure('PATH_DENIED', 'Selected root changed since host approval');
    return resolved;
}
async function discoverSources(root, signal) {
    if (!root) return [];
    const pending = [{ directory: root, depth: 0 }], files = [];
    let directories = 0, visitedEntries = 0;
    while (pending.length) {
        cancelled(signal);
        const { directory, depth } = pending.pop();
        if (++directories > LIMITS.maxDirectories || depth > LIMITS.maxDepth) throw failure('LIMIT_EXCEEDED', 'Source discovery directory/depth limit');
        const resolved = await fs.realpath(directory);
        if (!isPathInsideWorkspace(root, resolved)) throw failure('PATH_DENIED', 'Source directory escaped approved root');
        const before = await fs.stat(resolved);
        const entries = [];
        for await (const entry of await fs.opendir(resolved)) {
            cancelled(signal);
            if (++visitedEntries > LIMITS.maxEntries) throw failure('LIMIT_EXCEEDED', 'Source discovery entry limit');
            entries.push(entry);
        }
        const current = await fs.stat(await fs.realpath(directory));
        if (current.dev !== before.dev || current.ino !== before.ino) throw failure('PATH_DENIED', 'Source directory changed during discovery');
        for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
            const file = path.join(resolved, entry.name);
            if (entry.isSymbolicLink()) throw failure('PATH_DENIED', 'Select source files without discovery symlinks');
            if (entry.isDirectory()) pending.push({ directory: file, depth: depth + 1 });
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bsv')) {
                files.push({ path: path.relative(root, file).split(path.sep).join('/') });
                if (files.length > LIMITS.maxFiles) throw failure('LIMIT_EXCEEDED', 'Source document limit');
            }
        }
    }
    return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function createInputReader({ sourceRoot, artifactRoot, rootGrants, signal, maxSourceFileBytes = LIMITS.maxSourceBytes }) {
    if (!Number.isSafeInteger(maxSourceFileBytes) || maxSourceFileBytes < 1 || maxSourceFileBytes > LIMITS.maxSourceBytes)
        throw failure('INVALID_INPUT', 'Invalid native source file byte limit');
    const registry = createArtifactRegistry({ artifactRoots: artifactRoot ? [artifactRoot] : [], sourceRoots: sourceRoot ? [sourceRoot] : [], resolvedRoots: true });
    const sourceReader = createArtifactRegistry({ artifactRoots: sourceRoot ? [sourceRoot] : [], resolvedRoots: true });
    const registered = new Map(), sources = [], watchFiles = new Set();
    let sourceBytes = 0, evidenceBytes = 0;
    async function read(descriptor, kind) {
        cancelled(signal);
        const root = kind === 'source' ? sourceRoot : artifactRoot;
        if (!root) throw failure('PATH_DENIED', `Host-approved ${kind} root required`);
        await approvedRoot(root, rootGrants?.[kind === 'source' ? 'sourceRoot' : 'artifactRoot']);
        const file = path.join(root, relative(descriptor.path)), pathRef = descriptor.pathRef ?? descriptor.path;
        const prior = registered.get(pathRef);
        if (prior) {
            if (prior.path !== file || prior.kind !== kind || descriptor.contentHash && prior.contentHash !== descriptor.contentHash) throw failure('INVALID_INPUT', 'Conflicting logical input reference');
            return prior;
        }
        const reader = kind === 'source' ? sourceReader : registry;
        await reader.registerArtifact({ pathRef, path: file });
        const result = kind === 'source' ? await reader.readArtifact(pathRef, maxSourceFileBytes) : await reader.readArtifact(pathRef);
        await approvedRoot(root, rootGrants?.[kind === 'source' ? 'sourceRoot' : 'artifactRoot']);
        cancelled(signal);
        if (descriptor.contentHash && result.contentHash !== descriptor.contentHash) throw failure('ARTIFACT_HASH_MISMATCH', 'Native input differs from declared SHA256');
        const row = { pathRef, path: file, revision: result.contentHash, contentHash: result.contentHash,
            ...(kind === 'source' ? { capturedText: result.text } : {}), kind, bytes: Buffer.byteLength(result.text) };
        if (kind === 'source') {
            sourceBytes += row.bytes;
            if (sourceBytes > LIMITS.maxSourceBytes || sources.length >= LIMITS.maxFiles) throw failure('LIMIT_EXCEEDED', 'Native source byte/document limit');
            await registry.registerSource({ pathRef, path: file, contentHash: row.contentHash, capture: true });
            sources.push(row);
        } else {
            evidenceBytes += row.bytes;
            if (evidenceBytes > LIMITS.maxEvidenceBytes) throw failure('LIMIT_EXCEEDED', 'Native evidence byte limit');
        }
        registered.set(pathRef, row); watchFiles.add(file);
        return row;
    }
    async function verify() {
        for (const row of registered.values()) {
            cancelled(signal);
            const current = row.kind === 'source'
                ? await registry.readSource({ pathRef: row.pathRef, contentHash: row.contentHash })
                : await registry.readArtifact(row.pathRef);
            if (row.kind === 'source' && current.status !== 'current' || hash(current.text || '') !== row.contentHash) throw failure('STALE_SOURCE', 'Input changed during native preparation');
        }
    }
    return { registry, sources, watchFiles, registered, read, verify };
}

module.exports = { approvedRoot, discoverSources, createInputReader, cancelled };
