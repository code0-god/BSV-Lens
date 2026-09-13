'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createArtifactRegistry } = require('../hardware/registry');
const { checkedJson } = require('../hardware/correspondence/schema');
const { DEFAULT_LIMITS, deepFreeze, failure, record } = require('../hardware/json');
const { relative } = require('../hardware/native-input-schema');
const { approvedRoot, cancelled } = require('../hardware/native-input-io');
const { grantSubdirectory } = require('./hardware-authority');

const LIMITS = Object.freeze({ maxFiles: 64, maxEntries: 4096, maxDepth: 4, maxMilliseconds: 5000,
    maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, maxModules: 128,
    maxJsonDepth: 24, maxJsonNodes: 100000, maxRegistrationBytes: DEFAULT_LIMITS.maxBytes });
const excludedDirectories = new Set(['.git', 'node_modules', '.build', '.vscode-test', '.omx', '.omo', '.codegraph']);

function probe(text) {
    const raw = checkedJson(JSON.parse(text), { ...DEFAULT_LIMITS, maxBytes: LIMITS.maxTotalBytes,
        maxJsonDepth: LIMITS.maxJsonDepth, maxJsonNodes: LIMITS.maxJsonNodes });
    record(raw, 'artifact');
    if (!Object.hasOwn(raw, 'modules')) throw failure('UNSUPPORTED', 'Expected a Yosys JSON modules object');
    const modules = record(raw.modules, 'modules'), names = Object.keys(modules).sort();
    if (!names.length) throw failure('UNSUPPORTED', 'Artifact contains no module definitions');
    const declaredTops = [];
    for (const name of names) {
        if (!name || name.length > 1024) throw failure('INVALID_INPUT', 'Invalid module name');
        const module = record(modules[name], 'module');
        // A format probe is not the provider's connectivity, hierarchy or freshness validation.
        if (!['ports', 'cells', 'netnames'].some(field => Object.hasOwn(module, field)))
            throw failure('UNSUPPORTED', 'Module has no Yosys structural fields');
        for (const field of ['ports', 'cells', 'netnames', 'memories', 'processes', 'attributes', 'parameter_default_values'])
            if (Object.hasOwn(module, field)) record(module[field], field);
        if (module.attributes?.top === 1 || typeof module.attributes?.top === 'string' && /^0*1$/.test(module.attributes.top))
            declaredTops.push(name);
    }
    return { format: 'yosys-json-v1', verification: 'format-only', moduleCount: names.length,
        modules: names.slice(0, LIMITS.maxModules), declaredTops: declaredTops.slice(0, LIMITS.maxModules),
        moduleNamesLimited: names.length > LIMITS.maxModules, declaredTopCount: declaredTops.length,
        sourceRevision: null, buildRevision: null, freshness: 'unknown', correspondence: 'not-established' };
}

