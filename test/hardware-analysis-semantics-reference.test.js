'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const oracle = require('../experiments/hardware/g5/cell-reference.cjs');
const { buildSnapshot } = require('../src/hardware/snapshot');
const { describeCell, cellDependencies } = require('../src/hardware/analysis/cell-semantics');
const { createAnalysisQuery } = require('../src/hardware');
const root = path.resolve(__dirname, '..');
const evidence = { schema: 'g5-cell-reference-v1', source: oracle.SOURCE, profile: oracle.PROFILE,
    domains: [], mutations: [], integration: [] };

// Raw synthetic INPUTS only. Importing these below obtains real product identities.
function binary(type, a, b, y, signed = 0, bSigned = signed) {
    const unary = type === '$logic_not';
    return cell(type, { A_WIDTH: a, Y_WIDTH: y, A_SIGNED: signed,
        ...(unary ? {} : { B_WIDTH: b, B_SIGNED: bSigned }) }, { A: a, ...(unary ? {} : { B: b }), Y: y });
}
function mux(width, selects = null) {
    return cell(selects === null ? '$mux' : '$pmux', { WIDTH: width, ...(selects === null ? {} : { S_WIDTH: selects }) },
        { A: width, B: width * (selects || 1), S: selects || 1, Y: width });
}
function cell(type, parameters, widths) {
    let bit = 2;
    return { type, parameters, port_directions: Object.fromEntries(Object.keys(widths).map(port => [port, port === 'Y' || port === 'Q' ? 'output' : 'input'])),
        connections: Object.fromEntries(Object.entries(widths).map(([port, width]) => [port, Array.from({ length: width }, () => bit++)])) };
}
function edge(port, index, out, kind = port === 'S' ? 'control-dependency' : 'data-dependency', output = 'Y') {
    return { family: 'logic-dependency', kind, from: { port, index }, to: { port: output, index: out } };
}
// Candidate sets used ONLY to self-test the oracle; no product code is consulted.
// The evaluator above discovers changing-output obligations from assignments.
function candidate(raw) {
    const result = [], y = raw.connections.Y.length;
    for (const [port, bits] of Object.entries(raw.connections)) if (port !== 'Y') {
        for (let i = 0; i < bits.length; i++) for (let j = 0; j < y; j++) {
            if (['$mux', '$pmux'].includes(raw.type) ? port === 'S' || i % y === j : ['$add', '$sub'].includes(raw.type) || j === 0) result.push(edge(port, i, j));
        }
    }
    return result;
}
function values(a, b, s) {
    return { A: [...a], ...(b === undefined ? {} : { B: [...b] }), ...(s === undefined ? {} : { S: [...s] }) };
}
function checkValue(raw, input, expected) { assert.deepEqual(oracle.evaluate(raw, input), [...expected]); }
function record(report) { evidence.domains.push(report); return report; }
function mutation(name, code, run) {
    assert.throws(run, { code });
    evidence.mutations.push({ name, rejected: true, code });
}

// Pins machine-consumed source identity, not prose/operator spelling.
test('reference uses the preserved original simlib identity', () => {
    const bytes = fs.readFileSync(path.join(root, oracle.SOURCE.path));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), oracle.SOURCE.sha256);
    assert.equal(bytes.length, 78616);
});

