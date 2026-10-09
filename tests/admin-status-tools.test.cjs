const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const Schema = require('../app/admin/status-schema');
const Health = require('../app/admin/data-health');

const root = path.join(__dirname, '..');
const graph = key => JSON.parse(fs.readFileSync(path.join(root, `buildings/${key}/${key}-indoor-graph.json`), 'utf8'));

function entrances(){
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync(path.join(root, 'app/prototype/data.js'), 'utf8')};this.E = BUILDING_ENTRANCES;`, context);
  return context.E;
}

test('the current status file is valid', () => {
  const file = JSON.parse(fs.readFileSync(path.join(root, 'app/data/campus-status.json'), 'utf8'));
  const result = Schema.validateStatus(file);
  assert.deepEqual(result.errors, []);
});

test('status validation catches common mistakes', () => {
  const result = Schema.validateStatus({
    elevators:[{building:'nowhere', elevator:'1'}, {building:'rabin', elevator:'', from:'2026-05-02', until:'2026-05-01'}],
    closures:[{area:[[32.76, 35.02], [32.76, 35.03]]}, {building:'main', nodeIds:[]}],
    announcements:[{text:{he:'רק עברית'}}],
    openingHours:{'Cafe Aguda':{sun:'8-16'}},
    reportEmail:'not-an-email'
  });
  const text = result.errors.join('\n');
  assert.match(text, /unknown building "nowhere"/);
  assert.match(text, /choose an elevator/);
  assert.match(text, /ends before it starts/);
  assert.match(text, /at least 3 corners/);
  assert.match(text, /at least one place/);
  assert.match(text, /English text is required/);
  assert.match(text, /Opening hours for Cafe Aguda, sun/);
  assert.match(text, /not a valid e-mail/);
});

test('validation drops unknown fields and keeps known ones', () => {
  const {status} = Schema.validateStatus({
    elevators:[{building:'rabin', elevator:'2', until:'2099-01-01', secret:'x'}],
    names:{'Cafe Aguda':{ar:'مقهى', fr:'Café'}},
    extra:true
  });
  assert.deepEqual(status.elevators, [{building:'rabin', elevator:'2', status:'out-of-service', until:'2099-01-01'}]);
  assert.deepEqual(status.names, {'Cafe Aguda':{ar:'مقهى'}});
  assert.equal(status.extra, undefined);
});

test('roles map to the sections they may change', () => {
  const before = {elevators:[], names:{}};
  const after = {elevators:[{building:'main', elevator:'1'}], names:{'Delta':{ru:'Дельта'}}};
  assert.deepEqual(Schema.changedSections(before, after).sort(), ['elevators', 'names']);
  assert.deepEqual(Schema.missingPermissions('content', before, after), ['status']);
  assert.deepEqual(Schema.missingPermissions('facilities', before, after), ['content']);
  assert.deepEqual(Schema.missingPermissions('admin', before, after), []);
  assert.equal(Schema.can('accessibility', 'emergency'), false);
});

test('timing tells active, scheduled and ended entries apart', () => {
  const now = new Date('2026-10-09T12:00:00').getTime();
  assert.equal(Schema.timing({from:'2026-10-01', until:'2026-10-09'}, now), 'active');
  assert.equal(Schema.timing({from:'2026-10-10'}, now), 'scheduled');
  assert.equal(Schema.timing({until:'2026-10-08'}, now), 'ended');
});

test('data health finds the known step-free gap in the Terrace Building', () => {
  const result = Health.analyzeBuilding('madriga', graph('madriga'), {entrances:entrances().madriga});
  const gap = result.issues.find(issue => issue.code === 'no-step-free');
  assert.ok(gap, 'floor 0 has no mapped elevator');
  assert.equal(result.stats.perFloor.floor0.stepFree, 0);
  assert.ok(result.stats.perFloor.floor0.reachable > 0);
  assert.ok(result.stats.stepFree < result.stats.reachable);
});

test('impact: losing every Main Building elevator removes step-free access, closing nothing removes nothing', () => {
  const main = graph('main');
  const all = new Set(Health.elevators(main).map(item => item.number));
  const none = {closed:new Set(), elevatorOut:() => false};
  const out = Health.impact(main, entrances().main, none, {closed:new Set(), elevatorOut:id => all.has(Health.elevatorNumber(id))});
  assert.ok(out.stepFree.length > 0);
  assert.equal(out.general.length, 0, 'stairs still reach every floor');
  const same = Health.impact(main, entrances().main, none, none);
  assert.deepEqual(same, {general:[], stepFree:[]});
});

test('impact: closing a corridor node cuts off what lies behind it', () => {
  const tiny = {floors:{floor1:{
    nodes:[
      {id:'e', type:'entrance', x:0, y:0},
      {id:'c', type:'corridor', x:.5, y:0},
      {id:'r', type:'room', label:'101', x:1, y:0}
    ],
    connections:[{from:'e', to:'c'}, {from:'c', to:'r'}]
  }}};
  const result = Health.impact(tiny, [], {closed:new Set()}, {closed:new Set(['c'])});
  assert.deepEqual(result.general.map(node => node.id), ['r']);
});
