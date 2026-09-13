'use strict';

const { hash, stable, failure, copyJson, DEFAULT_LIMITS } = require('../json');
const { normalizeRange } = require('./source');
const STAGES = ['expanded', 'normtypes', 'inline-fmt', 'inline', 'itransform-1', 'split-if', 'lift', 'itransform-2',
    'iparams', 'drop-rules', 'aconv', 'rank-methods', 'task-splice', 'a-cleanup', 'schedule', 'schedule-defs',
    'dump-schedule', 'check-proofs', 'noinline', 'schedule-wires', 'schedule-assumptions', 'remove-assumptions',
    'drop-undetermined', 'astate', 'inline-wires', 'inline-creg', 'rename-io', 'drop-defs', 'aopt', 'synthesize',
    'verilog-quirks', 'final-cleanup', 'verilog', 'verilog-dollar'];
const PROC = ['proc_clean', 'proc_rmdead', 'proc_prune', 'proc_init', 'proc_arst', 'proc_rom',
    'proc_mux', 'proc_dlatch', 'proc_dff', 'proc_memwr', 'proc_clean'];
const requireFact = (value, message) => { if (!value) throw failure('ORIGIN_CONTRADICTION', message); };
const equal = (a, b) => stable(a) === stable(b);
const identity = value => hash(stable(value).replace(/[\u007f-\uffff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`));
const withoutId = ({ id, ...value }) => value;
const shape = object => Object.fromEntries(Object.entries(object).filter(([key]) =>
    !['objectRef', 'path', 'compilerId', 'origins', 'stateUid'].includes(key)));
function parseJson(text) {
    const result = copyJson(JSON.parse(text), DEFAULT_LIMITS), pending = [result];
    while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object') continue;
        for (const [key, entry] of Object.entries(value)) {
            // Compiler root descriptors use a constructor name or null, never a prototype object.
            if (key === '__proto__' || key === 'prototype' ||
                key === 'constructor' && entry !== null && typeof entry !== 'string')
                throw failure('INVALID_INPUT', 'Hostile origin JSON key');
            pending.push(entry);
        }
    }
    return result;
}
function literal(value) {
    const text = value.trim(), match = /^(\d+)'([bdh])([0-9a-fA-F_]+)$/.exec(text);
    if (/^\d+$/.test(text)) return BigInt(text);
    if (!match) return null;
    return BigInt(({ b: '0b', d: '', h: '0x' })[match[2]] + match[3].replace(/_/g, ''));
}
const symbolicEqual = (a, b) => a.length === b.length && a.every((value, i) =>
    value === b[i] || literal(value) !== null && literal(value) === literal(b[i]));
function rtlil(text) {
    const modules = new Map(); let module, attributes = {}, current;
    text.split('\n').forEach((line, i) => {
        if (line.startsWith('module ')) {
            module = line.slice(7).replace(/^\\/, ''); modules.set(module, []); attributes = {}; current = null;
        } else if (line === 'end') { module = null; current = null; attributes = {}; }
        else if (module) {
            if (current) { current.lines.push(line); if (line === '  end') current = null; return; }
            let match = /^  attribute \\(\S+) (.*)$/.exec(line);
            if (match) { attributes[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2]; return; }
            match = /^  (cell|process) (.*)$/.exec(line);
            if (match) {
                const parts = match[2].split(/\s+/);
                current = { kind: match[1], name: parts.at(-1).replace(/^\\/, ''), attributes, line1: i + 1, lines: [line] };
                modules.get(module).push(current); attributes = {};
            } else if (line.startsWith('  wire ') || line.startsWith('  connect ')) attributes = {};
        }
    });
    return modules;
}
function vector(module, expression) {
    const value = expression.trim().replace(/^\\/, '');
    if (Object.hasOwn(module.netnames, value)) return module.netnames[value].bits;
    if (Object.hasOwn(module.ports, value)) return module.ports[value].bits;
    if (Object.hasOwn(module.parameter_default_values || {}, value)) return [...module.parameter_default_values[value]].reverse();
    const match = /^(\d+)'([bdh])([0-9a-fA-F_]+)$/.exec(value), number = literal(value);
    requireFact(match && number !== null && Number(match[1]) <= 65536, 'Unsupported emitted scalar operand');
    return Array.from({ length: Number(match[1]) }, (_, i) => String(Number((number >> BigInt(i)) & 1n)));
}
function transition(before, after, observations, token, module) {
    const observed = pass => observations.filter(r => r.moduleContext === module &&
        r.observation.pass === pass && r.observation.origins?.includes(token));
    if (equal(shape(before), shape(after))) return ['preserve', []];
    let action, rows = [];
    if (before.kind === 'IPrim' && after.kind === 'APrim' && before.operation === after.operation &&
        symbolicEqual(before.operands, after.operands)) {
        action = 'typed-primitive-conversion'; rows = observed('AConv.primitive');
    } else if (before.kind === 'IStateVar' && after.kind === 'AVInst' && before.constructor === after.constructor) {
        action = 'state-to-AVInst'; rows = observed('AConv.state').filter(r => r.observation.stateUid === before.stateUid);
    } else if (before.kind === 'AVInst' && after.kind === 'AVInst') {
        action = 'clock-reset-port-lowering'; rows = observed('AState.clock-reset-inout-lowering')
            .filter(r => equal(r.observation.inputArguments, before.arguments) && equal(r.observation.outputArguments, after.arguments));
    } else if (before.kind === 'APrim' && after.kind === 'VBinary' &&
        ({ PrimAdd: 'VAdd', PrimSub: 'VSub' })[before.operation] === after.operation && equal(before.operands, after.operands)) {
        action = 'emit-binary'; rows = observed('AVerilogUtil.binary');
    } else if (before.kind === 'AVInst' && after.kind === 'VProcess' && before.constructor === 'RegN') {
        action = 'singleton-register-inlining'; rows = observed('InlineReg.singleton-process').filter(r => r.observation.memberCount === 1);
    } else if (before.kind === 'AVInst' && after.kind === 'VInstance' && before.constructor === after.constructor) {
        return ['emit-retained-instance', []];
    }
    return rows.length ? [action, rows.map(r => r.id)] : ['unsupported-rewrite', []];
}

function buildOrigins(data) {
    const payload = parseJson(data.sidecarText), files = new Map(data.files.map(file => [file.captureRef, file]));
    const file = ref => { requireFact(files.has(ref), `Unregistered capture: ${ref}`); return files.get(ref); };
    const json = ref => parseJson(file(ref).text);
    const fields = ['schema', 'provider', 'sourcePin', 'compilerBinarySha256', 'patchSha256', 'originAdapterSha256',
        'compilerLogSha256', 'artifacts', 'supportedScope', 'sourceOrigins', 'compilerObservations', 'compilerRoots',
        'links', 'unresolved', 'hierarchyBindings', 'coverage', 'limitations'];
    requireFact(payload && Object.keys(payload).length === fields.length &&
        fields.every(field => Object.hasOwn(payload, field)), 'Unknown or missing origin schema fields');
    requireFact(payload.schema === 'g3-supported-root-origin-v1', 'Unsupported origin schema');
    requireFact(payload.provider === 'isolated-bsc-ghc96-root-observer-v1' &&
        data.authority.kind === 'caller-approved-instrumented-capture', 'Origin capture authority required');
    for (const field of ['provider', 'compilerBinarySha256', 'patchSha256', 'originAdapterSha256', 'sourcePin'])
        requireFact(payload[field] === data.authority[field], `Origin authority mismatch: ${field}`);
    const execution = json('inputs/execution-identities.json');
    requireFact(execution.instrumentedBscSha256 === payload.compilerBinarySha256 &&
        execution.patchSha256 === payload.patchSha256 && execution.originAdapterSha256 === payload.originAdapterSha256 &&
        execution.sourcePin === payload.sourcePin, 'Execution identity mismatch');
    requireFact(payload.links.length <= 30000 && payload.compilerObservations.length <= 100000 &&
        payload.compilerRoots.length <= 30000, 'Origin population limit');
    const log = file('receipts/instrumented-compile-final.log'), receipt = json('receipts/instrumented-compile-final.json');
    requireFact(hash(log.text) === payload.compilerLogSha256 && receipt.logSha256 === payload.compilerLogSha256 &&
        receipt.exit === 0 && receipt.completeLog === true, 'Incomplete or wrong compiler capture');
    const observations = []; let moduleContext = null;
    log.text.replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
        if (!line.startsWith('G3EVENT ')) return;
        const observation = parseJson(line.slice(8));
        if (observation.pass === 'module.begin') moduleContext = observation.module;
        observations.push({ observation, moduleContext, logLine1: i + 1, id: identity({ observation, moduleContext }) });
        if (observation.pass === 'compiler.complete') moduleContext = null;
    });
    const differingObservation = observations.findIndex((record, i) => !equal(record, payload.compilerObservations[i]));
    requireFact(differingObservation < 0 && observations.length === payload.compilerObservations.length,
        `Compiler observations differ from raw capture at ${differingObservation}`);
    const sources = new Map(), mints = new Map(), captures = new Map();
    const inputs = json('inputs/build-inputs.json');
    for (const fixture of inputs.fixtures) {
        const source = file(`inputs/fixtures/${fixture.path}`);
        requireFact(hash(source.text) === fixture.sha256 && /^[\x00-\x7f]*$/.test(source.text) &&
            !source.text.includes('\t') && !source.text.includes('\r'), 'Origin source scope/hash mismatch');
        sources.set(`/input/fixtures/${fixture.path}`, source);
    }
    const compilerPath = value => '/' + value.replace(/^\/+/, '');
    const point = (text, p) => normalizeRange(text, { unit: 'position', encoding: 'utf8', base: 1,
        start: { line: p[0], column: p[1] }, end: { line: p[0], column: p[1] } }).start;
    const sourceCaptured = new Set();
    for (const record of observations) {
        const event = record.observation;
        if (event.pass === 'parser.source' || event.pass === 'parser.mint') {
            const source = sources.get(compilerPath(event.file));
            requireFact(source && event.sourceSha256 === source.contentHash, 'Foreign compiler source identity');
            if (event.pass === 'parser.source') {
                requireFact(event.source === source.text && event.preprocessed === source.text, 'Source/preprocessed capture differs');
                sourceCaptured.add(compilerPath(event.file));
            } else {
                requireFact(sourceCaptured.has(compilerPath(event.file)) && event.origins.length === 1, 'Mint lacks parsed source evidence');
                const start = point(source.text, event.begin), end = point(source.text, event.end);
                requireFact(start < end, 'Empty/reversed mint span');
                const token = [source.contentHash, compilerPath(event.file), event.kind, ...event.begin, ...event.end].join(':');
                requireFact(event.origins[0] === token && ['binding', 'rhs-binary'].includes(event.kind), 'Origin token mismatch');
                if (event.kind === 'rhs-binary') {
                    const at = point(source.text, event.operatorPoint);
                    requireFact(at >= start && at < end && '+-'.includes(source.text[at]), 'RHS token is not its parser operator');
                }
                const value = { token, pathRef: source.captureRef, sourceSha256: source.contentHash, kind: event.kind,
                    range: { unit: 'utf8', start, end }, compilerRange: { begin: event.begin, end: event.end, base: 1, halfOpen: true },
                    slice: source.text.slice(start, end), sliceSha256: hash(source.text.slice(start, end)) };
                requireFact(!mints.has(token) || equal(mints.get(token), value), 'Contradictory mint');
                mints.set(token, value);
            }
        }
        if (event.pass === 'stage.capture') {
            if (!captures.has(event.module)) captures.set(event.module, []);
            const refs = new Set();
            for (const object of event.objects) {
                const ref = object.objectRef, key = stable(ref);
                requireFact(ref.module === event.module && ref.stage === event.stage && Number.isSafeInteger(ref.localNodeOrdinal) &&
                    ref.localNodeOrdinal >= 0 && ref.localNodeOrdinal < event.populationCount && !refs.has(key), 'Invalid stage-local object');
                requireFact(object.origins.every(token => mints.has(token)), 'Unminted stage origin');
                refs.add(key);
            }
            captures.get(event.module).push(record);
        }
    }
    requireFact(equal([...mints.values()], payload.sourceOrigins), 'Sidecar source origins differ from compiler mints');
    for (const rows of captures.values()) requireFact(equal(rows.map(r => r.observation.stage), STAGES), 'Missing/reordered compiler stage');
    const expectedRoots = new Set([...captures].flatMap(([module, rows]) =>
        rows[0].observation.objects.flatMap(object => object.origins.map(origin => identity({ module, origin })))));
    const roots = new Map();
    for (const candidate of payload.compilerRoots) {
        requireFact(expectedRoots.delete(candidate.id) && candidate.id === identity({ module: candidate.module, origin: candidate.origin }) &&
            candidate.completeOriginSet === false && equal(candidate.source, mints.get(candidate.origin)), 'Invalid root identity/source');
        const trace = [], edges = []; let complete = true;
        for (const record of captures.get(candidate.module) || []) {
            const matches = record.observation.objects.filter(object => object.origins.includes(candidate.origin));
            if (matches.length !== 1) { complete = false; continue; }
            const object = matches[0];
            if (trace.length) {
                const prior = trace.at(-1), [action, witnesses] = transition(prior.object, object, observations, candidate.origin, candidate.module);
                const edge = { pass: record.observation.stage, input: prior.object.objectRef, output: object.objectRef,
                    inputOrigins: prior.object.origins, outputOrigins: object.origins, action, branchObservationIds: witnesses,
                    captureIds: [prior.captureId, record.id] };
                edges.push({ ...edge, id: identity(edge) });
                if (action === 'unsupported-rewrite') complete = false;
            }
            trace.push({ captureId: record.id, object });
        }
        const required = candidate.source.kind === 'binding'
            ? ['parser.mint', 'Imperative.binding-name', 'IConv.binding-name', 'IStateLoc.cleanupInstId', 'IExpand.newState']
            : ['parser.mint', 'ParseOp.binary', 'TCheck.binary-desugar', 'TCheck.tiVar', 'AConv.primitive', 'AVerilogUtil.binary'];
        if (!required.every(pass => observations.some(r => r.observation.pass === pass && r.observation.origins?.includes(candidate.origin)))) complete = false;
        requireFact(equal(trace, candidate.trace) && equal(edges, candidate.transformations) &&
            candidate.compilerRootTransportComplete === complete && (candidate.gaps.length === 0) === complete, 'Root trace/premise/completeness contradiction');
        roots.set(candidate.id, candidate);
    }
    requireFact(expectedRoots.size === 0, 'Missing compiler roots');
    const readerCache = new Map(), validated = [], linkIds = new Set();
    for (const link of payload.links) {
        requireFact(!linkIds.has(link.id), 'Duplicate origin link ID');
        linkIds.add(link.id);
        requireFact(link.id === identity(withoutId(link)) && link.completeOriginSet === false, 'Invalid link identity or complete-set claim');
        const compiler = roots.get(link.compilerRootId), source = mints.get(link.origin);
        requireFact(compiler && source && compiler.origin === link.origin, 'Dangling origin/root link');
        const corpus = Object.keys(payload.artifacts).find(key => payload.artifacts[key] === link.target.artifactSha256);
        requireFact(corpus, 'Foreign artifact in origin link');
        const rawFile = file(`results/instrumented/${corpus}/design.json`), raw = parseJson(rawFile.text);
        requireFact(hash(rawFile.text) === link.target.artifactSha256, 'Origin artifact hash mismatch');
        const module = raw.modules[link.target.module], cell = module?.cells?.[link.target.cell];
        requireFact(cell && equal(cell.connections, link.orderedConnections) && equal(cell.parameters, link.parameters), 'Target cell/ordered pins differ');
        const marker = cell.attributes?.g3_emit_id, token = cell.attributes?.g3_origin_ref, emitted = link.emittedObject;
        requireFact(token === link.origin && marker === emitted.emitId && equal(emitted.origins, [token]), 'Cell origin marker differs');
        const rtlFiles = data.files.filter(f => f.captureRef.startsWith(`results/instrumented/${corpus}/rtl/`) && hash(f.text) === emitted.rtlSha256);
        requireFact(rtlFiles.length === 1, 'Missing/ambiguous emitted RTL');
        const rtl = rtlFiles[0].text, span = emitted.attributeSpanBytes;
        const attr = /^\(\*\s*g3_emit_id\s*=\s*("[^"]*")\s*,\s*g3_origin_ref\s*=\s*("[^"]*")\s*\*\)$/.exec(rtl.slice(span.start, span.end));
        requireFact(attr && JSON.parse(attr[1]) === marker && JSON.parse(attr[2]) === token &&
            rtl.slice(0, span.start).split('\n').length === emitted.line1, 'False emitted attribute span');
        requireFact(new RegExp('\\bmodule\\s+' + emitted.module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(rtl) &&
            (module.attributes?.hdlname || link.target.module) === emitted.module && compiler.module === emitted.module, 'Wrong emitted module context');
        const stages = ['read', 'hierarchy', ...PROC.map((pass, i) => `${String(i + 1).padStart(2, '0')}-${pass}`)];
        requireFact(equal(link.readerTransport.map(r => r.stage), stages), 'Missing/reordered reader stages');
        const readerObjects = [];
        for (const [i, capture] of link.readerTransport.entries()) {
            const captured = file(capture.path);
            requireFact(hash(captured.text) === capture.sha256, 'Reader capture hash differs');
            if (!readerCache.has(capture.path)) readerCache.set(capture.path, rtlil(captured.text));
            const objects = readerCache.get(capture.path).get(capture.module) || [];
            const matches = objects.filter(o => o.attributes.g3_emit_id === marker &&
                (emitted.role !== 'process' || o.kind === (i < 10 ? 'process' : 'cell')));
            requireFact(matches.length === 1 && matches[0].kind === capture.objectKind &&
                matches[0].name === capture.objectName && matches[0].line1 === capture.line1 &&
                capture.module === (i === 0 ? emitted.module : link.target.module), 'False reader object identity/transport');
            readerObjects.push(matches[0]);
        }
        requireFact(readerObjects.at(-1).name === link.target.cell, 'Final target is not the lowered object');
        const last = compiler.trace.at(-1).object;
        if (emitted.role === 'operator') {
            requireFact('+-'.includes(rtl.slice(0, span.start).trimEnd().at(-1)) && last.kind === 'VBinary' &&
                cell.type === ({ VAdd: '$add', VSub: '$sub' })[last.operation], 'Operator attribute/type mismatch');
            requireFact(equal(cell.connections.A, vector(module, last.operands[0])) &&
                equal(cell.connections.B, vector(module, last.operands[1])), 'Operator ordered inputs mismatch');
            const final = compiler.trace.find(t => t.object.objectRef.stage === 'final-cleanup').object;
            const width = /^ATBit \{atb_size = (\d+)\}$/.exec(final.type);
            requireFact(width && cell.connections.Y.length === Number(width[1]) &&
                parseInt(cell.parameters.A_SIGNED, 2) === 0 && parseInt(cell.parameters.B_SIGNED, 2) === 0, 'Operator width/sign mismatch');
        } else if (emitted.role === 'process') {
            requireFact(rtl.slice(span.end).trimStart().startsWith('always@') && last.kind === 'VProcess' &&
                cell.type === '$dff' && parseInt(cell.parameters.CLK_POLARITY, 2) === 1, 'Unsupported storage lowering');
            const process = readerObjects[9], sync = process.lines.filter(l => l.startsWith('    sync '));
            const updates = process.lines.filter(l => l.startsWith('      update '));
            const clock = sync.length === 1 && /^    sync posedge (\S+)$/.exec(sync[0]);
            const update = updates.length === 1 && /^      update (\S+) (\S+)$/.exec(updates[0]);
            requireFact(clock && update && equal(cell.connections.CLK, vector(module, clock[1])) &&
                equal(cell.connections.Q, vector(module, update[1])) && equal(cell.connections.D, vector(module, update[2])),
            'Storage process does not lower to the exact singleton sync vector');
            const member = compiler.trace.find(t => t.object.objectRef.stage === 'final-cleanup').object;
            requireFact(literal(member.arguments[2]) === BigInt(cell.connections.Q.length), 'Storage width mismatch');
        } else requireFact(emitted.role === 'instance' && link.target.kind === 'hierarchy-cell', 'Unknown emitted role');
        const partial = !compiler.compilerRootTransportComplete || emitted.module !== link.target.module;
        requireFact(link.status === (partial ? 'partial-observed-token-transport' : 'verified-known-contributor'), 'Unproved origin status promotion');
        const paths = [];
        const walk = (name, occurrencePath, ancestors) => {
            requireFact(!ancestors.includes(name), 'Recursive captured hierarchy');
            if (name === link.target.module) paths.push(occurrencePath);
            for (const [cellName, child] of Object.entries(raw.modules[name].cells))
                if (Object.hasOwn(raw.modules, child.type)) walk(child.type, [...occurrencePath, cellName], [...ancestors, name]);
        };
        const tops = Object.entries(raw.modules).filter(([, m]) => m.attributes?.top && parseInt(m.attributes.top, 2) === 1);
        requireFact(tops.length === 1, 'Ambiguous captured top');
        walk(tops[0][0], [tops[0][0]], []);
        requireFact(equal(paths, link.implementationOccurrences), 'Wrong origin occurrence context');
        if (link.target.artifactSha256 === data.importResult.snapshot.artifact.hash && link.target.kind === 'leaf-cell') validated.push({ link, compiler, source });
    }
    const model = data.importResult.implementation, declarations = data.baseClaims.filter(c => c.scope === 'declaration');
    const claims = [], unresolved = [];
    for (const item of validated) {
        const { link, compiler, source } = item;
        if (link.status !== 'verified-known-contributor') { unresolved.push({ linkId: link.id, reason: 'partial-origin-transport', gaps: link.gaps }); continue; }
        const registered = file(source.pathRef), normalized = normalizeRange(registered.text, source.range);
        const candidates = declarations.map(c => c.tuple.source).filter(ref => ref.pathRef === registered.pathRef &&
            (source.kind === 'binding' ? ref.sourceKind === 'state-declaration' && ref.range.start <= normalized.start && ref.range.end >= normalized.end
                : ref.sourceKind === 'expression' && ref.range.start === normalized.start && ref.range.end === normalized.end));
        requireFact(candidates.length === 1, 'Origin source has no unique existing semantic record');
        for (const occurrencePath of link.implementationOccurrences) {
            const occurrence = Object.values(model.occurrences).find(o => equal(o.path, occurrencePath) &&
                model.definitions[o.definitionId].name === link.target.module);
            const target = occurrence?.cells.map(id => model.cells[id]).find(c => c.name === link.target.cell);
            requireFact(target && equal(target.raw.connections, link.orderedConnections), 'Origin target does not resolve in G2 snapshot');
            const value = { relationKind: 'compiler-recorded-contributor', scope: 'origin',
                source: { ...candidates[0], token: source.token, kind: source.kind, range: normalized, text: source.slice },
                target: { entityId: target.id, snapshotId: model.snapshot.id, modelId: model.id,
                    occurrenceId: occurrence.id, occurrencePath, kind: 'cell' },
                compilerRootId: compiler.id, linkId: link.id, status: 'verified-known-contributor', completeOriginSet: false,
                proves: 'recorded supported compiler/reader contribution', doesNotProve: ['exclusive-cause', 'complete-origin-set', 'all-connected-net-origins'] };
            claims.push({ id: `origin-claim-${identity(value)}`, ...value });
        }
    }
    requireFact(new Set(claims.map(claim => claim.id)).size === claims.length, 'Duplicate origin claim ID');
    const leafIds = Object.values(model.cells).filter(c => !c.childOccurrenceId).map(c => c.id).sort();
    const bundle = { schemaVersion: 1, implementationSnapshotId: model.snapshot.id, implementationModelId: model.id,
        provider: data.authority, adapterIdentity: data.adapterIdentity, evidenceIdentity: data.evidenceIdentity, claims, unresolved,
        coverage: { selection: 'occurrence-expanded leaf cells in the selected instrumented artifact', populationIds: leafIds,
            populationHash: identity(leafIds), total: leafIds.length, knownContributorObjects: new Set(claims.map(c => c.target.entityId)).size,
            completeOriginSetObjects: 0, unmappedOrPartial: leafIds.length - new Set(claims.map(c => c.target.entityId)).size } };
    return { bundle: { id: `origin-bundle-${identity(bundle)}`, ...bundle },
        explanations: validated.map(({ link, compiler, source }) => ({ linkId: link.id, source, compiler, reader: link.readerTransport, target: link.target })) };
}

module.exports = { buildOrigins };
