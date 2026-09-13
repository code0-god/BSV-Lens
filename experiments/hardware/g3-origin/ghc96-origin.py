#!/usr/bin/env python3
"""Reduce real compiler/reader captures into scoped evidence, never name-based origins."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re

STAGES = ["expanded","normtypes","inline-fmt","inline","itransform-1","split-if","lift","itransform-2","iparams","drop-rules","aconv","rank-methods","task-splice","a-cleanup","schedule","schedule-defs","dump-schedule","check-proofs","noinline","schedule-wires","schedule-assumptions","remove-assumptions","drop-undetermined","astate","inline-wires","inline-creg","rename-io","drop-defs","aopt","synthesize","verilog-quirks","final-cleanup","verilog","verilog-dollar"]
PROC = ["proc_clean","proc_rmdead","proc_prune","proc_init","proc_arst","proc_rom","proc_mux","proc_dlatch","proc_dff","proc_memwr","proc_clean"]
ROLE = {"VBinary":"operator","VProcess":"process","VInstance":"instance"}
OPS = {"PrimAdd":("VAdd","$add","+"),"PrimSub":("VSub","$sub","-")}


def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=True)
def fingerprint(value):return hashlib.sha256(canonical(value).encode()).hexdigest()
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def require(value,message):
    if not value:raise ValueError(message)


def compiler_path(value):
    # BSC's encoded absolute path uses ///; these are data aliases, not host reads.
    require(value.startswith("/input/fixtures/") or value.startswith("///input/fixtures/"),"unregistered compiler path")
    parts = value.lstrip("/").split("/")
    require(all(x not in ("", ".", "..") for x in parts),"unsafe compiler path")
    return "/"+"/".join(parts)


def offset(text, point):
    line,column = point
    lines = text.splitlines(keepends=True)
    require(type(line) is int and type(column) is int and 1 <= line <= len(lines),"invalid source line")
    require(1 <= column <= len(lines[line-1].rstrip("\r\n"))+1,"invalid source column")
    return sum(len(x) for x in lines[:line-1])+column-1


def literal(text):
    text = text.strip()
    if re.fullmatch(r"\d+",text):return int(text)
    m = re.fullmatch(r"(\d+)'([bdh])([0-9a-fA-F_]+)",text)
    if m:return int(m[3].replace("_",""),{"b":2,"d":10,"h":16}[m[2]])
    return None


def symbolic_equal(before,after):
    return len(before)==len(after) and all(a==b or (literal(a) is not None and literal(a)==literal(b)) for a,b in zip(before,after))


def parse_compiler(run):
    path = run/"receipts/instrumented-compile-final.log"
    require(path.stat().st_size <= 16*1024*1024,"compiler log size limit")
    receipt = json.loads((run/"receipts/instrumented-compile-final.json").read_text())
    require(receipt["exit"]==0 and receipt["completeLog"] and receipt["logSha256"]==sha(path),"incomplete compiler capture")
    records=[];context=None
    for line_number,line in enumerate(path.read_text().splitlines(),1):
        if not line.startswith("G3EVENT "):continue
        value=json.loads(line[8:])
        if value["pass"]=="module.begin":context=value["module"]
        record={"observation":value,"moduleContext":context,"logLine1":line_number}
        record["id"]=fingerprint({"observation":value,"moduleContext":context})
        records.append(record)
        if value["pass"]=="compiler.complete":context=None
    require(sum(r["observation"]["pass"]=="compiler.complete" for r in records)==3,"compiler completion markers")
    inputs=json.loads((run/"inputs/build-inputs.json").read_text())
    sources={"/input/fixtures/"+f["path"]:{"pathRef":"inputs/fixtures/"+f["path"],"sha256":f["sha256"],"text":(run/"inputs/fixtures"/f["path"]).read_text()} for f in inputs["fixtures"]}
    mints={};stages=defaultdict(list)
    for r in records:
        e=r["observation"]
        if e["pass"]=="parser.source":
            source=sources[compiler_path(e["file"])]
            require(e["source"]==e["preprocessed"]==source["text"],"unsupported preprocessing or source capture mismatch")
            require(all(ord(c)<128 for c in source["text"]) and "\t" not in source["text"],"source coordinate scope is ASCII without tabs")
            require(hashlib.sha256(e["source"].encode()).hexdigest()==e["sourceSha256"]==source["sha256"],"compiler source hash mismatch")
        if e["pass"]=="parser.mint":
            source=sources[compiler_path(e["file"])];token,=e["origins"]
            start,end=offset(source["text"],e["begin"]),offset(source["text"],e["end"])
            require(start<end and e["sourceSha256"]==source["sha256"],"mint span/hash mismatch")
            expected=":".join([source["sha256"],compiler_path(e["file"]),e["kind"],*map(str,e["begin"]),*map(str,e["end"])])
            require(token==expected,"mint token identity mismatch")
            if e["kind"]=="rhs-binary":
                point=offset(source["text"],e["operatorPoint"])
                require(start<=point<end and source["text"][point] in "+-","unsupported source binary operator")
            value={"token":token,"pathRef":source["pathRef"],"sourceSha256":source["sha256"],"kind":e["kind"],"range":{"unit":"utf8","start":start,"end":end},"compilerRange":{"begin":e["begin"],"end":e["end"],"base":1,"halfOpen":True},"slice":source["text"][start:end],"sliceSha256":hashlib.sha256(source["text"][start:end].encode()).hexdigest()}
            require(token not in mints or mints[token]==value,"contradictory repeated mint")
            mints[token]=value
        if e["pass"]=="stage.capture":
            require(e["stage"] in STAGES,"unknown compiler stage")
            refs=set()
            for obj in e["objects"]:
                ref=obj["objectRef"]
                require(ref["stage"]==e["stage"] and ref["module"]==e["module"] and type(ref["localNodeOrdinal"]) is int and 0<=ref["localNodeOrdinal"]<e["populationCount"],"invalid stage-local object tuple")
                key=canonical(ref);require(key not in refs,"duplicate stage-local object tuple");refs.add(key)
                require(all(token in mints for token in obj["origins"]),"object without compiler mint")
            stages[e["module"]].append(r)
    for module,rows in stages.items():require([r["observation"]["stage"] for r in rows]==STAGES,"missing or reordered compiler boundary: "+module)
    return records,mints,stages,sha(path)


def occurrences(records,token,passes,module=None):
    return [r for r in records if r["observation"]["pass"] in passes and token in r["observation"].get("origins",[]) and (module is None or r["moduleContext"]==module)]


def shape(obj):return {k:v for k,v in obj.items() if k not in ["objectRef","path","compilerId","origins","stateUid"]}


def transition(before,after,records,token,module):
    a,b=before["kind"],after["kind"]
    if shape(before)==shape(after):return "preserve",[]
    if a=="IPrim" and b=="APrim" and before["operation"]==after["operation"] and symbolic_equal(before["operands"],after["operands"]):
        evidence=occurrences(records,token,{"AConv.primitive"},module)
        if evidence:return "typed-primitive-conversion",[e["id"] for e in evidence]
    if a=="IStateVar" and b=="AVInst" and before["constructor"]==after["constructor"]:
        evidence=[e for e in occurrences(records,token,{"AConv.state"},module) if e["observation"]["stateUid"]==before["stateUid"]]
        if evidence:return "state-to-AVInst",[e["id"] for e in evidence]
    if a==b=="AVInst":
        evidence=[e for e in occurrences(records,token,{"AState.clock-reset-inout-lowering"},module) if e["observation"]["inputArguments"]==before["arguments"] and e["observation"]["outputArguments"]==after["arguments"]]
        if evidence:return "clock-reset-port-lowering",[e["id"] for e in evidence]
    if a=="APrim" and b=="VBinary" and before["operation"] in OPS and after["operation"]==OPS[before["operation"]][0] and before["operands"]==after["operands"]:
        evidence=occurrences(records,token,{"AVerilogUtil.binary"},module)
        if evidence:return "emit-binary",[e["id"] for e in evidence]
    if a=="AVInst" and b=="VProcess" and before["constructor"]=="RegN":
        evidence=[e for e in occurrences(records,token,{"InlineReg.singleton-process"},module) if e["observation"]["memberCount"]==1]
        if evidence:return "singleton-register-inlining",[e["id"] for e in evidence]
    if a=="AVInst" and b=="VInstance" and before["constructor"]==after["constructor"]:
        return "emit-retained-instance",[]
    return "unsupported-rewrite",[]


def compiler_roots(records,mints,stages):
    roots=[]
    for module,rows in stages.items():
        first=rows[0]["observation"]["objects"]
        for initial in first:
            for token in initial["origins"]:
                trace=[];edges=[];gaps=[]
                for stage in rows:
                    matches=[o for o in stage["observation"]["objects"] if token in o["origins"]]
                    if len(matches)!=1:
                        gaps.append({"stage":stage["observation"]["stage"],"reason":"no unique marked root","matches":len(matches)})
                        continue
                    current=matches[0]
                    if trace:
                        action,evidence=transition(trace[-1]["object"],current,records,token,module)
                        edge={"pass":stage["observation"]["stage"],"input":trace[-1]["object"]["objectRef"],"output":current["objectRef"],"inputOrigins":trace[-1]["object"]["origins"],"outputOrigins":current["origins"],"action":action,"branchObservationIds":evidence,"captureIds":[trace[-1]["captureId"],stage["id"]]}
                        edge["id"]=fingerprint(edge);edges.append(edge)
                        if action=="unsupported-rewrite":gaps.append({"stage":stage["observation"]["stage"],"reason":"ordered root descriptor changed without a supported branch event"})
                    trace.append({"captureId":stage["id"],"object":current})
                source=mints[token]
                required={"parser.mint","Imperative.binding-name","IConv.binding-name","IStateLoc.cleanupInstId","IExpand.newState"} if source["kind"]=="binding" else {"parser.mint","ParseOp.binary","TCheck.binary-desugar","TCheck.tiVar","AConv.primitive","AVerilogUtil.binary"}
                observed={r["observation"]["pass"] for r in occurrences(records,token,required)}
                if not required<=observed:gaps.append({"stage":"source-to-elaboration","reason":"missing required compiler mint/transport observation","missing":sorted(required-observed)})
                end=trace[-1]["object"] if trace else None
                roots.append({"id":fingerprint({"module":module,"origin":token}),"module":module,"origin":token,"source":source,"initialKind":initial["kind"],"constructor":initial.get("constructor"),"trace":trace,"transformations":edges,"gaps":gaps,"compilerRootTransportComplete":not gaps and len(trace)==len(STAGES),"finalKind":end["kind"] if end else None,"completeOriginSet":False})
    return roots


def parse_rtlil(path):
    modules={};module=None;attrs={};current=None
    for number,line in enumerate(path.read_text().splitlines(),1):
        if line.startswith("module "):
            module=line[7:].removeprefix("\\");modules[module]=[];attrs={};current=None
        elif line=="end":module=None;current=None;attrs={}
        elif module is not None:
            if current is not None:
                current["lines"].append(line)
                if line=="  end":current["endLine1"]=number;current=None
                continue
            m=re.match(r'  attribute \\(\S+) (.*)',line)
            if m:
                value=m[2];attrs[m[1]]=json.loads(value) if value.startswith('"') else value
                continue
            m=re.match(r'  (cell|process) (.*)',line)
            if m:
                parts=m[2].split()
                kind=m[1];name=parts[-1].removeprefix("\\")
                current={"kind":kind,"name":name,"type":parts[0].removeprefix("\\") if kind=="cell" else None,"attributes":attrs,"startLine1":number,"lines":[line]}
                modules[module].append(current);attrs={}
            elif line.startswith("  wire ") or line.startswith("  connect "):attrs={}
    return modules


def vec(module,expression):
    expression=expression.strip().removeprefix("\\")
    if expression in module["netnames"]:return module["netnames"][expression]["bits"]
    if expression in module["ports"]:return module["ports"][expression]["bits"]
    if expression in module.get("parameter_default_values",{}):return list(reversed(module["parameter_default_values"][expression]))
    m=re.fullmatch(r"(\d+)'([bdh])([0-9a-fA-F_]+)",expression)
    if m:
        n=literal(expression)
        if n is None:raise ValueError("literal parse")
        return [str((n>>i)&1) for i in range(int(m[1]))]
    raise ValueError("unsupported ordered scalar operand: "+expression)


def rtl_objects(path):
    text=path.read_text();module=re.search(r'\bmodule\s+(\w+)',text)
    if module is None:raise ValueError("missing emitted module")
    output=[]
    for m in re.finditer(r'\(\*\s*g3_emit_id\s*=\s*("[^"]*")\s*,\s*g3_origin_ref\s*=\s*("[^"]*")\s*\*\)',text):
        emit,origin=json.loads(m[1]),json.loads(m[2]);role=emit.split(":",1)[0]
        require(emit==role+":"+origin,"emitted attribute identity mismatch")
        before=text[:m.start()].rstrip();after=text[m.end():].lstrip()
        if role=="operator":require(before[-1:] in "+-","unsupported operator attribute placement")
        elif role=="process":require(after.startswith("always@"),"process attribute not on always")
        elif role=="instance":require(re.match(r'\w+',after) is not None,"instance attribute placement")
        else:raise ValueError("unknown emitted role")
        output.append({"module":module[1],"role":role,"emitId":emit,"origins":origin.split(";"),"rtlSha256":sha(path),"attributeSpanBytes":{"start":m.start(),"end":m.end()},"line1":text.count("\n",0,m.start())+1})
    return output


def reader_links(run,roots):
    links=[];unresolved=[];populations=[];hierarchy=[]
    by_module=defaultdict(list)
    for root in roots:by_module[root["module"]].append(root)
    for label in "ABC":
        folder=run/"results/instrumented"/label
        model=json.loads((folder/"design.json").read_text());artifact=sha(folder/"design.json")
        captures={"read":parse_rtlil(folder/"captures/read.il"),"hierarchy":parse_rtlil(folder/"captures/00-pre-proc.il")}
        capture_paths={"read":folder/"captures/read.il","hierarchy":folder/"captures/00-pre-proc.il"}
        for n,step in enumerate(PROC,1):
            key=f"{n:02d}-{step}";capture_paths[key]=folder/"captures"/(key+".il");captures[key]=parse_rtlil(capture_paths[key])
        emitted=[o for f in sorted((folder/"rtl").glob("*.v")) for o in rtl_objects(f)]
        for module,body in model["modules"].items():
            for name,cell in body["cells"].items():
                kind="hierarchy-cell" if cell["type"] in model["modules"] else "leaf-cell"
                ref={"artifactSha256":artifact,"module":module,"cell":name,"kind":kind}
                populations.append(ref)
                marker=cell.get("attributes",{}).get("g3_emit_id")
                if marker is None:continue
                token=cell["attributes"].get("g3_origin_ref")
                require(isinstance(token,str) and marker.endswith(":"+token),"cell marker mismatch")
                origin_module=body.get("attributes",{}).get("hdlname",module)
                candidates=[o for o in emitted if o["module"]==origin_module and o["emitId"]==marker]
                require(len(candidates)==1,"tagged cell has no unique compiler-emitted object")
                emitted_object=candidates[0]
                candidates=[r for r in by_module[origin_module] if r["origin"]==token and ROLE.get(r["finalKind"])==emitted_object["role"]]
                require(len(candidates)==1,"tagged object has no compiler root chain")
                root=candidates[0];vroot=root["trace"][-1]["object"]
                evidence=[]
                for stage,modules in captures.items():
                    # The pre-hierarchy template is explicitly a different definition.
                    definition=origin_module if stage=="read" else module
                    objects=[o for o in modules.get(definition,[]) if o["attributes"].get("g3_emit_id")==marker]
                    if emitted_object["role"]=="process":
                        objects=[o for o in objects if o["kind"]==("process" if stage in ["read","hierarchy",*list(captures)[2:10]] else "cell")]
                    require(len(objects)==1,"reader marker transport is not unique at "+stage)
                    obj=objects[0]
                    evidence.append({"stage":stage,"path":str(capture_paths[stage].relative_to(run)),"sha256":sha(capture_paths[stage]),"module":definition,"objectKind":obj["kind"],"objectName":obj["name"],"line1":obj["startLine1"]})
                require(evidence[-1]["objectName"]==name,"final JSON object identity differs from captured lowering")
                gap=list(root["gaps"])
                if emitted_object["role"]=="operator":
                    expected={"VAdd":"$add","VSub":"$sub"}[vroot["operation"]]
                    require(cell["type"]==expected,"operator kind mismatch")
                    require(cell["connections"]["A"]==vec(body,vroot["operands"][0]) and cell["connections"]["B"]==vec(body,vroot["operands"][1]),"ordered operator inputs do not match emitted expression")
                    aroot=next(t["object"] for t in root["trace"] if t["object"]["objectRef"]["stage"]=="final-cleanup")
                    width=re.fullmatch(r'ATBit \{atb_size = (\d+)\}',aroot["type"])
                    require(width is not None and len(cell["connections"]["Y"])==int(width[1]),"operator result width mismatch")
                    for key in ["A_SIGNED","B_SIGNED"]:require(int(cell["parameters"][key],2)==0,"signed operation outside scope")
                elif emitted_object["role"]=="process":
                    require(cell["type"]=="$dff" and int(cell["parameters"]["CLK_POLARITY"],2)==1,"storage lowering outside positive-edge DFF scope")
                    require(not any(o["kind"]=="cell" and o["name"]==name for o in captures["08-proc_dlatch"][module]),"DFF target existed before proc_dff")
                    require(any(o["kind"]=="cell" and o["name"]==name and o["attributes"].get("g3_emit_id")==marker for o in captures["09-proc_dff"][module]),"DFF was not created at proc_dff")
                    process=[o for o in captures["08-proc_dlatch"][module] if o["kind"]=="process" and o["attributes"].get("g3_emit_id")==marker][0]
                    sync=[re.fullmatch(r'    sync posedge (\S+)',line) for line in process["lines"] if line.startswith("    sync ")]
                    updates=[re.fullmatch(r'      update (\S+) (\S+)',line) for line in process["lines"] if line.startswith("      update ")]
                    require(len(sync)==len(updates)==1 and sync[0] is not None and updates[0] is not None,"process is not a single-vector single-edge register")
                    clock=sync[0];update=updates[0]
                    assert clock is not None and update is not None
                    require(cell["connections"]["CLK"]==vec(body,clock[1]) and cell["connections"]["Q"]==vec(body,update[1]) and cell["connections"]["D"]==vec(body,update[2]),"process-to-DFF ordered sync binding mismatch")
                    member=[t["object"] for t in root["trace"] if t["object"]["objectRef"]["stage"]=="final-cleanup"][0]
                    width=literal(member["arguments"][2]);require(width==len(cell["connections"]["Q"]),"storage width mismatch")
                else:
                    require(kind=="hierarchy-cell","instance marker on non-hierarchy object")
                    for port in vroot["ports"]:
                        expected=[] if port["expression"] is None else vec(body,port["expression"])
                        require(cell["connections"][port["formal"]]==expected,"instance ordered port binding mismatch")
                    child=model["modules"][cell["type"]]
                    for param in vroot["parameters"]:
                        require(int(child["parameter_default_values"][param["formal"]],2)==literal(param["expression"]),"concrete parameter mismatch")
                    hierarchy.append({"target":ref,"childDefinition":cell["type"],"sourceBindingToken":token,"compilerInstance":vroot,"parameters":child.get("parameter_default_values",{})})
                if origin_module!=module:
                    gap.append({"stage":"reader-hierarchy-derive","reason":"parameter context and copied token measured; no independent AST clone event identity in stock reader"})
                link={"origin":token,"compilerRootId":root["id"],"target":ref,"emittedObject":emitted_object,"readerTransport":evidence,"orderedConnections":cell["connections"],"parameters":cell["parameters"],"status":"verified-known-contributor" if not gap else "partial-observed-token-transport","completeOriginSet":False,"gaps":gap}
                links.append(link)
        tops=[name for name,m in model["modules"].items() if m.get("attributes",{}).get("top") and int(m["attributes"]["top"],2)==1]
        require(len(tops)==1,"reader top scope")
        # Only actual retained hierarchy is instantiated; inline compiler contexts
        # remain context records, never invented RTL module occurrences.
        expanded=[]
        def walk(module,path):
            expanded.append({"definition":module,"path":path})
            for name,c in model["modules"][module]["cells"].items():
                if c["type"] in model["modules"]:walk(c["type"],path+[name])
        walk(tops[0],[tops[0]])
        for link in [x for x in links if x["target"]["artifactSha256"]==artifact]:
            link["implementationOccurrences"]=[x["path"] for x in expanded if x["definition"]==link["target"]["module"]]
            link["id"]=fingerprint(link)
    linked_roots={x["compilerRootId"] for x in links}
    for root in roots:
        if root["id"] not in linked_roots:unresolved.append({"compilerRootId":root["id"],"origin":root["origin"],"module":root["module"],"status":"unsupported-no-emitted-root","gaps":root["gaps"],"notAnObservedRemoval":True})
    return links,unresolved,populations,hierarchy


def build(run):
    records,mints,stages,log_sha=parse_compiler(run)
    identities=json.loads((run/"inputs/execution-identities.json").read_text())
    require(identities["originAdapterSha256"]==sha(Path(__file__)),"origin adapter identity mismatch")
    roots=compiler_roots(records,mints,stages)
    links,unresolved,population,hierarchy=reader_links(run,roots)
    rooted={r["origin"] for r in roots}
    for token in sorted(mints.keys()-rooted):
        unresolved.append({"origin":token,"status":"binding-context-only-no-stage-root","notAnObservedRemoval":True,"compilerContexts":sorted({r["moduleContext"] for r in records if r["moduleContext"] is not None and token in r["observation"].get("origins",[])})})
    good=[x for x in links if x["status"]=="verified-known-contributor" and x["target"]["kind"]=="leaf-cell"]
    artifacts={label:sha(run/"results/instrumented"/label/"design.json") for label in "ABC"}
    return {"schema":"g3-supported-root-origin-v1","provider":"isolated-bsc-ghc96-root-observer-v1","sourcePin":"9bd39e6f3d54d314a94ce30339a224bb283cbade","compilerBinarySha256":identities["instrumentedBscSha256"],"patchSha256":identities["patchSha256"],"originAdapterSha256":identities["originAdapterSha256"],"compilerLogSha256":log_sha,"artifacts":artifacts,"supportedScope":"unique compiler-carried storage binding / binary RHS roots, unchanged structural-root boundaries plus witnessed conversions, singleton positive-edge DFF lowering, direct scalar operator operands; parameter AST derivation and changed operand rewrites remain partial","sourceOrigins":list(mints.values()),"compilerObservations":records,"compilerRoots":roots,"links":links,"unresolved":unresolved,"hierarchyBindings":hierarchy,"coverage":{"leafPopulation":[x for x in population if x["kind"]=="leaf-cell"],"leafPopulationSha256":fingerprint([x for x in population if x["kind"]=="leaf-cell"]),"verifiedKnownContributorLeafDefinitions":len(good),"completeOriginSetLeafDefinitions":0,"observedTaggedLeafDefinitions":sum(x["target"]["kind"]=="leaf-cell" for x in links),"historicalBaselineUntouched":{"storage":[0,8],"outermostExpressions":[0,22],"leafCells":[0,53],"definitionAliases":[0,168]}},"limitations":["captured caller-approved experiment evidence, not cryptographic attestation of arbitrary imported sidecars","source spans are compiler-minted declarator/RHS spans, not full semantic declaration bodies","stage-boundary preservation is checked for unique carried roots, not universal AST provenance","complete supported-origin sets are not asserted","no generated/reset/mux/alias origin inferred from connectivity or containment","no missing-name optimized-away claims"]}


def validate_sidecar(run, payload):
    expected=build(Path(run).resolve())
    require(payload==expected,"sidecar contradicts independently reduced captured evidence")
    return expected


if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--run",required=True,type=Path)
    mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument("--output",type=Path);mode.add_argument("--verify",type=Path);a=parser.parse_args()
    result=build(a.run.resolve())
    if a.verify:
        require(a.verify.stat().st_size<=64*1024*1024,"sidecar size limit")
        validate_sidecar(a.run,json.loads(a.verify.read_text()))
    else:a.output.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({"links":len(result["links"]),"verifiedKnownContributorLeafDefinitions":result["coverage"]["verifiedKnownContributorLeafDefinitions"],"completeOriginSets":0}))
