// CampusWay admin: anonymous usage counts collected by the local server.
(function(){
  'use strict';
  const {h, clear} = Admin;

  const view = {days:30};
  const LANGUAGE_NAMES = {en:'English', he:'Hebrew', ar:'Arabic', ru:'Russian'};
  const PROFILE_NAMES = {general:'General', mobility:'Mobility', visual:'Visual', spatial:'Spatial', mental:'Rest space'};
  const MODE_NAMES = {auto:'Auto (demo)', sensor:'Phone sensors', wheelchair:'Manual / wheelchair'};

  function dayKeys(count){
    const keys = [];
    for(let i = count - 1; i >= 0; i -= 1) keys.push(Admin.today(-i));
    return keys;
  }

  function totals(data, type, keys){
    const result = {};
    keys.forEach(day => Object.entries(((data.days[day] || {})[type]) || {}).forEach(([key, value]) => {
      result[key] = (result[key] || 0) + value;
    }));
    return result;
  }

  function sum(object){
    return Object.values(object).reduce((total, value) => total + value, 0);
  }

  function ranking(title, object, {names = {}, empty = 'Nothing yet.', limit = 10, hint} = {}){
    const rows = Object.entries(object).sort((a, b) => b[1] - a[1]).slice(0, limit);
    const max = rows.length ? rows[0][1] : 1;
    return h('section', {class:'panel'},
      h('div', {class:'panel-head'}, h('h2', {text:title})),
      hint ? h('p', {class:'muted', text:hint}) : null,
      rows.length ? h('ol', {class:'bars'}, rows.map(([key, value]) => h('li', {},
        h('span', {class:'bar-label', title:key, text:names[key] || key}),
        h('span', {class:'bar-track'}, h('span', {class:'bar-fill', style:{width:`${Math.max(4, value / max * 100)}%`}})),
        h('strong', {class:'bar-value', text:String(value)})
      ))) : h('p', {class:'muted', text:empty})
    );
  }

  function dailyChart(data, keys){
    const values = keys.map(day => sum(((data.days[day] || {}).route) || {}));
    const max = Math.max(1, ...values);
    const chart = h('div', {class:'day-chart', role:'img', 'aria-label':`Route requests per day, last ${keys.length} days`});
    keys.forEach((day, index) => chart.append(h('div', {class:'day-bar', title:`${Admin.formatDate(day)}: ${values[index]} route request(s)`},
      h('span', {style:{height:`${values[index] / max * 100}%`}})
    )));
    return h('section', {class:'panel'},
      h('div', {class:'panel-head'}, h('h2', {text:'Route requests per day'}), h('span', {class:'muted', text:`peak ${max === 1 && !values.some(Boolean) ? 0 : max}`})),
      chart,
      h('div', {class:'day-axis'}, h('span', {text:Admin.formatDate(keys[0])}), h('span', {text:Admin.formatDate(keys[keys.length - 1])}))
    );
  }

  async function render(page){
    const data = await Admin.api('GET', 'api/admin/usage');
    data.days = data.days || {};
    const keys = dayKeys(view.days);
    const routes = totals(data, 'route', keys);
    const misses = totals(data, 'search-miss', keys);
    const noStepFree = totals(data, 'no-step-free', keys);
    const languages = totals(data, 'language', keys);
    const profiles = totals(data, 'profile', keys);
    const modes = totals(data, 'indoor-mode', keys);
    const reports = totals(data, 'report', keys);

    const range = Admin.select([{value:'7', text:'Last 7 days'}, {value:'30', text:'Last 30 days'}, {value:'90', text:'Last 90 days'}, {value:'365', text:'Last year'}], String(view.days), {'aria-label':'Period'});
    range.addEventListener('change', () => { view.days = Number(range.value); Admin.rerender(); });
    page.append(Admin.pageHeader('Insights', 'Anonymous counts from devices that use CampusWay. No names, locations, device ids or times of day are stored.', range));

    if(!data.collecting){
      page.append(h('p', {class:'note note--info', text:'The server was started with --no-usage, so no new counts are collected.'}));
    }

    page.append(h('div', {class:'stat-grid stat-grid--small'},
      h('div', {class:'stat-card'}, h('span', {class:'stat-title', text:'App opens'}), h('strong', {class:'stat-value', text:String(sum(languages))})),
      h('div', {class:'stat-card'}, h('span', {class:'stat-title', text:'Route requests'}), h('strong', {class:'stat-value', text:String(sum(routes))})),
      h('div', {class:`stat-card${sum(misses) ? ' stat-card--warning' : ''}`}, h('span', {class:'stat-title', text:'Searches with no result'}), h('strong', {class:'stat-value', text:String(sum(misses))})),
      h('div', {class:`stat-card${sum(noStepFree) ? ' stat-card--warning' : ''}`}, h('span', {class:'stat-title', text:'No step-free route'}), h('strong', {class:'stat-value', text:String(sum(noStepFree))})),
      h('div', {class:'stat-card'}, h('span', {class:'stat-title', text:'Problem reports'}), h('strong', {class:'stat-value', text:String(sum(reports))}))
    ));

    page.append(dailyChart(data, keys));
    page.append(h('div', {class:'two-col'},
      ranking('Searches with no result', misses, {hint:'What people looked for and did not find: missing rooms, nicknames or spelling to add.', empty:'Every search found something.'}),
      ranking('No step-free route found', noStepFree, {hint:'Destinations where the Mobility profile had no route without stairs.', empty:'None.'})
    ));
    page.append(h('div', {class:'two-col'},
      ranking('Top destinations', routes),
      ranking('Problem reports by type', reports, {names:Object.fromEntries(Object.keys(reports).map(key => {
        const [kind, problem] = key.split(':');
        return [key, `${Admin.KIND_LABELS[kind] || kind}: ${Admin.PROBLEM_LABELS[problem] || problem}`];
      }))})
    ));
    page.append(h('div', {class:'three-col'},
      ranking('Languages', languages, {names:LANGUAGE_NAMES}),
      ranking('Navigation profiles', profiles, {names:PROFILE_NAMES}),
      ranking('Indoor navigation modes', modes, {names:MODE_NAMES})
    ));
    page.append(h('p', {class:'muted', text:'Counts come from CampusWay opened from this server (for example http://localhost:8080 or your Wi-Fi address) and, when the cloud inbox is set up, from the public GitHub Pages site. Route requests include recalculations, such as after changing the profile.'}));
  }

  Admin.register('insights', {title:'Insights', icon:'▤', render});
})();
