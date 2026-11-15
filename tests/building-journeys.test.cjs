// Runs the actual route-selection code and shipped graphs, without browser drawing.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const index = read('index.html');
const nav = read('wayframe/navigation-demo.html');
const Planner = require('../wayframe/route-planner.js');
const keys = ['main','rabin','student','madriga','education','multi-purpose'];
const graphs = Object.fromEntries(keys.map(key => [key, JSON.parse(read(`buildings/${key}/${key}-indoor-graph.json`))]));
function section(source, start, end) {
  return require('./helpers/campus-harness.cjs').between(
    source,
    start,
    end
  );
}
function storage(){
  const data = new Map();
  return {getItem:k => data.get(k) ?? null, setItem:(k,v) => data.set(k,String(v)), removeItem:k => data.delete(k), clear:() => data.clear()};
}
function makeHarness(status = {}){
  const elements = new Map();
  const element = id => {
    if(!elements.has(id)) elements.set(id, {value:'',textContent:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},remove(){},setAttribute(){}});
    return elements.get(id);
  };
  const layer = {addTo(){return this;},setStyle(){},getBounds(){return [];}};
  const context = vm.createContext({
    console:{log(){},warn(){},error(){}}, URL, URLSearchParams,
    CampusRoutePlanner:Planner, sessionStorage:storage(), localStorage:storage(),
    document:{getElementById:element},
    setInterval:() => 0, clearInterval(){},
    L:{polyline:() => layer}, map:{removeLayer(){},fitBounds(){}},
    fetch:async url => ({ok:true,json:async () => String(url).endsWith('campus-status.json') ? status : JSON.parse(read(String(url)))})
  });
  context.window = context;
  const run = code => vm.runInContext(code, context);
  run(read('app/prototype/data.js'));
  run(read('app/prototype/outdoor-routing.js'));
  run(read('app/ui/campus-status.js'));
  run(`var currentProfile='general', lang='en', customStart=null, routeLine=null, gpsMarker=null;
    var currentOutdoorDestination=null, keepIndoorContextForCurrentRoute=false, outdoorRouteRequestId=0;
    var visualVoiceActive=false, emergencyRouteActive=false;
    var indoorSearchGraphsReady=Promise.resolve();
    const t={noAccessibleRoute:'No accessible route',noAccessibleRouteHelp:'',profiles:[]};
    function clearOutdoorEndpointMarkers(){} function renderRouteSteps(){} function speak(){}
    function notify(){} function visualVoiceText(en){return en;}
    function getStart(){return customStart;}
  `);
  for(const [key,global] of Object.entries({main:'MAIN_GRAPH',rabin:'RABIN_GRAPH',student:'STUDENT_GRAPH',madriga:'MADRIGA_GRAPH',education:'EDUCATION_GRAPH','multi-purpose':'MULTI_PURPOSE_GRAPH'})) context[global]=graphs[key];
  run(section(index,'const SHARED_INDOOR_TRANSFERS = {','async function routeTo('));
  // Preserve real entrance comparison, shared-transfer selection and outdoor routing.
  // Replace only the remainder that renders cards and controls.
  run(section(index,'async function routeTo(','const profile = t.profiles.find') + `
    return {sameBuilding, activeSharedTransfer, usesMainToMadrigaChain,
      startingBuildingKey, entranceKey, outdoorResult, waypoints,
      origin:JSON.parse(sessionStorage.getItem('indoorStartContext') || 'null'),
      destination:JSON.parse(sessionStorage.getItem('indoorContext') || 'null'),
      transfer:JSON.parse(sessionStorage.getItem('sharedIndoorTransfer') || 'null'),
      intermediate:JSON.parse(sessionStorage.getItem('intermediateIndoorTransfer') || 'null')};
  }`);
  // Also exercise the indoor page's own graph builder, not only the campus ETA graph.
  run(`var GRAPH=null, testProfile='general';
    
    function $(id){return document.getElementById(id);}
    function allNodes(){return Object.values(GRAPH.floors).flatMap(f=>f.nodes||[]);}
    function selectedRoutingProfile(){return testProfile;}
    function indoorUnavailable(){return {closed:CampusStatus.closedNodes(GRAPH.building),elevatorOut:id=>CampusStatus.isElevatorOut(GRAPH.building,id)};}
  `);
  run(section(nav,'const ORDER = [','const FLOOR_PLAN_FLOORS='));
  run(section(nav,'function cid(n){','function esc('));
  run(
  section(
    nav,
    'function indoorDistanceMeters(',
    'let indoorProgressRoute='
  )
);
  run(section(nav,'function buildGraph(){','function selectedRoutingProfile(){'));
  run(section(nav,'function indoorRouteAdapter(graph){','function indoorPathPreference('));
  return {
    run,context,element,
    async ready(){await run('CampusOutdoorRouting.load()');await run("CampusStatus.load('app/data/campus-status.json')");},
    entrances:key => run(`BUILDING_ENTRANCES[${JSON.stringify(key)}]`),
    nodes:key => Object.values(graphs[key].floors).flatMap(f=>f.nodes||[]),
    indoor(key,from,to,profile='general'){
      context.GRAPH=graphs[key];
      context.testProfile=profile;
      element('accessibleRoute').checked=profile==='mobility';
      return run(`dijkstra(${JSON.stringify(from)},${JSON.stringify(to)})`);
    },
    async journey(fromKey,fromId,toKey,toId,profile='general'){
      context.sessionStorage.clear();
      context.currentProfile=profile;
      const doors=this.entrances(fromKey).filter(e=>!e.onlyForService&&(profile!=='mobility'||(!e.requiresStairs&&!e.avoidForMobility)));
      const entrance=doors.find(e=>e.primary)||doors[0];
      const from=this.nodes(fromKey).find(n=>n.id===fromId);
      assert.ok(from,`${fromKey}: ${fromId} exists`);
      context.customStart={lat:entrance.lat,lng:entrance.lng,label:`Room ${from.label}`,buildingKey:fromKey,nodeId:fromId,entranceId:entrance.nodeId};
      context.sessionStorage.setItem('indoorStartContext',JSON.stringify({buildingKey:fromKey,startNodeId:fromId,exitEntranceId:entrance.nodeId}));
      context.sessionStorage.setItem('indoorContext',JSON.stringify({buildingKey:toKey,destinationNodeId:toId,destinationLabel:this.nodes(toKey).find(n=>n.id===toId)?.label}));
      const name=Object.entries({'Main Building':'main','Rabin Building':'rabin','Student House':'student','Terrace Building':'madriga','Education and Science':'education','Multi-Purpose Building':'multi-purpose'}).find(([,key])=>key===toKey)[0];
      const building=run(`CAMPUS_DATA.buildings.find(b=>b.name===${JSON.stringify(name)})`);
      return run(`routeTo(${JSON.stringify(name)},${building.lat},${building.lng},{keepIndoorContext:true})`);
    }
  };
}
let harness;
async function campus(){if(!harness){harness=makeHarness();await harness.ready();}return harness;}

