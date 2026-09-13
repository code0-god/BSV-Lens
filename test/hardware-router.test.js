'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { layout, fitViewport, ROUTING_LIMITS } = require('../media/hardware-layout');
const { createCatalog } = require('../experiments/hardware/g4/server');
const size = { width: 1100, height: 650 };

function synthetic(count = 16) {
    const children = Array.from({ length: count }, (_, i) => ({ id: `node-${i}`, label: `unit ${i}` }));
    const contacts = children.flatMap(n => ['input', 'output'].map(direction => ({
        id: `${n.id}/${direction}`, ownerId: n.id, label: direction, detail: 'Bit#(8)', direction
    })));
    const connections = children.slice(1).map((n, i) => ({ id: `wire-${i}`, style: 'physical', label: `value ${i}`,
        endpointIds: [`node-${i}/output`, `${n.id}/input`] }));
    return { sceneKind: 'rtl', shell: { id: 'root', label: 'Root' }, children, storages: [], contacts, connections };
}
function overlap(a, b) {
    const h = a[1] === a[3];
    if (h !== (b[1] === b[3])) return false;
    const k = h ? 0 : 1;
    return a[1-k] === b[1-k] && Math.min(Math.max(a[k], a[k+2]), Math.max(b[k], b[k+2]))
        > Math.max(Math.min(a[k], a[k+2]), Math.min(b[k], b[k+2]));
}
function penetrates(s, box) {
    return s[1] === s[3] ? s[1] > box.y && s[1] < box.y + box.height
        && Math.max(s[0], s[2]) > box.x && Math.min(s[0], s[2]) < box.x + box.width
        : s[0] > box.x && s[0] < box.x + box.width
        && Math.max(s[1], s[3]) > box.y && Math.min(s[1], s[3]) < box.y + box.height;
}
function topology(route) {
    const vertices = new Map(), add = (x,y) => vertices.set(`${x},${y}`, {x,y,edges:new Set()});
    for(const s of route.segments) { add(s[0],s[1]);add(s[2],s[3]); }
    for(const a of route.segments) for(const b of route.segments) {
        if((a[1]===a[3])===(b[1]===b[3]))continue;
        const h=a[1]===a[3]?a:b,v=a[1]===a[3]?b:a;
        if(v[0]>=h[0] && v[0]<=h[2] && h[1]>=v[1] && h[1]<=v[3])add(v[0],h[1]);
    }
    for(const s of route.segments) {
        const points=[...vertices.values()].filter(p=>p.x>=Math.min(s[0],s[2]) && p.x<=Math.max(s[0],s[2])
            && p.y>=Math.min(s[1],s[3]) && p.y<=Math.max(s[1],s[3])).sort((a,b)=>a.x-b.x || a.y-b.y);
        for(let i=1;i<points.length;i++) { points[i].edges.add(points[i-1]);points[i-1].edges.add(points[i]); }
    }
    const allowed=new Set(route.attachments.map(p=>`${p.x},${p.y}`));
    if(route.attachments.length===1)allowed.add(`${route.attachments[0].escapeX},${route.attachments[0].y}`);
    if(!route.unconnected)for(const [id,p] of vertices)assert.ok(p.edges.size!==1 || allowed.has(id),`dangling ${route.id} at ${id}`);
    const reached=new Set(),pending=[vertices.values().next().value];
    while(pending.length) { const p=pending.pop();if(reached.has(p))continue;reached.add(p);pending.push(...p.edges); }
    assert.equal(reached.size,vertices.size,`disconnected ${route.id}`);
    return [...vertices.values()].filter(p=>p.edges.size>=3).map(p=>`${p.x},${p.y}`).sort();
}
function check(scene, g) {
    assert.deepEqual(g.routes.map(r => r.id), scene.connections.map(c => c.id));
    assert.equal(new Set(g.labels.map(label => label.id)).size, g.labels.length);
    const painted = [];
    for (const label of g.labels) {
        assert.ok(label.text && label.fullText && label.role && label.ownerId);
        if (label.foldedReason !== undefined) {
            const route = g.routes.find(route => route.id === label.ownerId);
            const connection = scene.connections.find(connection => connection.id === label.ownerId);
            assert.deepEqual(Object.keys(label).sort(), ['id', 'ownerId', 'role', 'fullText', 'text', 'x', 'y', 'anchor', 'bounds', 'foldedReason'].sort());
            assert.ok(route && connection); assert.equal(label.role, 'connection');
            assert.ok(label.foldedReason === 'no-label-clearance' || label.foldedReason === 'overview-detail'
                && scene.sceneKind === 'bsv' && scene.projection?.kind === 'bsv-overview');
            assert.equal(label.id, `${route.id}:label`);
            assert.equal(label.fullText, connection.label); assert.equal(label.text, connection.label);
            assert.equal(label.bounds, null); assert.equal(label.anchor, 'start');
            assert.ok(Number.isFinite(label.x) && Number.isFinite(label.y));
            assert.ok(label.x >= g.bounds.x && label.y >= g.bounds.y
                && label.x <= g.bounds.x + g.bounds.width && label.y <= g.bounds.y + g.bounds.height);
            assert.ok(route.attachments.some(point => point.x === label.x && point.y === label.y));
            assert.deepEqual(route.label, label); assert.equal(route.labelBounds, null);
            assert.equal(route.labelX, label.x); assert.equal(route.labelY, label.y); assert.equal(route.labelAnchor, label.anchor);
        } else {
            assert.ok(label.bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(label.bounds[key]))
                && label.bounds.width > 0 && label.bounds.height > 0, `painted label bounds ${label.id}`);
            assert.ok(label.bounds.x >= 0 && label.bounds.y >= 0);
            assert.ok(label.bounds.x + label.bounds.width <= g.bounds.width);
            assert.ok(label.bounds.y + label.bounds.height <= g.bounds.height);
            painted.push(label);
        }
    }
    for (const r of g.routes) {
        assert.ok(r.segments.length, r.id);
        const branches=topology(r),physical=scene.connections.find(c=>c.id===r.id).style==='physical';
        assert.deepEqual(r.junctions.map(p=>`${p.x},${p.y}`).sort(),physical?branches:[]);
        assert.equal(r.path, r.segments.map(s => `M${s[0]},${s[1]}L${s[2]},${s[3]}`).join(' '));
        for (const s of r.segments) {
            assert.ok(s.every(Number.isFinite));
            assert.ok((s[0] === s[2]) !== (s[1] === s[3]));
            for (const n of g.nodes.slice(1)) assert.ok(!penetrates(s, n), `body ${r.id}: ${n.id}`);
            for (const l of painted) assert.ok(!penetrates(s, l.bounds), `label ${r.id}: ${l.id}`);
            for(const c of g.contacts)for(const p of c.slots.length?c.slots:[c]) {
                if(p.connectionId===r.id)continue;
                assert.ok(!penetrates(s,{x:p.x-4,y:p.y-4,width:8,height:8}),`foreign slot ${r.id}: ${p.id}`);
            }
        }
        for (const p of r.attachments) {
            assert.ok(r.segments.some(s => [0, 2].some(i => s[i] === p.x && s[i+1] === p.y)), `attachment ${p.id}`);
        }
    }
    for (let i=0;i<g.routes.length;i++) for(let j=i+1;j<g.routes.length;j++) {
        for(const a of g.routes[i].segments) for(const b of g.routes[j].segments)
            assert.ok(!overlap(a,b), `overlap ${g.routes[i].id} / ${g.routes[j].id}`);
    }
    assert.ok(g.metrics.totalRouteLength >= 0);
    return painted;
}

