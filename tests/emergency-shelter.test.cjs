// "Nearest shelter": the safety-critical emergency route, tested on the real
// campus data (indoor graphs, entrances, outdoor path network).
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {campusHarness} = require('./helpers/campus-harness.cjs');

async function harness(options){
  const h = campusHarness(options);
  await h.ready();
  return h;
}

function starts(h){
  return [
    ...h.run('CAMPUS_DATA.points.gates').map(gate => ({lat:gate.lat, lng:gate.lng, label:gate.name})),
    ...h.run('CAMPUS_DATA.buildings').map(building => ({lat:building.lat, lng:building.lng, label:building.name}))
  ];
}

async function plan(h, start){
  h.context.__start = start;
  return h.run('nearestShelterPlan(__start)');
}

// Node types along the planned indoor path (entrance → shelter).
function pathTypes(h, shelterPlan, accessible){
  h.context.__plan = shelterPlan;
  return h.run(`(() => {
    const from = __plan.entrance ? __plan.entrance.nodeId : null;
    const path = findIndoorEtaPath(__plan.graph, from, __plan.shelter.id, ${accessible});
    if(!path) return null;
    const byId = new Map(indoorEtaNodes(__plan.graph).map(node => [node.id, node]));
    return path.map(id => ({id, type:byId.get(id).type, connectorId:byId.get(id).connectorId || ''}));
  })()`);
}

test('from both gates and every building, the nearest shelter is a real shelter with a guided route', async () => {
  const h = await harness();
  for(const start of starts(h)){
    const result = await plan(h, start);
    assert.ok(result, `no shelter from ${start.label}`);
    assert.equal(result.shelter.type, 'shelter', start.label);
    assert.ok(result.indoorGuided, `${start.label}: the indoor part should be guided`);
    assert.ok(Number.isFinite(result.seconds) && result.seconds > 0, start.label);
    const nodes = pathTypes(h, result, false);
    assert.ok(nodes && nodes[nodes.length - 1].id === result.shelter.id, start.label);
  }
});

test('Mobility: every shelter route is step-free outdoors and indoors, or the user is told none exists', async () => {
  const h = await harness({profile:'mobility'});
  const routing = h.context.CampusOutdoorRouting;
  const noStepFreeShelter = [];
  for(const start of starts(h)){
    const result = await plan(h, start);
    if(!result){ noStepFreeShelter.push(start.label); continue; }
    assert.ok(result.indoorGuided, `${start.label}: a Mobility shelter must have a mapped step-free path`);
    const nodes = pathTypes(h, result, true);
    assert.ok(nodes, start.label);
    assert.ok(nodes.every(node => node.type !== 'stairs'), `${start.label}: the indoor path uses stairs`);
    assert.ok(!result.entrance.requiresStairs && !result.entrance.avoidForMobility, start.label);
    const outdoor = await routing.route(start.lat, start.lng, result.entrance.lat, result.entrance.lng, {avoidSteps:true});
    assert.ok(outdoor && outdoor.edges.every(edge => edge.type !== 'steps'), `${start.label}: no step-free outdoor path to the chosen entrance`);
  }
  // Known gaps in the mapped data today. A new place without a step-free
  // shelter route makes this test fail; fixing the map shortens the list.
  assert.deepEqual(noStepFreeShelter.sort(), ['Multi-Purpose Building', 'Welfare and Health Building']);
});

test('the gates always have a step-free shelter route', async () => {
  const h = await harness({profile:'mobility'});
  for(const gate of h.run('CAMPUS_DATA.points.gates')){
    assert.ok(await plan(h, {lat:gate.lat, lng:gate.lng, label:gate.name}), gate.name);
  }
});

test('starting inside a building with a shelter stays inside that building', async () => {
  const h = await harness();
  // A Student House room on floor 1.
  const room = h.run("STUDENT_GRAPH.floors.floor1.nodes.find(node => node.type === 'room')");
  const building = h.run("CAMPUS_DATA.buildings.find(item => item.name === 'Student House')");
  const result = await plan(h, {buildingKey:'student', nodeId:room.id, lat:building.lat, lng:building.lng, label:'Student House room'});
  assert.equal(result.key, 'student');
  assert.equal(result.entrance, null);
  assert.equal(result.meters, 0);
  assert.ok(result.indoorGuided);
});