function validateIndoor(h,key,route,profile){
  assert.ok(route?.length,`${key}: indoor route exists (${profile})`);
  const by=new Map(h.nodes(key).map(n=>[n.id,n]));
  const graph=h.run('buildGraph()');
  for(let i=0;i<route.length;i++){
    assert.ok(by.has(route[i]),`${key}: unknown node ${route[i]}`);
    if(profile==='mobility') assert.notEqual(by.get(route[i]).type,'stairs',`${key}: Mobility enters stairs`);
    if(i===0)continue;
    const a=by.get(route[i-1]),b=by.get(route[i]);
    assert.ok(graph.adj.get(a.id).some(e=>e.id===b.id),`${key}: missing edge ${a.id} → ${b.id}`);
    if(a.floor!==b.floor){
      assert.equal(a.type,b.type,`${key}: mismatched floor-change types`);
      assert.ok(['elevator','stairs'].includes(a.type));
      assert.equal(String(a.connectorId).trim(),String(b.connectorId).trim());
    }
  }
}
function validateOutdoor(h,result,profile){
  assert.ok(result?.coordinates?.length>=2,`Outdoor route exists (${profile})`);
  assert.ok(Number.isFinite(result.distance)&&result.distance>0);
  assert.equal(result.coordinates.length,result.edges.length+3,'Coordinates align with graph edges');
  const routing=h.run('CampusOutdoorRouting');
  for(let i=0;i<result.edges.length;i++){
    const edge=result.edges[i];
    if(profile==='mobility')assert.notEqual(edge.type,'steps','Mobility must avoid outdoor steps');
    const point=result.coordinates[i+1];
    const node=i===0?result.startNode:result.edges[i-1].node;
    const actual=routing.inspectNode(node);
    assert.deepEqual(Array.from(actual.coordinate),Array.from(point));
    assert.ok(actual.connections.some(e=>e.node===edge.node&&e.type===edge.type),`Missing outdoor edge ${node} → ${edge.node}`);
  }
}

