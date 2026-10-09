// CampusWay admin: problem reports inbox.
(function(){
  'use strict';
  const {h, clear, state, Schema} = Admin;

  const view = {
    filter:'open',      // open | new | resolved | rejected | all
    building:'',
    kind:'',
    search:'',
    grouped:false,
    selected:new Set()
  };

  const isOpen = report => !['resolved', 'rejected'].includes(report.status);

  function placeText(report){
    const building = report.buildingName || Admin.buildingName(report.building);
    return report.label && report.label !== building ? `${building}: ${report.label}` : building;
  }

  function groupKey(report){
    const target = report.connectorIds && report.connectorIds.length ? report.connectorIds.slice().sort().join('+') : report.connectorId || report.nodeId || report.label;
    return [report.building, report.kind, target, report.problem].join('|');
  }

  function filtered(){
    const query = view.search.trim().toLowerCase();
    return state.reports.filter(report => {
      if(view.filter === 'open' && !isOpen(report)) return false;
      if(['new', 'resolved', 'rejected'].includes(view.filter) && report.status !== view.filter) return false;
      if(view.building && report.building !== view.building) return false;
      if(view.kind && report.kind !== view.kind) return false;
      if(query){
        const haystack = [placeText(report), report.note, report.problem, Admin.PROBLEM_LABELS[report.problem], report.assignee, report.id].join(' ').toLowerCase();
        if(!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function metrics(){
    const recent = state.reports.filter(report => Date.now() - (report.receivedAt || report.time) < 30 * 86400000);
    const response = recent.filter(report => report.firstResponseAt).map(report => report.firstResponseAt - (report.receivedAt || report.time));
    const resolution = recent.filter(report => report.closedAt && report.status === 'resolved').map(report => report.closedAt - (report.receivedAt || report.time));
    return {
      received:recent.length,
      resolved:recent.filter(report => report.status === 'resolved').length,
      response:Admin.median(response),
      resolution:Admin.median(resolution)
    };
  }

  async function updateReports(ids, changes){
    await Admin.api('PATCH', 'api/admin/reports', {ids:[...ids], ...changes});
    await Admin.loadReports();
  }

  // ── Turn a report into an official status entry ──
  function makeOfficial(report){
    const until = Admin.today(7);
    // Report text comes from the public; it is copied without markup.
    const note = [Admin.PROBLEM_LABELS[report.problem] || report.problem, report.note].filter(Boolean).join(' — ').replace(/[<>]/g, '').slice(0, 300);
    const options = [];
    const buildingKnown = Schema.BUILDING_KEYS.includes(report.building);

    if(['elevator', 'elevator-group'].includes(report.kind)){
      const ids = report.kind === 'elevator-group' && report.problem === 'all-out' ? report.connectorIds : [report.connectorId].filter(Boolean);
      options.push({
        title:ids.length > 1 ? `Mark ${ids.length} elevators out of service` : 'Mark the elevator out of service',
        detail:'Routes avoid it until the end date.',
        run:() => {
          if(!ids.length || (report.kind === 'elevator-group' && report.problem === 'one-out')){
            // Which elevator is not known: open the editor to choose it.
            Admin.statusEditors.elevator({building:report.building, elevator:'', from:Admin.today(), until, note, reportIds:[report.id]}, {isNew:true});
            return;
          }
          ids.forEach(id => state.draft.elevators.push({building:report.building, elevator:id, status:'out-of-service', from:Admin.today(), until, note, reportIds:[report.id]}));
          Admin.markDirty();
          Admin.toast(`${ids.length > 1 ? 'Outages' : 'Outage'} added to the draft until ${Admin.formatDate(until)}. Review and press “Save to live status”.`, 'success', 8000);
          Admin.go('status', 'elevators');
        }
      });
    }
    if(buildingKnown && !['elevator', 'elevator-group'].includes(report.kind)){
      options.push({
        title:report.nodeId ? `Close “${Admin.nodeLabel(report.building, report.nodeId)}”` : 'Close part of the building',
        detail:'Indoor routes go around the chosen places.',
        run:() => Admin.statusEditors.closure({building:report.building, nodeIds:report.nodeId ? [report.nodeId] : [], reason:note, from:Admin.today(), until, reportIds:[report.id]}, {isNew:true})
      });
    }
    if(report.problem === 'blocked' || report.building === 'campus'){
      options.push({
        title:'Draw an outdoor no-go zone',
        detail:'Outdoor routes go around the area.',
        run:() => Admin.statusEditors.zone({area:[], reason:note, from:Admin.today(), until, reportIds:[report.id]}, {isNew:true})
      });
    }
    options.forEach(option => { option.permission = 'status'; });
    options.push({
      permission:'announce',
      title:'Post an announcement',
      detail:'A banner on the campus map, for example for a closed restroom without a mapped place.',
      run:() => Admin.statusEditors.announcement({id:'', severity:'warning', text:{en:`${placeText(report)}: ${Admin.PROBLEM_LABELS[report.problem] || report.problem}.`}, from:Admin.today(), until})
    });

    const box = Admin.modal({
      title:'Make it official',
      body:h('div', {class:'choice-grid'},
        h('p', {class:'muted', text:'Add this problem to the live campus status. You can review everything before saving.'}),
        options.filter(option => Admin.can(option.permission)).map(option => h('button', {type:'button', class:'choice', onclick:() => { box.close(); option.run(); }},
          h('strong', {text:option.title}), h('span', {text:option.detail})
        ))
      ),
      actions:[{text:'Cancel'}]
    });
  }

  // ── Detail ──
  function openDetail(report){
    const canEdit = Admin.can('reports');
    const assignee = h('input', {value:report.assignee || '', placeholder:'Who handles it, e.g. Facilities – Dana', maxlength:'80', disabled:!canEdit});
    const internal = h('textarea', {rows:'3', maxlength:'1000', placeholder:'Only admins see this.', disabled:!canEdit}, report.internalNote || '');
    const comment = h('input', {placeholder:'Add a comment to the history (optional)', maxlength:'500', disabled:!canEdit});
    const statusSelect = Admin.select(Schema.REPORT_STATUSES.map(status => ({value:status, text:Admin.STATUS_LABELS[status]})), report.status, {disabled:!canEdit});

    const sameProblem = state.reports.filter(item => item.id !== report.id && groupKey(item) === groupKey(report) && isOpen(item));
    const node = report.nodeId && Schema.BUILDING_KEYS.includes(report.building) ? Admin.nodeById(report.building, report.nodeId) : null;

    const body = h('div', {class:'report-detail'},
      h('div', {class:'report-summary'},
        Admin.statusBadge(report.status),
        h('h3', {text:placeText(report)}),
        h('p', {class:'report-problem', text:Admin.PROBLEM_LABELS[report.problem] || report.problem}),
        report.note ? h('blockquote', {text:report.note}) : h('p', {class:'muted', text:'No details were written.'})
      ),
      h('dl', {class:'facts'},
        h('dt', {text:'Reported'}), h('dd', {text:`${Admin.formatDate(report.time)} (${Admin.relative(report.time)})`}),
        h('dt', {text:'Type'}), h('dd', {text:Admin.KIND_LABELS[report.kind] || report.kind}),
        report.connectorIds && report.connectorIds.length ? [h('dt', {text:'Elevators'}), h('dd', {text:report.connectorIds.join(', ')})] : null,
        report.connectorId ? [h('dt', {text:'Elevator'}), h('dd', {text:report.connectorId})] : null,
        report.nodeId ? [h('dt', {text:'Map node'}), h('dd', {text:node ? `${Admin.nodeLabel(report.building, report.nodeId)} (${report.nodeId})` : report.nodeId})] : null,
        h('dt', {text:'Source'}), h('dd', {text:report.source === 'admin' ? `Entered by an admin${report.channel ? ` (${report.channel})` : ''}${report.reporter ? ` · from ${report.reporter}` : ''}` : `CampusWay app${report.via === 'cloud' ? ', public site via the cloud inbox' : ''}${report.lang ? ` (${report.lang.toUpperCase()})` : ''}`}),
        h('dt', {text:'Report id'}), h('dd', {}, h('code', {text:report.id}))
      ),
      sameProblem.length ? h('p', {class:'note note--info'}, `${sameProblem.length} other open report(s) describe the same problem. `,
        canEdit ? h('button', {type:'button', class:'link-btn', onclick:async () => {
          await updateReports([report.id, ...sameProblem.map(item => item.id)], {status:statusSelect.value, comment:comment.value || 'Updated together with similar reports.'});
          Admin.toast(`${sameProblem.length + 1} reports updated.`, 'success');
          box.close();
          Admin.rerender();
        }}, 'Apply the status to all of them') : null
      ) : null,
      node ? h('details', {class:'plan-details'}, h('summary', {text:'Show on the floor plan'}),
        Admin.floorPlan({building:report.building, highlight:new Set([report.nodeId]), readOnly:true})
      ) : null,
      h('div', {class:'field-row'}, Admin.field('Status', statusSelect), Admin.field('Assigned to', assignee)),
      Admin.field('Internal note', internal),
      Admin.field('Comment', comment),
      h('div', {class:'timeline'},
        h('h3', {text:'History'}),
        h('ol', {},
          h('li', {}, h('time', {text:Admin.formatDate(report.receivedAt || report.time)}), ' Received'),
          (report.history || []).map(entry => h('li', {},
            h('time', {text:Admin.formatDate(entry.at)}),
            ` ${entry.by}: `,
            entry.action === 'status' ? `${Admin.STATUS_LABELS[entry.from] || entry.from} → ${Admin.STATUS_LABELS[entry.to] || entry.to}` : entry.action === 'assign' ? `assigned to ${entry.assignee || 'nobody'}` : entry.action === 'created' ? 'entered the report' : '',
            entry.note ? h('span', {class:'muted', text:` — ${entry.note}`}) : null
          ))
        )
      )
    );

    const actions = [{text:'Close'}];
    if(Admin.can('status') || Admin.can('announce')){
      actions.unshift({text:'Make it official…', onClick:close => { close(); makeOfficial(report); return false; }});
    }
    if(canEdit){
      actions.push({text:'Save', kind:'primary', onClick:async () => {
        await updateReports([report.id], {status:statusSelect.value, assignee:assignee.value, internalNote:internal.value, comment:comment.value});
        Admin.toast('Report updated.', 'success');
        Admin.rerender();
      }});
    }
    const box = Admin.modal({title:'Problem report', body, actions, wide:true, onClose:() => {
      if(location.hash.startsWith('#reports/')) history.replaceState(null, '', '#reports');
    }});
  }

  // ── Manual report ──
  function newReportForm(){
    const data = {building:'main', kind:'other', problem:'other', label:'', note:'', reporter:'', channel:'phone'};
    const building = Admin.select([...Schema.BUILDINGS.map(item => ({value:item.key, text:item.name})), {value:'campus', text:'Campus (outdoor)'}], data.building);
    const kind = Admin.select(Object.entries(Admin.KIND_LABELS).map(([value, text]) => ({value, text})), data.kind);
    const problem = Admin.select(Object.entries(Admin.PROBLEM_LABELS).map(([value, text]) => ({value, text})), data.problem);
    const label = h('input', {placeholder:'e.g. Elevator 2, Restroom near 5014, Path behind the library', maxlength:'200'});
    const note = h('textarea', {rows:'3', maxlength:'500'});
    const reporter = h('input', {placeholder:'Optional: name or e-mail of the person who reported it', maxlength:'160'});
    const channel = Admin.select(['phone', 'e-mail', 'in person', 'other'], 'phone');
    Admin.modal({
      title:'Add a report',
      body:h('div', {},
        h('p', {class:'muted', text:'For problems reported by phone, e-mail or in person.'}),
        h('div', {class:'field-row'}, Admin.field('Building', building), Admin.field('Type', kind)),
        Admin.field('What', label),
        Admin.field('Problem', problem),
        Admin.field('Details', note),
        h('div', {class:'field-row'}, Admin.field('Reported by', reporter), Admin.field('How', channel))
      ),
      actions:[
        {text:'Cancel'},
        {text:'Add report', kind:'primary', onClick:async () => {
          if(!label.value.trim()){ Admin.toast('Write what the report is about.', 'error'); return false; }
          await Admin.api('POST', 'api/admin/reports', {
            building:building.value, buildingName:Admin.buildingName(building.value), kind:kind.value, problem:problem.value,
            label:label.value, note:note.value, reporter:reporter.value, channel:channel.value
          });
          await Admin.loadReports();
          Admin.toast('Report added.', 'success');
          Admin.rerender();
        }}
      ]
    });
  }

  // ── Page ──
  async function render(page, params){
    await Admin.loadReports();
    await Admin.loadGraphs();
    const canEdit = Admin.can('reports');
    const stats = metrics();

    const cloud = state.overview && state.overview.cloud;
    const cloudReady = Boolean(cloud && cloud.url && cloud.hasKey);
    page.append(Admin.pageHeader('Problem reports',
      cloudReady
        ? 'Reports from the public site (through the cloud inbox), from CampusWay opened on this PC or your network, and reports you enter yourself.'
        : 'Reports sent from CampusWay when it is opened from this PC or your network, plus reports you enter yourself. Set up the Cloud inbox to also receive reports from the public site.',
      cloudReady && canEdit ? h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:async event => {
        event.currentTarget.disabled = true;
        try{ await Admin.fetchFromCloud(); }catch(error){ Admin.toast(error.message, 'error', 8000); }
        Admin.loadOverview().catch(() => {}).then(() => Admin.rerender());
      }}, '☁ Fetch from cloud') : null,
      h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:() => exportCsv()}, 'Export CSV'),
      canEdit ? h('button', {type:'button', class:'btn btn-primary btn-sm', onclick:newReportForm}, '+ Add report') : null
    ));

    page.append(h('div', {class:'stat-grid stat-grid--small'},
      h('div', {class:'stat-card'}, h('span', {class:'stat-title', text:'New'}), h('strong', {class:'stat-value', text:String(state.reports.filter(report => report.status === 'new').length)})),
      h('div', {class:'stat-card'}, h('span', {class:'stat-title', text:'Open'}), h('strong', {class:'stat-value', text:String(state.reports.filter(isOpen).length)})),
      h('div', {class:'stat-card'}, h('span', {class:'stat-title', text:'Received (30 days)'}), h('strong', {class:'stat-value', text:String(stats.received)})),
      h('div', {class:'stat-card'}, h('span', {class:'stat-title', text:'Median first response'}), h('strong', {class:'stat-value', text:Admin.duration(stats.response)})),
      h('div', {class:'stat-card'}, h('span', {class:'stat-title', text:'Median time to fix'}), h('strong', {class:'stat-value', text:Admin.duration(stats.resolution)}))
    ));

    const counts = {
      open:state.reports.filter(isOpen).length,
      new:state.reports.filter(report => report.status === 'new').length,
      resolved:state.reports.filter(report => report.status === 'resolved').length,
      rejected:state.reports.filter(report => report.status === 'rejected').length,
      all:state.reports.length
    };
    page.append(Admin.tabs([
      {id:'open', text:'Open', count:counts.open},
      {id:'new', text:'New', count:counts.new},
      {id:'resolved', text:'Resolved', count:counts.resolved},
      {id:'rejected', text:'Rejected', count:counts.rejected},
      {id:'all', text:'All', count:counts.all}
    ], view.filter, id => { view.filter = id; view.selected.clear(); Admin.rerender(); }));

    const search = h('input', {type:'search', placeholder:'Search place, note, assignee…', value:view.search, 'aria-label':'Search reports'});
    const building = Admin.select([{value:'', text:'All buildings'}, ...Schema.BUILDINGS.map(item => ({value:item.key, text:item.name})), {value:'campus', text:'Campus (outdoor)'}], view.building, {'aria-label':'Building'});
    const kind = Admin.select([{value:'', text:'All types'}, ...Object.entries(Admin.KIND_LABELS).map(([value, text]) => ({value, text}))], view.kind, {'aria-label':'Type'});
    const grouped = h('label', {class:'inline-check'}, h('input', {type:'checkbox', checked:view.grouped}), ' Group similar reports');
    const listHost = h('div');
    const refresh = () => { renderList(listHost); };
    search.addEventListener('input', () => { view.search = search.value; refresh(); });
    building.addEventListener('change', () => { view.building = building.value; refresh(); });
    kind.addEventListener('change', () => { view.kind = kind.value; refresh(); });
    grouped.querySelector('input').addEventListener('change', event => { view.grouped = event.target.checked; refresh(); });
    page.append(h('div', {class:'toolbar'}, search, building, kind, grouped));
    page.append(listHost);
    refresh();

    if(params[0]){
      const report = state.reports.find(item => item.id === params[0]);
      if(report) openDetail(report);
    }
  }

  function renderList(host){
    clear(host);
    const list = filtered();
    const canEdit = Admin.can('reports');
    if(!list.length){
      host.append(Admin.empty(state.reports.length ? 'No reports match these filters.' : 'No reports yet. Open CampusWay from this server (http://localhost:8080) and use “Report a problem” on a building, or add one by hand.'));
      return;
    }

    if(view.grouped){
      const groups = new Map();
      list.forEach(report => {
        const key = groupKey(report);
        if(!groups.has(key)) groups.set(key, []);
        groups.get(key).push(report);
      });
      const table = h('table', {class:'table'},
        h('thead', {}, h('tr', {}, ['Reports', 'Place', 'Problem', 'Latest', ''].map(text => h('th', {text})))),
        h('tbody', {}, [...groups.values()].sort((a, b) => b.length - a.length || (b[0].receivedAt || b[0].time) - (a[0].receivedAt || a[0].time)).map(items => h('tr', {},
          h('td', {}, h('strong', {class:'group-count', text:String(items.length)})),
          h('td', {text:placeText(items[0])}),
          h('td', {text:Admin.PROBLEM_LABELS[items[0].problem] || items[0].problem}),
          h('td', {text:Admin.relative(Math.max(...items.map(item => item.receivedAt || item.time)))}),
          h('td', {class:'row-actions'},
            canEdit ? h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:async () => {
              await updateReports(items.map(item => item.id), {status:'acknowledged'});
              Admin.toast(`${items.length} report(s) acknowledged.`, 'success');
              renderList(host);
            }}, 'Acknowledge all') : null,
            h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:() => openDetail(items[0])}, 'Open')
          )
        )))
      );
      host.append(h('div', {class:'table-wrap'}, table));
      return;
    }

    const bulk = h('div', {class:'bulk-bar', hidden:view.selected.size === 0});
    const updateBulk = () => {
      bulk.hidden = view.selected.size === 0;
      clear(bulk).append(
        h('span', {text:`${view.selected.size} selected`}),
        ...['acknowledged', 'in-progress', 'resolved', 'rejected'].map(status => h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:async () => {
          await updateReports(view.selected, {status});
          Admin.toast(`${view.selected.size} report(s) marked ${Admin.STATUS_LABELS[status].toLowerCase()}.`, 'success');
          view.selected.clear();
          renderList(host);
        }}, Admin.STATUS_LABELS[status])),
        h('button', {type:'button', class:'link-btn', onclick:() => { view.selected.clear(); renderList(host); }}, 'Clear')
      );
    };
    const visibleIds = new Set(list.map(report => report.id));
    [...view.selected].forEach(id => { if(!visibleIds.has(id)) view.selected.delete(id); });

    const all = h('input', {type:'checkbox', 'aria-label':'Select all', checked:list.length > 0 && list.every(report => view.selected.has(report.id))});
    all.addEventListener('change', () => {
      list.forEach(report => all.checked ? view.selected.add(report.id) : view.selected.delete(report.id));
      renderList(host);
    });
    const table = h('table', {class:'table table--clickable'},
      h('thead', {}, h('tr', {}, canEdit ? h('th', {class:'check-col'}, all) : null, ['Status', 'Received', 'Place', 'Problem', 'Details', 'Assigned'].map(text => h('th', {text})))),
      h('tbody', {}, list.slice(0, 500).map(report => {
        const box = h('input', {type:'checkbox', 'aria-label':'Select report', checked:view.selected.has(report.id)});
        box.addEventListener('click', event => event.stopPropagation());
        box.addEventListener('change', () => { box.checked ? view.selected.add(report.id) : view.selected.delete(report.id); updateBulk(); });
        return h('tr', {tabindex:'0', onclick:() => openDetail(report), onkeydown:event => { if(event.key === 'Enter') openDetail(report); }},
          canEdit ? h('td', {class:'check-col'}, box) : null,
          h('td', {}, Admin.statusBadge(report.status)),
          h('td', {title:Admin.formatDate(report.time), text:Admin.relative(report.receivedAt || report.time)}),
          h('td', {}, h('strong', {text:placeText(report)}), report.source === 'admin' ? h('span', {class:'muted', text:' · entered'}) : null),
          h('td', {text:Admin.PROBLEM_LABELS[report.problem] || report.problem}),
          h('td', {class:'cell-note', text:report.note || '—'}),
          h('td', {text:report.assignee || '—'})
        );
      }))
    );
    if(canEdit) host.append(bulk);
    host.append(h('div', {class:'table-wrap'}, table));
    if(list.length > 500) host.append(h('p', {class:'muted', text:`Showing the newest 500 of ${list.length}. Use the filters to narrow down.`}));
    updateBulk();
  }

  function exportCsv(){
    const rows = [['id', 'received', 'reported', 'status', 'building', 'place', 'type', 'problem', 'note', 'assignee', 'source', 'language']];
    state.reports.forEach(report => rows.push([
      report.id, new Date(report.receivedAt || report.time).toISOString(), new Date(report.time).toISOString(), report.status,
      report.building, placeText(report), report.kind, report.problem, report.note, report.assignee, report.source, report.lang
    ]));
    Admin.download(`campusway-reports-${Admin.today()}.csv`, Admin.csv(rows), 'text/csv');
  }

  Admin.register('reports', {title:'Reports', icon:'⚑', render});
})();
