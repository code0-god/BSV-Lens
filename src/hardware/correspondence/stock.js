'use strict';

const { failure, stable } = require('../json');
const { logicalRef } = require('../snapshot');
const { normalizeRange } = require('./source');
const { findMatchingDelimiter, splitTopLevel, maskCommentsAndStrings } = require('../../architecture/source-utils');
const { analyzeTypeWidth } = require('../../architecture/type-analysis');
const fail = message => { throw failure('CONTRADICTION',message); };
const eq = (a,b,label) => {if(stable(a)!==stable(b)) fail(label);};

// Tcl LIST decoding only: substitutions and commands are never evaluated.
function tclList(text) {
    if(typeof text!=='string') fail('Tcl list must be text');
    const result=[];
    for(let i=0;i<text.length;) {
        if(/\s/.test(text[i])) {i++;continue;}
        let value='',depth=0;
        const braced=text[i]==='{';
        if(braced){depth=1;i++;}
        while(i<text.length) {
            const ch=text[i++];
            if(ch==='\\') {if(i>=text.length) fail('Incomplete Tcl escape');value+=text[i++];continue;}
            if(braced) {
                if(ch==='{') depth++;
                if(ch==='}') {depth--;if(depth===0)break;}
                value+=ch;
            } else {if(/\s/.test(ch))break;value+=ch;}
        }
        if(depth) fail('Unbalanced Tcl list');
        result.push(value);
    }
    return result;
}
function fields(list) {
    const map=new Map();
    for(const entry of list) {const [key,...value]=tclList(entry);if(map.has(key))fail('Duplicate Tcl field');map.set(key,value.join(' '));}
    return map;
}
function stockMetadata(data) {
    const m=data;
    if(m.schema!=='g1-bluetcl-metadata-experiment-v1') throw failure('UNSUPPORTED','Unknown stock metadata schema');
    if(!Array.isArray(m.records)||!Array.isArray(m.modules)||!Array.isArray(m.hierarchy)||typeof m.top!=='string') fail('Malformed stock capture');
    const commands=new Map();
    m.records.forEach((r,index)=>{if(!Array.isArray(r.command)||r.command.some(x=>typeof x!=='string')||typeof r.result!=='string')fail('Invalid raw command');
        const key=stable(r.command);if(commands.has(key))fail('Duplicate raw command');commands.set(key,{...r,index});});
    function record(command) {const r=commands.get(stable(command));if(!r)fail(`Missing stock record ${command.join(' ')}`);return r;}
    const names=new Set();
    for(const [index,module] of m.modules.entries()) {
        if(names.has(module.name))fail('Duplicate compiler module');names.add(module.name);
        if(!Array.isArray(module.definitionPosition)||module.definitionPosition.length!==3||!Array.isArray(module.methods)||!Array.isArray(module.instances))fail('Invalid compiler module');
        const positionRecords=m.records.filter(r=>r.command[0]==='Bluetcl::bpackage'&&r.command[1]==='position'&&r.command[2]?.split('::').at(-1)===module.name);
        if(positionRecords.length!==1)fail('Ambiguous/missing qualified module position');
        eq(tclList(positionRecords[0].result),module.definitionPosition,'Compiler module position contradicts raw capture');
        module._qualifiedName=positionRecords[0].command[2];
        const ports=fields(tclList(record(['Bluetcl::module','ports',module.name]).result));
        eq(ports.get('args'),module.moduleArgs,'Module clock/reset/parameter contract contradiction');
        const rows=tclList(ports.get('interface')||'').map(tclList);
        if(rows.some(r=>r[0]!=='method'))throw failure('UNSUPPORTED','Nested stock interface capture not supported');
        eq(rows.length,module.methods.length,'Method population contradiction');
        const types=new Map(tclList(record(['Bluetcl::module','porttypes',module.name]).result).map(tclList));
        const methodNames=new Set();
        for(const method of module.methods) {
            if(methodNames.has(method.name))fail('Duplicate method');methodNames.add(method.name);
            const row=rows.filter(r=>r[1]===method.name);
            if(row.length!==1)fail('Method not in raw contract');
            const f=fields(row[0].slice(3));
            eq(row[0][2],method.rtlName,'RTL method name contradiction');
            for(const role of ['enable','ready','result','clock','reset'])eq(f.get(role)||'',method[role],`Method ${role} contradicts raw contract`);
            const args=tclList(f.get('args')||'').map(a=>Object.fromEntries([...fields(tclList(a))].map(([k,v])=>[k,k==='size'?Number(v):v])));
            eq(args,method.args,'Method arguments contradict raw contract');
            eq(record(['Bluetcl::rule','full',module.name,method.name]).result,method.rawRule,'Method rule contradicts raw record');
            for(const arg of args) {if(!Number.isSafeInteger(arg.size)||arg.size<1||arg.size>65536)fail('Invalid argument width');}
        }
        const rawInstances=tclList(record(['Bluetcl::submodule','full',module.name]).result).map(tclList);
        eq(rawInstances.length,module.instances.length,'Instance population contradiction');
        for(const instance of module.instances) {
            const rows=rawInstances.filter(r=>r[0]===instance.name);if(rows.length!==1)fail('Duplicate/missing instance');
            const row=rows[0],f=fields(row.slice(2));
            eq(row[1],instance.definition,'Instance definition contradiction');
            eq(tclList(f.get('position')||''),instance.position,'Instance position contradiction');
            eq(tclList(f.get('mports')||'').map(tclList),instance.mports,'Instance port contract contradiction');
        }
        module._index=index;module._types=Object.fromEntries(types);
    }
    const nodes=new Map();
    for(const [index,node] of m.hierarchy.entries()) {
        if(!Number.isSafeInteger(node.key)||node.key<1||nodes.has(node.key))fail('Duplicate/invalid compiler occurrence');
        nodes.set(node.key,node);
        const raw=tclList(record(['Bluetcl::browseinst','detail',String(node.key)]).result);
        if(raw.length%2)fail('Invalid browse detail');
        const fields=Object.fromEntries(Array.from({length:raw.length/2},(_,i)=>[raw[i*2],raw[i*2+1]]));
        const normalized={...node};delete normalized.key;delete normalized.parent;
        eq(fields,normalized,'Hierarchy contradicts raw browse detail');
        node._index=index;
    }
    for(const node of m.hierarchy) {
        if(node.parent!==0&&!nodes.has(node.parent))fail('Dangling compiler parent');
        const siblings=tclList(record(['Bluetcl::browseinst','list',String(node.parent)]).result).map(tclList);
        if(siblings.filter(row=>Number(row[0])===node.key).length!==1)fail('Compiler parent contradicts raw browse list');
        const seen=new Set();let cursor=node;
        while(cursor){if(seen.has(cursor.key))fail('Circular compiler hierarchy');seen.add(cursor.key);cursor=nodes.get(cursor.parent);}
    }
    return {metadata:m,record};
}
function compilerPoint(position,documents) {
    const p=Array.isArray(position)?position:tclList(position);
    if(p.length!==3)fail('Invalid compiler point');
    logicalRef(p[0]);
    const doc=documents.find(d=>d.pathRef===p[0]);
    if(!doc)throw failure('PATH_DENIED','Compiler source is not registered in evidence set');
    const line=Number(p[1]),column=Number(p[2]);
    // Captured provider is empirically ASCII-only. Do not guess its Unicode/tab convention.
    const prefix=doc.text.split('\n')[line-1]?.slice(0,column-1);
    if(prefix===undefined||/[^\x20-\x7e]/.test(prefix))throw failure('UNSUPPORTED','Stock point column convention only verified on ASCII without tabs');
    const range=normalizeRange(doc.text,{unit:'position',encoding:'codepoint',base:1,start:{line,column},end:{line,column}});
    return {pathRef:doc.pathRef,contentHash:doc.contentHash,range,convention:'stock-ascii-1-based-point'};
}
function positionMatches(point,range,documents) {
    const p=compilerPoint(point,documents);
    if(range?.uri!==p.pathRef)return false;
    const r=normalizeRange(documents.find(d=>d.pathRef===p.pathRef).text,{unit:'position',encoding:'utf16',base:0,
        start:{line:range.line,column:range.column},end:{line:range.endLine,column:range.endColumn}});
    return p.range.start>=r.start&&p.range.start<r.end;
}
function parseRtl(document) {
    const text=maskCommentsAndStrings(document.text);
    const modules=[...text.matchAll(/\bmodule\s+([A-Za-z_$][\w$]*)\s*\(/g)];
    if(modules.length!==1)throw failure('UNSUPPORTED','One non-ANSI emitted module per registered RTL supported');
    const module=modules[0],ports=new Map();
    for(const match of text.matchAll(/\b(input|output|inout)\s*(?:\[\s*(\d+)\s*:\s*(\d+)\s*\]\s*)?([A-Za-z_$][\w$]*)\s*;/g)) {
        if(ports.has(match[4]))fail('Duplicate RTL port');
        ports.set(match[4],{name:match[4],direction:match[1],width:match[2]===undefined?1:Math.abs(Number(match[2])-Number(match[3]))+1,
            start:match.index,end:match.index+match[0].length,nameStart:match.index+match[0].lastIndexOf(match[4]),
            nameEnd:match.index+match[0].lastIndexOf(match[4])+match[4].length});
    }
    const instances=new Map();
    const re=/\b([A-Za-z_$][\w$]*)\s*(#\s*\(|\s+[A-Za-z_$][\w$]*\s*\()/g;
    let match;
    while((match=re.exec(text))) {
        if(match[1]==='module')continue;
        let cursor=match.index+match[1].length;
        while(/\s/.test(text[cursor]||''))cursor++;
        let parameters='';
        if(text[cursor]==='#') {
            const open=text.indexOf('(',cursor),close=findMatchingDelimiter(text,open,'(',')');
            if(close<0)fail('Unbalanced RTL parameters');parameters=text.slice(open+1,close);cursor=close+1;
        }
        const name=/^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(text.slice(cursor));
        if(!name)continue;
        const open=cursor+name[0].lastIndexOf('('),close=findMatchingDelimiter(text,open,'(',')');
        if(close<0)fail('Unbalanced RTL instance');
        const body=text.slice(open+1,close);
        if(!body.trim().startsWith('.'))continue;
        const connections=new Map();
        for(const part of splitTopLevel(body,',')) {
            const pin=/^\s*\.([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*$/.exec(part);
            if(!pin)throw failure('UNSUPPORTED','Only named RTL instance connections supported');
            if(connections.has(pin[1]))fail('Duplicate RTL connection');connections.set(pin[1],pin[2].trim());
        }
        if(instances.has(name[1]))fail('Duplicate RTL instance');
        instances.set(name[1],{name:name[1],type:match[1],parameters,connections,start:match.index,end:close+1});
        re.lastIndex=close+1;
    }
    return {document,name:module[1],ports,instances,start:module.index,end:text.indexOf('endmodule',module.index)+9};
}
function rtlVector(expression,rawDefinition) {
    const expressionText=expression.trim();
    if(!expressionText)return [];
    if(expressionText.startsWith('{')&&expressionText.endsWith('}'))return splitTopLevel(expressionText.slice(1,-1),',').reverse().flatMap(x=>rtlVector(x,rawDefinition));
    const match=/^([A-Za-z_$][\w$]*)(?:\[\s*(\d+)\s*(?::\s*(\d+)\s*)?\])?$/.exec(expressionText);
    if(match) {
        const net=rawDefinition.netnames?.[match[1]];if(!net)fail('RTL connection missing actual artifact alias');
        if(match[2]===undefined)return net.bits;
        const first=Number(match[2]),last=match[3]===undefined?first:Number(match[3]),step=first>=last?1:-1,result=[];
        for(let n=last;;n+=step){const index=net.upto?net.bits.length-1-(n-(net.offset||0)):n-(net.offset||0);
            if(index<0||index>=net.bits.length)fail('RTL select out of bounds');result.push(net.bits[index]);if(n===first)break;}
        return result;
    }
    const constant=/^(\d+)'([bdh])([\da-fxz]+)$/i.exec(expressionText);
    if(constant){const width=Number(constant[1]);if(width<1||width>65536)fail('Invalid constant width');
        if(/^[xz]+$/i.test(constant[3]))return Array(width).fill(constant[3][0].toLowerCase());
        if(/[xz]/i.test(constant[3]))throw failure('UNSUPPORTED','Mixed unknown RTL literal');
        const n=BigInt((constant[2].toLowerCase()==='h'?'0x':constant[2].toLowerCase()==='b'?'0b':'')+constant[3]);
        return Array.from({length:width},(_,i)=>String(Number((n>>BigInt(i))&1n)));}
    throw failure('UNSUPPORTED','RTL binding expression is not a literal/alias/select/concat');
}
function concreteWidth(type) {const width=analyzeTypeWidth(type);return width.status==='exact'?width.bits:null;}
module.exports={tclList,fields,stockMetadata,compilerPoint,positionMatches,parseRtl,rtlVector,concreteWidth,eq,fail};