for(const profile of ['general','mobility','visual','spatial','mental']){
  test(`all six buildings: same-floor and cross-floor indoor routes (${profile})`,async()=>{
    const h=await campus();
    for(const key of keys){
      const rooms=h.nodes(key).filter(n=>n.type==='room');
      let same=false,cross=false;
      for(const a of rooms){
        if(same&&cross)break;
        for(const b of rooms){
          if(a.id===b.id||(a.floor===b.floor?same:cross))continue;
          const route=h.indoor(key,a.id,b.id,profile);
          if(!route)continue;
          validateIndoor(h,key,route,profile);
          if(a.floor===b.floor)same=true;else cross=true;
          if(same&&cross)break;
        }
      }
      assert.ok(same,`${key}: no same-floor room pair reachable`);
      if(new Set(rooms.map(n=>n.floor)).size>1) assert.ok(cross,`${key}: no cross-floor room pair reachable`);
    }
  });
  for(const [from,to,start,end] of [['madriga','rabin','floor1_n6','floor5_n13'],['rabin','madriga','floor5_n13','floor1_n6']]){
    test(`${from} → ${to}: shared elevator and connected indoor legs (${profile})`,async()=>{
      const h=await campus(),plan=await h.journey(from,start,to,end,profile);
      assert.ok(plan,'Journey selection returns a plan');
      assert.equal(plan.activeSharedTransfer?.method,'elevator');
      assert.equal(plan.outdoorResult,null,'Shared elevator needs no outdoor route');
      const expected=from==='madriga'?['floor4_n43','floor5_n104']:['floor5_n104','floor4_n43'];
      assert.equal(plan.origin.exitEntranceId,expected[0]);
      assert.equal(plan.destination.startNodeId,expected[1]);
      validateIndoor(h,from,h.indoor(from,start,expected[0],profile),profile);
      validateIndoor(h,to,h.indoor(to,expected[1],end,profile),profile);
    });
  }
}

test('Terrace Room 1001 → Multi-Purpose Room 101 uses the repaired closer entrance',async()=>{
  const h=await campus();
  for(const profile of ['general','mobility']){
    const plan=await h.journey('madriga','floor1_n6','multi-purpose','floor1_n92',profile);
    assert.ok(plan,'Journey exists');
    assert.equal(plan.destination.startNodeId,'floor1_n2','Use the Terrace-side Multi-Purpose entrance');
    validateIndoor(h,'madriga',h.indoor('madriga','floor1_n6',plan.origin.exitEntranceId,profile),profile);
    validateIndoor(h,'multi-purpose',h.indoor('multi-purpose',plan.destination.startNodeId,'floor1_n92',profile),profile);
    validateOutdoor(h,plan.outdoorResult,profile);
  }
});

