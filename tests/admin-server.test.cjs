const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {test, before, after} = require('node:test');
const {createCampusWayServer, extractObjectLiteral} = require('../server/campusway-server');

const root = path.join(__dirname, '..');
let tmp, server, base;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'campusway-admin-'));
  const statusFile = path.join(tmp, 'campus-status.json');
  fs.copyFileSync(path.join(root, 'app/data/campus-status.json'), statusFile);
  ({server} = createCampusWayServer({dbDir:path.join(tmp, 'db'), statusFile}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, {recursive:true, force:true});
});

// A tiny client that keeps the session cookie.
function client(){
  let cookie = '';
  return async function call(method, url, body, headers = {}){
    const response = await fetch(base + url, {
      method,
      headers:{
        ...(body !== undefined ? {'Content-Type':'application/json'} : {}),
        'X-CampusWay-Admin':'1',
        ...(cookie ? {Cookie:cookie} : {}),
        ...headers
      },
      body:body !== undefined ? JSON.stringify(body) : undefined
    });
    const set = response.headers.get('set-cookie');
    if(set) cookie = set.split(';')[0];
    let data = null;
    try{ data = await response.json(); }catch(error){ /* not JSON */ }
    return {status:response.status, data};
  };
}

const password = `pw-${Math.random().toString(36).slice(2)}`;
const admin = client();

test('first run asks for an administrator and creates one', async () => {
  const session = await admin('GET', '/api/admin/session');
  assert.equal(session.data.needsSetup, true);
  const setup = await admin('POST', '/api/admin/setup', {username:'Boss', displayName:'Boss', password});
  assert.equal(setup.status, 200);
  assert.equal(setup.data.user.username, 'boss');
  assert.equal(setup.data.user.salt, undefined, 'password data never leaves the server');
  const again = await client()('POST', '/api/admin/setup', {username:'other', password});
  assert.equal(again.status, 409);
});

test('passwords are stored hashed', () => {
  const users = JSON.parse(fs.readFileSync(path.join(tmp, 'db/users.json'), 'utf8'));
  assert.equal(users.length, 1);
  assert.ok(users[0].hash && users[0].salt);
  assert.ok(!JSON.stringify(users).includes(password));
});

test('admin API needs a session and the admin header', async () => {
  const anonymous = client();
  assert.equal((await anonymous('GET', '/api/admin/reports')).status, 401);
  assert.equal((await anonymous('POST', '/api/admin/login', {username:'boss', password:'wrong-password'})).status, 401);
  const noHeader = await fetch(`${base}/api/admin/logout`, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  assert.equal(noHeader.status, 403);
  const login = await anonymous('POST', '/api/admin/login', {username:'BOSS', password});
  assert.equal(login.status, 200);
});

test('the app can send reports without signing in, and duplicates are ignored', async () => {
  const report = {id:'rtest123456', time:Date.now(), kind:'elevator', building:'rabin', buildingName:'Rabin Building', connectorId:'elevator2', label:'Elevator 2', problem:'out-of-service', note:'x'.repeat(900)};
  const sent = await fetch(`${base}/api/reports`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reports:[report, report]})});
  assert.equal(sent.status, 200);
  const list = await admin('GET', '/api/admin/reports');
  const stored = list.data.reports.filter(item => item.id === 'rtest123456');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, 'new');
  assert.equal(stored[0].note.length, 500, 'notes are capped');
  const status = await fetch(`${base}/api/reports/status?ids=rtest123456,unknown`).then(response => response.json());
  assert.deepEqual(status.statuses, {rtest123456:'new'});
});

test('reports refuse cross-site posts and non-JSON bodies', async () => {
  const cross = await fetch(`${base}/api/reports`, {method:'POST', headers:{'Content-Type':'application/json', Origin:'https://evil.example'}, body:'{}'});
  assert.equal(cross.status, 403);
  const form = await fetch(`${base}/api/reports`, {method:'POST', headers:{'Content-Type':'text/plain'}, body:'{}'});
  assert.equal(form.status, 415);
});

test('report updates keep a history and timing', async () => {
  const update = await admin('PATCH', '/api/admin/reports', {ids:['rtest123456'], status:'acknowledged', assignee:'Dana', comment:'Checking'});
  assert.equal(update.status, 200);
  const report = update.data.reports[0];
  assert.equal(report.status, 'acknowledged');
  assert.equal(report.assignee, 'Dana');
  assert.ok(report.firstResponseAt);
  assert.equal(report.history.at(-1).to, 'acknowledged');
  assert.equal(report.history.at(-1).note, 'Checking');
});

