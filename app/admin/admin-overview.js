// CampusWay admin: overview of everything that needs attention.
(function(){
  'use strict';
  const {h, state, Schema, Health} = Admin;

  function card(title, value, detail, href, kind = ''){
    return h('a', {class:`stat-card ${kind ? `stat-card--${kind}` : ''}`, href},
      h('span', {class:'stat-title', text:title}),
      h('strong', {class:'stat-value', text:String(value)}),
      detail ? h('span', {class:'stat-detail', text:detail}) : null
    );
  }

  async function render(page){
    await Promise.all([Admin.loadOverview().catch(() => null), Admin.loadReports().catch(() => null)]);
    const overview = state.overview || {reports:{}, publish:{}, lan:[]};
    const status = state.status;
    const active = list => list.filter(entry => Schema.isActive(entry));
    const openReports = state.reports.filter(report => !['resolved', 'rejected'].includes(report.status));
    const newReports = state.reports.filter(report => report.status === 'new');

    page.append(Admin.pageHeader('Overview', 'What needs attention on campus right now.'));

    if(status.emergency.active){
      page.append(h('div', {class:'alert alert--danger'},
        h('strong', {text:'Emergency mode is ON. '}),
        'Every CampusWay page shows the emergency banner with a Nearest shelter button. ',
        h('a', {href:'#announce', text:'Manage emergency mode'})
      ));
    }

    // Publishing
    // Publishing: through the cloud inbox when it is set up (automatic), otherwise with git.
    const cloud = overview.cloud || {};
    if(cloud.url && cloud.hasKey){
      if(!cloud.liveUpToDate){
        page.append(h('div', {class:'alert alert--warning'},
          h('div', {},
            h('strong', {text:'The latest live status is not on the public site yet. '}),
            cloud.lastPublish && cloud.lastPublish.error ? `The cloud inbox could not be reached (${cloud.lastPublish.error}). ` : '',
            'CampusWay retries every few minutes while this PC runs the server.'
          ),
          h('div', {}, h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:async event => {
            event.currentTarget.disabled = true;
            try{
              const result = await Admin.api('POST', 'api/admin/cloud/publish', {});
              Admin.toast(result.live.state === 'live' ? 'Live on the public site.' : `Still not live: ${result.live.error}`, result.live.state === 'live' ? 'success' : 'error', 8000);
            }catch(error){ Admin.toast(error.message, 'error'); }
            Admin.rerender();
          }}, 'Publish now'))
        ));
      }
    }else if(overview.publish && overview.publish.unpublished){
      page.append(h('div', {class:'alert alert--warning'},
        h('div', {},
          h('strong', {text:'The live status file has changes that are not on GitHub yet. '}),
          'Phones that open CampusWay from this PC already see them. To publish them to the GitHub Pages site, commit and push, or set up the Cloud inbox to publish automatically:'
        ),
        h('pre', {class:'code', text:`git add ${overview.publish.file}\ngit commit -m "Update campus status"\ngit push`})
      ));
    }

    const indoorClosures = status.closures.filter(entry => !entry.area);
    const zones = status.closures.filter(entry => entry.area);
    page.append(h('div', {class:'stat-grid'},
      card('New reports', newReports.length, `${openReports.length} open in total`, '#reports', newReports.length ? 'danger' : ''),
      card('Elevator outages', active(status.elevators).length, `${status.elevators.length} listed`, '#status/elevators', active(status.elevators).length ? 'warning' : ''),
      card('Indoor closures', active(indoorClosures).length, `${indoorClosures.length} listed`, '#status/closures'),
      card('Outdoor no-go zones', active(zones).length, `${zones.length} listed`, '#status/zones'),
      card('Announcements', active(status.announcements).length, 'showing now', '#announce'),
      card('Opening hours', Object.keys(status.openingHours).length, 'places with hours', '#content/hours'),
      overview.storage ? card('Storage on this PC', Admin.formatBytes(overview.storage.bytes), `of ${Admin.formatBytes(overview.storage.limitBytes)} limit`, '#storage',
        overview.storage.full ? 'danger' : overview.storage.bytes >= overview.storage.limitBytes * 0.8 ? 'warning' : '') : null
    ));

    // Latest reports
    const latest = h('section', {class:'panel'},
      h('div', {class:'panel-head'}, h('h2', {text:'Latest reports'}), h('a', {href:'#reports', text:'All reports →'}))
    );
    if(!openReports.length){
      latest.append(Admin.empty('No open reports. Reports sent from the app (opened from this PC or your network) appear here.'));
    }else{
      const list = h('ul', {class:'compact-list'});
      openReports.slice(0, 6).forEach(report => list.append(h('li', {},
        Admin.statusBadge(report.status),
        h('a', {href:`#reports/${report.id}`, text:`${report.buildingName || Admin.buildingName(report.building)}: ${report.label || Admin.KIND_LABELS[report.kind]}`}),
        h('span', {class:'muted', text:` — ${Admin.PROBLEM_LABELS[report.problem] || report.problem} · ${Admin.relative(report.receivedAt || report.time)}`})
      )));
      latest.append(list);
    }

    // Data health summary (computed in the browser)
    const health = h('section', {class:'panel'},
      h('div', {class:'panel-head'}, h('h2', {text:'Map data health'}), h('a', {href:'#health', text:'Details →'})),
      h('p', {class:'muted', text:'Checking the indoor maps…'})
    );
    Admin.loadGraphs().then(graphs => {
      let errors = 0, warnings = 0, noStepFree = 0;
      Schema.BUILDINGS.forEach(building => {
        if(!graphs[building.key]) return;
        const result = Health.analyzeBuilding(building.key, graphs[building.key], {entrances:Admin.entrances(building.key)});
        result.issues.forEach(issue => {
          if(issue.severity === 'error') errors += 1;
          if(issue.severity === 'warning') warnings += 1;
          if(issue.code === 'no-step-free') noStepFree += issue.nodes.length;
        });
      });
      health.lastChild.replaceWith(h('div', {class:'mini-stats'},
        h('span', {}, h('strong', {text:String(errors)}), ' errors'),
        h('span', {}, h('strong', {text:String(warnings)}), ' warnings'),
        h('span', {}, h('strong', {text:String(noStepFree)}), ' places reachable only by stairs')
      ));
    });

    // Server facts
    const facts = h('section', {class:'panel'},
      h('div', {class:'panel-head'}, h('h2', {text:'This PC as the CampusWay server'})),
      h('dl', {class:'facts'},
        h('dt', {text:'Database folder'}), h('dd', {}, h('code', {text:overview.dbDir || 'server/db'})),
        h('dt', {text:'Live status file'}), h('dd', {}, h('code', {text:'app/data/campus-status.json'}), status.updated ? ` · updated ${Admin.formatDate(status.updated)}` : ''),
        h('dt', {text:'Last published (git)'}), h('dd', {text:overview.publish && overview.publish.lastCommit ? Admin.formatDate(overview.publish.lastCommit) : 'unknown'}),
        h('dt', {text:'Usage counts'}), h('dd', {text:overview.usage ? 'collecting (anonymous counts only)' : 'off (--no-usage)'}),
        h('dt', {text:'Cloud inbox'}), h('dd', {},
          overview.cloud && overview.cloud.url && overview.cloud.hasKey
            ? `${overview.cloud.lastError ? `problem: ${overview.cloud.lastError}` : `last fetch ${overview.cloud.lastSync ? Admin.relative(overview.cloud.lastSync) : 'never'}`}`
            : h('a', {href:'#cloud', text:'not set up — receive reports from the public site'})
        ),
        h('dt', {text:'Phones on your Wi-Fi'}), h('dd', {},
          overview.lan && overview.lan.length
            ? h('span', {}, 'Start the server with ', h('code', {text:'--lan'}), ', then open ', overview.lan.map(address => h('code', {text:`http://${address}:${location.port || 80}/`})), ' on a phone.')
            : 'No network connection found.'
        )
      )
    );

    page.append(h('div', {class:'two-col'}, latest, h('div', {class:'stack'}, health, facts)));
  }

  Admin.register('overview', {title:'Overview', icon:'◎', render});
})();
