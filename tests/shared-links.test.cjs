// Shared links and QR codes (?to=, ?from=): every printed QR code depends on
// these codes still opening the same place.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {campusHarness, BUILDING_KEYS} = require('./helpers/campus-harness.cjs');

function harness(search){
  return campusHarness({search});
}

test('every building, mapped room and place round-trips through its share code', () => {
  const h = harness('');
  const codes = [];
  h.run('CAMPUS_DATA.buildings').forEach(building => codes.push({code:h.run(`shareTargetCode({kind:'building', name:${JSON.stringify(building.name)}})`), expect:building.name}));
  // Places: the same code sharePlace() makes — names with several branches also name the building.
  const places = h.run('searchableCampusPlaces()');
  places.forEach(place => {
    const branch = places.filter(other => other.name === place.name).length > 1 ? (place.indoor && place.indoor.buildingKey) || '' : '';
    codes.push({code:h.run(`shareTargetCode({kind:'place', name:${JSON.stringify(place.name)}, buildingKey:${JSON.stringify(branch)}})`), expect:`${place.name} ${place.lat},${place.lng}`});
  });
  for(const key of BUILDING_KEYS){
    h.context.__key = key;
    const room = h.run("Object.values(graphForBuilding(__key).floors).flatMap(floor => floor.nodes).find(node => node.type === 'room')");
    codes.push({code:h.run(`shareTargetCode({kind:'room', buildingKey:__key, nodeId:${JSON.stringify(room.id)}})`), expect:room.id});
  }
  for(const {code, expect} of codes){
    h.context.__code = code;
    const target = h.run('findSharedTarget(__code)');
    assert.ok(target, `${code} does not open anything`);
    const found = target.kind === 'room' ? target.nodeId : target.kind === 'building' ? target.building.name : `${target.place.name} ${target.place.lat},${target.place.lng}`;
    assert.equal(found, expect, code);
  }
  assert.ok(codes.length > 30);
});

test('a place with several branches opens the branch that was shared; old links still open', () => {
  const h = harness('');
  for(const branch of ['madriga', 'education']){
    h.context.__code = h.run(`shareTargetCode({kind:'place', name:'Pilpelet Cafe', buildingKey:'${branch}'})`);
    assert.equal(h.context.__code, `place:Pilpelet Cafe@${branch}`);
    assert.equal(h.run('findSharedTarget(__code)').place.indoor.buildingKey, branch);
  }
  h.context.__code = 'place:Pilpelet Cafe';
  assert.ok(h.run('findSharedTarget(__code)'), 'links made before branches were named still open');
  h.context.__code = 'place:Pilpelet Cafe@nowhere';
  assert.ok(h.run('findSharedTarget(__code)'), 'an unknown branch falls back to the place');
  h.context.__code = 'place:Cafe Aguda';
  assert.equal(h.run("shareTargetCode({kind:'place', name:'Cafe Aguda', buildingKey:''})"), 'place:Cafe Aguda', 'single places keep short codes');
});

test('share links survive the URL: encoded on GitHub Pages, decoded back to the same place', () => {
  const h = harness('');
  const url = new URL(h.run("shareLink({kind:'room', buildingKey:'rabin', nodeId:'floor5_n0'}, {kind:'building', name:'Student House'})"));
  assert.equal(url.origin + url.pathname, 'https://ja4smin.github.io/CampusWay/index.html');
  assert.equal(url.searchParams.get('to'), 'room:rabin:floor5_n0');
  assert.equal(url.searchParams.get('from'), 'building:Student House');
  const place = new URL(h.run("shareLink({kind:'place', name:'Cafe Aguda'})"));
  assert.equal(place.searchParams.get('to'), 'place:Cafe Aguda');
  assert.equal(place.searchParams.get('from'), null);
});

test('unknown or broken codes open nothing instead of a wrong place', () => {
  const h = harness('');
  for(const code of ['', 'room', 'room:rabin', 'room:rabin:floor99_n1', 'room:nowhere:floor5_n0', 'building:Atlantis', 'place:No Such Cafe', 'shelter:main', 'javascript:alert(1)']){
    h.context.__code = code;
    assert.equal(h.run('findSharedTarget(__code)'), null, code);
  }
});

test('opening a room link starts an indoor destination; a building link a campus destination', async () => {
  const room = harness('?to=room:rabin:floor5_n0&from=building:Student%20House');
  await room.run('openSharedLink()');
  assert.equal(room.calls.pickIndoorDestination.length, 1);
  assert.equal(room.calls.pickIndoorDestination[0].nodeId, 'floor5_n0');
  assert.equal(room.calls.pickIndoorDestination[0].buildingKey, 'rabin');
  assert.deepEqual(room.calls.pickStart.map(call => call.name), ['Student House']);
  assert.deepEqual(room.calls.notify, [], 'no "choose your start" hint when the link has a start');

  const building = harness('?to=building:Main%20Building');
  await building.run('openSharedLink()');
  assert.deepEqual(building.calls.pickDestination.map(call => call.name), ['Main Building']);
  assert.deepEqual(building.calls.notify, [building.run('t.sharedLinkStart')], 'asks where the user starts');
});

test('a room as the starting point starts indoors', async () => {
  const h = harness('?to=building:Main%20Building&from=room:student:floor1_n24');
  await h.run('openSharedLink()');
  assert.deepEqual(h.calls.pickIndoorStart.map(call => [call.buildingKey, call.nodeId]), [['student', 'floor1_n24']]);
});

test('food places and shops open their own route', async () => {
  const food = harness('?to=place:Cafe%20Aguda');
  await food.run('openSharedLink()');
  assert.deepEqual(food.calls.routeToFoodPlace, ['Cafe Aguda']);
  const shop = harness('?to=place:Yozma');
  await shop.run('openSharedLink()');
  assert.deepEqual(shop.calls.routeToShopPlace, ['Yozma']);
});

test('a link to a place that no longer exists says so; a plain visit does nothing', async () => {
  const missing = harness('?to=room:rabin:floor5_gone');
  await missing.run('openSharedLink()');
  assert.deepEqual(missing.calls.notify, [missing.run('t.sharedLinkMissing')]);
  assert.equal(missing.calls.pickIndoorDestination.length + missing.calls.pickDestination.length, 0);

  const plain = harness('');
  await plain.run('openSharedLink()');
  assert.deepEqual(plain.calls.notify, []);
  assert.equal(plain.calls.pickDestination.length, 0);
});
