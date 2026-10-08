const assert = require('node:assert/strict');
const {test} = require('node:test');
const path = require('node:path');
const instructions = require(path.join(__dirname, '..', 'app', 'prototype', 'route-instructions.js'));

// About 1 m in degrees near the campus.
const LAT_M = 1 / 110540;
const LNG_M = 1 / (111320 * Math.cos(32.76 * Math.PI / 180));
const at = (northMeters, eastMeters) => [32.76 + northMeters * LAT_M, 35.02 + eastMeters * LNG_M];

test('an L-shaped route turns once, with the distance before the turn', () => {
  const route = {
    coordinates: [at(0, 0), at(20, 0), at(40, 0), at(60, 0), at(60, 20), at(60, 45)],
    edges: [{type:'footway'}, {type:'footway'}, {type:'footway'}, {type:'footway'}]
  };
  const {steps, totalMeters} = instructions.buildOutdoorSteps(route, {startName:'A', endName:'B'});
  assert.ok(Math.abs(totalMeters - 105) < 1);
  assert.deepEqual(steps.map(step => step.kind), ['start', 'turn', 'arrive']);
  assert.equal(steps[0].heading, 'north');
  assert.equal(steps[1].turn, 'right');
  assert.ok(Math.abs(steps[1].meters - 60) < 1);
  assert.equal(instructions.formatStep(steps[1], 'en'), 'Walk 60 m, then turn right');
  assert.equal(instructions.formatStep(steps[2], 'en'), 'Walk 45 m to arrive at B');
  assert.equal(instructions.formatCompactStep(steps[0], 'en'), 'Head north');
  assert.equal(instructions.formatCompactStep(steps[1], 'en'), 'turn right');
  assert.equal(instructions.formatCompactStep(steps[2], 'en'), 'Arrive at B');
});

test('small wiggles do not become turns and a nearby building names the turn', () => {
  const route = {
    coordinates: [at(0, 0), at(30, 1), at(60, -1), at(90, 0), at(90, -40)],
    edges: [{type:'path'}, {type:'path'}, {type:'path'}]
  };
  const building = {name:'Rabin Building', polygon:[at(95, 5), at(110, 5), at(110, 20), at(95, 20), at(95, 5)]};
  const {steps} = instructions.buildOutdoorSteps(route, {landmarks:[building]});
  assert.deepEqual(steps.map(step => step.kind), ['start', 'turn', 'arrive']);
  assert.equal(steps[1].turn, 'left');
  assert.equal(steps[1].landmark, 'Rabin Building');
  assert.match(instructions.formatStep(steps[1], 'he'), /פנה שמאלה ליד Rabin Building/);
  assert.match(instructions.formatStep(steps[1], 'ar'), /انعطف يسارًا قرب Rabin Building/);
  assert.equal(instructions.formatCompactStep(steps[1], 'ar'), 'انعطف يسارًا');
});

test('entering a flight of steps is its own step', () => {
  const route = {
    // [start, three graph nodes, end]: edges join the graph nodes.
    coordinates: [at(0, 0), at(0, 10), at(0, 30), at(0, 40), at(0, 60)],
    edges: [{type:'steps'}, {type:'footway'}]
  };
  const {steps} = instructions.buildOutdoorSteps(route, {});
  assert.deepEqual(steps.map(step => step.kind), ['start', 'stairs', 'arrive']);
  assert.equal(instructions.formatStep(steps[1], 'en'), 'Walk 10 m, then take the stairs');
});

test('empty or one-point routes give no steps', () => {
  assert.deepEqual(instructions.buildOutdoorSteps({coordinates:[at(0, 0)]}).steps, []);
  assert.deepEqual(instructions.buildOutdoorSteps(null).steps, []);
});

test('a long straight walk names a building you pass and on which side', () => {
  const route = {
    coordinates: [at(0, 0), at(100, 0), at(200, 0), at(300, 0)],
    edges: [{type:'path'}, {type:'path'}]
  };
  // A building 15 m west of the path, halfway along.
  const building = {name:'Main Building', polygon:[at(140, -40), at(160, -40), at(160, -15), at(140, -15), at(140, -40)]};
  const {steps} = instructions.buildOutdoorSteps(route, {landmarks:[building], endName:'B'});
  assert.deepEqual(steps.map(step => step.kind), ['start', 'pass', 'arrive']);
  assert.equal(steps[1].side, 'left');
  assert.match(instructions.formatStep(steps[1], 'en'), /^Walk \d+ m, passing Main Building on your left$/);
  assert.match(instructions.formatStep(steps[1], 'he'), /משמאלך/);
});

test('Russian route instructions cover starts, turns, stairs, landmarks and arrival', () => {
  const expectedCompass = {
    north:'на север',
    northeast:'на северо-восток',
    east:'на восток',
    southeast:'на юго-восток',
    south:'на юг',
    southwest:'на юго-запад',
    west:'на запад',
    northwest:'на северо-запад'
  };
  Object.entries(expectedCompass).forEach(([heading, text]) => {
    assert.equal(
      instructions.formatStep({kind:'start', heading}, 'ru'),
      `Двигайтесь ${text}`
    );
  });

  assert.equal(
    instructions.formatStep({kind:'start', name:'Главный корпус', heading:'north'}, 'ru'),
    'Начните в точке «Главный корпус» и двигайтесь на север'
  );

  const expectedTurns = {
    left:'поверните налево',
    right:'поверните направо',
    'slight-left':'держитесь левее',
    'slight-right':'держитесь правее',
    'sharp-left':'резко поверните налево',
    'sharp-right':'резко поверните направо'
  };
  Object.entries(expectedTurns).forEach(([turn, text]) => {
    assert.equal(
      instructions.formatStep({kind:'turn', meters:20, turn, landmark:'Библиотека'}, 'ru'),
      `Пройдите 20 м, затем ${text} рядом с ориентиром «Библиотека»`
    );
  });

  assert.equal(
    instructions.formatStep({kind:'stairs', meters:15}, 'ru'),
    'Пройдите 15 м, затем воспользуйтесь лестницей'
  );
  assert.equal(
    instructions.formatStep({kind:'pass', meters:30, landmark:'Кафе', side:'left'}, 'ru'),
    'Пройдите 30 м; ориентир «Кафе» будет слева'
  );
  assert.equal(
    instructions.formatStep({kind:'pass', meters:30, landmark:'Кафе', side:'right'}, 'ru'),
    'Пройдите 30 м; ориентир «Кафе» будет справа'
  );
  assert.equal(
    instructions.formatStep({kind:'arrive', meters:10, name:'Аудитория 5001'}, 'ru'),
    'Пройдите 10 м до точки «Аудитория 5001»'
  );
});

test('an unknown instruction language still falls back to English', () => {
  assert.equal(
    instructions.formatStep({kind:'stairs', meters:10}, 'xx'),
    'Walk 10 m, then take the stairs'
  );
});
