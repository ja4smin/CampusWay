// CampusWay admin: map data health — checks on the indoor graphs and the
// campus data, computed in the browser from the files the app uses.
(function(){
  'use strict';
  const {h, clear, state, Schema, Health} = Admin;

  const SEVERITY_ORDER = {error:0, warning:1, info:2};
  const COPIES = [
    {key:'madriga', file:'app/prototype/madriga-graph.js', global:'MADRIGA_GRAPH'},
    {key:'multi-purpose', file:'app/prototype/multi-purpose-graph.js', global:'MULTI_PURPOSE_GRAPH'}
  ];

  // The JavaScript copies are "const NAME = {…json…};" files. They are read
  // as text and parsed as JSON, so no code from them is run.
  const copies = new Map();
  function loadCopy(copy){
    if(!copies.has(copy.file)){
      copies.set(copy.file, fetch(copy.file, {cache:'no-store'})
        .then(response => response.ok ? response.text() : '')
        .then(source => {
          const start = source.indexOf('{'), end = source.lastIndexOf('}');
          return start >= 0 && end > start ? JSON.parse(source.slice(start, end + 1)) : null;
        })
        .catch(() => null));
    }
    return copies.get(copy.file);
  }

  function campusChecks(){
    const issues = [];
    if(typeof CAMPUS_DATA === 'undefined') return issues;
    const points = [...(CAMPUS_DATA.points.food || []), ...(CAMPUS_DATA.points.shops || [])];
    points.forEach(place => {
      if(!place.indoor) return;
      const graph = state.graphs[place.indoor.buildingKey];
      if(!graph) return;
      const missing = (place.indoor.nodeIds || []).filter(id => !Admin.nodeById(place.indoor.buildingKey, id));
      if(missing.length) issues.push({severity:'error', code:'place-node', building:place.indoor.buildingKey, message:`“${place.name}” points to indoor node(s) that do not exist: ${missing.join(', ')}.`, nodes:[]});
    });
    const mapped = new Set(Schema.BUILDING_KEYS);
    const outdoorOnly = Object.keys(typeof BUILDING_ENTRANCES !== 'undefined' ? BUILDING_ENTRANCES : {}).filter(key => !mapped.has(key));
    if(outdoorOnly.length){
      issues.push({severity:'info', code:'outdoor-only', building:'campus', message:`${outdoorOnly.length} buildings have no indoor map yet (${outdoorOnly.join(', ')}). Routes end at their entrance.`, nodes:[]});
    }
    return issues;
  }

  function showNodes(issue){
    const byFloor = {};
    issue.nodes.forEach(node => { (byFloor[node.floor] = byFloor[node.floor] || []).push(node); });
    const highlight = new Set(issue.nodes.map(node => node.id));
    Admin.modal({
      title:`${Admin.buildingName(issue.building)} · ${issue.message}`,
      wide:true,
      body:h('div', {class:'editor'},
        Admin.floorPlan({building:issue.building, highlight, readOnly:true, showCorridors:issue.nodes.some(node => node.type === 'corridor')}),
        h('div', {class:'node-table'}, Object.entries(byFloor).sort((a, b) => Health.floorNumber(a[0]) - Health.floorNumber(b[0])).map(([floor, nodes]) => h('div', {},
          h('h3', {text:`${Health.floorName(floor)} (${nodes.length})`}),
          h('p', {}, nodes.map(node => h('code', {class:'node-chip', title:`${node.type} · ${node.id}`, text:node.label || node.id})))
        ))),
        h('p', {class:'muted'}, 'Fix these in the WayFrame editor (', h('a', {href:'wayframe/wayframe.html', target:'_blank', rel:'noopener', text:'wayframe/wayframe.html'}), '), then export the graph to ', h('code', {text:`buildings/${issue.building}/${issue.building}-indoor-graph.json`}), '.')
      ),
      actions:[{text:'Close'}]
    });
  }

  function percent(part, whole){
    return whole ? Math.round(part / whole * 100) : 0;
  }

  function meter(label, part, whole){
    const value = percent(part, whole);
    return h('div', {class:'meter'},
      h('div', {class:'meter-head'}, h('span', {text:label}), h('strong', {text:`${value}%`}), h('span', {class:'muted', text:` ${part} of ${whole}`})),
      h('div', {class:'meter-track'}, h('div', {class:`meter-fill${value < 90 ? ' is-low' : ''}`, style:{width:`${value}%`}}))
    );
  }

  async function render(page){
    await Admin.loadGraphs();
    const results = Schema.BUILDINGS.map(building => {
      const graph = state.graphs[building.key];
      if(!graph) return {building:building.key, missing:true, issues:[{severity:'error', code:'missing-graph', building:building.key, message:`${building.graph} could not be loaded.`, nodes:[]}], stats:null};
      return Health.analyzeBuilding(building.key, graph, {entrances:Admin.entrances(building.key)});
    });
    const copies = await Promise.all(COPIES.map(async copy => ({...copy, graph:await loadCopy(copy)})));
    const copyIssues = copies.map(copy => {
      if(!copy.graph || !state.graphs[copy.key]) return null;
      const result = Health.compareCopy(state.graphs[copy.key], copy.graph);
      // The pages load the JSON graphs; the old copies are only precached by service-worker.js.
      return result.same ? null : {
        severity:'info', code:'stale-copy', building:copy.key, nodes:[],
        message:`${copy.file} differs from the JSON (${result.copy.nodes} nodes / ${result.copy.connections} connections vs ${result.json.nodes} / ${result.json.connections}). The app now loads the JSON, so this copy is only downloaded for offline use and could be removed from service-worker.js.`
      };
    }).filter(Boolean);
    const extra = [...campusChecks(), ...copyIssues];
    const allIssues = [...results.flatMap(result => result.issues), ...extra];
    const totals = {
      error:allIssues.filter(issue => issue.severity === 'error').length,
      warning:allIssues.filter(issue => issue.severity === 'warning').length,
      info:allIssues.filter(issue => issue.severity === 'info').length
    };

    page.append(Admin.pageHeader('Map data health', 'Automatic checks on the indoor maps and campus data the app uses. Nothing here changes data.',
      h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:() => {
        const rows = [['severity', 'building', 'check', 'message', 'node ids']];
        allIssues.forEach(issue => rows.push([issue.severity, issue.building, issue.code, issue.message, issue.nodes.map(node => node.id).join(' ')]));
        Admin.download(`campusway-data-health-${Admin.today()}.csv`, Admin.csv(rows), 'text/csv');
      }}, 'Download CSV')
    ));

    page.append(h('div', {class:'stat-grid stat-grid--small'},
      h('div', {class:`stat-card${totals.error ? ' stat-card--danger' : ''}`}, h('span', {class:'stat-title', text:'Errors'}), h('strong', {class:'stat-value', text:String(totals.error)}), h('span', {class:'stat-detail', text:'break routing or search'})),
      h('div', {class:`stat-card${totals.warning ? ' stat-card--warning' : ''}`}, h('span', {class:'stat-title', text:'Warnings'}), h('strong', {class:'stat-value', text:String(totals.warning)}), h('span', {class:'stat-detail', text:'limit routes'})),
      h('div', {class:'stat-card'}, h('span', {class:'stat-title', text:'Notes'}), h('strong', {class:'stat-value', text:String(totals.info)}), h('span', {class:'stat-detail', text:'worth tidying'}))
    ));

    if(extra.length){
      page.append(h('section', {class:'panel'},
        h('div', {class:'panel-head'}, h('h2', {text:'Campus data'})),
        issueList(extra)
      ));
    }

    results.forEach(result => {
      const panel = h('section', {class:'panel health-card'},
        h('div', {class:'panel-head'},
          h('h2', {text:Admin.buildingName(result.building)}),
          h('div', {class:'chips'},
            result.issues.some(issue => issue.severity === 'error') ? Admin.badge('errors', 'danger') : null,
            result.issues.some(issue => issue.severity === 'warning') ? Admin.badge(`${result.issues.filter(issue => issue.severity === 'warning').length} warnings`, 'warning') : null,
            !result.issues.length ? Admin.badge('all good', 'success') : null
          )
        )
      );
      if(result.stats){
        const stats = result.stats;
        panel.append(
          h('p', {class:'muted', text:`${stats.floors} floors · ${stats.nodes} nodes · ${stats.connections} connections · ${stats.destinations} destinations · ${stats.elevators} elevator shaft(s) · ${stats.entrances} entrance(s)`}),
          h('div', {class:'meters'},
            meter('Reachable from an entrance', stats.reachable, stats.destinations),
            meter('Reachable step-free', stats.stepFree, stats.destinations)
          ),
          h('details', {}, h('summary', {text:'Per floor'}),
            h('table', {class:'table table--compact'},
              h('thead', {}, h('tr', {}, ['Floor', 'Destinations', 'Reachable', 'Step-free'].map(text => h('th', {text})))),
              h('tbody', {}, Object.entries(stats.perFloor).map(([floor, row]) => h('tr', {},
                h('td', {text:Health.floorName(floor)}),
                h('td', {text:String(row.destinations)}),
                h('td', {text:`${row.reachable}`}),
                h('td', {class:row.stepFree < row.destinations ? 'text-warning' : '', text:`${row.stepFree}`})
              )))
            )
          )
        );
      }
      if(result.issues.length) panel.append(issueList(result.issues));
      page.append(panel);
    });
  }

  function issueList(issues){
    return h('ul', {class:'issues'}, issues.slice().sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).map(issue => h('li', {class:`issue issue--${issue.severity}`},
      Admin.badge(issue.severity, issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'info'),
      h('span', {text:issue.message}),
      issue.nodes && issue.nodes.length && state.graphs[issue.building] ? h('button', {type:'button', class:'link-btn', onclick:() => showNodes(issue)}, 'Show on map') : null
    )));
  }

  Admin.register('health', {title:'Data health', icon:'✓', render});
})();
