'use strict';

// Product-owned Yosys JSON provider, ported from the independently retained G1 experiment.
const { own, table, keys, record, copyJson, stable, deepFreeze, failure, DEFAULT_LIMITS } = require('./json');
const escape = value => String(value).replace(/~/g, '~0').replace(/\//g, '~1');

function importYosys(input, suppliedSnapshot) {
    const hash = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
    record(suppliedSnapshot, 'snapshot');
    suppliedSnapshot = copyJson(suppliedSnapshot, DEFAULT_LIMITS);
    const limits = { ...DEFAULT_LIMITS };
    for (const [key, value] of Object.entries(suppliedSnapshot.limits || {})) {
        if (!own(limits, key) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) throw failure('INVALID_INPUT', `Invalid limit: ${key}`);
        limits[key] = value;
    }
    let raw = input;
    if (typeof input === 'string') {
        if (Buffer.byteLength(input) > limits.maxBytes) throw failure('LIMIT_EXCEEDED', 'JSON byte size limit');
        raw = JSON.parse(input);
    }
    raw = copyJson(raw, limits);
    const snapshot = copyJson(suppliedSnapshot, limits);
    record(snapshot.artifact, 'snapshot.artifact');
    if (!/^[a-f0-9]{64}$/.test(snapshot.artifact.hash) || typeof snapshot.artifact.pathRef !== 'string' || !snapshot.artifact.pathRef) throw failure('INVALID_INPUT', 'Snapshot artifact hash/pathRef required');
    if (typeof input === 'string' && hash(input) !== snapshot.artifact.hash) throw failure('ARTIFACT_HASH_MISMATCH', 'Artifact hash mismatch');
    if (snapshot.stage !== null && (typeof snapshot.stage !== 'string' || !snapshot.stage) || snapshot.buildOptionsFingerprint !== null && (typeof snapshot.buildOptionsFingerprint !== 'string' || !snapshot.buildOptionsFingerprint)) throw failure('INVALID_INPUT', 'Snapshot stage/options required');
    if (snapshot.toolchain !== null && (!Array.isArray(snapshot.toolchain) || !snapshot.toolchain.length || snapshot.toolchain.some(t => !t.name || !t.version || !t.identity))) throw failure('INVALID_INPUT', 'Snapshot toolchain identity required');
    if (snapshot.passSequence !== null && (!Array.isArray(snapshot.passSequence) || snapshot.passSequence.some(p => typeof p !== 'string'))) throw failure('INVALID_INPUT', 'Snapshot pass sequence required');
    if (snapshot.tops !== null && (!Array.isArray(snapshot.tops) || !snapshot.tops.length || snapshot.tops.some(t => typeof t !== 'string' || !t) || new Set(snapshot.tops).size !== snapshot.tops.length)) throw failure('INVALID_INPUT', 'Snapshot tops required and unique');
    const identity = { ...snapshot };
    delete identity.id;
    delete identity.limits;
    identity.artifact = { hash: snapshot.artifact.hash }; // Host registry labels are not build inputs.
    const snapshotId = `hw-${hash(stable({ snapshot: identity, content: raw }))}`;
    const model = { schemaVersion: 1, snapshot: { ...snapshot, id: snapshotId }, raw,
        roots: [], limits, status: 'complete', limitations: ['processes-rejected', 'memory-semantics-opaque',
            'cell-semantics-opaque', 'original-bsv-unmapped', 'src-untrusted-generated-rtl'],
        definitions: table(), occurrences: table(), cells: table(), ports: table(), pins: table(),
        bits: table(), aliases: table(), memories: table(), boundaries: table(), entities: table() };
    if (!raw || !own(raw, 'modules')) throw failure('UNSUPPORTED', 'Unsupported format: expected Yosys modules');
    const modules = record(raw.modules, 'modules');
    let entityCount = 0;
    let occurrenceCount = 0;
    const reference = pointer => ({ artifactHash: snapshot.artifact.hash, pathRef: snapshot.artifact.pathRef, pointer });
    function entity(collection, kind, suffix, pointer, fields) {
        if (++entityCount > limits.maxEntities) throw failure('LIMIT_EXCEEDED', 'Entity size limit');
        const id = `${snapshotId}/${suffix}`;
        if (own(model.entities, id)) throw failure('INVALID_INPUT', `Identity collision: ${id}`);
        const item = { id, kind, providerRefs: [reference(pointer)], ...fields };
        model[collection][id] = item;
        model.entities[id] = item;
        return item;
    }
    const definitionsByName = new Map();
    const objectField = (rawObject, field, label) => own(rawObject, field) ? record(rawObject[field], label) : table();
    function vector(bits, label) {
        if (!Array.isArray(bits)) throw failure('INVALID_INPUT', `Invalid bit vector: ${label}`);
        if (bits.length > limits.maxVectorWidth) throw failure('LIMIT_EXCEEDED', `Bit vector width limit: ${label}`);
        for (const bit of bits) {
            if (!(Number.isSafeInteger(bit) && bit >= 0) && !['0', '1', 'x', 'z'].includes(bit)) throw failure('INVALID_INPUT', `Malformed bit reference: ${label}`);
        }
    }
    const direction = value => {
        if (value !== undefined && value !== null && !['input', 'output', 'inout', 'unknown'].includes(value)) throw failure('INVALID_INPUT', 'Invalid port direction');
    };
    // Validate all definitions, including those outside selected roots.
    for (const name of keys(modules)) {
        const definition = record(modules[name], `module ${name}`);
        const pointer = `/modules/${escape(name)}`;
        if (Object.keys(objectField(definition, 'processes', pointer)).length) throw failure('UNSUPPORTED', `Unsupported processes: ${pointer}; lower with proc`);
        for (const field of ['ports', 'netnames', 'cells', 'memories', 'attributes', 'parameter_default_values']) objectField(definition, field, pointer);
        for (const field of ['ports', 'netnames']) {
            for (const [name, value] of Object.entries(definition[field] || {})) {
                vector(record(value, name).bits, `${pointer}/${field}/${name}`);
                if (field === 'ports') direction(value.direction);
            }
        }
        for (const [cellName, cell] of Object.entries(definition.cells || {})) {
            record(cell, cellName);
            if (typeof cell.type !== 'string' || !cell.type) throw failure('INVALID_INPUT', `Invalid cell type: ${cellName}`);
            for (const field of ['connections', 'parameters', 'attributes', 'port_directions']) objectField(cell, field, cellName);
            for (const value of Object.values(cell.port_directions || {})) direction(value);
            for (const [pin, bits] of Object.entries(cell.connections || {})) vector(bits, `${cellName}/${pin}`);
        }
        const attributes = definition.attributes || table();
        const blackbox = [attributes.blackbox, attributes.whitebox].some(v => v === 1 || (typeof v === 'string' && /^0*1$/.test(v)));
        const item = entity('definitions', 'definition', `definition/${escape(name)}`, pointer,
            { name, raw: definition, attributes, parameters: definition.parameter_default_values || table(), blackbox });
        definitionsByName.set(name, item);
    }
    // A malformed unselected definition is still malformed provider evidence.
    for (const definition of definitionsByName.values()) {
        for (const [cellName, cell] of Object.entries(definition.raw.cells || {})) {
            const target = definitionsByName.get(cell.type);
            if (!target) continue;
            for (const [name, bits] of Object.entries(cell.connections || {})) {
                if (!own(target.raw.ports || {}, name)) throw failure('INVALID_INPUT', `Missing formal port: ${cellName}/${name}`);
                const formal = target.raw.ports[name];
                if (bits.length && bits.length !== formal.bits.length) throw failure('INVALID_INPUT', `Boundary width mismatch: ${cellName}/${name}`);
                const actualDirection = cell.port_directions?.[name];
                if (['input', 'output', 'inout'].includes(actualDirection) && ['input', 'output', 'inout'].includes(formal.direction)
                    && actualDirection !== formal.direction) throw failure('INVALID_INPUT', `Boundary direction mismatch: ${cellName}/${name}`);
            }
        }
    }
    function materialize(name, path, parentId, cellId, ancestry) {
        if (path.length > limits.maxHierarchyDepth || ++occurrenceCount > limits.maxOccurrences) throw failure('LIMIT_EXCEEDED', 'Hierarchy depth/occurrence size limit');
        if (ancestry.includes(name)) throw failure('INVALID_INPUT', `Recursive hierarchy: ${name}`);
        const definition = definitionsByName.get(name);
        if (!definition) throw failure('INVALID_INPUT', `Missing module definition: ${name}`);
        const rawDefinition = definition.raw;
        const pointer = definition.providerRefs[0].pointer;
        const suffix = `occurrence/${encodeURIComponent(JSON.stringify(path))}`;
        const occurrence = entity('occurrences', 'occurrence', suffix, cellId ? model.cells[cellId].providerRefs[0].pointer : pointer,
            { name: path[path.length - 1], path, definitionId: definition.id, parentId, cellId,
                blackbox: definition.blackbox, children: [], cells: [], ports: [], aliases: [], memories: [], bits: [], boundaries: [] });
        if (cellId) occurrence.providerRefs.push(reference(pointer));
        function attachBits(owner, bits, bitPointer, endpointKind) {
            owner.rawBits = bits;
            owner.bits = bits.map((value, index) => {
                const isSignal = typeof value === 'number';
                // Constant values are connection-local, not shared physical driver nodes.
                const bitSuffix = isSignal ? `${suffix}/bit/${value}` : `${owner.id.slice(snapshotId.length + 1)}/constant/${index}`;
                const id = `${snapshotId}/${bitSuffix}`;
                const ref = reference(`${bitPointer}/${index}`);
                let bit = model.bits[id];
                if (!bit) {
                    bit = entity('bits', isSignal ? 'signal-bit' : 'constant', bitSuffix, ref.pointer,
                        { occurrenceId: occurrence.id, value, endpoints: [], aliases: [] });
                    occurrence.bits.push(bit.id);
                } else bit.providerRefs.push(ref);
                if (endpointKind === 'alias') bit.aliases.push({ aliasId: owner.id, index, providerRefs: [ref] });
                else bit.endpoints.push({ entityId: owner.id, index, kind: endpointKind, direction: owner.direction,
                    role: owner.direction === 'inout' ? 'bidirectional' : owner.direction === 'input' ? (endpointKind === 'port' ? 'driver' : 'load') : owner.direction === 'output' ? (endpointKind === 'port' ? 'load' : 'driver') : 'unknown', providerRefs: [ref] });
                return bit.id;
            });
        }
        for (const portName of keys(rawDefinition.ports || {})) {
            const rawPort = rawDefinition.ports[portName];
            const port = entity('ports', 'port', `${suffix}/port/${escape(portName)}`, `${pointer}/ports/${escape(portName)}`,
                { name: portName, occurrenceId: occurrence.id, direction: rawPort.direction ?? null, raw: rawPort });
            attachBits(port, rawPort.bits, `${port.providerRefs[0].pointer}/bits`, 'port');
            occurrence.ports.push(port.id);
        }
        for (const aliasName of keys(rawDefinition.netnames || {})) {
            const rawAlias = rawDefinition.netnames[aliasName];
            const alias = entity('aliases', 'alias', `${suffix}/alias/${escape(aliasName)}`, `${pointer}/netnames/${escape(aliasName)}`,
                { name: aliasName, occurrenceId: occurrence.id, raw: rawAlias });
            attachBits(alias, rawAlias.bits, `${alias.providerRefs[0].pointer}/bits`, 'alias');
            occurrence.aliases.push(alias.id);
        }
        for (const memoryName of keys(rawDefinition.memories || {})) {
            const memory = entity('memories', 'memory', `${suffix}/memory/${escape(memoryName)}`, `${pointer}/memories/${escape(memoryName)}`,
                { name: memoryName, occurrenceId: occurrence.id, raw: rawDefinition.memories[memoryName], semantics: 'opaque' });
            occurrence.memories.push(memory.id);
        }
        for (const cellName of keys(rawDefinition.cells || {})) {
            const rawCell = rawDefinition.cells[cellName];
            const target = definitionsByName.get(rawCell.type);
            const cellPointer = `${pointer}/cells/${escape(cellName)}`;
            const cell = entity('cells', 'cell', `${suffix}/cell/${escape(cellName)}`, cellPointer,
                { name: cellName, occurrenceId: occurrence.id, type: rawCell.type, raw: rawCell,
                    parameters: rawCell.parameters || table(), attributes: rawCell.attributes || table(),
                    definitionId: target ? target.id : null, blackbox: target ? target.blackbox : null,
                    semantics: target ? 'module' : 'unknown', pins: [], childOccurrenceId: null });
            occurrence.cells.push(cell.id);
            for (const pinName of keys(rawCell.connections || {})) {
                const pin = entity('pins', 'pin', `${suffix}/cell/${escape(cellName)}/pin/${escape(pinName)}`, `${cellPointer}/connections/${escape(pinName)}`,
                    { name: pinName, cellId: cell.id, occurrenceId: occurrence.id,
                        direction: own(rawCell.port_directions || {}, pinName) ? rawCell.port_directions[pinName] : null });
                attachBits(pin, rawCell.connections[pinName], pin.providerRefs[0].pointer, 'pin');
                cell.pins.push(pin.id);
            }
            if (target) {
                for (const pinId of cell.pins) {
                    const pin = model.pins[pinId];
                    if (!own(target.raw.ports || {}, pin.name)) throw failure('INVALID_INPUT', `Missing formal port: ${cellName}/${pin.name}`);
                    if (pin.bits.length && pin.bits.length !== target.raw.ports[pin.name].bits.length) throw failure('INVALID_INPUT', `Boundary width mismatch: ${cellName}/${pin.name}`);
                }
                const child = materialize(rawCell.type, [...path, cellName], occurrence.id, cell.id, [...ancestry, name]);
                cell.childOccurrenceId = child.id;
                occurrence.children.push(child.id);
                for (const pinId of cell.pins) {
                    const pin = model.pins[pinId];
                    const port = child.ports.map(id => model.ports[id]).find(p => p.name === pin.name);
                    pin.bits.forEach((actualBitId, index) => {
                        const binding = entity('boundaries', 'boundary', `${suffix}/cell/${escape(cellName)}/boundary/${escape(pin.name)}/${index}`,
                            `${pin.providerRefs[0].pointer}/${index}`, { parentOccurrenceId: occurrence.id, childOccurrenceId: child.id,
                                pinId, portId: port.id, portName: pin.name, index, actualBitId, formalBitId: port.bits[index] });
                        binding.providerRefs.push(reference(`${port.providerRefs[0].pointer}/bits/${index}`));
                        child.boundaries.push(binding.id);
                    });
                }
            }
        }
        return occurrence;
    }
    let selectedTops = snapshot.tops;
    if (selectedTops === null) {
        const marked = [...definitionsByName.values()].filter(d => d.attributes.top === 1
            || typeof d.attributes.top === 'string' && /^0*1$/.test(d.attributes.top)).map(d => d.name);
        const instantiated = new Set([...definitionsByName.values()].flatMap(d => Object.values(d.raw.cells || {}).map(c => c.type)));
        selectedTops = marked.length ? marked : [...definitionsByName.keys()].filter(name => !instantiated.has(name));
        if (!selectedTops.length) throw failure('INVALID_INPUT', 'No artifact roots; explicit tops required');
        model.topSelection = { basis: marked.length ? 'artifact-top-attribute' : 'uninstantiated-definitions', tops: [...selectedTops].sort() };
    }
    for (const top of [...selectedTops].sort()) model.roots.push(materialize(top, [top], null, null, []).id);
    return deepFreeze(model);
}

function occurrence(model, id) {
    if (!own(model.occurrences, id)) throw failure('INVALID_INPUT', `Unknown occurrence: ${id}`);
    return model.occurrences[id];
}
function getChildren(model, occurrenceId) {
    return occurrence(model, occurrenceId).children.map(id => model.occurrences[id]);
}
function getPorts(model, occurrenceId) {
    return occurrence(model, occurrenceId).ports.map(id => model.ports[id]);
}
function getNetEndpoints(model, occurrenceId, bitOrVector) {
    const context = occurrence(model, occurrenceId);
    return (Array.isArray(bitOrVector) ? bitOrVector : [bitOrVector]).map(value => {
        const id = typeof value === 'number' ? `${context.id}/bit/${value}` : value;
        if (!own(model.bits, id) || model.bits[id].occurrenceId !== occurrenceId) throw failure('INVALID_INPUT', 'Unknown or foreign bit; constants require canonical connection ID');
        const bit = model.bits[id];
        return { bitId: bit.id, value: bit.value, kind: bit.kind, endpoints: bit.endpoints, aliases: bit.aliases, providerRefs: bit.providerRefs };
    });
}
// occurrenceId always identifies the child; direction chooses formal->actual or actual->formal.
function crossHierarchyBoundary(model, occurrenceId, portName, bitIndex, direction = 'out') {
    if (!['into', 'out'].includes(direction) || !Number.isSafeInteger(bitIndex) || bitIndex < 0) throw failure('INVALID_INPUT', 'Invalid boundary query');
    const context = occurrence(model, occurrenceId);
    const binding = context.boundaries.map(id => model.boundaries[id]).find(b => b.portName === portName && b.index === bitIndex);
    if (!binding) return null; // Unconnected formal ports have no fabricated parent actual.
    return { ...binding, fromBitId: direction === 'out' ? binding.formalBitId : binding.actualBitId,
        toBitId: direction === 'out' ? binding.actualBitId : binding.formalBitId };
}
function getGeneratedEvidence(model, entityId) {
    if (!own(model.entities, entityId)) throw failure('INVALID_INPUT', `Unknown hardware entity: ${entityId}`);
    const item = model.entities[entityId];
    const generatedRtl = [];
    const seen = new Set();
    for (const ref of item.providerRefs) {
        let pointer = ref.pointer;
        while (pointer) {
            let value = model.raw;
            for (const key of pointer.slice(1).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'))) value = value[key];
            if (value && typeof value === 'object' && own(value.attributes || {}, 'src')) {
                const sourcePointer = `${pointer}/attributes/src`;
                if (!seen.has(sourcePointer)) generatedRtl.push({ raw: value.attributes.src, kind: 'generated-rtl',
                    scope: pointer === ref.pointer ? 'entity-attribute' : 'ancestor-context', ownerPointer: pointer,
                    providerRefs: [{ ...ref, pointer: sourcePointer }], access: 'unvalidated-no-file-read' });
                seen.add(sourcePointer);
                break;
            }
            pointer = pointer.slice(0, pointer.lastIndexOf('/'));
        }
    }
    return { entityId, providerRefs: item.providerRefs, generatedRtl, originalBsv: { status: 'unmapped', refs: [] } };
}

module.exports = { importYosys, getChildren, getPorts, getNetEndpoints, crossHierarchyBoundary, getGeneratedEvidence, DEFAULT_LIMITS };
