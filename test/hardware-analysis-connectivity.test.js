'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const hardware = require('../src/hardware');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
test('Q01 public ordered same-net query crosses the real A left.get binding', async () => {
    const { request, analysis } = await loadCapturedCase('A');
    const model = request.importResult.implementation;
    const left = Object.values(model.occurrences).find(o => o.name === 'left');
    const port = left.ports.map(id => model.ports[id]).find(p => p.name === 'get');
    assert.equal(typeof hardware.createAnalysisQuery, 'function');
    const api = hardware.createAnalysisQuery({ importResult: request.importResult, analysis });
    const context = api.getContext('stock');
    const result = await api.query({ kind: 'same-net', analysisId: context.analysisId,
        snapshotId: context.snapshotId, implementationProvider: 'stock',
        implementationOccurrenceId: left.id, ownerInstanceId: null,
        seed: { entityId: port.id, indices: [0, 2, 1, 2] },
        scope: { kind: 'design', rootOccurrenceId: model.roots[0] }, queryGeneration: 1 });
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.groups.map(g => g.seed.index), [0, 2, 1, 2]);
    assert.deepEqual(result.groups.map(g => g.bitIds.map(id => model.bits[id].value).sort((a,b) => a-b)),
        [[13, 21], [15, 23], [14, 22], [15, 23]]);
});