// The caller supplies a current Host grant for a selected output folder or registered artifact root.
// No workspace fallback, filename-based source join, import, task or compiler execution occurs here.
async function discoverArtifactCandidates({ grant, paths, signal } = {}) {
    if (signal != null && !(signal instanceof AbortSignal)) throw failure('INVALID_INPUT', 'Invalid discovery cancellation signal');
    if (!grant) throw failure('PATH_DENIED', 'An explicitly approved artifact folder is required');
    const pinned = { ...grant };
    if (paths !== undefined && (!Array.isArray(paths) || paths.length > LIMITS.maxFiles))
        throw failure('INVALID_INPUT', 'Bounded explicit artifact paths required');
    const selectedPaths = paths === undefined ? null : [...new Set(paths.map(relative))].sort();
    const verify = async () => { cancelled(signal); await approvedRoot(pinned.path, pinned); cancelled(signal); };
    await verify();
    const registry = createArtifactRegistry({ artifactRoots: [pinned.path], resolvedRoots: true });
    const candidates = [], rejected = [], exclusions = [], limitedReasons = new Set();
    const started = performance.now(); let visitedEntries = 0, inspectedFiles = 0, bytesRead = 0, skippedFiles = 0;
    const expired = () => {
        cancelled(signal);
        if (performance.now() - started <= LIMITS.maxMilliseconds) return false;
        limitedReasons.add('time-limit'); return true;
    };
    async function inspect(file) {
        if (expired()) return;
        if (inspectedFiles >= LIMITS.maxFiles) { limitedReasons.add('file-limit'); return; }
        inspectedFiles++;
        try {
            await verify();
            const parent = path.posix.dirname(file);
            await grantSubdirectory(pinned, parent);
            const absolute = path.join(pinned.path, file), stat = await fs.lstat(absolute);
            if (stat.isSymbolicLink() || !stat.isFile()) throw failure('PATH_DENIED', 'Candidate must be a regular file without a symlink');
            if (stat.size > LIMITS.maxFileBytes) throw failure('LIMIT_EXCEEDED', 'Candidate exceeds the format-probe file limit; choose it explicitly to import');
            if (bytesRead + stat.size > LIMITS.maxTotalBytes) { limitedReasons.add('byte-limit'); return; }
            if (expired()) return;
            await registry.registerArtifact({ pathRef: file, path: absolute });
            const content = await registry.readArtifact(file, LIMITS.maxFileBytes);
            bytesRead += Buffer.byteLength(content.text);
            await verify();
            if (bytesRead > LIMITS.maxTotalBytes) { limitedReasons.add('byte-limit'); return; }
            const metadata = probe(content.text);
            if (expired()) return;
            candidates.push({ path: file, filename: path.posix.basename(file), bytes: Buffer.byteLength(content.text),
                contentHash: content.contentHash, ...metadata });
        } catch (error) {
            if (error.code === 'CANCELLED') throw error;
            await verify();
            const code = error.code || 'INVALID_INPUT';
            if (code === 'LIMIT_EXCEEDED') limitedReasons.add('candidate-limit');
            rejected.push({ path: file, code, reason: code === 'INVALID_INPUT' ? 'Malformed or unsafe artifact JSON' : error.message });
        }
    }
    if (selectedPaths) {
        for (const file of selectedPaths) { if (expired()) break; await inspect(file); }
    } else {
        const pending = [{ directory: '.', depth: 0 }];
        while (pending.length && !expired() && !limitedReasons.has('file-limit') && !limitedReasons.has('entry-limit') && !limitedReasons.has('byte-limit')) {
            const { directory, depth } = pending.shift();
            await verify();
            let directoryGrant;
            try { directoryGrant = await grantSubdirectory(pinned, directory); }
            catch (error) {
                await verify(); rejected.push({ path: directory, code: error.code || 'PATH_DENIED', reason: 'Artifact folder is unavailable or outside its approved root' }); continue;
            }
            const entries = [];
            for await (const entry of await fs.opendir(directoryGrant.path)) {
                if (expired()) break;
                if (++visitedEntries > LIMITS.maxEntries) { limitedReasons.add('entry-limit'); break; }
                entries.push(entry);
            }
            await approvedRoot(directoryGrant.path, directoryGrant); await verify();
            for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
                if (expired()) break;
                const file = directory === '.' ? entry.name : `${directory}/${entry.name}`;
                if (entry.isSymbolicLink()) rejected.push({ path: file, code: 'PATH_DENIED', reason: 'Symlinks are not followed by artifact discovery' });
                else if (entry.isDirectory()) {
                    if (excludedDirectories.has(entry.name)) exclusions.push({ path: file, reason: 'cache-or-local-evidence' });
                    else if (depth >= LIMITS.maxDepth) { limitedReasons.add('depth-limit'); exclusions.push({ path: file, reason: 'depth-limit' }); }
                    else pending.push({ directory: file, depth: depth + 1 });
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) await inspect(file);
                else skippedFiles++;
            }
        }
    }
    await verify();
    return deepFreeze({ status: limitedReasons.size ? 'partial' : 'complete', candidates, rejected, exclusions,
        inspectedFiles, skippedFiles, visitedEntries, bytesRead, limitedReasons: [...limitedReasons].sort(), limits: LIMITS,
        scope: selectedPaths ? 'explicit-artifact-paths' : 'approved-output-folder',
        automaticallySelected: null, compilerExecuted: false, importExecuted: false, sourceJoinPerformed: false });
}

module.exports = { discoverArtifactCandidates, ARTIFACT_CANDIDATE_LIMITS: LIMITS };
