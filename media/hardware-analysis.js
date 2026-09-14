'use strict';

(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BsvHardwareAnalysis = api;
}(globalThis, function createApi() {
    // Presentation incidences are the only bridge from a drawn child formal to
    // an electrical endpoint in the current occurrence. IDs are never parsed.
    function seedChoices(scene, selectedId) {
        const context = scene.implementationContext;
        if (scene.sceneKind !== 'rtl') {
            if (!scene.contacts.some(c => c.id === selectedId)) return [];
            return scene.correspondence.stock.claims.filter(c => c.relationKind === 'ordered-port-binding'
                && c.validation === 'valid' && c.resolution === 'resolved').map(claim => ({
                id: claim.id, label: `${claim.method} / ${claim.role}`, status: 'reveal',
                positions: claim.orderedBindings.map(b => ({ index: b.index, bitId: b.formalBitId, value: b.formalValue })),
                reveal: { ...claim.tuple.target, provider: 'stock' }
            }));
        }
        const connection = scene.connections.find(c => c.id === selectedId);
        if (connection) return [{ id: connection.id, label: connection.label, status: 'available', entityId: null,
            occurrenceId: context.contextOccurrenceId,
            positions: connection.bits.map((bitId, index) => ({ index, bitId, value: connection.rawBits[index] })) }];
        const alias = scene.aliases.find(a => a.id === selectedId);
        if (alias) return [{ id: alias.id, entityId: alias.id, label: alias.name, status: 'available',
            occurrenceId: context.contextOccurrenceId,
            positions: alias.bits.map((bitId, index) => ({ index, bitId, value: alias.rawBits[index] })) }];
        const bit = scene.connections.flatMap(c => c.members).find(m => m.bitId === selectedId);
        if (bit) return [{ id: bit.bitId, entityId: bit.bitId, label: `Bit ${bit.value}`, status: 'available',
            occurrenceId: context.contextOccurrenceId, positions: [{ index: 0, bitId: bit.bitId, value: bit.value }] }];
        const contact = scene.contacts.find(c => c.id === selectedId);
        if (!contact) {
            const incidence = scene.connections.flatMap(c => c.incidences).find(i => i.members.some(m => m.endpointId === selectedId));
            if (incidence) return seedChoices(scene, incidence.contactId);
            return scene.contacts.filter(c => c.ownerId === selectedId).flatMap(c => seedChoices(scene, c.id));
        }
        const child = scene.children.find(c => c.id === contact.ownerId && c.kind === 'rtl-occurrence');
        const members = scene.connections.flatMap(c => (c.incidences || [])
            .filter(i => i.contactId === contact.id).flatMap(i => i.members));
        const positions = contact.bits.map((bitId, index) => {
            const mapping = members.find(m => m.contactIndex === index && (child
                ? m.boundaryId && m.formalBitId === bitId
                : m.endpointId === contact.id && m.index === index && m.bitId === bitId));
            return { index: mapping?.index ?? index, bitId: child ? mapping?.bitId ?? null : bitId,
                value: child ? scene.connections.flatMap(c => c.members).find(m => m.bitId === mapping?.bitId)?.value ?? null
                    : contact.rawBits[index], mapping: mapping || null };
        });
        return [{ id: contact.id, label: contact.label, direction: contact.direction,
            status: positions.some(p => p.bitId) ? 'available' : 'unconnected',
            entityId: child ? members[0]?.endpointId ?? null : contact.id, occurrenceId: context.contextOccurrenceId, positions,
            ...(child ? { reveal: { entityId: contact.id, occurrenceId: child.id, snapshotId: context.snapshotId,
                provider: context.provider }, mappedActual: true } : {}) }];
    }

    function seedInput(choice, positions) {
        if (choice.status !== 'available') throw new Error('Unconnected actual or explicit RTL reveal required');
        if (!Array.isArray(positions) || !positions.length || positions.some(i => !Number.isSafeInteger(i)
            || i < 0 || i >= choice.positions.length)) throw new Error('Choose valid positional bits or a non-empty slice');
        const selected = positions.map(i => choice.positions[i]);
        if (selected.some(p => !p.bitId)) throw new Error('Selected actual position is unconnected; reveal the formal separately');
        return choice.entityId ? { entityId: choice.entityId, indices: selected.map(p => p.index) }
            : { occurrenceId: choice.occurrenceId, bitIds: selected.map(p => p.bitId) };
    }

    function revealIntent(scene, ref, result = null) {
        const context = scene.implementationContext;
        if (!ref?.occurrenceId || !ref.entityId || ref.snapshotId !== context.snapshotId) return null;
        // Only recorded hierarchy may extend the retained source owner's anchor.
        // Instrumented scenes do not supply a provider-local source-owner anchor;
        // there we can prove descendants of the current actual occurrence only.
        const anchor = context.implementationSnapshotId === context.snapshotId
            ? context.implementationOccurrenceId || context.contextOccurrenceId : context.contextOccurrenceId;
        const edges = scene.sceneKind === 'rtl' ? [
            ...scene.breadcrumb.slice(1).map((entry, i) => [scene.breadcrumb[i].id, entry.id]),
            ...scene.children.filter(c => c.kind === 'rtl-occurrence').map(c => [scene.shell.id, c.id])
        ] : [];
        for (const boundary of result?.boundaries || []) {
            if (boundary.kind === 'hierarchy-crossing') edges.push([boundary.from.occurrenceId, boundary.to.occurrenceId]);
        }
        const allowed = new Set([anchor]), queue = [anchor];
        for (let i = 0; i < queue.length; i++) for (const [parent, child] of edges) {
            if (parent === queue[i] && !allowed.has(child)) { allowed.add(child); queue.push(child); }
        }
        if (anchor !== context.rootOccurrenceId && !allowed.has(ref.occurrenceId)) return null;
        // Never choose another BSV owner based on an electrical crossing.
        return { sceneKind: 'rtl', implementationProvider: ref.provider || context.provider,
            rootInstanceId: scene.rootInstanceId, ownerInstanceId: scene.ownerInstanceId,
            implementationContext: { snapshotId: ref.snapshotId, contextOccurrenceId: ref.occurrenceId },
            selectedEntityId: ref.entityId, selectedRelationId: null };
    }

    const sourceKinds = new Set(['state-accesses', 'behavior', 'call-site', 'source-dependencies', 'correspondence']);
    const isSourceResult = result => sourceKinds.has(result?.kind);
    // Eligibility is presentation only. The controller's authoritative resolver
    // validates identity, occurrence and source-owner scope inside its transaction.
    const canReveal = ref => ref?.kind !== 'source' && !!(ref?.entityId && ref.occurrenceId && ref.snapshotId);

    function sourceActions(scene, visit) {
        const id = visit.selectedRelationId || visit.selectedEntityId;
        if (!id) return [];
        const selected = [scene.shell, ...scene.children, ...scene.storages, ...scene.contacts, ...scene.connections].find(r => r.id === id);
        const actions = [], seen = new Set();
        function add(kind, entityId, label, ownerInstanceId = selected?.ownerInstanceId ?? scene.ownerInstanceId, refs = selected?.sourceRefs || scene.inspector.sourceRefs) {
            const key = `${kind}:${entityId}`;
            if (seen.has(key)) return;
            seen.add(key);
            actions.push({ kind, entityId, label, ownerInstanceId, sourceRevision: refs?.[0]?.revision,
                ...(ownerInstanceId !== scene.ownerInstanceId ? { needsOwner: true } : {}) });
        }
        if (selected?.kind === 'storage') {
            add('state-accesses', id, 'Readers / writers');
            for (const writer of selected.writers) add('behavior', writer.id, `Update code: ${writer.label}`);
        }
        if (selected?.kind === 'method-contact') add('behavior', id, 'Method code');
        for (const behavior of scene.inspector.behaviorRefs || []) add('behavior', behavior.id, `Behavior code: ${behavior.label}`, undefined, behavior.sourceRefs);
        for (const member of selected?.members || []) {
            if (member.bindingId) add('call-site', member.bindingId, `Call / argument context: ${member.kind}`, member.ownerInstanceId);
            if (member.expressionId) add('source-dependencies', member.expressionId, 'Connection value code', member.ownerInstanceId);
        }
        if (!selected && scene.inspector.sourceRefs?.some(r => r.semanticId === id)) add('source-dependencies', id, 'Value dependencies');
        if (selected?.kind === 'storage' || selected?.kind === 'method-contact' || scene.sceneKind === 'rtl' && selected
            || !selected && scene.inspector.sourceRefs?.some(r => r.semanticId === id)) add('correspondence', id, 'Explain implementation mapping');
        return actions;
    }

    function sourceInput(scene, action, analysis = null, mode = analysis?.result?.code?.sourceMode || 'build') {
        const sourceOnly = scene.snapshotId === null || analysis?.request?.scope?.kind === 'source-only';
        const ownerInstanceId = Object.hasOwn(action, 'ownerInstanceId') ? action.ownerInstanceId
            : analysis?.result?.seed.ownerInstanceId ?? scene.ownerInstanceId;
        const context = scene.implementationContext;
        const occurrence = Object.hasOwn(action, 'occurrenceId') ? action.occurrenceId
            : isSourceResult(analysis?.result) && ownerInstanceId === analysis.result.seed.ownerInstanceId ? analysis.result.seed.occurrenceId
            : ownerInstanceId === scene.ownerInstanceId ? context.contextOccurrenceId : undefined;
        if (!sourceOnly && occurrence === undefined) throw new Error('Open the explicit source owner before analyzing this record');
        const seed = { entityId: action.entityId };
        if (action.sourceRevision) seed.sourceRevision = action.sourceRevision;
        if (action.entryCallSiteId) seed.entryCallSiteId = action.entryCallSiteId;
        return { kind: action.kind, seed, ownerInstanceId, implementationOccurrenceId: sourceOnly ? null : occurrence,
            scope: sourceOnly ? { kind: 'source-only', rootOccurrenceId: null }
                : analysis?.request?.scope || { kind: 'design', rootOccurrenceId: context.rootOccurrenceId }, mode,
            ...(action.kind === 'source-dependencies' ? { direction: action.direction || 'backward' } : {}) };
    }

    function codeRecords(result) {
        if (!isSourceResult(result)) return [];
        const records = [], seen = new Set(), code = result.code;
        function add(record, role, kind, context = {}, extra = {}) {
            if (!record?.id) return;
            const object = result.objects.find(o => o.entityId === record.id
                && (context.ownerInstanceId === undefined || o.ownerInstanceId === context.ownerInstanceId));
            const ownerInstanceId = context.ownerInstanceId === undefined ? object?.ownerInstanceId ?? result.seed.ownerInstanceId : context.ownerInstanceId;
            const occurrenceId = Object.hasOwn(context, 'occurrenceId') ? context.occurrenceId
                : object?.occurrenceId ?? (ownerInstanceId === result.seed.ownerInstanceId ? result.seed.occurrenceId : undefined);
            const id = JSON.stringify([role, record.id, ownerInstanceId, extra.polarity ?? null, extra.entryCallSiteId || result.seed.entryCallSiteId]);
            if (seen.has(id)) return;
            seen.add(id);
            const ref = result.sourceRefs.find(r => r.semanticId === record.id && r.ownerInstanceId === ownerInstanceId)
                || (extra.entryCallSiteId ? result.sourceRefs.find(r => r.semanticId === record.id && r.ownerInstanceId === null) : null);
            const helper = code.functionDefinition;
            records.push({ id, role, kind, entityId: record.id, label: record.name || record.text || record.sourceText || record.kind || record.id,
                ownerInstanceId, ...(occurrenceId !== undefined ? { occurrenceId } : {}), sourceRevision: ref?.revision || record.sourceRevision,
                ...(result.seed.entryCallSiteId && helper && (record.id === helper.id || record.enclosingCallableId === helper.id)
                    ? { entryCallSiteId: result.seed.entryCallSiteId } : {}), reference: ref || null, record, ...extra });
        }
        if (code.storage) add(code.entity, 'storage', 'state-accesses');
        for (const r of result.readers) add(r, 'reader', 'behavior');
        for (const r of result.writers) add(r, 'writer', 'behavior');
        if (code.behavior) add(code.behavior, 'behavior', 'behavior');
        if (code.functionDefinition) add(code.functionDefinition, 'function', 'behavior');
        for (const mapping of result.callMappings) {
            add(mapping.callSite || mapping.binding, 'call', 'call-site', mapping.caller);
            for (const a of mapping.actualToFormal) add(a.actual, 'argument', 'source-dependencies', mapping.caller,
                { formal: a.formal, formalIndex: a.formalIndex });
            const helper = mapping.callee?.functionDefinition;
            const helperEntry = helper && mapping.resolution === 'exact' ? { entryCallSiteId: mapping.callSite.id } : {};
            const returnContext = helper ? { ownerInstanceId: mapping.caller.ownerInstanceId, occurrenceId: result.seed.occurrenceId }
                : { ownerInstanceId: mapping.callee?.ownerInstanceId };
            if (helper && mapping.resolution === 'exact') add(helper, 'function', 'behavior', returnContext, helperEntry);
            for (const r of mapping.returns) add(r, 'return', 'source-dependencies', returnContext, helperEntry);
        }
        for (const r of code.statements) add(r, r.kind === 'local-declaration' ? 'local-definition'
            : r.kind === 'state-assignment' ? 'state-write' : r.kind === 'return' ? 'return' : r.kind, 'source-dependencies');
        for (const r of code.expressions) add(r, r.useSymbolIds?.length ? 'local-use' : 'expression', 'source-dependencies');
        for (const r of code.bindings) add(r, r.accessKind === 'write' ? 'state-write' : r.accessKind === 'read' ? 'state-read' : 'binding', 'call-site');
        if (result.conditions.predicate) add(result.conditions.predicate.expression, 'predicate', 'source-dependencies');
        for (const condition of result.conditions.body) add(condition.expression, 'condition', 'source-dependencies', {},
            { polarity: condition.polarity, signedExpressionId: condition.signedExpressionId });
        for (const condition of result.conditions.caseArms || []) {
            add(condition.selector, 'case-selector', 'source-dependencies', {}, { caseArmId: condition.armId });
            for (const label of condition.labels || []) add(label, 'case-label', 'source-dependencies', {}, { caseArmId: condition.armId });
        }
        return records;
    }

    function projectAnalysis(scene, result, visibleIds = null) {
        const nodes = [scene.shell, ...scene.children, ...scene.storages].map(n => ({ id: n.id, refs: [n.id], bits: [], boundaryIds: [] }));
        const contacts = scene.contacts.map(c => {
            const members = scene.connections.flatMap(r => (r.incidences || []).filter(i => i.contactId === c.id).flatMap(i => i.members));
            return { id: c.id, refs: [c.id, ...members.map(m => m.endpointId)],
                bits: [...(c.bits || []), ...members.flatMap(m => [m.bitId, m.formalBitId]).filter(Boolean)],
                boundaryIds: members.map(m => m.boundaryId).filter(Boolean) };
        });
        const routes = scene.connections.map(r => ({ id: r.id,
            refs: (r.aliases || []).map(a => a.id), bits: r.bits || [],
            boundaryIds: (r.incidences || []).flatMap(i => i.members.map(m => m.boundaryId)).filter(Boolean) }));
        const sourceCompatible = isSourceResult(result) && scene.sceneKind === 'bsv'
            && result.context.sourceModelIdentity === scene.provenance.sourceModelIdentity;
        const compatible = result && result.context.snapshotId === scene.snapshotId
            && (scene.sceneKind === 'rtl' && !isSourceResult(result) || sourceCompatible);
        const objects = compatible ? result.objects : [], groups = compatible ? result.groups || [] : [];
        const ids = new Set(objects.map(o => o.entityId));
        const bits = new Set([...groups.flatMap(g => g.bitIds),
            ...objects.filter(o => ['signal-bit', 'constant'].includes(o.objectKind)).map(o => o.entityId)]);
        const seedBits = new Set(compatible ? result.seed.positions.map(p => p.bitId) : []);
        const seedEntity = compatible ? result.seed.entityId : null;
        const boundaries = new Set(compatible ? result.boundaries.map(b => b.boundaryId || b.id) : []);
        const boundaryEntities = new Set(result?.kind === 'dependencies'
            ? result.boundaries.flatMap(b => [b.cellId, b.at?.entityId, b.at?.bitId]).filter(Boolean)
            : groups.flatMap(g => g.boundaryContacts.map(c => c.entityId)));
        const presentations = [...nodes, ...contacts, ...routes];
        const displayed = visibleIds == null ? null : new Set(visibleIds);
        const references = (result?.objects || []).map(ref => {
            const displayIds = compatible ? presentations.filter(p => p.refs.includes(ref.entityId) || p.bits.includes(ref.entityId)).map(p => p.id) : [];
            return { ...ref, displayIds, visibility: !displayIds.length ? 'off-scene'
                : displayed && !displayIds.some(id => displayed.has(id)) ? 'hidden' : 'visible' };
        });
        const mark = p => ({ id: p.id, result: p.refs.some(id => ids.has(id)) || p.bits.some(id => bits.has(id)),
            seed: seedEntity ? p.refs.includes(seedEntity) || routes.includes(p) && p.bits.some(id => seedBits.has(id))
                : p.bits.some(id => seedBits.has(id)),
            boundary: p.boundaryIds.some(id => boundaries.has(id)) || p.refs.some(id => boundaryEntities.has(id)) });
        return { nodes: nodes.map(mark), contacts: contacts.map(mark), routes: routes.map(mark), references,
            counts: { returned: references.length, visible: references.filter(r => r.visibility === 'visible').length,
                hidden: references.filter(r => r.visibility === 'hidden').length,
                offScene: references.filter(r => r.visibility === 'off-scene').length, frontier: result?.frontier.length || 0 } };
    }

    return { seedChoices, seedInput, revealIntent, canReveal, sourceActions, sourceInput, codeRecords, isSourceResult, projectAnalysis };
}));
