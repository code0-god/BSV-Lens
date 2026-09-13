'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const hardware = require('../src/hardware');
const { buildSnapshot } = require('../src/hardware/snapshot');
const PROFILE = 'yosys-0.68-structural-v1';
function fixture(cells, ports = {}, extra = {}) {
    return buildSnapshot(JSON.stringify({ modules: { top: { attributes: { top: 1 }, ports, cells, ...extra } } }), 'dependencies-synthetic.json', {});
}
function binary(type = '$add', a = [2,3], b = [4,5], y = [6,7]) {
    return { type, parameters: { A_WIDTH:a.length, B_WIDTH:b.length, Y_WIDTH:y.length, A_SIGNED:0, B_SIGNED:0 },
        connections:{ A:a, B:b, Y:y }, port_directions:{ A:'input', B:'input', Y:'output' } };
}
function pin(model, name, cellName = 'gate') { return Object.values(model.pins).find(p => p.name === name && model.cells[p.cellId].name === cellName); }
function input(api, model, entity, extra = {}) {
    const c = api.getContext();
    return { kind:'dependencies', analysisId:c.analysisId, snapshotId:c.snapshotId, implementationProvider:'stock',
        implementationOccurrenceId:entity.occurrenceId, seed:{entityId:entity.id,indices:[0]},
        scope:{kind:'design',rootOccurrenceId:model.roots[0]}, direction:'backward', semanticsProfile:PROFILE, queryGeneration:1, ...extra };
}
test('D01 public dependencies includes high operand bits at add Y0, not a two-state prefix', async () => {
    const imported = fixture({ gate:binary() }), model = imported.implementation;
    const api = hardware.createAnalysisQuery({importResult:imported});
    const result = await api.query(input(api,model,pin(model,'Y')));
    assert.equal(result.status,'complete');
    assert.equal(api.getContext().capabilities.dependencies,'available');
    const edges = result.relations.filter(e=>e.family==='logic-dependency');
    assert.deepEqual(edges.map(e=>[model.pins[e.from.entityId].name,e.from.index,e.to.entityId,e.to.index]).sort(),
        [['A',0,pin(model,'Y').id,0],['A',1,pin(model,'Y').id,0],['B',0,pin(model,'Y').id,0],['B',1,pin(model,'Y').id,0]]);
    assert.ok(edges.every(e=>e.kind==='data-dependency' && e.from.bitId===model.pins[e.from.entityId].bits[e.from.index]));
});

