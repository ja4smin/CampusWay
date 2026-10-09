const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const navigation = fs.readFileSync(
  path.join(root, 'wayframe', 'navigation-demo.html'),
  'utf8'
).replace(/\r\n/g, '\n');
const campusMapCss = fs.readFileSync(
  path.join(root, 'app', 'ui', 'campus-map.css'),
  'utf8'
);
const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

function objectLiteralAt(source, start) {
  const open = source.indexOf('{', start);
  assert.ok(open >= 0, 'object literal opening brace is missing');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error('unterminated object literal');
}

function evaluateObject(literal) {
  return vm.runInNewContext(`(${literal})`);
}

function objectAfter(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${marker}`);
  return evaluateObject(objectLiteralAt(source, start + marker.length));
}

function mainTranslations(language) {
  const base = objectAfter(index, 'const T =')[language];
  assert.ok(base, `missing main ${language} translations`);
  const merged = {...base};
  const marker = `Object.assign(T.${language},`;
  let offset = 0;
  while ((offset = index.indexOf(marker, offset)) >= 0) {
    Object.assign(merged, evaluateObject(objectLiteralAt(index, offset + marker.length)));
    offset += marker.length;
  }
  return merged;
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function parseCall(source, start, name) {
  let i = start + name.length + 1;
  let argumentStart = i;
  const argumentsFound = [];
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  let quote = null;
  let escaped = false;
  for (; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') parentheses += 1;
    else if (char === ')') {
      if (parentheses === 0 && brackets === 0 && braces === 0) {
        argumentsFound.push(source.slice(argumentStart, i).trim());
        return argumentsFound;
      }
      parentheses -= 1;
    } else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === ',' && parentheses === 0 && brackets === 0 && braces === 0) {
      argumentsFound.push(source.slice(argumentStart, i).trim());
      argumentStart = i + 1;
    }
  }
  throw new Error(`unterminated ${name} call`);
}

test('main setup and Settings expose complete Russian translations in LTR', () => {
  assert.match(index, /pickLang\('ru','ltr'\)[\s\S]*?>[\s\S]*?Русский/);
  assert.match(index, /changeSettingsLanguage\('ru','ltr'\)/);
  assert.match(index, /LANGUAGE_IDS\s*=\s*new Set\(\['en','he','ar','ru'\]\)/);

  const english = mainTranslations('en');
  const russian = mainTranslations('ru');
  assert.deepEqual(sortedKeys(russian), sortedKeys(english));
  assert.equal(
    JSON.stringify(russian.profiles.map(profile => profile.id)),
    JSON.stringify(english.profiles.map(profile => profile.id))
  );

  const helpers = index.slice(
    index.indexOf("const LANGUAGE_IDS"),
    index.indexOf("const TEXT_SIZE_IDS")
  );
  const context = vm.createContext({lang:'en', Set});
  vm.runInContext(helpers, context);
  assert.equal(vm.runInContext("languageDirection('ru')", context), 'ltr');
  assert.equal(vm.runInContext("languageDirection('he')", context), 'rtl');
  assert.equal(vm.runInContext("routeDirectionArrow('ru')", context), '→');
  assert.equal(vm.runInContext("languageSpeechLocale('ru')", context), 'ru-RU');
});

test('Russian search supports buildings, services, rooms and indoor place types', () => {
  for (const phrase of [
    'главное здание', 'здание рабина', 'библиотека', 'туалет',
    'лифт', 'парковка', 'комната', 'аудитория'
  ]) {
    assert.ok(index.toLowerCase().includes(phrase), `missing Russian search phrase: ${phrase}`);
  }
  assert.match(index, /'room', 'غرفه', 'חדר', 'комната', 'аудитория', 'кабинет'/);
  assert.match(navigation, /room\|غرفة\|חדר\|комната\|аудитория\|кабинет/);
});

test('generic mapped places keep Russian labels while brand names stay unchanged', () => {
  const mainLabelHelpers = index.slice(
    index.indexOf('const RUSSIAN_NODE_TYPE_NAMES'),
    index.indexOf('function indoorSearchName')
  );
  const mainLabels = vm.runInNewContext(`(() => {
    ${mainLabelHelpers}
    return [
      russianSafeNodeLabel({type:'parking', label:'Parking Lot'}),
      russianSafeNodeLabel({type:'museum', label:'Hecht Museum'}),
      russianSafeNodeLabel({type:'entrance', label:'Main entrance 700'}),
      russianSafeNodeLabel({type:'food', label:'Aroma'})
    ];
  })()`);
  assert.deepEqual(Array.from(mainLabels), [
    'Парковка', 'Музей Хехта', 'Главный вход 700', 'Aroma'
  ]);

  const indoorLabelHelpers = navigation.slice(
    navigation.indexOf('const RUSSIAN_INDOOR_LABELS'),
    navigation.indexOf('function localizedNodeLabel')
  );
  const indoorLabels = vm.runInNewContext(`(() => {
    const it = key => ({entrance:'Вход', parking:'Парковка', food:'Еда'})[key] || key;
    ${indoorLabelHelpers}
    return [
      russianIndoorNodeLabel('Emergency Exit', 'entrance'),
      russianIndoorNodeLabel('Entrance to parking', 'entrance'),
      russianIndoorNodeLabel('Cafeteria', 'food'),
      russianIndoorNodeLabel('Aroma', 'food')
    ];
  })()`);
  assert.deepEqual(Array.from(indoorLabels), [
    'Аварийный выход', 'Вход на парковку', 'Столовая', 'Aroma'
  ]);

  for (const name of [
    'Дом студентов',
    'Здание «Терраса» (Мадрига)',
    'Многофункциональное здание',
    'Здание образования и науки'
  ]) {
    assert.ok(index.includes(name), `main page is missing ${name}`);
    assert.ok(navigation.includes(name), `indoor page is missing ${name}`);
  }
});

test('indoor Russian dictionaries match English and every dynamic instruction has Russian', () => {
  for (const marker of [
    'const INDOOR_T =',
    'const INDOOR_T_EXTRA =',
    'const INDOOR_T_MORE='
  ]) {
    const dictionary = objectAfter(navigation, marker);
    assert.deepEqual(sortedKeys(dictionary.ru), sortedKeys(dictionary.en), marker);
  }

  const callName = 'localizedInstruction';
  let offset = 0;
  let count = 0;
  while ((offset = navigation.indexOf(`${callName}(`, offset)) >= 0) {
    const args = parseCall(navigation, offset, callName);
    assert.equal(args.length, 4, `localizedInstruction at offset ${offset}`);
    assert.ok(args[3], `Russian argument is empty at offset ${offset}`);
    count += 1;
    offset += callName.length + 1;
  }
  assert.ok(count > 150, 'expected all indoor dynamic guidance calls to be checked');
  assert.match(navigation, /const rtl=indoorLang==='ar'\|\|indoorLang==='he'/);
  assert.match(navigation, /const arrow=\(indoorLang==='ar'\|\|indoorLang==='he'\) \? '←' : '→'/);
  assert.match(navigation, /indoorLang==='ru'\?'ru-RU'/);
});

test('four language choices fit the UI and the new release refreshes cached files', () => {
  assert.match(campusMapCss, /\.lang-options\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(campusMapCss, /\.settings-language-options\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(serviceWorker, /campusway-v66-live-status/);
});