const fs = require('node:fs');
const { buildSnapshot } = require('../src/hardware/snapshot');
const { hash, stable } = require('../src/hardware/json');
const captures = new Map();
async function captured(key) {
    if (!captures.has(key)) captures.set(key, loadCapturedCase(key));
    return captures.get(key);
}
function requestFor(api, model, entity, extra = {}) {
    const context = api.getContext('stock');
    return { kind: 'same-net', analysisId: context.analysisId, snapshotId: context.snapshotId,
        implementationProvider: 'stock', stage: context.stage, ownerInstanceId: null,
        implementationOccurrenceId: entity.occurrenceId, seed: { entityId: entity.id },
        scope: { kind: 'design', rootOccurrenceId: model.roots[0] }, queryGeneration: 1, ...extra };
}
function rawCase(key) { return JSON.parse(fs.readFileSync(`docs/hardware/evidence/toolchain/${key}/design.json`, 'utf8')); }
function portNamed(model, occurrence, name) { return model.occurrences[occurrence].ports.map(id => model.ports[id]).find(p => p.name === name); }
function occurrenceNamed(model, name) { return Object.values(model.occurrences).find(o => o.name === name); }
// Independent incidence oracle: read raw JSON vectors, not G2 endpoints or boundary tables.
function rawIncidences(raw, path, value) {
    let module = raw.modules[path[0]];
    for (const part of path.slice(1)) module = raw.modules[module.cells[part].type];
    const found = [];
    const scan = (kind, name, vector, cell = null) => vector.forEach((bit,index) => {
        if (bit === value) found.push(JSON.stringify({ path,kind,name,cell,index }));
    });
    for (const [name,p] of Object.entries(module.ports || {})) scan('port',name,p.bits);
    for (const [name,a] of Object.entries(module.netnames || {})) scan('alias',name,a.bits);
    for (const [cell,c] of Object.entries(module.cells || {})) for (const [name,vector] of Object.entries(c.connections)) scan('pin',name,vector,cell);
    return found.sort();
}
function incidenceTuples(model, group) {
    return group.incidences.map(i => { const e = model.entities[i.entityId];
        return JSON.stringify({ path: model.occurrences[e.occurrenceId].path,kind:e.kind,name:e.name,
            cell: model.cells[e.cellId]?.name || null,index:i.index }); }).sort();
}
test('Q02 A aliases, reused occurrences, slices and all incidences match raw vectors', async () => {
    const { request, analysis } = await captured('A'), model = request.importResult.implementation;
    const api = hardware.createAnalysisQuery({ importResult: request.importResult, analysis });
    const left = occurrenceNamed(model,'left'), right = occurrenceNamed(model,'right');
    assert.equal(left.definitionId,right.definitionId);
    const port = portNamed(model,left.id,'get'), raw = rawCase('A');
    const result = await api.query(requestFor(api,model,port,{ seed:{ entityId:port.id,slice:{ start:0,end:3 } } }));
    for (const [index,g] of result.groups.entries()) {
        const expected = [...rawIncidences(raw,['mkConnected','left'],raw.modules.mkStage.ports.get.bits[index]),
            ...rawIncidences(raw,['mkConnected'],raw.modules.mkConnected.cells.left.connections.get[index])].sort();
        assert.deepEqual(incidenceTuples(model,g),expected);
        assert.equal(g.bitIds.some(id => model.bits[id].occurrenceId === right.id),false);
        const mutant = structuredClone(g); mutant.incidences.pop();
        assert.notDeepEqual(incidenceTuples(model,mutant),expected);
        const swapped = structuredClone(g); swapped.incidences[0].index += 1;
        assert.notDeepEqual(incidenceTuples(model,swapped),expected);
    }
    const alias = left.aliases.map(id=>model.aliases[id]).find(a => a.rawBits.length === 8 && a.rawBits[0] === 13);
    const aliasResult = await api.query(requestFor(api,model,alias,{ seed:{entityId:alias.id,indices:[2,0,2]} }));
    assert.deepEqual(aliasResult.groups.map(g=>g.bitIds),[result.groups[2].bitIds,result.groups[0].bitIds,result.groups[2].bitIds]);
    const explicit = await api.query(requestFor(api,model,port,{ seed:{occurrenceId:left.id,bitIds:[port.bits[2],port.bits[0],port.bits[2]]} }));
    assert.deepEqual(explicit.groups.map(g=>g.bitIds),aliasResult.groups.map(g=>g.bitIds));
});
test('Q03 B read is DFF Q, never add Y; all raw load and alias incidences survive', async () => {
    const { request, analysis } = await captured('B'), model = request.importResult.implementation, raw = rawCase('B');
    const api = hardware.createAnalysisQuery({ importResult: request.importResult, analysis });
    const port = portNamed(model,model.roots[0],'read');
    const result = await api.query(requestFor(api,model,port,{kind:'drivers-loads'}));
    assert.equal(result.status,'complete');
    assert.deepEqual(port.rawBits,raw.modules.mkControl.ports.read.bits);
    for (const [i,g] of result.groups.entries()) {
        assert.deepEqual(g.bitIds.map(id=>model.bits[id].value),[14+i]);
        assert.deepEqual(incidenceTuples(model,g),rawIncidences(raw,['mkControl'],14+i));
        assert.equal(g.drivers.length,1);
        const driver = model.pins[g.drivers[0].entityId];
        assert.equal(driver.name,'Q'); assert.equal(model.cells[driver.cellId].type,'$dff');
        assert.equal(g.incidences.some(e=>model.pins[e.entityId]?.name === 'Y' && model.cells[model.pins[e.entityId].cellId].type === '$add'),false);
    }
});
test('Q04 C specialization widths and four connection-local zero slots are preserved', async () => {
    const { request, analysis } = await captured('C'), model = request.importResult.implementation, raw = rawCase('C');
    const api = hardware.createAnalysisQuery({ importResult:request.importResult,analysis });
    for (const [name,width] of [['narrow',8],['wide',12]]) {
        const o=occurrenceNamed(model,name), port=portNamed(model,o.id,'get');
        const result=await api.query(requestFor(api,model,port));
        assert.equal(result.groups.length,width);
        const top=raw.modules.mkReuse, child=raw.modules[top.cells[name].type];
        for (const [i,g] of result.groups.entries()) assert.deepEqual(incidenceTuples(model,g),[
            ...rawIncidences(raw,['mkReuse',name],child.ports.get.bits[i]),
            ...rawIncidences(raw,['mkReuse'],top.cells[name].connections.get[i])].sort());
    }
    const wide=Object.values(model.cells).find(c=>c.name==='wide');
    const pin=wide.pins.map(id=>model.pins[id]).find(p=>p.name==='put_value');
    const result=await api.query(requestFor(api,model,pin,{seed:{entityId:pin.id,slice:{start:8,end:12}}}));
    assert.deepEqual(raw.modules.mkReuse.cells.wide.connections.put_value.slice(8),['0','0','0','0']);
    assert.equal(new Set(result.groups.flatMap(g=>g.drivers.filter(d=>d.role==='constant').map(d=>d.bitId))).size,4);
    for (const [i,g] of result.groups.entries()) {
        assert.equal(g.bitIds.length,2); assert.equal(g.drivers.filter(d=>d.role==='constant').length,1);
        assert.equal(g.bitIds.includes(pin.bits[8+i]),true);
        assert.equal(g.bitIds.some(id=>model.bits[id].value===12+i),true);
    }
    const add=Object.values(model.cells).find(c=>c.occurrenceId===model.roots[0]&&c.type==='$add');
    const b=add.pins.map(id=>model.pins[id]).find(p=>p.name==='B');
    assert.equal(result.groups.some(g=>g.bitIds.some(id=>b.bits.slice(8).includes(id))),false);
});
function synthetic() {
    const raw={ modules:{ top:{ attributes:{top:1}, ports:{ external:{direction:'input',bits:[2,3]}, io:{direction:'inout',bits:[2]} },
        netnames:{ repeat:{bits:[2,3,2]}, lone:{bits:[90]} }, cells:{
            a:{type:'mid',connections:{p:[2]}}, b:{type:'box',connections:{o:[2]},port_directions:{o:'output'}},
            one:{type:'vendor',connections:{Y:[2],A:[3]},port_directions:{Y:'output',A:'input'},attributes:{src:'/forbidden/missing.v:1.1-9.1'}},
            two:{type:'vendor',connections:{Y:[2]},port_directions:{Y:'output'}},
            mystery:{type:'vendor',connections:{P:[2]}} } },
        mid:{ ports:{p:{direction:'input',bits:[2]}},cells:{leaf:{type:'leaf',connections:{p:[2]}}} },
        leaf:{ports:{p:{direction:'input',bits:[2]}},cells:{sink:{type:'vendor',connections:{A:[2]},port_directions:{A:'input'}}}},
        box:{attributes:{blackbox:1},ports:{o:{direction:'output',bits:[2]}}} } };
    return buildSnapshot(JSON.stringify(raw),'synthetic-edge.json',{});
}
test('Q05 synthetic multi-driver, inout, unknown, opaque contracts, hierarchy and dangling alias', async () => {
    const imported=synthetic(),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
    const port=portNamed(model,model.roots[0],'external');
    const q=requestFor(api,model,port,{seed:{entityId:port.id,indices:[0]}});
    const membership=await api.query(q),interpreted=await api.query({...q,kind:'drivers-loads'});
    assert.equal(membership.status,'complete'); assert.equal(membership.groups[0].membership,'complete');
    assert.equal(membership.groups[0].interpretation,'partial'); assert.equal(interpreted.status,'partial');
    const g=interpreted.groups[0];
    assert.deepEqual(g.drivers.map(d=>d.role).sort(),['external-contact','leaf-terminal','leaf-terminal','opaque-contract']);
    assert.deepEqual(g.unknownContacts.map(d=>d.role).sort(),['bidirectional','unknown-direction','unknown-direction','unknown-direction']);
    assert.equal(g.boundaryContacts.every(c=>c.role==='hierarchy-pass-through'),true);
    assert.equal(g.drivers.some(c=>g.boundaryContacts.some(b=>b.id===c.id)),false);
    assert.equal(interpreted.evidenceRefs.flatMap(e=>e.generatedRtl).some(e=>e.access==='unvalidated-no-file-read'),true);
    const alias=Object.values(model.aliases).find(a=>a.name==='lone');
    const lone=await api.query(requestFor(api,model,alias));
    assert.equal(lone.status,'complete'); assert.equal(lone.groups[0].incidences.length,1); assert.equal(lone.groups[0].drivers.length,0);
    const cell=Object.values(model.cells).find(c=>c.name==='one');
    const ambiguous=await api.query(requestFor(api,model,cell));
    assert.equal(ambiguous.status,'ambiguous'); assert.deepEqual(ambiguous.candidates.map(c=>c.entityId),[...cell.pins].sort());
});
test('Q06 scope continuations and each count/byte/depth bound retain explicit frontiers', async () => {
    const imported=synthetic(),model=imported.implementation,api=hardware.createAnalysisQuery({importResult:imported});
    const leaf=occurrenceNamed(model,'leaf'),port=portNamed(model,leaf.id,'p');
    const q=requestFor(api,model,port);
    for (const kind of ['occurrence','subtree']) {
        const scoped=await api.query({...q,scope:{kind,rootOccurrenceId:leaf.id}});
        assert.equal(scoped.status,'complete'); assert.deepEqual(scoped.groups[0].bitIds,port.bits);
        assert.equal(scoped.frontier.length,1); assert.equal(scoped.frontier[0].reason,'scope');
        assert.equal(model.boundaries[scoped.frontier[0].boundaryId].childOccurrenceId,leaf.id);
    }
    for (const [key,value] of [['maxBits',1],['maxPins',1],['maxCells',1],['maxEdges',1],['maxHierarchyDepth',1],['maxResultBytes',20000]]) {
        const bounded=await api.query({...q,limits:{[key]:value}});
        assert.equal(bounded.status,'partial',key);
        assert.equal(bounded.frontier.some(f=>f.reason==='resource-limit'&&f.limit===key),true,key);
        assert.equal(bounded.limits.stopReasons.includes(key),true);
        const metric={maxBits:'visitedBits',maxPins:'visitedPins',maxCells:'visitedCells',maxEdges:'visitedEdges',maxHierarchyDepth:'maxHierarchyDepth',maxResultBytes:'resultBytes'}[key];
        assert.ok(bounded.metrics[metric]<=value,key);
        assert.equal(bounded.metrics.resultBytes,Buffer.byteLength(JSON.stringify(bounded)));
    }
    await assert.rejects(api.query({...q,limits:{maxResultBytes:1}}),{code:'LIMIT_EXCEEDED'});
});
test('selected analysis root ports are external contacts without duplicating intermediate drivers', async () => {
    const { request, analysis } = await captured('A');
    const model = request.importResult.implementation;
    const api = hardware.createAnalysisQuery({ importResult: request.importResult, analysis });
    const left = occurrenceNamed(model, 'left');
    for (const [name, role] of [['put_value', 'drivers'], ['get', 'loads']]) {
        const port = portNamed(model, left.id, name);
        const input = requestFor(api, model, port, { kind: 'drivers-loads', seed: { entityId: port.id, indices: [0] } });
        for (const kind of ['occurrence', 'subtree']) {
            const scoped = await api.query({ ...input, scope: { kind, rootOccurrenceId: left.id } });
            const contacts = scoped.groups[0][role].filter(item => item.entityId === port.id);
            assert.equal(contacts.length, 1);
            assert.equal(contacts[0].role, 'external-contact');
            assert.equal(scoped.groups[0].boundaryContacts.some(item => item.entityId === port.id), false);
            assert.ok(scoped.frontier.some(item => item.reason === 'scope'));
        }
        const design = await api.query(input);
        assert.equal(design.groups[0][role].some(item => item.entityId === port.id), false);
        assert.ok(design.groups[0].boundaryContacts.some(item => item.entityId === port.id));
    }
});
test('Q07 identity, owner, hostile JSON, enum, seed and budget boundary rejects; source kinds reject electrical selectors', async () => {
    const {request,analysis}=await captured('A'), model=request.importResult.implementation;
    const api=hardware.createAnalysisQuery({importResult:request.importResult,analysis});
    const left=occurrenceNamed(model,'left'),right=occurrenceNamed(model,'right'),port=portNamed(model,left.id,'get');
    const q=requestFor(api,model,port),rightOwner=analysis.correspondence.contexts.find(c=>c.contextOccurrenceId===right.id).occurrenceId;
    const bad=[{snapshotId:'foreign'},{analysisId:'foreign'},{implementationProvider:'evil'},{stage:'invented'},
        {implementationOccurrenceId:right.id},{ownerInstanceId:rightOwner},{ownerInstanceId:'foreign'},
        {seed:{entityId:port.id,indices:[]}},{seed:{entityId:port.id,indices:[8]}},{seed:{entityId:port.id,indices:[-1]}},
        {seed:{entityId:port.id,indices:[0.5]}},{seed:{entityId:[port.id]}},{scope:{kind:'occurrence',rootOccurrenceId:[left.id]}},{seed:{entityId:port.id,indices:[0],slice:{start:0,end:1}}},
        {seed:{entityId:port.id,slice:{start:2,end:2}}},{seed:{entityId:port.id,slice:{start:0,end:9}}},
        {seed:{occurrenceId:left.id,bitIds:[portNamed(model,right.id,'get').bits[0]]}},{seed:{occurrenceId:left.id,bitIds:[[port.bits[0]]]}},
        {scope:{kind:'everything',rootOccurrenceId:model.roots[0]}},{scope:{kind:'design',rootOccurrenceId:left.id}},
        {direction:'sideways'},{semanticsProfile:'invented'},{kind:'execute'},{queryGeneration:-1},
        {limits:{maxBits:0}},{limits:{maxEdges:20000}},{limits:{timeoutMs:Infinity}},{limits:{unexpected:2}},
        {path:'/etc/passwd'},{seed:JSON.parse('{"__proto__":{}}')},{seed:JSON.parse('{"constructor":{}}')}];
    for (const extra of bad) await assert.rejects(api.query({...q,...extra}),error=>typeof error.code==='string');
    const accessor={...q}; Object.defineProperty(accessor,'seed',{enumerable:true,get(){assert.fail('Getter must not run');}});
    await assert.rejects(api.query(accessor),{code:'INVALID_INPUT'});
    const cycle={...q};cycle.seed=cycle;await assert.rejects(api.query(cycle),{code:'INVALID_INPUT'});
    for (const kind of ['state-accesses','behavior','call-site','source-dependencies','correspondence']) {
        await assert.rejects(api.query({...q,kind,seed:{entityId:port.id,indices:[0]}}),{code:'INVALID_INPUT'});
    }
    const sourceOnly=hardware.createAnalysisQuery({sourceModel:analysis.sourceModel}),context=sourceOnly.getContext('stock');
    await assert.rejects(sourceOnly.query({...q,analysisId:context.analysisId,snapshotId:null,stage:null}),{code:'UNAVAILABLE'});
    assert.equal(context.snapshotId,null); assert.equal(context.providerIdentity,null);
    const hardwareOnly=hardware.createAnalysisQuery({importResult:synthetic()}).getContext('stock');
    assert.equal(hardwareOnly.stage,null);assert.equal(hardwareOnly.sourceStatus,'not-attached');
    assert.equal(hardwareOnly.providerIdentity,'yosys-json-v1');assert.equal(hardwareOnly.sourceModelIdentity,null);
});
test('Q08 stable semantic IDs exclude generation/metrics; immutable G2/G3 identity and public function identities survive', async () => {
    const {request,analysis}=await captured('A'), model=request.importResult.implementation;
    const before=hash(stable({importResult:request.importResult,analysis})), modelIdentity=model, analysisIdentity=analysis;
    const originals={...hardware},provider=require('../src/hardware/yosys-json');
    const api=hardware.createAnalysisQuery({importResult:request.importResult,analysis});
    const port=portNamed(model,occurrenceNamed(model,'left').id,'get'),q=requestFor(api,model,port,{seed:{entityId:port.id,indices:[2,0,2]}});
    const first=await api.query(q), second=await api.query({...q,queryGeneration:77});
    assert.equal(first.id,second.id);assert.equal(first.queryId,second.queryId);assert.notEqual(first.request.queryGeneration,second.request.queryGeneration);
    assert.equal(Object.isFrozen(first.groups[0].incidences),true);
    assert.equal(request.importResult.implementation,modelIdentity);assert.equal(analysis,analysisIdentity);
    assert.equal(hash(stable({importResult:request.importResult,analysis})),before);
    for(const key of Object.keys(originals))assert.equal(hardware[key],originals[key]);
    for(const key of ['getChildren','getPorts','getNetEndpoints','crossHierarchyBoundary','getGeneratedEvidence','DEFAULT_LIMITS'])assert.equal(hardware[key],provider[key]);
    assert.deepEqual(hardware.getNetEndpoints(model,port.occurrenceId,port.bits)[0].endpoints,model.bits[port.bits[0]].endpoints);
});