test('four-state value anchors: arithmetic widths/signs, comparisons, logical nonzero, mux and actual pmux case behavior', () => {
    for (const type of ['$add', '$sub']) {
        for (const symbol of ['x', 'z']) {
            checkValue(binary(type, 3, 2, 1), values(`00${symbol}`, '00'), 'x');
            checkValue(binary(type, 2, 3, 2, 1), values('00', `00${symbol}`), 'xx');
        }
    }
    checkValue(binary('$add', 3, 1, 3), values('110', '1'), '001'); // 3+1=4
    checkValue(binary('$add', 1, 2, 3, 1), values('1', '10'), '000'); // -1+1
    checkValue(binary('$add', 1, 2, 3), values('1', '10'), '010'); // 1+1
    checkValue(binary('$add', 3, 2, 1), values('111', '10'), '0'); // truncate 8
    checkValue(binary('$sub', 1, 1, 3), values('0', '1'), '111'); // 0-1
    checkValue(binary('$sub', 3, 1, 3), values('001', '1'), '110'); // 4-1
    checkValue(binary('$sub', 1, 2, 3, 1), values('1', '10'), '011'); // -1-1=-2
    for (const [type, mismatch, equal] of [['$eq', '0', '1'], ['$ne', '1', '0']]) {
        checkValue(binary(type, 2, 2, 3), values('0x', '1z'), `${mismatch}00`);
        checkValue(binary(type, 2, 2, 3), values('0x', '0x'), 'x00');
        checkValue(binary(type, 1, 2, 1, 1), values('1', '11'), equal);
        checkValue(binary(type, 1, 2, 1), values('1', '11'), mismatch);
        checkValue(binary(type, 1, 2, 1, 1), values('z', '10'), 'x');
    }
    checkValue(binary('$lt', 1, 2, 3, 1), values('1', '10'), '100');
    checkValue(binary('$lt', 1, 2, 3), values('1', '10'), '000');
    checkValue(binary('$lt', 2, 2, 3), values('0x', '11'), 'x00');
    checkValue(binary('$logic_not', 3, null, 3), values('00z'), 'x00');
    checkValue(binary('$logic_not', 3, null, 3), values('x1z'), '000');
    checkValue(binary('$logic_not', 3, null, 3), values('000'), '100');
    checkValue(binary('$logic_and', 3, 2, 3, 1, 0), values('x1z', '10'), '100');
    checkValue(binary('$logic_and', 3, 2, 3), values('x0z', '00'), '000');
    checkValue(binary('$logic_and', 3, 2, 3), values('x0z', '10'), 'x00');
    checkValue(binary('$logic_or', 3, 2, 3), values('x0z', '10'), '100');
    checkValue(binary('$logic_or', 3, 2, 3), values('x0z', '00'), 'x00');
    for (const select of ['x', 'z']) checkValue(mux(3), values('0z1', '1z1', select), 'xz1');
    checkValue(mux(2, 3), values('10', '011100', '000'), '10');
    checkValue(mux(2, 3), values('10', '011100', '010'), '11');
    checkValue(mux(2, 3), values('10', '011100', '110'), 'xx');
    checkValue(mux(2, 3), values('10', '011100', 'x00'), 'xx');
    checkValue(mux(2, 3), values('10', '011100', 'x10'), 'xx');
    checkValue(mux(2, 3), values('10', '011100', '1x0'), 'xx');
    // Exact case does not match z against x. Unlike mux ?:, z is ignored here.
    checkValue(mux(2, 3), values('10', '011100', 'zzz'), '10');
    checkValue(mux(2, 3), values('10', '011100', 'z1z'), '11');
});

const tiny = [];
for (const type of ['$add', '$sub', '$eq', '$ne', '$lt']) {
    for (const signed of [0, 1]) for (const [a, b, y] of [[1, 1, 1], [1, 2, 3], [2, 1, 3], [2, 3, 1], [3, 2, 2], [3, 3, 3]]) tiny.push(binary(type, a, b, y, signed));
}
for (const type of ['$logic_and', '$logic_or']) for (const signed of [0, 1]) for (const bSigned of [0, 1]) {
    for (const [a, b, y] of [[1, 1, 1], [2, 3, 3], [3, 2, 2]]) tiny.push(binary(type, a, b, y, signed, bSigned));
}
for (const width of [1, 2, 3]) for (const signed of [0, 1]) tiny.push(binary('$logic_not', width, null, 3, signed));
for (const width of [1, 2, 3]) tiny.push(mux(width));
for (const [width, selects] of [[1, 1], [1, 2], [2, 1]]) tiny.push(mux(width, selects));
const reports = new Map();
test('bounded exhaustive single-site four-state toggling discovers required dependencies for all ten types', () => {
    let removed = 0;
    for (const raw of tiny) {
        const report = record(oracle.enumerate(raw)), edges = candidate(raw);
        reports.set(raw, report);
        assert.equal(report.assignments, 4 ** report.inputSites);
        assert.equal(report.transitions, report.assignments * report.inputSites * 3 / 2);
        assert.equal(report.evaluations, report.assignments + report.transitions);
        assert.equal(oracle.assertStructure(raw, edges), edges.length);
        assert.ok(oracle.assertSound(report, edges) > 0);
        // Delete EACH independently witnessed edge, not just a convenient sample.
        for (const witness of report.witnesses) {
            const mutant = edges.filter(e => !(e.from.port === witness.from.port && e.from.index === witness.from.index && e.to.index === witness.to.index));
            assert.throws(() => oracle.assertSound(report, mutant), { code: 'OMITTED_VALUE_DEPENDENCY' });
            removed++;
        }
    }
    evidence.mutations.push({ name: 'remove-each-exhaustively-witnessed-dependency', rejected: true, count: removed, code: 'OMITTED_VALUE_DEPENDENCY' });
    assert.deepEqual([...new Set(tiny.map(raw => raw.type))].sort(), [...oracle.TYPES].sort());
});

