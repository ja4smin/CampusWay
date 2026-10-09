// CampusWay admin: announcements, emergency mode and the report e-mail.
(function(){
  'use strict';
  const {h, clear, state, Schema} = Admin;

  const LANGUAGE_NAMES = {en:'English', he:'Hebrew', ar:'Arabic', ru:'Russian'};
  const RTL = ['he', 'ar'];
  const SEVERITY_TEXT = {
    info:'Information — can be dismissed',
    warning:'Warning — can be dismissed',
    critical:'Critical — stays until it ends'
  };

  function preview(severity, text, {emergency = false} = {}){
    return h('div', {class:'banner-preview'},
      h('div', {class:`cw-banner cw-banner--${emergency ? 'emergency' : severity}`},
        h('span', {class:'cw-banner-icon', text:emergency || severity !== 'info' ? '⚠' : 'ℹ'}),
        h('p', {class:'cw-banner-text'}, emergency ? h('strong', {text:'Emergency: '}) : null, text || '…'),
        emergency ? h('span', {class:'cw-banner-action', text:'Nearest shelter'}) : severity !== 'critical' ? h('span', {class:'cw-banner-close', text:'✕'}) : null
      )
    );
  }

  function languageInputs(values, onInput, {multiline = true, placeholder = ''} = {}){
    return h('div', {class:'lang-grid'}, Schema.LANGUAGES.map(language => {
      const control = h(multiline ? 'textarea' : 'input', {
        rows:multiline ? '2' : undefined, maxlength:'280', dir:RTL.includes(language) ? 'rtl' : 'ltr', lang:language,
        placeholder:language === 'en' ? placeholder : 'Optional — English is shown if empty',
        value:values[language] || ''
      });
      if(multiline) control.value = values[language] || '';
      control.addEventListener('input', () => {
        if(control.value.trim()) values[language] = control.value; else delete values[language];
        onInput && onInput();
      });
      return Admin.field(`${LANGUAGE_NAMES[language]}${language === 'en' ? ' (required)' : ''}`, control);
    }));
  }

  function announcementEditor(source = {}, {index = null} = {}){
    const entry = Admin.clone({severity:'info', text:{}, from:Admin.today(), until:Admin.today(7), ...source});
    if(!entry.id) entry.id = `a${Date.now().toString(36)}`;
    const previewHost = h('div');
    const drawPreview = () => clear(previewHost).append(h('span', {class:'field-hint', text:'Preview (English)'}), preview(entry.severity, entry.text.en));
    const severity = Admin.select(Schema.SEVERITIES.map(value => ({value, text:SEVERITY_TEXT[value]})), entry.severity);
    severity.addEventListener('change', () => { entry.severity = severity.value; drawPreview(); });
    drawPreview();
    Admin.modal({
      title:index === null ? 'New announcement' : 'Edit announcement',
      wide:true,
      body:h('div', {class:'editor'},
        Admin.field('Type', severity),
        languageInputs(entry.text, drawPreview, {placeholder:'e.g. The Main Building library entrance is closed today. Use the floor 600 entrance.'}),
        previewHost,
        Admin.dateRange(entry, () => {})
      ),
      actions:[
        {text:'Cancel'},
        {text:index === null ? 'Add to draft' : 'Update draft', kind:'primary', onClick:() => {
          const errors = Admin.entryErrors('announcements', entry);
          if(errors.length){ Admin.toast(errors.join(' '), 'error', 8000); return false; }
          const list = state.draft.announcements;
          if(Number.isInteger(index)) list[index] = entry; else list.push(entry);
          Admin.markDirty();
          Admin.go('announce');
        }}
      ]
    });
  }

  function emergencyPanel(){
    const emergency = state.draft.emergency;
    const saved = state.status.emergency;
    const canEdit = Admin.can('emergency');
    const message = Admin.clone(emergency.message || {});
    const panel = h('section', {class:`panel emergency-panel${saved.active ? ' is-active' : ''}`},
      h('div', {class:'panel-head'},
        h('h2', {text:'Emergency mode'}),
        Admin.badge(saved.active ? 'ON' : 'Off', saved.active ? 'danger' : 'muted')
      ),
      h('p', {text:'Shows a red banner with a Nearest shelter button at the top of every CampusWay page. Turn it off when the emergency is over.'}),
      saved.active && state.status.emergency.since ? h('p', {class:'muted', text:`On since ${Admin.formatDate(state.status.emergency.since)}.`}) : null
    );
    if(!canEdit){
      panel.append(h('p', {class:'note note--info', text:'Only administrators can turn emergency mode on or off.'}));
      return panel;
    }
    const previewHost = h('div');
    const drawPreview = () => clear(previewHost).append(preview('critical', message.en || 'Emergency on campus. Go to the nearest shelter.', {emergency:true}));
    drawPreview();
    panel.append(
      h('details', {open:emergency.active || undefined},
        h('summary', {text:'Message (optional — a standard message is used if empty)'}),
        languageInputs(message, () => { emergency.message = Admin.clone(message); Admin.markDirty(); drawPreview(); }, {placeholder:'Emergency on campus. Go to the nearest shelter.'})
      ),
      previewHost,
      h('div', {class:'panel-actions'},
        emergency.active
          ? h('button', {type:'button', class:'btn btn-primary', onclick:async () => {
            if(await Admin.saveSection('emergency', {active:false, message})) Admin.toast('Emergency mode is off.', 'success');
          }}, 'Turn emergency mode off now')
          : h('button', {type:'button', class:'btn btn-danger', onclick:async () => {
            const sure = await Admin.confirmBox('Every CampusWay page shows the emergency banner the next time it loads the status. Turn it on now?', {title:'Turn on emergency mode?', okText:'Turn on now', danger:true});
            if(!sure) return;
            if(await Admin.saveSection('emergency', {active:true, message})) Admin.toast('Emergency mode is ON.', 'success');
          }}, 'Turn emergency mode on')
      )
    );
    return panel;
  }

  function contactPanel(){
    const canEdit = Admin.can('settings');
    const input = h('input', {type:'email', value:state.draft.reportEmail || '', placeholder:'facilities@example.ac.il', disabled:!canEdit});
    input.addEventListener('input', () => { state.draft.reportEmail = input.value.trim(); Admin.markDirty(); });
    return h('section', {class:'panel'},
      h('div', {class:'panel-head'}, h('h2', {text:'Report e-mail'})),
      h('p', {class:'muted', text:'The campus office that should receive problem reports by e-mail. Stored in the status file as reportEmail.'}),
      Admin.field('E-mail address', input)
    );
  }

  async function render(page){
    const canEdit = Admin.can('announce');
    page.append(Admin.pageHeader('Announcements', 'Banners on the campus map and indoor pages, in all four languages.',
      canEdit ? h('button', {type:'button', class:'btn btn-primary btn-sm', onclick:() => announcementEditor({})}, '+ New announcement') : null
    ));
    page.append(emergencyPanel());

    const list = h('ul', {class:'entries'});
    const order = {active:0, scheduled:1, ended:2};
    state.draft.announcements.slice().sort((a, b) => order[Schema.timing(a)] - order[Schema.timing(b)]).forEach(entry => {
      const index = state.draft.announcements.indexOf(entry);
      const missing = Schema.LANGUAGES.filter(language => !entry.text[language]);
      list.append(h('li', {class:'entry'},
        h('div', {class:'entry-main'},
          h('div', {class:'entry-title'}, Admin.timingBadge(entry), Admin.badge(entry.severity, entry.severity === 'info' ? 'info' : entry.severity === 'warning' ? 'warning' : 'danger')),
          preview(entry.severity, entry.text.en),
          h('p', {class:'entry-dates', text:`${entry.from ? `From ${Admin.formatDate(entry.from)}` : 'Since saved'} · ${entry.until ? `until ${Admin.formatDate(entry.until)}` : 'no end date'}${missing.length ? ` · missing: ${missing.map(language => LANGUAGE_NAMES[language]).join(', ')}` : ''}`})
        ),
        canEdit ? h('div', {class:'entry-actions'},
          h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:() => announcementEditor(entry, {index})}, 'Edit'),
          h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:() => {
            state.draft.announcements.splice(index, 1);
            Admin.markDirty();
            Admin.rerender();
          }}, 'Remove')
        ) : null
      ));
    });
    page.append(h('h2', {class:'section-title', text:'Announcements'}));
    page.append(list.children.length ? list : Admin.empty('No announcements.'));
    page.append(contactPanel());
  }

  Admin.statusEditors = Object.assign(Admin.statusEditors || {}, {announcement:announcementEditor});
  Admin.register('announce', {title:'Announcements', icon:'📣', render});
})();
