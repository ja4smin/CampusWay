// Live campus status (app/data/campus-status.json, edited from the admin
// screen) must change real routes: elevator outages, closed places, outdoor
// no-go zones, the outdoor elevator, and the user's own reports.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {campusHarness, between, read} = require('./helpers/campus-harness.cjs');

const HOUR = 3600000;
const navigation = read('wayframe/navigation-demo.html');
const index = read('index.html');
const routePlanner = require('../wayframe/route-planner.js');

async function status(data, clock){
  const h = campusHarness({status:data, clock});
  await h.ready();
  return h;
}

// ── The status rules ──

test('an elevator outage applies only from its start date to the end of its last day', async () => {
  const clock = {now:new Date(2026, 9, 9, 12, 0).getTime()};
  const h = await status({elevators:[{building:'rabin', elevator:'2', from:'2026-10-10', until:'2026-10-12'}]}, clock);
  const out = () => h.run("CampusStatus.isElevatorOut('rabin', 'elevator2')");
  assert.equal(out(), false, 'before it starts');
  clock.now = new Date(2026, 9, 10, 0, 1).getTime();
  assert.equal(out(), true, 'first day');
  clock.now = new Date(2026, 9, 12, 23, 30).getTime();
  assert.equal(out(), true, 'last day, late evening');
  clock.now = new Date(2026, 9, 13, 0, 1).getTime();
  assert.equal(out(), false, 'after it ends');
});

test('elevators match by number however they are written, and only in their own building', async () => {
  const h = await status({elevators:[{building:'education', elevator:'02'}, {building:'campus', elevator:'main-600-outdoor'}]});
  for(const name of ['2', '02', 'elevator2', 'Elevator 2', 'elevator02']){
    assert.equal(h.run(`CampusStatus.isElevatorOut('education', ${JSON.stringify(name)})`), true, name);
  }
  assert.equal(h.run("CampusStatus.isElevatorOut('education', '12')"), false);
  assert.equal(h.run("CampusStatus.isElevatorOut('education', '1')"), false);
  assert.equal(h.run("CampusStatus.isElevatorOut('rabin', '2')"), false, 'another building');
  assert.equal(h.run("CampusStatus.isElevatorOut('campus', 'main-600-outdoor')"), true);
});

test('closures and no-go zones apply only while active, and a zone needs at least 3 corners', async () => {
  const clock = {now:new Date(2026, 9, 9, 12, 0).getTime()};
  const zone = [[32.761, 35.019], [32.762, 35.019], [32.762, 35.020]];
  const h = await status({closures:[
    {building:'main', nodeIds:['floor600_n12'], until:'2026-10-09'},
    {building:'main', nodeIds:['floor600_n13'], from:'2026-10-20'},
    {area:zone, reason:'Works', until:'2026-10-10'},
    {area:[[32.761, 35.019], [32.762, 35.019]], reason:'Only two corners'}
  ]}, clock);
  assert.deepEqual([...h.run("CampusStatus.closedNodes('main')")], ['floor600_n12']);
  assert.deepEqual([...h.run("CampusStatus.closedNodes('rabin')")], []);
  assert.deepEqual(h.run('CampusStatus.noGoAreas()').map(item => item.reason), ['Works']);
  clock.now = new Date(2026, 9, 11, 9, 0).getTime();
  assert.deepEqual([...h.run("CampusStatus.closedNodes('main')")], []);
  assert.deepEqual(h.run('CampusStatus.noGoAreas()'), []);
});

test('an elevator the user reported out of service is avoided for 24 hours, then trusted again', async () => {
  const clock = {now:new Date(2026, 9, 9, 8, 0).getTime()};
  const h = await status({}, clock);
  h.run("CampusStatus.addReport({kind:'elevator', building:'student', connectorId:'2', problem:'out-of-service', label:'Elevator 2'})");
  assert.equal(h.run("CampusStatus.isElevatorOut('student', '2')"), true);
  assert.equal(h.run("CampusStatus.elevatorOutages('student')[0].source"), 'you');
  clock.now += 23 * HOUR;
  assert.equal(h.run("CampusStatus.isElevatorOut('student', '2')"), true);
  clock.now += 2 * HOUR;
  assert.equal(h.run("CampusStatus.isElevatorOut('student', '2')"), false);
});