function pmuxAssignments(raw) {
    const width = raw.parameters.WIDTH, selects = raw.parameters.S_WIDTH;
    const patterns = oracle.SYMBOLS.map(symbol => ({ A: Array(width).fill(symbol), B: Array(width * selects).fill(symbol) }));
    // All select patterns, with uniform data and isolated 1/x/z at EVERY A/B site.
    // Not exhaustive in data: W3/K3 has 15 input sites, deliberately never 4^15.
    for (const port of ['A', 'B']) for (let i = 0; i < raw.connections[port].length; i++) for (const symbol of ['1', 'x', 'z']) {
        const pattern = { A: Array(width).fill('0'), B: Array(width * selects).fill('0') };
        pattern[port][i] = symbol; patterns.push(pattern);
    }
    return Array.from({ length: 4 ** selects }, (_, n) => {
        const S = Array.from({ length: selects }, (_, i) => oracle.SYMBOLS[Math.floor(n / 4 ** i) % 4]);
        return patterns.map(pattern => ({ ...pattern, S }));
    }).flat();
}
const larger = [[2, 2], [2, 3], [3, 1], [3, 2], [3, 3]].map(([width, selects]) => mux(width, selects));
test('larger pmux vectors are targeted, not falsely claimed exhaustive; explicit budget rejects 4^15', () => {
    mutation('refuse-unbounded-pmux-enumeration', 'REFERENCE_ENUMERATION_BOUND', () => oracle.enumerate(mux(3, 3)));
    for (const raw of larger) {
        const report = record(oracle.enumerate(raw, { assignments: pmuxAssignments(raw) }));
        reports.set(raw, report);
        assert.equal(report.mode, 'targeted-four-state');
        assert.equal(report.transitions, report.assignments * report.inputSites * 3);
        oracle.assertSound(report, candidate(raw)); oracle.assertStructure(raw, candidate(raw));
        assert.equal(report.witnesses.length, candidate(raw).length);
    }
});

test('negative mutations reject role flips, positional broadening, upper Boolean edges, state crossings and unknown fallbacks', () => {
    const m = mux(2, 2), edges = candidate(m);
    const flipped = edges.map(e => e.from.port === 'S' ? { ...e, kind: 'data-dependency' } : e);
    mutation('flip-select-to-data', 'DEPENDENCY_ROLE', () => oracle.assertStructure(m, flipped));
    mutation('flip-data-to-control', 'DEPENDENCY_ROLE', () => oracle.assertStructure(m, edges.map(e => e.from.port === 'A' ? { ...e, kind: 'control-dependency' } : e)));
    mutation('cross-pmux-packed-slice-position', 'CROSS_POSITION_DEPENDENCY', () => oracle.assertStructure(m, [...edges, edge('B', 3, 0)]));
    const ordinary = mux(3);
    mutation('all-to-all-mux', 'CROSS_POSITION_DEPENDENCY', () => oracle.assertStructure(ordinary, [...candidate(ordinary), edge('A', 2, 0)]));
    for (const type of ['$eq', '$ne', '$lt', '$logic_not', '$logic_and', '$logic_or']) {
        const raw = binary(type, 2, 3, 3);
        mutation(`upper-Boolean-Y-${type}`, 'BOOLEAN_UPPER_DEPENDENCY', () => oracle.assertStructure(raw, [...candidate(raw), edge('A', 0, 1)]));
    }
    const arithmetic = binary('$add', 3, 3, 3), prefix = candidate(arithmetic).filter(e => e.from.index <= e.to.index);
    const report = reports.get(tiny.find(raw => raw.type === '$add' && raw.parameters.A_WIDTH === 3 && raw.parameters.B_WIDTH === 3 && raw.parameters.A_SIGNED === 0));
    mutation('two-state-prefix-loses-high-unknown-poisoning', 'OMITTED_VALUE_DEPENDENCY', () => oracle.assertSound(report, prefix));
    for (const polarity of [0, 1]) {
        const state = cell('$dff', { WIDTH: 2, CLK_POLARITY: polarity }, { D: 2, CLK: 1, Q: 2 });
        assert.equal(oracle.assertStructure(state, []), 0);
        mutation(`D-to-Q-polarity-${polarity}`, 'STATE_CROSSING', () => oracle.assertStructure(state, [edge('D', 0, 0, 'data-dependency', 'Q')]));
        mutation(`CLK-to-Q-polarity-${polarity}`, 'STATE_CROSSING', () => oracle.assertStructure(state, [edge('CLK', 0, 0, 'control-dependency', 'Q')]));
    }
    const vendor = cell('vendor_unknown', {}, { A: 2, Y: 2 });
    assert.equal(oracle.assertStructure(vendor, []), 0);
    mutation('unknown-all-input-fallback', 'UNKNOWN_CELL_FALLBACK', () => oracle.assertStructure(vendor, [edge('A', 0, 0)]));
    const literal = mux(2); literal.connections.A = ['x', 'z']; literal.connections.S = ['1'];
    oracle.assertStructure(literal, candidate(literal));
    mutation('prune-literal-unselected-A', 'OMITTED_STRUCTURAL_SITE', () => oracle.assertStructure(literal, candidate(literal).filter(e => e.from.port !== 'A')));
});

