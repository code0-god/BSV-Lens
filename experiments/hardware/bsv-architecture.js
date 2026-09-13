'use strict';

// Contextual projection of the existing Source/Semantic IR. This is not Hardware IR.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseBsvFile, classifyPrimitive } = require('../../src/architecture/parser');
const { buildSemanticModel } = require('../../src/architecture/semantic/model');
const { buildSemanticIndexes } = require('../../src/architecture/semantic/indexes');
const { buildSourceReferenceIndex } = require('../../src/architecture/semantic/source-references');
const { analyzeCode } = require('../../src/architecture/code-analysis');
const { createLineStarts, offsetToPosition, maskCommentsAndStrings, splitTopLevel,
    findMatchingDelimiter, readIdentifier } = require('../../src/architecture/source-utils');
const { analyzeTypeWidth } = require('../../src/architecture/type-analysis');
const { compareContractTypes } = require('../../src/architecture/interface-contract-types');
const hash = text => createHash('sha256').update(text).digest('hex');
const sourceOnly = scope => ({ status: 'source-only', scope, evidence: [] });
const unmapped = reason => ({ status: 'unmapped', entityIds: [], evidence: [], reason });
const values = Object.values;

function buildBsvArchitecture(options = {}) {
    const { parsedFiles = [], implementationModel: hardware = null, correspondence = null } = options;
    const semantic = options.semanticModel || buildSemanticModel(parsedFiles,
        options.compilerMetadata ? { entrypoints: [JSON.parse(options.compilerMetadata).top] } : {});
    const ix = semantic.indexes || buildSemanticIndexes(semantic);
    const sourceIndex = buildSourceReferenceIndex(semantic);
    const documents = semantic.sourceDocuments;
    for (const document of documents) if (hash(document.content) !== document.revision) throw new Error('Source revision mismatch');
    const documentById = new Map(documents.map(document => [document.id, document]));
    const starts = new Map(documents.map(document => [document.id, createLineStarts(document.content)]));
    const view = { schemaVersion: 1, abstraction: 'BSV System Architecture',
        snapshotId: hardware?.snapshot.id || `bsv-source-${hash(JSON.stringify(documents.map(d => [d.id, d.revision])))}`,
        roots: [], occurrences: {}, storage: {}, boundaries: {}, behaviors: {}, relations: {},
        sourceDocuments: documents, sourceModel: { schemaVersion: semantic.schemaVersion,
            definitions: semantic.definitions, statements: semantic.statements, expressions: semantic.expressions,
            callSites: semantic.callSites, bindingEnvironments: semantic.bindingEnvironments, bindings: semantic.bindings,
            sourceReferences: sourceIndex.references }, sourceSupplements: [], gaps: [], coverage: {} };
    const compiler = checkedCompiler(options, documents);
    const ref = pointer => ({ ...compiler.artifact, pointer });
    const confirmed = (scope, pointer, extra = {}) => ({ status: 'confirmed', scope, evidence: [ref(pointer)], ...extra });
    const gap = (code, entityId, detail) => view.gaps.push({ code, entityId, detail });
    const compilerByOccurrence = new Map();
    const compilerModules = new Map();
    const sourceRefs = sourceIndex.references;

    function evidence(range, role = 'source') {
        const document = documentById.get(range?.uri);
        if (!document) throw new Error(`Source document unavailable: ${range?.uri}`);
        const lines = starts.get(document.id);
        const offset = (line, column) => {
            if (!Number.isInteger(line) || !Number.isInteger(column) || line < 0 || column < 0 || line >= lines.length) throw new Error('Invalid source position');
            const end = line + 1 < lines.length ? lines[line + 1] - 1 : document.content.length;
            if (lines[line] + column > end) throw new Error('Invalid source column');
            return lines[line] + column;
        };
        const start = offset(range.line, range.column), end = offset(range.endLine, range.endColumn);
        if (end < start) throw new Error('Reversed source range');
        const text = document.content.slice(start, end);
        return { sourceDocumentId: document.id, pathRef: document.relativePath, revision: document.revision,
            sourceRange: range, range: { start, end }, text, sha256: hash(text), role };
    }
    function common(item, definitionId, ownerOccurrenceId, ranges) {
        return { id: item.id, name: item.name, definitionId, ownerOccurrenceId,
            sourceEvidence: ranges.filter(Boolean).map((range, i) => evidence(range, i ? 'definition-context' : 'declaration')),
            compilerConfirmation: sourceOnly('source declaration'), rtlCorrespondence: unmapped('No exact BSV-to-RTL cause mapping') };
    }
    function positionMatches(position, sourceRange) {
        const pos = Array.isArray(position) ? position : tclList(position || '');
        const document = documentById.get(sourceRange?.uri);
        if (!document || pos.length !== 3 || pos[0] !== document.relativePath) return false;
        const line = Number(pos[1]) - 1, column = Number(pos[2]) - 1;
        return line >= sourceRange.line && line <= sourceRange.endLine &&
            (line !== sourceRange.line || column >= sourceRange.column) &&
            (line !== sourceRange.endLine || column < sourceRange.endColumn);
    }
    function moduleMetadata(occurrence) {
        if (compilerModules.has(occurrence.id)) return compilerModules.get(occurrence.id);
        const definition = ix.definitionById.get(occurrence.definitionId);
        const matches = compiler.metadata?.modules.map((item, index) => ({ item, index }))
            .filter(({ item }) => item.name === definition?.name && positionMatches(item.definitionPosition, definition.location)) || [];
        const result = matches.length === 1 ? matches[0] : null;
        compilerModules.set(occurrence.id, result);
        return result;
    }
    function confirmOccurrence(instance, item) {
        const parent = compilerByOccurrence.get(instance.parentInstanceId);
        const definition = ix.definitionById.get(instance.targetDefinitionId);
        const matches = compiler.metadata?.hierarchy.map((node, index) => ({ node, index })).filter(({ node }) => {
            if (instance.root) return node.parent === 0 && node.Name === definition?.name &&
                compiler.metadata.top === definition?.name && Boolean(moduleMetadata(item));
            return parent && node.parent === parent.node.key && node.Name === instance.name &&
                positionMatches(node.position, instance.location) &&
                (node.Node !== 'Synthesized' || node.BSVModule === definition?.name);
        }) || [];
        if (matches.length !== 1) return;
        const match = matches[0];
        compilerByOccurrence.set(instance.id, match);
        item.compilerConfirmation = confirmed('compiler occurrence at source position', `/hierarchy/${match.index}`,
            { compilerNodeKind: match.node.Node, bsvPath: match.node.BSVPath, synthPath: match.node.SynthPath,
                compilerModule: match.node.BSVModule });
        item.compilerType = match.node.Interface || null;
        if (item.compilerType && item.declaredType !== 'inferred' &&
            compareContractTypes(item.declaredType, unqualifiedType(item.compilerType)).status === 'mismatch') {
            item.compilerConfirmation = { ...item.compilerConfirmation, status: 'conflict', scope: 'source/compiler occurrence type disagreement' };
            compilerByOccurrence.delete(instance.id);
            gap('occurrence-type-conflict', item.id, 'Compiler interface type conflicts with the declared source type');
        }
    }
    for (const instance of semantic.instances) {
        const definition = ix.definitionById.get(instance.targetDefinitionId);
        const parent = ix.instanceById.get(instance.parentInstanceId);
        const declaration = sourceRefs.find(r => ['state-declaration', 'instance-declaration'].includes(r.kind) &&
            r.parentDefinitionId === parent?.targetDefinitionId && sameRange(r.sourceRange, instance.sourceRange));
        if (instance.primitiveKind && !['register', 'fifo', 'memory'].includes(instance.primitiveKind)) {
            gap('non-storage-primitive', instance.id, `Declared ${instance.primitiveKind} is not classified as Reg/FIFO/Memory storage`);
            continue;
        }
        if (!definition && !instance.primitiveKind) {
            gap('unresolved-module-definition', instance.id, 'No canonical source module target; not invented as hardware');
            continue;
        }
        const storage = Boolean(instance.primitiveKind);
        const declaredPrimitiveKind = instance.declaredType ? classifyPrimitive(instance.declaredType, '') : null;
        if (declaredPrimitiveKind && declaredPrimitiveKind !== instance.primitiveKind) gap('primitive-classifier-constructor-prefix', instance.id,
            'Existing parser constructor prefix misclassifies declared type; reuse its declared-type classifier without constructor');
        const item = { ...common(instance, storage ? declaration.id : definition.id,
            storage ? instance.parentInstanceId : instance.id,
            [instance.sourceRange, !storage && !instance.root ? definition.sourceRange : null]),
            kind: storage ? 'storage-occurrence' : 'module-occurrence', declarationId: declaration?.id || definition?.id,
            path: instance.path, parentId: instance.parentInstanceId, declaredType: instance.declaredType || 'inferred',
            returnInterface: definition?.returnInterface || null, compilerType: null,
            typeResolutionStatus: definition ? compareContractTypes(definition.returnInterface, instance.declaredType).status : 'source-declared',
            primitiveKind: declaredPrimitiveKind || instance.primitiveKind || null,
            parameterBindings: instance.parameterBindings, staticBindings: instance.staticBindings || [],
            constructor: instance.constructor, constructorArguments: instance.arguments || [] };
        if (!storage) Object.assign(item, { children: [], storage: [], ports: [], behaviorIds: [] });
        (storage ? view.storage : view.occurrences)[item.id] = item;
        confirmOccurrence(instance, item);
        if (instance.root) view.roots.push(item.id);
        if (view.occurrences[item.parentId]) view.occurrences[item.parentId][storage ? 'storage' : 'children'].push(item.id);
    }

    // RTL boundaries require compiler identity/position AND the verified sidecar AND parent context.
    for (const occurrence of values(view.occurrences)) {
        const parent = view.occurrences[occurrence.parentId];
        let rtl = null, links = [];
        if (hardware && occurrence.compilerConfirmation.status === 'confirmed') {
            if (!parent) {
                const top = moduleMetadata(occurrence)?.item.name;
                const matches = hardware.roots.map(id => hardware.occurrences[id])
                    .filter(item => hardware.definitions[item.definitionId].name === top);
                if (matches.length === 1) rtl = matches[0];
            } else if (parent.rtlContext?.implementationOccurrenceId) {
                const mappings = (correspondence?.mappings || []).filter(mapping => mapping.kind === 'instance-declaration' &&
                    mapping.status === 'verified-fixture-boundary' && mapping.module === moduleMetadata(parent)?.item.name &&
                    mapping.source?.sha256 === occurrence.sourceEvidence[0].revision &&
                    positionMatches([mapping.source.path, mapping.source.line1, mapping.source.column1], ix.instanceById.get(occurrence.id).location));
                const parentRtl = hardware.occurrences[parent.rtlContext.implementationOccurrenceId];
                const matches = parentRtl.children.map(id => hardware.occurrences[id]).filter(child =>
                    mappings.some(mapping => hardware.cells[child.cellId].name === mapping.cell));
                if (matches.length === 1 && occurrence.compilerConfirmation.compilerNodeKind === 'Synthesized') {
                    rtl = matches[0]; links = mappings;
                }
            }
        }
        const contextId = rtl?.id || parent?.rtlContext?.contextOccurrenceId || null;
        occurrence.rtlContext = { status: rtl ? 'verified' : contextId ? 'candidate' : 'unknown',
            ownerOccurrenceId: occurrence.id, implementationOccurrenceId: rtl?.id || null, contextOccurrenceId: contextId,
            highlightEntityIds: [], reason: rtl ? 'Verified retained compiler/RTL boundary; contents are not exact source causes'
                : contextId ? 'Containing RTL context only; source occurrence is inlined or unmapped, no cell ownership assigned'
                    : 'No verified same-build RTL context', evidence: links, unmappedCellIds: contextId ? hardware.occurrences[contextId].cells : [] };
        if (rtl) occurrence.rtlCorrespondence = { status: 'verified-boundary', entityIds: [rtl.id], evidence: links,
            scope: 'retained module boundary, not leaf cause' };
    }

    for (const behavior of semantic.stateBehaviors) {
        const owner = view.occurrences[behavior.ownerInstanceId];
        if (!owner) continue;
        const item = { ...common(behavior, behavior.definitionId, owner.id, [behavior.sourceRange]),
            kind: behavior.kind, statementIds: behavior.statementIds, expressionIds: behavior.expressionIds,
            callSiteIds: behavior.callSiteIds, inputs: behavior.inputs, returnType: behavior.returnType,
            explicitPredicate: predicate(behavior), bodyPathConditions: [], relationIds: [] };
        const metadata = moduleMetadata(owner);
        const candidates = behavior.kind === 'method' ? metadata?.item.methods.map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => entry.name === [...behavior.interfacePath, behavior.name].join('.'))
            : metadata?.item.rules.map((entry, index) => ({ entry, index }))
                .filter(({ entry }) => positionMatches(entry.position, behavior.location));
        if (candidates?.length === 1 && owner.compilerConfirmation.status === 'confirmed') {
            const { entry, index } = candidates[0];
            const fields = behavior.kind === 'method' ? tclFields(tclList(entry.rawRule).slice(1)) : null;
            item.compilerConfirmation = confirmed('compiler method/rule in verified module context',
                `/modules/${metadata.index}/${behavior.kind === 'method' ? 'methods' : 'rules'}/${index}`,
                { compilerPredicate: fields ? fields.get('predicate') || null : entry.predicate,
                    methodUses: fields ? fields.get('methods') || '' : entry.methodUses });
        }
        view.behaviors[item.id] = item;
        owner.behaviorIds.push(item.id);
        for (const statementId of behavior.statementIds) {
            const statement = ix.statementById.get(statementId);
            if (statement?.kind === 'unsupported') gap('bounded-code-unsupported', item.id,
                `Canonical statement ${statementId} has no return/expression AST; exact source access remains available`);
        }
    }
    function predicate(behavior) {
        const expression = ix.expressionById.get(behavior.predicateExpressionId);
        return expression ? { status: 'explicit-source-not-evaluated', expressionId: expression.id, text: expression.text,
            sourceEvidence: [evidence(expression.sourceRange, 'explicit-predicate')] }
            : { status: 'absent', expressionId: null, text: null, sourceEvidence: [] };
    }
    function conditions(ids) {
        return (ids || []).map(id => {
            const polarity = id.startsWith('!') ? false : true;
            const expressionId = polarity ? id : id.slice(1), expression = ix.expressionById.get(expressionId);
            if (!expression) throw new Error(`Missing path condition: ${id}`);
            const statement = ix.statementById.get(expression.parentStatementId);
            return { expressionId, polarity, text: expression.text, status: statement?.kind === 'case' ? 'case-label-unknown' : 'explicit-source-not-evaluated',
                sourceEvidence: [evidence(expression.sourceRange, 'body-path-condition')] };
        });
    }

    for (const endpoint of semantic.endpoints) {
        const owner = view.occurrences[endpoint.ownerInstanceId];
        if (!owner) continue;
        const definition = ix.definitionById.get(endpoint.interfaceDefinitionId);
        const declaration = sourceRefs.find(r => r.kind === 'interface-method' &&
            r.interfaceDefinitionId === endpoint.interfaceDefinitionId && r.name === endpoint.name);
        const isMethod = endpoint.kind === 'method-endpoint';
        const behaviorIds = owner.behaviorIds.filter(id => {
            const original = ix.stateBehaviorById.get(id);
            return original.kind === 'method' && [...original.interfacePath, original.name].join('.') === endpoint.interfacePath.join('.');
        });
        const type = owner.declaredType === 'inferred' ? owner.returnInterface : owner.declaredType;
        const substitutions = typeSubstitutions(definition, type);
        const compilerSubstitutions = owner.compilerConfirmation.status === 'confirmed'
            ? typeSubstitutions(definition, owner.compilerType) : {};
        for (const [formal, actual] of Object.entries(compilerSubstitutions)) {
            if (substitutions[formal] === formal) substitutions[formal] = actual;
        }
        const args = (endpoint.parameters || []).map(arg => ({ name: arg.name, type: substituteType(arg.type, substitutions) }));
        const resultType = substituteType(endpoint.resultType, substitutions);
        const methodKind = ({ action: 'Action', value: 'Value', 'action-value': 'ActionValue' })[endpoint.category] || 'Unknown';
        const item = { ...common(endpoint, isMethod ? declaration?.id || endpoint.interfaceDefinitionId : endpoint.interfaceDefinitionId,
            owner.id, [isMethod ? declaration?.sourceRange || endpoint.location : definition?.sourceRange || endpoint.location]),
            kind: isMethod ? 'method-boundary' : endpoint.interfacePath.length ? 'subinterface-boundary' : 'interface-boundary',
            interfacePath: endpoint.interfacePath, interfaceType: endpoint.interfaceType || type,
            declaredArguments: endpoint.parameters || [], declaredResultType: endpoint.resultType || null,
            methodKind, arguments: args, result: { status: methodKind === 'Action' ? 'none' : resultType ? 'typed' : 'unknown', type: resultType || null },
            payload: { status: 'not-collapsed', arguments: args, resultType: resultType || null },
            typeResolutionStatus: owner.typeResolutionStatus, typeSubstitutions: substitutions, behaviorIds, rtlSignals: [], contractStatus: endpoint.contractStatus || endpoint.resolutionStatus };
        const metadata = moduleMetadata(owner);
        const methodIndex = isMethod ? metadata?.item.methods.findIndex(method => method.name === endpoint.interfacePath.join('.')) : -1;
        if (isMethod && methodIndex >= 0 && owner.compilerConfirmation.status === 'confirmed') {
            const method = metadata.item.methods[methodIndex];
            item.compilerConfirmation = confirmed('typed method boundary / generated port contract', `/modules/${metadata.index}/methods/${methodIndex}`);
            const argumentWidths = args.map(argument => analyzeTypeWidth(argument.type));
            if (method.args.length !== args.length || method.args.some((argument, index) =>
                argumentWidths[index]?.status === 'exact' && argumentWidths[index].bits !== argument.size)) {
                item.compilerConfirmation = { ...item.compilerConfirmation, status: 'conflict', scope: 'source/compiler argument type disagreement' };
                gap('method-type-conflict', item.id, 'Declared argument arity/width disagrees with compiler metadata');
            }
            const rtlOwner = hardware?.occurrences[owner.rtlContext.implementationOccurrenceId];
            for (const signal of [...method.args.map((argument, index) => ({ role: 'argument', port: argument.port, size: argument.size, argumentIndex: index })),
                ...['enable', 'ready', 'result'].filter(role => method[role]).map(role => ({ role, port: method[role] }))]) {
                const mapping = (correspondence?.mappings || []).find(link => link.kind === 'method-port' &&
                    link.status === 'verified-port-contract/source-context-only' && link.module === hardware?.definitions[rtlOwner?.definitionId]?.name &&
                    link.method === method.name && link.port === signal.port && link.role === signal.role);
                const actual = rtlOwner?.ports.map(id => hardware.ports[id]).find(port => port.name === signal.port &&
                    mapping && JSON.stringify(port.rawBits) === JSON.stringify(mapping.bits));
                item.rtlSignals.push({ ...signal, status: actual ? 'verified-port-net' : 'compiler-contract-only',
                    implementationPortId: actual?.id || null, bitIds: actual?.bits || [],
                    evidence: [ref(`/modules/${metadata.index}/methods/${methodIndex}`)],
                    connectivity: actual ? actual.bits.map(id => ({ bitId: id, endpoints: hardware.bits[id].endpoints })) : [],
                    boundaryCrossings: actual ? rtlOwner.boundaries.map(id => hardware.boundaries[id])
                        .filter(binding => binding.portId === actual.id).map(binding => ({ ...binding,
                            actualEndpoints: hardware.bits[binding.actualBitId].endpoints })) : [] });
            }
            const linked = item.rtlSignals.filter(signal => signal.implementationPortId);
            if (linked.length) item.rtlCorrespondence = { status: 'verified-port-contract',
                entityIds: linked.map(signal => signal.implementationPortId), evidence: linked.flatMap(signal => signal.evidence),
                scope: 'method boundary to actual ports/nets; not source-expression leaf cause' };
        } else if (!isMethod && owner.compilerConfirmation.status === 'confirmed') {
            item.compilerConfirmation = { ...owner.compilerConfirmation, scope: 'compiler occurrence interface type; source interface declaration' };
        }
        view.boundaries[item.id] = item;
        owner.ports.push(item.id);
    }

    function addRelation(binding, kind, fromId, toId, extra = {}) {
        const behavior = view.behaviors[binding.behaviorId];
        const statement = ix.statementById.get(binding.statementId);
        const ownerId = binding.ownerInstanceId || ix.instanceById.get(binding.targetInstanceId)?.parentInstanceId;
        if (!view.occurrences[ownerId]) return null;
        const range = extra.sourceRange || statement?.sourceRange || binding.sourceRange || binding.location;
        if (!range) return null;
        const item = { ...common({ id: kind === 'invocation' || kind.startsWith('state-') ? binding.id : `${binding.id}:${kind}${extra.suffix || ''}` },
            statement?.id || behavior?.definitionId || view.occurrences[binding.targetInstanceId]?.declarationId || extra.statementId || binding.id, ownerId, [range]), kind, fromId, toId, behaviorId: behavior?.id || null,
            statementId: statement?.id || extra.statementId || null, expressionId: extra.expressionId || null,
            explicitPredicate: behavior?.explicitPredicate || { status: 'absent', expressionId: null, text: null, sourceEvidence: [] },
            bodyPathConditions: conditions(statement?.pathConditionExpressionIds || binding.pathConditionExpressionIds),
            semanticBindingId: binding.id, ...extra };
        delete item.sourceRange; delete item.suffix;
        if (behavior?.compilerConfirmation.status === 'confirmed') {
            const target = ix.instanceById.get(binding.targetInstanceId);
            const uses = flattenTclUses(behavior.compilerConfirmation.methodUses || '');
            const member = binding.memberPath || (kind === 'state-write' ? 'write' : kind === 'state-read' ? 'read' : '');
            if (target && member && uses.includes(`${target.name}.${member}`)) item.compilerConfirmation = {
                ...behavior.compilerConfirmation, scope: 'compiler confirms method/state use, not exact source statement or wire' };
        }
        view.relations[item.id] = item;
        if (behavior) behavior.relationIds.push(item.id);
        return item;
    }
    for (const binding of semantic.bindings) {
        if (binding.kind === 'constructor-binding') {
            const target = ix.instanceById.get(binding.targetInstanceId), source = ix.instanceById.get(binding.sourceInstanceId);
            if (source?.parentInstanceId !== target?.parentInstanceId || !target || !source) continue;
            addRelation(binding, 'constructor-binding', source.id, target.id,
                { sourceRange: target.sourceRange, formalParameter: binding.formalParameter, actualExpression: binding.actualExpression });
        } else if (binding.kind === 'interface-forward') {
            if (binding.resolutionStatus !== 'exact') continue;
            const owner = ix.instanceById.get(binding.ownerInstanceId), definition = ix.definitionById.get(owner.targetDefinitionId);
            const provided = flattenProvided(definition.providedInterfaces).find(p => p.path.join('.') === binding.outerPath.join('.'));
            addRelation(binding, 'forwarding', binding.innerEndpointId, binding.outerEndpointId, { sourceRange: provided?.sourceRange });
        } else if (binding.kind === 'behavior-access') {
            const behavior = view.behaviors[binding.behaviorId];
            if (!behavior) continue;
            const target = view.storage[binding.targetInstanceId], endpoint = view.boundaries[binding.endpointId];
            if (target) {
                if (!['read', 'write'].includes(binding.accessKind)) continue;
                // Legacy synthetic guard reads are tied to the exact predicate, not a whole callable mistaken for a statement.
                const predicateExpression = ix.expressionById.get(ix.stateBehaviorById.get(behavior.id).predicateExpressionId);
                const extra = !binding.statementId && predicateExpression
                    ? { sourceRange: predicateExpression.sourceRange, expressionId: predicateExpression.id, accessContext: 'explicit-predicate' } : {};
                addRelation(binding, `state-${binding.accessKind}`, binding.accessKind === 'read' ? target.id : behavior.id,
                    binding.accessKind === 'read' ? behavior.id : target.id, extra);
            } else if (endpoint) {
                const invocation = addRelation(binding, 'invocation', behavior.id, endpoint.id,
                    { arguments: binding.arguments, resultBinding: binding.resultBinding, resolutionStatus: binding.resolutionStatus });
                if (!invocation) continue;
                const candidate = ix.callSiteById.get(binding.callSiteId);
                const call = candidate?.calleeName === `${binding.evidence?.referencedInstance}.${binding.memberPath}` ? candidate : null;
                if (call && call.argumentExpressionIds.length === endpoint.arguments.length) {
                    call.argumentExpressionIds.forEach((expressionId, index) => addRelation(binding, 'argument-flow', behavior.id, endpoint.id,
                        { suffix: `:${index}`, expressionId, argumentIndex: index, formalArgument: endpoint.arguments[index],
                            sourceExpression: ix.expressionById.get(expressionId)?.text || null, invocationId: invocation.id }));
                }
                if (endpoint.methodKind === 'Value' || endpoint.methodKind === 'ActionValue') {
                    addRelation(binding, 'result-flow', endpoint.id, behavior.id,
                        { invocationId: invocation.id, result: endpoint.result, expressionId: call?.expressionId || null,
                            resolutionStatus: call ? 'source-expression' : 'source-access-no-expression-ast' });
                }
            }
        }
    }

    // The production parser does not expose module-body returns. Reuse its bounded code
    // analyzer on only the uncovered source spans; never reconstruct BSV via new regex.
    for (const occurrence of values(view.occurrences)) {
        const definition = ix.definitionById.get(occurrence.definitionId), document = documentById.get(definition.uri);
        const excluded = [...definition.childInstanceDeclarations, ...definition.methods, ...definition.rules,
            ...definition.localFunctions, ...definition.providedInterfaces].map(item => item.range).filter(Boolean).sort((a, b) => a.start - b.start);
        let cursor = definition.range.bodyStart;
        const spans = [];
        for (const range of excluded) { if (cursor < range.start) spans.push([cursor, range.start]); cursor = Math.max(cursor, range.end); }
        if (cursor < definition.range.bodyEnd) spans.push([cursor, definition.range.bodyEnd]);
        for (const [bodyStart, bodyEnd] of spans) {
            const analysis = analyzeCode({ source: document.content, masked: maskCommentsAndStrings(document.content),
                uri: document.id, revision: document.revision, callableId: `${definition.id}:module-body`, bodyStart, bodyEnd,
                makeLocation: (start, end) => sourceRangeAt(document, start, end) });
            for (const statement of analysis.statements.filter(item => item.kind === 'return')) {
                const expression = analysis.expressions.find(item => item.id === statement.expressionId);
                if (expression?.kind !== 'identifier') continue;
                const children = occurrence.children.map(id => view.occurrences[id]).filter(child => child.name === expression.text);
                if (children.length !== 1) continue;
                if (!view.sourceSupplements.some(item => item.id === statement.id)) view.sourceSupplements.push({ ...statement,
                    expression, origin: 'existing bounded code analyzer / module span omitted by source parser' });
                const boundary = occurrence.ports.find(id => view.boundaries[id].kind === 'interface-boundary');
                const childBoundary = children[0].ports.find(id => view.boundaries[id].kind === 'interface-boundary');
                addRelation({ id: `${occurrence.id}:${statement.id}`, ownerInstanceId: occurrence.id }, 'forwarding', childBoundary, boundary,
                    { sourceRange: statement.sourceRange, statementId: statement.id, expressionId: expression.id,
                        resolutionStatus: 'explicit-source-interface-return' });
                gap('module-return-supplement', occurrence.id, 'Canonical parser omits module-body returns; existing bounded analyzer supplies this exact source operation');
            }
        }
    }
    gap('predicate-ast-not-evaluated', null, 'Source predicate/path text is exact; mixed-operator AST precedence and case labels are not treated as proven Boolean semantics');
    gap('exact-leaf-cause-unmapped', null, 'Original toolchain exact source cause remains 0/53 leaf cells and 0/168 netnames; declaration/port links are separate categories');
    for (const occurrence of values(view.occurrences)) if (!occurrence.rtlContext.implementationOccurrenceId && occurrence.compilerConfirmation.compilerNodeKind === 'Instance') {
        gap('inlined-no-owned-rtl-boundary', occurrence.id, 'Compiler source occurrence retained; containing synthesis context is not owned hardware');
    }
    view.coverage = coverage(view);
    validateBsvArchitecture(view);
    return view;
}

