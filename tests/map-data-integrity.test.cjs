// The map data every route depends on: indoor graphs, campus entrances, places
// linked indoors, floor plans and building names. A typo here would otherwise
// only show up as a broken route on someone's phone.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {BUILDING_KEYS, graph, read, root, between} = require('./helpers/campus-harness.cjs');

function campusData(){
  const context = vm.createContext({});
  vm.runInContext(`${read('app/prototype/data.js')};this.D=CAMPUS_DATA;this.E=BUILDING_ENTRANCES;`, context);
  return {data:context.D, entrances:context.E};
}

const NODE_TYPES = ['corridor', 'room', 'stairs', 'elevator', 'entrance', 'restroom', 'shelter', 'landmark', 'food', 'parking', 'gym', 'clinic', 'museum', 'library'];
// Campus entrances that point to a corridor node rather than an "entrance" node.
const KNOWN_NON_ENTRANCE_DOORS = ['rabin floor5_n162'];

test('each indoor graph names its own building and uses known node types', () => {
  for(const key of BUILDING_KEYS){
    const data = graph(key);
    assert.equal(data.building, key, `${key}: "building" field`);
    assert.equal(data.coordinateSystem, 'normalized_0_to_1', key);
    for(const [floorId, floor] of Object.entries(data.floors)){
      for(const node of floor.nodes || []){
        assert.ok(NODE_TYPES.includes(node.type), `${key} ${node.id}: unknown type "${node.type}"`);
        assert.equal(node.floor || floorId, floorId, `${key} ${node.id}: listed on ${floorId} but says ${node.floor}`);
        assert.ok(node.x >= 0 && node.x <= 1 && node.y >= 0 && node.y <= 1, `${key} ${node.id}: position outside the floor plan`);
      }
    }
  }
});

test('node ids are unique and every connection joins two nodes on the same floor', () => {
  for(const key of BUILDING_KEYS){
    const data = graph(key);
    const seen = new Map();
    for(const [floorId, floor] of Object.entries(data.floors)){
      for(const node of floor.nodes || []){
        assert.ok(!seen.has(node.id), `${key}: node id ${node.id} is used twice`);
        seen.set(node.id, floorId);
      }
    }
    for(const [floorId, floor] of Object.entries(data.floors)){
      for(const connection of floor.connections || []){
        assert.equal(seen.get(connection.from), floorId, `${key}: connection from missing or other-floor node ${connection.from}`);
        assert.equal(seen.get(connection.to), floorId, `${key}: connection to missing or other-floor node ${connection.to}`);
        assert.notEqual(connection.from, connection.to, `${key}: node ${connection.from} connected to itself`);
      }
    }
  }
});

test('every campus entrance points to a real node in the building map', () => {
  const {entrances} = campusData();
  for(const key of BUILDING_KEYS){
    const nodes = new Map(Object.values(graph(key).floors).flatMap(floor => floor.nodes || []).map(node => [node.id, node]));
    assert.ok((entrances[key] || []).length, `${key} has campus entrances`);
    for(const entrance of entrances[key]){
      const node = nodes.get(entrance.nodeId);
      assert.ok(node, `${key}: entrance ${entrance.nodeId} is not in the map`);
      if(!KNOWN_NON_ENTRANCE_DOORS.includes(`${key} ${entrance.nodeId}`)){
        assert.equal(node.type, 'entrance', `${key}: entrance ${entrance.nodeId} is a ${node.type} node`);
      }
      assert.ok(Number.isFinite(entrance.lat) && Number.isFinite(entrance.lng), `${key} ${entrance.nodeId}: coordinates`);
    }
    assert.ok(entrances[key].some(entrance => !entrance.onlyForService), `${key}: at least one public entrance`);
  }
});

test('food places and shops linked indoors point to real nodes', () => {
  const {data} = campusData();
  for(const place of [...data.points.food, ...data.points.shops]){
    if(!place.indoor) continue;
    assert.ok(BUILDING_KEYS.includes(place.indoor.buildingKey), `${place.name}: unknown building ${place.indoor.buildingKey}`);
    const ids = new Set(Object.values(graph(place.indoor.buildingKey).floors).flatMap(floor => floor.nodes || []).map(node => node.id));
    assert.ok(place.indoor.nodeIds.length, place.name);
    place.indoor.nodeIds.forEach(id => assert.ok(ids.has(id), `${place.name}: node ${id} is not in ${place.indoor.buildingKey}`));
  }
});

test('every place on the map lies on the University of Haifa campus', () => {
  const {data, entrances} = campusData();
  const onCampus = (lat, lng) => lat > 32.755 && lat < 32.768 && lng > 35.012 && lng < 35.026;
  data.buildings.forEach(building => {
    assert.ok(onCampus(building.lat, building.lng), building.name);
    assert.ok(building.polygon.length >= 3 && building.polygon.every(([lat, lng]) => onCampus(lat, lng)), `${building.name} outline`);
    assert.ok(building.name_he, `${building.name} has a Hebrew name`);
  });
  Object.values(data.points).flat().forEach(point => assert.ok(onCampus(point.lat, point.lng), point.name));
  Object.values(entrances).flat().forEach(entrance => assert.ok(onCampus(entrance.lat, entrance.lng), entrance.nodeId));
});

test('every mapped floor has its floor plan drawing', () => {
  for(const key of BUILDING_KEYS){
    for(const [floorId, floor] of Object.entries(graph(key).floors)){
      if(!(floor.nodes || []).length) continue;
      // The same file names the indoor page tries (wayframe/navigation-demo.html floorPlanUrls).
      const number = floorId === 'floorminus1' ? '-1' : floorId.replace(/^floor/, '');
      const candidates = [`${floorId}.svg`, `floor${number}.svg`, `${number}-Model.svg`, `${number}.svg`, `Floor${number}.svg`];
      assert.ok(candidates.some(name => fs.existsSync(path.join(root, 'buildings', key, 'floors', name))), `${key} ${floorId}: no floor plan`);
    }
  }
});

test('the campus page knows every mapped building by its real name', () => {
  const {data} = campusData();
  const index = read('index.html');
  const context = vm.createContext({});
  vm.runInContext(`${between(index, 'const REPORT_BUILDING_NAMES = {', 'function graphForBuilding(')};this.N=REPORT_BUILDING_NAMES;`, context);
  assert.deepEqual(Object.keys(context.N).sort(), [...BUILDING_KEYS].sort());
  Object.values(context.N).forEach(name => assert.ok(data.buildings.some(building => building.name === name), name));
});