function foldedFixture() {
    const scene = synthetic(2), geometry = layout(scene, size), route = geometry.routes[0];
    const label = geometry.labels.find(item => item.ownerId === route.id), point = route.attachments[0];
    Object.assign(label, { x: point.x, y: point.y, anchor: 'start', bounds: null,
        text: scene.connections[0].label, fullText: scene.connections[0].label, foldedReason: 'no-label-clearance' });
    delete label.textWidth;
    Object.assign(route, { label, labelBounds: null, labelX: label.x, labelY: label.y, labelAnchor: label.anchor });
    return { scene, geometry, label, route };
}

test('router check accepts only explicit canonical folded connection labels with real attachment anchors', () => {
    const value = foldedFixture(); check(value.scene, value.geometry);
    assert.equal(value.geometry.routes.length, value.scene.connections.length);
    for (const mutate of [
        f => { f.label.role = 'node-title'; }, f => { f.label.ownerId = 'root'; },
        f => { f.label.id = 'foreign-label'; }, f => { f.label.fullText = 'foreign'; },
        f => { f.label.text = 'foreign'; }, f => { f.label.foldedReason = 'unverified'; },
        f => { f.label.bounds = { x: 0, y: 0, width: 1, height: 1 }; },
        f => { f.label.x = NaN; }, f => { f.label.y += 1; }, f => { f.label.anchor = 'end'; },
        f => { f.label.extra = true; }, f => { f.route.label = { ...f.label, text: 'foreign' }; },
        f => { f.route.labelBounds = { x: 0, y: 0, width: 1, height: 1 }; },
        f => { f.route.labelX += 1; }, f => { f.route.labelY += 1; }, f => { f.route.labelAnchor = 'end'; },
        f => { f.geometry.labels.push({ ...f.label }); },
        f => { f.geometry.labels.find(label => label.role === 'node-title').bounds = null; }
    ]) {
        const invalid = foldedFixture(); mutate(invalid);
        assert.throws(() => check(invalid.scene, invalid.geometry), { code: 'ERR_ASSERTION' });
    }
});

