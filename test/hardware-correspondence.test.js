'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const hw = require('../src/hardware');
const corr = require('../src/hardware/correspondence');
const { createRunOutput } = require('../experiments/hardware/g4/run-output');
const root = path.resolve(__dirname, '..');
const digest = text => createHash('sha256').update(text).digest('hex');

async function fixture(key = 'A') {
    const sourceRef = `experiments/hardware/fixtures/${{ A:'Connected', B:'Control', C:'Reuse' }[key]}.bsv`;
    const registry = hw.createArtifactRegistry({artifactRoots:[root], sourceRoots:[root]});
    const sourceHash = digest(await fs.readFile(path.join(root, sourceRef)));
    await registry.registerSource({pathRef:sourceRef,path:path.join(root,sourceRef),contentHash:sourceHash,capture:true});
    async function artifact(pathRef) {
        await registry.registerArtifact({pathRef,path:path.join(root,pathRef)});
        return {pathRef,contentHash:digest(await fs.readFile(path.join(root,pathRef)))};
    }
    const design = await artifact(`docs/hardware/evidence/toolchain/${key}/design.json`);
    const metadata = await artifact(`docs/hardware/evidence/bsv/${key}/bluetcl.json`);
    const dir = `docs/hardware/evidence/toolchain/${key}/rtl`;
    const generatedRtl = await Promise.all((await fs.readdir(path.join(root,dir))).filter(n=>n.endsWith('.v')).map(n=>artifact(`${dir}/${n}`)));
    const importResult = await hw.importArtifact({registry,artifactRef:design.pathRef,expectedArtifactHash:design.contentHash});
    return {registry,importResult,sources:[{pathRef:sourceRef,contentHash:sourceHash,revision:sourceHash}],
        metadata:{...metadata,provider:'stock-bluetcl-v1',sourceInputs:[{pathRef:sourceRef,contentHash:sourceHash}]},generatedRtl};
}

test('raw stock -> G2 -> left.get exact vectors and Q contact, never origin', async () => {
    const request = await fixture();
    const before = JSON.stringify(request.importResult);
    const analysis = await corr.attachCorrespondence(request);
    const oracle = JSON.parse(await fs.readFile(path.join(root,'docs/hardware/evidence/bsv/representative-chain.json'),'utf8'));
    const result = corr.sourceToImplementation(analysis,{occurrencePath:'mkConnected.left',method:'get',role:'result',family:'connectivity'});
    assert.equal(result.resolution,'resolved');
    const binding = result.claims.find(c=>c.relationKind==='ordered-port-binding');
    assert.ok(binding);
    assert.deepEqual(binding.orderedBindings.map(b=>b.formalValue),oracle.formalBitsLsbFirst);
    assert.deepEqual(binding.orderedBindings.map(b=>b.actualValue),oracle.actualBitsLsbFirst);
    const pins = result.claims.filter(c=>c.relationKind==='same-net-contact').map(c=>request.importResult.implementation.pins[c.tuple.target.entityId]);
    assert.ok(pins.some(p=>p.name===oracle.childOutputEndpoint.pin && request.importResult.implementation.cells[p.cellId].name===oracle.childOutputEndpoint.cell));
    assert.ok(pins.some(p=>p.name===oracle.parentLeafEndpoints[0].pin && request.importResult.implementation.cells[p.cellId].name===oracle.parentLeafEndpoints[0].cell));
    assert.equal(corr.sourceToImplementation(analysis,{occurrencePath:'mkConnected.left',method:'get',family:'origin'}).resolution,'unmapped');
    assert.equal(corr.sourceToImplementation(analysis,{semanticId:binding.tuple.source.semanticId,family:'connectivity'}).resolution,'ambiguous');
    assert.equal(JSON.stringify(request.importResult),before);
    assert.equal(request.importResult.snapshot.capabilities.originalBsvCorrespondence,false);
    assert.ok(Object.isFrozen(analysis.correspondence.claims));
    assert.notEqual(analysis.id,analysis.correspondence.id);
    assert.equal(corr.validateBundle(JSON.parse(JSON.stringify(analysis.correspondence)),analysis),true);
});

