// Runs CampusWay's automated tests (tests/*.test.cjs) for the admin screen.
//
// Each test file runs in its own Node.js process with the built-in test runner
// and its TAP output is turned into counts and per-test results. Only the
// fixed files in tests/ are run, with no shell and no input from the request.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');

const FILE_TIMEOUT_MS = 120000;
const PARALLEL = 4;
const MAX_OUTPUT = 400 * 1024;

function testFiles(root){
  const folder = path.join(root, 'tests');
  return fs.readdirSync(folder)
    .filter(name => /^[\w.-]+\.test\.cjs$/.test(name))
    .sort()
    .map(name => `tests/${name}`);
}

// Reads the top-level results and the summary from Node's TAP reporter.
function parseTap(output){
  const lines = output.split(/\r?\n/);
  const tests = [];
  const summary = {};
  const diagnostics = [];
  for(let i = 0; i < lines.length; i += 1){
    const line = lines[i];
    const result = line.match(/^(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/);
    if(result){
      // TAP escapes "#" and "\" in names.
      const name = result[2].replace(/\\#/g, '#').replace(/\\\\/g, '\\');
      const test = {name, ok:result[1] === 'ok', skipped:result[3] === 'SKIP', todo:result[3] === 'TODO', durationMs:null, error:''};
      // The YAML block that follows ("  ---" … "  ...").
      if(lines[i + 1] === '  ---'){
        const block = [];
        let j = i + 2;
        while(j < lines.length && lines[j] !== '  ...'){ block.push(lines[j]); j += 1; }
        i = j;
        const duration = block.find(item => /^ {2}duration_ms:/.test(item));
        if(duration) test.durationMs = Number(duration.split(':')[1]);
        if(!test.ok){
          // Keep the useful part of the failure: the message first, then the rest.
          const useful = block.filter(item => !/^ {2}(duration_ms|type):/.test(item)).map(item => item.replace(/^ {2}/, ''));
          const start = useful.findIndex(item => /^error:/.test(item));
          const ordered = start > 0 ? [...useful.slice(start), ...useful.slice(0, start)] : useful;
          test.error = ordered.join('\n').trim().slice(0, 4000);
        }
      }
      tests.push(test);
      continue;
    }
    const total = line.match(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/);
    if(total){ summary[total[1]] = Number(total[2]); continue; }
    // Other "# " lines are what the file printed, e.g. the error when it cannot load.
    if(/^#( |$)/.test(line) && !/^# Subtest: /.test(line)) diagnostics.push(line.replace(/^# ?/, '').replace(/\\\\/g, '\\'));
  }
  return {tests, summary, diagnostics:diagnostics.join('\n').trim().slice(0, 6000)};
}

function runFile(root, file){
  return new Promise(resolve => {
    const started = Date.now();
    const env = {...process.env, NODE_ENV:'test', FORCE_COLOR:'0', NO_COLOR:'1'};
    // Set when this code itself runs under "node --test"; it would switch the
    // child to an internal output format instead of TAP.
    delete env.NODE_TEST_CONTEXT;
    execFile(process.execPath, ['--test', '--test-reporter=tap', file], {
      cwd:root,
      timeout:FILE_TIMEOUT_MS,
      maxBuffer:4 * 1024 * 1024,
      windowsHide:true,
      env
    }, (error, stdout, stderr) => {
      const output = String(stdout || '');
      const {tests, summary, diagnostics} = parseTap(output);
      // A file that reports no results at all is treated as a failure, never as a pass.
      const failedToRun = !tests.length;
      const timedOut = Boolean(error && error.killed);
      const counts = {
        tests:summary.tests ?? tests.length,
        pass:summary.pass ?? tests.filter(test => test.ok && !test.skipped && !test.todo).length,
        fail:summary.fail ?? tests.filter(test => !test.ok).length,
        skipped:(summary.skipped ?? tests.filter(test => test.skipped).length) + (summary.todo ?? 0),
        cancelled:summary.cancelled ?? 0
      };
      if(failedToRun || timedOut){
        counts.fail = Math.max(counts.fail, 1);
        tests.push({
          name:timedOut ? `The file did not finish within ${FILE_TIMEOUT_MS / 1000} seconds` : error ? 'The file could not run' : 'The file reported no test results',
          ok:false, skipped:false, todo:false, durationMs:null,
          error:String(stderr || (error && error.message) || diagnostics || 'No output.').trim().slice(0, 4000)
        });
      }
      resolve({
        file,
        ok:counts.fail === 0 && counts.cancelled === 0 && !failedToRun && !timedOut,
        counts,
        durationMs:Date.now() - started,
        diagnostics,
        tests,
        output:(output + (stderr ? `\n--- stderr ---\n${stderr}` : '')).slice(-MAX_OUTPUT)
      });
    });
  });
}

// onProgress(run) is called after each file finishes.
async function runTests(root, onProgress = () => {}){
  const files = testFiles(root);
  const run = {
    status:'running',
    startedAt:new Date().toISOString(),
    finishedAt:null,
    node:process.version,
    files:files.map(file => ({file, status:'waiting'})),
    totals:{files:files.length, done:0, tests:0, pass:0, fail:0, skipped:0, cancelled:0}
  };
  onProgress(run);
  let next = 0;
  const worker = async () => {
    while(next < files.length){
      const index = next;
      next += 1;
      run.files[index] = {file:files[index], status:'running'};
      onProgress(run);
      const result = await runFile(root, files[index]);
      run.files[index] = {...result, status:result.ok ? 'passed' : 'failed'};
      run.totals.done += 1;
      ['tests', 'pass', 'fail', 'skipped', 'cancelled'].forEach(key => { run.totals[key] += result.counts[key] || 0; });
      onProgress(run);
    }
  };
  await Promise.all(Array.from({length:Math.min(PARALLEL, files.length)}, worker));
  run.status = run.totals.fail || run.totals.cancelled || run.files.some(file => file.status === 'failed') ? 'failed' : 'passed';
  run.finishedAt = new Date().toISOString();
  run.durationMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  onProgress(run);
  return run;
}

module.exports = {runTests, parseTap, testFiles};