function checkedCompiler(options, documents) {
    if (!options.compilerMetadata) return { metadata: null, artifact: null };
    const artifact = options.compilerArtifact;
    if (!artifact?.pathRef || hash(options.compilerMetadata) !== artifact.hash) throw new Error('Compiler metadata hash mismatch');
    for (const document of documents) if (!artifact.sourceInputs?.some(source => source.path === document.relativePath && source.sha256 === document.revision)) throw new Error('Compiler source revision mismatch');
    const metadata = JSON.parse(options.compilerMetadata);
    if (metadata.schema !== 'g1-bluetcl-metadata-experiment-v1' || !Array.isArray(metadata.hierarchy) || !Array.isArray(metadata.modules)) throw new Error('Unsupported compiler metadata');
    if (options.implementationModel && (!options.correspondence ||
        options.correspondence.artifactSha256 !== options.implementationModel.snapshot.artifact.hash ||
        options.correspondence.metadataSha256 !== artifact.hash)) throw new Error('Compiler/implementation correspondence mismatch');
    return { metadata, artifact: { pathRef: artifact.pathRef, hash: artifact.hash } };
}
function sameRange(a, b) { return a && b && ['uri', 'line', 'column', 'endLine', 'endColumn'].every(key => a[key] === b[key]); }
function sourceRangeAt(document, start, end) {
    const lines = createLineStarts(document.content), first = offsetToPosition(lines, start), last = offsetToPosition(lines, end);
    return { uri: document.id, line: first.line, column: first.column, endLine: last.line, endColumn: last.column };
}
function unqualifiedType(type) { return type.includes('::') ? type.slice(type.indexOf('::') + 2) : type; }
function typeSubstitutions(definition, type) {
    if (!definition || !type) return {};
    const unqualified = unqualifiedType(type);
    // Type expressions are already parser/compiler values, not a second source parser.
    const open = unqualified.indexOf('('), close = open < 0 ? -1 : findMatchingDelimiter(unqualified, open, '(', ')');
    const name = unqualified.split('#')[0].trim();
    if (name !== definition.name || close !== unqualified.length - 1 || open < 0) return {};
    const args = splitTopLevel(unqualified.slice(open + 1, close), ',').map(item => item.trim());
    if (args.length !== definition.typeParameters.length) return {};
    return Object.fromEntries(definition.typeParameters.map((formal, i) => [formal.name, args[i]]));
}
function substituteType(type, bindings) {
    if (!type) return null;
    let result = '', cursor = 0;
    while (cursor < type.length) {
        const token = readIdentifier(type, cursor);
        if (token) { result += type.slice(cursor, token.start) + (Object.hasOwn(bindings, token.value) ? bindings[token.value] : token.value); cursor = token.end; }
        else { result += type[cursor]; cursor++; }
    }
    return result;
}
function flattenProvided(items) { return items.flatMap(item => [item, ...flattenProvided(item.members || [])]); }
// Decode preserved Tcl LIST data only; never eval compiler strings or execute commands.
function tclList(text) {
    const result = [];
    for (let i = 0; i < text.length;) {
        if (/\s/.test(text[i])) { i++; continue; }
        let value = '', depth = 0, braced = text[i] === '{';
        if (braced) { depth = 1; i++; }
        while (i < text.length) {
            const ch = text[i++];
            if (ch === '\\') { if (i >= text.length) throw new Error('Incomplete Tcl escape'); value += text[i++]; continue; }
            if (braced) {
                if (ch === '{') depth++;
                if (ch === '}' && --depth === 0) break;
                value += ch;
            } else { if (/\s/.test(ch)) break; value += ch; }
        }
        if (braced && depth !== 0) throw new Error('Unbalanced compiler Tcl list');
        result.push(value);
    }
    return result;
}
function tclFields(words) { return new Map(words.map(word => { const [key, ...rest] = tclList(word); return [key, rest.join(' ')]; })); }
function flattenTclUses(text) { return tclList(text).flatMap(group => tclList(group)); }
function entity(view, id) {
    const item = view.occurrences[id] || view.storage[id] || view.boundaries[id] || view.behaviors[id] || view.relations[id];
    if (!item) throw new Error(`Unknown BSV entity: ${id}`);
    return item;
}
function occurrence(view, id) { const item = view.occurrences[id]; if (!item) throw new Error(`Unknown BSV occurrence: ${id}`); return item; }
function getChildren(view, id) { return occurrence(view, id).children.map(key => view.occurrences[key]); }
function getPorts(view, id) { return occurrence(view, id).ports.map(key => view.boundaries[key]); }
function getStorage(view, id) { return occurrence(view, id).storage.map(key => view.storage[key]); }
function getRelations(view, id) {
    const item = entity(view, id);
    return values(view.relations).filter(relation => item.kind === 'module-occurrence' ? relation.ownerOccurrenceId === id
        : relation.id === id || relation.fromId === id || relation.toId === id || relation.behaviorId === id ||
            item.behaviorIds?.includes(relation.behaviorId));
}
function getBehavior(view, id) {
    const item = entity(view, id);
    if (view.behaviors[id]) return [item];
    const ids = item.behaviorIds || (item.behaviorId ? [item.behaviorId] : getRelations(view, id).map(relation => relation.behaviorId).filter(Boolean));
    return [...new Set(ids)].map(key => view.behaviors[key]);
}
function getSourceRefs(view, id) { return entity(view, id).sourceEvidence; }
function getRtlContext(view, id) {
    const item = entity(view, id), owner = occurrence(view, item.ownerOccurrenceId);
    return { ...owner.rtlContext, selectedEntityId: id, highlightEntityIds:
        item.rtlCorrespondence.status === 'verified-port-contract' ? item.rtlCorrespondence.entityIds : [] };
}
function coverage(view) {
    const category = items => ({ source: items.filter(item => item.sourceEvidence.length).length,
        compilerConfirmed: items.filter(item => item.compilerConfirmation.status === 'confirmed').length, total: items.length });
    return { moduleOccurrences: category(values(view.occurrences)), storageOccurrences: category(values(view.storage)),
        methodBoundaries: category(values(view.boundaries).filter(item => item.kind === 'method-boundary')),
        methodRuleBehaviors: category(values(view.behaviors)), relations: Object.fromEntries([...new Set(values(view.relations).map(item => item.kind))]
            .map(kind => [kind, category(values(view.relations).filter(item => item.kind === kind))])),
        methodGeneratedPorts: values(view.boundaries).flatMap(item => item.rtlSignals).filter(item => item.implementationPortId).length,
        sourceExpressionLeafCauses: 0, gapCount: view.gaps.length };
}
function validateBsvArchitecture(view) {
    const documents = new Map(view.sourceDocuments.map(document => [document.id, document]));
    const ids = new Set();
    for (const collection of ['occurrences', 'storage', 'boundaries', 'behaviors', 'relations']) for (const item of values(view[collection])) {
        if (ids.has(item.id) || item.id === item.definitionId) throw new Error('Duplicate source/occurrence identity');
        ids.add(item.id);
        if (!item.definitionId || !view.occurrences[item.ownerOccurrenceId]) throw new Error('Missing definition/owner identity');
        if (!item.sourceEvidence.length) throw new Error('Missing source evidence');
        for (const ref of [...item.sourceEvidence, ...(item.explicitPredicate?.sourceEvidence || []),
            ...(item.bodyPathConditions || []).flatMap(condition => condition.sourceEvidence)]) {
            const document = documents.get(ref.sourceDocumentId);
            if (!document || document.revision !== ref.revision || document.content.slice(ref.range.start, ref.range.end) !== ref.text || hash(ref.text) !== ref.sha256 ||
                !sameRange(sourceRangeAt(document, ref.range.start, ref.range.end), ref.sourceRange)) throw new Error('Source evidence mismatch');
        }
    }
    const bindingById = new Map(view.sourceModel.bindings.map(binding => [binding.id, binding]));
    for (const relation of values(view.relations)) {
        const from = entity(view, relation.fromId), to = entity(view, relation.toId);
        const root = item => { let owner = occurrence(view, item.ownerOccurrenceId); while (owner.parentId) owner = occurrence(view, owner.parentId); return owner.id; };
        if (root(from) !== root(to)) throw new Error('Cross-root semantic relation');
        const binding = bindingById.get(relation.semanticBindingId);
        if (binding?.kind === 'behavior-access') {
            const targetId = binding.endpointId || binding.targetInstanceId;
            const actualTarget = ['state-read', 'result-flow'].includes(relation.kind) ? relation.fromId : relation.toId;
            if (actualTarget !== targetId) throw new Error('Canonical binding target mismatch');
        }
    }
    return true;
}
function buildFromCatalog(build, options = {}) {
    if (build.status !== 'ready') throw new Error('Build is not ready');
    const read = options.read || (relative => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8'));
    const sourceInputs = build.model.snapshot.sourceInputs;
    const parsedFiles = sourceInputs.map(source => {
        const file = build.sourceFiles.get(source.path);
        if (!file || file.sha256 !== source.sha256 || hash(file.text) !== source.sha256) throw new Error('Catalog source hash mismatch');
        return parseBsvFile(file.text, { uri: source.path, relativePath: source.path });
    });
    const pathRef = `${path.posix.dirname(build.model.snapshot.artifact.pathRef)}/bluetcl.json`;
    return buildBsvArchitecture({ parsedFiles, implementationModel: build.model, correspondence: build.correspondence,
        compilerMetadata: read(pathRef), compilerArtifact: { pathRef, hash: build.correspondence.metadataSha256, sourceInputs } });
}

module.exports = { buildBsvArchitecture, buildFromCatalog, getChildren, getPorts, getStorage,
    getBehavior, getRelations, getSourceRefs, getRtlContext, validateBsvArchitecture };

if (require.main === module) {
    const { createCatalog } = require('./prototype/server');
    const output = path.resolve('.build/hardware/bsv-model');
    fs.mkdirSync(output, { recursive: true });
    const summary = [];
    for (const build of createCatalog()) {
        const view = buildFromCatalog(build);
        fs.writeFileSync(path.join(output, `${build.key}-view.json`), JSON.stringify(view, null, 2));
        summary.push({ key: build.key, snapshotId: view.snapshotId, coverage: view.coverage, gaps: view.gaps });
    }
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
}