function importedCell(raw) {
    const imported = buildSnapshot(JSON.stringify({ modules: { top: { attributes: { top: 1 }, ports: {}, cells: { dut: raw } } } }), 'reference-input.json', {});
    return { imported, model: imported.implementation, dut: Object.values(imported.implementation.cells)[0] };
}
function localize(model, dut, edges) {
    return edges.map(e => {
        assert.equal(e.cellId, dut.id);
        assert.equal(e.semanticsProfile, oracle.PROFILE);
        assert.equal(e.precision, 'conservative-structural');
        assert.match(e.id, /^analysis-(data|control)-dependency-[a-f0-9]{64}$/);
        function site(ref, direction) {
            const pin = model.pins[ref.entityId];
            assert.ok(pin);
            assert.equal(pin.cellId, dut.id);
            assert.equal(pin.direction, direction);
            assert.deepEqual(ref, { kind: 'implementation', objectKind: 'pin', entityId: pin.id, index: ref.index,
                bitId: pin.bits[ref.index], occurrenceId: dut.occurrenceId, snapshotId: model.snapshot.id });
            assert.equal(model.bits[ref.bitId].value, dut.raw.connections[pin.name][ref.index]);
            return { port: pin.name, index: ref.index };
        }
        return { family: e.family, kind: e.kind, from: site(e.from, 'input'), to: site(e.to, 'output') };
    });
}
function directEdges(model, dut, direction) {
    const edges = [];
    for (const id of dut.pins) {
        const pin = model.pins[id];
        if (pin.direction !== (direction === 'backward' ? 'output' : 'input')) continue;
        for (let index = 0; index < pin.bits.length; index++) {
            const result = cellDependencies(model, { pinId: pin.id, index, direction, semanticsProfile: oracle.PROFILE });
            assert.equal(result.status, 'supported'); assert.equal(result.reason, null);
            assert.equal(result.precision, 'conservative-structural'); assert.equal(result.boundary, undefined);
            edges.push(...result.edges);
        }
    }
    assert.equal(new Set(edges.map(e => e.id)).size, edges.length);
    return edges;
}
test('real imported tiny cells satisfy the independent value oracle in both dependency directions', () => {
    for (const raw of [...tiny, ...larger]) {
        const { model, dut } = importedCell(raw), description = describeCell(model, dut.id);
        assert.equal(description.status, 'supported'); assert.equal(description.classification, 'combinational');
        assert.equal(description.snapshotId, model.snapshot.id); assert.equal(description.cellId, dut.id);
        assert.equal(description.semanticsProfile, oracle.PROFILE);
        const backward = directEdges(model, dut, 'backward'), forward = directEdges(model, dut, 'forward');
        assert.deepEqual(backward.map(e => e.id).sort(), forward.map(e => e.id).sort());
        for (const edges of [backward, forward]) {
            const localized = localize(model, dut, edges);
            oracle.assertSound(reports.get(raw), localized); oracle.assertStructure(raw, localized);
        }
        evidence.integration.push({ surface: 'cellDependencies', domain: evidence.domains.indexOf(reports.get(raw)),
            snapshotId: model.snapshot.id, cellId: dut.id, directions: ['backward', 'forward'], edges: backward.length });
    }
});

