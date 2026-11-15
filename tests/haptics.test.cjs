const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const nav = read('wayframe/navigation-demo.html');
const source = read('app/ui/haptics.js');

const {between} = require('./helpers/campus-harness.cjs');

// Loads app/ui/haptics.js as the browser does, with or without navigator.vibrate.
function haptics(vibrate){
  const calls = [];
  const context = vm.createContext({
    self:{navigator: vibrate ? {vibrate:pattern => { calls.push(pattern); return true; }} : {userAgent:'iPhone'}}
  });
  vm.runInContext(source, context);
  return {api:context.self.CampusHaptics, calls};
}

test('turns, floor changes and arrival have their own vibration patterns', () => {
  const {api, calls} = haptics(true);
  assert.equal(api.supported(), true);
  assert.equal(api.turn(), true);
  assert.equal(api.floor(), true);
  assert.equal(api.arrive(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[200], [150, 100, 150], [300, 150, 300, 150, 300]]);
});

test('iPhones without vibration support are left alone', () => {
  const {api, calls} = haptics(false);
  assert.equal(api.supported(), false);
  assert.equal(api.turn(), false);
  assert.equal(api.arrive(), false);
  assert.deepEqual(calls, []);
});

// Runs the indoor page's vibrateForGuidance() with a fake turn arrow.
function indoor({profile = 'visual', active = true} = {}){
  const calls = [];
  const icon = {textContent:'↑'};
  const context = vm.createContext({
    navigationActive:active,
    routeNodes:[{id:'a'}, {id:'b'}],
    progressIndex:0,
    selectedRoutingProfile:() => profile,
    $:() => icon,
    CampusHaptics:{turn:() => calls.push('turn'), floor:() => calls.push('floor'), arrive:() => calls.push('arrive')}
  });
  vm.runInContext(between(nav, 'let lastHapticRoute = null;', 'function announceArrival(){'), context);
  const show = (arrow, at = context.progressIndex) => {
    icon.textContent = arrow;
    context.progressIndex = at;
    vm.runInContext('vibrateForGuidance()', context);
  };
  return {calls, show, context};
}

test('indoors, the Visual profile vibrates once per turn and twice for a floor change', () => {
  const h = indoor();
  h.show('↑', 0);
  h.show('↱', 0);
  h.show('↱', 0); // the arrow is redrawn while walking: no second vibration
  h.show('↑', 1);
  h.show('↰', 2);
  h.show('↕', 3);
  assert.deepEqual(h.calls, ['turn', 'turn', 'floor']);
});

test('indoors, other profiles and a stopped navigation do not vibrate', () => {
  for(const options of [{profile:'general'}, {profile:'mobility'}, {active:false}]){
    const h = indoor(options);
    h.show('↱', 0);
    h.show('↕', 1);
    assert.deepEqual(h.calls, [], JSON.stringify(options));
  }
});

test('a new route starts counting turns again', () => {
  const h = indoor();
  h.show('↱', 0);
  h.context.routeNodes = [{id:'c'}, {id:'d'}];
  h.show('↱', 0);
  assert.deepEqual(h.calls, ['turn', 'turn']);
});

test('arrival vibrates indoors and outdoors for the Visual profile only', () => {
  // Indoors the arrival message vibrates: the longer pattern for Visual, a short buzz for the rest.
  assert.match(
  nav,
  /primary\.focus\(\);[\s\S]{0,500}?selectedRoutingProfile\(\)\s*===\s*["']visual["'][\s\S]{0,150}?CampusHaptics\.arrive\(\);\s*else\s*try\s*\{\s*navigator\.vibrate\?\.\(\[60,\s*40,\s*60\]\)/
);
  const outdoor = between(index, 'function updateOutdoorGuidance(state, distance, point){', '\nfunction ');
  assert.match(outdoor, /state\.finished = true;\s*\r?\n\s*if\(currentProfile === 'visual'[^\n]*CampusHaptics\.arrive\(\)/);
  assert.match(outdoor, /currentProfile === 'visual' &&\s*\r?\n\s*\['turn', 'stairs'\]\.includes\(step\.kind\) &&\s*\r?\n\s*step\.at - state\.distance <= 15 &&\s*\r?\n\s*state\.lastHapticStep !== index/);
});

test('both pages load the vibration helper and it works offline', () => {
  assert.match(index, /<script src="app\/ui\/haptics\.js"><\/script>/);
  assert.match(nav, /<script src="\.\.\/app\/ui\/haptics\.js"><\/script>/);
  assert.match(read('service-worker.js'), /'\.\/app\/ui\/haptics\.js'/);
});
