'use strict';

const { buildDefinitions } = require('../../architecture/semantic/definitions');
const { sourceModuleIndex, targetConstructor } = require('../../architecture/semantic/instances');
const { hash, stable, failure } = require('../json');

const sourceIdentity = documents => hash(stable(documents.map(({ pathRef, contentHash, revision }) => ({ pathRef, contentHash, revision }))));

function moduleIndex(documents, parsed) {
    const definitions = buildDefinitions(parsed), index = sourceModuleIndex(definitions, parsed);
    const byPath = new Map(documents.map(document => [document.pathRef, document]));
    const rootCount = index.modules.filter(module => !index.instantiated.has(module.id)).length;
    const entries = index.modules.map(module => {
        const document = byPath.get(module.uri), rootCandidate = !rootCount || !index.instantiated.has(module.id);
        return { id: hash(stable({ pathRef: module.uri, revision: document.contentHash, definitionId: module.id })),
            definitionId: module.id, pathRef: module.uri, revision: document.contentHash,
            name: module.name, label: module.name, packageName: module.packageName,
            sourceRange: module.sourceRange, rootCandidate,
            rootReason: rootCandidate ? rootCount ? 'uninstantiated' : 'cycle-fallback' : 'instantiated-source-module' };
    });
    return { ...index, entries, definitions, byPath };
}

function buildSourceIndex(documents, parsed) {
    const { entries } = moduleIndex(documents, parsed), sourceSetIdentity = sourceIdentity(documents);
    return { schemaVersion: 1, id: `source-index-${sourceSetIdentity}`, sourceSetIdentity,
        status: entries.length > 1024 ? 'limited' : 'complete', sourceFiles: documents.length,
        totalEntries: entries.length, entryLimit: 1024, entries: entries.slice(0, 1024) };
}

function selectSourceEntry(documents, parsed, entry) {
    const index = moduleIndex(documents, parsed);
    const matches = index.entries.filter(candidate => candidate.pathRef === entry.pathRef
        && candidate.revision === entry.revision && candidate.definitionId === entry.definitionId);
    if (matches.length !== 1) throw failure('SOURCE_REVISION_MISMATCH', 'Selected source module is unavailable in this registered revision');
    const selected = matches[0], byPackage = new Map(), files = new Map(parsed.map(file => [file.uri, file]));
    for (const file of parsed) byPackage.set(file.packageName, [...(byPackage.get(file.packageName) || []), file]);
    const included = new Set([selected.pathRef]), queue = [selected.pathRef], unresolvedImports = [];
    const include = uri => { if (!included.has(uri)) { included.add(uri); queue.push(uri); } };
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const file = files.get(queue[cursor]);
        for (const imported of file.imports || []) {
            const candidates = byPackage.get(imported.package) || [];
            if (!candidates.length) unresolvedImports.push({ pathRef: file.uri, packageName: imported.package });
            for (const candidate of candidates) include(candidate.uri);
        }
        for (const owner of index.modules.filter(module => module.uri === file.uri)) {
            for (const declaration of owner.childInstanceDeclarations || []) {
                const name = targetConstructor(declaration), target = index.resolve(owner, name, null);
                for (const candidate of target ? [target] : index.byName.get(name) || []) include(candidate.uri);
            }
        }
    }
    const scoped = documents.filter(document => included.has(document.pathRef));
    const sourceScope = { kind: 'selected-source-entry', entry: { pathRef: selected.pathRef,
        revision: selected.revision, definitionId: selected.definitionId }, inventorySourceSetIdentity: sourceIdentity(documents),
    sourceSetIdentity: sourceIdentity(scoped), inventoryFiles: documents.length, analyzedFiles: scoped.length,
    included: scoped.map(({ pathRef, contentHash }) => ({ pathRef, revision: contentHash })),
    excluded: documents.filter(document => !included.has(document.pathRef)).map(({ pathRef, contentHash }) => ({ pathRef,
        revision: contentHash, reason: 'outside-selected-entry-source-dependencies' })), unresolvedImports };
    return { documents: scoped, parsed: parsed.filter(file => included.has(file.uri)),
        top: selected.definitionId, sourceScope };
}

module.exports = { buildSourceIndex, selectSourceEntry };
