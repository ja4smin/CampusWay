// CampusWay admin: floor-plan node picker and campus map picker.
(function(){
  'use strict';
  const {h, clear, state, Health} = Admin;

  // Same layout as the indoor page: plans are stretched to 840 × 570.
  const PLAN_W = 840, PLAN_H = 570;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TYPE_COLORS = {
    room:'#64748B', corridor:'#CBD5E1', stairs:'#D97706', elevator:'#7C3AED', entrance:'#047857',
    restroom:'#0891B2', shelter:'#B91C1C', food:'#DB2777', landmark:'#2563EB'
  };

  function svg(tag, attributes = {}){
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if(value !== undefined && value !== null) node.setAttribute(key, value);
    });
    return node;
  }

  // building:floor → the plan file name that loaded, so later draws skip the misses.
  const foundPlans = new Map();

  function planUrls(building, floorId){
    const number = floorId === 'floorminus1' ? '-1' : floorId.replace(/^floor/, '');
    return [...new Set([`${floorId}.svg`, `floor${number}.svg`, `${number}-Model.svg`, `${number}.svg`])]
      .map(name => `buildings/${building}/floors/${name}`);
  }

  function sortedFloors(graph){
    return Object.keys(graph && graph.floors || {}).sort((a, b) => Health.floorNumber(a) - Health.floorNumber(b));
  }

  // options: {building, floor, selected:Set, highlight:Set, onToggle(node), readOnly, showCorridors}
  function floorPlan(options){
    const graph = state.graphs[options.building];
    const wrap = h('div', {class:'plan-picker'});
    if(!graph){
      wrap.append(h('p', {class:'note note--warning', text:`The map of ${Admin.buildingName(options.building)} could not be loaded.`}));
      return wrap;
    }
    const floors = sortedFloors(graph).filter(floorId => (graph.floors[floorId].nodes || []).length);
    let floor = options.floor && floors.includes(options.floor) ? options.floor : null;
    if(!floor){
      const firstSelected = [...(options.selected || []), ...(options.highlight || [])].map(id => Admin.nodeById(options.building, id)).find(Boolean);
      floor = firstSelected ? firstSelected.floor : floors[0];
    }
    let showCorridors = options.showCorridors === true;
    let search = '';

    const floorSelect = Admin.select(floors.map(id => ({value:id, text:Health.floorName(id)})), floor, {'aria-label':'Floor'});
    floorSelect.addEventListener('change', () => { floor = floorSelect.value; draw(); });
    const searchBox = h('input', {type:'search', placeholder:'Find a room or place…', 'aria-label':'Find on floor plan'});
    searchBox.addEventListener('input', () => {
      search = searchBox.value.trim().toLowerCase();
      if(search){
        const match = Health.allNodes(graph).find(node => String(node.label || '').toLowerCase().includes(search));
        if(match && match.floor !== floor){ floor = match.floor; floorSelect.value = floor; }
      }
      draw();
    });
    const corridorToggle = h('label', {class:'inline-check'},
      h('input', {type:'checkbox', checked:showCorridors, onchange:event => { showCorridors = event.target.checked; draw(); }}),
      ' Show corridor points'
    );
    const canvas = svg('svg', {viewBox:`0 0 ${PLAN_W} ${PLAN_H}`, class:'plan-svg', role:'img', 'aria-label':'Floor plan'});
    const legend = h('div', {class:'plan-legend'},
      ['room', 'elevator', 'stairs', 'entrance', 'restroom'].map(type => h('span', {}, h('i', {style:{background:TYPE_COLORS[type]}}), type)),
      h('span', {}, h('i', {class:'is-selected'}), options.readOnly ? 'highlighted' : 'selected')
    );

    function draw(){
      while(canvas.firstChild) canvas.firstChild.remove();
      const planKey = `${options.building}:${floor}`;
      const urls = foundPlans.has(planKey) ? [foundPlans.get(planKey)] : planUrls(options.building, floor);
      const image = svg('image', {x:0, y:0, width:PLAN_W, height:PLAN_H, preserveAspectRatio:'none', class:'plan-image'});
      let attempt = 0;
      image.addEventListener('load', () => foundPlans.set(planKey, urls[attempt]));
      image.addEventListener('error', () => {
        attempt += 1;
        if(attempt < urls.length) image.setAttribute('href', urls[attempt]);
      });
      image.setAttribute('href', urls[0]);
      canvas.append(svg('rect', {x:0, y:0, width:PLAN_W, height:PLAN_H, fill:'#fff'}), image);

      const nodes = (graph.floors[floor].nodes || []).map(node => ({...node, floor:node.floor || floor}));
      const byId = new Map(nodes.map(node => [node.id, node]));
      const lines = svg('g', {class:'plan-lines'});
      (graph.floors[floor].connections || []).forEach(connection => {
        const a = byId.get(connection.from), b = byId.get(connection.to);
        if(a && b) lines.append(svg('line', {x1:a.x * PLAN_W, y1:a.y * PLAN_H, x2:b.x * PLAN_W, y2:b.y * PLAN_H}));
      });
      canvas.append(lines);

      const layer = svg('g', {class:'plan-nodes'});
      nodes.forEach(node => {
        const selected = options.selected && options.selected.has(node.id);
        const highlighted = options.highlight && options.highlight.has(node.id);
        const matches = search && String(node.label || '').toLowerCase().includes(search);
        if(node.type === 'corridor' && !showCorridors && !selected && !highlighted) return;
        const radius = node.type === 'corridor' ? 3.5 : selected || highlighted ? 8 : 5.5;
        const circle = svg('circle', {
          cx:node.x * PLAN_W, cy:node.y * PLAN_H, r:radius,
          fill:selected || highlighted ? '#DC2626' : TYPE_COLORS[node.type] || '#475569',
          class:`plan-node${selected || highlighted ? ' is-selected' : ''}${matches ? ' is-match' : ''}${options.readOnly ? '' : ' is-clickable'}`,
          tabindex:options.readOnly ? undefined : '0'
        });
        const title = svg('title');
        title.textContent = `${node.label || node.type} (${node.type}) · ${node.id}`;
        circle.append(title);
        if(!options.readOnly){
          const toggle = () => { options.onToggle && options.onToggle(node); draw(); };
          circle.addEventListener('click', toggle);
          circle.addEventListener('keydown', event => { if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); toggle(); } });
        }
        layer.append(circle);
        if(matches || selected || highlighted){
          const label = svg('text', {x:node.x * PLAN_W + 10, y:node.y * PLAN_H + 4, class:'plan-label'});
          label.textContent = node.label || node.type;
          layer.append(label);
        }
      });
      canvas.append(layer);
    }

    // Zoom: the plan grows inside a scrollable frame.
    let zoom = 1;
    const frame = h('div', {class:'plan-frame'}, canvas);
    const zoomText = h('span', {class:'plan-zoom-text', text:'100%'});
    const setZoom = value => {
      const center = {x:(frame.scrollLeft + frame.clientWidth / 2) / frame.scrollWidth, y:(frame.scrollTop + frame.clientHeight / 2) / frame.scrollHeight};
      zoom = Math.min(4, Math.max(1, value));
      canvas.style.width = `${zoom * 100}%`;
      zoomText.textContent = `${Math.round(zoom * 100)}%`;
      frame.scrollLeft = center.x * frame.scrollWidth - frame.clientWidth / 2;
      frame.scrollTop = center.y * frame.scrollHeight - frame.clientHeight / 2;
    };
    const zoomControls = h('div', {class:'plan-zoom'},
      h('button', {type:'button', class:'chip', 'aria-label':'Zoom out', onclick:() => setZoom(zoom - 0.5)}, '−'),
      zoomText,
      h('button', {type:'button', class:'chip', 'aria-label':'Zoom in', onclick:() => setZoom(zoom + 0.5)}, '+')
    );

    draw();
    wrap.append(
      h('div', {class:'plan-toolbar'}, floorSelect, searchBox, zoomControls, corridorToggle),
      frame,
      legend
    );
    wrap.redraw = draw;
    return wrap;
  }

  // ── Campus map ──
  const CAMPUS_CENTER = [32.7617, 35.0195];

  function campusMap(container, {zoom = 17} = {}){
    const map = L.map(container, {preferCanvas:true, zoomControl:true}).setView(CAMPUS_CENTER, zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom:19, maxZoom:21, attribution:'&copy; OpenStreetMap contributors'
    }).addTo(map);
    (typeof CAMPUS_DATA !== 'undefined' ? CAMPUS_DATA.buildings : []).forEach(building => {
      L.polygon(building.polygon, {color:'#0E7490', weight:1, fillOpacity:.08, interactive:false}).addTo(map);
    });
    setTimeout(() => map.invalidateSize(), 60);
    return map;
  }

  let outdoorPromise = null;
  function outdoorGraph(){
    if(!outdoorPromise){
      outdoorPromise = CampusOutdoorRouting.load().then(() => CampusOutdoorRouting.getDebugGraph());
    }
    return outdoorPromise;
  }

  Object.assign(Admin, {floorPlan, campusMap, outdoorGraph, sortedFloors, PLAN_W, PLAN_H});
})();