test('Main ↔ Rabin uses the real bridge with the correct indoor endpoints',async()=>{
  const h=await campus();
  for(const profile of ['general','mobility']){
    for(const [from,start,to,end] of [['main','floor700_n69','rabin','floor5_n13'],['rabin','floor5_n13','main','floor700_n69']]){
      const plan=await h.journey(from,start,to,end,profile);
      assert.ok(plan);
      const expected=from==='main'?['floor600_n86','floor7_n108']:['floor7_n108','floor600_n86'];
      if(from==='main'){
        assert.equal(h.nodes('main').find(n=>n.id===plan.origin.exitEntranceId)?.floor,'floor600');
        assert.equal(plan.destination.startNodeId,'floor7_n108');
      }else{
        assert.equal(plan.origin.exitEntranceId,'floor7_n108');
        assert.equal(h.nodes('main').find(n=>n.id===plan.destination.startNodeId)?.floor,'floor600');
      }
      expected[0]=plan.origin.exitEntranceId; expected[1]=plan.destination.startNodeId;
      assert.equal(plan.activeSharedTransfer,null);
      validateOutdoor(h,plan.outdoorResult,profile);
      validateIndoor(h,from,h.indoor(from,start,expected[0],profile),profile);
      validateIndoor(h,to,h.indoor(to,expected[1],end,profile),profile);
      assert.ok(plan.outdoorResult.edges.some(e=>String(e.node).startsWith('campus_main_rabin_bridge')), 'Route traverses the mapped bridge');
    }
  }
});

function representative(h,key){
  const door=h.entrances(key).find(e=>e.primary)||h.entrances(key)[0];
  const room=h.nodes(key).find(n=>n.type==='room'&&h.indoor(key,n.id,door.nodeId,'mobility'));
  assert.ok(room,`${key}: a room is reachable from its primary entrance without stairs`);
  return room.id;
}
for(const profile of ['general','mobility','visual','spatial','mental']){
  for(const from of keys){
    for(const to of keys){
      if(from===to)continue;
      test(`complete building journey ${from} → ${to} (${profile})`,async()=>{
        const h=await campus(),start=representative(h,from),end=representative(h,to);
        const plan=await h.journey(from,start,to,end,profile);
        assert.ok(plan,`${from} → ${to}: no journey returned`);
        assert.equal(plan.destination.buildingKey,to);
        assert.ok(plan.origin?.exitEntranceId,'Origin exit is saved');
        assert.ok(plan.destination.startNodeId,'Destination entrance is saved');
        validateIndoor(h,from,h.indoor(from,start,plan.origin.exitEntranceId,profile),profile);
        validateIndoor(h,to,h.indoor(to,plan.destination.startNodeId,end,profile),profile);
        if(plan.activeSharedTransfer){
          assert.equal(plan.activeSharedTransfer.method,'elevator');
          assert.equal(plan.outdoorResult,null);
        }else{
          validateOutdoor(h,plan.outdoorResult,profile);
        }
        if(plan.usesMainToMadrigaChain){
          assert.equal(plan.intermediate?.building,'rabin');
          if(from==='madriga'){
            assert.equal(plan.origin.exitEntranceId,'floor4_n43','Terrace departure uses the shared elevator');
            assert.equal(plan.intermediate.startNodeId,'floor5_n104','Rabin arrival is the same shared elevator');
            validateIndoor(h,'rabin',h.indoor('rabin','floor5_n104','floor7_n108',profile),profile);
          }else{
            assert.equal(plan.intermediate.startNodeId,'floor7_n108');
            // The indoor shared-elevator handoff sets madrigaTransferEntrance to floor4_n43.
            validateIndoor(h,'madriga',h.indoor('madriga','floor4_n43',end,profile),profile);
            validateIndoor(h,'rabin',h.indoor('rabin','floor7_n108','floor5_n104',profile),profile);
          }
        }else if(!plan.activeSharedTransfer){
          let outdoorOriginKey=from,outdoorOriginId=plan.origin.exitEntranceId;
          if(plan.intermediate?.building==='rabin'&&plan.transfer?.destinationBuilding==='rabin'){
            assert.equal(plan.transfer.method,'elevator','Terrace continuation uses the shared elevator');
            assert.equal(plan.origin.exitEntranceId,'floor4_n43');
            assert.equal(plan.intermediate.startNodeId,'floor5_n104');
            validateIndoor(h,'rabin',h.indoor('rabin',plan.intermediate.startNodeId,plan.intermediate.destinationNodeId,profile),profile);
            outdoorOriginKey='rabin';outdoorOriginId=plan.intermediate.destinationNodeId;
          }
          const originDoor=h.entrances(outdoorOriginKey).find(e=>e.nodeId===outdoorOriginId);
          const destinationDoor=h.entrances(to).find(e=>e.nodeId===plan.destination.startNodeId);
          assert.ok(originDoor&&destinationDoor,'Chosen endpoints are registered entrances');
          assert.deepEqual(Array.from(plan.outdoorResult.coordinates[0]),[originDoor.lat,originDoor.lng],'Outdoor route begins at chosen exit');
          assert.deepEqual(Array.from(plan.outdoorResult.coordinates.at(-1)),[destinationDoor.lat,destinationDoor.lng],'Outdoor route ends at chosen entrance');
        }
      });
    }
  }
}

