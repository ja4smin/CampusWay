// Offline use: the service worker precaches the app on first visit. One
// missing file makes the whole install fail, and a file the pages load but the
// worker does not cache breaks the app offline.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {BUILDING_KEYS, graph, read, root} = require('./helpers/campus-harness.cjs');

const worker = read('service-worker.js');
const precached = [...worker.slice(worker.indexOf('const APP_FILES'), worker.indexOf('];', worker.indexOf('const APP_FILES'))).matchAll(/'\.\/([^']*)'/g)]
  .map(match => match[1]).filter(Boolean);

test('every precached file exists', () => {
  assert.ok(precached.length > 40);
  const missing = precached.filter(file => !fs.existsSync(path.join(root, file)));
  assert.deepEqual(missing, []);
  assert.equal(new Set(precached).size, precached.length, 'no file is listed twice');
});

test('every script and stylesheet the two pages load is precached', () => {
  for(const [page, folder] of [['index.html', ''], ['wayframe/navigation-demo.html', 'wayframe/']]){
    const html = read(page);
    const local = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+\.(?:js|css|json))"/g)]
      .map(match => match[1]).filter(ref => !/^(https?:)?\/\//.test(ref))
      .map(ref => path.posix.normalize(folder + ref));
    assert.ok(local.length > 5, page);
    assert.deepEqual(local.filter(ref => !precached.includes(ref)), [], `${page} loads files that are not precached`);
  }
});

test('the maps, floor plans, path network and live status are available offline', () => {
  for(const file of ['app/data/campus-status.json', 'app/prototype/campus-osm.json', 'app/prototype/data.js', 'manifest.json', 'index.html']){
    assert.ok(precached.includes(file), file);
  }
  for(const key of BUILDING_KEYS){
    assert.ok(precached.includes(`buildings/${key}/${key}-indoor-graph.json`), `${key} graph`);
    for(const [floorId, floor] of Object.entries(graph(key).floors)){
      if(!(floor.nodes || []).length) continue;
      const number = floorId === 'floorminus1' ? '-1' : floorId.replace(/^floor/, '');
      const names = [`${floorId}.svg`, `floor${number}.svg`, `${number}-Model.svg`, `${number}.svg`].map(name => `buildings/${key}/floors/${name}`);
      assert.ok(names.some(name => precached.includes(name)), `${key} ${floorId}: floor plan not available offline`);
    }
  }
});

test('nothing private or admin-only is precached', () => {
  const blocked = precached.filter(file => /^(server|cloud|tests|\.git)\//.test(file) || /^admin\.html$|^app\/admin\//.test(file));
  assert.deepEqual(blocked, []);
});

test('the worker never answers API or admin requests from its cache', () => {
  const listeners = new Map();
  const context = vm.createContext({
    URL, Promise,
    caches:{open:async () => ({addAll:async () => {}, put:async () => {}}), match:async () => null, keys:async () => [], delete:async () => true},
    fetch:async () => ({ok:true, clone(){ return this; }}),
    self:{location:{origin:'https://ja4smin.github.io'}, addEventListener:(type, listener) => listeners.set(type, listener), skipWaiting:() => Promise.resolve(), clients:{claim:() => Promise.resolve()}}
  });
  vm.runInContext(worker, context);
  const handled = url => {
    let answered = false;
    listeners.get('fetch')({request:{method:'GET', url, mode:'cors', destination:''}, respondWith(){ answered = true; }});
    return answered;
  };
  for(const url of [
    'https://ja4smin.github.io/CampusWay/api/reports/status?ids=r1',
    'https://ja4smin.github.io/CampusWay/api/health',
    'https://ja4smin.github.io/CampusWay/admin.html',
    'https://ja4smin.github.io/CampusWay/app/admin/admin-core.js'
  ]){
    assert.equal(handled(url), false, url);
  }
  assert.equal(handled('https://ja4smin.github.io/CampusWay/buildings/main/main-indoor-graph.json'), true, 'app files are still served offline');
  assert.equal(handled('https://campusway-inbox.example.workers.dev/api/reports'), false, 'other sites, such as the cloud inbox, are never cached');
});
