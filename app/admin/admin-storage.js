// CampusWay admin: how much data CampusWay keeps on this PC and in the cloud
// inbox, against their limits, and how the free Cloudflare plan stays free.
(function(){
  'use strict';
  const {h} = Admin;

  function size(bytes){
    if(!Number.isFinite(bytes)) return '—';
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes, unit = 0;
    while(value >= 1024 && unit < units.length - 1){ value /= 1024; unit += 1; }
    return `${unit === 0 ? value : value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`;
  }

  function percent(part, whole){
    return whole > 0 ? Math.min(100, part / whole * 100) : 0;
  }

  function gauge(label, used, limit, {format = size, note} = {}){
    const value = percent(used, limit);
    const level = value >= 100 ? 'full' : value >= 80 ? 'high' : 'ok';
    return h('div', {class:`gauge gauge--${level}`},
      h('div', {class:'gauge-head'},
        h('span', {class:'gauge-label', text:label}),
        h('strong', {text:`${format(used)} of ${format(limit)}`}),
        h('span', {class:'muted', text:` · ${value < 0.1 && used > 0 ? '<0.1' : value.toFixed(value < 10 ? 1 : 0)}%`})
      ),
      h('div', {class:'gauge-track', role:'meter', 'aria-valuemin':'0', 'aria-valuemax':String(limit), 'aria-valuenow':String(used), 'aria-label':label},
        h('div', {class:'gauge-fill', style:{width:`${Math.max(value, used > 0 ? 0.5 : 0)}%`}})
      ),
      note ? h('p', {class:'gauge-note', text:note}) : null
    );
  }

  const count = value => Number(value || 0).toLocaleString('en-GB');

  function pcPanel(pc){
    const value = percent(pc.bytes, pc.limitBytes);
    const panel = h('section', {class:'panel'},
      h('div', {class:'panel-head'},
        h('h2', {text:'This PC'}),
        Admin.badge(pc.full ? 'limit reached' : value >= 80 ? 'nearly full' : 'within limit', pc.full ? 'danger' : value >= 80 ? 'warning' : 'success')
      ),
      gauge('CampusWay data', pc.bytes, pc.limitBytes, {note:`Limit set with --max-data-gb (now ${size(pc.limitBytes)}). At the limit, new reports, usage counts and cloud fetches stop; phones and the inbox keep their data until there is room.`})
    );
    if(pc.full){
      panel.append(h('p', {class:'note note--warning', text:'The limit is reached. Export and clear old reports, or raise the limit, to receive new data again.'}));
    }
    panel.append(h('div', {class:'table-wrap'}, h('table', {class:'table table--compact'},
      h('thead', {}, h('tr', {}, ['What', 'File', 'Size', 'Kept'].map(text => h('th', {text})))),
      h('tbody', {}, pc.parts.map(part => h('tr', {},
        h('td', {text:part.label}),
        h('td', {}, part.file ? h('code', {text:part.file}) : '—'),
        h('td', {text:size(part.bytes)}),
        h('td', {class:'muted', text:{
          reports:`${count(pc.counts.reports)} of at most ${count(pc.counts.maxReports)} reports`,
          audit:`${count(pc.counts.auditEntries)} of at most ${count(pc.counts.maxAudit)} entries`,
          usage:`${count(pc.counts.usageDays)} ${pc.counts.usageDays === 1 ? 'day' : 'days'}, at most ${count(pc.counts.maxUsageDays)}`,
          history:`${count(pc.counts.statusVersions)} of at most ${count(pc.counts.maxStatusVersions)} versions`
        }[part.key] || ''})
      )))
    )));
    panel.append(h('p', {class:'muted'},
      'Each kind of data also has its own cap (the "Kept" column), so in practice CampusWay stays in the megabytes, far below the limit. ',
      `Data folder: `, h('code', {text:pc.directory}), '.'
    ));
    const facts = h('dl', {class:'facts'});
    if(pc.disk) facts.append(h('dt', {text:'Free space on this drive'}), h('dd', {text:`${size(pc.disk.freeBytes)} of ${size(pc.disk.totalBytes)}`}));
    if(pc.project) facts.append(h('dt', {text:'App files (maps, code)'}), h('dd', {text:`${size(pc.project.bytes)} in ${count(pc.project.files)} files — the app itself, not counted in the limit`}));
    facts.append(h('dt', {text:'Measured'}), h('dd', {text:Admin.relative(pc.measuredAt)}));
    panel.append(facts);
    return panel;
  }

  function cloudPanel(cloud){
    const panel = h('section', {class:'panel'}, h('div', {class:'panel-head'}, h('h2', {text:'Cloud inbox'})));
    if(!(cloud.url && cloud.hasKey)){
      panel.append(Admin.empty('The cloud inbox is not set up, so nothing is stored in the cloud.', h('a', {class:'btn btn-ghost btn-sm', href:'#cloud'}, 'Set it up')));
      return panel;
    }
    const stats = cloud.lastStats;
    if(!stats){
      panel.append(h('p', {class:'muted', text:'The inbox reports its numbers each time this PC fetches from it. No successful fetch yet.'}));
      if(Admin.can('reports')) panel.append(h('div', {class:'panel-actions'}, fetchButton()));
      return panel;
    }
    const limits = stats.limits || {};
    const free = stats.freePlan || {};
    panel.querySelector('.panel-head').append(Admin.badge(stats.dbBytes >= limits.maxDbBytes ? 'limit reached' : 'within limits', stats.dbBytes >= limits.maxDbBytes ? 'danger' : 'success'));
    panel.append(
      Number.isFinite(stats.dbBytes)
        ? gauge('Inbox database', stats.dbBytes, limits.maxDbBytes, {note:`CampusWay's own cap (MAX_DB_MB in cloud/wrangler.toml). Cloudflare's free plan allows ${size(free.storageBytes)}.`})
        : h('p', {class:'muted', text:'The inbox did not report its database size.'}),
      gauge('Reports waiting for this PC', stats.pendingReports, limits.maxPending, {format:count}),
      gauge('Reports received today', stats.reportsToday, limits.reportsPerDay, {format:count, note:'For the whole inbox, all devices together. Resets at midnight (Israel time).'}),
      gauge('Usage counts received today', stats.usageToday, limits.usagePerDay, {format:count}),
      h('dl', {class:'facts'},
        h('dt', {text:'Per device'}), h('dd', {text:`${count(limits.reportsPerDeviceHour)} reports and ${count(limits.usagePerDeviceHour)} counts per hour`}),
        h('dt', {text:'Measured'}), h('dd', {text:`${Admin.relative(stats.at)} (at the last fetch)`})
      )
    );
    if(Admin.can('reports')) panel.append(h('div', {class:'panel-actions'}, fetchButton('Refresh numbers')));
    return panel;
  }

  function fetchButton(text = 'Fetch now'){
    return h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:async event => {
      event.currentTarget.disabled = true;
      try{ await Admin.fetchFromCloud(); }catch(error){ Admin.toast(error.message, 'error', 9000); }
      Admin.rerender();
    }}, text);
  }

  function billingPanel(cloud){
    const free = (cloud.lastStats && cloud.lastStats.freePlan) || {storageBytes:5 * 1024 ** 3, requestsPerDay:100000, rowsWrittenPerDay:100000, rowsReadPerDay:5000000};
    return h('section', {class:'panel'},
      h('div', {class:'panel-head'}, h('h2', {text:'Staying free on Cloudflare'})),
      h('p', {text:'On Cloudflare’s Free plan, going over a limit does not create a bill: the inbox simply stops answering until the limit resets the next day. Charges are only possible after you upgrade to the paid Workers plan, which needs a payment method.'}),
      h('div', {class:'table-wrap'}, h('table', {class:'table table--compact'},
        h('thead', {}, h('tr', {}, ['', 'Free plan', 'CampusWay cap'].map(text => h('th', {text})))),
        h('tbody', {},
          h('tr', {}, h('td', {text:'Storage'}), h('td', {text:size(free.storageBytes)}), h('td', {text:cloud.lastStats ? size(cloud.lastStats.limits.maxDbBytes) : '100 MB'})),
          h('tr', {}, h('td', {text:'Requests per day'}), h('td', {text:count(free.requestsPerDay)}), h('td', {text:`about ${count((cloud.lastStats ? cloud.lastStats.limits.reportsPerDay + cloud.lastStats.limits.usagePerDay : 21000) + 300)} that store data`})),
          h('tr', {}, h('td', {text:'Rows written per day'}), h('td', {text:count(free.rowsWrittenPerDay)}), h('td', {text:'about 3 per report or count, so at most ~65,000'}))
        )
      )),
      h('p', {class:'muted', text:'Free-plan numbers are Cloudflare’s at the time of writing; check developers.cloudflare.com/workers/platform/pricing for the current ones.'}),
      h('h3', {class:'subhead', text:'Check once in the Cloudflare dashboard'}),
      h('ol', {class:'plain-list'},
        h('li', {}, h('strong', {text:'Workers & Pages → Plans'}), ' shows ', h('strong', {text:'Free'}), '.'),
        h('li', {}, h('strong', {text:'Manage account → Billing'}), ' has no active subscription and, ideally, no payment method.'),
        h('li', {}, 'Never choose ', h('em', {text:'Upgrade'}), ' or ', h('em', {text:'Workers Paid'}), ' for this account.')
      ),
      h('p', {class:'muted'}, h('a', {href:'https://dash.cloudflare.com/', target:'_blank', rel:'noopener', text:'Open the Cloudflare dashboard ↗'}))
    );
  }

  async function render(page){
    const data = await Admin.api('GET', 'api/admin/storage');
    page.append(Admin.pageHeader('Storage', 'How much data CampusWay keeps on this PC and in the cloud inbox, and the limits that keep it small and free.'));
    page.append(h('div', {class:'two-col'}, pcPanel(data.pc), h('div', {class:'stack'}, cloudPanel(data.cloud), billingPanel(data.cloud))));
  }

  Admin.formatBytes = size;
  Admin.register('storage', {title:'Storage', icon:'▣', render});
})();
