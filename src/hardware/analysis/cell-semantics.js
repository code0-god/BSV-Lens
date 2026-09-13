'use strict';
const { hash, stable, failure } = require('../json');
const PROFILE = 'yosys-0.68-structural-v1';
const BINARY = ['$add','$sub','$eq','$ne','$lt','$logic_and','$logic_or'];
const BOOLEAN = ['$eq','$ne','$lt','$logic_not','$logic_and','$logic_or'];
const COMBINATIONAL = [...BINARY,'$logic_not','$mux','$pmux'];
function parameter(value) {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value !== 'string' || !/^[01]+$/.test(value)) return null;
    const decoded = Number.parseInt(value, 2);
    return Number.isSafeInteger(decoded) ? decoded : null;
}
const exact = (actual, expected) => actual.length === expected.length && actual.every(k => expected.includes(k));
function endpoint(model, pin, index) {
    return { kind:'implementation', objectKind:'pin', entityId:pin.id, index, bitId:pin.bits[index],
        occurrenceId:pin.occurrenceId, snapshotId:model.snapshot.id };
}
function describeCell(model, cellId) {
    const cell = model.cells[cellId];
    if (!cell) throw failure('INVALID_INPUT','Unknown cell');
    const pins = cell.pins.map(id=>model.pins[id]);
    const description = { cellId, type:cell.type, occurrenceId:cell.occurrenceId, snapshotId:model.snapshot.id,
        semanticsProfile:PROFILE, classification:'unsupported', status:'boundary', reason:'unsupported-cell', precision:'none',
        parameters:Object.fromEntries(Object.entries(cell.parameters).map(([k,v])=>[k,parameter(v)])),
        ports:pins.map(p=>({pinId:p.id,name:p.name,direction:p.direction,width:p.bits.length})), limitations:[] };
    const stop = (classification, reason, limitation) => Object.assign(description, {classification,reason,limitations:limitation ? [limitation] : []});
    // A module definition (especially an opaque primitive-named module) wins over primitive matching.
    if (cell.definitionId) {
        if (cell.blackbox) return stop('blackbox','blackbox');
        const defaults = model.definitions[cell.definitionId].parameters;
        for (const [key,value] of Object.entries(cell.parameters)) {
            if (!(key in defaults) || parameter(value) === null || parameter(value) !== parameter(defaults[key]))
                return stop('hierarchy','unsupported-parameters','unevaluated-module-override');
        }
        return Object.assign(stop('hierarchy','binding'),{status:'supported',precision:'verified-binding'});
    }
    if ([cell.attributes.blackbox,cell.attributes.whitebox].some(v=>parameter(v)===1)) return stop('blackbox','blackbox');
    if (/^\$(?:mem(?:_v2)?|memory|mem(?:rd|wr|init)(?:_v2)?)$/.test(cell.type)) return stop('memory','memory');
    if (cell.type !== '$dff' && (/^\$(?:a?dffe?|aldffe?|sdff(?:e|ce)?|dffsre?|a?dlatch|dlatchsr|sr|ff)$/.test(cell.type) ||
        /^\$_(?:DFF|DFFE|SDFF|SDFFE|SDFFCE|DFFSR|DFFSRE|DLATCH|DLATCHSR|SR)_/.test(cell.type)))
        return stop('sequential','sequential','unsupported-sequential-variant');
    if (!COMBINATIONAL.includes(cell.type) && cell.type !== '$dff') return description;
    description.classification = cell.type === '$dff' ? 'sequential' : 'combinational';
    let expected, widths;
    const p = description.parameters;
    if (BINARY.includes(cell.type)) { expected = ['A_WIDTH','B_WIDTH','Y_WIDTH','A_SIGNED','B_SIGNED']; widths = {A:p.A_WIDTH,B:p.B_WIDTH,Y:p.Y_WIDTH}; }
    else if (cell.type === '$logic_not') { expected = ['A_WIDTH','Y_WIDTH','A_SIGNED']; widths = {A:p.A_WIDTH,Y:p.Y_WIDTH}; }
    else if (cell.type === '$dff') { expected = ['WIDTH','CLK_POLARITY']; widths = {D:p.WIDTH,Q:p.WIDTH,CLK:1}; }
    else { expected = cell.type === '$mux' ? ['WIDTH'] : ['WIDTH','S_WIDTH']; widths = {A:p.WIDTH,B:cell.type === '$mux' ? p.WIDTH : p.WIDTH*p.S_WIDTH,Y:p.WIDTH,S:cell.type === '$mux' ? 1 : p.S_WIDTH}; }
    const invalid = reason => Object.assign(description,{status:'boundary',reason});
    if (!exact(Object.keys(cell.parameters),expected) || expected.some(k=>p[k]===null)) return invalid('unsupported-parameters');
    for (const key of expected) {
        if (key.endsWith('SIGNED') || key.endsWith('POLARITY')) { if (![0,1].includes(p[key])) return invalid('unsupported-parameters'); }
        else if (p[key]<1 || p[key]>model.limits.maxVectorWidth) return invalid('unsupported-parameters');
    }
    if (['$add','$sub','$eq','$ne','$lt'].includes(cell.type) && p.A_SIGNED !== p.B_SIGNED) return invalid('unsupported-parameters');
    if (Object.values(widths).some(w=>!Number.isSafeInteger(w) || w<1 || w>model.limits.maxVectorWidth)) return invalid('unsupported-parameters');
    if (!exact(pins.map(p=>p.name),Object.keys(widths)) || !exact(Object.keys(cell.raw.port_directions || {}),Object.keys(widths)) ||
        pins.some(pin=>pin.bits.length!==widths[pin.name] || pin.direction !== (['Y','Q'].includes(pin.name) ? 'output' : 'input'))) return invalid('unsupported-ports');
    if (cell.type === '$dff') {
        description.clock = {pinId:pins.find(pin=>pin.name==='CLK').id,polarity:p.CLK_POLARITY,edge:p.CLK_POLARITY ? 'positive' : 'negative'};
        return Object.assign(description,{reason:'sequential',precision:'verified-boundary'});
    }
    description.limitations = ['not-value-simulation','no-value-based-pruning'];
    if (['$add','$sub'].includes(cell.type)) description.limitations.push('four-state-all-operand-poisoning');
    if (cell.type === '$pmux') description.limitations.push('undefined-multiple-select','not-priority');
    return Object.assign(description,{status:'supported',reason:null,precision:'conservative-structural'});
}
function cellDependencies(model, {pinId,index,direction,semanticsProfile,maxEdges = 16384}) {
    const pin = model.pins[pinId];
    if (!pin || !Number.isSafeInteger(index) || index<0 || index>=pin.bits.length || !['backward','forward'].includes(direction) ||
        !Number.isSafeInteger(maxEdges) || maxEdges<0) throw failure('INVALID_INPUT','Invalid cell dependency request');
    if (semanticsProfile !== PROFILE) throw failure('INVALID_INPUT','Unknown semantics profile');
    const cell = model.cells[pin.cellId], d = describeCell(model,cell.id), at = endpoint(model,pin,index);
    if (d.classification !== 'combinational' || d.status !== 'supported') {
        return {status:'boundary',reason:d.reason,precision:d.precision,edges:[],boundary:{reason:d.reason,at,cellId:cell.id,
            side:d.clock ? pin.name==='Q' ? 'state-source' : pin.name==='D' ? 'data-sink' : 'clock-sink' : pin.direction,
            ...(d.clock ? {clock:d.clock} : {})}};
    }
    const ports = Object.fromEntries(cell.pins.map(id=>[model.pins[id].name,model.pins[id]])), p = d.parameters;
    const backward = direction === 'backward';
    if (pin.direction !== (backward ? 'output' : 'input')) return {status:'supported',reason:null,precision:d.precision,edges:[]};
    const arithmetic = ['$add','$sub'].includes(cell.type), boolean = BOOLEAN.includes(cell.type), mux = !arithmetic && !boolean;
    let count;
    if (backward) count = arithmetic ? ports.A.bits.length + ports.B.bits.length : boolean ? index===0 ? ports.A.bits.length+(ports.B?.bits.length || 0) : 0
        : cell.type === '$mux' ? 3 : 1+2*p.S_WIDTH;
    else count = arithmetic ? ports.Y.bits.length : boolean ? 1 : pin.name==='S' ? ports.Y.bits.length : 1;
    if (count > maxEdges) return {status:'partial',reason:'resource-limit',precision:d.precision,edges:[],
        boundary:{reason:'resource-limit',limit:'maxEdges',requiredEdges:count,at,cellId:cell.id}};
    const edges = [];
    function add(source, i, y) {
        const value = {family:'logic-dependency',cellId:cell.id,semanticsProfile:PROFILE,precision:d.precision,
            from:endpoint(model,source,i),to:endpoint(model,ports.Y,y),limitations:d.limitations};
        const kind = mux && source.name==='S' ? 'control-dependency' : 'data-dependency';
        edges.push({id:`analysis-${kind}-${hash(stable(value))}`,kind,...value});
    }
    if (backward) {
        if (arithmetic || boolean && index===0) for (const name of ['A','B']) {
            if (ports[name]) for (let i=0;i<ports[name].bits.length;i++) add(ports[name],i,index);
        }
        else if (mux) {
            add(ports.A,index,index);
            const k = cell.type === '$mux' ? 1 : p.S_WIDTH;
            for (let branch=0;branch<k;branch++) add(ports.B,branch*p.WIDTH+index,index);
            for (let s=0;s<k;s++) add(ports.S,s,index);
        }
    } else if (arithmetic || mux && pin.name==='S') for (let y=0;y<ports.Y.bits.length;y++) add(pin,index,y);
    else add(pin,index,boolean ? 0 : index%p.WIDTH);
    return {status:'supported',reason:null,precision:d.precision,edges};
}
module.exports = { describeCell, cellDependencies, PROFILE };