test('usage counts are aggregated per day without identifiers', async () => {
  for(const key of ['Rabin Building', 'Rabin Building', 'Main Building']){
    await fetch(`${base}/api/usage`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type:'route', key})});
  }
  await fetch(`${base}/api/usage`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type:'report', key:'fake'})});
  const usage = await admin('GET', '/api/admin/usage');
  const day = Object.values(usage.data.days)[0];
  assert.equal(day.route['rabin building'], 2);
  assert.equal(day.route['main building'], 1);
  assert.equal(day.report['elevator:out-of-service'], 1, 'only the server counts reports');
  assert.equal(day.report.fake, undefined);
});

test('saving the status validates it, keeps a backup and writes the file', async () => {
  const current = await admin('GET', '/api/admin/status');
  const status = {...current.data.status, elevators:[{building:'rabin', elevator:'2', from:'2026-01-01', until:'2099-01-01', note:'Maintenance'}]};
  const bad = await admin('PUT', '/api/admin/status', {status:{...status, closures:[{building:'main', nodeIds:['no_such_node']}]}, version:current.data.version});
  assert.equal(bad.status, 422);
  assert.match(bad.data.errors.join(' '), /unknown node/);

  const saved = await admin('PUT', '/api/admin/status', {status, version:current.data.version});
  assert.equal(saved.status, 200);
  const file = JSON.parse(fs.readFileSync(path.join(tmp, 'campus-status.json'), 'utf8'));
  assert.equal(file.elevators[0].elevator, '2');
  assert.ok(Array.isArray(file._help));
  assert.equal(fs.readdirSync(path.join(tmp, 'db/status-history')).length, 1);

  const stale = await admin('PUT', '/api/admin/status', {status, version:current.data.version});
  assert.equal(stale.status, 409, 'an outdated version is refused');
});

test('roles limit which parts of the status can change', async () => {
  const created = await admin('POST', '/api/admin/users', {username:'editor', displayName:'Editor', role:'content', password});
  assert.equal(created.status, 200);
  const editor = client();
  assert.equal((await editor('POST', '/api/admin/login', {username:'editor', password})).status, 200);
  const current = await editor('GET', '/api/admin/status');
  const blocked = await editor('PUT', '/api/admin/status', {status:{...current.data.status, elevators:[]}, version:current.data.version});
  assert.equal(blocked.status, 403);
  const allowed = await editor('PUT', '/api/admin/status', {status:{...current.data.status, names:{'Cafe Aguda':{ar:'مقهى أغودا'}}}, version:current.data.version});
  assert.equal(allowed.status, 200);
  assert.equal((await editor('GET', '/api/admin/users')).status, 403);
  assert.equal((await editor('PATCH', '/api/admin/reports', {ids:['rtest123456'], status:'resolved'})).status, 403);
});

test('the last administrator cannot be removed', async () => {
  const users = await admin('GET', '/api/admin/users');
  const boss = users.data.users.find(user => user.username === 'boss');
  const result = await admin('PATCH', `/api/admin/users/${boss.id}`, {role:'content'});
  assert.equal(result.status, 409);
});

test('the server never serves the database or server code', async () => {
  for(const url of ['/server/db/users.json', '/server/campusway-server.js', '/.git/config', '/../package.json']){
    const response = await fetch(base + url);
    assert.equal(response.status, 404, url);
  }
  const page = await fetch(`${base}/admin.html`);
  assert.equal(page.status, 200);
  const status = await fetch(`${base}/app/data/campus-status.json`).then(response => response.json());
  assert.equal(status.elevators[0].elevator, '2', 'the app reads the file the server edits');
});

test('built-in names are read from the source without running it', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const names = extractObjectLiteral(index, 'BUILDING_NAMES_RU');
  assert.ok(names && names['Main Building']);
  assert.equal(extractObjectLiteral('const X = {a: process.exit(1)};', 'X'), null);
});

// ── Security ──

test('only the public app files are served, however the path is spelled', async () => {
  const blocked = [
    '/server/db/users.json', '/Server/db/users.json', '/SERVER/db/cloud.json', '/sErVeR/campusway-server.js',
    '/server%5Cdb%5Cusers.json', '/app%5C..%5Cserver%5Cdb%5Cusers.json', '/app%5C..%5C.git%5Cconfig',
    '/app/../server/db/users.json', '/app/%2e%2e/server/db/users.json', '/.git/config', '/.gitignore',
    '/server./db/users.json', '/SERVER~1/db/users.json', '/index.html::$DATA', '/C:/Windows/win.ini',
    '/tests/admin-server.test.cjs', '/cloud/wrangler.toml', '/docs/README.md', '/README.md', '/app/data/campus-status.json%00.png'
  ];
  for(const url of blocked){
    const response = await fetch(base + url);
    assert.equal(response.status, 404, url);
  }
  for(const url of ['/', '/index.html', '/admin.html', '/app/ui/campus-status.js', '/buildings/main/main-indoor-graph.json', '/wayframe/navigation-demo.html']){
    assert.equal((await fetch(base + url)).status, 200, url);
  }
  const redirect = await fetch(`${base}//app`, {redirect:'manual'});
  assert.ok(redirect.status === 404 || !String(redirect.headers.get('location') || '').startsWith('//'), 'no redirect to another host');
});