test('actual imported literal terminals retain separate 0/1/x/z sites and select roles without branch pruning', () => {
    for (const select of oracle.SYMBOLS) {
        const raw = mux(2, 2); raw.connections.A = ['0', '1']; raw.connections.B = ['x', 'z', '0', '0']; raw.connections.S = [select, select];
        const { model, dut } = importedCell(raw), edges = directEdges(model, dut, 'backward');
        oracle.assertStructure(raw, localize(model, dut, edges));
        const pin = name => dut.pins.map(id => model.pins[id]).find(p => p.name === name);
        const inputBits = ['A', 'B', 'S'].flatMap(name => pin(name).bits);
        assert.equal(new Set(inputBits).size, 8);
        assert.deepEqual(inputBits.map(id => model.bits[id].value), ['0', '1', 'x', 'z', '0', '0', select, select]);
        assert.equal(inputBits.every(id => model.bits[id].kind === 'constant'), true);
        assert.deepEqual([...new Set(edges.map(e => e.from.bitId))].sort(), [...inputBits].sort());
    }
});

test('product state and unknown boundaries cannot emit D/Q or fallback dependencies', () => {
    for (const raw of [cell('$dff', { WIDTH: 2, CLK_POLARITY: 0 }, { D: 2, CLK: 1, Q: 2 }),
        cell('$dff', { WIDTH: 2, CLK_POLARITY: 1 }, { D: 2, CLK: 1, Q: 2 }), cell('vendor_unknown', {}, { A: 2, Y: 2 })]) {
        const { model, dut } = importedCell(raw), expected = raw.type === '$dff' ? 'sequential' : 'unsupported-cell';
        assert.equal(describeCell(model, dut.id).status, 'boundary');
        for (const id of dut.pins) for (const direction of ['backward', 'forward']) {
            const pin = model.pins[id];
            const result = cellDependencies(model, { pinId: id, index: 0, direction, semanticsProfile: oracle.PROFILE });
            assert.equal(result.status, 'boundary'); assert.equal(result.reason, expected);
            assert.equal(result.boundary.reason, expected); assert.equal(result.boundary.cellId, dut.id);
            assert.equal(result.boundary.at.entityId, id); assert.equal(result.boundary.at.bitId, pin.bits[0]);
            assert.equal(result.boundary.at.snapshotId, model.snapshot.id);
            if (raw.type === '$dff') assert.equal(result.boundary.side, { D: 'data-sink', Q: 'state-source', CLK: 'clock-sink' }[pin.name]);
            oracle.assertStructure(raw, result.edges);
        }
    }
});

