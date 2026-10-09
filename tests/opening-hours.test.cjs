// Opening hours from the live status file ("Open now · until 18:00"), now
// edited from the admin screen. Times use the phone's local clock.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {campusHarness} = require('./helpers/campus-harness.cjs');

const WEEKDAYS = {sun:'07:30-18:00', mon:'07:30-18:00', tue:'07:30-18:00', wed:'07:30-18:00', thu:'07:30-18:00', fri:'07:30-12:00', sat:'closed'};
const HOURS = {
  'Cafe Aguda':WEEKDAYS,
  'Library':{sun:'08:00-12:00,13:00-16:00', mon:'08:00-12:00,13:00-16:00', tue:'08:00-12:00,13:00-16:00', wed:'08:00-12:00,13:00-16:00', thu:'08:00-12:00,13:00-16:00', fri:'closed', sat:'closed'},
  'University Clinic':'24/7',
  'Closed Kiosk':{sun:'closed', mon:'closed', tue:'closed', wed:'closed', thu:'closed', fri:'closed', sat:'closed'},
  'Typo Cafe':{sun:'8-16', mon:'08:00-16:00', tue:'closed', wed:'closed', thu:'closed', fri:'closed', sat:'closed'}
};

// 11 October 2026 is a Sunday. Local time, so the result does not depend on the time zone.
const at = (day, hour, minute = 0) => new Date(2026, 9, 11 + day, hour, minute).getTime();
const SUN = 0, THU = 4, FRI = 5, SAT = 6;

async function hours(now){
  const clock = {now};
  const h = campusHarness({status:{openingHours:HOURS}, clock});
  await h.ready();
  return {
    state:name => h.run(`CampusStatus.hours(${JSON.stringify(name)})`),
    text:(name, lang = 'en') => h.run(`CampusStatus.hoursText(${JSON.stringify(name)}, ${JSON.stringify(lang)})`),
    clock
  };
}

test('open now shows the closing time', async () => {
  const h = await hours(at(SUN, 10, 0));
  assert.deepEqual({...h.state('Cafe Aguda')}, {open:true, closes:'18:00'});
  assert.equal(h.text('Cafe Aguda'), 'Open now · until 18:00');
});

test('before opening shows today’s opening time; at closing time it is closed', async () => {
  const h = await hours(at(SUN, 7, 0));
  assert.deepEqual({...h.state('Cafe Aguda')}, {open:false, opens:'07:30', day:null});
  assert.equal(h.text('Cafe Aguda'), 'Closed now · opens 07:30');
  h.clock.now = at(SUN, 18, 0);
  assert.equal(h.state('Cafe Aguda').open, false, '18:00-closing means closed at 18:00');
  h.clock.now = at(SUN, 17, 59);
  assert.equal(h.state('Cafe Aguda').open, true);
});

test('after closing shows the next opening day, skipping closed days', async () => {
  const h = await hours(at(THU, 19, 0));
  assert.equal(h.text('Cafe Aguda'), 'Closed now · opens Fri 07:30');
  h.clock.now = at(FRI, 13, 0);
  assert.equal(h.text('Cafe Aguda'), 'Closed now · opens Sun 07:30', 'Saturday is closed');
  h.clock.now = at(SAT, 23, 30);
  assert.equal(h.text('Cafe Aguda'), 'Closed now · opens Sun 07:30');
});

test('split hours: closed over the lunch break, open again after it', async () => {
  const h = await hours(at(SUN, 11, 59));
  assert.deepEqual({...h.state('Library')}, {open:true, closes:'12:00'});
  h.clock.now = at(SUN, 12, 30);
  assert.equal(h.text('Library'), 'Closed now · opens 13:00');
  h.clock.now = at(SUN, 13, 0);
  assert.deepEqual({...h.state('Library')}, {open:true, closes:'16:00'});
  h.clock.now = at(THU, 16, 30);
  assert.equal(h.text('Library'), 'Closed now · opens Sun 08:00', 'Friday and Saturday closed');
});

test('24/7 is always open; closed all week says just "Closed"; unknown places show nothing', async () => {
  for(const now of [at(SUN, 3, 0), at(FRI, 23, 59), at(SAT, 12, 0)]){
    const h = await hours(now);
    assert.equal(h.state('University Clinic').open, true);
  }
  const h = await hours(at(SUN, 10, 0));
  assert.deepEqual({...h.state('Closed Kiosk')}, {open:false, opens:null, day:null});
  assert.equal(h.text('Closed Kiosk'), 'Closed');
  assert.equal(h.state('Not In The File'), null);
  assert.equal(h.text('Not In The File'), '');
});

test('a malformed range never shows as open', async () => {
  const h = await hours(at(SUN, 10, 0));
  assert.equal(h.state('Typo Cafe').open, false, '"8-16" is not understood, so Sunday counts as closed');
  assert.equal(h.text('Typo Cafe'), 'Closed now · opens Mon 08:00');
});

test('the hours line speaks every language, with local day names', async () => {
  const h = await hours(at(THU, 19, 0));
  assert.equal(h.text('Cafe Aguda', 'he'), 'סגור עכשיו · נפתח ו׳ 07:30');
  assert.equal(h.text('Cafe Aguda', 'ar'), 'مغلق الآن · يفتح الجمعة 07:30');
  assert.equal(h.text('Cafe Aguda', 'ru'), 'Закрыто сейчас · откроется Пт 07:30');
  h.clock.now = at(SUN, 10, 0);
  assert.equal(h.text('Cafe Aguda', 'he'), 'פתוח עכשיו · עד 18:00');
  assert.equal(h.text('Cafe Aguda', 'ar'), 'مفتوح الآن · حتى 18:00');
  assert.equal(h.text('Cafe Aguda', 'xx'), 'Open now · until 18:00', 'unknown language falls back to English');
});
