// CampusWay admin: run the automated tests (tests/*.test.cjs) on this PC and
// see how many pass and fail, file by file, with the error of each failure.
(function(){
  'use strict';
  const {h, clear} = Admin;

  const view = {onlyFailures:false, open:new Set()};
  let poll = null;

  const seconds = ms => Number.isFinite(ms) ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s` : '—';

  function statCard(title, value, kind = ''){
    return h('div', {class:`stat-card${kind ? ` stat-card--${kind}` : ''}`},
      h('span', {class:'stat-title', text:title}),
      h('strong', {class:'stat-value', text:String(value)})
    );
  }

  function summary(run, running){
    const totals = run.totals || {};
    const box = h('div', {class:'stack'});
    const headline = running
      ? h('div', {class:'test-banner test-banner--running', role:'status'}, h('span', {class:'spinner', 'aria-hidden':'true'}), `Running… ${totals.done || 0} of ${totals.files || 0} files done`)
      : run.status === 'passed'
        ? h('div', {class:'test-banner test-banner--passed', role:'status'}, `✓ All ${totals.tests} tests passed`)
        : run.status === 'error'
          ? h('div', {class:'test-banner test-banner--failed', role:'alert'}, `The test run stopped: ${run.error || 'unknown error'}`)
          : h('div', {class:'test-banner test-banner--failed', role:'alert'}, `✕ ${totals.fail} of ${totals.tests} tests failed`);
    box.append(headline);
    if(running){
      const percent = totals.files ? totals.done / totals.files * 100 : 0;
      box.append(h('div', {class:'gauge-track'}, h('div', {class:'gauge-fill', style:{width:`${percent}%`}})));
    }
    box.append(h('div', {class:'stat-grid stat-grid--small'},
      statCard('Tests', totals.tests ?? 0),
      statCard('Passed', totals.pass ?? 0, totals.pass ? 'success' : ''),
      statCard('Failed', totals.fail ?? 0, totals.fail ? 'danger' : ''),
      statCard('Skipped', totals.skipped ?? 0),
      statCard('Files', `${totals.done ?? 0}/${totals.files ?? 0}`),
      statCard('Time', running ? '…' : seconds(run.durationMs))
    ));
    box.append(h('p', {class:'muted', text:`${running ? 'Started' : 'Last run'} ${Admin.relative(run.startedAt)} · Node.js ${run.node || ''}`}));
    return box;
  }

  function fileRow(file){
    const counts = file.counts || {};
    const state = {waiting:['waiting', 'muted'], running:['running', 'info'], passed:['passed', 'success'], failed:['failed', 'danger']}[file.status] || [file.status, 'neutral'];
    const tests = (file.tests || []).filter(test => !view.onlyFailures || !test.ok);
    const details = h('details', {class:`test-file test-file--${file.status}`, open:view.open.has(file.file) || undefined});
    details.addEventListener('toggle', () => { details.open ? view.open.add(file.file) : view.open.delete(file.file); });
    details.append(h('summary', {},
      Admin.badge(state[0], state[1]),
      h('code', {class:'test-file-name', text:file.file}),
      h('span', {class:'test-file-counts', text:file.counts ? `${counts.pass} passed${counts.fail ? ` · ${counts.fail} failed` : ''}${counts.skipped ? ` · ${counts.skipped} skipped` : ''} · ${seconds(file.durationMs)}` : ''})
    ));
    if(file.counts){
      if(file.status === 'failed' && file.diagnostics){
        details.append(h('pre', {class:'code code--scroll test-error', text:file.diagnostics}));
      }
      details.append(h('ul', {class:'test-list'}, tests.map(test => h('li', {class:test.ok ? 'test-ok' : 'test-fail'},
        h('span', {class:'test-mark', 'aria-hidden':'true', text:test.skipped ? '–' : test.ok ? '✓' : '✕'}),
        h('span', {class:'test-name', text:`${test.name}${test.skipped ? ' (skipped)' : test.todo ? ' (to do)' : ''}`}),
        Number.isFinite(test.durationMs) ? h('span', {class:'muted test-time', text:`${test.durationMs < 1 ? '<1' : Math.round(test.durationMs)} ms`}) : null,
        test.error ? h('pre', {class:'code code--scroll test-error', text:test.error}) : null
      ))));
      if(!tests.length) details.append(h('p', {class:'muted', text:'No failures in this file.'}));
      if(file.output){
        details.append(h('details', {class:'test-raw'}, h('summary', {text:'Raw output'}), h('pre', {class:'code code--scroll', text:file.output})));
      }
    }
    return details;
  }

  function results(run){
    const files = (run.files || []).slice().sort((a, b) => {
      const order = {failed:0, running:1, waiting:2, passed:3};
      return (order[a.status] ?? 4) - (order[b.status] ?? 4) || a.file.localeCompare(b.file);
    });
    const shown = view.onlyFailures ? files.filter(file => file.status !== 'passed') : files;
    return h('div', {class:'test-files'}, shown.length ? shown.map(fileRow) : Admin.empty('No failures.'));
  }

  function draw(host, data){
    clear(host);
    const run = data.run;
    if(!run){
      host.append(Admin.empty(`${data.files.length} test files are ready. Press “Run tests” to run them on this PC.`));
      return;
    }
    host.append(summary(run, data.running));
    const toggle = h('label', {class:'inline-check'}, h('input', {type:'checkbox', checked:view.onlyFailures, onchange:event => { view.onlyFailures = event.target.checked; draw(host, data); }}), ' Show only failures');
    host.append(h('div', {class:'toolbar'}, toggle,
      h('button', {type:'button', class:'link-btn', onclick:() => { (run.files || []).forEach(file => view.open.add(file.file)); draw(host, data); }}, 'Expand all'),
      h('button', {type:'button', class:'link-btn', onclick:() => { view.open.clear(); draw(host, data); }}, 'Collapse all')
    ));
    host.append(results(run));
  }

  function stopPolling(){
    if(poll){ clearTimeout(poll); poll = null; }
  }

  async function refresh(host, button){
    let data;
    try{
      data = await Admin.api('GET', 'api/admin/tests');
    }catch(error){
      stopPolling();
      Admin.toast(error.message, 'error');
      return;
    }
    if(!host.isConnected){ stopPolling(); return; }
    // Failed files open by themselves so their errors are visible at once.
    (data.run && data.run.files || []).forEach(file => { if(file.status === 'failed' && !view.seen?.has(file.file)){ view.open.add(file.file); (view.seen = view.seen || new Set()).add(file.file); } });
    draw(host, data);
    button.disabled = data.running;
    button.textContent = data.running ? 'Running…' : 'Run tests';
    stopPolling();
    if(data.running) poll = setTimeout(() => refresh(host, button), 700);
  }

  async function render(page){
    stopPolling();
    const host = h('div', {class:'stack'});
    const button = h('button', {type:'button', class:'btn btn-primary btn-sm'}, 'Run tests');
    button.addEventListener('click', async () => {
      button.disabled = true;
      view.seen = new Set();
      view.open.clear();
      try{
        await Admin.api('POST', 'api/admin/tests/run', {});
      }catch(error){
        Admin.toast(error.message, 'error');
      }
      refresh(host, button);
    });
    page.append(Admin.pageHeader('Tests',
      'Runs CampusWay’s automated tests (the tests folder) on this PC: routing, search, sensors, journeys, the admin server and the cloud inbox. Nothing is changed by a test run.',
      button));
    page.append(host);
    await refresh(host, button);
  }

  Admin.register('tests', {title:'Tests', icon:'✓✓', render, visible:() => Admin.can('tests')});
})();
