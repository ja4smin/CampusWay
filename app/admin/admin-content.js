// CampusWay admin: place names in every language and opening hours.
(function(){
  'use strict';
  const {h, clear, state, Schema} = Admin;

  const DAY_NAMES = {sun:'Sunday', mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday'};
  let builtin = null;
  const view = {filter:'all', search:''};

  async function loadBuiltin(){
    if(!builtin) builtin = await Admin.api('GET', 'api/admin/builtin-names').catch(() => ({buildingRu:{}, buildingAr:{}, placeRu:{}, placeHe:{}}));
    return builtin;
  }

  // Buildings, food places and shops: the names the app looks up through
  // localizedBuildingName / localizedPlaceName.
  function catalog(){
    const data = typeof CAMPUS_DATA !== 'undefined' ? CAMPUS_DATA : {buildings:[], points:{}};
    const seen = new Set();
    const rows = [];
    const add = (group, item) => {
      if(!item || seen.has(item.name)) return;
      seen.add(item.name);
      rows.push({group, name:item.name, he:item.name_he || ''});
    };
    data.buildings.forEach(item => add('Building', item));
    (data.points.food || []).forEach(item => add('Food', item));
    (data.points.shops || []).forEach(item => add('Shop', item));
    return rows;
  }

  function builtinName(row, language){
    if(!builtin) return '';
    if(language === 'he') return row.group === 'Building' ? row.he : builtin.placeHe[row.name] || row.he;
    if(language === 'ru') return builtin.buildingRu[row.name] || builtin.placeRu[row.name] || '';
    if(language === 'ar') return builtin.buildingAr[row.name] || '';
    return '';
  }

  function namesTab(page){
    const canEdit = Admin.can('content');
    const rows = catalog();
    const names = state.draft.names;
    const shown = language => row => (names[row.name] && names[row.name][language]) || builtinName(row, language);
    const missing = {
      he:rows.filter(row => !shown('he')(row)).length,
      ar:rows.filter(row => !shown('ar')(row)).length,
      ru:rows.filter(row => !shown('ru')(row)).length
    };

    page.append(h('p', {class:'muted'},
      'Names typed here replace the built-in names in that language. Leave a box empty to keep the built-in name (shown in grey). ',
      `Missing today: Hebrew ${missing.he}, Arabic ${missing.ar}, Russian ${missing.ru}. Without an Arabic name the app shows the Hebrew one.`
    ));

    const search = h('input', {type:'search', placeholder:'Search names…', value:view.search, 'aria-label':'Search names'});
    const filter = Admin.select([
      {value:'all', text:'All places'},
      {value:'missing-ar', text:'Missing Arabic'},
      {value:'missing-ru', text:'Missing Russian'},
      {value:'missing-he', text:'Missing Hebrew'},
      {value:'corrected', text:'With corrections'}
    ], view.filter, {'aria-label':'Filter'});
    const tableHost = h('div');
    search.addEventListener('input', () => { view.search = search.value; draw(); });
    filter.addEventListener('change', () => { view.filter = filter.value; draw(); });
    page.append(h('div', {class:'toolbar'}, search, filter), tableHost);

    function draw(){
      const query = view.search.trim().toLowerCase();
      const visible = rows.filter(row => {
        if(query && ![row.name, row.he, ...['he', 'ar', 'ru'].map(language => shown(language)(row))].join(' ').toLowerCase().includes(query)) return false;
        if(view.filter.startsWith('missing-')) return !shown(view.filter.slice(8))(row);
        if(view.filter === 'corrected') return Boolean(names[row.name]);
        return true;
      });
      const input = (row, language) => {
        const control = h('input', {
          value:(names[row.name] && names[row.name][language]) || '',
          placeholder:builtinName(row, language) || '— missing —',
          dir:language === 'ru' ? 'ltr' : 'rtl', lang:language, maxlength:'160', disabled:!canEdit,
          'aria-label':`${row.name} in ${language}`
        });
        control.addEventListener('input', () => {
          const value = control.value.trim();
          if(value){
            names[row.name] = names[row.name] || {};
            names[row.name][language] = value;
          }else if(names[row.name]){
            delete names[row.name][language];
            if(!Object.keys(names[row.name]).length) delete names[row.name];
          }
          Admin.markDirty();
        });
        return h('td', {}, control);
      };
      clear(tableHost).append(h('div', {class:'table-wrap'}, h('table', {class:'table table--form'},
        h('thead', {}, h('tr', {}, ['Type', 'English (key)', 'Hebrew', 'Arabic', 'Russian'].map(text => h('th', {text})))),
        h('tbody', {}, visible.map(row => h('tr', {},
          h('td', {}, Admin.badge(row.group, 'neutral')),
          h('td', {}, h('strong', {text:row.name})),
          input(row, 'he'), input(row, 'ar'), input(row, 'ru')
        )))
      )));
      if(!visible.length) tableHost.append(Admin.empty('No places match.'));
    }
    draw();
  }

  // ── Opening hours ──
  function hoursEditor(placeName, source){
    const isNew = !placeName;
    const spec = source === '24/7' ? '24/7' : Admin.clone(source || Object.fromEntries(Schema.DAYS.map(day => [day, day === 'sat' ? 'closed' : day === 'fri' ? '08:00-13:00' : '08:00-18:00'])));
    let always = spec === '24/7';
    const week = always ? Object.fromEntries(Schema.DAYS.map(day => [day, 'closed'])) : spec;

    const places = catalog().filter(row => row.group !== 'Building').map(row => row.name);
    places.push('University Clinic');
    const nameInput = h('input', {value:placeName || '', list:'hoursPlaces', placeholder:'English name, or the indoor label (e.g. Library)', disabled:!isNew});
    const datalist = h('datalist', {id:'hoursPlaces'}, [...new Set(places)].map(name => h('option', {value:name})));

    const grid = h('div', {class:'hours-grid'});
    const drawGrid = () => {
      clear(grid);
      Schema.DAYS.forEach(day => {
        const closed = /^closed$/i.test(week[day] || 'closed');
        const range = h('input', {value:closed ? '' : week[day], placeholder:'08:00-16:00', disabled:closed || always, 'aria-label':`${DAY_NAMES[day]} hours`});
        const closedBox = h('input', {type:'checkbox', checked:closed, disabled:always});
        const status = h('span', {class:'hours-check'});
        const check = () => {
          const ok = Schema.hoursRangeOk(range.value || 'closed');
          status.textContent = closedBox.checked ? '' : ok ? '✓' : 'Use 08:00-16:00 or 08:00-12:00,13:00-16:00';
          status.classList.toggle('is-bad', !ok && !closedBox.checked);
        };
        range.addEventListener('input', () => { week[day] = range.value.trim() || 'closed'; check(); });
        closedBox.addEventListener('change', () => {
          week[day] = closedBox.checked ? 'closed' : (range.value.trim() || '08:00-16:00');
          drawGrid();
        });
        check();
        grid.append(h('div', {class:'hours-row'},
          h('span', {class:'hours-day', text:DAY_NAMES[day]}),
          range,
          h('label', {class:'inline-check'}, closedBox, ' Closed'),
          status
        ));
      });
    };
    drawGrid();
    const alwaysBox = h('input', {type:'checkbox', checked:always});
    alwaysBox.addEventListener('change', () => { always = alwaysBox.checked; drawGrid(); });

    Admin.modal({
      title:isNew ? 'Add opening hours' : `Opening hours · ${placeName}`,
      wide:true,
      body:h('div', {class:'editor'},
        Admin.field('Place', nameInput, 'Must match the English name in the app, or the room label for indoor places.'),
        datalist,
        h('div', {class:'chips'},
          h('label', {class:'inline-check'}, alwaysBox, ' Open 24/7'),
          h('button', {type:'button', class:'chip', onclick:() => {
            ['mon', 'tue', 'wed', 'thu'].forEach(day => { week[day] = week.sun; });
            drawGrid();
          }}, 'Copy Sunday to Mon–Thu')
        ),
        grid
      ),
      actions:[
        {text:'Cancel'},
        {text:isNew ? 'Add to draft' : 'Update draft', kind:'primary', onClick:() => {
          const name = nameInput.value.trim();
          if(!name){ Admin.toast('Choose a place.', 'error'); return false; }
          if(isNew && state.draft.openingHours[name]){ Admin.toast('That place already has hours. Edit them instead.', 'error'); return false; }
          const value = always ? '24/7' : week;
          const result = Schema.validateStatus({openingHours:{[name]:value}});
          if(result.errors.length){ Admin.toast(result.errors.join(' '), 'error', 8000); return false; }
          state.draft.openingHours[name] = value;
          Admin.markDirty();
          Admin.go('content', 'hours');
        }}
      ]
    });
  }

  function hoursTab(page){
    const canEdit = Admin.can('content');
    const entries = Object.entries(state.draft.openingHours).sort((a, b) => a[0].localeCompare(b[0]));
    page.append(h('p', {class:'muted', text:'Places with hours show “Open now · until 18:00” or “Closed now” in the app. Places without hours show nothing.'}));
    if(canEdit) page.append(h('button', {type:'button', class:'btn btn-primary btn-sm', onclick:() => hoursEditor('', null)}, '+ Add opening hours'));
    if(!entries.length){ page.append(Admin.empty('No opening hours yet.')); return; }
    page.append(h('div', {class:'table-wrap'}, h('table', {class:'table'},
      h('thead', {}, h('tr', {}, ['Place', ...Schema.DAYS.map(day => DAY_NAMES[day].slice(0, 3)), ''].map(text => h('th', {text})))),
      h('tbody', {}, entries.map(([name, spec]) => h('tr', {},
        h('td', {}, h('strong', {text:name})),
        spec === '24/7' ? h('td', {colspan:'7', text:'Open 24/7'}) : Schema.DAYS.map(day => h('td', {class:/closed/i.test(spec[day]) ? 'muted' : '', text:spec[day] || 'closed'})),
        h('td', {class:'row-actions'}, canEdit ? [
          h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:() => hoursEditor(name, spec)}, 'Edit'),
          h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:() => { delete state.draft.openingHours[name]; Admin.markDirty(); Admin.rerender(); }}, 'Remove')
        ] : null)
      )))
    )));
  }

  async function render(page, params){
    await loadBuiltin();
    const tab = params[0] === 'hours' ? 'hours' : 'names';
    page.append(Admin.pageHeader('Content', 'Place names in Hebrew, Arabic and Russian, and opening hours.'));
    const note = Admin.readOnlyNote('content', 'the content');
    if(note) page.append(note);
    page.append(Admin.tabs([
      {id:'names', text:'Place names', count:Object.keys(state.draft.names).length},
      {id:'hours', text:'Opening hours', count:Object.keys(state.draft.openingHours).length}
    ], tab, id => Admin.go('content', id)));
    if(tab === 'names') namesTab(page);
    else hoursTab(page);
  }

  Admin.register('content', {title:'Content', icon:'✎', render});
})();