function rawAt(raw, occurrencePath, name) {
    let definition = raw.modules[occurrencePath[0]];
    for (const part of occurrencePath.slice(1)) definition = raw.modules[definition.cells[part].type];
    return definition.cells[name];
}
const tupleSet = edges => edges.map(e => JSON.stringify([e.family, e.kind, e.from.port, e.from.index, e.to.port, e.to.index])).sort();
test('preserved A/B/C stock and instrumented cells: independent raw incidence and public worker-backed dependencies pipeline', async () => {
    const seenTypes = new Set();
    for (const provider of ['stock', 'instrumented']) for (const corpus of ['A', 'B', 'C']) {
        const artifactRef = provider === 'stock' ? `docs/hardware/evidence/toolchain/${corpus}/design.json`
            : `docs/hardware/evidence/g3-origin-ghc96/results/instrumented/${corpus}/design.json`;
        const text = fs.readFileSync(path.join(root, artifactRef), 'utf8'), raw = JSON.parse(text);
        // A hardware-only query attachment still uses the existing public import/worker
        // pipeline. "stock" is its actual attachment selector, not an origin join claim.
        const imported = buildSnapshot(text, artifactRef, {}), model = imported.implementation;
        const api = createAnalysisQuery({ importResult: imported }), context = api.getContext('stock');
        assert.equal(context.capabilities.dependencies, 'available');
        const representatives = new Map();
        let primitiveCount = 0;
        for (const dut of Object.values(model.cells)) {
            const source = rawAt(raw, model.occurrences[dut.occurrenceId].path, dut.name);
            if (!oracle.TYPES.includes(source.type)) continue;
            primitiveCount++;
            const edges = directEdges(model, dut, 'backward');
            oracle.assertStructure(source, localize(model, dut, edges));
            seenTypes.add(source.type);
            if (!representatives.has(source.type)) representatives.set(source.type, { dut, source });
        }
        assert.equal(primitiveCount, { A: 9, B: 24, C: 17 }[corpus]);
        for (const { dut, source } of representatives.values()) {
            const pin = dut.pins.map(id => model.pins[id]).find(p => p.name === 'Y');
            const request = { kind: 'dependencies', analysisId: context.analysisId, snapshotId: context.snapshotId,
                implementationProvider: 'stock', stage: context.stage, ownerInstanceId: null,
                implementationOccurrenceId: dut.occurrenceId, seed: { entityId: pin.id, indices: [0] },
                scope: { kind: 'design', rootOccurrenceId: model.roots[0] }, direction: 'backward',
                semanticsProfile: oracle.PROFILE, queryGeneration: 1 };
            const result = await api.query(request);
            assert.equal(result.status, 'complete'); assert.equal(result.availability, 'available');
            assert.equal(result.completeness, 'complete'); assert.equal(result.semanticsProfile, oracle.PROFILE);
            assert.equal(result.context.snapshotId, model.snapshot.id); assert.equal(result.direction, 'backward');
            assert.equal(result.groups.length, 1); assert.equal(result.groups[0].seed.entityId, pin.id);
            assert.equal(result.groups[0].seed.index, 0); assert.equal(result.groups[0].seed.bitId, pin.bits[0]);
            const localEdges = result.relations.filter(e => e.family === 'logic-dependency' && e.cellId === dut.id && e.to.index === 0);
            assert.deepEqual(tupleSet(localize(model, dut, localEdges)), tupleSet(candidate(source).filter(e => e.to.index === 0)));
            const direct = cellDependencies(model, { pinId: pin.id, index: 0, direction: 'backward', semanticsProfile: oracle.PROFILE });
            assert.deepEqual(localEdges.map(e => e.id).sort(), direct.edges.map(e => e.id).sort());
            for (const e of result.relations.filter(e => e.family === 'logic-dependency')) {
                assert.equal(oracle.TYPES.includes(model.cells[e.cellId].type), true);
                assert.equal(e.from.snapshotId, model.snapshot.id); assert.equal(e.to.snapshotId, model.snapshot.id);
                assert.equal(e.from.occurrenceId, e.to.occurrenceId);
                assert.notEqual(model.pins[e.to.entityId].name, 'Q');
            }
            assert.equal(result.boundaries.some(b => b.reason === 'resource-limit'), false);
            evidence.integration.push({ surface: 'createAnalysisQuery.query', artifactRef, providerCorpus: provider, corpus,
                snapshotId: model.snapshot.id, cellId: dut.id, type: source.type, queryId: result.queryId, resultId: result.id,
                status: result.status, localEdges: localEdges.length, totalRelations: result.relations.length,
                boundaryReasons: [...new Set(result.boundaries.map(b => b.reason))].sort() });
        }
    }
    assert.deepEqual([...seenTypes].sort(), [...oracle.TYPES].sort());
});

test.after(() => {
    evidence.totals = {
        domains: evidence.domains.length,
        assignments: evidence.domains.reduce((n, domain) => n + domain.assignments, 0),
        transitions: evidence.domains.reduce((n, domain) => n + domain.transitions, 0),
        evaluations: evidence.domains.reduce((n, domain) => n + domain.evaluations, 0),
        witnessedDependencies: evidence.domains.reduce((n, domain) => n + domain.witnesses.length, 0),
        rejectedMutations: evidence.mutations.reduce((n, mutation) => n + (mutation.count || 1), 0)
    };
    if (process.env.G5_OUTPUT_DIR) fs.writeFileSync(path.join(process.env.G5_OUTPUT_DIR, 'cell-reference-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    console.log(`G5_CELL_REFERENCE ${JSON.stringify(evidence.totals)}`);
});
