// The whole campus stays reachable: every building from both gates (General
// and Mobility), every entrance, and every indoor destination from an
// entrance. Known gaps in the mapped data are listed; a map edit that cuts
// off anything new makes these tests fail, and a fix shows up as an improvement.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {campusHarness, BUILDING_KEYS, graph} = require('./helpers/campus-harness.cjs');
const Health = require('../app/admin/data-health.js');

const KEY_BY_NAME = {
  'Main Building':'main', 'Rabin Building':'rabin', 'Student House':'student', 'Terrace Building':'madriga',
  'Multi-Purpose Building':'multi-purpose', 'Education and Science':'education', 'Welfare and Health Building':'health',
  'Eshkol Tower':'eshkol', 'Arts Building':'art', 'Bloom Building':'bloom'
};

// Entrances the outdoor path network cannot reach today, from the Carmel gate.
const KNOWN_ENTRANCE_GAPS = {
  general:['multi-purpose floor1_n2'],
  mobility:['madriga floor4_n46', 'multi-purpose floor1_n2', 'rabin floor5_n162']
};

// Indoor destinations that cannot be reached from any entrance, and those
// reachable only by stairs, per building (at most this many).
const KNOWN_INDOOR_GAPS = {
  main:{unreachable:1, onlyByStairs:0},
  rabin:{unreachable:0, onlyByStairs:0},
  student:{unreachable:0, onlyByStairs:0},
  madriga:{unreachable:1, onlyByStairs:15},
  education:{unreachable:1, onlyByStairs:0},
  'multi-purpose':{unreachable:1, onlyByStairs:0}
};

let shared = null;
async function campus(){
  if(!shared){
    shared = campusHarness();
    await shared.ready();
  }
  return shared;
}

async function reachable(routing, from, to, avoidSteps){
  const result = await routing.route(from.lat, from.lng, to.lat, to.lng, {avoidSteps});
  return Boolean(result && result.distance > 0);
}

test('every building can be reached from both gates, with General and with Mobility routing', async () => {
  const h = await campus();
  const routing = h.context.CampusOutdoorRouting;
  const entrances = h.run('BUILDING_ENTRANCES');
  for(const gate of h.run('CAMPUS_DATA.points.gates')){
    for(const building of h.run('CAMPUS_DATA.buildings')){
      const key = KEY_BY_NAME[building.name];
      assert.ok(key, `${building.name} has a building key`);
      const doors = (entrances[key] || []).filter(entrance => !entrance.onlyForService);
      assert.ok(doors.length, `${building.name} has an entrance`);
      for(const avoidSteps of [false, true]){
        let ok = false;
        for(const door of doors){ if(await reachable(routing, gate, door, avoidSteps)){ ok = true; break; } }
        assert.ok(ok, `${gate.name} → ${building.name} (${avoidSteps ? 'Mobility' : 'General'})`);
      }
    }
  }
});

test('every entrance is on the path network, apart from the known gaps', async () => {
  const h = await campus();
  const routing = h.context.CampusOutdoorRouting;
  const gate = h.run('CAMPUS_DATA.points.gates')[0];
  const gaps = {general:[], mobility:[]};
  for(const [key, list] of Object.entries(h.run('BUILDING_ENTRANCES'))){
    for(const entrance of list){
      if(!await reachable(routing, gate, entrance, false)) gaps.general.push(`${key} ${entrance.nodeId}`);
      if(!await reachable(routing, gate, entrance, true)) gaps.mobility.push(`${key} ${entrance.nodeId}`);
    }
  }
  assert.deepEqual(gaps.general.sort(), KNOWN_ENTRANCE_GAPS.general, 'entrances with no walking route');
  assert.deepEqual(gaps.mobility.sort(), KNOWN_ENTRANCE_GAPS.mobility, 'entrances with no step-free route');
});

test('indoors, every destination stays reachable from an entrance (known gaps only)', async () => {
  const h = await campus();
  const entrances = h.run('BUILDING_ENTRANCES');
  for(const key of BUILDING_KEYS){
    const result = Health.analyzeBuilding(key, graph(key), {entrances:entrances[key] || []});
    const unreachable = (result.issues.find(issue => issue.code === 'unreachable') || {nodes:[]}).nodes.length;
    const onlyByStairs = (result.issues.find(issue => issue.code === 'no-step-free') || {nodes:[]}).nodes.length;
    assert.ok(unreachable <= KNOWN_INDOOR_GAPS[key].unreachable,
      `${key}: ${unreachable} destinations cannot be reached (known: ${KNOWN_INDOOR_GAPS[key].unreachable})`);
    assert.ok(onlyByStairs <= KNOWN_INDOOR_GAPS[key].onlyByStairs,
      `${key}: ${onlyByStairs} destinations only by stairs (known: ${KNOWN_INDOOR_GAPS[key].onlyByStairs})`);
    assert.ok(result.stats.destinations > 0 && result.stats.entrances > 0, key);
  }
});

test('the known step-free gap is where we think it is: Terrace floor 0', () => {
  const result = Health.analyzeBuilding('madriga', graph('madriga'), {entrances:[]});
  // Without campus entrances, the graph's own entrance nodes are used.
  assert.equal(result.stats.perFloor.floor0.stepFree, 0);
  assert.ok(result.stats.perFloor.floor1.stepFree > 0);
});

test('a route blocked only by stairs is reported quickly (the shelter search makes many of these)', async () => {
  const h = await campus();
  const routing = h.context.CampusOutdoorRouting;
  const gate = h.run('CAMPUS_DATA.points.gates')[0];
  const stairsOnly = h.run("BUILDING_ENTRANCES.rabin.find(entrance => entrance.nodeId === 'floor5_n162')");
  await routing.route(gate.lat, gate.lng, stairsOnly.lat, stairsOnly.lng, {avoidSteps:true});
  const started = performance.now();
  for(let i = 0; i < 5; i += 1){
    assert.equal(await routing.route(gate.lat, gate.lng, stairsOnly.lat, stairsOnly.lng, {avoidSteps:true}), null);
  }
  // It used to take over a second each on a desktop PC (a diagnostic compared every pair of path points).
  assert.ok((performance.now() - started) / 5 < 300, `took ${Math.round((performance.now() - started) / 5)} ms per route`);
});