test('router reserves first/last escapes and reuses disjoint intervals beyond old modulo periods', () => {
    const s = synthetic(26), before = JSON.stringify(s), g = layout(s,size);
    check(s,g);
    assert.equal(JSON.stringify(s),before);
    assert.deepEqual(layout(s,size),g);
    const h = g.routes.flatMap(r=>r.segments.filter(s=>s[1]===s[3]).map(s=>({id:r.id,s})));
    assert.ok(h.some((a,i)=>h.slice(i+1).some(b=>a.id!==b.id && a.s[1]===b.s[1] && !overlap(a.s,b.s))), 'tracks reused');
});

test('shared vector contact has per-incidence exact indices and bit IDs, not a shared escape', () => {
    const s=synthetic(3), common=s.contacts.find(c=>c.id==='node-2/input');
    common.bits=['scope/b0','scope/b1','scope/b2'];
    s.connections=[0,1].map(i=>({id:`slice-${i}`,style:'physical',label:'same name',
        endpointIds:[`node-${i}/output`,common.id],bits:[common.bits[i]],members:[{bitId:common.bits[i],
            endpoints:[{entityId:`node-${i}/output`,index:0},{entityId:common.id,index:i}]}]}));
    const g=layout(s,size);check(s,g);
    const slots=g.contacts.find(c=>c.id===common.id).slots;
    assert.equal(slots.length,2);
    assert.notEqual(slots[0].y,slots[1].y);
    for(let i=0;i<2;i++) {
        const slot=slots.find(v=>v.connectionId===`slice-${i}`);
        assert.deepEqual(slot.indices,[i]);assert.deepEqual(slot.bitIds,[common.bits[i]]);
        assert.equal(slot.contactId,common.id);
    }
});