module.exports = { fixture, digest, root };


test('A/B/C measured attach; reused widths, wrapper forwarding and inline containing contexts remain distinct', async () => {
    for(const key of ['A','B','C']) {
        const request=await fixture(key),analysis=await corr.attachCorrespondence(request);
        assert.ok(analysis.correspondence.methods.some(m=>m.signals.length));
        assert.equal(analysis.correspondence.claims.filter(c=>c.scope==='origin').length,0);
        assert.equal(analysis.correspondence.coverage.origin.knownContributors,0);
        assert.equal(corr.validateBundle(JSON.parse(JSON.stringify(analysis.correspondence)),analysis),true);
        if(key==='C') {
            const narrow=analysis.correspondence.methods.find(m=>m.occurrencePath==='mkReuse.narrow'&&m.method==='get');
            const wide=analysis.correspondence.methods.find(m=>m.occurrencePath==='mkReuse.wide'&&m.method==='get');
            assert.equal(narrow.signals.find(s=>s.role==='result').width,8);
            assert.equal(wide.signals.find(s=>s.role==='result').width,12);
            assert.equal(narrow.body,null);assert.equal(wide.body,null);
            assert.equal(narrow.forwardingSource.range.text,'return implementation;');
            assert.notEqual(narrow.implementationOccurrenceId,wide.implementationOccurrenceId);
            const inline=analysis.correspondence.contexts.filter(c=>c.occurrencePath.endsWith('.implementation'));
            assert.equal(inline.length,2);
            assert.deepEqual(inline.map(c=>c.implementationOccurrenceId),[null,null]);
            assert.ok(inline.every(c=>c.contextOccurrenceId&&c.ownedCellIds.length===0));
            const reused=corr.sourceToImplementation(analysis,{semanticId:'def:Reuse:mkWidth.get',family:'connectivity'});
            assert.equal(reused.resolution,'ambiguous');assert.equal(reused.candidates.length,2);assert.equal(reused.claims.length,0);
        }
    }
});

test('Unicode scalar, byte, codepoint, UTF16 positions with CRLF and literal tabs roundtrip exactly', () => {
    const text='\t한😀e\u0301\r\n끝';
    const a=corr.normalizeRange(text,{unit:'utf16',start:1,end:6});
    assert.equal(a.text,'한😀e\u0301');
    assert.deepEqual(a.utf8,{start:1,end:11});assert.deepEqual(a.codepoint,{start:1,end:5});
    assert.deepEqual(corr.normalizeRange(text,{unit:'utf8',start:1,end:11}),a);
    assert.deepEqual(corr.normalizeRange(text,{unit:'codepoint',start:1,end:5}),a);
    assert.deepEqual(corr.normalizeRange(text,{unit:'position',encoding:'utf16',base:0,start:{line:0,column:1},end:{line:0,column:6}}),a);
    assert.equal(corr.normalizeRange(text,{unit:'position',encoding:'codepoint',base:1,start:{line:1,column:2},end:{line:2,column:2}}).text,'한😀e\u0301\r\n끝');
    for(const range of [{unit:'utf16',start:3,end:4},{unit:'utf8',start:2,end:4},{unit:'utf16',start:0,end:99},
        {unit:'utf16',start:2,end:1},{unit:'utf16',start:0,end:1,endInclusive:true},{unit:'guess',start:0,end:1},
        {unit:'position',encoding:'utf16',base:1,start:{line:1,column:9},end:{line:1,column:9}}])assert.throws(()=>corr.normalizeRange(text,range));
});