test('"all elevators are not working" marks every elevator of the building; other problems mark none', async () => {
  const h = await status({});
  h.run("CampusStatus.addReport({kind:'elevator-group', building:'rabin', connectorIds:['elevator1','elevator2','elevator3','elevator4'], problem:'all-out', label:'Elevators'})");
  for(const id of ['1', '2', '3', '4']) assert.equal(h.run(`CampusStatus.isElevatorOut('rabin', '${id}')`), true, id);
  const other = await status({});
  other.run("CampusStatus.addReport({kind:'elevator-group', building:'rabin', connectorIds:['elevator1','elevator2'], problem:'one-out', label:'Elevators'})");
  other.run("CampusStatus.addReport({kind:'elevator', building:'rabin', connectorId:'elevator3', problem:'other', label:'Elevator 3'})");
  assert.equal(other.run("CampusStatus.elevatorOutages('rabin').length"), 0, 'which one is unknown, so nothing is avoided');
});

test('a rest space reported noisy, crowded or closed is skipped for 2 hours; "quiet" clears it', async () => {
  const clock = {now:new Date(2026, 9, 9, 10, 0).getTime()};
  const h = await status({}, clock);
  h.run("CampusStatus.addReport({kind:'rest-space', building:'student', nodeId:'floor1_n5', problem:'noisy', label:'Lounge'})");
  assert.equal(h.run("CampusStatus.restSpaceUnavailable('student', 'floor1_n5')"), true);
  clock.now += HOUR;
  h.run("CampusStatus.addReport({kind:'rest-space', building:'student', nodeId:'floor1_n5', problem:'quiet', label:'Lounge'})");
  assert.equal(h.run("CampusStatus.restSpaceUnavailable('student', 'floor1_n5')"), false, 'the latest report wins');
  h.run("CampusStatus.addReport({kind:'rest-space', building:'student', nodeId:'floor1_n9', problem:'crowded', label:'Terrace'})");
  clock.now += 2 * HOUR + 1000;
  assert.equal(h.run("CampusStatus.restSpaceUnavailable('student', 'floor1_n9')"), false, 'expired after 2 hours');
});

// ── Indoor page (wayframe/navigation-demo.html) ──

function indoorPage(graph, {accessible, closed = [], elevatorsOut = []}){
  const elements = new Map();
  const element = id => {
    if(!elements.has(id)) elements.set(id, {value:'', checked:false, disabled:false, hidden:false, textContent:'', innerHTML:'', style:{}, dataset:{}});
    return elements.get(id);
  };
  element('accessibleRoute').checked = accessible;
  const context = vm.createContext({
    document:{getElementById:element},
    console:{log(){}},
    GRAPH:graph,
    BUILDING:'test-building',
    indoorLang:'en',
    CampusRoutePlanner:routePlanner,
    sessionStorage:{getItem(){ return null; }},
    // The page asks the live-status module what is closed or out of service.
    CampusStatus:{
      closedNodes:building => new Set(building === 'test-building' ? closed : []),
      isElevatorOut:(building, connectorId) => building === 'test-building' && elevatorsOut.includes(connectorId)
    }
  });
  const run = code => vm.runInContext(code, context);
  run(`
    const $=id=>document.getElementById(id);
    const ORDER=['floor1','floor2'];
    function allNodes(){return Object.values(GRAPH.floors).flatMap(f=>f.nodes||[])}
    function nodeById(id){return allNodes().find(node=>node.id===id)||null}
    function cid(n){const s=String(n.connectorId||'').trim();return (!s||['null','none','no','n/a'].includes(s.toLowerCase()))?'':s}
    function indoorDistanceMeters(a,b){return Math.hypot((b.x-a.x)*132.6,(b.y-a.y)*101.2)}
    function localizedInstruction(en){return en}
    let pendingSharedElevatorRide=null;
    function clearPendingSharedElevatorRide(){}
  `);
  run(between(navigation, 'function indoorStoredPreference(', 'function indoorLanguage()'));
  run(between(navigation, 'function indoorUnavailable(){', 'function indoorStatusWarnings(){'));
  run(between(navigation, 'function buildGraph(){', 'function bestDestinationNode('));
  return {run, path:(from, to) => { const result = run(`dijkstra(${JSON.stringify(from)}, ${JSON.stringify(to)})`); return result ? Array.from(result) : null; }};
}

