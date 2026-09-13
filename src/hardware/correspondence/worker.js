'use strict';
const {parentPort,workerData,threadId}=require('node:worker_threads');
const {performance}=require('node:perf_hooks');
parentPort.postMessage({type:'progress',phase:'started',threadId});
try {
    const {build}=require('./build');
    const {createSourceParseCache,parseSourceDocuments}=require('./source');
    const {buildSourceIndex}=require('./source-entry');
    const start=performance.now(),memory=process.memoryUsage();
    parentPort.postMessage({type:'progress',phase:'building',threadId});
    const parseCache=workerData.sourceCache ? createSourceParseCache(workerData.sourceCache) : null;
    const result=workerData.operation==='source-index'
        ? buildSourceIndex(workerData.sources,parseSourceDocuments(workerData.sources,parseCache)) : build(workerData,parseCache);
    const cache=parseCache?.finish();
    parentPort.postMessage({type:'result',value:result,sourceCache:cache?.entries,metrics:{...cache?.metrics,cpuMs:performance.now()-start,
        heapDeltaBytes:process.memoryUsage().heapUsed-memory.heapUsed,heapUsedBytes:process.memoryUsage().heapUsed,rssBytes:process.memoryUsage().rss}});
} catch(error) {parentPort.postMessage({type:'failure',error:{code:error.code||'INVALID_INPUT',message:error.message,stack:error.stack}});}
parentPort.close();