async function stagedFixture(t, mutate={}) {
    const os=require('node:os');
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'g3a-corr-'));
    t.after(()=>fs.rm(dir,{recursive:true,force:true}));
    const sourceRef='experiments/hardware/fixtures/Connected.bsv';
    const metadataRef='docs/hardware/evidence/bsv/A/bluetcl.json';
    const designRef='docs/hardware/evidence/toolchain/A/design.json';
    const rtlRefs=['mkConnected','mkStage'].map(n=>`docs/hardware/evidence/toolchain/A/rtl/${n}.v`);
    for(const ref of [sourceRef,metadataRef,designRef,...rtlRefs]) {
        let text=await fs.readFile(path.join(root,ref),'utf8');
        if(ref===sourceRef&&mutate.source)text=mutate.source(text);
        if(ref===metadataRef&&mutate.metadata){const json=JSON.parse(text);mutate.metadata(json);text=JSON.stringify(json);}
        if(ref===designRef&&mutate.design){const json=JSON.parse(text);mutate.design(json);text=JSON.stringify(json);}
        if(rtlRefs.includes(ref)&&mutate.rtl)text=mutate.rtl(text,ref);
        await fs.mkdir(path.dirname(path.join(dir,ref)),{recursive:true});await fs.writeFile(path.join(dir,ref),text);
    }
    const registry=hw.createArtifactRegistry({artifactRoots:[dir],sourceRoots:[dir]});
    const sourceHash=digest(await fs.readFile(path.join(dir,sourceRef)));
    await registry.registerSource({pathRef:sourceRef,path:path.join(dir,sourceRef),contentHash:sourceHash,capture:true});
    async function register(pathRef){await registry.registerArtifact({pathRef,path:path.join(dir,pathRef)});return {pathRef,contentHash:digest(await fs.readFile(path.join(dir,pathRef)))};}
    const design=await register(designRef),metadata=await register(metadataRef),generatedRtl=await Promise.all(rtlRefs.map(register));
    return {dir,request:{registry,importResult:await hw.importArtifact({registry,artifactRef:designRef,expectedArtifactHash:design.contentHash}),
        sources:[{pathRef:sourceRef,contentHash:sourceHash,revision:sourceHash}],metadata:{...metadata,provider:'stock-bluetcl-v1',sourceInputs:[{pathRef:sourceRef,contentHash:sourceHash}]},generatedRtl}};
}
const clone=value=>JSON.parse(JSON.stringify(value));
const fails=async(promise,code)=>assert.rejects(promise,error=>code?error.code===code:typeof error.code==='string');

test('forward/reverse/explanation preserve occurrence and evidence scope without render state', async () => {
    const request=await fixture(),analysis=await corr.attachCorrespondence(request);
    const left=corr.sourceToImplementation(analysis,{occurrencePath:'mkConnected.left',method:'get',role:'result',family:'connectivity'});
    const right=corr.sourceToImplementation(analysis,{occurrencePath:'mkConnected.right',method:'get',role:'result',family:'connectivity'});
    assert.equal(right.resolution,'resolved');
    assert.notEqual(left.claims[0].tuple.target.entityId,right.claims[0].tuple.target.entityId);
    const contact=left.claims.find(c=>c.relationKind==='same-net-contact');
    const reverse=corr.implementationToSource(analysis,{entityId:contact.tuple.target.entityId,family:'connectivity',occurrencePath:'mkConnected.left'});
    assert.ok(reverse.claims.some(c=>c.id===contact.id));
    const explanation=corr.explainMapping(analysis,contact.id);
    assert.ok(explanation.premises.some(c=>c.relationKind==='method-port-contract'));
    assert.ok(explanation.premises.some(c=>c.relationKind==='generated-port'));
    assert.ok(explanation.premises.some(c=>c.relationKind==='ordered-port-binding'));
    assert.ok(explanation.evidence.some(e=>e.kind==='source-range'&&e.range.text==='method Bit#(8) get = state;'));
    const sourceText=await fs.readFile(path.join(root,request.sources[0].pathRef),'utf8');
    assert.ok(explanation.evidence.some(e=>e.kind==='compiler-record'&&e.point?.range.start===sourceText.indexOf('mkStage')));
    assert.ok(explanation.evidence.some(e=>e.kind==='generated-rtl'&&e.range.text==='output [7 : 0] get;'));
    assert.equal(corr.sourceToImplementation(analysis,{...{occurrencePath:'mkConnected.left',method:'get'},limit:1}).truncated,true);
    assert.throws(()=>corr.sourceToImplementation(analysis,{snapshotId:'another-snapshot'}),{code:'SNAPSHOT_MISMATCH'});
    assert.throws(()=>corr.implementationToSource(analysis,{entityId:contact.tuple.target.entityId.replace(analysis.implementationSnapshotId,'other')}),{code:'INVALID_INPUT'});
    assert.equal(corr.sourceToImplementation(analysis,{sourceRevision:'0'.repeat(64)}).resolution,'stale');
});