const { describeCell, cellDependencies } = require('../src/hardware/analysis/cell-semantics');
const fs = require('node:fs');
const path = require('node:path');
const { hash, stable } = require('../src/hardware/json');
const logic = result => result.relations.filter(e=>e.family==='logic-dependency');
function mapped(model, name, index=0, direction='backward', maxEdges=16384) {
    return cellDependencies(model,{pinId:pin(model,name).id,index,direction,semanticsProfile:PROFILE,maxEdges});
}
function mux(width=2, branches=null) {
    return {type:branches===null ? '$mux' : '$pmux',parameters:{WIDTH:width,...(branches===null ? {} : {S_WIDTH:branches})},
        connections:{A:Array.from({length:width},(_,i)=>2+i),B:Array.from({length:width*(branches||1)},(_,i)=>20+i),
            S:Array.from({length:branches||1},(_,i)=>50+i),Y:Array.from({length:width},(_,i)=>80+i)},
        port_directions:{A:'input',B:'input',S:'input',Y:'output'}};
}
const edgeTuple = (model,e) => [model.pins[e.from.entityId].name,e.from.index,model.pins[e.to.entityId].name,e.to.index,e.kind];
test('D02 mux/pmux positional branches and every select survive literals including x/z in both directions', async () => {
    for (const branches of [null,1,3]) {
        const raw=mux(3,branches);raw.connections.S=branches===null ? ['1'] : Array.from({length:branches},(_,i)=>['x','z','0'][i]);
        raw.connections.A=['0','1','x'];
        const imported=fixture({gate:raw}),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
        for(let y=0;y<3;y++) {
            const expected=[['A',y,'Y',y,'data-dependency']];
            for(let k=0;k<(branches||1);k++)expected.push(['B',k*3+y,'Y',y,'data-dependency'],['S',k,'Y',y,'control-dependency']);
            assert.deepEqual(mapped(model,'Y',y).edges.map(e=>edgeTuple(model,e)).sort(),expected.sort());
            const result=await api.query(input(api,model,pin(model,'Y'),{seed:{entityId:pin(model,'Y').id,indices:[y]}}));
            assert.equal(result.status,'complete');
            assert.deepEqual(logic(result).map(e=>edgeTuple(model,e)).sort(),expected.sort());
            assert.ok(result.objects.some(o=>o.entityId===pin(model,'A').bits[y] && o.value===raw.connections.A[y]));
        }
        assert.deepEqual(mapped(model,'B',4%(3*(branches||1)),'forward').edges.map(e=>e.to.index),[4%3]);
        assert.deepEqual(mapped(model,'S',0,'forward').edges.map(e=>e.to.index),[0,1,2]);
        if(branches!==null)assert.ok(describeCell(model,pin(model,'Y').cellId).limitations.includes('undefined-multiple-select'));
    }
});
test('D03 exact widths/signs, binary/compat-int parameters and wide Boolean Y invariants', () => {
    for(const type of ['$add','$sub','$eq','$ne','$lt','$logic_and','$logic_or','$logic_not']) {
        for(const signed of [0,1]) {
            const raw=binary(type,[2,3],[4],[6,7,8]);raw.parameters.A_SIGNED=signed;raw.parameters.B_SIGNED=signed;
            if(type==='$logic_not') {delete raw.parameters.B_WIDTH;delete raw.parameters.B_SIGNED;delete raw.connections.B;delete raw.port_directions.B;}
            if(type==='$logic_and'||type==='$logic_or')raw.parameters.B_SIGNED=1-signed;
            for(const encoding of ['integer','binary']) {
                const cell=structuredClone(raw);if(encoding==='binary')for(const k of Object.keys(cell.parameters))cell.parameters[k]=cell.parameters[k].toString(2).padStart(32,'0');
                const model=fixture({gate:cell}).implementation;
                assert.equal(describeCell(model,pin(model,'Y').cellId).status,'supported');
                const operandCount=type==='$logic_not' ? 2 : 3;
                for(let y=0;y<3;y++) {
                    const result=mapped(model,'Y',y);
                    assert.equal(result.status,'supported');
                    assert.equal(result.edges.length,['$add','$sub'].includes(type)||y===0 ? operandCount : 0);
                    for(const edge of result.edges) assert.equal(edge.to.bitId,`${model.roots[0]}/bit/${6+y}`);
                }
                const forward=mapped(model,'A',1,'forward');
                assert.deepEqual(forward.edges.map(e=>e.to.index),['$add','$sub'].includes(type) ? [0,1,2] : [0]);
            }
        }
    }
    const mutations=[c=>delete c.parameters.A_WIDTH,c=>c.parameters.EXTRA=1,c=>c.parameters.A_WIDTH='x1',c=>c.parameters.A_WIDTH='z',
        c=>c.parameters.A_WIDTH='2',c=>c.parameters.A_WIDTH='',c=>c.parameters.A_WIDTH=true,c=>c.parameters.A_WIDTH=1.5,
        c=>c.parameters.A_WIDTH=Number.MAX_SAFE_INTEGER+1,c=>c.parameters.A_WIDTH=0,c=>c.parameters.A_WIDTH=65537,
        c=>c.parameters.A_SIGNED=2,c=>c.parameters.B_SIGNED=1,c=>c.connections.A.pop(),c=>c.port_directions.A='output',
        c=>delete c.port_directions.A,c=>c.port_directions.EXTRA='input',c=>c.connections.EXTRA=[90]];
    for(const mutate of mutations) {
        const cell=binary();mutate(cell);const model=fixture({gate:cell}).implementation;
        const result=mapped(model,'Y');assert.equal(result.status,'boundary');assert.deepEqual(result.edges,[]);
        assert.ok(['unsupported-parameters','unsupported-ports'].includes(result.reason));
    }
    const cell=mux(2,3);cell.parameters.S_WIDTH=65536;
    assert.equal(mapped(fixture({gate:cell}).implementation,'Y').reason,'unsupported-parameters');
    const model=fixture({gate:binary()}).implementation;
    assert.deepEqual(mapped(model,'Y',0,'backward',3).boundary.requiredEdges,4);
    assert.equal(mapped(model,'Y',0,'backward',3).edges.length,0);
    assert.throws(()=>cellDependencies(model,{pinId:pin(model,'Y').id,index:0,direction:'backward',semanticsProfile:'exact'}),{code:'INVALID_INPUT'});
});
function dff(polarity=1) {return {type:'$dff',parameters:{WIDTH:2,CLK_POLARITY:polarity},connections:{D:[2,3],Q:[4,5],CLK:[6]},port_directions:{D:'input',Q:'output',CLK:'input'}};}
test('D04 verified positive/negative DFF state-source/data-sink/clock-sink stop without D/Q crossing', async () => {
    for(const polarity of [0,1]) {
        const imported=fixture({gate:dff(polarity)}),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
        for(const [name,direction,side] of [['Q','backward','state-source'],['D','forward','data-sink'],['CLK','forward','clock-sink']]) {
            const result=await api.query(input(api,model,pin(model,name),{direction}));
            assert.equal(result.status,'complete');assert.deepEqual(logic(result),[]);
            const boundary=result.boundaries.find(b=>b.reason==='sequential');
            assert.equal(boundary.at.entityId,pin(model,name).id);assert.equal(boundary.side,side);assert.equal(boundary.clock.polarity,polarity);
            assert.equal(result.objects.some(o=>o.entityId===pin(model,name==='Q' ? 'D' : 'Q').id),false);
        }
    }
    for(const polarity of ['x',2]) {const model=fixture({gate:dff(polarity)}).implementation;assert.equal(mapped(model,'Q').reason,'unsupported-parameters');}
});
test('D05 memory, sequential variants, blackbox and unknown cells are explicit boundaries, never fallback edges', async () => {
    for(const [type,reason] of [['$memrd','memory'],['$memrd_v2','memory'],['$memwr','memory'],['$meminit','memory'],['$memory','memory'],['$mem_v2','memory'],['$sram_vendor','unsupported-cell'],['$dffe','sequential'],['$dlatch','sequential'],['$mystery','unsupported-cell']]) {
        const imported=fixture({gate:{type,connections:{A:[2],Y:[3]},port_directions:{A:'input',Y:'output'}}}),model=imported.implementation;
        const api=hardware.createAnalysisQuery({importResult:imported}),result=await api.query(input(api,model,pin(model,'Y')));
        assert.deepEqual(logic(result),[]);assert.ok(result.boundaries.some(b=>b.reason===reason && b.at.entityId===pin(model,'Y').id));
        assert.equal(result.status,reason==='sequential' ? 'complete' : 'partial');
    }
    for(const attr of ['blackbox','whitebox']) {
        const raw={modules:{top:{attributes:{top:1},cells:{gate:{type:'$add',connections:{Y:[3]},port_directions:{Y:'output'}}}},
            $add:{attributes:{[attr]:1},ports:{Y:{direction:'output',bits:[2]}},cells:{hidden:binary('$sub')}}}};
        const imported=buildSnapshot(JSON.stringify(raw),'opaque-synthetic.json',{}),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
        const result=await api.query(input(api,model,pin(model,'Y')));
        assert.deepEqual(logic(result),[]);assert.ok(result.boundaries.some(b=>b.reason==='blackbox'));
        assert.equal(result.objects.some(o=>o.occurrenceId!==model.roots[0]),false);
        assert.equal(describeCell(model,pin(model,'Y').cellId).classification,'blackbox');
        const internal=await api.query(input(api,model,pin(model,'Y','hidden')));
        assert.equal(internal.status,'partial');assert.deepEqual(logic(internal),[]);
        assert.ok(internal.boundaries.some(b=>b.reason==='blackbox' && b.side==='inside'));
    }
});
test('D06 directed cycles are not hierarchy equivalence, fanout revisit or reconvergence', async () => {
    const cases=[{cells:{gate:binary('$add',[2],[3],[2])},cycle:true},
        {cells:{gate:binary('$add',[2],[3],[4]),other:binary('$sub',[4],[5],[2])},cycle:true},
        {cells:{gate:binary('$add',[2],[3],[4]),left:binary('$add',[4],[5],[6]),right:binary('$sub',[4],[7],[8]),join:binary('$add',[6],[8],[9])},cycle:false}];
    for(const item of cases)for(const direction of ['backward','forward']) {
        const imported=fixture(item.cells),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
        const seed=direction==='backward' ? pin(model,'Y',item.cycle ? 'gate' : 'join') : pin(model,'A');
        const result=await api.query(input(api,model,seed,{direction}));
        assert.equal(result.boundaries.some(b=>b.reason==='cycle'),item.cycle);
        assert.equal(result.status,item.cycle ? 'partial' : 'complete');
        if(!item.cycle)assert.ok(['gate','left','right','join'].every(name=>logic(result).some(e=>model.cells[e.cellId].name===name)));
        for(const b of result.boundaries.filter(b=>b.reason==='cycle'))assert.equal(result.relations.find(e=>e.id===b.relationId).family,'logic-dependency');
    }
});
test('D05 unresolved multiple drivers, unknown directions and inout preserve physical facts but stop logic resolution', async () => {
    for(const extra of [{other:binary('$sub',[8,9],[10,11],[6,7])},{other:{type:'vendor',connections:{P:[6]},port_directions:{P:'inout'}}},
        {other:{type:'vendor',connections:{P:[6]}}}]) {
        const imported=fixture({gate:binary(),...extra}),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
        const result=await api.query(input(api,model,pin(model,'Y')));
        assert.equal(result.status,'partial');assert.deepEqual(logic(result),[]);
        assert.ok(result.relations.some(e=>e.kind==='incidence' && e.to.entityId===pin(model,'Y').id));
        assert.ok(result.boundaries.some(b=>['multiple-drivers','inout','unknown-direction'].includes(b.reason)));
        const b=result.boundaries.find(b=>b.reason==='multiple-drivers');
        if(b)assert.deepEqual(b.driverCandidates.map(c=>c.entityId).sort(),[pin(model,'Y').id,pin(model,'Y','other').id].sort());
    }
});
function hierarchy() {
    const raw={modules:{top:{attributes:{top:1},ports:{p:{direction:'input',bits:[2]}},cells:{mid:{type:'mid',connections:{p:[2]}}}},
        mid:{ports:{p:{direction:'input',bits:[2]}},cells:{leaf:{type:'leaf',connections:{p:[2]}}}},
        leaf:{ports:{p:{direction:'input',bits:[2]}},cells:{gate:binary('$add',[2],[3],[4])}}}};
    return buildSnapshot(JSON.stringify(raw),'hierarchy-synthetic.json',{});
}
test('D07 scope and deterministic bits/pins/cells/edges/depth/bytes retain bounded partial cones', async () => {
    const imported=hierarchy(),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
    const rootPort=Object.values(model.ports).find(p=>p.occurrenceId===model.roots[0]),q=input(api,model,rootPort,{direction:'forward'});
    const whole=await api.query(q);assert.equal(whole.status,'complete');assert.equal(whole.boundaries.some(b=>b.reason==='cycle'),false);
    assert.ok(logic(whole).some(e=>e.from.entityId===pin(model,'A').id));
    for(const kind of ['occurrence','subtree']) {
        const leaf=model.occurrences[pin(model,'A').occurrenceId],leafPort=leaf.ports.map(id=>model.ports[id])[0];
        const scoped=await api.query(input(api,model,leafPort,{scope:{kind,rootOccurrenceId:leaf.id},direction:'backward'}));
        assert.equal(scoped.status,'partial');assert.ok(scoped.frontier.some(f=>f.reason==='scope'));
        assert.ok(scoped.objects.every(o=>o.occurrenceId===leaf.id));
    }
    const checks=[['maxBits',1,'visitedBits'],['maxPins',1,'visitedPins'],['maxCells',1,'visitedCells'],['maxEdges',1,'visitedEdges'],
        ['maxHierarchyDepth',1,'maxHierarchyDepth'],['maxResultBytes',18000,'resultBytes']];
    for(const [limit,value,metric] of checks) {
        const bounded=await api.query({...q,limits:{[limit]:value}}),again=await api.query({...q,limits:{[limit]:value},queryGeneration:2});
        assert.equal(bounded.status,'partial',limit);assert.ok(bounded.frontier.some(f=>f.reason==='resource-limit' && f.limit===limit),limit);
        assert.ok(bounded.metrics[metric]<=value,limit);assert.equal(bounded.metrics.resultBytes,Buffer.byteLength(JSON.stringify(bounded)));
        assert.equal(bounded.id,again.id);assert.equal(bounded.queryId,again.queryId);
    }
    await assert.rejects(api.query({...q,limits:{maxResultBytes:1}}),{code:'LIMIT_EXCEEDED'});
    for(const extra of [{direction:undefined},{semanticsProfile:undefined},{semanticsProfile:'exact'},{direction:'both'}])await assert.rejects(api.query({...q,...extra}),{code:'INVALID_INPUT'});
    // Large legal vectors cannot allocate their full Cartesian edge set before the cap.
    const large=binary('$add',Array.from({length:4000},(_,i)=>2+i),Array.from({length:4000},(_,i)=>5000+i),[10000]);
    const wide=fixture({gate:large}).implementation,limited=mapped(wide,'Y',0,'backward',1);
    assert.equal(limited.status,'partial');assert.equal(limited.boundary.requiredEdges,8000);assert.deepEqual(limited.edges,[]);
});
test('D07 real worker cancellation is event-driven and retains the last valid dependency result', async () => {
    const imported=fixture({gate:binary()}),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
    const session=hardware.createAnalysisSession(api),q=input(api,model,pin(model,'Y')),prior=await session.query(q);
    const events=[];const controller=new AbortController();
    await assert.rejects(session.query({...q,queryGeneration:2},{signal:controller.signal,onProgress:e=>{
        events.push(e.phase);if(e.phase==='ready')controller.abort();
    }}),error=>error.code==='CANCELLED' && error.metrics.workerExited && error.frontier[0].seed.bitId===pin(model,'Y').bits[0]);
    assert.deepEqual(events,['started','ready','exited']);assert.equal(session.getState().current,prior);
    const deadlineEvents=[];
    await assert.rejects(session.query({...q,queryGeneration:3,limits:{timeoutMs:1}},{onProgress:e=>deadlineEvents.push(e)}),error=>
        error.code==='TIMEOUT' && error.metrics.workerExited && error.frontier.every(f=>f.reason==='deadline'));
    assert.equal(deadlineEvents.at(-1).phase,'exited');assert.equal(deadlineEvents.at(-1).timedOut,true);
    assert.equal(session.getState().current,prior);
});
const escape = value => value.replace(/~/g,'~0').replace(/\//g,'~1');
function rawExpected(cell,raw,y) {
    const sources=[];
    if(['$mux','$pmux'].includes(raw.type)) {
        const w=raw.connections.Y.length,k=raw.connections.S.length;
        sources.push(['A',y]);for(let b=0;b<k;b++)sources.push(['B',b*w+y]);for(let s=0;s<k;s++)sources.push(['S',s]);
    } else if(['$add','$sub'].includes(raw.type)||y===0)for(const name of ['A','B'])for(let i=0;i<(raw.connections[name]||[]).length;i++)sources.push([name,i]);
    function end(name,index) {
        const entityId=`${cell.id}/pin/${name}`,value=raw.connections[name][index];
        return [entityId,index,typeof value==='number' ? `${cell.occurrenceId}/bit/${value}` : `${entityId}/constant/${index}`];
    }
    return sources.map(([name,index])=>[...end(name,index),...end('Y',y),name==='S' ? 'control-dependency' : 'data-dependency']).sort();
}
function canonicalTuple(edge) {return [edge.from.entityId,edge.from.index,edge.from.bitId,edge.to.entityId,edge.to.index,edge.to.bitId,edge.kind];}
test('D01 D08 actual six A/B/C captures match raw per-bit IDs and preserve G2/G3/source identities', async () => {
    const receipts=[];
    for(const corpus of ['A','B','C'])for(const provider of ['stock','instrumented']) {
        const loaded=provider==='stock' ? await require('../experiments/hardware/g3/query').loadCapturedCase(corpus) : await require('../experiments/hardware/g3/origin-query').loadOriginCase(corpus);
        const {request,analysis}=loaded,imported=request.importResult,model=imported.implementation;
        const rawPath=provider==='stock' ? `docs/hardware/evidence/toolchain/${corpus}/design.json` : `docs/hardware/evidence/g3-origin-ghc96/results/instrumented/${corpus}/design.json`;
        const raw=JSON.parse(fs.readFileSync(rawPath,'utf8')),before=hash(stable({imported,analysis}));
        const api=hardware.createAnalysisQuery({importResult:imported,...(provider==='stock' ? {analysis} : {})});
        let comb=0,sequential=0,edgeCount=0;
        for(const occurrence of Object.values(model.occurrences)) {
            const definition=raw.modules[model.definitions[occurrence.definitionId].name];
            for(const [name,cellRaw] of Object.entries(definition.cells)) {
                const id=`${occurrence.id}/cell/${escape(name)}`,cell=model.cells[id],d=describeCell(model,id);
                if(d.classification==='hierarchy')continue;
                if(cellRaw.type==='$dff') {sequential++;assert.equal(d.reason,'sequential');continue;}
                comb++;assert.equal(d.status,'supported',cellRaw.type);
                for(let y=0;y<cellRaw.connections.Y.length;y++) {
                    const edges=cellDependencies(model,{pinId:`${id}/pin/Y`,index:y,direction:'backward',semanticsProfile:PROFILE}).edges;
                    assert.deepEqual(edges.map(canonicalTuple).sort(),rawExpected(cell,cellRaw,y));edgeCount+=edges.length;
                    for(const e of edges) {
                        assert.equal(e.from.occurrenceId,occurrence.id);assert.equal(e.to.occurrenceId,occurrence.id);assert.equal(e.from.snapshotId,model.snapshot.id);
                        const reverse=cellDependencies(model,{pinId:e.from.entityId,index:e.from.index,direction:'forward',semanticsProfile:PROFILE});
                        assert.ok(reverse.edges.some(f=>f.id===e.id));
                    }
                }
            }
        }
        assert.deepEqual([comb,sequential],{A:[9,2],B:[24,2],C:[17,4]}[corpus]);
        const selected=Object.values(model.cells).find(c=>c.occurrenceId===model.roots[0] && c.type===(corpus==='B' ? '$pmux' : '$add'));
        const y=model.pins[`${selected.id}/pin/Y`],q=input(api,model,y,{seed:{entityId:y.id,indices:[0,2,1,2]}});
        const result=await api.query(q);
        assert.equal(result.status,'complete');assert.deepEqual(result.seed.positions.map(s=>s.index),[0,2,1,2]);
        assert.deepEqual(result.groups[1].bitIds,result.groups[3].bitIds);
        for(const index of [0,1,2])assert.deepEqual(logic(result).filter(e=>e.cellId===selected.id && e.to.index===index).map(canonicalTuple).sort(),rawExpected(selected,selected.raw,index));
        assert.deepEqual(result.sourceRefs,[]);assert.equal(result.relations.some(e=>e.family==='correspondence'||e.family==='scheduling'),false);
        assert.equal(hash(stable({imported,analysis})),before);assert.ok(Object.isFrozen(result));
        if(corpus==='A') {
            const left=Object.values(model.occurrences).find(o=>o.name==='left'),right=Object.values(model.occurrences).find(o=>o.name==='right');
            assert.notEqual(left.id,right.id);assert.ok(result.objects.some(o=>o.occurrenceId===left.id));assert.ok(result.objects.some(o=>o.occurrenceId===right.id));
            const stageAdd=left.cells.map(id=>model.cells[id]).find(c=>c.type==='$add'),stageY=model.pins[`${stageAdd.id}/pin/Y`];
            const local=await api.query(input(api,model,stageY));
            assert.equal(local.status,'complete');assert.equal(local.objects.some(o=>o.occurrenceId===right.id),false);
        }
        if(corpus==='B') {
            assert.deepEqual(selected.raw.connections.A,['0','1','0','1','0','1','0','1']);
            assert.ok(result.cellDescriptions.some(d=>d.limitations.includes('undefined-multiple-select')));
            const literal=Object.values(model.cells).find(c=>c.type==='$mux'&&c.raw.connections.S[0]==='1');
            const literalResult=await api.query(input(api,model,model.pins[`${literal.id}/pin/Y`]));
            assert.deepEqual(logic(literalResult).filter(e=>e.cellId===literal.id).map(canonicalTuple).sort(),rawExpected(literal,literal.raw,0));
        }
        if(corpus==='C') {
            for(const [name,bias] of [['low',3],['high',9]]) {
                const o=Object.values(model.occurrences).find(o=>o.name===name),add=o.cells.map(id=>model.cells[id]).find(c=>c.type==='$add');
                assert.equal(parseInt([...add.raw.connections.B].reverse().join(''),2),bias);
                const cone=await api.query(input(api,model,model.pins[`${add.id}/pin/Y`]));
                assert.deepEqual(logic(cone).filter(e=>e.cellId===add.id).map(canonicalTuple).sort(),rawExpected(add,add.raw,0));
            }
            assert.equal(selected.raw.connections.Y.length,12);
            assert.deepEqual(selected.raw.connections.B.slice(8),['0','0','0','0']);
        }
        receipts.push({corpus,provider,comb,sequential,edgeCount,resultId:result.id,metrics:result.metrics,
            boundaries:Object.fromEntries([...new Set(result.boundaries.map(b=>b.reason))].sort().map(reason=>[reason,result.boundaries.filter(b=>b.reason===reason).length]))});
        if(process.env.G5_OUTPUT_DIR)fs.writeFileSync(path.join(process.env.G5_OUTPUT_DIR,`dependencies-${corpus}-${provider}.json`),JSON.stringify({input:q,result},null,2),{flag:'wx'});
    }
    console.log('DEPENDENCY_COVERAGE',JSON.stringify(receipts));
});
test('D08 capability advertisements do not enter semantic query/result identity; incidence IDs survive', async () => {
    const imported=hierarchy(),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
    const port=Object.values(model.ports).find(p=>p.occurrenceId===model.roots[0]);
    const q=input(api,model,port,{kind:'same-net'});delete q.direction;delete q.semanticsProfile;
    const {normalize,identityValue}=require('../src/hardware/analysis/input');
    const context=api.getContext(),changedContext={...context,capabilities:{future:'available'}};
    const normalized=normalize(q,{model,context:changedContext,owners:{}});
    const {queryId,request,...semanticQuery}=normalized;
    assert.equal(queryId,`analysis-query-${hash(stable(identityValue(semanticQuery)))}`);
    const derived=require('../src/hardware/analysis/connectivity').execute(model,normalized),current=await api.query(q);
    const {id,request:derivedRequest,metrics,...semanticResult}=derived;
    assert.equal(current.id,`analysis-result-${hash(stable(identityValue(semanticResult)))}`);
    assert.equal(current.queryId,derived.queryId);assert.deepEqual(current.relations,derived.relations);
    assert.equal(current.context.capabilities.dependencies,'available');
    const cone=await api.query(input(api,model,port,{direction:'forward'}));
    for(const relation of current.relations)assert.deepEqual(cone.relations.find(r=>r.id===relation.id),relation);
});
test('D05 opaque module outputs still count as physical driver candidates without entering the blackbox', async () => {
    const raw={modules:{top:{attributes:{top:1},cells:{gate:binary(),box:{type:'opaque',connections:{Y:[6]},port_directions:{Y:'output'}}}},
        opaque:{attributes:{blackbox:1},ports:{Y:{direction:'output',bits:[2]}}}}};
    const imported=buildSnapshot(JSON.stringify(raw),'opaque-drivers-synthetic.json',{}),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
    const result=await api.query(input(api,model,pin(model,'Y')));
    assert.equal(result.status,'partial');assert.deepEqual(logic(result),[]);
    const boundary=result.boundaries.find(b=>b.reason==='multiple-drivers');
    assert.deepEqual(boundary.driverCandidates.map(c=>c.entityId).sort(),[pin(model,'Y').id,pin(model,'Y','box').id].sort());
});
test('D05 hierarchy parameter overrides cannot traverse unverified specialization or bypass by seeding inside', async () => {
    for(const value of [2,'x']) {
        const raw={modules:{top:{attributes:{top:1},cells:{gate:{type:'child',parameters:{P:value},connections:{Y:[3]},port_directions:{Y:'output'}}}},
            child:{parameter_default_values:{P:1},ports:{Y:{direction:'output',bits:[6]}},cells:{inner:binary()}}}};
        const imported=buildSnapshot(JSON.stringify(raw),'override-synthetic.json',{}),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
        for(const selected of [pin(model,'Y'),pin(model,'Y','inner')]) {
            const result=await api.query(input(api,model,selected));
            assert.equal(result.status,'partial');assert.deepEqual(logic(result),[]);
            assert.ok(result.boundaries.some(b=>b.reason==='unsupported-parameters' && b.cellId===pin(model,'Y').cellId));
        }
    }
});
