'use strict';
const { hash, stable, failure } = require('../json');
const { getGeneratedEvidence } = require('../yosys-json');
const { inside } = require('./input');
const { boundaryIndex } = require('./connectivity');
const { describeCell, cellDependencies } = require('./cell-semantics');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const seal = (kind,value) => ({id:`analysis-${kind}-${hash(stable(value))}`,kind,...value});
const compare = (a,b) => a<b ? -1 : a>b ? 1 : 0;
const sorted = map => [...map.values()].sort((a,b)=>compare(a.id,b.id));
function execute(model,q) {
    const started = performance.now(), adjacency = boundaryIndex(model), preparationMs = performance.now()-started;
    const objects = new Map(), relations = new Map(), boundaries = new Map(), frontier = new Map(), evidence = new Map(), descriptions = new Map();
    const bits = new Set(), pins = new Set(), cells = new Set(), stops = new Set(), componentFor = new Map();
    const groups = q.seed.positions.map(seed=>({seed,bitIds:[],relationIds:[],boundaryIds:[],interpretation:'complete'}));
    const result = {schemaVersion:1,id:'',queryId:q.queryId,kind:q.kind,status:'complete',availability:'available',completeness:'complete',
        freshness:q.context.freshness,context:q.context,seed:q.seed,scope:q.scope,direction:q.direction,semanticsProfile:q.semanticsProfile,
        groups,objects:[],relations:[],boundaries:[],frontier:[],cellDescriptions:[],sourceRefs:[],evidenceRefs:[],candidates:q.candidates,
        limits:{...q.limits,stopReasons:[]},request:q.request,metrics:{}};
    // Reserved emergency continuation per ordered seed; normal facts/frontiers are charged before publication.
    let usedBytes = bytes(result)+4096+groups.reduce((n,g)=>n+bytes(g.seed)*2+2048,0), maxDepth = 0, resource = null;
    if (usedBytes>q.limits.maxResultBytes) throw failure('LIMIT_EXCEEDED','Result budget cannot contain the ordered seed and frontier envelope');
    const ref = id => { const e=model.entities[id]; return {kind:'implementation',objectKind:e.kind,entityId:id,
        snapshotId:model.snapshot.id,occurrenceId:e.occurrenceId || null}; };
    const at = (id,index,bitId) => ({...ref(id),index,bitId});
    function fits(additions) {
        const cost = additions.reduce((n,[map,values])=>n+values.reduce((s,v)=>s+(map.has(v.id) ? 0 : bytes(v)+2),0),0);
        if (usedBytes+cost>q.limits.maxResultBytes) {resource='maxResultBytes';return false;}
        usedBytes+=cost;
        for (const [map,values] of additions) for (const value of values) map.set(value.id,value);
        return true;
    }
    function boundary(comp,reason,where,extra = {}) {
        const cellId=model.pins[where.entityId]?.cellId;
        const b=seal('dependency-boundary',{family:'logic-dependency',aspect:'dependencies',reason,at:where,nextAnalysis:null,
            ...(cellId ? {cellId} : {}),...extra});
        const f=seal('frontier',{reason,aspect:'dependencies',at:where,boundaryId:b.id,nextAnalysis:null,...extra});
        if (!fits([[boundaries,[b]],[frontier,[f]]])) return;
        comp.boundaries.add(b.id);
        if (!['sequential','external-contact','constant','dangling'].includes(reason)) comp.partial=true;
    }
    function description(cellId) {
        if (descriptions.has(cellId)) return descriptions.get(cellId);
        const d={id:cellId,...describeCell(model,cellId)};
        if (!fits([[descriptions,[d]]])) return null;
        return d;
    }
    function physical(seedBit) {
        if (componentFor.has(seedBit)) return componentFor.get(seedBit);
        const comp={id:seedBit,bits:[],relations:new Set(),boundaries:new Set(),contacts:[],drivers:[],unknown:false,partial:false,outgoing:[],expanded:false};
        const queue=[{id:seedBit,depth:0}], queued=new Set([seedBit]);
        for (let cursor=0;cursor<queue.length && !resource;cursor++) {
            const {id,depth}=queue[cursor], bit=model.bits[id];
            if (depth>q.limits.maxHierarchyDepth) {resource='maxHierarchyDepth';break;}
            if (!bits.has(id) && bits.size>=q.limits.maxBits) {resource='maxBits';break;}
            const contacts=[...bit.endpoints], aliases=bit.aliases;
            if (contacts.length+aliases.length>q.limits.maxEdges-relations.size) {resource='maxEdges';break;}
            const newPins=new Set(),newCells=new Set();
            for (const e of contacts) if (model.pins[e.entityId]) {
                if (!pins.has(e.entityId)) newPins.add(e.entityId);
                if (!cells.has(model.pins[e.entityId].cellId)) newCells.add(model.pins[e.entityId].cellId);
            }
            if (pins.size+newPins.size>q.limits.maxPins) {resource='maxPins';break;}
            if (cells.size+newCells.size>q.limits.maxCells) {resource='maxCells';break;}
            const batchObjects=new Map([[id,{id,...ref(id),value:bit.value}]]), batchRelations=[], batchContacts=[];
            function contact(entityId,index,direction,alias=false) {
                const e=model.entities[entityId],cell=model.cells[e.cellId],occ=model.occurrences[e.occurrenceId];
                const role=alias ? 'alias' : cell?.childOccurrenceId ? 'hierarchy-pass-through' : e.kind==='port' && occ.blackbox ? 'opaque-contract'
                    : e.kind==='port' && occ.parentId && occ.id!==q.scope.rootOccurrenceId ? 'hierarchy-pass-through' : e.kind==='port' ? 'external-contact' : 'leaf-terminal';
                const endpoint={...at(entityId,index,id),direction:direction ?? null,role};
                const edge=seal('incidence',{family:'same-net',from:ref(id),to:endpoint});
                batchRelations.push(edge); batchObjects.set(entityId,{id:entityId,...ref(entityId),name:e.name});
                if (cell) batchObjects.set(cell.id,{id:cell.id,...ref(cell.id),name:cell.name,type:cell.type});
                // Keep incidence IDs identical to same-net. Only dependency interpretation uses verified formal directions.
                if (cell?.definitionId && direction==null) direction=model.definitions[cell.definitionId].raw.ports[e.name].direction;
                if (!alias) batchContacts.push({...endpoint,direction:direction ?? null});
            }
            for (const e of contacts.sort((a,b)=>compare(a.entityId,b.entityId)||a.index-b.index)) contact(e.entityId,e.index,e.direction);
            for (const a of [...aliases].sort((a,b)=>compare(a.aliasId,b.aliasId)||a.index-b.index)) contact(a.aliasId,a.index,null,true);
            let opaque=null;
            for (let occurrence=model.occurrences[bit.occurrenceId];occurrence;occurrence=model.occurrences[occurrence.parentId]) {
                if (occurrence.blackbox) {opaque={reason:'blackbox',cellId:occurrence.cellId};break;}
                if (occurrence.cellId && Object.keys(model.cells[occurrence.cellId].parameters).length) {
                    const d=describeCell(model,occurrence.cellId);
                    if (d.status!=='supported') {opaque={reason:d.reason,cellId:d.cellId};break;}
                }
            }
            if (opaque) {
                boundary(comp,opaque.reason,batchContacts[0] || at(id,0,id),{cellId:opaque.cellId,side:'inside'});
                comp.unknown=true;
            }
            const next=[],crossings=[];
            for (const {to,binding} of opaque ? [] : adjacency.get(id)||[]) {
                const d=description(model.pins[binding.pinId].cellId);
                if (!d || resource) break;
                const direction=model.definitions[model.cells[d.cellId].definitionId].raw.ports[binding.portName].direction;
                const reason=d.status!=='supported' ? d.reason : !['input','output'].includes(direction) ? direction==='inout' ? 'inout' : 'unknown-direction'
                    : !inside(model,model.bits[to].occurrenceId,q.scope) ? 'scope' : null;
                if (reason) {
                    const actual=id===binding.actualBitId;
                    boundary(comp,reason,at(actual ? binding.pinId : binding.portId,binding.index,id),
                        {cellId:d.cellId,boundaryId:binding.id,side:actual ? 'actual' : 'formal',next:ref(to)});
                    continue;
                }
                crossings.push({id:binding.id,kind:'hierarchy-crossing',family:'same-net',boundaryId:binding.id,
                    from:ref(binding.actualBitId),to:ref(binding.formalBitId)});
                if (!queued.has(to)) next.push({id:to,depth:depth+1});
            }
            if (resource) break;
            const allRelations=[...new Map([...batchRelations,...crossings].map(e=>[e.id,e])).values()];
            if (relations.size+allRelations.filter(e=>!relations.has(e.id)).length>q.limits.maxEdges) {resource='maxEdges';break;}
            const batchEvidence=[...batchObjects.values()].filter(o=>!evidence.has(o.id)).map(o=>({id:o.id,kind:'generated-evidence',...getGeneratedEvidence(model,o.id)}));
            if (!fits([[objects,[...batchObjects.values()]],[relations,allRelations],[evidence,batchEvidence]])) break;
            bits.add(id);for(const p of newPins)pins.add(p);for(const c of newCells)cells.add(c);
            maxDepth=Math.max(maxDepth,depth);componentFor.set(id,comp);comp.bits.push(id);
            for(const e of allRelations)comp.relations.add(e.id);
            comp.contacts.push(...batchContacts);
            for(const c of batchContacts) {
                if (!['input','output'].includes(c.direction)) {comp.unknown=true;boundary(comp,c.direction==='inout' ? 'inout' : 'unknown-direction',c);}
                else {
                    const cellId=model.pins[c.entityId]?.cellId;
                    const blockedModule=cellId && model.cells[cellId].definitionId && descriptions.get(cellId)?.status==='boundary';
                    if ((c.role!=='hierarchy-pass-through' || blockedModule) && c.direction===(c.role==='external-contact' ? 'input' : 'output')) comp.drivers.push(c);
                }
            }
            if (bit.kind==='constant') { const terminal={...ref(id),bitId:id,value:bit.value,role:'constant'};comp.drivers.push(terminal);boundary(comp,'constant',terminal); }
            // Queue size is bounded by the remaining bit budget, not by unchecked fanout.
            for (const n of next) if (!queued.has(n.id)) {
                if (queued.size>=q.limits.maxBits) {resource='maxBits';break;}
                queued.add(n.id);queue.push(n);
            }
        }
        if (resource) comp.partial=true;
        return comp;
    }
    function expand(comp) {
        if (comp.expanded || resource) return;
        comp.expanded=true;
        if (comp.drivers.length>1) {
            boundary(comp,'multiple-drivers',ref(comp.id),{driverCandidates:comp.drivers});return;
        }
        if (comp.unknown) return;
        for (const contact of comp.contacts) {
            if (resource) break;
            if (contact.role==='external-contact') {boundary(comp,'external-contact',contact,{side:contact.direction==='input' ? 'external-source' : 'external-sink'});continue;}
            if (contact.role==='opaque-contract') {boundary(comp,'blackbox',contact);continue;}
            if (contact.role==='hierarchy-pass-through') continue;
            const pin=model.pins[contact.entityId];
            if (!pin || pin.direction!==(q.direction==='backward' ? 'output' : 'input')) continue;
            const d=description(pin.cellId);if (!d) break;
            // Cap allocation by both edge count and an upper bound on serialized endpoint size.
            const edgeBytes=2048+4*bytes(contact)+2*bytes(d.limitations);
            const byteEdges=Math.max(0,Math.floor((q.limits.maxResultBytes-usedBytes)/edgeBytes));
            const remainingEdges=q.limits.maxEdges-relations.size;
            const mapped=cellDependencies(model,{pinId:pin.id,index:contact.index,direction:q.direction,
                semanticsProfile:q.semanticsProfile,maxEdges:Math.min(remainingEdges,byteEdges)});
            if (mapped.status==='partial') {resource=byteEdges<remainingEdges ? 'maxResultBytes' : 'maxEdges';break;}
            if (mapped.status==='boundary') {boundary(comp,mapped.reason,contact,{cellId:pin.cellId,side:mapped.boundary.side,...(mapped.boundary.clock ? {clock:mapped.boundary.clock} : {})});continue;}
            for (const edge of mapped.edges) {
                if (!relations.has(edge.id) && relations.size>=q.limits.maxEdges) {resource='maxEdges';break;}
                if (!fits([[relations,[edge]]])) break;
                comp.relations.add(edge.id);
                comp.outgoing.push({bitId:(q.direction==='backward' ? edge.from : edge.to).bitId,edgeId:edge.id});
            }
        }
        if (!comp.drivers.length) boundary(comp,'dangling',ref(comp.id));
    }
    if (q.context.freshness==='stale') {result.status='stale';result.completeness='unknown';result.availability='unavailable';}
    else if (q.candidates.length) {result.status='ambiguous';result.completeness='unknown';}
    else for (const group of groups) {
        const queue=[group.seed.bitId], queued=new Set(queue), seen=new Set(), groupBits=new Set(),groupRelations=new Set(),groupBoundaries=new Set();
        const graph=new Map();
        for(let cursor=0;cursor<queue.length && !resource;cursor++) {
            const comp=physical(queue[cursor]);
            if (seen.has(comp.id)) continue;
            seen.add(comp.id);expand(comp);
            const cost=bytes(comp.bits)+bytes([...comp.relations])+bytes([...comp.boundaries]);
            if (usedBytes+cost>q.limits.maxResultBytes) {resource='maxResultBytes';break;}
            usedBytes+=cost;
            for(const id of comp.bits)groupBits.add(id);for(const id of comp.relations)groupRelations.add(id);for(const id of comp.boundaries)groupBoundaries.add(id);
            if(comp.partial)group.interpretation='partial';
            graph.set(comp.id,comp.outgoing);
            for(const next of comp.outgoing) if(!queued.has(next.bitId)) {
                // Every queued dependency is backed by a retained bounded edge.
                queued.add(next.bitId);queue.push(next.bitId);
            }
        }
        // Directed DFS on physical-equivalence components. A gray target is a real logic cycle;
        // black revisits (fanout/reconvergence) and hierarchy equivalence are not cycles.
        const color=new Map();
        for(const root of graph.keys()) {
            if(color.has(root) || resource)continue;
            color.set(root,1);const stack=[{id:root,index:0}];
            while(stack.length && !resource) {
                const frame=stack[stack.length-1], arcs=graph.get(frame.id)||[];
                if(frame.index===arcs.length) {color.set(frame.id,2);stack.pop();continue;}
                const arc=arcs[frame.index++], target=componentFor.get(arc.bitId)?.id;
                if(!target || !graph.has(target))continue;
                if(color.get(target)===1) {
                    const comp=componentFor.get(target), edge=relations.get(arc.edgeId);
                    boundary(comp,'cycle',q.direction==='backward' ? edge.from : edge.to,{relationId:arc.edgeId,cycleKind:'directed-combinational'});
                    group.interpretation='partial';
                    for(const id of comp.boundaries) if(!groupBoundaries.has(id)) {
                        const cost=bytes(id)+1;
                        if(usedBytes+cost>q.limits.maxResultBytes) {resource='maxResultBytes';break;}
                        usedBytes+=cost;groupBoundaries.add(id);
                    }
                } else if(!color.has(target)) {color.set(target,1);stack.push({id:target,index:0});}
            }
        }
        group.bitIds=[...groupBits].sort();group.relationIds=[...groupRelations].sort();group.boundaryIds=[...groupBoundaries].sort();
        if(resource) {
            stops.add(resource);group.interpretation='partial';
            const f=seal('frontier',{reason:'resource-limit',aspect:'dependencies',limit:resource,seedPosition:group.seed.position,
                at:ref(group.seed.bitId),continuation:'remaining-seed-cone',nextAnalysis:'dependencies'});
            frontier.set(f.id,f);
        }
    }
    result.objects=sorted(objects);result.relations=sorted(relations);result.boundaries=sorted(boundaries);result.frontier=sorted(frontier);
    result.evidenceRefs=sorted(evidence);result.cellDescriptions=sorted(descriptions);result.limits.stopReasons=[...stops].sort();
    if(result.status==='complete' && groups.some(g=>g.interpretation==='partial')) {result.status='partial';result.completeness='partial';}
    if(result.status==='complete' && !groups.length)result.status='empty';
    const {id,request,metrics,...semantic}=result;result.id=`analysis-result-${hash(stable(semantic))}`;
    result.metrics={preparationMs,executionMs:performance.now()-started-preparationMs,cancellationMs:0,
        visitedBits:bits.size,visitedPins:pins.size,visitedCells:cells.size,visitedEdges:relations.size,maxHierarchyDepth:maxDepth,resultBytes:0};
    for(let i=0;i<3;i++)result.metrics.resultBytes=bytes(result);
    if(bytes(result)>q.limits.maxResultBytes)throw failure('LIMIT_EXCEEDED','Result envelope exceeds byte budget');
    return result;
}
module.exports={execute};
