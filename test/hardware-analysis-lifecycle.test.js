'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const hardware = require('../src/hardware');
const { buildSnapshot, withFreshness } = require('../src/hardware/snapshot');
function fixture() {
    const importResult = buildSnapshot(JSON.stringify({ modules: { top: {
        ports: { p: { direction: 'input', bits: [2,3] } }, cells: {
            load: { type: '$not', connections: { A:[2,3], Y:[4,5] }, port_directions:{A:'input',Y:'output'} }
        } } } }), 'lifecycle-synthetic.json', {});
    const api = hardware.createAnalysisQuery({importResult}),model = importResult.implementation,context = api.getContext('stock');
    const input = {kind:'same-net',analysisId:context.analysisId,snapshotId:context.snapshotId,implementationProvider:'stock',
        ownerInstanceId:null,implementationOccurrenceId:model.roots[0],seed:{entityId:Object.values(model.ports)[0].id},
        scope:{kind:'design',rootOccurrenceId:model.roots[0]},queryGeneration:1};
    return {importResult,api,input};
}
// Subscribe before triggering. The timeout is only a bounded failure, never a delay or polling oracle.
function eventWhere(emitter, name, predicate, action = () => {}) {
    return new Promise((resolve,reject) => {
        const timer = setTimeout(() => {emitter.removeListener(name,listener);reject(new Error(`Missing ${name} event`));},5000);
        function listener(value) {
            if (!predicate(value)) return;
            clearTimeout(timer);emitter.removeListener(name,listener);
            try { action(value);resolve(value); } catch(error) { reject(error); }
        }
        emitter.on(name,listener);
    });
}
test('lifecycle validation failure preserves exact current identity and immutable caller request', async () => {
    const {api,input} = fixture(),session = hardware.createAnalysisSession(api);
    const result = await session.query(input);
    const failed = eventWhere(session,'state',s=>s.status==='failed');
    await assert.rejects(session.query({...input,snapshotId:'foreign'}),{code:'SNAPSHOT_MISMATCH'});
    assert.equal((await failed).current,result);
    const mutable = structuredClone(input),promise=session.query(mutable);
    mutable.seed.entityId='foreign'; mutable.scope.rootOccurrenceId='foreign';
    assert.equal((await promise).id,result.id);
    assert.equal(session.getState().current.id,result.id);
});
test('lifecycle cancellation settles only after real worker exit and retains prior current', async () => {
    const {api,input}=fixture(),session=hardware.createAnalysisSession(api),prior=await session.query(input);
    const order=[];let cancellation;
    const exited=eventWhere(session,'worker',e=>e.revision===2&&e.phase==='exited',()=>order.push('exit'));
    const ready=eventWhere(session,'worker',e=>e.revision===2&&e.phase==='ready',()=>{
        order.push('ready');cancellation=session.cancel().then(()=>order.push('cancel-settled'));
    });
    const cancelled=eventWhere(session,'state',s=>s.status==='cancelled',()=>order.push('cancelled-state'));
    const pending=session.query({...input,queryGeneration:2});
    await assert.rejects(pending,error=>error.code==='CANCELLED'&&error.metrics.workerExited&&error.frontier.length===2);
    await ready;const exit=await exited;await cancelled;await cancellation;
    assert.equal(exit.cancelled,true);assert.ok(exit.threadId>0);
    assert.deepEqual(order,['ready','exit','cancelled-state','cancel-settled']);
    assert.equal(session.getState().current,prior);
});
test('lifecycle supersession publishes only latest and reports both actual exits', async () => {
    const {api,input}=fixture(),session=hardware.createAnalysisSession(api),prior=await session.query(input);
    let latest;
    const oldExit=eventWhere(session,'worker',e=>e.revision===2&&e.phase==='exited');
    const latestExit=eventWhere(session,'worker',e=>e.revision===3&&e.phase==='exited');
    const ready=eventWhere(session,'worker',e=>e.revision===2&&e.phase==='ready',()=>{
        latest=session.query({...input,seed:{...input.seed,indices:[1]},queryGeneration:3});
        assert.equal(session.getState().current,prior);
    });
    const pending=session.query({...input,queryGeneration:2});
    await assert.rejects(pending,{code:'SUPERSEDED'});await ready;
    const result=await latest;
    assert.equal((await oldExit).cancelled,true);assert.equal((await latestExit).cancelled,false);
    assert.equal(session.getState().current,result);assert.equal(result.request.queryGeneration,3);
    assert.deepEqual(result.seed.positions.map(p=>p.index),[1]);
});
test('lifecycle deadline is a typed execution failure after exit, retaining current and unresolved seeds', async () => {
    const {api,input}=fixture(),session=hardware.createAnalysisSession(api),prior=await session.query(input);
    const exit=eventWhere(session,'worker',e=>e.revision===2&&e.phase==='exited');
    await assert.rejects(session.query({...input,limits:{timeoutMs:1},queryGeneration:2}),error=>
        error.code==='TIMEOUT'&&error.metrics.workerExited&&error.frontier.every(f=>f.reason==='deadline'));
    assert.equal((await exit).timedOut,true);assert.equal(session.getState().status,'timeout');assert.equal(session.getState().current,prior);
});
test('lifecycle aborted signals and progress observer failures do not publish successful results', async () => {
    const {api,input}=fixture(),session=hardware.createAnalysisSession(api),prior=await session.query(input);
    const controller=new AbortController();controller.abort();
    await assert.rejects(session.query(input,{signal:controller.signal}),{code:'CANCELLED'});
    assert.equal(session.getState().current,prior);
    const exit=eventWhere(session,'worker',e=>e.revision===3&&e.phase==='exited');
    await assert.rejects(session.query(input,{onProgress:e=>{if(e.phase==='ready')throw Object.assign(new Error('observer failed'),{code:'OBSERVER_FAILED'});}}),{code:'OBSERVER_FAILED'});
    await exit;assert.equal(session.getState().current,prior);
});
test('lifecycle reentrant latest query cannot be overwritten by an older state observer', async () => {
    const {api,input}=fixture(),session=hardware.createAnalysisSession(api);let latest;
    const querying=eventWhere(session,'state',s=>s.revision===1&&s.status==='querying',()=>{
        latest=session.query({...input,queryGeneration:2});
    });
    await assert.rejects(session.query(input),{code:'SUPERSEDED'});await querying;
    const result=await latest;assert.equal(session.getState().current,result);assert.equal(session.getState().revision,2);
});
test('lifecycle stale snapshot is explicit and never installed as a valid session result', async () => {
    const {importResult,input}=fixture();
    const stale=withFreshness(importResult,{freshness:'stale',reason:'changed-source'});
    const api=hardware.createAnalysisQuery({importResult:stale}),context=api.getContext('stock');
    const q={...input,analysisId:context.analysisId},result=await api.query(q);
    assert.equal(result.status,'stale');assert.equal(result.availability,'unavailable');
    const session=hardware.createAnalysisSession(api);
    await assert.rejects(session.query(q),{code:'STALE_SOURCE'});assert.equal(session.getState().current,null);assert.equal(session.getState().status,'stale');
});
