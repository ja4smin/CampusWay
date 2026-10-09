// CampusWay admin: shared helpers, sign-in, navigation and the status draft.
//
// Every page edits one shared draft of app/data/campus-status.json. The save
// bar at the bottom shows which parts changed; "Save to live status" sends the
// draft to the local server, which checks it, keeps a backup and writes the file.
(function(){
  'use strict';

  const Schema = window.CampusStatusSchema;
  const Health = window.CampusDataHealth;

  const state = {
    user:null,
    roles:{},
    status:null,       // last saved status file
    version:null,      // hash of the saved file, to detect concurrent edits
    draft:null,        // working copy edited by the pages
    reports:[],
    graphs:{},
    overview:null,
    current:null
  };

  const views = [];
  const PROBLEM_LABELS = {
    'one-out':'One elevator not working',
    'all-out':'All elevators not working',
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
  };
  const KIND_LABELS = {
    elevator:'Elevator',
    'elevator-group':'Elevators',
    restroom:'Restroom',
    'rest-space':'Rest space',
    landmark:'Place',
    other:'Other'
  };
  const STATUS_LABELS = {
    new:'New',
    acknowledged:'Acknowledged',
    'in-progress':'In progress',
    resolved:'Resolved',
    rejected:'Rejected'
  };
  const SECTION_LABELS = {
    elevators:'Elevator outages',
    closures:'Closures',
    noiseAreas:'Noisy areas',
    announcements:'Announcements',
    emergency:'Emergency mode',
    openingHours:'Opening hours',
    names:'Place names',
    reportEmail:'Report e-mail',
    reportEndpoint:'Cloud inbox address'
  };

  // ── DOM helpers ──────────────────────────────────────────────────────
  // h('div', {class:'x', onclick:fn}, 'text', child, [more])
  function h(tag, attributes, ...children){
    const node = document.createElement(tag);
    const attrs = attributes && typeof attributes === 'object' && !(attributes instanceof Node) && !Array.isArray(attributes) ? attributes : null;
    if(!attrs && attributes !== undefined) children.unshift(attributes);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if(value === false || value === null || value === undefined) return;
      if(key === 'class') node.className = value;
      else if(key === 'text') node.textContent = value;
      else if(key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if(key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if(key === 'value') node.value = value;
      else if(key === 'checked' || key === 'selected' || key === 'disabled') node[key] = Boolean(value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    children.flat(Infinity).forEach(child => {
      if(child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  // For Leaflet tooltips and popups: a string there is treated as HTML.
  function textNode(value){
    const span = document.createElement('span');
    span.textContent = String(value ?? '');
    return span;
  }

  function clear(node){
    while(node.firstChild) node.firstChild.remove();
    return node;
  }

  function clone(value){
    return JSON.parse(JSON.stringify(value));
  }

  // ── Dates ────────────────────────────────────────────────────────────
  function today(offsetDays = 0){
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function formatDate(value){
    if(!value) return '';
    const date = typeof value === 'number' ? new Date(value) : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
    if(Number.isNaN(date.getTime())) return String(value);
    const hasTime = typeof value === 'number' || /T\d/.test(String(value));
    return date.toLocaleString('en-GB', hasTime
      ? {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}
      : {day:'numeric', month:'short', year:'numeric'});
  }

  function relative(time){
    const value = typeof time === 'number' ? time : Date.parse(time);
    if(!Number.isFinite(value)) return '';
    const seconds = Math.round((Date.now() - value) / 1000);
    if(seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if(minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if(hours < 48) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if(days < 60) return `${days} days ago`;
    return formatDate(value);
  }

  function duration(ms){
    if(!Number.isFinite(ms)) return '—';
    const minutes = ms / 60000;
    if(minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
    const hours = minutes / 60;
    if(hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
    return `${(hours / 24).toFixed(1)} days`;
  }

  function median(values){
    const list = values.filter(Number.isFinite).sort((a, b) => a - b);
    if(!list.length) return NaN;
    const middle = Math.floor(list.length / 2);
    return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  }

  // ── Server ───────────────────────────────────────────────────────────
  async function api(method, path, body){
    const options = {method, headers:{'X-CampusWay-Admin':'1'}, cache:'no-store', credentials:'same-origin'};
    if(body !== undefined){
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    let response;
    try{
      response = await fetch(path, options);
    }catch(error){
      const failure = new Error('The CampusWay server is not reachable. Is the server window still open?');
      failure.offline = true;
      throw failure;
    }
    let data = {};
    try{ data = await response.json(); }catch(error){ /* empty body */ }
    if(!response.ok){
      // The page is newer than the running server (it was started before an update).
      const outdated = response.status === 404 && data.error === 'Unknown API.';
      const failure = new Error(outdated
        ? 'The CampusWay server is running older code than this page. Restart it: close the server window (or press Ctrl+C in it), then run start-admin.bat or node server/campusway-server.js again.'
        : data.error || `Request failed (${response.status}).`);
      failure.status = response.status;
      failure.data = data;
      if(response.status === 401 && state.user){
        state.user = null;
        showGate('loginScreen');
      }
      throw failure;
    }
    return data;
  }

  // ── Feedback ─────────────────────────────────────────────────────────
  function toast(message, kind = 'info', timeout = 5000){
    const region = document.getElementById('toastRegion');
    const item = h('div', {class:`toast toast--${kind}`, role:kind === 'error' ? 'alert' : 'status'},
      h('div', {class:'toast-text', text:message}),
      h('button', {type:'button', class:'toast-close', 'aria-label':'Dismiss', text:'✕', onclick:() => item.remove()})
    );
    region.append(item);
    while(region.children.length > 3) region.firstElementChild.remove();
    if(timeout) setTimeout(() => item.remove(), timeout);
  }

  // modal({title, body, actions:[{text, kind, onClick(close) → false keeps it open}], wide})
  function modal({title, body, actions = [], wide = false, onClose}){
    const dialog = h('dialog', {class:`admin-modal${wide ? ' admin-modal--wide' : ''}`, 'aria-label':title});
    const close = () => { if(dialog.open) dialog.close(); dialog.remove(); onClose && onClose(); };
    const footer = h('div', {class:'admin-modal-actions'});
    actions.forEach(action => {
      footer.append(h('button', {
        type:'button',
        class:`btn btn-sm ${action.kind === 'primary' ? 'btn-primary' : action.kind === 'danger' ? 'btn-danger' : 'btn-ghost'}`,
        disabled:action.disabled,
        onclick:async event => {
          const button = event.currentTarget;
          button.disabled = true;
          try{
            const result = action.onClick ? await action.onClick(close) : undefined;
            if(result !== false) close();
          }catch(error){
            toast(error.message, 'error');
          }finally{
            if(button.isConnected) button.disabled = false;
          }
        }
      }, action.text));
    });
    dialog.append(
      h('div', {class:'admin-modal-head'},
        h('h2', {text:title}),
        h('button', {type:'button', class:'icon-btn', 'aria-label':'Close', text:'✕', onclick:close})
      ),
      h('div', {class:'admin-modal-body'}, body),
      actions.length ? footer : null
    );
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    document.body.append(dialog);
    dialog.showModal();
    return {close, dialog};
  }

  function confirmBox(message, {title = 'Are you sure?', okText = 'OK', danger = false} = {}){
    return new Promise(resolve => {
      let answered = false;
      modal({
        title,
        body:h('p', {text:message}),
        actions:[
          {text:'Cancel', onClick:() => { answered = true; resolve(false); }},
          {text:okText, kind:danger ? 'danger' : 'primary', onClick:() => { answered = true; resolve(true); }}
        ],
        onClose:() => { if(!answered) resolve(false); }
      });
    });
  }

  // ── Small UI pieces ──────────────────────────────────────────────────
  function badge(textValue, kind = 'neutral'){
    return h('span', {class:`badge badge--${kind}`, text:textValue});
  }

  function timingBadge(entry){
    const timing = Schema.timing(entry);
    return badge({active:'Active', scheduled:'Scheduled', ended:'Ended'}[timing], {active:'success', scheduled:'info', ended:'muted'}[timing]);
  }

  function statusBadge(status){
    return badge(STATUS_LABELS[status] || status, {new:'danger', acknowledged:'info', 'in-progress':'warning', resolved:'success', rejected:'muted'}[status] || 'neutral');
  }

  function field(label, control, hint){
    return h('label', {class:'field'}, h('span', {text:label}), control, hint ? h('small', {class:'field-hint', text:hint}) : null);
  }

  function select(options, value, attributes = {}){
    const node = h('select', attributes);
    options.forEach(option => {
      const item = typeof option === 'object' ? option : {value:option, text:option};
      node.append(h('option', {value:item.value, selected:String(item.value) === String(value), disabled:item.disabled}, item.text));
    });
    return node;
  }

  function pageHeader(title, description, ...actions){
    return h('div', {class:'page-head'},
      h('div', {}, h('h1', {text:title}), description ? h('p', {class:'page-sub', text:description}) : null),
      actions.length ? h('div', {class:'page-actions'}, actions) : null
    );
  }

  function tabs(items, active, onChange){
    const bar = h('div', {class:'tabs', role:'tablist'});
    items.forEach(item => bar.append(h('button', {
      type:'button', role:'tab', class:'tab', 'aria-selected':String(item.id === active),
      onclick:() => onChange(item.id)
    }, item.text, item.count !== undefined ? h('span', {class:'tab-count', text:String(item.count)}) : null)));
    return bar;
  }

  function empty(message, action){
    return h('div', {class:'empty'}, h('p', {text:message}), action || null);
  }

  // Date range inputs with quick presets. entry is changed in place.
  function dateRange(entry, onChange, {allowTime = false} = {}){
    const type = allowTime ? 'datetime-local' : 'date';
    const toInput = value => {
      if(!value) return '';
      if(!allowTime) return String(value).slice(0, 10);
      const date = new Date(value);
      if(Number.isNaN(date.getTime())) return '';
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const fromValue = value => !value ? '' : allowTime ? new Date(value).toISOString() : value;
    const from = h('input', {type, value:toInput(entry.from), oninput:() => { set('from', fromValue(from.value)); }});
    const until = h('input', {type, value:toInput(entry.until), oninput:() => { set('until', fromValue(until.value)); }});
    function set(key, value){
      if(value) entry[key] = value; else delete entry[key];
      onChange && onChange();
    }
    const preset = (text, days) => h('button', {type:'button', class:'chip', onclick:() => {
      if(!allowTime){
        from.value = today(); set('from', today());
        if(days === null){ until.value = ''; set('until', ''); }
        else { until.value = today(days); set('until', today(days)); }
      }else{
        const end = days === null ? '' : new Date(Date.now() + days * 86400000).toISOString();
        until.value = toInput(end); set('until', end);
      }
    }}, text);
    return h('div', {class:'date-range'},
      h('div', {class:'field-row'}, field(allowTime ? 'From (optional)' : 'From', from), field('Until (empty = no end)', until)),
      h('div', {class:'chips'}, allowTime ? null : preset('Today only', 0), preset('1 day', 1), preset('1 week', 7), preset('1 month', 30), preset('No end', null))
    );
  }

  // ── Permissions ──────────────────────────────────────────────────────
  function can(permission){
    return Boolean(state.user && Schema.can(state.user.role, permission));
  }

  function readOnlyNote(permission, what){
    if(can(permission)) return null;
    return h('p', {class:'note note--info', text:`You can view ${what}, but your role (${(state.roles[state.user.role] || {}).label || state.user.role}) cannot change it.`});
  }

  // ── Data ─────────────────────────────────────────────────────────────
  let graphsPromise = null;
  function loadGraphs(){
    if(graphsPromise) return graphsPromise;
    graphsPromise = Promise.all(Schema.BUILDINGS.map(building =>
      fetch(building.graph, {cache:'no-store'})
        .then(response => response.ok ? response.json() : null)
        .catch(() => null)
        .then(graph => { state.graphs[building.key] = graph; })
    )).then(() => state.graphs);
    return graphsPromise;
  }

  function buildingName(key){
    if(key === 'campus') return 'Campus (outdoor)';
    const building = Schema.BUILDINGS.find(item => item.key === key);
    return building ? building.name : key || '—';
  }

  function entrances(key){
    return (typeof BUILDING_ENTRANCES !== 'undefined' && BUILDING_ENTRANCES[key]) || [];
  }

  function nodeById(key, nodeId){
    const graph = state.graphs[key];
    if(!graph) return null;
    for(const [floorId, floor] of Object.entries(graph.floors || {})){
      const node = (floor.nodes || []).find(item => item.id === nodeId);
      if(node) return {...node, floor:node.floor || floorId};
    }
    return null;
  }

  function nodeLabel(key, nodeId){
    const node = nodeById(key, nodeId);
    if(!node) return nodeId;
    const name = node.label && node.label !== node.type ? node.label : node.type;
    return `${name} · ${Health.floorName(node.floor)}`;
  }

  // Graph facts for the shared status checks.
  function knownGraphData(){
    const knownNodes = {}, knownElevators = {};
    Object.entries(state.graphs).forEach(([key, graph]) => {
      if(!graph) return;
      knownNodes[key] = new Set(Health.allNodes(graph).map(node => node.id));
      knownElevators[key] = new Set(Health.elevators(graph).map(item => item.number));
    });
    return {knownNodes, knownElevators};
  }

  async function loadStatus(){
    const data = await api('GET', 'api/admin/status');
    state.status = Schema.validateStatus(data.status).status;
    state.version = data.version;
    state.draft = clone(state.status);
    updateSaveBar();
    return state.status;
  }

  async function loadReports(){
    const data = await api('GET', 'api/admin/reports');
    state.reports = data.reports || [];
    updateNavCounts();
    return state.reports;
  }

  async function loadOverview(){
    state.overview = await api('GET', 'api/admin/overview');
    return state.overview;
  }

  // ── Draft handling ───────────────────────────────────────────────────
  function changedSections(){
    if(!state.status || !state.draft) return [];
    return Schema.changedSections(state.status, state.draft);
  }

  function markDirty(){
    updateSaveBar();
  }

  function updateSaveBar(){
    const bar = document.getElementById('saveBar');
    const sections = changedSections();
    bar.hidden = sections.length === 0;
    document.body.classList.toggle('has-save-bar', sections.length > 0);
    document.getElementById('saveBarSections').textContent = sections.length ? `in ${sections.map(section => SECTION_LABELS[section]).join(', ')}` : '';
  }

  async function saveDraft(){
    const sections = changedSections();
    if(!sections.length) return true;
    await loadGraphs();
    const check = Schema.validateStatus(state.draft, knownGraphData());
    if(check.errors.length){
      showProblems('Fix these problems before saving', check.errors, check.warnings);
      return false;
    }
    const previous = state.status;
    try{
      const result = await api('PUT', 'api/admin/status', {status:state.draft, version:state.version});
      state.status = Schema.validateStatus(result.status).status;
      state.version = result.version;
      state.draft = clone(state.status);
      updateSaveBar();
      linkReportsToStatus(previous, state.status);
      toast(`Saved: ${sections.map(section => SECTION_LABELS[section]).join(', ')}. The app shows it the next time it is opened from this PC.${state.overview && state.overview.publish.git ? ' Commit and push to publish it on GitHub Pages.' : ''}`, 'success', 8000);
      if(result.warnings && result.warnings.length) showProblems('Saved, with warnings', [], result.warnings);
      loadOverview().catch(() => {});
      rerender();
      return true;
    }catch(error){
      if(error.status === 409){
        const reload = await confirmBox(`${error.message}\n\nReloading discards your unsaved changes.`, {title:'Someone else changed the status', okText:'Reload latest'});
        if(reload){ await loadStatus(); rerender(); }
      }else if(error.status === 422){
        showProblems('The server found problems', error.data.errors || [], error.data.warnings || []);
      }else{
        toast(error.message, 'error', 8000);
      }
      return false;
    }
  }

  // Saves one section right away and keeps the other unsaved draft changes.
  async function saveSection(section, value){
    const next = {...clone(state.status), [section]:clone(value)};
    try{
      const result = await api('PUT', 'api/admin/status', {status:next, version:state.version});
      state.status = Schema.validateStatus(result.status).status;
      state.version = result.version;
      state.draft[section] = clone(state.status[section]);
      updateSaveBar();
      loadOverview().catch(() => {});
      rerender();
      return true;
    }catch(error){
      if(error.status === 422) showProblems('The server found problems', error.data.errors || [], error.data.warnings || []);
      else toast(error.message, 'error', 8000);
      return false;
    }
  }

  // Reports turned into an outage/closure move to "In progress".
  function linkReportsToStatus(before, after){
    const ids = status => new Set([...(status.elevators || []), ...(status.closures || [])].flatMap(entry => entry.reportIds || []));
    const old = ids(before);
    const added = [...ids(after)].filter(id => !old.has(id));
    const waiting = added.filter(id => {
      const report = state.reports.find(item => item.id === id);
      return report && ['new', 'acknowledged'].includes(report.status);
    });
    if(!waiting.length || !can('reports')) return;
    api('PATCH', 'api/admin/reports', {ids:waiting, status:'in-progress', comment:'Added to the live campus status.'})
      .then(() => loadReports())
      .catch(error => toast(error.message, 'error'));
  }

  function showProblems(title, errors, warnings){
    modal({
      title,
      body:h('div', {class:'problems'},
        errors.length ? h('div', {}, h('h3', {text:'Errors'}), h('ul', {class:'problem-list problem-list--error'}, errors.map(item => h('li', {text:item})))) : null,
        warnings.length ? h('div', {}, h('h3', {text:'Warnings'}), h('ul', {class:'problem-list problem-list--warning'}, warnings.map(item => h('li', {text:item})))) : null
      ),
      actions:[{text:'OK', kind:'primary'}]
    });
  }

  async function discardDraft(){
    if(!await confirmBox('Throw away all unsaved changes?', {okText:'Discard', danger:true})) return;
    state.draft = clone(state.status);
    updateSaveBar();
    rerender();
  }

  // ── Navigation ───────────────────────────────────────────────────────
  // register('reports', {title, icon, render(main, params), permission})
  function register(id, definition){
    views.push({id, ...definition});
  }

  function renderNav(){
    const nav = clear(document.getElementById('adminNav'));
    const list = h('ul');
    views.forEach(view => {
      if(view.visible && !view.visible()) return;
      list.append(h('li', {}, h('a', {href:`#${view.id}`, 'data-view':view.id},
        h('span', {class:'nav-icon', 'aria-hidden':'true', text:view.icon}),
        h('span', {class:'nav-text', text:view.title}),
        h('span', {class:'nav-count', 'data-count':view.id, hidden:true})
      )));
    });
    nav.append(list);
    nav.append(h('div', {class:'nav-foot'},
      h('p', {}, 'Data is saved on this PC in ', h('code', {text:'server/db/'}), '.'),
      h('p', {}, 'Live status file: ', h('code', {text:'app/data/campus-status.json'}))
    ));
    updateNavCounts();
  }

  function updateNavCounts(){
    const count = document.querySelector('[data-count="reports"]');
    if(!count) return;
    const fresh = state.reports.filter(report => report.status === 'new').length;
    count.hidden = fresh === 0;
    count.textContent = String(fresh);
  }

  function parseHash(){
    const [id, ...rest] = location.hash.replace(/^#/, '').split('/');
    return {id:id || 'overview', params:rest.map(decodeURIComponent)};
  }

  function go(id, ...params){
    const hash = `#${[id, ...params].map(encodeURIComponent).join('/')}`;
    if(location.hash === hash) rerender();
    else location.hash = hash;
  }

  let renderToken = 0;
  async function rerender(){
    if(!state.user) return;
    const {id, params} = parseHash();
    const view = views.find(item => item.id === id && (!item.visible || item.visible())) || views[0];
    state.current = view.id;
    document.querySelectorAll('.admin-nav a').forEach(link => {
      if(link.dataset.view === view.id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.getElementById('adminNav').classList.remove('open');
    document.getElementById('navToggle').setAttribute('aria-expanded', 'false');
    document.title = `${view.title} · CampusWay Admin`;
    const main = clear(document.getElementById('adminMain'));
    const token = ++renderToken;
    main.append(h('div', {class:'loading', text:'Loading…'}));
    try{
      const content = h('div', {class:'page'});
      await view.render(content, params);
      if(token !== renderToken) return;
      clear(main).append(content);
    }catch(error){
      if(token !== renderToken) return;
      console.error(error);
      clear(main).append(h('div', {class:'page'}, empty(`This page could not be loaded: ${error.message}`)));
    }
  }

  // ── Gates (sign-in, setup, no server) ────────────────────────────────
  function showGate(id){
    ['noServer', 'setupScreen', 'loginScreen'].forEach(gate => { document.getElementById(gate).hidden = gate !== id; });
    document.getElementById('adminApp').hidden = id !== null;
    if(id){
      const input = document.querySelector(`#${id} input`);
      if(input) input.focus();
    }
  }

  function formError(form, message){
    const node = form.querySelector('.form-error');
    node.textContent = message || '';
    node.hidden = !message;
  }

  function bindGates(){
    const setup = document.getElementById('setupForm');
    setup.addEventListener('submit', async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(setup));
      if(data.password !== data.password2) return formError(setup, 'The passwords do not match.');
      try{
        const result = await api('POST', 'api/admin/setup', {username:data.username, displayName:data.displayName, password:data.password});
        await enter(result.user);
      }catch(error){ formError(setup, error.message); }
    });

    const login = document.getElementById('loginForm');
    login.addEventListener('submit', async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(login));
      try{
        const result = await api('POST', 'api/admin/login', data);
        login.reset();
        formError(login, '');
        await enter(result.user);
      }catch(error){ formError(login, error.message); }
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      if(changedSections().length && !await confirmBox('You have unsaved changes. Sign out anyway?', {okText:'Sign out', danger:true})) return;
      await api('POST', 'api/admin/logout', {}).catch(() => {});
      state.user = null;
      showGate('loginScreen');
    });
    document.getElementById('saveBtn').addEventListener('click', saveDraft);
    document.getElementById('discardBtn').addEventListener('click', discardDraft);
    document.getElementById('navToggle').addEventListener('click', event => {
      const nav = document.getElementById('adminNav');
      const open = !nav.classList.contains('open');
      nav.classList.toggle('open', open);
      event.currentTarget.setAttribute('aria-expanded', String(open));
    });
    window.addEventListener('hashchange', rerender);
    window.addEventListener('beforeunload', event => {
      if(changedSections().length){ event.preventDefault(); event.returnValue = ''; }
    });
  }

  async function enter(user){
    state.user = user;
    document.getElementById('adminUser').textContent = `${user.displayName} · ${(state.roles[user.role] || {}).label || user.role}`;
    showGate(null);
    renderNav();
    await Promise.all([loadStatus(), loadReports(), loadOverview().catch(() => null)]);
    loadGraphs();
    rerender();
  }

  async function start(){
    bindGates();
    let session;
    try{
      session = await api('GET', 'api/admin/session');
    }catch(error){
      if(error.status === 403){
        showGate('noServer');
        document.querySelector('#noServer p').textContent = error.message;
      }else{
        showGate('noServer');
      }
      return;
    }
    state.roles = session.roles || {};
    if(session.needsSetup) return showGate('setupScreen');
    if(!session.user) return showGate('loginScreen');
    await enter(session.user);
  }

  // Lets a page download data as a file (CSV or JSON).
  function download(filename, content, type = 'text/plain'){
    const url = URL.createObjectURL(new Blob([content], {type}));
    const link = h('a', {href:url, download:filename});
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csv(rows){
    return rows.map(row => row.map(cell => {
      const value = String(cell ?? '');
      return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }).join(',')).join('\n');
  }

  window.Admin = {
    state, Schema, Health,
    PROBLEM_LABELS, KIND_LABELS, STATUS_LABELS, SECTION_LABELS,
    h, clear, textNode, clone, today, formatDate, relative, duration, median,
    api, toast, modal, confirmBox, showProblems,
    badge, timingBadge, statusBadge, field, select, pageHeader, tabs, empty, dateRange,
    can, readOnlyNote,
    loadGraphs, loadStatus, loadReports, loadOverview, buildingName, entrances, nodeById, nodeLabel, knownGraphData,
    markDirty, saveDraft, saveSection, changedSections,
    register, go, rerender, start, download, csv
  };
})();
