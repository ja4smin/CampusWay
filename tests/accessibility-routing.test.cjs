const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'wayframe', 'navigation-demo.html'), 'utf8');
const sharedCss = fs.readFileSync(path.join(root, 'app', 'ui', 'campusway.css'), 'utf8');
const indoorCss = fs.readFileSync(path.join(root, 'app', 'ui', 'indoor-nav.css'), 'utf8');
const outdoor = fs.readFileSync(path.join(root, 'app', 'prototype', 'outdoor-routing.js'), 'utf8');
const routePlanner = require('../wayframe/route-planner.js');

function between(source, start, end) {
  return require('./helpers/campus-harness.cjs').between(
    source,
    start,
    end
  );
}

test('profile choice moved from the route planner into onboarding and Settings', () => {
  const planner = between(
    index,
    '<section class="panel planner"',
    '<!-- Route result -->'
  );

  assert.doesNotMatch(planner, /profileToggle|profileList|profile-field/);
  assert.match(index, /id="onboardingProfileList"/);
  assert.match(index, /id="settingsProfileList"/);
  assert.match(index, /id="settingsBtn"/);
  assert.doesNotMatch(index, /id="langSwitchBtn"/);
});

test('display and audio controls live in Settings and share audio with indoor navigation', () => {
  const topbar = between(
    index,
    '<header class="topbar"',
    '</header>'
  );

  const settings = between(
    index,
    '<div class="settings-dialog"',
    '<div class="toast-region"'
  );

  assert.doesNotMatch(
    topbar,
    /id="contrastBtn"|id="audioBtn"/
  );

  assert.match(settings, /id="contrastBtn"[^>]+role="switch"/);
  assert.match(settings, /id="audioBtn"[^>]+role="switch"/);

  assert.match(
    navigation,
    /SHARED_AUDIO_KEY\s*=\s*["']campusway\.audioEnabled["']/
  );

  assert.match(
    navigation,
    /sharedVoice\s*!==\s*null[\s\S]+savedVoice\s*!==\s*null[\s\S]+selectedRoutingProfile\(\)\s*===\s*["']visual["']/
  );
});

test('Settings offers a persistent normal or large text size choice', () => {
  const settings = between(index, '<div class="settings-dialog"', '<div class="toast-region"');

  assert.match(settings, /id="settingsTextSizeOptions"[^>]+role="radiogroup"/);
  assert.match(settings, /role="radio"[^>]+data-text-size="normal"/);
  assert.match(settings, /role="radio"[^>]+data-text-size="large"/);
  assert.match(index, /textSize:\s*'campusway\.textSize'/);
  assert.match(index, /document\.documentElement\.dataset\.textSize\s*=\s*nextSize/);
});

function indoorAppearance(localEntries = [], sessionEntries = []) {
  const persistent = new Map(localEntries);
  const session = new Map(sessionEntries);
  const classes = new Set();
  const context = vm.createContext({
    localStorage:{
      getItem(key){ return persistent.get(key) ?? null; }
    },
    sessionStorage:{
      getItem(key){ return session.get(key) ?? null; },
      setItem(key, value){ session.set(key, value); }
    },
    document:{
      body:{classList:{
        contains(name){ return classes.has(name); },
        toggle(name, enabled){
          if(enabled) classes.add(name);
          else classes.delete(name);
        }
      }},
      documentElement:{dataset:{}}
    }
  });
  vm.runInContext(between(
    navigation,
    'function indoorStoredPreference(',
    'function indoorLanguage()'
  ), context);
  return {context, classes, session};
}

test('indoor navigation restores shared appearance and prefers persistent values', () => {
  const restored = indoorAppearance(
    [
      ['campusway.highContrastEnabled','true'],
      ['campusway.textSize','large'],
      ['accessibilityProfile','general']
    ],
    [
      ['campusway.highContrastEnabled','false'],
      ['campusway.textSize','normal']
    ]
  );
  assert.equal(restored.classes.has('hc'), true);
  assert.equal(restored.context.document.documentElement.dataset.textSize, 'large');
  assert.equal(restored.session.get('campusway.highContrastEnabled'), 'true');

  const normal = indoorAppearance([
    ['campusway.highContrastEnabled','false'],
    ['campusway.textSize','normal']
  ]);
  assert.equal(normal.classes.has('hc'), false);
  assert.equal(normal.context.document.documentElement.dataset.textSize, 'normal');

  const visualDefault = indoorAppearance([
    ['accessibilityProfile','visual']
  ]);
  assert.equal(visualDefault.classes.has('hc'), true);
});

test('shared and indoor styles cover large text and high-contrast navigation', () => {
  assert.match(sharedCss, /html\[data-text-size="large"\]\{font-size:112\.5%;\}/);
  assert.match(sharedCss, /body\.hc\{[\s\S]+--primary:#FFD400/);
  assert.match(indoorCss, /body\.hc \.route-core\{stroke:#FFD400;\}/);
  assert.match(indoorCss, /body\.hc #mapViewport,[\s\S]+background:#000/);
  assert.match(indoorCss, /body\.hc #startBtn:not\(:disabled\)[\s\S]+color:#000/);
  assert.doesNotMatch(indoorCss, /font-size:\s*[0-9.]+px/);
});

test('saved places remain in the sidebar without the redundant buildings list', () => {
  assert.match(index, /id="favouriteList"/);
  assert.match(index, /id="lbl-favourites"/);
  assert.doesNotMatch(index, /id="buildingList"|id="lbl-buildings"|id="tabFavourites"/);
  assert.doesNotMatch(index, /function buildBuildingList\(|function toggleBuildingList\(/);
});

test('outdoor Mobility route excludes OSM steps while a general route may use them', async () => {
  const data = { elements: [
    {type:'node', id:1, lat:32.7600, lon:35.0200},
    {type:'node', id:2, lat:32.7600, lon:35.0201},
    {type:'node', id:3, lat:32.7600, lon:35.0202},
    {type:'node', id:4, lat:32.7601, lon:35.0200},
    {type:'node', id:5, lat:32.7601, lon:35.0202},
    {type:'way', id:10, nodes:[1,2,3], tags:{highway:'steps'}},
    {type:'way', id:11, nodes:[1,4,5,3], tags:{highway:'footway'}}
  ] };
  const context = vm.createContext({
    fetch: async () => ({ok:true, json:async () => data}),
    CampusRoutePlanner: routePlanner,
    console: {log() {}, warn() {}, error() {}}
  });
  vm.runInContext(`${outdoor};this.routing=CampusOutdoorRouting`, context);
  const general = await context.routing.route(32.7600, 35.0200, 32.7600, 35.0202);
  const accessible = await context.routing.route(32.7600, 35.0200, 32.7600, 35.0202, {avoidSteps:true});
  assert.ok(general.edges.some(edge => edge.type === 'steps'));
  assert.ok(accessible.edges.length > 0);
  assert.ok(accessible.edges.every(edge => edge.type !== 'steps'));
});

test('outdoor Spatial routing prefers fewer turns without changing General routing', async () => {
  const data = {elements:[
    {type:'node',id:1,lat:32.76000,lon:35.02000},
    {type:'node',id:2,lat:32.76001,lon:35.02000},
    {type:'node',id:3,lat:32.76001,lon:35.02004},
    {type:'node',id:4,lat:32.76000,lon:35.02004},
    {type:'node',id:5,lat:32.76004,lon:35.02005},
    {type:'node',id:6,lat:32.76000,lon:35.02010},
    {type:'way',id:20,nodes:[1,2,3,4,6],tags:{highway:'footway'}},
    {type:'way',id:21,nodes:[1,5,6],tags:{highway:'footway'}}
  ]};
  const context = vm.createContext({
    fetch:async()=>({ok:true,json:async()=>data}),
    CampusRoutePlanner:routePlanner,
    console:{log(){},warn(){},error(){}}
  });
  vm.runInContext(`${outdoor};this.routing=CampusOutdoorRouting`, context);
  const general = await context.routing.route(32.76000,35.02000,32.76000,35.02010);
  const spatial = await context.routing.route(
    32.76000,35.02000,32.76000,35.02010,
    {preferFewerTurns:true}
  );
  assert.equal(general.edges.length, 4);
  assert.equal(spatial.edges.length, 2);
  assert.ok(spatial.distance > general.distance);
});

function indoorHarness(graph, accessible = true, profile = 'general') {
  const elements = new Map();
  const element = id => {
    if(!elements.has(id)) elements.set(id, {
      value:'', checked:false, disabled:false, hidden:false,
      textContent:'', innerHTML:'', style:{}, dataset:{}
    });
    return elements.get(id);
  };
  element('accessibleRoute').checked = accessible;
  for(const id of ['fromFloor','toFloor']) element(id).value = id === 'fromFloor' ? 'floor1' : 'floor2';
  element('from').value = 'a';
  element('to').value = 'b';
  const context = vm.createContext({
    document:{getElementById:element},
    console:{log(){}},
    GRAPH:graph,
    indoorLang:'en',
    CampusRoutePlanner:routePlanner,
    sessionStorage:{getItem(key){return key === 'accessibilityProfile' ? profile : null;}}
  });
  const run = code => vm.runInContext(code, context);
  run(`
    const $=id=>document.getElementById(id);
    const ORDER=['floor1','floor2'];
    function allNodes(){return Object.values(GRAPH.floors).flatMap(f=>f.nodes||[])}
    function nodeById(id){return allNodes().find(node=>node.id===id)||null}
    function cid(n){const s=String(n.connectorId||'').trim();return (!s||['null','none','no','n/a'].includes(s.toLowerCase()))?'':s}
    function indoorDistanceMeters(a,b){return Math.hypot((b.x-a.x)*132.6,(b.y-a.y)*101.2)}
    function esc(value){return String(value)}
    const messages={noRoute:'No route yet',noRouteHelp:'Choose locations',routeNotFound:'No route found.',routeNotFoundHelp:'Try another route.',noAccessibleRoute:'No step-free route found.',noAccessibleRouteHelp:'Try another entrance.'};
    function it(key){return messages[key]||key}
    function localizedInstruction(en){return en}
    function resolveSelection(value){return value}
    function selectionLabel(value){return nodeById(value)?.label||value}
    function indoorEndpointLabel(node){return node?.label||''}
    function floorLabel(value){return value}
    function localizedFloor(value){return value}
    function localizedNodeLabel(value){return value}
    function followNode(){} function currentHeading(){return 0}
    function floorButtons(){} function drawBaseMap(){} function updateProgressUI(){}
    function updateDirectionControls(){} function stopNavigationMotion(){navigationActive=false}
        let pendingSharedElevatorRide = null;

    function clearPendingSharedElevatorRide(){
      pendingSharedElevatorRide = null;
    }
    let routePath=['old'];
    let routeNodes=[{id:'old-stairs',type:'stairs',floor:'floor1',x:0,y:0},{id:'old-room',type:'room',floor:'floor2',x:1,y:1}];
    let progressIndex=1,progressT=.5,navigationActive=true,sensorFloorBoundary=true,followCamera=false,headingDeg=0;
  `);
  run(between(
    navigation,
    'function indoorStoredPreference(',
    'function indoorLanguage()'
  ));
  run(between(navigation, 'function buildGraph(){', 'function bestDestinationNode('));
  run(between(navigation, 'function describeRoute(', 'function updateTurnInstruction(){'));
  return {run, element};
}

test('failed accessible route clears an older stair route and disables Start', () => {
  const graph = {floors:{
    floor1:{nodes:[
      {id:'a',label:'Entrance',type:'entrance',floor:'floor1',x:0,y:0},
      {id:'s1',label:'Stairs',type:'stairs',connectorId:'S',floor:'floor1',x:1,y:0}
    ],connections:[{from:'a',to:'s1'}]},
    floor2:{nodes:[
      {id:'s2',label:'Stairs',type:'stairs',connectorId:'S',floor:'floor2',x:1,y:0},
      {id:'b',label:'Room',type:'room',floor:'floor2',x:2,y:0}
    ],connections:[{from:'s2',to:'b'}]}
  }};
  const h = indoorHarness(graph, true);
  assert.equal(h.run('dijkstra("a","b")'), null);
  h.run('route()');
  assert.equal(h.run('routePath.length'), 0);
  assert.equal(h.run('routeNodes.length'), 0);
  assert.equal(h.run('navigationActive'), false);
  assert.equal(h.element('startBtn').disabled, true);
  assert.match(h.element('routeCard').innerHTML, /No step-free route found/);
});

test('indoor route shows its walking time in the navigation banner', () => {
  const graph = {floors:{
    floor1:{nodes:[
      {id:'a',label:'Entrance',type:'entrance',floor:'floor1',x:0,y:0},
      {id:'e1',label:'Elevator',type:'elevator',connectorId:'E',floor:'floor1',x:.5,y:0}
    ],connections:[{from:'a',to:'e1'}]},
    floor2:{nodes:[
      {id:'e2',label:'Elevator',type:'elevator',connectorId:'E',floor:'floor2',x:.5,y:0},
      {id:'b',label:'Room',type:'room',floor:'floor2',x:.5,y:.5}
    ],connections:[{from:'e2',to:'b'}]}
  }};
  const h = indoorHarness(graph, true);
  h.run('this').URLSearchParams = URLSearchParams;
  h.run('this').window = {location:{search:'?building=main'}};
  h.run('function updateTurnInstruction(){}');
  h.run('route()');
  assert.equal(h.run('routeNodes.length') > 0, true);
  // 66.3 m + 50.6 m walking at 1.2 m/s plus a one-floor elevator ride (30 s + 10 s) ≈ 2.3 min.
  assert.equal(h.element('eta').textContent, '3 min');
  h.run('clearRouteState()');
  assert.equal(h.element('eta').textContent, '--');
});

test('accessible indoor route uses elevators and never stair nodes', () => {
  const graph = {floors:{
    floor1:{nodes:[
      {id:'a',type:'entrance',floor:'floor1',x:0,y:0},
      {id:'s1',type:'stairs',connectorId:'X',floor:'floor1',x:1,y:0},
      {id:'e1',type:'elevator',connectorId:'X',floor:'floor1',x:0,y:1}
    ],connections:[{from:'a',to:'s1'},{from:'a',to:'e1'}]},
    floor2:{nodes:[
      {id:'s2',type:'stairs',connectorId:'X',floor:'floor2',x:1,y:0},
      {id:'e2',type:'elevator',connectorId:'X',floor:'floor2',x:0,y:1},
      {id:'b',type:'room',floor:'floor2',x:0,y:2}
    ],connections:[{from:'s2',to:'b'},{from:'e2',to:'b'}]}
  }};
  const h = indoorHarness(graph, true);
  const pathIds = Array.from(h.run('dijkstra("a","b")'));
  assert.deepEqual(pathIds, ['a','e1','e2','b']);
  assert.ok(pathIds.every(id => h.run(`nodeById(${JSON.stringify(id)}).type`) !== 'stairs'));
});

test('Spatial indoor routing chooses fewer turns while General keeps the shortest path', () => {
  const graph = {floors:{floor1:{nodes:[
    {id:'s',type:'entrance',floor:'floor1',x:0,y:0},
    {id:'a',type:'corridor',floor:'floor1',x:0,y:.01},
    {id:'b',type:'corridor',floor:'floor1',x:.04,y:.01},
    {id:'c',type:'corridor',floor:'floor1',x:.04,y:0},
    {id:'m',type:'corridor',floor:'floor1',x:.05,y:.04},
    {id:'t',type:'room',floor:'floor1',x:.1,y:0}
  ],connections:[
    {from:'s',to:'a'}, {from:'a',to:'b'},
    {from:'b',to:'c'}, {from:'c',to:'t'},
    {from:'s',to:'m'}, {from:'m',to:'t'}
  ]}}};
  const general = indoorHarness(graph, false, 'general');
  const spatial = indoorHarness(graph, false, 'spatial');
  assert.deepEqual(
    Array.from(general.run('dijkstra("s","t")')),
    ['s','a','b','c','t']
  );
  assert.deepEqual(
    Array.from(spatial.run('dijkstra("s","t")')),
    ['s','m','t']
  );
});

test('Spatial still respects stair-free routing when accessibility is enabled', () => {
  const graph = {floors:{
    floor1:{nodes:[
      {id:'a',type:'entrance',floor:'floor1',x:0,y:0},
      {id:'s1',type:'stairs',connectorId:'X',floor:'floor1',x:1,y:0},
      {id:'e1',type:'elevator',connectorId:'X',floor:'floor1',x:0,y:1}
    ],connections:[{from:'a',to:'s1'},{from:'a',to:'e1'}]},
    floor2:{nodes:[
      {id:'s2',type:'stairs',connectorId:'X',floor:'floor2',x:1,y:0},
      {id:'e2',type:'elevator',connectorId:'X',floor:'floor2',x:0,y:1},
      {id:'b',type:'room',floor:'floor2',x:0,y:2}
    ],connections:[{from:'s2',to:'b'},{from:'e2',to:'b'}]}
  }};
  const h = indoorHarness(graph, true, 'spatial');
  const pathIds = Array.from(h.run('dijkstra("a","b")'));
  assert.deepEqual(pathIds, ['a','e1','e2','b']);
});

test('current Madriga data reports no step-free route to floor minus one instead of using stairs', () => {
  const graphContext = vm.createContext({});
  const graphSource = fs.readFileSync(path.join(root, 'app', 'prototype', 'madriga-graph.js'), 'utf8');
  vm.runInContext(`${graphSource};this.graph=MADRIGA_GRAPH`, graphContext);
  const general = indoorHarness(graphContext.graph, false);
  const accessible = indoorHarness(graphContext.graph, true);
  const generalPath = Array.from(general.run('dijkstra("floor1_n49","floorminus1_n3")'));
  assert.ok(generalPath.some(id => general.run(`nodeById(${JSON.stringify(id)}).type`) === 'stairs'));
  assert.equal(accessible.run('dijkstra("floor1_n49","floorminus1_n3")'), null);
});

test('Mobility arriving indoors keeps the accessible option on and locked', () => {
  const accessible = {checked:false, disabled:false, title:''};
  const context = vm.createContext({
    sessionStorage:{getItem(key){return key === 'accessibilityProfile' ? 'mobility' : null;}},
    document:{getElementById(id){assert.equal(id,'accessibleRoute');return accessible;}},
    localizedInstruction(en){return en}
  });
  context.$ = id => context.document.getElementById(id);
  vm.runInContext(
    between(
      navigation,
      'function indoorStoredPreference(',
      'function indoorLanguage()'
    ),
    context
  );
  const initialization = between(navigation, '// Use accessibility profile selected in the main CampusWay app.', 'applyIndoorTranslations();');
  vm.runInContext(initialization, context);
  assert.equal(accessible.checked, true);
  assert.equal(accessible.disabled, true);
  assert.match(accessible.title, /stair-free/);
  assert.equal(context.navMode, 'wheelchair');
  assert.equal(context.accessibilityLockedByProfile, true);
});

test('Mobility outdoor failure does not draw the unverified fallback path', async () => {
  const elements = new Map();
  const element = id => {
    if(!elements.has(id)) elements.set(id, {
      textContent:'', style:{}, dataset:{},
      classList:{add(name){this.added=name;}}
    });
    return elements.get(id);
  };
  const calls = [];
 const context = vm.createContext({
  clearOutdoorEndpointMarkers(){},
    document:{getElementById:element},
    sessionStorage:{removeItem(){},getItem(){return null;},setItem(){}},
    CampusOutdoorRouting:{
      async route(...args){calls.push(args);return null;},
      distance(){return 0;}
    },
    map:{removeLayer(){},fitBounds(){},closePopup(){}},
    L:{polyline(){throw new Error('fallback path must not be drawn for Mobility');}},
    window:{}, console:{error(){},warn(){}},
    getStart(){return {lat:1,lng:2,label:'Start'};},
    localizedBuildingNameByEnglishName(name){return name;},
    speak(){},
    t:{noAccessibleRoute:'No step-free outdoor route found.',noAccessibleRouteHelp:'Try another point.'},
    currentProfile:'mobility', routeLine:null, keepIndoorContextForCurrentRoute:false,
    currentOutdoorDestination:null, outdoorRouteRequestId:0,
    gpsMarker:null, customStart:null,
    BUILDING_ENTRANCES:{main:[]},
    sharedIndoorTransfer(){return null;},
    clearInterval() {}
  });
  vm.runInContext(between(index, 'async function routeTo(', 'function closeRoute(){'), context,);
  await vm.runInContext("routeTo('Outdoor destination',3,4)", context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][4].avoidSteps, true);
  assert.match(element('routeTitle').textContent, /No step-free/);
  assert.equal(element('routeEta').textContent, '—');
  assert.equal(element('routeCard').classList.added, 'show');
});

test('changing the start retries a saved destination even when no route line was drawn', () => {
  const calls = [];
  let scheduled = null;
  const elements = new Map();
  const element = id => {
    if(!elements.has(id)) elements.set(id, {value:'',classList:{remove(){}}});
    return elements.get(id);
  };
  const marker = {addTo(){return this;},bindPopup(){return this;},openPopup(){return this;}};
  const context = vm.createContext({
    document:{getElementById:element},
    L:{circleMarker(){return marker;}},
    map:{flyTo(){},removeLayer(){}},
    setTimeout(callback){scheduled=callback;},
    routeTo(...args){calls.push(args);},
    clearIndoorStartJourney(){},
    customStart:null,
    currentProfile:'mental',
    selectedStartLocation:null,
    gpsMarker:null, routeLine:null,
    startSuggestions:{style:{}},
    currentOutdoorDestination:{name:'Main Building',lat:3,lng:4,keepIndoorContext:true}
  });
  vm.runInContext(between(index, 'function pickStart(', 'const startInput ='), context);
  vm.runInContext("pickStart('New Start',1,2)", context);
  assert.equal(typeof scheduled, 'function');
  scheduled();
  assert.equal(JSON.stringify(calls), JSON.stringify([['Main Building',3,4,{keepIndoorContext:true, emergency:false}]]));

  calls.length = 0;
  vm.runInContext("currentOutdoorDestination={name:'Main Building',lat:3,lng:4,keepIndoorContext:true}; pickStart('Later Start',5,6)", context);
  vm.runInContext("currentOutdoorDestination={name:'Rabin Building',lat:7,lng:8,keepIndoorContext:false}", context);
  scheduled();
  assert.equal(calls.length, 0);
});
