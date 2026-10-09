// CampusWay admin: live status — elevator outages, indoor closures, outdoor
// no-go zones and noisy areas. Each editor previews what the change does to
// routing before it goes into the draft.
(function(){
  'use strict';
  const {h, clear, state, Schema, Health} = Admin;

  const BUILDING_KEYS_BY_NAME = {
    'Main Building':'main', 'Rabin Building':'rabin', 'Student House':'student', 'Terrace Building':'madriga',
    'Multi-Purpose Building':'multi-purpose', 'Education and Science':'education', 'Welfare and Health Building':'health',
    'Eshkol Tower':'eshkol', 'Arts Building':'art', 'Bloom Building':'bloom'
  };

  const TABS = [
    {id:'elevators', text:'Elevator outages'},
    {id:'closures', text:'Indoor closures'},
    {id:'zones', text:'Outdoor no-go zones'},
    {id:'noise', text:'Noisy areas'}
  ];

  // ── Routing effect of outages and closures ──
  function activeOutageNumbers(building, exceptIndex){
    return new Set(state.draft.elevators
      .filter((entry, index) => index !== exceptIndex && entry.building === building && Schema.isActive(entry))
      .map(entry => Health.elevatorNumber(entry.elevator)));
  }

  function activeClosedNodes(building, exceptIndex){
    const set = new Set();
    state.draft.closures.forEach((entry, index) => {
      if(index === exceptIndex || entry.area || entry.building !== building || !Schema.isActive(entry)) return;
      (entry.nodeIds || []).forEach(id => set.add(id));
    });
    return set;
  }

  function impactSummary(lost, what){
    const byFloor = {};
    lost.forEach(node => { byFloor[node.floor] = (byFloor[node.floor] || 0) + 1; });
    const floors = Object.entries(byFloor).sort((a, b) => Health.floorNumber(a[0]) - Health.floorNumber(b[0]))
      .map(([floor, count]) => `${Health.floorName(floor)} (${count})`).join(', ');
    return `${lost.length} ${lost.length === 1 ? 'place' : 'places'} ${what}: ${floors}.`;
  }

  function impactBox(result){
    if(!result) return h('div', {class:'impact muted', text:'Choose what to change to see the effect on routes.'});
    const {general, stepFree} = result;
    const stepFreeOnly = stepFree.filter(node => !general.some(other => other.id === node.id));
    if(!general.length && !stepFreeOnly.length){
      return h('div', {class:'impact impact--ok'}, h('strong', {text:'No place becomes unreachable. '}), 'Routes use other paths, stairs or elevators.');
    }
    return h('div', {class:'impact impact--warning'},
      h('strong', {text:'Effect on routes'}),
      general.length ? h('p', {text:impactSummary(general, 'can no longer be reached at all')}) : null,
      stepFreeOnly.length ? h('p', {text:impactSummary(stepFreeOnly, 'lose their step-free route (Mobility profile)')}) : null,
      h('details', {}, h('summary', {text:'Show the places'}),
        h('ul', {class:'impact-list'}, [...general, ...stepFreeOnly].slice(0, 200).map(node => h('li', {text:`${node.label || node.type} · ${Health.floorName(node.floor)}`})))
      )
    );
  }

  function putEntry(listName, entry, index){
    const list = state.draft[listName];
    if(Number.isInteger(index) && index >= 0 && index < list.length) list[index] = entry;
    else list.push(entry);
    Admin.markDirty();
  }

  // Validates one entry on its own.
  function errorsOf(key, entry){
    const result = Schema.validateStatus({[key]:[entry]}, Admin.knownGraphData());
    return result.errors.map(message => message.replace(/^(Elevator outage|Closure|Noisy area|Announcement) 1: /, ''));
  }

  // ── Elevator outage editor ──
  async function elevatorEditor(source = {}, {index = null} = {}){
    await Admin.loadGraphs();
    const entry = Admin.clone({status:'out-of-service', from:Admin.today(), until:Admin.today(7), ...source});
    if(!entry.building) entry.building = 'main';
    const building = Admin.select([...Schema.BUILDINGS.map(item => ({value:item.key, text:item.name})), {value:'campus', text:'Campus — outdoor elevator by Main Building floor 600'}], entry.building);
    const elevatorHost = h('div');
    const impactHost = h('div');
    const note = h('input', {value:entry.note || '', placeholder:'e.g. Maintenance, Doors broken', maxlength:'300', oninput:() => { entry.note = note.value; }});

    function elevatorChoices(){
      if(entry.building === 'campus') return [{value:Schema.OUTDOOR_ELEVATOR_ID, text:'Outdoor elevator (main-600-outdoor)'}];
      const graph = state.graphs[entry.building];
      const list = graph ? Health.elevators(graph) : [];
      return list.map(item => ({value:item.connectorId, text:`Elevator ${item.number} (${item.connectorId}) — floors ${item.floors.map(floor => Health.floorNumber(floor)).join(', ')}`}));
    }

    function drawElevators(){
      const choices = elevatorChoices();
      if(!choices.some(choice => Health.elevatorNumber(choice.value) === Health.elevatorNumber(entry.elevator))){
        entry.elevator = choices.length === 1 ? choices[0].value : '';
      }else{
        entry.elevator = choices.find(choice => Health.elevatorNumber(choice.value) === Health.elevatorNumber(entry.elevator)).value;
      }
      const control = choices.length
        ? Admin.select([{value:'', text:'Choose an elevator…'}, ...choices], entry.elevator)
        : h('p', {class:'note note--warning', text:'This building has no mapped elevator with a connector id.'});
      if(control.tagName === 'SELECT') control.addEventListener('change', () => { entry.elevator = control.value; drawImpact(); });
      clear(elevatorHost).append(Admin.field('Elevator', control));
      drawImpact();
    }

    function drawImpact(){
      clear(impactHost);
      if(entry.building === 'campus' || !entry.elevator){
        impactHost.append(entry.building === 'campus'
          ? h('div', {class:'impact muted', text:'Outdoor routes will use the path around the elevator; the Mobility profile may find no step-free route.'})
          : impactBox(null));
        return;
      }
      const graph = state.graphs[entry.building];
      const before = activeOutageNumbers(entry.building, index);
      const after = new Set([...before, Health.elevatorNumber(entry.elevator)]);
      const closed = activeClosedNodes(entry.building);
      impactHost.append(impactBox(Health.impact(graph, Admin.entrances(entry.building),
        {closed, elevatorOut:id => before.has(Health.elevatorNumber(id))},
        {closed, elevatorOut:id => after.has(Health.elevatorNumber(id))}
      )));
      if(!Schema.isActive(entry)) impactHost.append(h('p', {class:'muted', text:'Not active today: the effect starts on the "From" date.'}));
    }

    building.addEventListener('change', () => { entry.building = building.value; drawElevators(); });
    drawElevators();

    Admin.modal({
      title:index === null ? 'Elevator out of service' : 'Edit elevator outage',
      wide:true,
      body:h('div', {class:'editor'},
        Admin.field('Building', building),
        elevatorHost,
        Admin.dateRange(entry, drawImpact),
        Admin.field('Note shown on the route card', note),
        impactHost
      ),
      actions:[
        {text:'Cancel'},
        {text:index === null ? 'Add to draft' : 'Update draft', kind:'primary', onClick:() => {
          const errors = errorsOf('elevators', entry);
          if(errors.length){ Admin.toast(errors.join(' '), 'error', 8000); return false; }
          putEntry('elevators', entry, index);
          Admin.go('status', 'elevators');
        }}
      ]
    });
  }

  // ── Indoor closure editor ──
  async function closureEditor(source = {}, {index = null} = {}){
    await Admin.loadGraphs();
    const entry = Admin.clone({from:Admin.today(), until:Admin.today(7), nodeIds:[], ...source});
    if(!entry.building) entry.building = 'main';
    const selected = new Set(entry.nodeIds);
    const building = Admin.select(Schema.BUILDINGS.map(item => ({value:item.key, text:item.name})), entry.building);
    const planHost = h('div');
    const chosenHost = h('div', {class:'chips'});
    const impactHost = h('div');
    const reason = h('input', {value:entry.reason || '', placeholder:'e.g. Construction, Floor cleaning', maxlength:'300', oninput:() => { entry.reason = reason.value; }});

    function drawChosen(){
      clear(chosenHost);
      if(!selected.size){ chosenHost.append(h('span', {class:'muted', text:'Click places on the floor plan to close them.'})); return; }
      [...selected].forEach(id => chosenHost.append(h('span', {class:'chip chip--selected'},
        Admin.nodeLabel(entry.building, id),
        h('button', {type:'button', 'aria-label':'Remove', text:'✕', onclick:() => { selected.delete(id); planHost.firstChild && planHost.firstChild.redraw(); update(); }})
      )));
    }

    function drawImpact(){
      clear(impactHost);
      if(!selected.size){ impactHost.append(impactBox(null)); return; }
      const graph = state.graphs[entry.building];
      const before = activeClosedNodes(entry.building, index);
      const after = new Set([...before, ...selected]);
      const out = activeOutageNumbers(entry.building);
      const elevatorOut = id => out.has(Health.elevatorNumber(id));
      impactHost.append(impactBox(Health.impact(graph, Admin.entrances(entry.building), {closed:before, elevatorOut}, {closed:after, elevatorOut})));
    }

    function update(){
      entry.nodeIds = [...selected];
      drawChosen();
      drawImpact();
    }

    function drawPlan(){
      clear(planHost).append(Admin.floorPlan({
        building:entry.building,
        selected,
        onToggle:node => { selected.has(node.id) ? selected.delete(node.id) : selected.add(node.id); update(); }
      }));
    }

    building.addEventListener('change', () => {
      entry.building = building.value;
      selected.clear();
      drawPlan();
      update();
    });
    drawPlan();
    update();

    Admin.modal({
      title:index === null ? 'Close part of a building' : 'Edit indoor closure',
      wide:true,
      body:h('div', {class:'editor'},
        Admin.field('Building', building),
        planHost,
        h('div', {class:'field'}, h('span', {text:'Closed places'}), chosenHost),
        Admin.field('Reason shown on the route card', reason),
        Admin.dateRange(entry, drawImpact),
        impactHost
      ),
      actions:[
        {text:'Cancel'},
        {text:index === null ? 'Add to draft' : 'Update draft', kind:'primary', onClick:() => {
          entry.nodeIds = [...selected];
          const errors = errorsOf('closures', entry);
          if(errors.length){ Admin.toast(errors.join(' '), 'error', 8000); return false; }
          putEntry('closures', entry, index);
          Admin.go('status', 'closures');
        }}
      ]
    });
  }

  // ── Outdoor zone editor ──
  function zoneEditor(source = {}, {index = null} = {}){
    const entry = Admin.clone({from:Admin.today(), until:Admin.today(7), area:[], ...source});
    const mapNode = h('div', {class:'map-box'});
    const reason = h('input', {value:entry.reason || '', placeholder:'e.g. Construction near the library', maxlength:'300', oninput:() => { entry.reason = reason.value; }});
    const info = h('p', {class:'muted'});
    const checkHost = h('div');
    let map, polygon, markers = [];

    function drawZone(){
      if(!map) return;
      if(polygon) map.removeLayer(polygon);
      markers.forEach(marker => map.removeLayer(marker));
      markers = entry.area.map(point => L.circleMarker(point, {radius:5, color:'#B91C1C', weight:2, fillColor:'#fff', fillOpacity:1}).addTo(map));
      polygon = entry.area.length > 1 ? L.polygon(entry.area, {color:'#DC2626', weight:2, dashArray:'6,6', fillOpacity:.2}).addTo(map) : null;
      info.textContent = entry.area.length < 3
        ? `Click the map to add corners (${entry.area.length} of at least 3).`
        : `${entry.area.length} corners. Click to add more, or check the routes below.`;
      clear(checkHost);
    }

    async function checkRoutes(){
      if(entry.area.length < 3) return Admin.toast('Add at least 3 corners first.', 'error');
      clear(checkHost).append(h('p', {class:'muted', text:'Checking routes from both gates to every building…'}));
      await CampusOutdoorRouting.load();
      const others = state.draft.closures.filter((item, i) => i !== index && item.area && Schema.isActive(item)).map(item => item.area);
      const gates = (CAMPUS_DATA.points.gates || []);
      // Routes end at the building's main entrance, as in the app.
      const targets = CAMPUS_DATA.buildings.map(building => {
        const key = BUILDING_KEYS_BY_NAME[building.name];
        const list = (key && Admin.entrances(key) || []).filter(entrance => !entrance.onlyForService);
        const entrance = list.find(item => item.primary) || list[0];
        return {name:building.name, lat:entrance ? entrance.lat : building.lat, lng:entrance ? entrance.lng : building.lng};
      });
      const run = async areas => {
        CampusOutdoorRouting.setRestrictions({blockedAreas:areas});
        const results = [];
        for(const gate of gates){
          for(const building of targets){
            let result = null;
            try{ result = await CampusOutdoorRouting.route(gate.lat, gate.lng, building.lat, building.lng, {}); }catch(error){ result = null; }
            results.push({gate:gate.name, building:building.name, distance:result && Number.isFinite(result.distance) ? result.distance : null});
          }
        }
        return results;
      };
      const before = await run(others);
      const after = await run([...others, entry.area]);
      CampusOutdoorRouting.setRestrictions({});
      const changes = after.map((item, i) => ({...item, before:before[i].distance}))
        .filter(item => item.before !== item.distance && !(item.before && item.distance && Math.abs(item.distance - item.before) < 5));
      clear(checkHost);
      if(!changes.length){
        checkHost.append(h('div', {class:'impact impact--ok'}, h('strong', {text:'No gate-to-building route changes. '}), 'The zone does not sit on a main path, or there is an equally short way around.'));
        return;
      }
      checkHost.append(h('div', {class:'impact impact--warning'},
        h('strong', {text:`${changes.length} gate-to-building route(s) change`}),
        h('ul', {class:'impact-list'}, changes.map(item => h('li', {text:item.distance === null
          ? `${item.gate} → ${item.building}: no route any more`
          : `${item.gate} → ${item.building}: ${Math.round(item.before)} m → ${Math.round(item.distance)} m (+${Math.round(item.distance - item.before)} m)`})))
      ));
    }

    const box = Admin.modal({
      title:index === null ? 'Outdoor no-go zone' : 'Edit outdoor no-go zone',
      wide:true,
      body:h('div', {class:'editor'},
        info,
        mapNode,
        h('div', {class:'chips'},
          h('button', {type:'button', class:'chip', onclick:() => { entry.area.pop(); drawZone(); }}, 'Undo last corner'),
          h('button', {type:'button', class:'chip', onclick:() => { entry.area = []; drawZone(); }}, 'Clear'),
          h('button', {type:'button', class:'chip', onclick:checkRoutes}, 'Check routes')
        ),
        checkHost,
        Admin.field('Reason shown on the map', reason),
        Admin.dateRange(entry, () => {})
      ),
      actions:[
        {text:'Cancel'},
        {text:index === null ? 'Add to draft' : 'Update draft', kind:'primary', onClick:() => {
          const errors = errorsOf('closures', entry);
          if(errors.length){ Admin.toast(errors.join(' '), 'error', 8000); return false; }
          putEntry('closures', entry, index);
          Admin.go('status', 'zones');
        }}
      ]
    });
    map = Admin.campusMap(mapNode);
    state.draft.closures.forEach((item, i) => {
      if(item.area && i !== index) L.polygon(item.area, {color:'#64748B', weight:1, dashArray:'4,4', fillOpacity:.1, interactive:false}).addTo(map);
    });
    map.on('click', event => {
      entry.area.push([Number(event.latlng.lat.toFixed(7)), Number(event.latlng.lng.toFixed(7))]);
      drawZone();
    });
    if(entry.area.length) map.fitBounds(entry.area, {padding:[40, 40], maxZoom:18});
    drawZone();
    return box;
  }

  // ── Noisy area editor ──
  function noiseEditor(source = {}, {index = null} = {}){
    const entry = Admin.clone({id:'', label:'', outdoorNodeIds:[], noisy:true, crowded:false, ...source});
    const selected = new Set(entry.outdoorNodeIds);
    const mapNode = h('div', {class:'map-box'});
    const label = h('input', {value:entry.label, placeholder:'e.g. Garden Café terrace', maxlength:'120'});
    const noisy = h('input', {type:'checkbox', checked:entry.noisy});
    const crowded = h('input', {type:'checkbox', checked:entry.crowded});
    const count = h('p', {class:'muted'});
    let map, layers = new Map();

    const updateCount = () => { count.textContent = `${selected.size} path point(s) chosen. The Rest-space profile avoids them while the area is noisy or crowded.`; };

    const box = Admin.modal({
      title:index === null ? 'Noisy or crowded area' : 'Edit noisy area',
      wide:true,
      body:h('div', {class:'editor'},
        Admin.field('Name', label),
        h('div', {class:'chips'}, h('label', {class:'inline-check'}, noisy, ' Noisy'), h('label', {class:'inline-check'}, crowded, ' Crowded')),
        h('p', {class:'muted', text:'Click the path points (dots) that run through the area.'}),
        mapNode,
        count,
        Admin.dateRange(entry, () => {}, {allowTime:true})
      ),
      actions:[
        {text:'Cancel'},
        {text:index === null ? 'Add to draft' : 'Update draft', kind:'primary', onClick:() => {
          entry.label = label.value.trim();
          entry.noisy = noisy.checked;
          entry.crowded = crowded.checked;
          entry.outdoorNodeIds = [...selected];
          if(!entry.id){
            const base = entry.label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'area';
            let id = base, n = 2;
            while(state.draft.noiseAreas.some((item, i) => item.id === id && i !== index)) id = `${base}-${n++}`;
            entry.id = id;
          }
          const errors = errorsOf('noiseAreas', entry);
          if(errors.length){ Admin.toast(errors.join(' '), 'error', 8000); return false; }
          putEntry('noiseAreas', entry, index);
          Admin.go('status', 'noise');
        }}
      ]
    });
    map = Admin.campusMap(mapNode, {zoom:17});
    updateCount();
    Admin.outdoorGraph().then(nodes => {
      const bounds = map.getBounds().pad(0.6);
      nodes.forEach(node => {
        if(!node.coordinate) return;
        const [lat, lng] = node.coordinate;
        if(!bounds.contains([lat, lng]) && !selected.has(node.id)) return;
        const style = () => selected.has(node.id)
          ? {radius:7, color:'#B91C1C', weight:2, fillColor:'#DC2626', fillOpacity:.9}
          : {radius:3.5, color:'#0E7490', weight:1, fillColor:'#fff', fillOpacity:.9};
        const marker = L.circleMarker([lat, lng], style()).addTo(map);
        marker.bindTooltip(Admin.textNode(node.id), {direction:'top'});
        marker.on('click', () => {
          selected.has(node.id) ? selected.delete(node.id) : selected.add(node.id);
          marker.setStyle(style());
          updateCount();
        });
        layers.set(node.id, marker);
      });
      const chosen = [...selected].map(id => layers.get(id)).filter(Boolean).map(marker => marker.getLatLng());
      if(chosen.length) map.fitBounds(L.latLngBounds(chosen), {padding:[60, 60], maxZoom:19});
    }).catch(() => Admin.toast('The outdoor path network could not be loaded.', 'error'));
    return box;
  }

  // ── Page ──
  function entryRow({title, detail, entry, onEdit, onRemove, extra}){
    const canEdit = Admin.can('status');
    return h('li', {class:'entry'},
      h('div', {class:'entry-main'},
        h('div', {class:'entry-title'}, Admin.timingBadge(entry), h('strong', {text:title})),
        detail ? h('p', {class:'entry-detail', text:detail}) : null,
        h('p', {class:'entry-dates', text:`${entry.from ? `From ${Admin.formatDate(entry.from)}` : 'Since saved'} · ${entry.until ? `until ${Admin.formatDate(entry.until)}` : 'no end date'}`}),
        extra || null
      ),
      canEdit ? h('div', {class:'entry-actions'},
        h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:onEdit}, 'Edit'),
        h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:onRemove}, 'Remove')
      ) : null
    );
  }

  function removeEntry(listName, entry){
    const list = state.draft[listName];
    const index = list.indexOf(entry);
    if(index >= 0) list.splice(index, 1);
    Admin.markDirty();
    Admin.rerender();
  }

  function removeEnded(listName, filter = () => true){
    const before = state.draft[listName].length;
    state.draft[listName] = state.draft[listName].filter(entry => !filter(entry) || Schema.timing(entry) !== 'ended');
    const removed = before - state.draft[listName].length;
    Admin.markDirty();
    Admin.toast(removed ? `${removed} ended entr${removed === 1 ? 'y' : 'ies'} removed from the draft.` : 'Nothing has ended.', 'info');
    Admin.rerender();
  }

  function sortByTiming(list){
    const order = {active:0, scheduled:1, ended:2};
    return list.slice().sort((a, b) => order[Schema.timing(a)] - order[Schema.timing(b)]);
  }

  async function render(page, params){
    await Admin.loadGraphs();
    const tab = TABS.some(item => item.id === params[0]) ? params[0] : 'elevators';
    const canEdit = Admin.can('status');
    const draft = state.draft;
    const indoor = draft.closures.filter(entry => !entry.area);
    const zones = draft.closures.filter(entry => entry.area);
    const counts = {elevators:draft.elevators.length, closures:indoor.length, zones:zones.length, noise:draft.noiseAreas.length};

    const addButton = {
      elevators:() => elevatorEditor({}),
      closures:() => closureEditor({}),
      zones:() => zoneEditor({}),
      noise:() => noiseEditor({})
    }[tab];

    page.append(Admin.pageHeader('Live status',
      'What the app routes around right now. Changes go into a draft; press “Save to live status” to write app/data/campus-status.json.',
      canEdit ? h('button', {type:'button', class:'btn btn-primary btn-sm', onclick:addButton}, `+ Add ${{elevators:'outage', closures:'closure', zones:'zone', noise:'area'}[tab]}`) : null
    ));
    const note = Admin.readOnlyNote('status', 'the live status');
    if(note) page.append(note);
    page.append(Admin.tabs(TABS.map(item => ({...item, count:counts[item.id]})), tab, id => Admin.go('status', id)));

    const list = h('ul', {class:'entries'});
    if(tab === 'elevators'){
      sortByTiming(draft.elevators).forEach(entry => {
        const index = draft.elevators.indexOf(entry);
        list.append(entryRow({
          entry,
          title:`${Admin.buildingName(entry.building)} — ${entry.building === 'campus' ? 'outdoor elevator' : `Elevator ${Health.elevatorNumber(entry.elevator)}`}`,
          detail:entry.note,
          extra:entry.reportIds && entry.reportIds.length ? h('p', {class:'entry-detail'}, 'From report ', entry.reportIds.map(id => h('a', {href:`#reports/${id}`, text:id}))) : null,
          onEdit:() => elevatorEditor(entry, {index}),
          onRemove:() => removeEntry('elevators', entry)
        }));
      });
    }
    if(tab === 'closures'){
      sortByTiming(indoor).forEach(entry => {
        const index = draft.closures.indexOf(entry);
        list.append(entryRow({
          entry,
          title:`${Admin.buildingName(entry.building)} — ${entry.nodeIds.length} place(s) closed`,
          detail:[entry.reason, entry.nodeIds.slice(0, 4).map(id => Admin.nodeLabel(entry.building, id)).join(', ') + (entry.nodeIds.length > 4 ? '…' : '')].filter(Boolean).join(' · '),
          onEdit:() => closureEditor(entry, {index}),
          onRemove:() => removeEntry('closures', entry)
        }));
      });
    }
    if(tab === 'zones'){
      const mapNode = h('div', {class:'map-box map-box--page'});
      page.append(mapNode);
      setTimeout(() => {
        const map = Admin.campusMap(mapNode, {zoom:16});
        zones.forEach(entry => L.polygon(entry.area, {
          color:Schema.timing(entry) === 'active' ? '#DC2626' : '#64748B', weight:2, dashArray:'6,6', fillOpacity:.15
        }).addTo(map).bindTooltip(Admin.textNode(entry.reason || 'No-go zone')));
      }, 0);
      sortByTiming(zones).forEach(entry => {
        const index = draft.closures.indexOf(entry);
        list.append(entryRow({
          entry,
          title:entry.reason || 'Outdoor no-go zone',
          detail:`${entry.area.length} corners`,
          onEdit:() => zoneEditor(entry, {index}),
          onRemove:() => removeEntry('closures', entry)
        }));
      });
    }
    if(tab === 'noise'){
      draft.noiseAreas.forEach((entry, index) => {
        const until = entry.until ? Date.parse(entry.until) : Infinity;
        const ended = Number.isFinite(until) && until < Date.now();
        list.append(h('li', {class:'entry'},
          h('div', {class:'entry-main'},
            h('div', {class:'entry-title'}, Admin.badge(ended ? 'Ended' : 'Active', ended ? 'muted' : 'success'), h('strong', {text:entry.label || entry.id})),
            h('p', {class:'entry-detail', text:`${[entry.noisy && 'noisy', entry.crowded && 'crowded'].filter(Boolean).join(' and ') || 'calm'} · ${entry.outdoorNodeIds.length} path point(s)`}),
            h('p', {class:'entry-dates', text:entry.until ? `until ${Admin.formatDate(entry.until)}` : 'no end date'})
          ),
          canEdit ? h('div', {class:'entry-actions'},
            h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:() => noiseEditor(entry, {index})}, 'Edit'),
            h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:() => removeEntry('noiseAreas', entry)}, 'Remove')
          ) : null
        ));
      });
    }

    if(!list.children.length){
      page.append(Admin.empty({
        elevators:'No elevator outages. Routes use every mapped elevator.',
        closures:'No indoor closures.',
        zones:'No outdoor no-go zones.',
        noise:'No noisy or crowded areas.'
      }[tab], canEdit ? h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:addButton}, 'Add one') : null));
    }else{
      page.append(list);
      if(canEdit && tab !== 'noise'){
        const listName = tab === 'elevators' ? 'elevators' : 'closures';
        const filter = tab === 'zones' ? entry => Boolean(entry.area) : tab === 'closures' ? entry => !entry.area : () => true;
        page.append(h('button', {type:'button', class:'link-btn', onclick:() => removeEnded(listName, filter)}, 'Remove ended entries'));
      }
    }
  }

  Admin.entryErrors = errorsOf;
  Admin.statusEditors = Object.assign(Admin.statusEditors || {}, {
    elevator:elevatorEditor,
    closure:closureEditor,
    zone:zoneEditor,
    noise:noiseEditor
  });
  Admin.register('status', {title:'Live status', icon:'⚠', render});
})();
