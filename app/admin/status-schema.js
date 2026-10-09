// CampusWay admin: rules for app/data/campus-status.json and admin roles.
//
// Shared by the admin page (browser) and the local admin server (Node), so
// both check a status file the same way before it is saved.
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.CampusStatusSchema = api;
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  const LANGUAGES = ['en', 'he', 'ar', 'ru'];

  const BUILDINGS = [
    {key:'main', name:'Main Building', graph:'buildings/main/main-indoor-graph.json'},
    {key:'rabin', name:'Rabin Building', graph:'buildings/rabin/rabin-indoor-graph.json'},
    {key:'student', name:'Student House', graph:'buildings/student/student-indoor-graph.json'},
    {key:'madriga', name:'Terrace Building', graph:'buildings/madriga/madriga-indoor-graph.json'},
    {key:'education', name:'Education and Science', graph:'buildings/education/education-indoor-graph.json'},
    {key:'multi-purpose', name:'Multi-Purpose Building', graph:'buildings/multi-purpose/multi-purpose-indoor-graph.json'}
  ];
  const BUILDING_KEYS = BUILDINGS.map(building => building.key);
  const OUTDOOR_ELEVATOR_ID = 'main-600-outdoor';

  const SEVERITIES = ['info', 'warning', 'critical'];
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // Which part of the status file each permission covers.
  const SECTIONS = {
    elevators:'status',
    closures:'status',
    noiseAreas:'status',
    announcements:'announce',
    emergency:'emergency',
    openingHours:'content',
    names:'content',
    reportEmail:'settings',
    reportEndpoint:'settings'
  };

  const ROLES = {
    admin:{
      label:'Administrator',
      description:'Everything, including emergency mode, admin accounts, restoring old versions and running the automated tests.',
      can:['reports', 'status', 'announce', 'emergency', 'content', 'settings', 'users', 'restore', 'tests']
    },
    facilities:{
      label:'Facilities',
      description:'Problem reports, elevator outages, closures, announcements and the report e-mail.',
      can:['reports', 'status', 'announce', 'settings']
    },
    accessibility:{
      label:'Accessibility office',
      description:'Problem reports, elevator outages and closures.',
      can:['reports', 'status']
    },
    content:{
      label:'Content editor',
      description:'Place names, opening hours and announcements.',
      can:['content', 'announce']
    }
  };

  const REPORT_STATUSES = ['new', 'acknowledged', 'in-progress', 'resolved', 'rejected'];

  function can(role, permission){
    return Boolean(ROLES[role] && ROLES[role].can.includes(permission));
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function isDateLike(value){
    if(value === undefined || value === null || value === '') return true;
    const text = String(value);
    if(DATE_RE.test(text)) return !Number.isNaN(new Date(`${text}T00:00:00`).getTime());
    return !Number.isNaN(new Date(text).getTime());
  }

  function isObject(value){
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value, max = 300){
    return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
  }

  function hoursRangeOk(value){
    if(value === '24/7') return true;
    const spec = String(value || '').trim();
    if(!spec || /^closed$/i.test(spec)) return true;
    return spec.split(',').every(range =>
      /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.test(range.trim())
    );
  }

  function localizedText(value, max){
    const result = {};
    if(typeof value === 'string'){
      if(value.trim()) result.en = text(value, max);
      return result;
    }
    if(!isObject(value)) return result;
    for(const language of LANGUAGES){
      if(typeof value[language] === 'string' && value[language].trim()){
        result[language] = text(value[language], max);
      }
    }
    return result;
  }

  // Text from the status file is shown in the app and on the map. Some of those
  // places render HTML, so < and > are refused everywhere.
  const MARKUP = /[<>]/;

  // Returns {status, errors, warnings}. `status` is a cleaned copy that keeps
  // only known fields, so a saved file never carries stray data.
  function validateStatus(input, context = {}){
    const errors = [];
    const warnings = [];
    const data = isObject(input) ? input : {};
    const knownNodes = context.knownNodes || null; // {buildingKey: Set(nodeIds)}
    const knownElevators = context.knownElevators || null; // {buildingKey: Set(numbers)}
    const now = context.now || Date.now();

    const noMarkup = (value, where) => {
      if(typeof value === 'string' && MARKUP.test(value)) errors.push(`${where}: the characters < and > are not allowed.`);
    };

    const endOfDay = value => {
      if(!value) return Infinity;
      const raw = String(value);
      const date = DATE_RE.test(raw) ? new Date(`${raw}T23:59:59`) : new Date(raw);
      return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
    };

    const elevatorNumber = value => {
      const match = String(value ?? '').match(/\d+/);
      return match ? String(Number(match[0])) : String(value ?? '').trim().toLowerCase();
    };

    const checkDates = (entry, where) => {
      if(!isDateLike(entry.from)) errors.push(`${where}: "from" is not a date.`);
      if(!isDateLike(entry.until)) errors.push(`${where}: "until" is not a date.`);
      if(entry.from && entry.until && isDateLike(entry.from) && isDateLike(entry.until)){
        if(new Date(String(entry.from).slice(0, 10)) > new Date(String(entry.until).slice(0, 10))){
          errors.push(`${where}: ends before it starts.`);
        }
      }
      if(entry.until && endOfDay(entry.until) < now){
        warnings.push(`${where}: already ended (${entry.until}). It has no effect and can be removed.`);
      }
    };

    // Elevators
    const elevators = [];
    (Array.isArray(data.elevators) ? data.elevators : []).forEach((entry, index) => {
      const where = `Elevator outage ${index + 1}`;
      if(!isObject(entry)){ errors.push(`${where}: not an object.`); return; }
      const building = text(entry.building, 40);
      const elevator = text(entry.elevator ?? entry.connectorId ?? entry.id, 60);
      if(building !== 'campus' && !BUILDING_KEYS.includes(building)){
        errors.push(`${where}: unknown building "${building}".`);
      }
      if(!elevator) errors.push(`${where}: choose an elevator.`);
      if(building === 'campus' && elevator && elevator !== OUTDOOR_ELEVATOR_ID){
        errors.push(`${where}: the only campus elevator is "${OUTDOOR_ELEVATOR_ID}".`);
      }
      if(knownElevators && knownElevators[building] && elevator &&
        !knownElevators[building].has(elevatorNumber(elevator))){
        warnings.push(`${where}: elevator "${elevator}" is not in the ${building} map, so routes are not affected.`);
      }
      checkDates(entry, where);
      const clean = {building, elevator, status:'out-of-service'};
      if(entry.from) clean.from = text(entry.from, 40);
      if(entry.until) clean.until = text(entry.until, 40);
      if(entry.note){ noMarkup(entry.note, `${where} note`); clean.note = text(entry.note, 300); }
      if(entry.reportIds) clean.reportIds = [].concat(entry.reportIds).map(id => text(id, 40)).filter(Boolean).slice(0, 20);
      elevators.push(clean);
    });

    // Closures
    const closures = [];
    (Array.isArray(data.closures) ? data.closures : []).forEach((entry, index) => {
      const where = `Closure ${index + 1}`;
      if(!isObject(entry)){ errors.push(`${where}: not an object.`); return; }
      const clean = {};
      if(Array.isArray(entry.area)){
        const area = entry.area.filter(point =>
          Array.isArray(point) && point.length === 2 &&
          Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
        ).map(point => [Number(Number(point[0]).toFixed(7)), Number(Number(point[1]).toFixed(7))]);
        if(area.length < 3) errors.push(`${where}: an outdoor zone needs at least 3 corners.`);
        if(area.some(([lat, lng]) => lat < 32.7 || lat > 32.8 || lng < 34.95 || lng > 35.1)){
          errors.push(`${where}: a corner is outside the campus area.`);
        }
        clean.area = area;
      }else{
        const building = text(entry.building, 40);
        if(!BUILDING_KEYS.includes(building)) errors.push(`${where}: unknown building "${building}".`);
        const nodeIds = [...new Set((Array.isArray(entry.nodeIds) ? entry.nodeIds : []).map(id => text(id, 60)).filter(Boolean))];
        if(!nodeIds.length) errors.push(`${where}: choose at least one place on the floor plan.`);
        if(knownNodes && knownNodes[building]){
          const unknown = nodeIds.filter(id => !knownNodes[building].has(id));
          if(unknown.length) errors.push(`${where}: unknown node ${unknown.slice(0, 5).join(', ')} in ${building}.`);
        }
        clean.building = building;
        clean.nodeIds = nodeIds;
      }
      if(entry.reason){ noMarkup(entry.reason, `${where} reason`); clean.reason = text(entry.reason, 300); }
      if(entry.from) clean.from = text(entry.from, 40);
      if(entry.until) clean.until = text(entry.until, 40);
      if(entry.reportIds) clean.reportIds = [].concat(entry.reportIds).map(id => text(id, 40)).filter(Boolean).slice(0, 20);
      checkDates(entry, where);
      closures.push(clean);
    });

    // Noise areas (Rest-space profile routing)
    const noiseAreas = [];
    const noiseIds = new Set();
    (Array.isArray(data.noiseAreas) ? data.noiseAreas : []).forEach((entry, index) => {
      const where = `Noisy area ${index + 1}`;
      if(!isObject(entry)){ errors.push(`${where}: not an object.`); return; }
      const id = text(entry.id, 60) || `area-${index + 1}`;
      if(noiseIds.has(id)) errors.push(`${where}: the id "${id}" is used twice.`);
      noiseIds.add(id);
      const outdoorNodeIds = [...new Set((Array.isArray(entry.outdoorNodeIds) ? entry.outdoorNodeIds : []).map(value => text(value, 80)).filter(Boolean))];
      if(!outdoorNodeIds.length) errors.push(`${where}: choose at least one path point on the map.`);
      if(!entry.noisy && !entry.crowded) warnings.push(`${where}: neither noisy nor crowded, so routes ignore it.`);
      if(entry.until && !isDateLike(entry.until)) errors.push(`${where}: "until" is not a date.`);
      if(entry.until && endOfDay(entry.until) < now) warnings.push(`${where}: already ended.`);
      noMarkup(entry.label, `${where} name`);
      const clean = {id, label:text(entry.label, 120), outdoorNodeIds, noisy:entry.noisy === true, crowded:entry.crowded === true};
      if(entry.until) clean.until = text(entry.until, 40);
      noiseAreas.push(clean);
    });

    // Announcements
    const announcements = [];
    const announcementIds = new Set();
    (Array.isArray(data.announcements) ? data.announcements : []).forEach((entry, index) => {
      const where = `Announcement ${index + 1}`;
      if(!isObject(entry)){ errors.push(`${where}: not an object.`); return; }
      const messages = localizedText(entry.text, 280);
      Object.values(messages).forEach(value => noMarkup(value, where));
      if(!messages.en) errors.push(`${where}: the English text is required (other languages fall back to it).`);
      LANGUAGES.filter(language => language !== 'en' && !messages[language]).forEach(language => {
        warnings.push(`${where}: no ${language.toUpperCase()} text; English is shown instead.`);
      });
      const severity = SEVERITIES.includes(entry.severity) ? entry.severity : 'info';
      let id = text(entry.id, 40) || `a${index + 1}`;
      if(announcementIds.has(id)) id = `${id}-${index + 1}`;
      announcementIds.add(id);
      checkDates(entry, where);
      const clean = {id, severity, text:messages};
      if(entry.from) clean.from = text(entry.from, 40);
      if(entry.until) clean.until = text(entry.until, 40);
      announcements.push(clean);
    });

    // Emergency mode
    const emergencyInput = isObject(data.emergency) ? data.emergency : {};
    const emergency = {active:emergencyInput.active === true, message:localizedText(emergencyInput.message, 280)};
    Object.values(emergency.message).forEach(value => noMarkup(value, 'Emergency message'));
    if(emergencyInput.since) emergency.since = text(emergencyInput.since, 40);

    // Opening hours
    const openingHours = {};
    if(data.openingHours !== undefined && !isObject(data.openingHours)){
      errors.push('Opening hours: must be an object keyed by place name.');
    }
    Object.entries(isObject(data.openingHours) ? data.openingHours : {}).forEach(([place, spec]) => {
      const name = text(place, 120);
      if(!name) return;
      if(spec === '24/7'){ openingHours[name] = '24/7'; return; }
      if(!isObject(spec)){ errors.push(`Opening hours for ${name}: not a weekly schedule.`); return; }
      const week = {};
      DAYS.forEach(day => {
        const value = text(spec[day] || 'closed', 80) || 'closed';
        if(!hoursRangeOk(value)) errors.push(`Opening hours for ${name}, ${day}: use 08:00-16:00, several ranges separated by commas, or "closed".`);
        week[day] = value;
      });
      openingHours[name] = week;
    });

    // Name overrides
    const names = {};
    Object.entries(isObject(data.names) ? data.names : {}).forEach(([key, value]) => {
      const name = text(key, 160);
      if(!name || !isObject(value)) return;
      const entry = {};
      ['he', 'ar', 'ru'].forEach(language => {
        if(typeof value[language] === 'string' && value[language].trim()){
          noMarkup(value[language], `Name of ${name} (${language})`);
          entry[language] = text(value[language], 160);
        }
      });
      if(Object.keys(entry).length) names[name] = entry;
    });

    const reportEmail = text(data.reportEmail, 200);
    if(reportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportEmail)){
      errors.push('Report e-mail: not a valid e-mail address.');
    }

    let reportEndpoint = text(data.reportEndpoint, 300);
    if(reportEndpoint){
      let url = null;
      try{ url = new URL(reportEndpoint); }catch(error){ /* reported below */ }
      const local = url && ['localhost', '127.0.0.1'].includes(url.hostname);
      if(!url || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))){
        errors.push('Cloud inbox address: must be an https:// address.');
      }else{
        reportEndpoint = `${url.origin}${url.pathname.replace(/\/+$/, '')}/`;
      }
    }

    return {
      status:{
        updated:text(data.updated, 40),
        elevators, closures, noiseAreas, announcements, emergency,
        openingHours, names, reportEmail, reportEndpoint
      },
      errors,
      warnings
    };
  }

  // Which permissions are needed to go from `before` to `after`.
  function changedSections(before, after){
    const a = validateStatus(before).status;
    const b = validateStatus(after).status;
    return Object.keys(SECTIONS).filter(section =>
      JSON.stringify(a[section] ?? null) !== JSON.stringify(b[section] ?? null)
    );
  }

  function missingPermissions(role, before, after){
    const needed = [...new Set(changedSections(before, after).map(section => SECTIONS[section]))];
    return needed.filter(permission => !can(role, permission));
  }

  function isActive(entry, now = Date.now()){
    const start = entry.from ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(entry.from) ? `${entry.from}T00:00:00` : entry.from).getTime() : -Infinity;
    const raw = entry.until ? String(entry.until) : '';
    const end = raw ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59` : raw).getTime() : Infinity;
    return (Number.isNaN(start) ? -Infinity : start) <= now && now <= (Number.isNaN(end) ? Infinity : end);
  }

  // "active", "scheduled" or "ended"
  function timing(entry, now = Date.now()){
    if(isActive(entry, now)) return 'active';
    const start = entry.from ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(entry.from) ? `${entry.from}T00:00:00` : entry.from).getTime() : -Infinity;
    return start > now ? 'scheduled' : 'ended';
  }

  return {
    LANGUAGES, BUILDINGS, BUILDING_KEYS, OUTDOOR_ELEVATOR_ID, SEVERITIES, DAYS,
    SECTIONS, ROLES, REPORT_STATUSES,
    can, validateStatus, changedSections, missingPermissions, isActive, timing, hoursRangeOk
  };
});