// Entrance on floor 1; a room on floor 2 reachable by stairs or elevator 1;
// a second corridor route on floor 1.
const twoFloors = () => ({floors:{
  floor1:{nodes:[
    {id:'in', type:'entrance', floor:'floor1', x:0, y:0},
    {id:'c1', type:'corridor', floor:'floor1', x:.1, y:0},
    {id:'c2', type:'corridor', floor:'floor1', x:.1, y:.1},
    {id:'s1', type:'stairs', connectorId:'S', floor:'floor1', x:.2, y:0},
    {id:'e1', type:'elevator', connectorId:'elevator1', floor:'floor1', x:.2, y:.1}
  ], connections:[{from:'in', to:'c1'}, {from:'in', to:'c2'}, {from:'c1', to:'s1'}, {from:'c1', to:'e1'}, {from:'c2', to:'e1'}]},
  floor2:{nodes:[
    {id:'s2', type:'stairs', connectorId:'S', floor:'floor2', x:.2, y:0},
    {id:'e2', type:'elevator', connectorId:'elevator1', floor:'floor2', x:.2, y:.1},
    {id:'room', type:'room', label:'201', floor:'floor2', x:.3, y:.1}
  ], connections:[{from:'s2', to:'room'}, {from:'e2', to:'room'}]}
}});

test('indoor page: an elevator out of service is skipped; step-free routes then report no route', () => {
  const usual = indoorPage(twoFloors(), {accessible:true});
  assert.ok(usual.path('in', 'room').includes('e1'));
  const outAccessible = indoorPage(twoFloors(), {accessible:true, elevatorsOut:['elevator1']});
  assert.equal(outAccessible.path('in', 'room'), null, 'no step-free route, instead of a route through a broken elevator');
  const outGeneral = indoorPage(twoFloors(), {accessible:false, elevatorsOut:['elevator1']});
  const general = outGeneral.path('in', 'room');
  assert.ok(general.includes('s1') && !general.includes('e1'), 'general routes take the stairs');
});

test('indoor page: closed places are routed around, and a closed destination cannot be reached', () => {
  const detour = indoorPage(twoFloors(), {accessible:true, closed:['c1']});
  const path = detour.path('in', 'room');
  assert.ok(path && !path.includes('c1') && path.includes('c2'));
  const closedRoom = indoorPage(twoFloors(), {accessible:false, closed:['room']});
  assert.equal(closedRoom.path('in', 'room'), null);
});

// ── Campus map: planning indoor legs (journey times, nearest shelter) ──

test('campus planner: the indoor leg obeys the same outages and closures as the indoor page', async () => {
  const usual = await status({});
  usual.context.__graph = {building:'test', floors:twoFloors().floors};
  assert.ok(Array.from(usual.run("findIndoorEtaPath(__graph, 'in', 'room', true)")).includes('e1'));

  const out = await status({elevators:[{building:'test', elevator:'1'}], closures:[{building:'test', nodeIds:['c2']}]});
  out.context.__graph = {building:'test', floors:twoFloors().floors};
  // Not validated against the real buildings here: the module trusts the file.
  assert.equal(out.run("findIndoorEtaPath(__graph, 'in', 'room', true)"), null);
  const general = Array.from(out.run("findIndoorEtaPath(__graph, 'in', 'room', false)"));
  assert.ok(general.includes('s1') && !general.includes('e1') && !general.includes('c2'));
});

test('campus planner: a real Main Building elevator outage removes step-free access to the upper floor', async () => {
  const pick = h => h.run("MAIN_GRAPH.floors.floor700.nodes.find(node => node.type === 'room').id");
  const usual = await status({});
  const room = pick(usual);
  usual.context.__room = room;
  assert.ok(usual.run("findIndoorEtaPath(MAIN_GRAPH, 'floor600_n88', __room, true)"), 'step-free today');
  const out = await status({elevators:[{building:'main', elevator:'1'}]});
  out.context.__room = room;
  assert.equal(out.run("findIndoorEtaPath(MAIN_GRAPH, 'floor600_n88', __room, true)"), null);
  assert.ok(out.run("findIndoorEtaPath(MAIN_GRAPH, 'floor600_n88', __room, false)"), 'stairs still work');
});

