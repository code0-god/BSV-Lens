'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { validateTrustedExternalPath, isPathInsideWorkspace } = require('../security/workspace-boundary');
const { hash, deepFreeze, failure, DEFAULT_LIMITS } = require('./json');
const { logicalRef, isHash } = require('./snapshot');

class ArtifactRegistry {
    #artifactRoots;
    #sourceRoots;
    #rootPaths = new Map();
    #artifacts = new Map();
    #sources = new Map();
    constructor({ artifactRoots, sourceRoots = [], resolvedRoots = false }) {
        if (typeof resolvedRoots !== 'boolean') throw failure('INVALID_INPUT', 'Resolved root policy must be boolean');
        for (const roots of [artifactRoots, sourceRoots]) {
            if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) throw failure('INVALID_INPUT', 'Absolute caller-approved roots required');
        }
        // Pin caller policy at construction; changes to its arrays cannot broaden access.
        this.#artifactRoots = [...artifactRoots];
        this.#sourceRoots = [...sourceRoots];
        if (resolvedRoots) for (const root of [...artifactRoots, ...sourceRoots]) this.#rootPaths.set(root, path.resolve(root));
    }
    async #resolve(roots, value) {
        if (typeof value !== 'string' || !path.isAbsolute(value)) throw failure('PATH_DENIED', 'An absolute registry-owned path is required');
        for (const root of roots) {
            if (!this.#rootPaths.has(root)) this.#rootPaths.set(root, await fs.realpath(root));
            const result = await validateTrustedExternalPath({ workspacePath: this.#rootPaths.get(root), value,
                allowTrustedExternal: false, workspaceTrusted: false, purpose: 'hardware input' });
            if (result.allowed && isPathInsideWorkspace(this.#rootPaths.get(root), result.path)) return result.path;
        }
        throw failure('PATH_DENIED', 'Path is outside caller-approved roots');
    }
    async #read(roots, value, maxBytes) {
        const resolved = await this.#resolve(roots, value);
        const handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const before = await handle.stat();
            if (!before.isFile()) throw failure('INVALID_INPUT', 'Hardware input must be a regular file');
            if (before.size > maxBytes) throw failure('LIMIT_EXCEEDED', 'File byte size limit');
            // A bounded read also bounds concurrent growth, unlike readFile after stat.
            const buffer = Buffer.alloc(Math.min(before.size + 1, maxBytes + 1));
            let total = 0;
            while (total < buffer.length) {
                const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
                if (!bytesRead) break;
                total += bytesRead;
            }
            const after = await handle.stat();
            const checked = await this.#resolve(roots, value);
            const current = await fs.stat(checked);
            if (checked !== resolved || before.dev !== current.dev || before.ino !== current.ino
                || before.size !== after.size || before.mtimeMs !== after.mtimeMs || total !== before.size) throw failure('PATH_DENIED', 'Input changed while reading');
            if (total > maxBytes) throw failure('LIMIT_EXCEEDED', 'File byte size limit');
            const bytes = buffer.subarray(0, total);
            const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            return { text, contentHash: hash(bytes) };
        } finally { await handle.close(); }
    }
    async registerArtifact({ pathRef, path: value }) {
        logicalRef(pathRef);
        if (this.#artifacts.has(pathRef)) throw failure('INVALID_INPUT', 'Artifact ref already registered');
        await this.#read(this.#artifactRoots, value, DEFAULT_LIMITS.maxBytes);
        if (this.#artifacts.has(pathRef)) throw failure('INVALID_INPUT', 'Artifact ref already registered');
        this.#artifacts.set(pathRef, value);
        return deepFreeze({ pathRef });
    }
    async registerSource({ pathRef, path: value, contentHash, capture = false }) {
        logicalRef(pathRef);
        if (!isHash(contentHash) || typeof capture !== 'boolean') throw failure('INVALID_INPUT', 'Source hash/capture required');
        if (this.#sources.has(pathRef)) throw failure('INVALID_INPUT', 'Source ref already registered');
        const source = await this.#read(this.#sourceRoots, value, DEFAULT_LIMITS.maxBytes);
        if (source.contentHash !== contentHash) throw failure('ARTIFACT_HASH_MISMATCH', 'Source hash mismatch at registration');
        if (this.#sources.has(pathRef)) throw failure('INVALID_INPUT', 'Source ref already registered');
        this.#sources.set(pathRef, { path: value, contentHash, captured: capture ? source.text : null });
        return deepFreeze({ pathRef, contentHash });
    }
    async readArtifact(pathRef, maxBytes = DEFAULT_LIMITS.maxBytes) {
        logicalRef(pathRef);
        if (!this.#artifacts.has(pathRef)) throw failure('PATH_DENIED', 'Unregistered artifact ref');
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_LIMITS.maxBytes) throw failure('INVALID_INPUT', 'Invalid artifact byte limit');
        return this.#read(this.#artifactRoots, this.#artifacts.get(pathRef), maxBytes);
    }
    async readSource({ pathRef, contentHash, range }) {
        logicalRef(pathRef);
        if (!isHash(contentHash)) throw failure('INVALID_INPUT', 'Source contentHash required');
        if (range !== undefined && (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
            || range.start < 0 || range.end < range.start)) throw failure('INVALID_INPUT', 'Invalid UTF-16 half-open range');
        const entry = this.#sources.get(pathRef);
        if (!entry) return deepFreeze({ status: 'unavailable', reason: 'unregistered-source' });
        let current, readError;
        try { current = await this.#read(this.#sourceRoots, entry.path, DEFAULT_LIMITS.maxBytes); }
        catch (error) { readError = { code: error.code || 'INVALID_INPUT', message: 'Registered source is not currently readable' }; }
        const status = current?.contentHash === contentHash ? 'current'
            : entry.contentHash === contentHash && entry.captured !== null ? 'captured' : current ? 'stale' : 'unavailable';
        if (status === 'stale' || status === 'unavailable') return deepFreeze({ status,
            reason: readError || 'source-hash-mismatch', currentHash: current?.contentHash || null });
        const text = status === 'current' ? current.text : entry.captured;
        if (range && range.end > text.length) throw failure('INVALID_INPUT', 'Source range exceeds hashed text');
        return deepFreeze({ status, freshness: status === 'current' ? 'fresh' : 'stale', pathRef, contentHash, text: range ? text.slice(range.start, range.end) : text,
            range: range ? { start: range.start, end: range.end } : { start: 0, end: text.length },
            ...(readError ? { currentError: readError } : {}) });
    }
    async checkFreshness(snapshot) {
        if (snapshot.sourceInputs === null) return deepFreeze({ snapshotId: snapshot.id, freshness: 'unknown', reason: 'unknown-source-inputs' });
        const inputs = [];
        for (const input of snapshot.sourceInputs) {
            const entry = this.#sources.get(input.pathRef);
            if (!entry) { inputs.push({ pathRef: input.pathRef, status: 'unknown' }); continue; }
            try {
                const current = await this.#read(this.#sourceRoots, entry.path, DEFAULT_LIMITS.maxBytes);
                inputs.push({ pathRef: input.pathRef, status: current.contentHash === input.contentHash ? 'fresh' : 'stale' });
            } catch (error) { inputs.push({ pathRef: input.pathRef, status: 'unknown', error: { code: error.code || 'INVALID_INPUT', message: 'Registered source is not currently readable' } }); }
        }
        const freshness = inputs.some(i => i.status === 'stale') ? 'stale' : inputs.some(i => i.status === 'unknown') ? 'unknown' : 'fresh';
        return deepFreeze({ snapshotId: snapshot.id, freshness, reason: freshness === 'fresh' ? null : `${freshness}-source-inputs`, inputs });
    }
}
const createArtifactRegistry = policy => new ArtifactRegistry(policy);
module.exports = { ArtifactRegistry, createArtifactRegistry };