test('source-only and implementation-only remain usable; unrelated source never produces an origin', async () => {
    const request=await fixture();
    const source=await corr.attachCorrespondence({registry:request.registry,sources:request.sources});
    assert.equal(source.implementationSnapshotId,null);
    assert.ok(corr.sourceToImplementation(source,{family:'declaration'}).claims.length>0);
    assert.equal(corr.sourceToImplementation(source,{family:'origin'}).claims.length,0);
    const implementation=await corr.attachCorrespondence({registry:request.registry,importResult:request.importResult});
    assert.equal(implementation.correspondence.claims.length,0);
    assert.equal(implementation.implementationSnapshotId,request.importResult.snapshot.id);
    assert.equal(hw.getPorts(request.importResult.implementation,request.importResult.implementation.roots[0]).length,7);
});

test('wrong descriptors, hashes, revisions, providers and untrusted exact sidecars reject', async () => {
    const request=await fixture();
    for(const key of ['metadata','rtl','source','revision','provider','library','absolute','traversal','extra']) {
        const q={...request,sources:clone(request.sources),metadata:clone(request.metadata),generatedRtl:clone(request.generatedRtl)};
        if(key==='metadata')q.metadata.contentHash='0'.repeat(64);
        if(key==='rtl')q.generatedRtl[0].contentHash='0'.repeat(64);
        if(key==='source')q.sources[0].contentHash='0'.repeat(64);
        if(key==='revision')q.sources[0].revision='0'.repeat(64);
        if(key==='provider')q.metadata.provider='custom-exact-origin';
        if(key==='library')q.metadata.sourceInputs.push({pathRef:'library/Foreign.bsv',contentHash:'0'.repeat(64)});
        if(key==='absolute')q.metadata.pathRef='/etc/passwd';
        if(key==='traversal')q.metadata.pathRef='../outside';
        if(key==='extra')q.annotations=[{status:'exact',scope:'origin'}];
        await fails(corr.attachCorrespondence(q));
    }
    const unregistered={...request,metadata:{...request.metadata,pathRef:'unregistered/metadata.json'}};
    await fails(corr.attachCorrespondence(unregistered),'PATH_DENIED');
    await fails(corr.attachCorrespondence({...request,bundle:{schemaVersion:1,status:'exact',claims:[{scope:'origin'}]}}));
    await fails(corr.attachCorrespondence({...request,metadata:JSON.parse('{"__proto__":{"status":"exact"}}')}),'INVALID_INPUT');
    await fails(corr.attachCorrespondence({...request,sources:Array(257).fill(request.sources[0])}),'LIMIT_EXCEEDED');
    let deep={};for(let i=0;i<70;i++)deep={next:deep};
    await fails(corr.attachCorrespondence({...request,bundle:deep}),'LIMIT_EXCEEDED');
});

