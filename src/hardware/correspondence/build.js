'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {hash,stable,deepFreeze,failure} = require('../json');
const {buildSource,sourceRange,normalizeRange} = require('./source');
const {stockMetadata,compilerPoint,positionMatches,parseRtl,rtlVector,concreteWidth,eq,fail} = require('./stock');
const hardware = require('../yosys-json');
const {validateStructure,checkedJson,seal,PROVIDERS} = require('./schema');
const {sealGeneratedBundle} = require('./generated-bundle');

function build(data, parseCache) {
    let documents=data.sources;
    if(data.importResult) {
        const snapshot=data.importResult.snapshot,manifest={};
        for(const key of ['stage','tops','sourceInputs','dependencyFingerprint','toolchain','passSequence','buildOptionsFingerprint','concreteParameters'])manifest[key]=snapshot[key];
        const rebuilt=require('../snapshot').buildSnapshot(data.artifactText,snapshot.artifact.pathRef,manifest,snapshot.limits,snapshot.artifact.hash);
        eq(rebuilt.implementation,data.importResult.implementation,'Provided G2 model differs from registered artifact and immutable snapshot');
    }
    if(data.metadata)checkedJson(JSON.parse(data.metadata.text));
    const stock=data.metadata ? stockMetadata(JSON.parse(data.metadata.text)) : null;
    const metadata=stock?.metadata;
    const source=buildSource(documents,metadata?.top,parseCache,data.sourceEntry);
    documents=source.documents;
    const sem=source.semantic;
    const model=data.importResult?.implementation || null;
    const snapshot=data.importResult?.snapshot || null;
    const rtl=data.generatedRtl.map(parseRtl);
    const claims=[],evidence=[],unresolved=[],contexts=[],methods=[];
    const evidenceByContent=new Map();
    function ev(value) {if(evidence.length>=60000)throw failure('LIMIT_EXCEEDED','Evidence count limit');const id=`ev-${hash(stable(value))}`;if(!evidenceByContent.has(id)){evidenceByContent.set(id,value);evidence.push({id,...value});}return id;}
    const docByRef=new Map(documents.map(d=>[d.pathRef,d]));
    function sourceRef(semanticId,range,occurrence=null,definitionId=null,sourceKind='declaration') {
        const doc=docByRef.get(range?.uri);if(!doc)fail('Missing source document for semantic record');
        return {kind:'source',semanticId,definitionId,pathRef:doc.pathRef,contentHash:doc.contentHash,revision:doc.revision,
            sourceKind,range:sourceRange(doc,range),occurrenceId:occurrence?.id||null,occurrencePath:occurrence?.path||null};
    }
    const sourceEvidence=ref=>ev({kind:'source-range',providerId:'source-parser-v1',pathRef:ref.pathRef,contentHash:ref.contentHash,
        semanticId:ref.semanticId,range:ref.range,convention:'utf16-0-based-half-open'});
    const metaEvidence=(pointer,point=null)=>ev({kind:'compiler-record',providerId:'stock-bluetcl-v1',pathRef:data.metadata.pathRef,
        contentHash:data.metadata.contentHash,pointer,...(point?{point}: {})});
    const rtlEvidence=(r,range,role)=>ev({kind:'generated-rtl',providerId:'generated-rtl-v1',pathRef:r.document.pathRef,
        contentHash:r.document.contentHash,range:normalizeRange(r.document.text,{unit:'utf16',start:range.start,end:range.end}),role});
    const hwEvidence=item=>item.providerRefs.map(ref=>ev({kind:'implementation-record',providerId:'yosys-json-v1',...ref}));
    const target=item=>({kind:'implementation',entityId:item.id,objectKind:item.kind,snapshotId:snapshot.id,modelId:model.id,
        occurrenceId:item.occurrenceId|| (item.kind==='occurrence'?item.id:item.childOccurrenceId)||null});
    function claim(relationKind,scope,src,dst,premises,evidenceRefs,extra={}) {
        if(claims.length>=30000)throw failure('LIMIT_EXCEEDED','Claim count limit');
        const value={relationKind,scope,tuple:{source:src,target:dst},premises,evidenceRefs,
            providerId:scope==='declaration'?'source-parser-v1':scope==='contract'?'stock-bluetcl-v1':'correspondence-v1',
            validation:'valid',resolution:'resolved',freshness:'captured-revision',
            proves:scope,doesNotProve:['origin','exclusive-cause','behavioral-equivalence'],...extra};
        const c={id:`claim-${hash(stable(value))}`,...value};claims.push(c);return c.id;
    }
    const definitions=new Map(sem.definitions.map(d=>[d.id,d]));
    for(const r of source.references) {
        const ref=sourceRef(r.id,r.sourceRange||r.location,null,r.definitionId,r.kind);
        claim('source-declaration','declaration',ref,{kind:'source-range',pathRef:ref.pathRef,contentHash:ref.contentHash,range:ref.range},[],[sourceEvidence(ref)]);
    }
    const metadataDefinition=new Map();
    if(metadata) {
        for(const module of metadata.modules) {
            const point=compilerPoint(module.definitionPosition,documents);
            const matching=sem.definitions.filter(d=>d.kind==='module-definition'&&d.name===module.name&&d.uri===point.pathRef&&positionMatches(module.definitionPosition,d.location,documents));
            if(matching.length!==1)fail('Compiler module declaration is unrelated or ambiguous in registered source');
            if(module._qualifiedName!==`${matching[0].packageName}::${matching[0].name}`)fail('Compiler module belongs to a different source package/library');
            metadataDefinition.set(matching[0].id,module);
        }
        for(const node of metadata.hierarchy)if(node.position)compilerPoint(node.position,documents);
    }
    function generatedDefinition(occurrence,module) {
        const definition=model.definitions[occurrence.definitionId];
        const matching=rtl.filter(r=>r.name===module.name);
        if(matching.length!==1)fail('Missing/ambiguous registered generated module');
        const r=matching[0];
        const src=definition.attributes.src;
        checkGeneratedLocation(src,r,{start:r.start,end:r.end});
        if(definition.name!==module.name&&definition.attributes.hdlname!==module.name)fail('Artifact definition differs from compiler module');
        for(const p of occurrence.ports.map(id=>model.ports[id])) {
            const port=r.ports.get(p.name);if(!port)fail('G2 port missing in registered RTL');
            eq(port.width,p.bits.length,'RTL/artifact port width contradiction');eq(port.direction,p.direction,'RTL/artifact direction contradiction');
            const alias=definition.raw.netnames?.[p.name];if(!alias)fail('Missing generated port alias');
            eq(alias.bits,p.rawBits,'Port/alias ordered bits contradiction');
            checkGeneratedLocation(alias.attributes?.src,r,{start:port.nameStart,end:port.nameEnd});
        }
        return r;
    }
    function checkGeneratedLocation(raw,r,expected=null) {
        const m=/^(.+):(\d+)\.(\d+)-(\d+)\.(\d+)$/.exec(raw||'');
        if(!m)throw failure('UNSUPPORTED','Artifact generated location convention unsupported');
        if(m[1]!==r.document.pathRef)fail('Artifact generated location references another RTL artifact');
        const range=normalizeRange(r.document.text,{unit:'position',encoding:'utf16',base:1,
            start:{line:Number(m[2]),column:Number(m[3])},end:{line:Number(m[4]),column:Number(m[5])}});
        if(expected&&(range.start!==expected.start||range.end!==expected.end))fail('Generated location does not identify the claimed RTL object');
        return range;
    }
    const contextById=new Map();
    for(const instance of sem.instances) {
        if(instance.primitiveKind)continue;
        const definition=definitions.get(instance.targetDefinitionId);
        if(!definition){unresolved.push({family:'context',semanticId:instance.id,reason:'unresolved-source-definition'});continue;}
        const parent=contextById.get(instance.parentInstanceId);
        const module=metadataDefinition.get(definition.id);
        const matches=metadata?.hierarchy.filter(node=>instance.root
            ? node.parent===0&&node.Name===definition.name&&metadata.top===definition.name&&module
            : parent?.compilerNode&&node.parent===parent.compilerNode.key&&node.Name===instance.name&&positionMatches(node.position,instance.location,documents))||[];
        if(matches.length>1)fail('Ambiguous compiler occurrence');
        const node=matches[0]||null;
        if(node?.Node==='Synthesized'&&node.BSVModule!==definition.name)fail('Source/compiler occurrence definition contradiction');
        if(node?.Interface?.includes('::')) {
            const boundary=sem.endpoints.find(e=>e.ownerInstanceId===instance.id&&e.interfacePath.length===0);
            const iface=definitions.get(boundary?.interfaceDefinitionId);
            if(!iface||node.Interface.split('#')[0]!==`${iface.packageName}::${iface.name}`)fail('Compiler interface belongs to a different source package/library');
        }
        if(node?.Interface&&instance.declaredType) {
            const actual=node.Interface.replace(/\b[A-Za-z_$][\w$]*::/g,'').replace(/\s/g,'');
            if(actual!==instance.declaredType.replace(/\s/g,''))fail('Source/compiler occurrence type contradiction');
        }
        let implementation=null,r=null,instanceRtl=null;
        if(node?.Node==='Synthesized'&&model&&module) {
            const candidates=instance.root?model.roots.map(id=>model.occurrences[id]).filter(o=>model.definitions[o.definitionId].name===module.name)
                : parent?.implementationOccurrenceId?model.occurrences[parent.implementationOccurrenceId].children.map(id=>model.occurrences[id]).filter(o=>o.name===node.UniqueName):[];
            if(candidates.length!==1)fail('Compiler retained occurrence absent/ambiguous in G2');
            implementation=candidates[0];r=generatedDefinition(implementation,module);
            if(parent) {
                instanceRtl=parent.rtl.instances.get(node.UniqueName);
                if(!instanceRtl||instanceRtl.type!==module.name)fail('Generated parent instance contradicts compiler occurrence');
                const cell=model.cells[implementation.cellId];const location=checkGeneratedLocation(cell.attributes.src,parent.rtl);
                if(location.start<instanceRtl.start||location.end>instanceRtl.end||location.start===location.end)fail('Generated cell range outside actual RTL instance');
                const declaration=parent.module.instances.filter(i=>i.name===node.UniqueName&&positionMatches(i.position,instance.location,documents));
                if(declaration.length!==1||declaration[0].definition!==module.name)fail('Compiler parent instance declaration mismatch');
                for(const [pin,expr] of instanceRtl.connections) {
                    const actual=cell.raw.connections[pin];if(!actual)fail('RTL pin absent from G2 instance');
                    eq(rtlVector(expr,model.definitions[model.occurrences[parent.implementationOccurrenceId].definitionId].raw),actual,'RTL/artifact actual ordered vector contradiction');
                }
                const params=instance.parameterBindings||[];
                for(const param of params) {
                    const raw=model.definitions[implementation.definitionId].parameters[param.formalParameter]||cell.parameters[param.formalParameter];
                    if(/^\d+$/.test(param.actualExpression)&&typeof raw==='string'&&/^[01]+$/.test(raw)&&BigInt(`0b${raw}`)!==BigInt(param.actualExpression))fail('Concrete parameter occurrence contradiction');
                }
            }
        }
        const ref=sourceRef(instance.id,instance.sourceRange,instance,definition.id,'module-occurrence');
        const context={sourceRef:ref,semanticId:instance.id,occurrenceId:instance.id,occurrencePath:instance.path,definitionId:definition.id,
            compilerNode:node,module,rtl:r,implementationOccurrenceId:implementation?.id||null,
            contextOccurrenceId:implementation?.id||parent?.contextOccurrenceId||null,claimId:null};
        if(node) {
            const evidenceRefs=[sourceEvidence(ref),metaEvidence(`/hierarchy/${node._index}`,node.position?compilerPoint(node.position,documents):compilerPoint(module.definitionPosition,documents))];
            if(r)evidenceRefs.push(rtlEvidence(r,{start:0,end:r.document.text.length},'module-boundary'),...hwEvidence(implementation));
            if(instanceRtl)evidenceRefs.push(rtlEvidence(parent.rtl,instanceRtl,'parent-instance'));
            context.claimId=claim(implementation?'source-occurrence':'containing-context',implementation?'contract':'context',ref,
                implementation?target(implementation):context.contextOccurrenceId?target(model.occurrences[context.contextOccurrenceId]):{kind:'compiler-occurrence',key:node.key},
                parent?.claimId?[parent.claimId]:[],evidenceRefs,{ownership:implementation?'retained-boundary':'containing-only',ownedCellIds:[]});
        } else unresolved.push({family:'context',semanticId:instance.id,reason:'compiler-occurrence-unmapped'});
        contexts.push({sourceRef:ref,semanticId:instance.id,occurrenceId:instance.id,occurrencePath:instance.path,definitionId:definition.id,
            implementationOccurrenceId:context.implementationOccurrenceId,contextOccurrenceId:context.contextOccurrenceId,
            resolution:implementation?'resolved':context.contextOccurrenceId?'ambiguous':'unmapped',ownership:implementation?'retained-boundary':'containing-only',ownedCellIds:[],claimId:context.claimId,
            compilerType:node?.Interface||null,declaredType:instance.declaredType||definition.returnInterface,parameterBindings:instance.parameterBindings||[]});
        contextById.set(instance.id,context);
    }
    for(const endpoint of sem.endpoints.filter(e=>e.kind==='method-endpoint')) {
        const context=contextById.get(endpoint.ownerInstanceId);if(!context)continue;
        const instance=sem.instances.find(i=>i.id===endpoint.ownerInstanceId),definition=definitions.get(instance.targetDefinitionId);
        const behaviors=sem.stateBehaviors.filter(b=>b.ownerInstanceId===instance.id&&b.kind==='method'&&[...(b.interfacePath||[]),b.name].join('.')===endpoint.interfacePath.join('.'));
        if(behaviors.length>1)fail('Ambiguous source method implementation');
        const behavior=behaviors[0]||null;
        const declaration=source.references.find(r=>r.kind==='interface-method'&&r.interfaceDefinitionId===endpoint.interfaceDefinitionId&&r.name===endpoint.name);
        if(!declaration) {unresolved.push({family:'contract',semanticId:endpoint.id,reason:'missing-interface-declaration'});continue;}
        const ref=sourceRef(behavior?.definitionId||endpoint.id,behavior?.sourceRange||declaration.sourceRange||declaration.location,instance,definition.id,behavior?'implementation-method':'forwarded-contact');
        const item={sourceRef:ref,semanticId:ref.semanticId,endpointId:endpoint.id,method:endpoint.interfacePath.join('.'),occurrenceId:instance.id,
            occurrencePath:instance.path,implementationOccurrenceId:context.implementationOccurrenceId,contextOccurrenceId:context.contextOccurrenceId,
            body:behavior?ref:null,interfaceDeclaration:sourceRef(declaration.id,declaration.sourceRange||declaration.location,instance,endpoint.interfaceDefinitionId,'interface-method'),
            forwarded:!behavior,forwardingSource:null,declaredResultType:endpoint.resultType,concreteResultType:null,signals:[],claimIds:[]};
        if(!behavior) {
            const returns=source.supplements.filter(s=>s.ownerDefinitionId===definition.id);
            if(returns.length===1&&sem.instances.some(i=>i.parentInstanceId===instance.id&&i.name===returns[0].expression.text))
                item.forwardingSource=sourceRef(returns[0].id,returns[0].sourceRange,instance,definition.id,'interface-return');
        }
        const iface=definitions.get(endpoint.interfaceDefinitionId);
        const compilerType=(context.compilerNode?.Interface||instance.declaredType||definition.returnInterface||'').replace(/\b[A-Za-z_$][\w$]*::/g,'');
        const args=/^[^#]+#\((.*)\)$/.exec(compilerType)?.[1].split(',').map(v=>v.trim())||[];
        const substitutions=new Map((iface.typeParameters||[]).map((p,i)=>[p.name,args[i]||p.name]));
        const concrete=type=>(type||'').replace(/\b[A-Za-z_][\w]*\b/g,t=>substitutions.get(t)||t);
        item.concreteResultType=concrete(endpoint.resultType)||null;
        methods.push(item);
        if(!context.module||!context.compilerNode||!context.implementationOccurrenceId) {
            unresolved.push({family:'contract',semanticId:ref.semanticId,occurrenceId:instance.id,reason:'inline-or-missing-compiler-method-contract'});continue;
        }
        const compilerMethods=context.module.methods.filter(m=>m.name===item.method);
        if(compilerMethods.length!==1)fail('Declared method absent/ambiguous in compiler contract');
        const method=compilerMethods[0],methodIndex=context.module.methods.indexOf(method);
        if(behavior) {
            const declared=concreteWidth(item.concreteResultType),implemented=concreteWidth(concrete(behavior.returnType));
            if(declared!==null&&implemented!==null&&declared!==implemented)fail('Interface/implementation method result width mismatch');
        }
        if(method.args.length!==endpoint.parameters.length)fail('Source/compiler method argument arity mismatch');
        method.args.forEach((arg,i)=>{const width=concreteWidth(concrete(endpoint.parameters[i].type));if(width!==null&&width!==arg.size)fail('Source/compiler argument width mismatch');});
        if(!behavior&&!item.forwardingSource) {unresolved.push({family:'contract',semanticId:ref.semanticId,occurrenceId:instance.id,reason:'forwarding-source-unresolved'});continue;}
        const evidenceRefs=[sourceEvidence(ref),sourceEvidence(item.interfaceDeclaration),
            metaEvidence(`/modules/${context.module._index}/methods/${methodIndex}`,compilerPoint(context.module.definitionPosition,documents))];
        if(item.forwardingSource)evidenceRefs.push(sourceEvidence(item.forwardingSource));
        const contract=claim('method-port-contract','contract',ref,{kind:'compiler-method',module:context.module.name,method:method.name,occurrenceKey:context.compilerNode.key},
            [context.claimId],evidenceRefs,{method:item.method,role:null,optionalSignals:Object.fromEntries(['enable','ready','result'].map(role=>[role,{status:method[role]?'present':'absent-proven',port:method[role]||null}])),
                clock:method.clock,reset:method.reset,declaredResultType:endpoint.resultType,concreteResultType:item.concreteResultType});
        item.claimIds.push(contract);
        const signals=[...method.args.map((a,i)=>({role:'argument',port:a.port,width:a.size,argumentIndex:i})),
            ...['enable','ready','result'].filter(role=>method[role]).map(role=>({role,port:method[role],width:role==='result'?concreteWidth(item.concreteResultType):1}))];
        const occurrence=model.occurrences[context.implementationOccurrenceId];
        for(const signal of signals) {
            const port=occurrence.ports.map(id=>model.ports[id]).find(p=>p.name===signal.port);if(!port)fail('Compiler signal missing G2 formal');
            const rtlPort=context.rtl.ports.get(signal.port);if(!rtlPort)fail('Compiler signal missing RTL formal');
            if(signal.width!==null&&signal.width!==port.bits.length)fail('Source/compiler/RTL method width mismatch');
            const compilerWidth=concreteWidth(context.module._types[signal.port]);
            if(compilerWidth!==null&&compilerWidth!==port.bits.length)fail('Stock port type width contradiction');
            const expectedDirection=signal.role==='argument'||signal.role==='enable'?'input':'output';
            if(port.direction!==expectedDirection)fail('Method signal direction contradiction');
            const rtlClaim=claim('generated-port','contract',ref,target(port),[contract],[rtlEvidence(context.rtl,rtlPort,'formal-port'),...hwEvidence(port)],{method:item.method,role:signal.role});
            const orderedBindings=port.bits.map((formalBitId,index)=>{
                const binding=hardware.crossHierarchyBoundary(model,occurrence.id,port.name,index);
                return {index,formalBitId,formalValue:model.bits[formalBitId].value,
                    actualBitId:binding?.actualBitId||null,actualValue:binding?model.bits[binding.actualBitId].value:null,boundaryId:binding?.id||null};
            });
            const binding=claim('ordered-port-binding','connectivity',ref,target(port),[contract,rtlClaim,context.claimId],hwEvidence(port),
                {method:item.method,role:signal.role,orderedBindings});
            item.claimIds.push(rtlClaim,binding);
            item.signals.push({...signal,width:port.bits.length,portId:port.id,claimId:binding,orderedBindings});
            for(const pair of orderedBindings) {
                const visited=new Set(),queue=[{bitId:pair.formalBitId,path:[pair.formalBitId],boundaries:[]}];
                while(queue.length) {
                    const step=queue.shift(),bitId=step.bitId;if(visited.has(bitId))continue;visited.add(bitId);
                    const bit=model.bits[bitId];
                    for(const endpoint of bit.endpoints.filter(e=>e.kind==='pin')) {
                        const pin=model.pins[endpoint.entityId];
                        item.claimIds.push(claim('same-net-contact','connectivity',ref,{...target(pin),index:endpoint.index},[binding],[...hwEvidence(pin),...step.boundaries.flatMap(id=>hwEvidence(model.boundaries[id]))],
                            {method:item.method,role:signal.role,vectorIndex:pair.index,bitId,connectivityPath:step.path,boundaryIds:step.boundaries}));
                    }
                    for(const boundary of Object.values(model.boundaries)) {
                        const next=boundary.formalBitId===bitId?boundary.actualBitId:boundary.actualBitId===bitId?boundary.formalBitId:null;
                        if(next)queue.push({bitId:next,path:[...step.path,next],boundaries:[...step.boundaries,boundary.id]});
                    }
                }
            }
        }
    }
    const sourceModel=JSON.parse(JSON.stringify({...sem,sourceReferences:source.references,supplements:source.supplements}));
    const sourceModelIdentity=hash(stable({documents:documents.map(({pathRef,contentHash,revision})=>({pathRef,contentHash,revision})),model:sourceModel}));
    const runtimeRoot=path.resolve(__dirname,'../..');
    const implementations=[...new Set([...Object.keys(require.cache),require.resolve('./index')])].filter(p=>p.startsWith(runtimeRoot+path.sep)).sort().map(p=>({pathRef:path.relative(runtimeRoot,p).split(path.sep).join('/'),contentHash:hash(fs.readFileSync(p))}));
    const providers=PROVIDERS.map(p=>({...p,implementationIdentity:hash(stable(implementations))}));
    const evidenceSet={sources:documents.map(({pathRef,contentHash,revision})=>({pathRef,contentHash,revision})),
        metadata:data.metadata?{pathRef:data.metadata.pathRef,contentHash:data.metadata.contentHash,sourceInputs:data.metadata.sourceInputs}:null,
        generatedRtl:data.generatedRtl.map(({pathRef,contentHash})=>({pathRef,contentHash}))};
    const population=(ids,category,selection,matched=[])=>{ids=[...new Set(ids)].sort();const set=new Set(matched);return {category,selection,populationIds:ids,populationHash:hash(stable(ids)),total:ids.length,
        resolved:ids.filter(id=>set.has(id)).length,unmapped:category==='origin'?0:ids.filter(id=>!set.has(id)).length,ambiguous:0,partial:0,generated:0,removed:0,
        unsupported:category==='origin'?ids.length:0,knownContributors:0,completeContributorSets:0,excluded:[]};};
    const categories=[population(source.references.map(r=>r.id),'declaration','SourceReferenceIndex lexical records',source.references.map(r=>r.id))];
    for(const category of ['contract','connectivity'])categories.push(population(methods.map(m=>m.endpointId),category,'Contextual Semantic method endpoint IDs',
        methods.filter(m=>m.claimIds.some(id=>claims.some(c=>c.id===id&&c.scope===category))).map(m=>m.endpointId)));
    categories.push(population(model?Object.values(model.cells).filter(c=>!c.definitionId).map(c=>c.id):[],'origin','Occurrence-expanded leaf cells (not historical definition-cell denominator)'));
    categories.push(population(model?Object.values(model.definitions).flatMap(d=>Object.keys(d.raw.netnames||{}).map(n=>`${d.id}/netname/${encodeURIComponent(n)}`)):[],'origin','Definition netname aliases, including parameter-specialized definitions'));
    categories.push(population(sem.instances.filter(i=>i.primitiveKind).map(i=>i.id),'origin','Contextual source primitive storage instances'));
    categories.push(population(sem.expressions.map(e=>e.id),'origin','Existing Semantic expression records, not historical outermost expression-site census'));
    const coverage={snapshotId:snapshot?.id||null,stage:snapshot?.stage||null,sourceModelIdentity,categories,
        origin:{resolution:'unsupported',reason:'stock-metadata-has-no-origin-lineage',knownContributors:0,completeContributorSets:0},unresolved};
    const payload={schemaVersion:1,implementationSnapshotId:snapshot?.id||null,implementationModelId:model?.id||null,
        targetArtifactHash:snapshot?.artifact.hash||null,sourceModelIdentity,evidenceSetIdentity:hash(stable(evidenceSet)),evidenceSet,providers,claims,evidence,
        transformations:[],unresolved,coverage,validationSummary:{valid:true,originAuthority:'unsupported'},contexts,methods};
    const {bundle,metrics:bundleMetrics}=sealGeneratedBundle(payload);
    validateStructure(bundle,model,documents);
    const analysis=seal('analysis',{schemaVersion:1,implementationSnapshotId:snapshot?.id||null,implementationModelId:model?.id||null,
        correspondenceId:bundle.id,sourceModelIdentity});
    return deepFreeze({...analysis,correspondence:bundle,sourceModel,...(source.sourceScope?{sourceScope:source.sourceScope}:{}),
        metrics:{...bundleMetrics,claimCount:claims.length,sourceBytes:documents.reduce((n,d)=>n+Buffer.byteLength(d.text),0)}});
}
module.exports={build};