test('slot index/bit pairs retain reordered members and repeated endpoint positions', () => {
    const s=synthetic(3),p=s.contacts.find(c=>c.id==='node-2/input');
    p.direction='inout';p.bits=['scope/x','scope/y','scope/x'];
    s.connections=[{id:'multi-driver',style:'physical',label:'same value',bits:['scope/y','scope/x'],
        endpointIds:['node-0/output','node-1/output',p.id],
        members:[{bitId:'scope/y',endpoints:[{entityId:p.id,index:1},{entityId:'node-0/output',index:0}]},
            {bitId:'scope/x',endpoints:[{entityId:p.id,index:0},{entityId:p.id,index:2},{entityId:'node-1/output',index:0}]}]}];
    const before=JSON.stringify(s),g=layout(s,size);check(s,g);
    const slot=g.contacts.find(c=>c.id===p.id).slots[0];
    assert.deepEqual(slot.indices,[1,0,2]);assert.deepEqual(slot.bitIds,['scope/y','scope/x','scope/x']);
    assert.equal(JSON.stringify(s),before);
});

test('same connection fanout yields an owned tree and supported junctions', () => {
    const s=synthetic(4);s.connections=[{id:'fanout',style:'physical',label:'fanout',
        endpointIds:['node-0/output','node-1/input','node-2/input','node-3/input']}];
    const g=layout(s,size);check(s,g);assert.ok(g.routes[0].junctions.length);
});

test('detached/single-contact vectors, group anchors and long labels remain explicit', () => {
    const s=synthetic(2);s.interfaceGroups=[{id:'interface',ownerId:'root',label:'Interface',memberContactIds:[]}];
    s.connections.push({id:'empty',endpointIds:[],style:'physical',label:'detached'},
        {id:'single',endpointIds:['node-0/input'],style:'physical',label:'literal'},
        {id:'group-return',endpointIds:['interface','node-1/output'],style:'semantic',label:'source return '.repeat(40)});
    const g=layout(s,size);check(s,g);
    assert.equal(g.routes.find(r=>r.id==='empty').unconnected,true);
    assert.deepEqual(g.routes.find(r=>r.id==='empty').points,[]);
    assert.ok(g.groups.some(v=>v.id==='interface'));
    assert.ok(!g.contacts.some(v=>v.id==='interface'));
    assert.ok(g.labels.find(v=>v.ownerId==='group-return').fullText.length>g.labels.find(v=>v.ownerId==='group-return').text.length);
});

test('budgets fail explicitly before publishing partial geometry; missing endpoints are errors', () => {
    assert.ok(ROUTING_LIMITS.maxExpansions>0);
    for(const name of ['maxNodes','maxContacts','maxConnections','maxIncidences','maxVertices','maxExpansions',
        'maxChecks','maxHeapEntries','maxSegments','maxDimension','maxPasses','maxLabelCandidates']) {
        assert.throws(()=>layout(synthetic(),size,{limits:{[name]:0}}),{code:'ROUTING_BUDGET_EXCEEDED'},name);
    }
    const s=synthetic();s.connections[0].endpointIds.push('foreign');
    assert.throws(()=>layout(s,size),/endpoint/i);
});

test('real A/left retains all 16 vectors and proper crossings without dots or dangling escapes', async () => {
    const query=(await createCatalog()).find(q=>q.getCatalogEntry().buildId==='A'),entry=query.getCatalogEntry();
    const base={buildId:entry.buildId,snapshotId:entry.snapshotId,queryGeneration:1};
    const left=query.getScene(base).scene.children.find(c=>c.label==='left');
    const s=query.getScene({...base,rootInstanceId:left.id,ownerInstanceId:left.id,sceneKind:'rtl',implementationProvider:'instrumented'}).scene;
    const g=layout(s,size);check(s,g);assert.equal(g.routes.length,16);assert.ok(g.crossings.length>0);
    for(const p of g.crossings)for(const r of g.routes)assert.ok(!r.junctions.some(j=>j.x===p.x && j.y===p.y));
});