test('explicit raw metadata, source identity, RTL and ordered bit contradictions reject rather than becoming unknown', async t => {
    const mutations=[
        {metadata:m=>{m.modules[0].methods[1].result='put_value';}},
        {metadata:m=>{m.hierarchy[1].Name='right';}},
        {metadata:m=>{m.hierarchy.push({...m.hierarchy[1]});}},
        {metadata:m=>{m.hierarchy[1].parent=999;}},
        {metadata:m=>{m.hierarchy[1].parent=m.hierarchy[1].key;}},
        {metadata:m=>{m.modules[0].definitionPosition[1]='11';const r=m.records.find(r=>r.command[0]==='Bluetcl::bpackage'&&r.command[2]==='Connected::mkStage');r.result=r.result.replace('10 8','11 8');}},
        {metadata:m=>{m.schema='unknown-v2';}},
        {source:s=>s.replace('module mkStage(Stage);','module mkOther(Stage);')},
        {source:s=>s.replace('method Bit#(8) get = state;','method Bit#(9) get = state;')},
        {rtl:(s,ref)=>ref.endsWith('mkStage.v')?s.replace('output [7 : 0] get;','output [6 : 0] get;'):s},
        {rtl:(s,ref)=>ref.endsWith('mkConnected.v')?s.replace('.get(left$get)','.get(right$get)'):s},
        {design:m=>{[m.modules.mkStage.ports.get.bits[0],m.modules.mkStage.ports.get.bits[1]]=[m.modules.mkStage.ports.get.bits[1],m.modules.mkStage.ports.get.bits[0]];}},
        {design:m=>{m.modules.mkConnected.cells.left.connections.get[0]=m.modules.mkConnected.cells.left.connections.get[1];}},
        {design:m=>{m.modules.mkStage.attributes.src='unregistered/foreign.v:1.1-2.1';}},
        {design:m=>{m.modules.mkStage.netnames.get.attributes.src=m.modules.mkStage.netnames.RDY_get.attributes.src;}},
        {metadata:m=>{m.hierarchy[1].Interface='Unregistered::Stage';m.records.find(r=>r.command[0]==='Bluetcl::browseinst'&&r.command[1]==='detail'&&r.command[2]==='2').result=m.records.find(r=>r.command[0]==='Bluetcl::browseinst'&&r.command[1]==='detail'&&r.command[2]==='2').result.replace('Interface Connected::Stage','Interface Unregistered::Stage');}},
        {metadata:m=>{m.records.find(r=>r.command[0]==='Bluetcl::bpackage'&&r.command[2]==='Connected::mkStage').command[2]='Unregistered::mkStage';}}
    ];
    for(const [index,mutation] of mutations.entries())await t.test(`negative capture ${index}`,async st=>{
        const {request}=await stagedFixture(st,mutation);await fails(corr.attachCorrespondence(request));
    });
});

test('bundle validation rejects dangling/duplicate/contradictory refs, cycles, bits, width, occurrence, provider and Unicode ranges', async () => {
    const request=await fixture(),analysis=await corr.attachCorrespondence(request);
    const mutations=[b=>b.schemaVersion=2,b=>b.providers[0].authority='instrumented-compiler',
        b=>b.claims.push(clone(b.claims[0])),b=>b.claims[0].premises.push('dangling'),b=>b.claims[0].premises.push(b.claims[0].id),
        b=>b.claims[0].tuple.source.range.end=999999,b=>b.claims[0].tuple.source.revision='0'.repeat(64),
        b=>b.claims[0].tuple.source.range.unit='utf8',b=>b.implementationSnapshotId='another',
        b=>b.claims.find(c=>c.relationKind==='ordered-port-binding').orderedBindings.reverse(),
        b=>{const c=b.claims.find(c=>c.relationKind==='ordered-port-binding');c.orderedBindings[0]=clone(c.orderedBindings[1]);},
        b=>b.claims.find(c=>c.relationKind==='ordered-port-binding').orderedBindings.pop(),
        b=>b.claims.find(c=>c.relationKind==='same-net-contact').tuple.target.occurrenceId='other',
        b=>b.claims[0].scope='origin',b=>b.claims[0].tuple.source.semanticId='same-name-but-unrelated',
        b=>b.evidence[0].contentHash='0'.repeat(64)];
    for(const mutation of mutations){const b=clone(analysis.correspondence);mutation(b);assert.throws(()=>corr.validateBundle(b,analysis));}
    const b=clone(analysis.correspondence);
    b.claims[0].tuple.source.semanticId='unrelated-location-with-valid-source-hash';
    const {stable}=require('../src/hardware/json');
    const ids=new Map();
    for(const claim of b.claims){const old=claim.id;claim.premises=claim.premises.map(id=>ids.get(id)||id);delete claim.id;claim.id=`claim-${digest(stable(claim))}`;ids.set(old,claim.id);}
    delete b.id;b.id=`correspondence-${digest(stable(b))}`;
    assert.throws(()=>corr.validateBundle(b,analysis),{code:'CONTRADICTION'});
});