test('a same-building journey never adds an outdoor leg',async()=>{
  const h=await campus();
  for(const key of keys){
    const start=representative(h,key);
    const end=h.nodes(key).find(n=>n.type==='room'&&n.id!==start&&h.indoor(key,start,n.id,'mobility')).id;
    const plan=await h.journey(key,start,key,end,'mobility');
    assert.equal(plan.sameBuilding,true,key);
    assert.equal(plan.waypoints.length,0,key);
    assert.equal(plan.activeSharedTransfer,null,key);
  }
});

test('Mobility floor changes cannot use an elevator reported out of service',async()=>{
  const key='education';
  const connectors=[...new Set(Object.values(graphs[key].floors).flatMap(f=>f.nodes||[]).filter(n=>n.type==='elevator').map(n=>n.connectorId))];
  assert.ok(connectors.length);
  const h=makeHarness({elevators:connectors.map(elevator=>({building:key,elevator}))});
  await h.ready();
  const rooms=h.nodes(key).filter(n=>n.type==='room');
  const a=rooms[0],b=rooms.find(n=>n.floor!==a.floor);
  assert.ok(b,'Test has rooms on different floors');
  assert.equal(h.indoor(key,a.id,b.id,'mobility'),null,'No cross-floor route with all elevators unavailable');
});

test('a blocked outdoor network returns no invented straight-line route',async()=>{
  const h=await campus(),routing=h.run('CampusOutdoorRouting');
  const door=h.entrances('multi-purpose')[0],start=h.entrances('madriga')[0];
  routing.setRestrictions({blockedAreas:[[[32.757,35.014],[32.768,35.014],[32.768,35.025],[32.757,35.025]]]});
  try{assert.equal(await routing.route(start.lat,start.lng,door.lat,door.lng,{avoidSteps:true}),null);}
  finally{routing.setRestrictions({});}
});

for(const profile of ['general','mobility']){
  for(const position of ['first','last']){
    test(`entrance selection includes the destination indoor leg (${profile}, ${position} Education room)`,async()=>{
      const h=await campus(),from='student',to='education',start=representative(h,from);
      const rooms=h.nodes(to).filter(n=>n.type==='room');
      const end=(position==='first'?rooms[0]:rooms.at(-1)).id;
      const plan=await h.journey(from,start,to,end,profile);
      assert.ok(plan);
      const allowed=key=>h.entrances(key).filter(e=>!e.onlyForService&&(profile!=='mobility'||(!e.requiresStairs&&!e.avoidForMobility)));
      let best=Infinity;
      for(const exit of allowed(from)){
        const before=h.run(`getIndoorLegEtaSeconds('${from}','${start}','${exit.nodeId}',${profile==='mobility'})`);
        const beforeSeconds=await before;
        if(beforeSeconds===null)continue;
        for(const entry of allowed(to)){
          const after=await h.run(`getIndoorLegEtaSeconds('${to}','${entry.nodeId}','${end}',${profile==='mobility'})`);
          if(after===null)continue;
          const outdoor=await h.run(`CampusOutdoorRouting.route(${exit.lat},${exit.lng},${entry.lat},${entry.lng},{avoidSteps:${profile==='mobility'}})`);
          if(!outdoor)continue;
          const walk=h.run(`getOutdoorEtaSeconds(${JSON.stringify(outdoor.coordinates)},${profile==='mobility'})`);
          best=Math.min(best,beforeSeconds+walk+after);
        }
      }
      assert.ok(Number.isFinite(best),'At least one complete candidate is connected');
      const before=await h.run(`getIndoorLegEtaSeconds('${from}','${start}','${plan.origin.exitEntranceId}',${profile==='mobility'})`);
      const after=await h.run(`getIndoorLegEtaSeconds('${to}','${plan.destination.startNodeId}','${end}',${profile==='mobility'})`);
      assert.notEqual(before,null);assert.notEqual(after,null);
      const walk=h.run(`getOutdoorEtaSeconds(${JSON.stringify(plan.outdoorResult.coordinates)},${profile==='mobility'})`);
      assert.ok(before+walk+after<=best+0.001,`Chosen journey ${Math.round(before+walk+after)} s; best complete candidate ${Math.round(best)} s`);
    });
  }
}

