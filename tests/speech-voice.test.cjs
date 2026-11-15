// The audio guide speaks only with a voice for the app language. A device
// without one gets a notice instead of an English voice reading Arabic or
// Hebrew text (which says only the numbers).
const assert = require('node:assert/strict');
const {test} = require('node:test');
const Speech = require('../app/ui/speech-voice.js');
const {read} = require('./helpers/campus-harness.cjs');

const voice = (lang, name = `Voice ${lang}`) => ({lang, name, voiceURI: name});
const englishOnly = [voice('en-US', 'Microsoft David'), voice('en-US', 'Microsoft Zira')];
const synth = voices => ({getVoices: () => voices});

test('a device with only English voices has no Arabic or Hebrew voice', () => {
  assert.equal(Speech.voiceState('en', synth(englishOnly)), 'ok');
  assert.equal(Speech.voiceState('ar', synth(englishOnly)), 'missing');
  assert.equal(Speech.voiceState('he', synth(englishOnly)), 'missing');
  assert.equal(Speech.pickVoice(englishOnly, 'ar'), null);
});

test('no voice list yet, or no speech at all, is not reported as missing', () => {
  assert.equal(Speech.voiceState('ar', synth([])), 'unknown');
  assert.equal(Speech.voiceState('ar', null), 'unsupported');
});

test('Hebrew voices named "iw" (Android) are found', () => {
  const voices = [...englishOnly, voice('iw_IL', 'Hebrew Android')];
  assert.equal(Speech.pickVoice(voices, 'he').name, 'Hebrew Android');
  assert.equal(Speech.voiceState('he', synth(voices)), 'ok');
});

test('the saved voice wins, then Google or natural voices, then the exact locale', () => {
  const voices = [voice('ar-EG', 'Arabic Egypt'), voice('ar-SA', 'Arabic Saudi'), voice('ar-XA', 'Google العربية')];
  assert.equal(Speech.pickVoice(voices, 'ar').name, 'Google العربية');
  assert.equal(Speech.pickVoice(voices, 'ar', 'Arabic Egypt').name, 'Arabic Egypt');
  assert.equal(Speech.pickVoice(voices.slice(0, 2), 'ar').name, 'Arabic Saudi');
  assert.equal(Speech.pickVoice(voices, 'ar', 'Microsoft David').name, 'Google العربية', 'a saved voice of another language is ignored');
});

test('distances are read as words, not as a single letter', () => {
  assert.equal(Speech.speechText('امشِ 6 م، ثم انعطف يمينًا', 'ar'), 'امشِ 6 أمتار، ثم انعطف يمينًا');
  assert.equal(Speech.speechText('امشِ 25 م حتى تصل', 'ar'), 'امشِ 25 مترًا حتى تصل');
  assert.equal(Speech.speechText('امشِ 2 م', 'ar'), 'امشِ مترين');
  assert.equal(Speech.speechText('ابدأ من المدخل', 'ar'), 'ابدأ من المدخل', 'words starting with م are untouched');
  assert.equal(Speech.speechText('לך 10 מ׳, ואז פנה ימינה', 'he'), 'לך 10 מטרים, ואז פנה ימינה');
  assert.equal(Speech.speechText('Пройдите 21 м, затем', 'ru'), 'Пройдите 21 метр, затем');
  assert.equal(Speech.speechText('Пройдите 3 м', 'ru'), 'Пройдите 3 метра');
  assert.equal(Speech.speechText('Пройдите 12 м', 'ru'), 'Пройдите 12 метров');
  assert.equal(Speech.speechText('Walk 40 m, then turn left', 'en'), 'Walk 40 meters, then turn left');
  assert.equal(Speech.speechText('Wait 5 min', 'en'), 'Wait 5 min');
  assert.equal(Speech.speechText('▶ Start navigation', 'en'), 'Start navigation');
});

test('the notice explains how to add a voice on each kind of device, in the app language', () => {
  const platform = agent => Speech.devicePlatform({userAgent: agent, platform: '', maxTouchPoints: 0});
  assert.equal(platform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'ios');
  assert.equal(platform('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'android');
  assert.equal(platform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(platform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'), 'mac');
  assert.equal(Speech.devicePlatform({userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5}), 'ios', 'iPad');

  for(const lang of ['en', 'ar', 'he', 'ru']){
    for(const device of ['ios', 'android', 'windows', 'mac', 'other']){
      const message = Speech.missingVoiceMessage(lang, device);
      assert.ok(message.title && message.body && message.steps && message.close, `${lang} ${device}`);
    }
  }
  assert.match(Speech.missingVoiceMessage('ar', 'android').steps, /تحويل النص إلى كلام/);
  assert.match(Speech.missingVoiceMessage('he', 'ios').steps, /תוכן מדובר/);
});

test('both pages load the helper and use it before speaking', () => {
  const index = read('index.html');
  const indoor = read('wayframe/navigation-demo.html');
  assert.match(index, /<script src="app\/ui\/speech-voice\.js"><\/script>/);
  assert.match(indoor, /<script src="\.\.\/app\/ui\/speech-voice\.js"><\/script>/);
  assert.match(index, /function speechVoiceMissing\(\)/);
  assert.match(index, /CampusSpeech\.checkVoice\(lang, \{force: announce\}\)/);
  assert.match(
  indoor,
  /CampusSpeech\.checkVoice\(\s*indoorLang\s*,\s*\{\s*force:\s*announce\s*,?\s*\}\s*\)/
);
  assert.match(indoor, /CampusSpeech\.speechText\(text, indoorLang\)/);
});