test('freshness retains captured coordinates; session rejects stale attachment atomically; artifact symlink replacement is denied', async t => {
    const {dir,request}=await stagedFixture(t);
    const session=corr.createCorrespondenceSession(),analysis=await session.attach(request),before=JSON.stringify(request.importResult);
    const sourcePath=path.join(dir,request.sources[0].pathRef);
    await fs.writeFile(sourcePath,'// changed revision\n'+await fs.readFile(sourcePath,'utf8'));
    const refreshed=await corr.refreshFreshness(analysis,request.registry);
    assert.equal(refreshed.id,analysis.id);assert.equal(refreshed.correspondence.id,analysis.correspondence.id);
    assert.equal(refreshed.freshness.status,'captured');
    assert.equal(corr.sourceToImplementation(refreshed,{mode:'current-source',method:'get'}).resolution,'stale');
    const historical=corr.sourceToImplementation(refreshed,{mode:'build',occurrencePath:'mkConnected.left',method:'get',family:'connectivity'});
    assert.equal(historical.resolution,'resolved');
    assert.ok(historical.claims.every(c=>c.tuple.source.revision===request.sources[0].revision));
    await fails(session.attach(request),'STALE_SOURCE');assert.equal(session.getState().current,analysis);
    assert.equal(JSON.stringify(request.importResult),before);
    const other=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'g3a-outside-'));t.after(()=>fs.rm(other,{recursive:true,force:true}));
    const external=path.join(other,'metadata.json');await fs.writeFile(external,'{}');
    const target=path.join(dir,request.metadata.pathRef);await fs.unlink(target);await fs.symlink(external,target);
    await fails(corr.attachCorrespondence(request),'PATH_DENIED');
    const escape=path.join(dir,'escape.bsv');await fs.symlink(external,escape);
    await fails(request.registry.registerSource({pathRef:'escape.bsv',path:escape,contentHash:digest('{}')}),'PATH_DENIED');
});

test('same-name source documents/revisions are not selected by first match', async t => {
    const {dir,request}=await stagedFixture(t);
    const pathRef='library/Connected.bsv',file=path.join(dir,pathRef),text=await fs.readFile(path.join(dir,request.sources[0].pathRef),'utf8');
    await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);
    await request.registry.registerSource({pathRef,path:file,contentHash:digest(text)});
    await fails(corr.attachCorrespondence({registry:request.registry,sources:[...request.sources,{pathRef,contentHash:digest(text),revision:digest(text)}]}),'AMBIGUOUS_SOURCE');
});