// ── Outdoor routes ──

test('outdoor: a no-go zone diverts the route, and closing every way blocks it', async () => {
  // Two ways from A to B: straight (via M) and around (via N).
  const data = {elements:[
    {type:'node', id:1, lat:32.7600, lon:35.0200},
    {type:'node', id:2, lat:32.7600, lon:35.0205},
    {type:'node', id:3, lat:32.7600, lon:35.0210},
    {type:'node', id:4, lat:32.7604, lon:35.0205},
    {type:'way', id:10, nodes:[1, 2, 3], tags:{highway:'footway'}},
    {type:'way', id:11, nodes:[1, 4, 3], tags:{highway:'footway'}}
  ]};
  const context = vm.createContext({fetch:async () => ({ok:true, json:async () => data}), CampusRoutePlanner:routePlanner, console:{log(){}, warn(){}, error(){}}});
  vm.runInContext(`${read('app/prototype/outdoor-routing.js')};this.routing=CampusOutdoorRouting`, context);
  const routing = context.routing;
  // Path nodes visited, from the route's edges.
  const visited = result => result.edges.map(edge => String(edge.node));
  const straight = await routing.route(32.7600, 35.0200, 32.7600, 35.0210);
  assert.ok(visited(straight).includes('2'));
  const aroundNode2 = [[32.7598, 35.0204], [32.7602, 35.0204], [32.7602, 35.0206], [32.7598, 35.0206]];
  routing.setRestrictions({blockedAreas:[aroundNode2]});
  const detour = await routing.route(32.7600, 35.0200, 32.7600, 35.0210);
  assert.ok(detour && !visited(detour).includes('2') && visited(detour).includes('4'));
  assert.ok(detour.distance > straight.distance);
  routing.setRestrictions({blockedAreas:[aroundNode2, [[32.7603, 35.0204], [32.7606, 35.0204], [32.7606, 35.0206], [32.7603, 35.0206]]]});
  assert.equal(await routing.route(32.7600, 35.0200, 32.7600, 35.0210), null);
  routing.setRestrictions({});
  assert.ok(await routing.route(32.7600, 35.0200, 32.7600, 35.0210), 'lifting the zones restores the route');
});

test('outdoor: when the outdoor elevator is out of service, routes stop using it', async () => {
  const h = await status({});
  const routing = h.context.CampusOutdoorRouting;
  // The campus elevator next to Main Building floor 600.
  const graph = routing.getDebugGraph();
  const top = graph.find(node => node.id === 'campus_main_floor600_elevator');
  const bottom = graph.find(node => node.id === 'campus_floor6_buffet_long_stairs_bottom');
  assert.ok(top && bottom, 'the outdoor elevator is in the path network');
  const usual = await routing.route(bottom.coordinate[0], bottom.coordinate[1], top.coordinate[0], top.coordinate[1], {avoidSteps:true});
  assert.ok(usual && usual.edges.some(edge => edge.type === 'elevator'));
  routing.setRestrictions({avoidElevator:true});
  const without = await routing.route(bottom.coordinate[0], bottom.coordinate[1], top.coordinate[0], top.coordinate[1], {avoidSteps:true});
  assert.ok(!without || without.edges.every(edge => edge.type !== 'elevator'));
  routing.setRestrictions({});
});

test('the campus map hands the live status to the outdoor router', async () => {
  const zone = [[32.761, 35.019], [32.762, 35.019], [32.762, 35.020]];
  const h = await status({elevators:[{building:'campus', elevator:'main-600-outdoor'}], closures:[{area:zone, reason:'Works'}]});
  const calls = [];
  h.context.CampusOutdoorRouting.setRestrictions = value => calls.push(value);
  h.run(index.match(/var OUTDOOR_ELEVATOR_ID = '[^']+';/)[0]);
  h.run('function drawNoGoZones(){}');
  h.run(between(index, 'function applyLiveStatus(){', 'let noGoLayers'));
  h.run('applyLiveStatus()');
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {blockedAreas:[zone], avoidElevator:true});
});
