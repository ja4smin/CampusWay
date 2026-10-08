// Live campus status for CampusWay: elevator outages, closures ("no-go
// zones"), opening hours and problem reports.
//
// Official status comes from app/data/campus-status.json (edited by the
// campus team). Reports made in the app are kept on this device: CampusWay
// avoids an elevator you reported as out of service for 24 hours. Sharing
// reports between users needs a server, which this static app does not have.
(function(root){
  const STORAGE_REPORTS = 'campuswayReports';
  const STORAGE_CACHE = 'campuswayStatusCache';
  const REPORT_AVOID_HOURS = 24;
  const REPORT_KEEP_DAYS = 14;
  const LANGUAGE_LOCALES = {
    en:'en-GB',
    he:'he-IL',
    ar:'ar',
    ru:'ru-RU'
  };

  function isRtlLanguage(lang){
    return lang === 'he' || lang === 'ar';
  }

  const EMPTY = {elevators:[], closures:[], openingHours:{}, reportEmail:''};
  let official = readJson(STORAGE_CACHE, null) || EMPTY;
  let readyPromise = null;
  const listeners = new Set();

  function readJson(key, fallback){
    try{
      const value = root.localStorage && root.localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    }catch(error){
      return fallback;
    }
  }

  function writeJson(key, value){
    try{
      if(root.localStorage) root.localStorage.setItem(key, JSON.stringify(value));
    }catch(error){
      // Private mode or storage full: the app keeps working without it.
    }
  }

function normalizeStatus(data){
  return {
    elevators: Array.isArray(data && data.elevators) ? data.elevators : [],
    closures: Array.isArray(data && data.closures) ? data.closures : [],
    noiseAreas: Array.isArray(data && data.noiseAreas) ? data.noiseAreas : [],
    openingHours: data && data.openingHours && typeof data.openingHours === 'object' ? data.openingHours : {},
    reportEmail: data && typeof data.reportEmail === 'string' ? data.reportEmail.trim() : '',
    updated: data && data.updated || ''
  };
}

  function load(url){
    readyPromise = fetch(url, {cache:'no-store'})
      .then(response => {
        if(!response.ok) throw new Error(`Status file ${response.status}`);
        return response.json();
      })
      .then(data => {
        official = normalizeStatus(data);
        writeJson(STORAGE_CACHE, official);
        notify();
        return official;
      })
      .catch(() => official);
    return readyPromise;
  }

  function ready(){
    return readyPromise || Promise.resolve(official);
  }

  function onChange(callback){
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function notify(){
    listeners.forEach(callback => {
      try{ callback(); }catch(error){ /* a listener must not break the others */ }
    });
  }

  // ── Dates ──
  function endOfDay(value){
    if(!value) return Infinity;
    const text = String(value);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T23:59:59`) : new Date(text);
    return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
  }

  function startOf(value){
    if(!value) return -Infinity;
    const text = String(value);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
    return Number.isNaN(date.getTime()) ? -Infinity : date.getTime();
  }

  function isActive(entry, now = Date.now()){
    return startOf(entry.from) <= now && now <= endOfDay(entry.until);
  }

  // ── Elevators ──
  // Elevators are matched by building and number, so "1", "01" and
  // "elevator1" are the same elevator.
  function elevatorNumber(value){
    const match = String(value ?? '').match(/\d+/);
    return match ? String(Number(match[0])) : String(value ?? '').trim().toLowerCase();
  }

  function reports(){
    const now = Date.now();
    const list = readJson(STORAGE_REPORTS, []);
    const kept = Array.isArray(list)
      ? list.filter(report => report && now - Number(report.time || 0) < REPORT_KEEP_DAYS * 86400000)
      : [];
    return kept;
  }
function elevatorOutages(building){
  const now = Date.now();
  const result = [];

  for(const entry of official.elevators){
    if(entry.building !== building || !isActive(entry, now)) continue;
    if(String(entry.status || 'out-of-service') !== 'out-of-service'){
      continue;
    }

    result.push({
      number: elevatorNumber(
        entry.elevator ?? entry.connectorId ?? entry.id
      ),
      source: 'official',
      note: entry.note || '',
      until: entry.until || ''
    });
  }

  for(const report of reports()){
    if(report.building !== building) continue;

    const age = now - Number(report.time);
    if(
      !Number.isFinite(age) ||
      age < 0 ||
      age >= REPORT_AVOID_HOURS * 3600000
    ){
      continue;
    }

    let connectorIds = [];

    if(
      report.kind === 'elevator' &&
      report.problem === 'out-of-service'
    ){
      connectorIds = [report.connectorId];
    }else if(
      report.kind === 'elevator-group' &&
      report.problem === 'all-out'
    ){
      connectorIds = Array.isArray(report.connectorIds)
        ? report.connectorIds
        : [];
    }

    for(const connectorId of connectorIds){
      if(!connectorId) continue;

      result.push({
        number: elevatorNumber(connectorId),
        source: 'you',
        note: report.note || '',
        time: report.time
      });
    }
  }

  return result;
}
  function isElevatorOut(building, connectorId){
    const number = elevatorNumber(connectorId);
    return elevatorOutages(building).some(outage => outage.number === number);
  }

  function closedNodes(building){
    const ids = new Set();
    const now = Date.now();
    for(const closure of official.closures){
      if(closure.building !== building || !isActive(closure, now)) continue;
      (closure.nodeIds || []).forEach(id => ids.add(String(id)));
    }
    return ids;
  }

  function closures(building){
    const now = Date.now();
    return official.closures.filter(closure =>
      isActive(closure, now) && (!building || closure.building === building)
    );
  }

  // Outdoor no-go zones: polygons of [lat, lng] the outdoor route avoids.
  function noGoAreas(){
    const now = Date.now();
    return official.closures
      .filter(closure => Array.isArray(closure.area) && closure.area.length > 2 && isActive(closure, now))
      .map(closure => ({area: closure.area, reason: closure.reason || ''}));
  }

  // ── Opening hours ──
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_NAMES = {
    en:['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    he:['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
    ar:['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
    ru:['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  };

  function dayRanges(spec, dayIndex){
    if(!spec) return [];
    if(spec === '24/7') return [[0, 1440]];
    const value = spec[DAYS[dayIndex]];
    if(!value || /closed/i.test(value)) return [];
    return String(value).split(',').map(range => {
      const match = range.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
      if(!match) return null;
      return [Number(match[1]) * 60 + Number(match[2]), Number(match[3]) * 60 + Number(match[4])];
    }).filter(Boolean);
  }

  function clock(minutes){
    const h = Math.floor(minutes / 60) % 24, m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function hours(placeName, now = new Date()){
    const spec = official.openingHours[placeName];
    if(!spec) return null;
    const day = now.getDay();
    const minute = now.getHours() * 60 + now.getMinutes();
    const today = dayRanges(spec, day);
    const current = today.find(([open, close]) => minute >= open && minute < close);
    if(current) return {open:true, closes: clock(current[1])};
    const laterToday = today.find(([open]) => open > minute);
    if(laterToday) return {open:false, opens: clock(laterToday[0]), day: null};
    for(let offset = 1; offset <= 7; offset += 1){
      const next = dayRanges(spec, (day + offset) % 7)[0];
      if(next) return {open:false, opens: clock(next[0]), day: (day + offset) % 7};
    }
    return {open:false, opens:null, day:null};
  }

  function hoursText(placeName, lang = 'en'){
    const state = hours(placeName);
    if(!state) return '';
    const dayName = state.day === null || state.day === undefined ? '' : `${(DAY_NAMES[lang] || DAY_NAMES.en)[state.day]} `;
    const text = {
      en: state.open ? `Open now · until ${state.closes}` : state.opens ? `Closed now · opens ${dayName}${state.opens}` : 'Closed',
      he: state.open ? `פתוח עכשיו · עד ${state.closes}` : state.opens ? `סגור עכשיו · נפתח ${dayName}${state.opens}` : 'סגור',
      ar: state.open ? `مفتوح الآن · حتى ${state.closes}` : state.opens ? `مغلق الآن · يفتح ${dayName}${state.opens}` : 'مغلق',
      ru: state.open ? `Открыто сейчас · до ${state.closes}` : state.opens ? `Закрыто сейчас · откроется ${dayName}${state.opens}` : 'Закрыто'
    };
    return text[lang] || text.en;
  }

  // ── Reports ──
  function addReport(report){
  const entry = {
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    time: Date.now(),
    kind: report.kind || 'other',
    building: report.building || '',
    buildingName: report.buildingName || '',
    connectorId: report.connectorId || '',
    connectorIds: Array.isArray(report.connectorIds)
      ? [...new Set(report.connectorIds.map(String).filter(Boolean))]
      : [],
    nodeId: report.nodeId || '',
    label: report.label || '',
    problem: report.problem || 'other',
    note: String(report.note || '').slice(0, 500)
  };

  const list = reports();
  list.unshift(entry);
  writeJson(STORAGE_REPORTS, list.slice(0, 50));
  notify();
  return entry;
}

  function removeReport(id){
    writeJson(STORAGE_REPORTS, reports().filter(report => report.id !== id));
    notify();
  }

  // ── Report dialog ──
const TEXT = {
  en:{
    title:'Report a problem',
    what:'What is not working?',
    problem:'What is wrong?',
    note:'Details (optional)',
    notePlaceholder:'For example: the door does not open on floor 6',
    save:'Report',
    cancel:'Cancel',
    done:'Done',
    thanks:'Thank you — your report has been recorded.',
    avoid:'CampusWay will route you around this elevator for the next 24 hours.',
    shareHint:'To let the campus team and other students know, send it on:',
    email:'Email the campus team',
    copy:'Copy report',
    copied:'Copied',
    yours:'Your recent reports',
    fixed:'It works again',
    none:'No reports yet.',
    problems:{
      'one-out':'One elevator is not working',
      'all-out':'All elevators are not working',
      quiet:'Quiet right now',
      noisy:'Noisy right now',
      crowded:'Crowded right now',
      'out-of-service':'Out of service',
      doors:'Doors or buttons not working',
      closed:'Closed or locked',
      'accessible-stall':'Accessible stall not usable',
      cleaning:'Needs cleaning or supplies',
      blocked:'Path blocked or construction',
      other:'Something else'
    }
  },
  he:{
    title:'דיווח על תקלה',
    what:'מה לא עובד?',
    problem:'מה הבעיה?',
    note:'פרטים (לא חובה)',
    notePlaceholder:'לדוגמה: הדלת לא נפתחת בקומה 6',
    save:'דיווח',
    cancel:'ביטול',
    done:'סיום',
    thanks:'תודה — הדיווח שלך נרשם.',
    avoid:'ב-24 השעות הקרובות CampusWay ינתב אותך בלי המעלית הזו.',
    shareHint:'כדי שצוות הקמפוס וסטודנטים אחרים יידעו, אפשר לשלוח אותו:',
    email:'שליחה במייל לצוות הקמפוס',
    copy:'העתקת הדיווח',
    copied:'הועתק',
    yours:'הדיווחים האחרונים שלך',
    fixed:'זה עובד שוב',
    none:'אין עדיין דיווחים.',
    problems:{
        'one-out':'מעלית אחת לא פועלת',
  'all-out':'כל המעליות לא פועלות',
      quiet:'שקט כרגע',
      noisy:'רועש כרגע',
      crowded:'צפוף כרגע',
      'out-of-service':'לא פועלת',
      doors:'דלתות או כפתורים לא עובדים',
      closed:'סגור או נעול',
      'accessible-stall':'תא הנגישות לא שמיש',
      cleaning:'צריך ניקיון או ציוד',
      blocked:'דרך חסומה או עבודות',
      other:'משהו אחר'
    }
  },
  ar:{
    title:'الإبلاغ عن مشكلة',
    what:'ما الذي لا يعمل؟',
    problem:'ما المشكلة؟',
    note:'تفاصيل (اختياري)',
    notePlaceholder:'مثلًا: الباب لا يفتح في الطابق 6',
    save:'إبلاغ',
    cancel:'إلغاء',
    done:'تم',
    thanks:'شكرًا — تم تسجيل بلاغك.',
    avoid:'سيتجنب CampusWay هذا المصعد في مساراتك خلال الـ24 ساعة القادمة.',
    shareHint:'ليعرف طاقم الحرم والطلاب الآخرون، يمكنك إرساله:',
    email:'إرسال بريد إلى طاقم الحرم',
    copy:'نسخ البلاغ',
    copied:'تم النسخ',
    yours:'بلاغاتك الأخيرة',
    fixed:'يعمل مجددًا',
    none:'لا توجد بلاغات بعد.',
    problems:{
          'one-out':'مصعد واحد لا يعمل',
'all-out':'جميع المصاعد لا تعمل',
      quiet:'هادئ الآن',
      noisy:'صاخب الآن',
      crowded:'مزدحم الآن',
      'out-of-service':'معطّل',
      doors:'الأبواب أو الأزرار لا تعمل',
      closed:'مغلق أو مقفل',
      'accessible-stall':'حمام ذوي الإعاقة غير صالح',
      cleaning:'يحتاج تنظيفًا أو مستلزمات',
      blocked:'الطريق مسدود أو أعمال بناء',
      other:'شيء آخر'
    }
  },
  ru:{
    title:'Сообщить о проблеме',
    what:'Что не работает?',
    problem:'В чём проблема?',
    note:'Подробности (необязательно)',
    notePlaceholder:'Например: дверь не открывается на 6-м этаже',
    save:'Сообщить',
    cancel:'Отмена',
    done:'Готово',
    thanks:'Спасибо — ваше сообщение зарегистрировано.',
    avoid:'В течение следующих 24 часов CampusWay будет строить маршруты в обход этого лифта.',
    shareHint:'Чтобы сообщить сотрудникам кампуса и другим студентам, отправьте это через:',
    email:'Отправить сотрудникам кампуса по электронной почте',
    copy:'Копировать сообщение',
    copied:'Скопировано',
    yours:'Ваши недавние сообщения',
    fixed:'Снова работает',
    none:'Сообщений пока нет.',
    problems:{
          'one-out':'Один лифт не работает',
'all-out':'Все лифты не работают',
      quiet:'Сейчас тихо',
      noisy:'Сейчас шумно',
      crowded:'Сейчас многолюдно',
      'out-of-service':'Не работает',
      doors:'Двери или кнопки не работают',
      closed:'Закрыто или заперто',
      'accessible-stall':'Доступная кабина не работает',
      cleaning:'Требуется уборка или расходные материалы',
      blocked:'Путь перекрыт или ведутся работы',
      other:'Другая проблема'
    }
  }
};
const PROBLEMS = {
  'elevator-group': ['one-out', 'all-out', 'other'],
  elevator:['out-of-service','other'],
  restroom:['closed', 'accessible-stall', 'cleaning', 'other'],
  'rest-space':['quiet', 'noisy', 'crowded', 'closed', 'other'],
  landmark:['quiet', 'noisy', 'crowded', 'closed', 'other'],
  other:['blocked', 'closed', 'other']
};
  function el(tag, attributes = {}, children = []){
    const node = document.createElement(tag);
    for(const [key, value] of Object.entries(attributes)){
      if(key === 'text') node.textContent = value;
      else if(key === 'class') node.className = value;
      else if(value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
    }
    [].concat(children).filter(Boolean).forEach(child => node.append(child));
    return node;
  }

  function reportText(report, lang){
    const text = TEXT[lang] || TEXT.en;
    const when = new Date(report.time).toLocaleString(LANGUAGE_LOCALES[lang] || LANGUAGE_LOCALES.en);
    return [
      `CampusWay — ${text.title}`,
      `${report.buildingName || report.building}: ${report.label}`,
      `${text.problems[report.problem] || report.problem}`,
      report.note ? `${report.note}` : '',
      when
    ].filter(Boolean).join('\n');
  }

  // items: [{value, label, kind:'elevator'|'restroom'|'other', connectorId, nodeId}]
  function openReportDialog(options = {}){
    const lang = TEXT[options.lang] ? options.lang : 'en';
    const text = TEXT[lang];
    const items = (options.items || []).filter(item => item && item.label);
    if(!items.length) items.push({value:'other', label:text.problems.other, kind:'other'});

    document.getElementById('cwReportDialog')?.remove();
    const dialog = el('dialog', {
      id:'cwReportDialog', class:'cw-dialog', 'aria-labelledby':'cwReportTitle',
      lang, dir:isRtlLanguage(lang) ? 'rtl' : 'ltr'
    });
    const close = () => { dialog.close(); dialog.remove(); };

    const select = el('select', {id:'cwReportItem'});
    items.forEach((item, index) => {
      const option = el('option', {value:String(index), text:item.label});
      if(options.preselect !== undefined && item.value === options.preselect) option.selected = true;
      select.append(option);
    });

    const problemBox = el('div', {class:'cw-choice-list', role:'radiogroup', 'aria-labelledby':'cwReportProblemLabel'});
    const fillProblems = () => {
      const item = items[Number(select.value)] || items[0];
      problemBox.innerHTML = '';
      (PROBLEMS[item.kind] || PROBLEMS.other).forEach((problem, index) => {
        const id = `cwProblem_${problem}`;
        problemBox.append(el('label', {class:'cw-choice', for:id}, [
          el('input', {type:'radio', name:'cwProblem', id, value:problem, checked: index === 0}),
          el('span', {text:text.problems[problem]})
        ]));
      });
    };
    select.addEventListener('change', fillProblems);
    fillProblems();

    const note = el('textarea', {id:'cwReportNote', rows:'2', maxlength:'500', placeholder:text.notePlaceholder});

    const form = el('form', {method:'dialog', class:'cw-dialog-body'}, [
      el('h2', {id:'cwReportTitle', text:text.title}),
      options.buildingName ? el('p', {class:'cw-dialog-sub', text:options.buildingName}) : null,
      el('label', {class:'cw-field-label', for:'cwReportItem', text:text.what}), select,
      el('span', {class:'cw-field-label', id:'cwReportProblemLabel', text:text.problem}), problemBox,
      el('label', {class:'cw-field-label', for:'cwReportNote', text:text.note}), note,
      el('div', {class:'cw-dialog-actions'}, [
        el('button', {type:'button', class:'btn btn-ghost', id:'cwReportCancel', text:text.cancel}),
        el('button', {type:'submit', class:'btn btn-primary', id:'cwReportSave', text:text.save})
      ])
    ]);

    const yours = el('div', {class:'cw-report-history'});
    const fillHistory = () => {
      yours.innerHTML = '';
      const list = reports().filter(report => !options.building || report.building === options.building).slice(0, 5);
      if(!list.length) return;
      yours.append(el('h3', {text:text.yours}));
      const ul = el('ul');
      list.forEach(report => {
        const remove = el('button', {type:'button', class:'btn btn-ghost btn-sm', text:text.fixed});
        remove.addEventListener('click', () => { removeReport(report.id); fillHistory(); options.onChange?.(); });
        ul.append(el('li', {}, [el('span', {text:`${report.label} — ${text.problems[report.problem] || report.problem}`}), remove]));
      });
      yours.append(ul);
    };
    fillHistory();

    form.querySelector('#cwReportCancel').addEventListener('click', close);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const item = items[Number(select.value)] || items[0];
      const problem = form.querySelector('input[name="cwProblem"]:checked')?.value || 'other';
      const report = addReport({
        kind:item.kind,
        building:options.building,
        buildingName:options.buildingName,
        connectorId:item.connectorId,
        connectorIds:item.connectorIds,
        nodeId:item.nodeId,
        label:item.label,
        problem,
        note:note.value
      });
      options.onChange?.();
      showThanks(report);
    });

function showThanks(report){
  dialog.innerHTML = '';

  const body = el('div', {class:'cw-dialog-body'});

  body.append(
    el('div', {
      class:'cw-dialog-icon',
      'aria-hidden':'true',
      text:'✓'
    }),
    el('h2', {
      id:'cwReportTitle',
      text:text.thanks
    })
  );

  const elevatorUnavailable =
    (report.kind === 'elevator' &&
      report.problem === 'out-of-service') ||
    (report.kind === 'elevator-group' &&
      report.problem === 'all-out');

  const spaceUnavailable =
    ['rest-space', 'landmark'].includes(report.kind) &&
    ['noisy', 'crowded', 'closed'].includes(report.problem);

  if(elevatorUnavailable){
    const messages = {
      en:'Your routes will avoid the reported elevators for 24 hours.',
      he:'המסלולים שלך יימנעו מהמעליות שדווחו במשך 24 שעות.',
      ar:'ستتجنب مساراتك المصاعد المُبلّغ عنها لمدة 24 ساعة.',
      ru:'Ваши маршруты будут обходить указанные лифты в течение 24 часов.'
    };

    body.append(el('p', {
      text:messages[lang] || messages.en
    }));
  }

  if(spaceUnavailable){
    const messages = {
      en:'This place will be excluded from your rest-space suggestions for 2 hours.',
      he:'המקום הזה לא יופיע בהצעות למקומות מנוחה במשך שעתיים.',
      ar:'لن يظهر هذا المكان ضمن اقتراحات أماكن الاستراحة لمدة ساعتين.',
      ru:'Это место будет исключено из ваших рекомендаций мест для отдыха на 2 часа.'
    };

    body.append(el('p', {
      text:messages[lang] || messages.en
    }));
  }

  const actions = el('div', {
    class:'cw-dialog-actions cw-dialog-actions--stack'
  });

  const done = el('button', {
    type:'button',
    class:'btn btn-primary',
    text:text.done
  });

  done.addEventListener('click', close);
  actions.append(done);
  body.append(actions);
  dialog.append(body);
  done.focus();
}

  dialog.append(form, yours);
  dialog.addEventListener('cancel', () =>
    setTimeout(() => dialog.remove(), 0)
  );

  document.body.append(dialog);

  if(typeof dialog.showModal === 'function'){
    dialog.showModal();
  }else{
    dialog.setAttribute('open', '');
  }

  select.focus();
  return dialog;
} // End of openReportDialog

  function elevatorName(connectorId, lang = 'en'){
    const word = {en:'Elevator', he:'מעלית', ar:'مصعد', ru:'Лифт'}[lang] || 'Elevator';
    return `${word} ${elevatorNumber(connectorId)}`;
  }

  function restSpaceUnavailable(buildingKey, nodeId){
  const now = Date.now();
  const maxAge = 2 * 60 * 60 * 1000;

  const latest = reports()
    .filter(report =>
      ['rest-space', 'landmark'].includes(report.kind) &&
      report.building === buildingKey &&
      report.nodeId === nodeId &&
      ['quiet', 'noisy', 'crowded', 'closed'].includes(report.problem) &&
      Number(report.time) <= now &&
      now - Number(report.time) < maxAge
    )
    .sort((a, b) => Number(b.time) - Number(a.time))[0];

  return Boolean(
    latest &&
    ['noisy', 'crowded', 'closed'].includes(latest.problem)
  );
}

  root.CampusStatus = {
    load, ready, onChange,
    elevatorOutages, isElevatorOut, elevatorName, elevatorNumber,
    closedNodes, closures, noGoAreas,
    hours, hoursText,
    reports, addReport, removeReport, openReportDialog,
    restSpaceUnavailable,
    get noiseAreas(){ return official.noiseAreas || []; },    get reportEmail(){ return official.reportEmail; }  };
})(typeof self !== 'undefined' ? self : this);