function waitEvent(emitter,name,predicate) {
    return new Promise((resolve,reject)=>{
        const timeout=AbortSignal.timeout(10000);
        const cleanup=()=>{emitter.off(name,listener);timeout.removeEventListener('abort',abort);};
        const listener=event=>{if(predicate(event)){cleanup();resolve(event);}};
        const abort=()=>{cleanup();reject(new Error(`Bounded wait for ${name} timed out`));};
        emitter.on(name,listener);timeout.addEventListener('abort',abort,{once:true});
    });
}
async function stressFixture(t) {
    const dir=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'g3a-stress-'));
    t.after(()=>fs.rm(dir,{recursive:true,force:true}));
    const count=120;
    const text='package Stress;\n// 한글 😀 e\u0301\r\ninterface Sample; method Bit#(8) get; endinterface\n'+
        Array.from({length:count},(_,i)=>`module mkBlock${i}(Sample);\n method Bit#(8) get = ${i%256};\nendmodule\n`).join('')+'endpackage\n';
    const pathRef='Stress.bsv',file=path.join(dir,pathRef),contentHash=digest(text);
    await fs.writeFile(file,text);
    const registry=hw.createArtifactRegistry({artifactRoots:[dir],sourceRoots:[dir]});
    await registry.registerSource({pathRef,path:file,contentHash,capture:true});
    return {request:{registry,sources:[{pathRef,contentHash,revision:contentHash}]},population:{kind:'synthetic-source-parser-stress',moduleDefinitions:count,bytes:Buffer.byteLength(text),contentHash}};
}

test('active worker cancellation observes termination and atomic supersession preserves G2 and prior analysis', async t => {
    const {performance}=require('node:perf_hooks');
    const request=await fixture(),stress=await stressFixture(t),session=corr.createCorrespondenceSession();
    const original=await session.attach(request),before=JSON.stringify(request.importResult),events=[];
    session.on('worker',e=>events.push(e));
    const exit=waitEvent(session,'worker',e=>e.phase==='exited'&&e.revision===2);
    let cancelPromise=null,cancelStarted=0;
    const pending=session.attach({...stress.request,onProgress:e=>{
        if(e.phase==='building'){cancelStarted=performance.now();cancelPromise=session.cancel();}
    }});
    const cancelled=fails(pending,'CANCELLED');
    const terminated=await exit;await cancelled;await cancelPromise;
    const cancelMs=performance.now()-cancelStarted;
    assert.equal(terminated.cancelled,true);assert.ok(terminated.threadId>0);
    assert.equal(session.getState().current,original);assert.equal(session.getState().status,'cancelled');
    assert.equal(events.filter(e=>e.revision===2&&e.phase==='exited').length,1);
    const supersededExit=waitEvent(session,'worker',e=>e.phase==='exited'&&e.revision===3);
    let replacement=null;
    const first=session.attach({...stress.request,onProgress:e=>{if(e.phase==='building')replacement=session.attach(request);}});
    const firstFailure=fails(first,'SUPERSEDED');
    const exited=await supersededExit;await firstFailure;
    assert.equal(exited.cancelled,true);const latest=await replacement;
    assert.equal(session.getState().current,latest);assert.equal(session.getState().revision,4);
    assert.equal(latest.correspondence.id,original.correspondence.id);
    assert.equal(JSON.stringify(request.importResult),before);
    const already=new AbortController();already.abort();await fails(session.attach({...request,signal:already.signal}),'CANCELLED');
    assert.equal(session.getState().current,latest);
    const output=await createRunOutput(root,'correspondence-cancellation');
    t.diagnostic(`Run output: ${path.relative(root,output)}`);
    await fs.writeFile(path.join(output,'cancellation.json'),JSON.stringify({cancelMs,terminated,supersededExit:exited,
        events,stress:stress.population,previousAnalysisPreserved:true,g2BytesPreserved:true},null,2));
});

