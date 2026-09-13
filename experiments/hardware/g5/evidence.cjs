'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectFiles } = require('../../../scripts/zip');
const { hash } = require('../g4/validate-delivery');
const root = path.resolve(__dirname, '../../..');
function collect({ queriesDirectory, browserDirectory, runs = [], baseline }) {
    const queryIndex = JSON.parse(fs.readFileSync(path.join(queriesDirectory, 'index.json')));
    const browser = JSON.parse(fs.readFileSync(path.join(browserDirectory, 'receipt.json')));
    assert.equal(browser.status, 'pass');
    assert.deepEqual(browser.journeys.map(j => j.id).sort(), Array.from({length:15}, (_,i) => 'J'+String(i+1).padStart(2,'0')));
    for (const input of browser.runtimeInputs) assert.equal(hash(fs.readFileSync(path.join(root,input.path))), input.sha256, 'Browser runtime changed: '+input.path);
    const parent = path.join(root,'docs/hardware/evidence/g5');
    fs.mkdirSync(parent,{recursive:true});
    const directory=fs.mkdtempSync(path.join(parent,'run-')), files=[];
    function copy(source, relative) {
        assert.ok(relative && !path.isAbsolute(relative) && relative.split('/').every(p=>p && p!=='.' && p!=='..'));
        const data=fs.readFileSync(source), target=path.join(directory,relative);
        fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,data,{flag:'wx'});
        const item={path:relative,bytes:data.length,sha256:hash(data)};
        if(relative.endsWith('.png')) { assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a'); item.width=data.readUInt32BE(16); item.height=data.readUInt32BE(20); }
        assert.equal(hash(fs.readFileSync(target)),item.sha256); files.push(item);
    }
    for(const file of queryIndex.files) {
        const name=path.join(queriesDirectory,file.path), data=fs.readFileSync(name);
        assert.equal(data.length,file.bytes);assert.equal(hash(data),file.sha256);copy(name,'queries/'+file.path);
    }
    for(const entry of collectFiles(browserDirectory)) copy(path.join(browserDirectory,entry.name),'browser/'+entry.name);
    for(const [label,directory] of runs) {
        assert.match(label,/^[a-z0-9-]+$/);
        for(const entry of collectFiles(directory)) copy(path.join(directory,entry.name),'checks/'+label+'/'+entry.name);
    }
    if(baseline) copy(baseline,'baseline.json');
    const index={schema:'g5-evidence-v1',files,queries:queryIndex.queries.map(q=>({...q,request:'queries/'+q.request,result:'queries/'+q.result,receipt:'queries/'+q.receipt})),
        browser:{status:'pass',interaction:'real-pointer-keyboard',trace:'browser/trace.zip',receipt:'browser/receipt.json',captures:browser.screenshots.map(p=>'browser/'+p)},
        nativeVsCode:'NOT RUN',liveCompilerReplay:'NOT RUN',userVisualDesignAcceptance:'PENDING'};
    fs.writeFileSync(path.join(directory,'index.json'),JSON.stringify(index,null,2)+'\n',{flag:'wx'});
    return {directory,files:files.length,queries:index.queries.length,captures:index.browser.captures.length};
}
if(require.main===module) {
    const [queriesDirectory,browserDirectory,baseline,...rest]=process.argv.slice(2);
    assert.ok(queriesDirectory&&browserDirectory&&baseline&&rest.length%2===0,'Usage: evidence.cjs QUERIES BROWSER BASELINE [LABEL RUN_DIRECTORY...]');
    const runs=[];for(let i=0;i<rest.length;i+=2)runs.push([rest[i],rest[i+1]]);
    console.log(JSON.stringify(collect({queriesDirectory,browserDirectory,baseline,runs}),null,2));
}
module.exports={collect};