test('all registered indoor entrance IDs exist on their building graph',async()=>{
  const h=await campus();
  for(const key of keys){
    const ids=new Set(h.nodes(key).map(n=>n.id));
    for(const entrance of h.entrances(key)){
      assert.ok(ids.has(entrance.nodeId),`${key}: unknown entrance ${entrance.nodeId}`);
      assert.ok(Number.isFinite(entrance.lat)&&Number.isFinite(entrance.lng));
    }
  }
});

for(const profile of ['general','mobility']){
  test(`both campus gates can reach all six mapped buildings (${profile})`,async()=>{
    const h=await campus(),routing=h.run('CampusOutdoorRouting');
    for(const gate of h.run('CAMPUS_DATA.points.gates')){
      for(const key of keys){
        let reached=false;
        for(const entrance of h.entrances(key).filter(e=>!e.onlyForService&&(profile!=='mobility'||(!e.requiresStairs&&!e.avoidForMobility)))){
          const result=await routing.route(gate.lat,gate.lng,entrance.lat,entrance.lng,{avoidSteps:profile==='mobility'});
          if(!result)continue;
          validateOutdoor(h,result,profile);reached=true;break;
        }
        assert.ok(reached,`${gate.name} → ${key}: no usable entrance reached`);
      }
    }
  });
}

// The Terrace ↔ Rabin connection is one elevator (elevator 1 in both graphs).
// An outage listed in either building must keep every journey out of it.
const SHARED_ELEVATOR_NODES = ['floor4_n43', 'floor5_n104'];
for(const [label, outage] of [['Rabin', {building:'rabin', elevator:'1'}], ['Terrace', {building:'madriga', elevator:'1'}]]){
  test(`shared elevator out of service (${label} status): journeys go around it`, async()=>{
    const h=makeHarness({elevators:[outage]});
    await h.ready();
    for(const profile of ['general','mobility']){
      for(const [from,start,to,end] of [
        ['rabin','floor5_n13','madriga','floor1_n6'],
        ['madriga','floor1_n6','rabin','floor5_n13'],
        ['main','floor700_n69','madriga','floor1_n6'],
        ['madriga','floor1_n6','main','floor700_n69'],
        ['madriga','floor4_n1','education','floor4_n2']
      ]){
        const where=`${from} → ${to} (${profile})`;
        const plan=await h.journey(from,start,to,end,profile);
        assert.ok(plan && plan.ok!==false,`${where}: a journey is still found`);
        assert.equal(plan.activeSharedTransfer,null,`${where}: no shared elevator transfer`);
        assert.equal(plan.usesMainToMadrigaChain,false,`${where}: no Main → Rabin → Terrace chain`);
        assert.equal(plan.transfer,null,`${where}: no shared transfer handed to the indoor page`);
        assert.equal(plan.intermediate,null,`${where}: no Rabin leg towards the shared elevator`);
        assert.ok(!SHARED_ELEVATOR_NODES.includes(plan.origin.exitEntranceId),`${where}: does not leave by the shared elevator`);
        assert.ok(!SHARED_ELEVATOR_NODES.includes(plan.destination.startNodeId),`${where}: does not arrive by the shared elevator`);
        validateOutdoor(h,plan.outdoorResult,profile);
        validateIndoor(h,from,h.indoor(from,start,plan.origin.exitEntranceId,profile),profile);
        validateIndoor(h,to,h.indoor(to,plan.destination.startNodeId,end,profile),profile);
      }
    }
  });
}
