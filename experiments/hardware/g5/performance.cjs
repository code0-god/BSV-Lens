'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCatalog } = require('../g4/server');
const { loadCapturedCase } = require('../g3/query');
const { createAnalysisQuery, createAnalysisSession } = require('../../../src/hardware/analysis');
const { layout } = require('../../../media/hardware-layout');
const { requests } = require('./delivery-replay.cjs');
async function run() {
    const memoryBefore = process.memoryUsage(), start = performance.now(), catalog = await createCatalog();
    const preparationMs = performance.now() - start, rows = [], layouts = [];
    for (const { buildId, input } of await requests(catalog)) {
        const query = catalog.find(q => q.getCatalogEntry().buildId === buildId), start = performance.now();
        const result = await query.analyze(input);
        rows.push({ buildId, kind: input.kind, request: input, resultId: result.id, status: result.status,
            elapsedMs: performance.now() - start, metrics: result.metrics, memory: process.memoryUsage() });
    }
    for (const query of catalog) {
        const entry = query.getCatalogEntry();
        const scene = query.getScene({ buildId: entry.buildId, snapshotId: entry.snapshotId, ownerInstanceId: entry.rootInstanceId,
            rootInstanceId: entry.rootInstanceId, sceneKind: 'bsv', implementationProvider: 'stock', queryGeneration: 1 }).scene;
        const start = performance.now(), geometry = layout(scene, {width:1100,height:650});
        layouts.push({buildId:entry.buildId,elapsedMs:performance.now()-start,nodes:geometry.nodes.length,routes:geometry.routes.length});
    }
    const stock = await loadCapturedCase('A'), api = createAnalysisQuery({importResult:stock.request.importResult});
    const context = api.getContext(), model = stock.request.importResult.implementation, port = Object.values(model.ports).find(p=>p.bits.length);
    const input = {kind:'same-net',analysisId:context.analysisId,snapshotId:context.snapshotId,implementationProvider:'stock',
        implementationOccurrenceId:port.occurrenceId,ownerInstanceId:null,seed:{entityId:port.id},
        scope:{kind:'design',rootOccurrenceId:model.roots[0]},queryGeneration:1};
    const session = createAnalysisSession(api), previous = await session.query(input), order = [];
    let cancelled, cancelStart, cancelExit;
    session.on('worker', event => {
        if(event.revision!==2)return;
        if(event.phase==='ready'){cancelStart=performance.now();order.push('ready');cancelled=session.cancel().then(()=>order.push('settled'));}
        if(event.phase==='exited'){cancelExit=performance.now();order.push('exit');}
    });
    await assert.rejects(session.query({...input,queryGeneration:2}),e=>e.code==='CANCELLED'&&e.metrics.workerExited);
    await cancelled;
    assert.deepEqual(order,['ready','exit','settled']);assert.equal(session.getState().current,previous);
    const report={schema:'g5-performance-v1',environment:{node:process.version,platform:process.platform,arch:process.arch,
        cpus:os.cpus().length,cpu:os.cpus()[0].model,totalMemoryBytes:os.totalmem()},preparationMs,memoryBefore,
        memoryAfter:process.memoryUsage(),maxRSSKiB:process.resourceUsage().maxRSS,queries:rows,layouts,
        cancellation:{status:'pass',workerExitMs:cancelExit-cancelStart,settlementMs:performance.now()-cancelStart,order},
        caveat:'Single local recorded execution; process RSS, not per-query peak or large-design certification.'};
    assert.ok(process.env.G5_OUTPUT_DIR,'Run through g5/run.cjs');
    const file=path.join(process.env.G5_OUTPUT_DIR,'performance.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({file,queries:rows.length,preparationMs,cancellation:report.cancellation,maxRSSKiB:report.maxRSSKiB}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