test('Q07 instrumented provider asserts its actual snapshot/stage and only equal registered source bindings join owners', async () => {
    const stock=await captured('A'),originCase=await require('../experiments/hardware/g3/origin-query').loadOriginCase('A');
    const source=stock.analysis.sourceModel.sourceDocuments[0];
    const originSource=originCase.request.files.find(f=>f.kind==='source'&&f.contentHash===source.revision);
    const binding={sourcePathRef:source.relativePath,sourceRevision:source.revision,originPathRef:originSource.pathRef,originRevision:originSource.contentHash};
    const options={importResult:stock.request.importResult,analysis:stock.analysis,originCase,sourceBindings:[binding]};
    const api=hardware.createAnalysisQuery(options),model=originCase.request.importResult.implementation,context=api.getContext('instrumented');
    const before=hash(stable({model,analysis:originCase.analysis}));
    assert.equal(context.stage,model.snapshot.stage);assert.equal(context.providerIdentity,model.snapshot.providerIdentity);
    assert.equal(context.originAnalysisId,originCase.analysis.id);
    const port=Object.values(model.ports).find(p=>p.occurrenceId===model.roots[0]&&p.bits.length>2);
    const input={...requestFor(api,model,port),implementationProvider:'instrumented',snapshotId:context.snapshotId,stage:context.stage,
        seed:{entityId:port.id,indices:[0,2,1,2]}};
    const result=await api.query(input);assert.equal(result.status,'complete');assert.equal(result.groups.length,4);
    assert.equal(hash(stable({model,analysis:originCase.analysis})),before);
    await assert.rejects(api.query({...input,snapshotId:stock.request.importResult.snapshot.id}),{code:'SNAPSHOT_MISMATCH'});
    assert.throws(()=>hardware.createAnalysisQuery({...options,sourceBindings:[{...binding,originRevision:'0'.repeat(64)}]}),{code:'SOURCE_REVISION_MISMATCH'});
    assert.throws(()=>hardware.createAnalysisQuery({...options,sourceBindings:[binding,binding]}),{code:'INVALID_INPUT'});
    const owner=stock.analysis.correspondence.contexts.find(c=>c.contextOccurrenceId===stock.request.importResult.implementation.roots[0]).occurrenceId;
    const owned=await api.query({...input,ownerInstanceId:owner});assert.equal(owned.status,'complete');
    const unbound=hardware.createAnalysisQuery({...options,sourceBindings:[]});
    await assert.rejects(unbound.query({...input,ownerInstanceId:owner}),{code:'INVALID_INPUT'});
});