test('long contact/node identifiers retain accessible source text and bounded painted widths', () => {
    const s=synthetic(4);s.children[0].label='W'.repeat(500);s.contacts[0].label='W'.repeat(700);
    s.contacts[0].detail='very long concrete type '.repeat(80);
    for(const v of [{width:1100,height:650},{width:375,height:500}]) {
        const g=layout(s,v),painted=check(s,g);
        for(const l of painted)assert.ok(l.textWidth>0 && l.textWidth<l.bounds.width);
        assert.equal(g.labels.find(l=>l.ownerId===s.contacts[0].id && l.role==='contact-label').fullText,s.contacts[0].label);
    }
});

test('small A/B source scenes improve bounds and route length without inflating renderer fonts', async () => {
    const before={A:{width:1584,height:708,length:1464},B:{width:1512,height:756,length:3840}};
    const historical = require('./fixtures/hardware-historical-source-scenes.json');
    for(const [buildId, record] of Object.entries(historical.scenes)) {
        const s=record.scene, previous=before[buildId];
        assert.equal(require('node:crypto').createHash('sha256').update(JSON.stringify(s, null, 2)).digest('hex'), record.sha256);
        const g=layout(s,size);check(s,g);
        assert.ok(g.bounds.width<previous.width,`${buildId} source width`);
        assert.ok(g.bounds.height<previous.height,`${buildId} source height`);
        assert.ok(g.metrics.totalRouteLength<previous.length,`${buildId} source length`);
        console.log(JSON.stringify({sourceReadability:buildId,inputContract:'historical-presentation',before:previous,after:g.metrics,fit:fitViewport(g,size)}));
    }
});

test('all actual 18 RTL and 11 BSV scenes route completely with intact truth and recorded metrics', async () => {
    let rtl=0,bsv=0;
    for(const query of await createCatalog()) {
        const entry=query.getCatalogEntry();
        for(const provider of ['stock','instrumented']) {
            const queue=[null],seen=new Set();
            while(queue.length) {
                const context=queue.shift();
                const s=query.getScene({buildId:entry.buildId,snapshotId:entry.snapshotId,queryGeneration:1,
                    rootInstanceId:entry.rootInstanceId,ownerInstanceId:entry.rootInstanceId,sceneKind:'rtl',
                    implementationProvider:provider,...(context?{implementationContext:context}:{})}).scene;
                if(seen.has(s.shell.id))continue;seen.add(s.shell.id);rtl++;
                const before=JSON.stringify(s);
                for(const viewport of [size,{width:375,height:500}]) {
                    const started=performance.now(),g=layout(s,viewport);check(s,g);
                    assert.equal(JSON.stringify(s),before);
                    const fit=fitViewport(g,viewport);
                    assert.ok(fit.x>=0 && fit.y>=0 && fit.x+g.bounds.width*fit.scale<=viewport.width
                        && fit.y+g.bounds.height*fit.scale<=viewport.height);
                    console.log(JSON.stringify({case:entry.buildId,provider,path:s.header.subtitle,viewport,milliseconds:performance.now()-started,...g.metrics}));
                }
                for(const child of s.children.filter(v=>v.interaction.kind==='enter'))queue.push({...s.implementationContext,contextOccurrenceId:child.id});
            }
        }
        const queue=[entry.rootInstanceId];
        while(queue.length) {
            const owner=queue.shift(),s=query.getScene({buildId:entry.buildId,snapshotId:entry.snapshotId,queryGeneration:1,
                rootInstanceId:owner,ownerInstanceId:owner,sceneKind:'bsv'}).scene;
            bsv++;
            for(const viewport of [size,{width:375,height:500}]) {
                const g=layout(s,viewport);check(s,g);
                const view=fitViewport(g,viewport);assert.ok(view.scale>0);
            }
            queue.push(...s.children.map(c=>c.id));
        }
    }
    assert.equal(rtl,18);assert.equal(bsv,11);
});
