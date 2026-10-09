// Loads the real campus-map code (index.html sections), the real campus data,
// indoor graphs, outdoor path network and live-status module into a sandbox,
// so tests can run app functions against the data the app actually ships.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const BUILDING_KEYS = ['main', 'rabin', 'student', 'madriga', 'education', 'multi-purpose'];
const GRAPH_GLOBALS = {
  main:'MAIN_GRAPH', rabin:'RABIN_GRAPH', student:'STUDENT_GRAPH',
  madriga:'MADRIGA_GRAPH', education:'EDUCATION_GRAPH', 'multi-purpose':'MULTI_PURPOSE_GRAPH'
};

function between(source, start, end){
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if(a < 0 || b < 0) throw new Error(`index.html changed: cannot find "${start}" … "${end}"`);
  return source.slice(a, b);
}

function graph(key){
  return JSON.parse(read(`buildings/${key}/${key}-indoor-graph.json`));
}

function memoryStorage(){
  const data = new Map();
  return {
    getItem:key => data.has(key) ? data.get(key) : null,
    setItem:(key, value) => data.set(key, String(value)),
    removeItem:key => data.delete(key),
    data
  };
}

// options: {status, profile, now, search}
function campusHarness(options = {}){
  const calls = {routeTo:[], notify:[], pickIndoorDestination:[], pickDestination:[], pickStart:[], pickIndoorStart:[], routeToFoodPlace:[], routeToShopPlace:[], emergency:0};
  const elements = new Map();
  const element = id => {
    if(!elements.has(id)) elements.set(id, {id, value:'', attributes:{}, setAttribute(k, v){ this.attributes[k] = v; }, removeAttribute(k){ delete this.attributes[k]; }});
    return elements.get(id);
  };
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const search = options.search || '';
  const context = vm.createContext({
    console:{log(){}, warn(){}, error(){}},
    URL, URLSearchParams, Promise, setTimeout, clearTimeout,
    // options.clock = {now: <ms>} sets "now" for the app code; tests can move it.
    Date: options.clock ? class extends Date {
      constructor(...args){ super(...(args.length ? args : [options.clock.now])); }
      static now(){ return options.clock.now; }
    } : Date,
    sessionStorage, localStorage,
    document:{getElementById:element},
    history:{replaceState(){}},
    location:{href:`https://ja4smin.github.io/CampusWay/index.html${search}`, protocol:'https:', hostname:'ja4smin.github.io', search, pathname:'/CampusWay/index.html'},
    CampusRoutePlanner:require('../../wayframe/route-planner.js'),
    // The outdoor router and the status module fetch their data files.
    fetch:async url => {
      const file = String(url).replace(/^.*?(app\/|buildings\/)/, '$1');
      if(file.endsWith('campus-status.json')) return {ok:true, json:async () => options.status || {}};
      return {ok:true, json:async () => JSON.parse(read(file))};
    }
  });
  context.window = context;
  context.self = context;
  const run = code => vm.runInContext(code, context);

  run(`${read('app/prototype/data.js')}
    this.CAMPUS_DATA = CAMPUS_DATA; this.BUILDING_ENTRANCES = BUILDING_ENTRANCES; this.PLACE_NAMES_HE = PLACE_NAMES_HE;`);
  run(`${read('app/prototype/outdoor-routing.js')}; this.CampusOutdoorRouting = CampusOutdoorRouting;`);
  run(read('app/ui/campus-status.js'));
  BUILDING_KEYS.forEach(key => { context[GRAPH_GLOBALS[key]] = graph(key); });

  run(`
    var lang = 'en';
    var currentProfile = ${JSON.stringify(options.profile || 'general')};
    var customStart = null;
    var indoorSearchGraphsReady = Promise.resolve();
    var startOverride = null;
    const t = {
      emergencyFinding:'Finding the nearest shelter…', emergencyNoShelter:'No mapped shelter could be reached from here.',
      emergencyRoute:'Nearest shelter', emergencyIndoorUnmapped:'The shelter is inside this building; follow the signs.',
      sharedLinkMissing:'This link points to a place CampusWay no longer has.', sharedLinkStart:'Choose where you are starting.',
      sharedLocation:'Shared location', sharedLocationHint:'Shared hint', room:'Room', legendClinic:'Clinic'
    };
    function getStart(){ return startOverride || {lat:32.758920626688536, lng:35.02135898321563, label:'Carmel Gate'}; }
    function notify(message){ __calls.notify.push(message); }
    async function routeTo(name, lat, lng, options = {}){ __calls.routeTo.push({name, lat, lng, options}); }
    function localizedBuildingName(building){ return building ? building.name : ''; }
    function localizedPlaceName(place){ return place.name; }
    function indoorSearchName(node){ return node.label || node.type; }
    async function pickIndoorDestination(nodeId, label, buildingKey, display){ __calls.pickIndoorDestination.push({nodeId, label, buildingKey, display}); }
    async function pickDestination(name, lat, lng){ __calls.pickDestination.push({name, lat, lng}); }
    function pickStart(name, lat, lng){ __calls.pickStart.push({name, lat, lng}); }
    function pickIndoorStart(nodeId, label, buildingKey){ __calls.pickIndoorStart.push({nodeId, label, buildingKey}); }
    function routeToFoodPlace(place){ __calls.routeToFoodPlace.push(place.name); }
    function routeToShopPlace(place){ __calls.routeToShopPlace.push(place.name); }
  `);
  context.__calls = calls;

  run(between(index, 'const REPORT_BUILDING_NAMES = {', '// Elevators of a building'));
  run(between(index, 'function indoorEtaNodes(graph){', 'async function indoorLegUsesElevator'));
  run(between(index, 'function searchableCampusPlaces(){', 'function localizedPlaceName(place){'));
  run(between(index, 'function shareTargetCode(target){', 'function openShareDialog('));
  run(between(index, 'function parseSharedMeetLocation(value){', 'function shareMyLocation(){'));
  run(between(index, 'function findSharedTarget(code){', '// EMERGENCY: one tap'));
  run(between(index, 'var emergencyRouteActive = false;', '// GPS / STARTING POINT'));

  return {
    run, context, calls, element, sessionStorage,
    async ready(){
      await context.CampusOutdoorRouting.load();
      await context.CampusStatus.load('app/data/campus-status.json');
    },
    startAt(start){ context.startOverride = start; },
    profile(value){ run(`currentProfile = ${JSON.stringify(value)}`); }
  };
}

module.exports = {campusHarness, between, graph, read, root, BUILDING_KEYS};
