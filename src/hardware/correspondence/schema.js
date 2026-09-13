'use strict';
const {copyJson,DEFAULT_LIMITS,stable,hash,failure} = require('../json');
const {isHash,logicalRef} = require('../snapshot');
const {normalizeRange} = require('./source');
const PROVIDERS=[
    {id:'source-parser-v1',authority:'source-parser',schemaVersion:1,supportedScopes:['declaration']},
    {id:'stock-bluetcl-v1',authority:'caller-approved-stock-capture',schemaVersion:1,supportedScopes:['declaration','contract']},
    {id:'generated-rtl-v1',authority:'registered-generated-rtl',schemaVersion:1,supportedScopes:['contract']},
    {id:'yosys-json-v1',authority:'artifact-reader',schemaVersion:1,supportedScopes:['connectivity']},
    {id:'correspondence-v1',authority:'validated-premise-composition',schemaVersion:1,supportedScopes:['contract','connectivity','context']}
];
const RULES={
    'source-declaration':{scope:'declaration',requires:[]},
    'source-occurrence':{scope:'contract',requires:[]},
    'containing-context':{scope:'context',requires:[]},
    'method-port-contract':{scope:'contract',requires:['source-occurrence']},
    'generated-port':{scope:'contract',requires:['method-port-contract']},
    'ordered-port-binding':{scope:'connectivity',requires:['method-port-contract','generated-port','source-occurrence']},
    'same-net-contact':{scope:'connectivity',requires:['ordered-port-binding']}
};
function checkedJson(value,limits=DEFAULT_LIMITS) {
    const result=copyJson(value,limits),pending=[result];
    while(pending.length) {
        const value=pending.pop();if(!value||typeof value!=='object')continue;
        for(const [key,entry] of Object.entries(value)) {
            if(['__proto__','constructor','prototype'].includes(key))throw failure('INVALID_INPUT','Hostile JSON key');
            pending.push(entry);
        }
    }
    return result;
}
function seal(kind,payload) {return {id:`${kind}-${hash(stable(payload))}`,...payload};}
const invalid=message=>{throw failure('CONTRADICTION',message);};
function validateStructure(bundle,model,documents) {
    if(bundle.schemaVersion!==1)throw failure('UNSUPPORTED','Unsupported correspondence schema');
    if(!Array.isArray(bundle.claims)||bundle.claims.length>30000||!Array.isArray(bundle.evidence)||bundle.evidence.length>60000)throw failure('LIMIT_EXCEEDED','Claim/evidence limits exceeded');
    if(bundle.transformations.length)throw failure('UNSUPPORTED','Stock correspondence has no transformation ledger');
    const payload={...bundle};delete payload.id;
    if(seal('correspondence',payload).id!==bundle.id)invalid('Bundle identity mismatch');
    if(model&&(bundle.implementationSnapshotId!==model.snapshot.id||bundle.implementationModelId!==model.id||bundle.targetArtifactHash!==model.snapshot.artifact.hash))invalid('Snapshot/model/artifact mismatch');
    if(!model&&bundle.implementationSnapshotId!==null)invalid('Implementation context required');
    const providers=new Map(PROVIDERS.map(p=>[p.id,p]));
    if(bundle.providers.length!==providers.size)invalid('Provider population mismatch');
    const seenProviders=new Set();
    for(const p of bundle.providers){if(seenProviders.has(p.id))invalid('Duplicate provider');seenProviders.add(p.id);
        const {implementationIdentity,...value}=p;if(!isHash(implementationIdentity)||stable(providers.get(p.id))!==stable(value))invalid('Provider authority mismatch');}
    const evidence=new Map(),claims=new Map();
    for(const e of bundle.evidence){if(evidence.has(e.id))invalid('Duplicate evidence ID');evidence.set(e.id,e);
        if(!providers.has(e.providerId))invalid('Unknown evidence provider');logicalRef(e.pathRef);
        const {id,...value}=e;if(id!==`ev-${hash(stable(value))}`)invalid('Evidence content identity mismatch');
        if(e.range){const input=[...documents,...(bundle.evidenceSet.generatedRtl||[])].find(d=>d.pathRef===e.pathRef);
            if(!input||input.contentHash!==e.contentHash)invalid('Evidence document mismatch');}
    }
    for(const c of bundle.claims){if(claims.has(c.id))invalid('Duplicate claim ID');claims.set(c.id,c);}
    for(const c of bundle.claims) {
        const rule=RULES[c.relationKind];if(!rule||c.scope!==rule.scope)invalid('Unsupported/contradictory relation scope');
        if(!providers.has(c.providerId)||c.validation!=='valid'||c.resolution!=='resolved'||c.freshness!=='captured-revision')invalid('Invalid claim axes');
        if(!c.tuple||!c.tuple.source||!c.tuple.target||c.sources||c.targets)invalid('Actual typed tuple required');
        const src=c.tuple.source,doc=documents.find(d=>d.pathRef===src.pathRef);
        if(src.kind!=='source'||!doc||src.contentHash!==doc.contentHash||src.revision!==doc.revision||!src.semanticId)invalid('Source identity mismatch');
        const range=normalizeRange(doc.text,{unit:'utf16',start:src.range.start,end:src.range.end});
        if(stable(range)!==stable(src.range))invalid('Source range/slice/convention mismatch');
        if(!Array.isArray(c.premises)||new Set(c.premises).size!==c.premises.length||c.premises.some(p=>!claims.has(p)))invalid('Dangling/duplicate premise');
        if(!Array.isArray(c.evidenceRefs)||!c.evidenceRefs.length||c.evidenceRefs.some(p=>!evidence.has(p)))invalid('Missing/dangling evidence');
        if(rule.requires.some(kind=>!c.premises.some(id=>claims.get(id).relationKind===kind)))invalid('Invalid premise composition');
        for(const id of c.premises) {
            const p=claims.get(id);
            if(p.resolution!=='resolved'||p.validation!=='valid')invalid('Unverified premise cannot compose');
            if(['generated-port','ordered-port-binding','same-net-contact'].includes(c.relationKind)&&p.relationKind!=='source-occurrence'
                &&(p.tuple.source.semanticId!==src.semanticId||p.tuple.source.occurrenceId!==src.occurrenceId))invalid('Cross-source/occurrence premise');
        }
        const dst=c.tuple.target;
        if(dst.kind==='implementation') {
            const item=model?.entities[dst.entityId];if(!item||dst.snapshotId!==model.snapshot.id||dst.modelId!==model.id||dst.objectKind!==item.kind)invalid('Dangling/foreign implementation reference');
            const occurrence=item.occurrenceId||(item.kind==='occurrence'?item.id:item.childOccurrenceId)||null;
            if(dst.occurrenceId!==occurrence)invalid('Wrong implementation occurrence');
            if(dst.index!==undefined&&(!Number.isSafeInteger(dst.index)||dst.index<0||dst.index>=item.bits?.length))invalid('Invalid target bit index');
            if(c.relationKind==='ordered-port-binding') {
                if(item.kind!=='port'||!Array.isArray(c.orderedBindings)||c.orderedBindings.length!==item.bits.length)invalid('Ordered binding width mismatch');
                for(const [index,b] of c.orderedBindings.entries()) {
                    if(b.index!==index||b.formalBitId!==item.bits[index]||b.formalValue!==item.rawBits[index])invalid('Swapped/repeated/wrong formal bits');
                    const binding=Object.values(model.boundaries).find(x=>x.portId===item.id&&x.index===index);
                    if(b.boundaryId!==(binding?.id||null)||b.actualBitId!==(binding?.actualBitId||null)||b.actualValue!==(binding?model.bits[binding.actualBitId].value:null))invalid('Swapped/repeated/wrong actual bits');
                }
            }
            if(c.relationKind==='same-net-contact') {
                if(item.kind!=='pin'||item.bits[dst.index]!==c.bitId)invalid('Pin is not attached to claimed net');
                const premise=c.premises.map(id=>claims.get(id)).find(p=>p.relationKind==='ordered-port-binding');
                if(!Array.isArray(c.connectivityPath)||!Array.isArray(c.boundaryIds)||c.connectivityPath.length!==c.boundaryIds.length+1
                    ||c.connectivityPath[0]!==premise.orderedBindings[c.vectorIndex]?.formalBitId||c.connectivityPath.at(-1)!==c.bitId)invalid('Invalid contact path');
                c.boundaryIds.forEach((id,index)=>{const b=model.boundaries[id],a=c.connectivityPath[index],z=c.connectivityPath[index+1];
                    if(!b||!(b.formalBitId===a&&b.actualBitId===z||b.actualBitId===a&&b.formalBitId===z))invalid('Contact path crosses something other than an actual boundary');});
            }
        } else if(!['source-range','compiler-method','compiler-occurrence'].includes(dst.kind))invalid('Unknown typed target');
        const {id,...value}=c;if(id!==`claim-${hash(stable(value))}`)invalid('Claim content identity mismatch');
    }
    const complete=new Set();
    function visit(id,active) {
        if(active.has(id))invalid('Circular premises');if(complete.has(id))return;
        if(active.size>=64)throw failure('LIMIT_EXCEEDED','Premise depth limit');
        active.add(id);for(const p of claims.get(id).premises)visit(p,active);active.delete(id);complete.add(id);
    }
    for(const id of claims.keys())visit(id,new Set());
    return true;
}
module.exports={checkedJson,validateStructure,seal,PROVIDERS,RULES};