test('actual A/B/C and explicit source stress attach/query/memory receipt through product API', async t => {
    const {performance}=require('node:perf_hooks');
    const output=await createRunOutput(root,'correspondence-measurements');
    t.diagnostic(`Run output: ${path.relative(root,output)}`);
    const rows=[];
    for(const key of ['A','B','C','stress']) {
        const stress=key==='stress'?await stressFixture(t):null;
        const request=stress?stress.request:await fixture(key);
        const before=process.memoryUsage(),start=performance.now();
        const analysis=await corr.attachCorrespondence(request),attachMs=performance.now()-start;
        const times=[],selected=analysis.correspondence.methods.find(m=>m.body);
        assert.ok(selected);
        for(let i=0;i<100;i++){
            const started=performance.now();
            const query=corr.sourceToImplementation(analysis,{semanticId:selected.semanticId,...(stress?{}:{occurrencePath:selected.occurrencePath}),
                family:stress?'declaration':'connectivity'});
            times.push(performance.now()-started);assert.ok(query.claims.length>0);
        }
        times.sort((a,b)=>a-b);
        const row={key,population:stress?.population||{kind:'actual-stock-capture',sourceFiles:request.sources.length,
            implementationOccurrences:Object.keys(request.importResult.implementation.occurrences).length},analysisId:analysis.id,
            correspondenceId:analysis.correspondence.id,attachMs,queryCount:100,queryP50Ms:times[50],queryP95Ms:times[95],
            hostHeapDeltaBytes:process.memoryUsage().heapUsed-before.heapUsed,rssBytes:process.memoryUsage().rss,worker:analysis.metrics,
            evidenceSet:analysis.correspondence.evidenceSet,coverage:analysis.correspondence.coverage};
        rows.push(row);
        if(key!=='stress') {
            await fs.writeFile(path.join(output,`${key}-bundle.json`),JSON.stringify(analysis.correspondence,null,2));
            const q=corr.sourceToImplementation(analysis,{occurrencePath:key==='A'?'mkConnected.left':selected.occurrencePath,
                method:key==='A'?'get':selected.method,family:'connectivity'});
            await fs.writeFile(path.join(output,`${key}-query.json`),JSON.stringify(q,null,2));
        }
    }
    await fs.writeFile(path.join(output,'measurements.json'),JSON.stringify({schemaVersion:1,node:process.version,
        platform:process.platform,arch:process.arch,rows,scope:'Actual three small captures and 120-module source-parser stress only; no broad large-design, render, animation or compiler performance claim'},null,2));
});

test('relocation is hash/logical-ref stable; explicit registered artifact modifications cannot retain old analysis identity', async t => {
    const original=await fixture(),relocated=await stagedFixture(t);
    const a=await corr.attachCorrespondence(original),b=await corr.attachCorrespondence(relocated.request);
    assert.equal(a.correspondence.id,b.correspondence.id);assert.equal(a.id,b.id);
    assert.equal(JSON.stringify(b.correspondence).includes(relocated.dir),false);
    const fake=clone(original.importResult);const pin=Object.values(fake.implementation.pins)[0];pin.rawBits.reverse();
    const {deepFreeze}=require('../src/hardware/json');
    await fails(corr.attachCorrespondence({...original,importResult:deepFreeze(fake)}),'CONTRADICTION');
});


test('missing captured source never relocates stale coordinates; malformed lifecycle options are typed failures', async t => {
    const {dir,request}=await stagedFixture(t);
    const registry=hw.createArtifactRegistry({artifactRoots:[dir],sourceRoots:[dir]});
    const source=request.sources[0],file=path.join(dir,source.pathRef);
    await registry.registerSource({pathRef:source.pathRef,path:file,contentHash:source.contentHash,capture:false});
    const sourceRequest={registry,sources:request.sources};
    const session=corr.createCorrespondenceSession(),current=await session.attach(sourceRequest);
    await fs.writeFile(file,'changed');
    await fails(session.attach(sourceRequest),'STALE_SOURCE');assert.equal(session.getState().current,current);
    const refreshed=await corr.refreshFreshness(current,registry);assert.equal(refreshed.freshness.status,'stale');
    assert.equal(corr.sourceToImplementation(refreshed,{mode:'current-source'}).claims.length,0);
    for(const bad of [null,undefined,0,[],{...sourceRequest,signal:{}},{...sourceRequest,onProgress:'not-a-function'}]) {
        await fails(session.attach(bad),'INVALID_INPUT');assert.equal(session.getState().current,current);
    }
});
