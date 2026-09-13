'use strict';

// Independent, bounded value reference for the ten G5 combinational cells.
// Authority: pinned Yosys 38e001a6ff74ca434bf4cc02c053f53619160ab0 simlib.v
// (add/sub 981-1038, comparisons 726-847, logical 1521-1601, mux 1647-1658,
// pmux 1699-1731); Boolean widening: word_binary.rst and word_unary.rst.
// This module deliberately imports NO product implementation or dependency rules.
// Vectors are least-significant position first. Symbols are literal 0/1/x/z.
const SYMBOLS = Object.freeze(['0', '1', 'x', 'z']);
const PROFILE = 'yosys-0.68-structural-v1';
const SOURCE = Object.freeze({ revision: '38e001a6ff74ca434bf4cc02c053f53619160ab0',
    path: 'docs/hardware/evidence/g5/semantics/upstream/techlibs/common/simlib.v',
    sha256: 'e79c08085225bdc6f52ce99f128328158009a33b8ea0c8c273011dfde370561d' });
const TYPES = Object.freeze(['$add', '$sub', '$eq', '$ne', '$lt', '$logic_not', '$logic_and', '$logic_or', '$mux', '$pmux']);
const MAX_EXHAUSTIVE_INPUTS = 7; // At most 4^7=16384 assignments per case, never 4^15.
const MAX_REFERENCE_WIDTH = 12;
function fail(code, detail) { const error = new Error(`${code}: ${JSON.stringify(detail)}`); error.code = code; throw error; }
function parameter(value) {
    if (typeof value === 'string' && /^[01]+$/.test(value)) value = Number.parseInt(value, 2);
    if (!Number.isSafeInteger(value) || value < 0) fail('REFERENCE_PARAMETER', value);
    return value;
}
function shape(cell) {
    if (!TYPES.includes(cell.type)) fail('REFERENCE_UNSUPPORTED', cell.type);
    const p = Object.fromEntries(Object.entries(cell.parameters).map(([name, value]) => [name, parameter(value)]));
    const mux = cell.type === '$mux' || cell.type === '$pmux', unary = cell.type === '$logic_not';
    const keys = mux ? (cell.type === '$mux' ? ['WIDTH'] : ['S_WIDTH', 'WIDTH'])
        : unary ? ['A_SIGNED', 'A_WIDTH', 'Y_WIDTH'] : ['A_SIGNED', 'A_WIDTH', 'B_SIGNED', 'B_WIDTH', 'Y_WIDTH'];
    if (JSON.stringify(Object.keys(p).sort()) !== JSON.stringify(keys)) fail('REFERENCE_PARAMETER_KEYS', p);
    for (const [name, value] of Object.entries(p)) {
        if (name.endsWith('SIGNED')) { if (value > 1) fail('REFERENCE_SIGN', p); }
        else if (value < 1 || value > MAX_REFERENCE_WIDTH) fail('REFERENCE_WIDTH', p);
    }
    if (['$add', '$sub', '$eq', '$ne', '$lt'].includes(cell.type) && p.A_SIGNED !== p.B_SIGNED) fail('REFERENCE_SIGN', p);
    const inputs = mux ? { A: p.WIDTH, B: p.WIDTH * (p.S_WIDTH || 1), S: p.S_WIDTH || 1 }
        : unary ? { A: p.A_WIDTH } : { A: p.A_WIDTH, B: p.B_WIDTH };
    const y = mux ? p.WIDTH : p.Y_WIDTH;
    const ports = { ...inputs, Y: y };
    if (JSON.stringify(Object.keys(cell.connections).sort()) !== JSON.stringify(Object.keys(ports).sort()) ||
        JSON.stringify(Object.keys(cell.port_directions).sort()) !== JSON.stringify(Object.keys(ports).sort())) fail('REFERENCE_PORTS', cell);
    for (const [port, width] of Object.entries(ports)) {
        if (cell.connections[port].length !== width || cell.port_directions[port] !== (port === 'Y' ? 'output' : 'input')) fail('REFERENCE_PORTS', { port, width });
    }
    return { p, inputs, y, sites: Object.entries(inputs).flatMap(([port, width]) => Array.from({ length: width }, (_, index) => ({ port, index }))) };
}
function unknown(vector) { return vector.some(bit => bit === 'x' || bit === 'z'); }
function integer(vector, signed) {
    let value = 0n;
    for (let i = 0; i < vector.length; i++) if (vector[i] === '1') value += 1n << BigInt(i);
    if (signed && vector.at(-1) === '1') value -= 1n << BigInt(vector.length);
    return value;
}
function truth(vector) { return vector.includes('1') ? '1' : unknown(vector) ? 'x' : '0'; }
function extend(vector, width, signed) {
    return vector.concat(Array(width - vector.length).fill(signed ? vector.at(-1) : '0'));
}
function merge(a, b) { return a.map((bit, i) => bit === b[i] ? bit : 'x'); }
function compile(cell) {
    const domain = shape(cell), { p, inputs, y } = domain;
    function evaluate(values) {
        if (Object.keys(values).length !== Object.keys(inputs).length) fail('REFERENCE_ASSIGNMENT', values);
        for (const [port, width] of Object.entries(inputs)) {
            if (!Array.isArray(values[port]) || values[port].length !== width || values[port].some(bit => !SYMBOLS.includes(bit))) fail('REFERENCE_ASSIGNMENT', values);
        }
        const { A, B, S } = values;
        const boolean = bit => [bit, ...Array(y - 1).fill('0')];
        switch (cell.type) {
        case '$add': case '$sub': {
            // Verilog expression sizing retains the full operands before result
            // truncation: even a high, discarded x/z poisons the LOW output bits.
            if (unknown(A) || unknown(B)) return Array(y).fill('x');
            const a = integer(A, p.A_SIGNED), b = integer(B, p.B_SIGNED);
            const result = BigInt.asUintN(y, cell.type === '$add' ? a + b : a - b);
            return Array.from({ length: y }, (_, i) => String(Number((result >> BigInt(i)) & 1n)));
        }
        case '$eq': case '$ne': {
            const width = Math.max(A.length, B.length);
            const a = extend(A, width, p.A_SIGNED), b = extend(B, width, p.B_SIGNED);
            // A definite mismatch dominates unknown positions for == and !=.
            const mismatch = a.some((bit, i) => !unknown([bit, b[i]]) && bit !== b[i]);
            if (mismatch) return boolean(cell.type === '$eq' ? '0' : '1');
            if (unknown(a) || unknown(b)) return boolean('x');
            return boolean(cell.type === '$eq' ? '1' : '0');
        }
        case '$lt':
            return boolean(unknown(A) || unknown(B) ? 'x' : integer(A, p.A_SIGNED) < integer(B, p.B_SIGNED) ? '1' : '0');
        case '$logic_not':
            return boolean(truth(A) === 'x' ? 'x' : truth(A) === '0' ? '1' : '0');
        case '$logic_and': {
            const a = truth(A), b = truth(B);
            return boolean(a === '0' || b === '0' ? '0' : a === '1' && b === '1' ? '1' : 'x');
        }
        case '$logic_or': {
            const a = truth(A), b = truth(B);
            return boolean(a === '1' || b === '1' ? '1' : a === '0' && b === '0' ? '0' : 'x');
        }
        case '$mux':
            return S[0] === '0' ? [...A] : S[0] === '1' ? [...B] : merge(A, B);
        case '$pmux': {
            // Direct interpretation of the pinned procedural body, NOT priority.
            // case has 0, 1, x arms, no z arm/default: a z selector does nothing.
            let result = [...A], found = '0';
            for (let k = 0; k < S.length; k++) {
                if (S[k] === 'x') { result = Array(y).fill('x'); found = 'x'; }
                if (S[k] === '1') {
                    const branch = B.slice(k * y, (k + 1) * y), poisoned = Array(y).fill('x');
                    result = found === '0' ? branch : found === '1' ? poisoned : merge(poisoned, branch);
                    found = '1';
                }
            }
            return result;
        }
        default: return fail('REFERENCE_UNSUPPORTED', cell.type);
        }
    }
    return { ...domain, evaluate };
}
function evaluate(cell, values) { return compile(cell).evaluate(values); }
function zeroAssignment(inputs) { return Object.fromEntries(Object.entries(inputs).map(([port, width]) => [port, Array(width).fill('0')])); }
function edgeKey(from, to) { return `${from.port}[${from.index}]->${to.port}[${to.index}]`; }
function enumerate(cell, { assignments = null } = {}) {
    const { inputs, sites, evaluate: run } = compile(cell);
    const exhaustive = assignments === null;
    if (exhaustive && sites.length > MAX_EXHAUSTIVE_INPUTS) fail('REFERENCE_ENUMERATION_BOUND', { inputs: sites.length, maximum: MAX_EXHAUSTIVE_INPUTS });
    if (!exhaustive && (!Array.isArray(assignments) || assignments.length > 16384 || assignments.length === 0)) fail('REFERENCE_ENUMERATION_BOUND', {});
    const count = exhaustive ? 4 ** sites.length : assignments.length;
    const witnesses = new Map();
    let transitions = 0, changedOutputs = 0, evaluations = 0;
    for (let n = 0; n < count; n++) {
        const before = exhaustive ? zeroAssignment(inputs) : Object.fromEntries(Object.entries(assignments[n]).map(([port, vector]) => [port, [...vector]]));
        if (exhaustive) {
            let digits = n;
            for (const site of sites) { before[site.port][site.index] = SYMBOLS[digits % 4]; digits = Math.floor(digits / 4); }
        }
        const beforeY = run(before); evaluations++;
        for (const site of sites) {
            const original = before[site.port][site.index];
            for (const symbol of SYMBOLS) {
                // Each unordered pair is examined once in exhaustive mode.
                if (symbol === original || exhaustive && SYMBOLS.indexOf(symbol) < SYMBOLS.indexOf(original)) continue;
                before[site.port][site.index] = symbol;
                const afterY = run(before); evaluations++; transitions++;
                for (let i = 0; i < beforeY.length; i++) if (beforeY[i] !== afterY[i]) {
                    changedOutputs++;
                    const from = { ...site }, to = { port: 'Y', index: i }, key = edgeKey(from, to);
                    if (!witnesses.has(key)) {
                        const assignment = Object.fromEntries(Object.entries(before).map(([port, vector]) => [port, [...vector]]));
                        assignment[site.port][site.index] = original;
                        witnesses.set(key, { from, to, assignment, replacement: symbol, before: beforeY[i], after: afterY[i] });
                    }
                }
            }
            before[site.port][site.index] = original;
        }
    }
    return { type: cell.type, parameters: { ...cell.parameters }, mode: exhaustive ? 'exhaustive-four-state' : 'targeted-four-state',
        inputSites: sites.length, assignments: count, transitions, evaluations, changedOutputs, witnesses: [...witnesses.values()] };
}
function assertSound(report, edges) {
    const present = new Set(edges.map(edge => edgeKey(edge.from, edge.to)));
    for (const witness of report.witnesses) if (!present.has(edgeKey(witness.from, witness.to))) fail('OMITTED_VALUE_DEPENDENCY', witness);
    return report.witnesses.length;
}
function assertStructure(cell, edges) {
    // A separate relation CHECKER, not a value-derived dependency generator.
    // Soundness alone cannot reject an all-to-all fallback or role corruption.
    if (!TYPES.includes(cell.type)) {
        if (edges.length) fail(cell.type === '$dff' ? 'STATE_CROSSING' : 'UNKNOWN_CELL_FALLBACK', edges);
        return 0;
    }
    const { inputs, y } = shape(cell), mux = ['$mux', '$pmux'].includes(cell.type);
    const arithmetic = ['$add', '$sub'].includes(cell.type), present = new Set();
    for (const edge of edges) {
        const { from, to } = edge;
        if (!from || !to || !Number.isInteger(from.index) || !Number.isInteger(to.index) ||
            !(from.port in inputs) || from.index < 0 || from.index >= inputs[from.port] ||
            to.port !== 'Y' || to.index < 0 || to.index >= y) fail('FOREIGN_DEPENDENCY_SITE', edge);
        if (edge.family !== 'logic-dependency' || edge.kind !== (from.port === 'S' ? 'control-dependency' : 'data-dependency')) fail('DEPENDENCY_ROLE', edge);
        if (mux && from.port !== 'S' && from.index % y !== to.index) fail('CROSS_POSITION_DEPENDENCY', edge);
        if (!mux && !arithmetic && to.index !== 0) fail('BOOLEAN_UPPER_DEPENDENCY', edge);
        const key = edgeKey(from, to);
        if (present.has(key)) fail('DUPLICATE_DEPENDENCY', edge);
        present.add(key);
    }
    // Require unconditional structural incidence, INCLUDING literal terminals.
    for (const [port, width] of Object.entries(inputs)) for (let index = 0; index < width; index++) {
        for (let out = 0; out < y; out++) {
            const required = mux ? port === 'S' || index % y === out : arithmetic || out === 0;
            if (required && !present.has(edgeKey({ port, index }, { port: 'Y', index: out }))) fail('OMITTED_STRUCTURAL_SITE', { port, index, out });
        }
    }
    return present.size;
}
module.exports = { SYMBOLS, PROFILE, SOURCE, TYPES, MAX_EXHAUSTIVE_INPUTS, MAX_REFERENCE_WIDTH,
    evaluate, enumerate, assertSound, assertStructure };
