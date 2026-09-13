'use strict';
const fs = require('node:fs'), path = require('node:path');
const { launchNative } = require('./native-driver.cjs');
const { runAcceptance } = require('./native-acceptance.cjs');
const { captureNative } = require('./native-oracle.cjs');
const { loadNativeInput } = require('../../../src/hardware/native-input');
const { createArchitecture } = require('../../../src/hardware/architecture');
const { createRun } = require('./run.cjs');
async function main() {
    const [vsix, fixturePath, observerVsix] = process.argv.slice(2), output = process.env.G6_OUTPUT_DIR || createRun('fit-probe');
    const fixtures = JSON.parse(fs.readFileSync(fixturePath));
    for (const fixture of Object.values(fixtures.fixtures)) {
        const input = await loadNativeInput({sourceRoot:fixtures.workspace,artifactRoot:fixtures.workspace,manifest:fixture.manifest,originApproved:true});
        fixture.authority={architecture:createArchitecture({importResult:input.importResult,analysis:input.analysis}),models:{stock:input.importResult.implementation,instrumented:input.originCase.request.importResult.implementation}};
    }
    const native = await launchNative({vsix,observerVsix,workspace:fixtures.workspace,output});
    try {
        await native.channel.request('openProductCommand',{command:'bsvArchitecture.openHardwareSchematic'});
        const {frame,page}=await native.findWebview(); let initialError=null;
        try { await runAcceptance({native,frame,page,fixtures:fixtures.fixtures,output}); } catch(error) {initialError=error.message;}
        if(!initialError?.includes('N08-narrow')) throw new Error(initialError || 'Expected narrow failure not reached');
        const before=await frame.evaluate(()=>window.bsvHardware.getState());
        await frame.locator('#fit').click();
        await frame.evaluate(()=>window.bsvHardware.whenSettled());
        const after=await captureNative({native,frame,page,output,name:'explicit-fit-after-native-resize',authority:fixtures.fixtures.A.authority,expectations:{root:'mkConnected',children:['left','right'],fitAll:true}});
        fs.writeFileSync(path.join(output,'fit-probe.json'),JSON.stringify({status:'observed',initialError,beforeViewport:before.current.viewport,afterViewport:after.state.current.viewport,afterVerdict:after.verdict},null,2)+'\n',{flag:'wx'});
        console.log(JSON.stringify({before:before.current.viewport,after:after.state.current.viewport,verdict:after.verdict}));
        await native.close('passed');
    }catch(error){await native.close('failed',error);throw error;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