test('a shelter closed in the live status is never chosen', async () => {
  const first = await harness();
  const building = first.run("CAMPUS_DATA.buildings.find(item => item.name === 'Student House')");
  const start = {lat:building.lat, lng:building.lng, label:'Student House'};
  const usual = await plan(first, start);
  assert.equal(usual.key, 'student');

  const closed = await harness({status:{closures:[{building:'student', nodeIds:[usual.shelter.id], reason:'Flooded'}]}});
  const result = await plan(closed, start);
  assert.notEqual(result.shelter.id, usual.shelter.id);

  // Every Student House shelter closed: another building is chosen.
  const allIds = closed.run("Object.values(STUDENT_GRAPH.floors).flatMap(floor => floor.nodes).filter(node => node.type === 'shelter').map(node => node.id)");
  const none = await harness({status:{closures:[{building:'student', nodeIds:allIds, reason:'Closed'}]}});
  assert.notEqual((await plan(none, start)).key, 'student');
});

test('Mobility: an elevator out of service is never part of the shelter route', async () => {
  const before = await harness({profile:'mobility'});
  const main = before.run("CAMPUS_DATA.buildings.find(item => item.name === 'Main Building')");
  const start = {lat:main.lat, lng:main.lng, label:'Main Building'};
  const usual = await plan(before, start);
  const usedElevators = pathTypes(before, usual, true).filter(node => node.type === 'elevator').map(node => node.connectorId);
  assert.ok(usedElevators.length, 'the usual Main Building shelter route uses an elevator');

  const after = await harness({profile:'mobility', status:{elevators:usedElevators.map(id => ({building:usual.key, elevator:id, note:'Broken'}))}});
  const result = await plan(after, start);
  if(result && result.key === usual.key){
    const nodes = pathTypes(after, result, true);
    assert.ok(nodes.every(node => node.type !== 'elevator' || !usedElevators.includes(node.connectorId)));
  }else{
    assert.ok(!result || result.key !== usual.key, 'another shelter, or none');
  }
});

test('the shelter button starts a guided emergency route to the chosen shelter', async () => {
  const h = await harness();
  await h.run('startEmergencyShelterRoute()');
  assert.equal(h.calls.routeTo.length, 1);
  const call = h.calls.routeTo[0];
  assert.equal(call.options.emergency, true);
  assert.equal(call.options.keepIndoorContext, true);
  const context = JSON.parse(h.sessionStorage.getItem('indoorContext'));
  assert.equal(context.destinationType, 'shelter');
  assert.ok(context.destinationNodeId);
  assert.equal(h.sessionStorage.getItem('indoorBuilding'), context.buildingKey);
  assert.equal(h.run('emergencyRouteActive'), true);
  assert.equal(h.element('emergencyBtn').attributes['aria-busy'], undefined, 'the button is usable again');
});

test('when no shelter can be reached, the user is told and no route is drawn', async () => {
  const h = await harness({profile:'mobility'});
  const welfare = h.run("CAMPUS_DATA.buildings.find(item => item.name === 'Welfare and Health Building')");
  h.startAt({lat:welfare.lat, lng:welfare.lng, label:'Welfare and Health Building'});
  await h.run('startEmergencyShelterRoute()');
  assert.deepEqual(h.calls.notify, [h.run('t.emergencyNoShelter')]);
  assert.equal(h.calls.routeTo.length, 0);

  const empty = await harness();
  ['MAIN_GRAPH', 'RABIN_GRAPH', 'STUDENT_GRAPH', 'MADRIGA_GRAPH', 'EDUCATION_GRAPH', 'MULTI_PURPOSE_GRAPH'].forEach(name => { empty.context[name] = {floors:{}}; });
  await empty.run('startEmergencyShelterRoute()');
  assert.deepEqual(empty.calls.notify, [empty.run('t.emergencyNoShelter')]);
  assert.equal(empty.calls.routeTo.length, 0);
});

test('if the path network cannot load (offline before first use), a shelter is still found', async () => {
  const h = await harness();
  h.context.CampusOutdoorRouting.route = async () => { throw new Error('campus-osm.json unavailable'); };
  const result = await plan(h, {lat:32.758920626688536, lng:35.02135898321563, label:'Carmel Gate'});
  assert.ok(result);
  assert.equal(result.shelter.type, 'shelter');
});

test('?emergency=1 from the indoor page starts the shelter route from that building', async () => {
  const h = await harness({search:'?emergency=1&from=building:Rabin%20Building'});
  h.run('this.startEmergencyShelterRoute = () => { __calls.emergency += 1; }');
  await h.run('openSharedLink()');
  assert.deepEqual(h.calls.pickStart.map(call => call.name), ['Rabin Building']);
  assert.equal(h.calls.emergency, 1);
  assert.equal(h.calls.pickDestination.length, 0);
});
