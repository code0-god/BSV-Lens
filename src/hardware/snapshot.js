'use strict';

const { copyJson, stable, hash, deepFreeze, failure, DEFAULT_LIMITS } = require('./json');
const { importYosys } = require('./yosys-json');
const INPUTS = ['sourceInputs', 'dependencyFingerprint', 'toolchain', 'passSequence', 'buildOptionsFingerprint', 'concreteParameters'];
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0;
function logicalRef(value) {
    if (!text(value) || value.length > 512 || /[:\\\x00-\x1f]/.test(value) || value.startsWith('/')
        || value.split('/').some(part => !part || part === '.' || part === '..')) throw failure('INVALID_INPUT', 'Invalid logical pathRef');
    return value;
}
function normalizeManifest(value = {}) {
    const raw = copyJson(value, DEFAULT_LIMITS);
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw failure('INVALID_INPUT', 'Manifest object required');
    for (const key of Object.keys(raw)) if (!['stage', 'tops', ...INPUTS].includes(key)) throw failure('INVALID_INPUT', `Unknown manifest field: ${key}`);
    if (raw.stage != null && !text(raw.stage)) throw failure('INVALID_INPUT', 'Invalid declared stage');
    if (raw.tops != null && (!Array.isArray(raw.tops) || !raw.tops.length || raw.tops.some(v => !text(v))
        || new Set(raw.tops).size !== raw.tops.length)) throw failure('INVALID_INPUT', 'Manifest tops must be nonempty and unique');
    const manifest = { stage: raw.stage ?? null, tops: raw.tops == null ? null : [...raw.tops].sort() };
    for (const key of INPUTS) manifest[key] = raw[key] ?? null;
    if (manifest.sourceInputs !== null) {
        if (!Array.isArray(manifest.sourceInputs)) throw failure('INVALID_INPUT', 'Invalid sourceInputs');
        const refs = new Set();
        for (const input of manifest.sourceInputs) {
            if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['pathRef', 'contentHash', 'role'].includes(k))
                || !isHash(input.contentHash) || !['source', 'library', 'include', 'configuration'].includes(input.role)) throw failure('INVALID_INPUT', 'Invalid source input');
            logicalRef(input.pathRef);
            if (refs.has(input.pathRef)) throw failure('INVALID_INPUT', 'Duplicate source input');
            refs.add(input.pathRef);
        }
        manifest.sourceInputs = [...manifest.sourceInputs].sort((a, b) => a.pathRef < b.pathRef ? -1 : a.pathRef > b.pathRef ? 1 : 0);
    }
    for (const key of ['dependencyFingerprint', 'buildOptionsFingerprint']) {
        if (manifest[key] !== null && !isHash(manifest[key])) throw failure('INVALID_INPUT', `Invalid ${key} SHA256`);
    }
    if (manifest.toolchain !== null && (!Array.isArray(manifest.toolchain) || !manifest.toolchain.length
        || manifest.toolchain.some(t => !t || Object.keys(t).some(k => !['name', 'version', 'identity'].includes(k))
            || !text(t.name) || !text(t.version) || !text(t.identity)))) throw failure('INVALID_INPUT', 'Invalid toolchain');
    if (manifest.passSequence !== null && (!Array.isArray(manifest.passSequence) || manifest.passSequence.some(p => !text(p)))) throw failure('INVALID_INPUT', 'Invalid passSequence');
    const parameters = manifest.concreteParameters;
    if (parameters !== null && (typeof parameters !== 'object' || Array.isArray(parameters)
        || Object.values(parameters).some(p => typeof p !== 'string'))) throw failure('INVALID_INPUT', 'Invalid concreteParameters');
    return deepFreeze(manifest);
}
function buildSnapshot(artifactText, artifactRef, suppliedManifest, limits, expectedArtifactHash) {
    logicalRef(artifactRef);
    const manifest = normalizeManifest(suppliedManifest);
    const artifact = { hash: hash(artifactText), pathRef: artifactRef };
    if (expectedArtifactHash !== undefined && (!isHash(expectedArtifactHash) || expectedArtifactHash !== artifact.hash)) throw failure('ARTIFACT_HASH_MISMATCH', 'Artifact hash mismatch');
    const unknownInputs = ['stage', 'tops', ...INPUTS].filter(key => manifest[key] === null);
    const model = importYosys(artifactText, { ...manifest, artifact,
        snapshotSchemaVersion: 1, providerIdentity: 'yosys-json-v1',
        buildInputFingerprint: hash(stable(manifest)), ...(limits ? { limits } : {}) });
    const capabilities = { structuralImport: true, compilerExecution: false, cellSemantics: false,
        memorySemantics: false, originalBsvCorrespondence: false };
    const snapshot = deepFreeze({ ...model.snapshot, topSelection: model.topSelection || { basis: 'declared', tops: manifest.tops }, artifacts: [{ ...artifact, kind: 'yosys-json' }],
        inputCompleteness: unknownInputs.length ? 'partial' : 'complete', unknownInputs, capabilities, structure: 'verified' });
    const limitations = [];
    if (unknownInputs.length) limitations.push('unknown-build-inputs');
    if (Object.values(model.cells).some(c => c.semantics === 'unknown')) limitations.push('opaque-cell-semantics');
    if (Object.keys(model.memories).length) limitations.push('opaque-memory-semantics');
    if (Object.values(model.occurrences).some(o => o.blackbox)) limitations.push('black-box');
    if ([...Object.values(model.ports), ...Object.values(model.pins)].some(p => !p.direction || p.direction === 'unknown')) limitations.push('unknown-directions');
    return deepFreeze({ snapshot, implementation: { ...model, snapshot,
        id: `${snapshot.id}/implementation/yosys-json-v1`, hardwareSchemaVersion: 1 },
    availability: { snapshotId: snapshot.id, status: limitations.length ? 'partial' : 'ready', freshness: 'unknown',
        importStatus: limitations.length ? 'partial' : 'ready', importReason: limitations.join(',') || null, reason: limitations.join(',') || null },
    contracts: { sourceModel: { status: 'not-attached' }, bsvArchitecture: { status: 'not-attached' }, correspondence: { status: 'not-attached' } } });
}
function withFreshness(result, freshness) {
    return deepFreeze({ ...result, availability: { ...result.availability,
        ...freshness, reason: freshness.reason || result.availability.importReason,
        status: freshness.freshness === 'stale' ? 'stale' : freshness.freshness === 'unknown' ? 'partial' : result.availability.importStatus } });
}
module.exports = { normalizeManifest, buildSnapshot, logicalRef, isHash, withFreshness };