test('requests for other host names are refused (DNS rebinding)', async () => {
  const http = require('node:http');
  const status = await new Promise((resolve, reject) => {
    const port = new URL(base).port;
    http.get({host:'127.0.0.1', port, path:'/index.html', headers:{Host:'evil.example:' + port}}, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(status, 421);
});

test('the admin page is protected by a strict content security policy', async () => {
  const response = await fetch(`${base}/admin.html`);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  const html = await response.text();
  assert.ok(!/<script>(?!<\/script>)[^<]/.test(html), 'no inline scripts');
});

test('markup from the public is removed from reports and refused in the status file', async () => {
  const sent = await fetch(`${base}/api/reports`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:'rxss000001', note:'Blocked <img src=x onerror=alert(1)>', label:'<b>Path</b>'})});
  assert.equal(sent.status, 200);
  const list = await admin('GET', '/api/admin/reports');
  const report = list.data.reports.find(item => item.id === 'rxss000001');
  assert.ok(!/[<>]/.test(report.note + report.label));

  const current = await admin('GET', '/api/admin/status');
  const bad = await admin('PUT', '/api/admin/status', {version:current.data.version, status:{...current.data.status,
    closures:[{area:[[32.761, 35.019], [32.762, 35.019], [32.762, 35.020]], reason:'<img src=x onerror=alert(1)>'}],
    names:{'Main Building':{he:'<svg onload=alert(1)>'}}
  }});
  assert.equal(bad.status, 422);
  assert.match(bad.data.errors.join(' '), /< and > are not allowed/);
});

test('administrators can run the automated tests and see passes and failures', async t => {
  // A separate project folder with two small test files, so this test does not run the whole suite.
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'campusway-tests-'));
  fs.mkdirSync(path.join(fake, 'tests'));
  fs.writeFileSync(path.join(fake, 'tests', 'good.test.cjs'), "const {test} = require('node:test'); test('works', () => {});\n");
  fs.writeFileSync(path.join(fake, 'tests', 'bad.test.cjs'), "const {test} = require('node:test'); const assert = require('node:assert'); test('breaks', () => assert.strictEqual(1, 2));\n");
  fs.copyFileSync(path.join(root, 'app/data/campus-status.json'), path.join(fake, 'status.json'));
  const {server:local} = createCampusWayServer({root:fake, dbDir:path.join(fake, 'db'), statusFile:path.join(fake, 'status.json')});
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  const localBase = `http://127.0.0.1:${local.address().port}`;
  t.after(() => { local.close(); fs.rmSync(fake, {recursive:true, force:true}); });

  let cookie = '';
  const call = async (method, url, body) => {
    const response = await fetch(localBase + url, {method, headers:{'X-CampusWay-Admin':'1', ...(body ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {})}, body:body ? JSON.stringify(body) : undefined});
    const set = response.headers.get('set-cookie');
    if(set) cookie = set.split(';')[0];
    return {status:response.status, data:await response.json().catch(() => null)};
  };
  await call('POST', '/api/admin/setup', {username:'boss', password:'a-long-test-password'});
  assert.deepEqual((await call('GET', '/api/admin/tests')).data.files, ['tests/bad.test.cjs', 'tests/good.test.cjs']);
  assert.equal((await call('POST', '/api/admin/tests/run', {})).status, 200);
  assert.equal((await call('POST', '/api/admin/tests/run', {})).status, 409, 'one run at a time');

  let data;
  for(let i = 0; i < 100; i += 1){
    data = (await call('GET', '/api/admin/tests')).data;
    if(!data.running) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(data.run.status, 'failed');
  assert.deepEqual({tests:data.run.totals.tests, pass:data.run.totals.pass, fail:data.run.totals.fail}, {tests:2, pass:1, fail:1});
  const bad = data.run.files.find(file => file.file === 'tests/bad.test.cjs');
  assert.equal(bad.tests[0].name, 'breaks');
  assert.match(bad.tests[0].error, /error:/);

  // Other roles cannot run tests.
  await call('POST', '/api/admin/users', {username:'editor', role:'content', password:'a-long-test-password'});
  cookie = '';
  await call('POST', '/api/admin/login', {username:'editor', password:'a-long-test-password'});
  assert.equal((await call('GET', '/api/admin/tests')).status, 403);
  assert.equal((await call('POST', '/api/admin/tests/run', {})).status, 403);
});
