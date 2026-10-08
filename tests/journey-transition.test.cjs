const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');
const navigation = fs.readFileSync(
  path.join(root, 'wayframe', 'navigation-demo.html'),
  'utf8'
).replace(/\r\n/g, '\n');
const indoorCss = fs.readFileSync(
  path.join(root, 'app', 'ui', 'indoor-nav.css'),
  'utf8'
).replace(/\r\n/g, '\n');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing ${start}`);
  return source.slice(a, b);
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    api: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    }
  };
}

const indexHelpers = between(
  index,
  'function storedJourneyFallback()',
  'function startIndoorTransition()'
);

const pageShowHandler = between(
  index,
  'async function handleCampusPageShow()',
  "window.addEventListener(\n  'pageshow'"
);

function coldReloadHarness(hasIndoorDestination) {
  const start = {
    lat: 32.761753,
    lng: 35.019978,
    label: 'Main Building',
    buildingKey: 'main',
    nodeId: 'floor700_n69',
    entranceId: 'floor600_n86'
  };

  const destination = {
    name: 'Rabin Building',
    lat: 32.76191,
    lng: 35.02039,
    keepIndoorContext: hasIndoorDestination
  };

  const savedJourney = JSON.stringify({
    version: 1,
    start,
    destination,
    startInput: 'Main Building',
    searchInput: hasIndoorDestination
      ? 'Room 5013 — Rabin Building'
      : 'Rabin Building',
    hasIndoorDestination
  });

  const session = storage({
    originIndoorComplete: 'true',
    campusTransitionDirection: 'outdoor',
    outdoorJourneyContext: savedJourney,
    indoorStartContext: JSON.stringify({
      buildingKey: 'main',
      startNodeId: 'floor700_n69',
      exitEntranceId: 'floor600_n86'
    }),
    indoorContext: JSON.stringify(
      hasIndoorDestination
        ? {
            buildingKey: 'rabin',
            destinationNodeId: 'floor5_n13',
            destinationLabel: '5013'
          }
        : {buildingKey: 'rabin'}
    )
  });

  const elements = new Map();
  const element = id => {
    if(!elements.has(id)){
      elements.set(id, {
        value: '',
        textContent: '',
        style: {},
        dataset: {}
      });
    }
    return elements.get(id);
  };

  const calls = [];
  const timers = [];
  const context = vm.createContext({
    sessionStorage: session.api,
    document: {getElementById: element},
    window: {location: {search: '?resumeJourney=1'}},
    URLSearchParams,
    Number,
    Boolean,
    JSON,
    console: {error() {}},
    setTimeout(fn, delay) {
      timers.push({fn, delay});
      return timers.length;
    },
    t: {continueIndoors: 'Continue indoors →'},
    BUILDING_ENTRANCES: {
      main: [{
        nodeId: 'floor600_n86',
        lat: start.lat,
        lng: start.lng
      }]
    },
    CAMPUS_DATA: {
      buildings: [{
        name: 'Rabin Building',
        lat: destination.lat,
        lng: destination.lng
      }]
    },
    routeTo: async (...args) => {
      calls.push(args);
      const button = element('continueIndoorBtn');
      button.style.display = 'block';
      button.dataset.destinationBuilding = 'rabin';
    }
  });

  vm.runInContext(
    `const OUTDOOR_JOURNEY_STORAGE_KEY='outdoorJourneyContext';\n` +
    `let customStart=null;\n` +
    `let currentOutdoorDestination=null;\n` +
    indexHelpers + '\n' + pageShowHandler,
    context
  );

  return {context, session, element, calls, timers, start, destination};
}

test('cold reload resumes Main-to-Rabin outdoors from the saved Main exit', async () => {
  const h = coldReloadHarness(false);

  await vm.runInContext('handleCampusPageShow()', h.context);

  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'Rabin Building');
  assert.equal(h.calls[0][3].keepIndoorContext, false);
  assert.equal(
    vm.runInContext('customStart.entranceId', h.context),
    'floor600_n86'
  );
  assert.equal(h.element('startInput').value, 'Main Building');
  assert.equal(h.element('continueIndoorBtn').style.display, 'none');
  assert.equal(h.session.values.has('originIndoorComplete'), false);
  assert.equal(h.session.values.has('campusTransitionDirection'), false);
  assert.equal(h.session.values.has('outdoorJourneyContext'), true);
});

test('room destination resumes outdoors and then offers Rabin indoor navigation', async () => {
  const h = coldReloadHarness(true);

  await vm.runInContext('handleCampusPageShow()', h.context);

  const button = h.element('continueIndoorBtn');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][3].keepIndoorContext, true);
  assert.equal(button.style.display, 'block');
  assert.equal(button.dataset.stage, 'destination');
  assert.equal(button.dataset.building, 'rabin');
  assert.equal(button.dataset.destinationBuilding, 'rabin');
});

test('stored indoor contexts rebuild the outdoor leg during a first-version upgrade', async () => {
  const h = coldReloadHarness(false);
  h.session.values.delete('outdoorJourneyContext');

  await vm.runInContext('handleCampusPageShow()', h.context);

  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'Rabin Building');
  assert.equal(
    vm.runInContext('customStart.entranceId', h.context),
    'floor600_n86'
  );
  assert.equal(h.session.values.has('outdoorJourneyContext'), true);
  assert.equal(h.element('continueIndoorBtn').style.display, 'none');
});

test('persistent preferences prefer local storage and mirror new values to the session', () => {
  const local = storage({
    campuswayLanguage: 'ar',
    accessibilityProfile: 'mobility'
  });
  const session = storage({
    campuswayLanguage: 'en',
    accessibilityProfile: 'general'
  });
  const context = vm.createContext({
    localStorage: local.api,
    sessionStorage: session.api
  });

  const preferenceCode = between(
    index,
    'const PROFILE_IDS',
    'let audioOn'
  );
  vm.runInContext(preferenceCode, context);

  assert.equal(
    vm.runInContext("readStoredPreference('campuswayLanguage')", context),
    'ar'
  );
  assert.equal(vm.runInContext('currentProfile', context), 'mobility');

  vm.runInContext(
    "writeStoredPreference('campuswayLanguage','he')",
    context
  );
  assert.equal(local.values.get('campuswayLanguage'), 'he');
  assert.equal(session.values.get('campuswayLanguage'), 'he');
});

test('outdoor directions wait until an origin indoor leg has reached the exit', () => {
  assert.match(index, /const awaitingOriginIndoorExit[\s\S]*?originIndoorComplete/);
  assert.match(index, /if\(awaitingOriginIndoorExit\)\{[\s\S]*?renderRouteSteps\(null\)/);
  assert.match(index, /routeSub'\)\.textContent = t\.startIndoorFirst/);
  assert.doesNotMatch(index, /localizedInstruction\(/);

  for(const language of ['en', 'he', 'ar', 'ru']){
    const table = between(index, `  ${language}:{`, language === 'ru' ? '\n  }\n};' : '\n  },');
    assert.match(table, /startIndoorFirst:/, `${language} includes the indoor-first route message`);
  }
});

test('indoor screen keeps current guidance visible and highlights the sidebar step', () => {
  const banner = navigation.match(/<div\b[^>]*class="navBanner"[^>]*>/);

  assert.ok(banner, 'Indoor guidance banner exists');
  assert.doesNotMatch(banner[0], /\bhidden\b/);
  assert.doesNotMatch(banner[0], /aria-hidden="true"/);
  assert.match(navigation, /function syncIndoorStepListPosition\(\)/);
  assert.doesNotMatch(navigation, /indoorShareBtn/);
  assert.doesNotMatch(navigation, /shareIndoorDestination/);
});

test('finishing the origin indoor leg waits for the user to continue outdoors', () => {
  const session = storage({
    journeyStage: 'origin',
    outdoorJourneyContext: '{}'
  });
  const elements = new Map();
  const element = id => {
    if(!elements.has(id)){
      elements.set(id, {
        textContent: '',
        style: {},
        disabled: false
      });
    }
    return elements.get(id);
  };
  const timers = [];
  let replaced = null;
  let backed = false;

  const context = vm.createContext({
    sessionStorage: session.api,
    window: {
      location: {
        search: '?building=main',
        replace(url) { replaced = url; },
        assign() {}
      },
      history: {
        length: 2,
        back() { backed = true; }
      }
    },
    URLSearchParams,
    encodeURIComponent,
    setTimeout(fn, delay) {
      timers.push({fn, delay});
      return timers.length;
    },
    $: element,
    localizedInstruction: english => english,
    localizedFloor: floor => floor,
    localizedNodeLabel: label => label,
    stopNavigationMotion() {},
    followNode() {},
    floorButtons() {},
    drawBaseMap() {},
    updateProgressUI() {},
    console: {warn() {}, error() {}}
  });

  const transitionCode = between(
    navigation,
    'function setJourneyPlanLegByKind(kind)',
    'function screenOrientationAngle()'
  );

  vm.runInContext(
    `let progressIndex=0,progressT=0,activeFloor='floor600';\n` +
    `const routeNodes=[{floor:'floor600',label:'Main exit'}];\n` +
    transitionCode,
    context
  );

  vm.runInContext('completeNavigation()', context);

  assert.equal(session.values.get('originIndoorComplete'), 'true');
  assert.equal(session.values.get('journeyStage'), 'destination');
    // The completion dialog lets the person choose when to leave the building.
  assert.equal(timers.length, 0);
  assert.equal(replaced, null);
  assert.match(element('status').textContent, /Exit reached/i);
  assert.equal(vm.runInContext('arrivalNextStep.kind', context), 'outdoor');

  vm.runInContext('arrivalNextStep.run()', context);

  assert.equal(
    session.values.get('campusTransitionDirection'),
    'outdoor'
  );
  assert.equal(replaced, '../index.html?resumeJourney=1');
  assert.equal(backed, false);
});

test('New route from here returns to the campus planner with the arrived node', () => {
  const session = storage({
    journeyStage: 'destination',
    indoorContext: '{}',
    outdoorJourneyContext: '{}'
  });
  let replaced = null;
  const context = vm.createContext({
    sessionStorage: session.api,
    BUILDING: 'rabin',
    routeNodes: [{id: 'floor7_n42', floor: 'floor7', label: '7001'}],
    window: {location: {replace(url) { replaced = url; }}},
    console: {warn() {}}
  });

  vm.runInContext(
    between(navigation, 'function clearCompletedJourneyState()', 'function showArrivalDialog(next)'),
    context
  );
  vm.runInContext('setRouteFromArrival()', context);

  assert.equal(replaced, '../index.html?newRouteFromHere=1');
  assert.deepEqual(
    JSON.parse(session.values.get('newRouteStartContext')),
    {version: 1, buildingKey: 'rabin', nodeId: 'floor7_n42', label: '7001', displayLabel: '7001'}
  );
  assert.equal(session.values.has('indoorContext'), false);
  assert.equal(session.values.has('outdoorJourneyContext'), false);
});

test('Done returns to the campus map and clears completed journey state', () => {
  const session = storage({
    journeyStage: 'destination',
    indoorContext: '{}',
    outdoorJourneyContext: '{}',
    sharedNavigationResume: '{}'
  });
  let replaced = null;
  const context = vm.createContext({
    sessionStorage: session.api,
    window: {location: {replace(url) { replaced = url; }}},
    console: {warn() {}}
  });

  vm.runInContext(
    between(navigation, 'function clearCompletedJourneyState()', 'function setRouteFromArrival()'),
    context
  );
  vm.runInContext('returnToCampusMap()', context);

  assert.equal(replaced, '../index.html');
  assert.equal(session.values.has('journeyStage'), false);
  assert.equal(session.values.has('indoorContext'), false);
  assert.equal(session.values.has('outdoorJourneyContext'), false);
  assert.equal(session.values.has('sharedNavigationResume'), false);
});
test('campus planner restores a new route start from the arrived indoor node', async () => {
  const session = storage({
    newRouteStartContext: JSON.stringify({
      version: 1,
      buildingKey: 'rabin',
      nodeId: 'floor7_n42',
      label: '7001',
      displayLabel: 'Room 7001'
    })
  });
  const calls = [];
  let replacedUrl = null;
  const search = {focus() { calls.push('focus'); }};
  const context = vm.createContext({
    sessionStorage: session.api,
    URLSearchParams,
    URL,
    window: {
      location: {
        search: '?newRouteFromHere=1',
        href: 'https://example.test/index.html?newRouteFromHere=1'
      },
      history: {replaceState(_state, _title, url) { replacedUrl = url; }}
    },
    document: {getElementById(id) { return id === 'searchInput' ? search : null; }},
    INDOOR_NAVIGATION_BUILDINGS: {'Rabin Building': 'rabin'},
    NEW_ROUTE_START_STORAGE_KEY: 'newRouteStartContext',
    indoorSearchGraphsReady: Promise.resolve(),
    graphForBuilding() {
      return {floors: {floor7: {nodes: [{id: 'floor7_n42', label: '7001'}]}}};
    },
    pickIndoorStart(...args) { calls.push(args); },
    Object
  });

  vm.runInContext(
    between(index, 'async function restoreNewRouteStartFromArrival()', 'async function handleCampusPageShow()'),
    context
  );
  assert.equal(await vm.runInContext('restoreNewRouteStartFromArrival()', context), true);
  assert.deepEqual(calls[0], ['floor7_n42', '7001', 'rabin', 'Room 7001']);
  assert.equal(calls.includes('focus'), true);
  assert.equal(replacedUrl, '/index.html');
  assert.equal(session.values.has('newRouteStartContext'), false);
});
