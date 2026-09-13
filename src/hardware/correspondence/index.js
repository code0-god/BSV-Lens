'use strict';
const {Worker}=require('node:worker_threads');
const {EventEmitter}=require('node:events');
const {performance}=require('node:perf_hooks');
const {ArtifactRegistry}=require('../registry');
const {isHash,logicalRef}=require('../snapshot');
const {deepFreeze,hash,stable,failure,DEFAULT_LIMITS}=require('../json');
const {checkedJson,validateStructure}=require('./schema');
const {normalizeRange}=require('./source');
const contexts=new WeakMap();
const sourceSessions=new WeakMap();
const cancelled=signal=>{if(signal?.aborted)throw failure('CANCELLED','Correspondence attachment cancelled');};
function createSourceSession() {
    const state={entries:[],revision:0,pending:new Set(),disposed:false};
    const session=Object.freeze({async dispose(){
        state.disposed=true;state.revision++;state.entries=[];
        const pending=[...state.pending];for(const entry of pending)entry.controller.abort();
        await Promise.all(pending.map(entry=>entry.done));
    }});
    sourceSessions.set(session,state);return session;
}
function beginSourceUpdate(request) {
    if(!request.sourceSession)return null;
    const state=sourceSessions.get(request.sourceSession),revision=++state.revision;
    for(const entry of state.pending)entry.controller.abort();
    const controller=new AbortController(),signal=request.signal,forward=()=>controller.abort();
    signal?.addEventListener('abort',forward,{once:true});if(signal?.aborted)controller.abort();
    let settle;const entry={controller,done:new Promise(resolve=>{settle=resolve;})};state.pending.add(entry);
    request.signal=controller.signal;
    return {state,revision,finish(){signal?.removeEventListener('abort',forward);state.pending.delete(entry);settle();}};
}
function descriptor(value,source=false) {
    if(!value||typeof value!=='object')throw failure('INVALID_INPUT','Evidence descriptor required');
    logicalRef(value.pathRef);if(!isHash(value.contentHash))throw failure('INVALID_INPUT','Evidence SHA256 required');
    if(source&&value.revision!==value.contentHash)throw failure('SOURCE_REVISION_MISMATCH','Source revision must be exact captured bytes identity');
}
function copyRequest(request) {
    if(!request||typeof request!=='object'||Array.isArray(request))throw failure('INVALID_INPUT','Correspondence request object required');
    if(request.signal!=null&&!(request.signal instanceof AbortSignal))throw failure('INVALID_INPUT','AbortSignal required');
    if(request.onProgress!==undefined&&typeof request.onProgress!=='function')throw failure('INVALID_INPUT','Progress callback must be a function');
    if(!(request.registry instanceof ArtifactRegistry))throw failure('INVALID_INPUT','G2 ArtifactRegistry required');
    const allowed=['registry','importResult','sources','metadata','generatedRtl','signal','onProgress','bundle','sourceSession','sourceEntry'];
    if(Object.keys(request).some(k=>!allowed.includes(k)))throw failure('INVALID_INPUT','Unknown correspondence request field');
    if(request.sourceSession!==undefined) {
        const state=sourceSessions.get(request.sourceSession);
        if(!state)throw failure('INVALID_INPUT','Product-created source session required');
        if(state.disposed)throw failure('CANCELLED','Source session is disposed');
    }
    const json=checkedJson({sources:request.sources||[],metadata:request.metadata||null,generatedRtl:request.generatedRtl||[],
        bundle:request.bundle||null,sourceEntry:request.sourceEntry??null});
    if(json.sourceEntry) {
        const entry=json.sourceEntry;
        if(Object.keys(entry).length!==3||Object.keys(entry).some(key=>!['pathRef','revision','definitionId'].includes(key))
            ||typeof entry.definitionId!=='string'||!entry.definitionId.startsWith('def:')||entry.definitionId.length>1024
            ||!isHash(entry.revision))throw failure('INVALID_INPUT','Exact source module entry identity required');
        logicalRef(entry.pathRef);
        if(request.importResult||json.metadata||json.generatedRtl.length)throw failure('INVALID_INPUT','Source entry selection is source-only');
    } else if(request.sourceEntry!=null)throw failure('INVALID_INPUT','Source entry object required');
    if(!Array.isArray(json.sources)||!Array.isArray(json.generatedRtl)||json.sources.length>256||json.generatedRtl.length>256)throw failure('LIMIT_EXCEEDED','Evidence document limit');
    const seen=new Set();
    for(const input of [...json.sources,...json.generatedRtl]){descriptor(input,json.sources.includes(input));if(seen.has(input.pathRef))throw failure('INVALID_INPUT','Duplicate evidence ref');seen.add(input.pathRef);}
    if(json.metadata) {
        descriptor(json.metadata);
        if(json.metadata.provider!=='stock-bluetcl-v1')throw failure('UNSUPPORTED','Unknown/untrusted compiler provider');
        if(!Array.isArray(json.metadata.sourceInputs))throw failure('INVALID_INPUT','Explicit compile source input identities required');
        const actual=json.sources.map(({pathRef,contentHash})=>({pathRef,contentHash})).sort((a,b)=>a.pathRef.localeCompare(b.pathRef));
        const declared=[...json.metadata.sourceInputs].sort((a,b)=>a.pathRef.localeCompare(b.pathRef));
        if(stable(actual)!==stable(declared))throw failure('SOURCE_REVISION_MISMATCH','Compiler/source input identity mismatch');
    } else if(json.generatedRtl.length)throw failure('INVALID_INPUT','Generated RTL requires compiler contract evidence');
    const imported=request.importResult||null;
    if(imported) {
        const pending=[imported],visited=new Set();
        while(pending.length) {
            const value=pending.pop();if(!value||typeof value!=='object'||visited.has(value))continue;
            if(!Object.isFrozen(value))throw failure('INVALID_INPUT','Deeply immutable G2 import result required');
            visited.add(value);
            if(visited.size>DEFAULT_LIMITS.maxJsonNodes)throw failure('LIMIT_EXCEEDED','Import result object limit');
            for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
                if(!Object.hasOwn(descriptor,'value'))throw failure('INVALID_INPUT','Import result accessors are unsupported');
                pending.push(descriptor.value);
            }
        }
    }
    if(imported&&(!imported.snapshot||!imported.implementation?.snapshot||imported.snapshot.id!==imported.implementation.snapshot.id
        ||!isHash(imported.snapshot.artifact.hash)||imported.implementation.id!==`${imported.snapshot.id}/implementation/yosys-json-v1`))throw failure('INVALID_INPUT','Immutable G2 import result required');
    if(imported?.snapshot.sourceInputs!==null&&imported?.snapshot.sourceInputs!==undefined) {
        for(const source of json.sources) {
            const declared=imported.snapshot.sourceInputs.find(input=>input.pathRef===source.pathRef);
            if(!declared||declared.contentHash!==source.contentHash)throw failure('SOURCE_REVISION_MISMATCH','Implementation snapshot contradicts attached source identity');
        }
    }
    return {...request,...json,importResult:imported};
}
async function readEvidence(request) {
    const {registry}=request;
    let bytes=0;
    const count=text=>{bytes+=Buffer.byteLength(text);if(bytes>DEFAULT_LIMITS.maxBytes)throw failure('LIMIT_EXCEEDED','Total correspondence input byte limit');};
    const sources=await Promise.all(request.sources.map(async input=>{
        const result=await registry.readSource(input);
        if(!['current','captured'].includes(result.status))throw failure(result.status==='stale'?'STALE_SOURCE':'PATH_DENIED','Source is stale/unavailable or unregistered');
        if(hash(result.text)!==input.contentHash)throw failure('ARTIFACT_HASH_MISMATCH','Source bytes mismatch');count(result.text);
        return {...input,text:result.text,status:result.status};
    }));
    async function artifact(input) {
        const result=await registry.readArtifact(input.pathRef);if(result.contentHash!==input.contentHash)throw failure('ARTIFACT_HASH_MISMATCH','Metadata/RTL artifact hash mismatch');
        count(result.text);return {...input,text:result.text};
    }
    const [metadata,generatedRtl]=await Promise.all([request.metadata?artifact(request.metadata):null,Promise.all(request.generatedRtl.map(artifact))]);
    // A public import result is tied to bytes still owned by this registry, not a lookalike snapshot label.
    let artifactText=null;
    if(request.importResult) {
        const imported=request.importResult;
        const actual=await registry.readArtifact(imported.snapshot.artifact.pathRef);
        artifactText=actual.text;
        if(actual.contentHash!==imported.snapshot.artifact.hash)throw failure('ARTIFACT_HASH_MISMATCH','Implementation artifact changed or foreign import result');
    }
    return {sources:sources.sort((a,b)=>a.pathRef.localeCompare(b.pathRef)),metadata,generatedRtl:generatedRtl.sort((a,b)=>a.pathRef.localeCompare(b.pathRef)),
        importResult:request.importResult,artifactText,sourceEntry:request.sourceEntry};
}
function runWorker(data,signal,onProgress,previousCache,operation='attach') {
    cancelled(signal);
    const worker=new Worker(require.resolve('./worker'),{workerData:{...data,sourceCache:previousCache,operation},resourceLimits:{maxOldGenerationSizeMb:512,stackSizeMb:4}});
    const threadId=worker.threadId;
    let result,error,metrics,sourceCache,aborted=false;
    return new Promise((resolve,reject)=>{
        const abort=()=>{aborted=true;worker.terminate().catch(cause=>{error=cause;});};
        const deadline=setTimeout(()=>{error=failure('LIMIT_EXCEEDED','Correspondence worker exceeded 30-second deadline');abort();},30000);
        worker.on('message',message=>{
            if(aborted)return;
            if(message.type==='progress'){try{onProgress?.(deepFreeze({phase:message.phase,threadId}));}catch(cause){error=cause;abort();}}
            else if(message.type==='result'){result=message.value;metrics=message.metrics;sourceCache=message.sourceCache;}
            else if(message.type==='failure')error=failure(message.error.code,message.error.message);
        });
        worker.on('error',cause=>{error=cause;});
        worker.once('exit',exitCode=>{
            clearTimeout(deadline);
            signal?.removeEventListener('abort',abort);
            try{onProgress?.(deepFreeze({phase:'exited',threadId,exitCode,cancelled:aborted||!!signal?.aborted}));}catch(cause){error=cause;}
            if(error)reject(error);else if(aborted||signal?.aborted)reject(failure('CANCELLED','Correspondence worker terminated'));
            else if(exitCode!==0||!result)reject(failure('INVALID_INPUT',`Correspondence worker exited without result (${exitCode})`));
            else resolve({result,metrics,sourceCache});
        });
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });
}
function trusted(analysis) {const context=contexts.get(analysis);if(!context)throw failure('INVALID_INPUT','Product-created AnalysisBundle required');return context;}
function bind(result,context,freshness,metrics=result.metrics) {
    const analysis=deepFreeze({...result,freshness,metrics});contexts.set(analysis,context);return analysis;
}
async function listSourceEntries(input) {
    if(!input||Object.keys(input).some(key=>!['registry','sources','sourceSession','signal','onProgress'].includes(key)))
        throw failure('INVALID_INPUT','Source index accepts registered source input only');
    const request=copyRequest(input);cancelled(request.signal);
    const update=beginSourceUpdate(request),start=performance.now();
    try {
        const data=await readEvidence(request);cancelled(request.signal);
        const selected=new Map(data.sources.map(document=>[document.pathRef,document.contentHash]));
        const previous=update?.state.entries.filter(entry=>selected.get(entry.pathRef)===entry.contentHash);
        const {result,metrics,sourceCache}=await runWorker(data,request.signal,request.onProgress,previous,'source-index');
        const freshness=await freshnessOf({documents:data.sources},request.registry);cancelled(request.signal);
        if(update&&!update.state.disposed&&update.revision===update.state.revision)update.state.entries=sourceCache||[];
        return deepFreeze({...result,freshness,metrics:{...metrics,indexMs:performance.now()-start}});
    } finally {update?.finish();}
}
async function attachCorrespondence(input) {
    const start=performance.now();
    const request=copyRequest(input);cancelled(request.signal);
    const update=beginSourceUpdate(request);
    try {
    const data=await readEvidence(request);cancelled(request.signal);
    const selected=new Map(data.sources.map(document=>[document.pathRef,document.contentHash]));
    const previousCache=update?.state.entries.filter(entry=>selected.get(entry.pathRef)===entry.contentHash);
    const {result,metrics,sourceCache}=await runWorker(data,request.signal,request.onProgress,previousCache);cancelled(request.signal);
    const included=result.sourceScope&&new Set(result.sourceScope.included.map(document=>document.pathRef));
    const context={model:request.importResult?.implementation||null,documents:included?data.sources.filter(document=>included.has(document.pathRef)):data.sources,expected:result.correspondence,
        importResult:request.importResult,indexes:null};
    const freshness=await freshnessOf(context,request.registry);
    await Promise.all([...request.generatedRtl,...(request.metadata?[request.metadata]:[])].map(async input=>{
        const actual=await request.registry.readArtifact(input.pathRef);if(actual.contentHash!==input.contentHash)throw failure('ARTIFACT_HASH_MISMATCH','Evidence changed during attachment');
    }));
    cancelled(request.signal);
    const analysis=bind(result,context,freshness,{...result.metrics,...metrics,attachMs:performance.now()-start});
    if(request.bundle)validateBundle(request.bundle,analysis);
    if(update&&!update.state.disposed&&update.revision===update.state.revision)update.state.entries=sourceCache||[];
    return analysis;
    } finally {update?.finish();}
}
async function freshnessOf(context,registry) {
    const documents=await Promise.all(context.documents.map(async d=>{
        const r=await registry.readSource(d);return {pathRef:d.pathRef,contentHash:d.contentHash,revision:d.revision,status:r.status,currentHash:r.currentHash||null};
    }));
    return {status:documents.length===0?'not-attached':documents.every(d=>d.status==='current')?'current':documents.every(d=>['current','captured'].includes(d.status))?'captured':'stale',documents};
}
async function refreshFreshness(analysis,registry) {const context=trusted(analysis);return bind(analysis,context,await freshnessOf(context,registry));}
function validateBundle(value,analysis) {
    const context=trusted(analysis);
    if(value===context.expected)return true;
    const bundle=checkedJson(value);
    validateStructure(bundle,context.model,context.documents);
    if(stable(bundle)!==stable(context.expected))throw failure('CONTRADICTION','Imported claims differ from actual registered source/compiler/RTL/G2 evidence');
    return true;
}
function query(analysis,input,reverse=false) {
    const context=trusted(analysis),q=checkedJson(input||{}),bundle=analysis.correspondence;
    const allowed=['snapshotId','sourceRevision','pathRef','semanticId','occurrenceId','occurrencePath','method','role','targetKind','family','relationKind','limit','mode','entityId','index'];
    if(Object.keys(q).some(k=>!allowed.includes(k)))throw failure('INVALID_INPUT','Unknown query field');
    if(q.index!==undefined&&(!Number.isSafeInteger(q.index)||q.index<0))throw failure('INVALID_INPUT','Invalid query bit index');
    const limit=q.limit===undefined?10000:q.limit;
    if(!Number.isSafeInteger(limit)||limit<1||limit>30000)throw failure('INVALID_INPUT','Query limit must be 1..30000');
    if(q.mode!==undefined&&!['build','current-source'].includes(q.mode))throw failure('INVALID_INPUT','Unknown query mode');
    if(q.snapshotId&&q.snapshotId!==bundle.implementationSnapshotId)throw failure('SNAPSHOT_MISMATCH','Query belongs to another snapshot');
    if(q.sourceRevision&&!isHash(q.sourceRevision))throw failure('INVALID_INPUT','Source revision SHA256 required');
    if(reverse&&(!q.entityId||!context.model?.entities[q.entityId]))throw failure('INVALID_INPUT','Unknown/foreign implementation query ref');
    const scopes=['declaration','contract','connectivity','context','origin'];
    const finish=(resolution,claims=[],candidates=[],unresolved=[],truncated=false)=>deepFreeze({analysisId:analysis.id,correspondenceId:bundle.id,
        snapshotId:bundle.implementationSnapshotId,resolution,claims,candidates,unresolved,freshness:analysis.freshness,truncated,requestedFamily:q.family||null});
    if(q.family&&!scopes.includes(q.family))return finish('unsupported',[],[],[{reason:'unknown-claim-family'}]);
    if(q.mode==='current-source'&&analysis.freshness.status!=='current')return finish('stale',[],[],[{reason:'current-selection-cannot-use-captured-coordinates'}]);
    if(q.sourceRevision&&!bundle.evidenceSet.sources.some(d=>d.revision===q.sourceRevision))return finish('stale',[],[],[{reason:'source-revision-not-in-build'}]);
    if(q.family==='origin')return finish('unmapped',[],[],[{reason:'stock-metadata-has-no-origin-lineage',supported:false}]);
    function sourceMatch(ref) {return (!q.semanticId||ref.semanticId===q.semanticId)&&(!q.occurrenceId||ref.occurrenceId===q.occurrenceId)
        &&(!q.occurrencePath||ref.occurrencePath===q.occurrencePath)&&(!q.pathRef||ref.pathRef===q.pathRef)&&(!q.sourceRevision||ref.revision===q.sourceRevision);}
    // The index lives with the immutable snapshot/evidence context, never with render state.
    if(!context.indexes) {
        const entity=new Map(),source=new Map();
        for(const c of bundle.claims){const target=c.tuple.target.entityId;if(target)entity.set(target,[...(entity.get(target)||[]),c]);
            const id=c.tuple.source.semanticId;source.set(id,[...(source.get(id)||[]),c]);}
        context.indexes={entity,source};
    }
    let pool=reverse?context.indexes.entity.get(q.entityId)||[]:q.semanticId?context.indexes.source.get(q.semanticId)||[]:bundle.claims;
    if(reverse) {
        const selected=context.model.entities[q.entityId];
        if(selected.kind==='cell')pool=selected.pins.flatMap(id=>context.indexes.entity.get(id)||[]);
        else if(['signal-bit','constant','alias','boundary'].includes(selected.kind)) {
            const bits=new Set(selected.kind==='alias'?selected.bits:selected.kind==='boundary'?[selected.formalBitId,selected.actualBitId]:[selected.id]);
            pool=bundle.claims.filter(c=>c.bitId&&bits.has(c.bitId)||c.orderedBindings?.some(b=>bits.has(b.formalBitId)||bits.has(b.actualBitId)));
        }
    }
    const claims=pool.filter(c=>sourceMatch(c.tuple.source)&&(!q.family||c.scope===q.family)&&(!q.method||c.method===q.method)
        &&(!q.role||c.role===q.role)&&(!q.relationKind||c.relationKind===q.relationKind)&&(!q.targetKind||c.tuple.target.objectKind===q.targetKind||c.tuple.target.kind===q.targetKind)
        &&(q.index===undefined||c.tuple.target.index===q.index));
    const matches=reverse?[]:bundle.methods.filter(m=>sourceMatch(m.sourceRef)&&(!q.method||m.method===q.method));
    const candidates=[...new Map((reverse?claims.map(c=>({semanticId:c.tuple.source.semanticId,occurrenceId:c.tuple.source.occurrenceId,occurrencePath:c.tuple.source.occurrencePath})):matches)
        .map(m=>[`${m.semanticId}/${m.occurrenceId}`,m])).values()];
    const occurrenceSet=new Set(claims.map(c=>c.tuple.source.occurrenceId).filter(Boolean));
    const ambiguous=occurrenceSet.size>1&&!q.occurrenceId&&!q.occurrencePath;
    const unresolved=bundle.unresolved.filter(u=>(!q.family||u.family===q.family)&&(!q.semanticId||u.semanticId===q.semanticId)&&(!q.occurrenceId||u.occurrenceId===q.occurrenceId));
    return finish(ambiguous?'ambiguous':claims.length?'resolved':matches.some(m=>m.contextOccurrenceId)?'ambiguous':'unmapped',claims.slice(0,limit),candidates,unresolved,claims.length>limit);
}
const sourceToImplementation=(a,q)=>query(a,q);
const implementationToSource=(a,q)=>query(a,q,true);
function explainMapping(analysis,claimId) {
    trusted(analysis);const bundle=analysis.correspondence,claims=new Map(bundle.claims.map(c=>[c.id,c])),evidence=new Map(bundle.evidence.map(e=>[e.id,e]));
    if(!claims.has(claimId))throw failure('INVALID_INPUT','Unknown claim ID');
    const visited=new Set(),ordered=[];
    function visit(id){if(visited.has(id))return;visited.add(id);const c=claims.get(id);for(const p of c.premises)visit(p);ordered.push(c);}
    visit(claimId);
    return deepFreeze({analysisId:analysis.id,claim:claims.get(claimId),premises:ordered,evidence:[...new Set(ordered.flatMap(c=>c.evidenceRefs))].map(id=>evidence.get(id)),freshness:analysis.freshness,
        limitations:['Connectivity is not compiler-recorded origin','Module-header compiler points are not method bodies']});
}
function getCoverage(analysis) {trusted(analysis);return analysis.correspondence.coverage;}
class CorrespondenceSession extends EventEmitter {
    #revision=0;#refreshRevision=0;#pending=new Set();
    #state=deepFreeze({revision:0,status:'idle',current:null,error:null});
    getState(){return this.#state;}
    #publish(status,current,error=null){this.#state=deepFreeze({revision:this.#revision,status,current,error});this.emit('state',this.#state);}
    attach(input) {
        let request=input,error;try{request=copyRequest(input);}catch(cause){error=cause;}
        const revision=++this.#revision;
        for(const pending of this.#pending)pending.controller.abort();
        const controller=new AbortController(),forward=()=>controller.abort(),signal=error?null:request.signal;
        signal?.addEventListener('abort',forward,{once:true});if(signal?.aborted)controller.abort();
        const entry={controller,promise:null};this.#pending.add(entry);
        const promise=Promise.resolve().then(async()=>{
            try {
                if(error)throw error;
                const result=await attachCorrespondence({...request,signal:controller.signal,onProgress:event=>{
                    this.emit('worker',deepFreeze({revision,...event}));if(revision===this.#revision)request.onProgress?.(event);
                }});
                if(revision!==this.#revision)throw failure('SUPERSEDED','Newer attachment owns publication');
                if(!['current','not-attached'].includes(result.freshness.status))throw failure('STALE_SOURCE','Captured/stale source cannot replace current session mapping');
                this.#publish('ready',result);return result;
            } catch(cause) {
                if(revision!==this.#revision)throw failure('SUPERSEDED','Newer attachment owns publication');
                this.#publish(cause.code==='CANCELLED'?'cancelled':cause.code==='STALE_SOURCE'?'stale':'failed',this.#state.current,{code:cause.code||'INVALID_INPUT',message:cause.message});throw cause;
            } finally {signal?.removeEventListener('abort',forward);this.#pending.delete(entry);}
        });
        entry.promise=promise;this.#publish('attaching',this.#state.current);return promise;
    }
    async cancel(){const pending=[...this.#pending];for(const entry of pending)entry.controller.abort();await Promise.allSettled(pending.map(p=>p.promise));}
    async refresh(registry){const revision=this.#revision,freshnessRevision=++this.#refreshRevision,current=this.#state.current;if(!current)return this.#state;
        const result=await refreshFreshness(current,registry);if(revision===this.#revision&&freshnessRevision===this.#refreshRevision&&this.#state.current===current)
            this.#publish(this.#pending.size?this.#state.status:result.freshness.status==='current'?'ready':'stale',result);return this.#state;}
}
module.exports={attachCorrespondence,sourceToImplementation,implementationToSource,explainMapping,getCoverage,refreshFreshness,validateBundle,
    normalizeRange,listSourceEntries,createSourceSession,createCorrespondenceSession:()=>new CorrespondenceSession()};
