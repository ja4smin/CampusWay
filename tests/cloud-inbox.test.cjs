// The cloud inbox Worker (cloud/worker.mjs) and the PC server fetching from it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {test, before, after} = require('node:test');
const {memoryStore} = require('./helpers/cloud-memory-store.cjs');
const {createCampusWayServer} = require('../server/campusway-server');

const root = path.join(__dirname, '..');
const SYNC_KEY = 'test-sync-key-0123456789abcdef';
const PAGES = 'https://ja4smin.github.io';
let worker, store, clock;

before(async () => {
  worker = await import('../cloud/worker.mjs');
});

function app(){
  store = memoryStore();
  clock = {now:Date.parse('2026-10-09T09:00:00Z')};
  return worker.createApp({store, env:{SYNC_KEY, ALLOWED_ORIGINS:`${PAGES},http://localhost:8080`, TIMEZONE:'Asia/Jerusalem'}, now:() => clock.now});
}

function request(method, url, {body, headers = {}} = {}){
  return new Request(`https://inbox.example${url}`, {
    method,
    headers:{...(body !== undefined ? {'Content-Type':'application/json'} : {}), 'CF-Connecting-IP':'198.51.100.7', ...headers},
    body:body !== undefined ? JSON.stringify(body) : undefined
  });
}

async function call(handle, method, url, options){
  const response = await handle(request(method, url, options));
  return {status:response.status, headers:response.headers, data:await response.json().catch(() => null)};
}

test('the public site can send reports; other sites cannot', async () => {
  const handle = app();
  const preflight = await handle(request('OPTIONS', '/api/reports', {headers:{Origin:PAGES}}));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), PAGES);

  const sent = await call(handle, 'POST', '/api/reports', {headers:{Origin:PAGES}, body:{reports:[{id:'rcloud001', kind:'elevator', building:'rabin', problem:'out-of-service', note:'n'.repeat(800)}]}});
  assert.equal(sent.status, 200);
  assert.equal(sent.headers.get('access-control-allow-origin'), PAGES);
  assert.deepEqual(sent.data.accepted, ['rcloud001']);
  assert.equal(JSON.parse(store.reports.get('rcloud001').payload).note.length, 500);

  const foreign = await call(handle, 'POST', '/api/reports', {headers:{Origin:'https://evil.example'}, body:{id:'rcloud002'}});
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  const text = await handle(new Request('https://inbox.example/api/reports', {method:'POST', headers:{'Content-Type':'text/plain', Origin:PAGES}, body:'{}'}));
  assert.equal(text.status, 415);
});

test('reports and counts are rate limited per device, without storing addresses', async () => {
  const handle = app();
  const statuses = [];
  for(let i = 0; i < 32; i += 1){
    statuses.push((await call(handle, 'POST', '/api/reports', {headers:{Origin:PAGES}, body:{id:`rlimit${String(i).padStart(3, '0')}`}})).status);
  }
  assert.equal(statuses.filter(status => status === 200).length, 30);
  assert.equal(statuses.filter(status => status === 429).length, 2);
  assert.ok([...store.hits.keys()].every(bucket => !bucket.includes('198.51.100.7')));
  clock.now += 3600000;
  assert.equal((await call(handle, 'POST', '/api/reports', {headers:{Origin:PAGES}, body:{id:'rlimitnext'}})).status, 200, 'a new hour starts fresh');
});

test('usage counts are grouped by local day and type', async () => {
  const handle = app();
  clock.now = Date.parse('2026-10-09T22:30:00Z'); // already 10 October in Israel
  for(const key of ['Rabin Building', 'rabin building ', 'Main']){
    await call(handle, 'POST', '/api/usage', {headers:{Origin:PAGES}, body:{type:'route', key}});
  }
  await call(handle, 'POST', '/api/usage', {headers:{Origin:PAGES}, body:{type:'report', key:'fake'}});
  const rows = await store.usageRows(10);
  assert.deepEqual(rows.map(row => `${row.day} ${row.type} ${row.key} ${row.count}`).sort(), [
    '2026-10-10 route main 1',
    '2026-10-10 route rabin building 2'
  ]);
});

test('sync needs the key, hands out new reports, and forgets them once confirmed', async () => {
  const handle = app();
  await call(handle, 'POST', '/api/reports', {headers:{Origin:PAGES}, body:{id:'rsync0001', kind:'restroom', problem:'closed', note:'Locked'}});
  await call(handle, 'POST', '/api/usage', {headers:{Origin:PAGES}, body:{type:'search-miss', key:'Lab 9'}});

  assert.equal((await call(handle, 'POST', '/api/sync', {body:{}})).status, 401);
  assert.equal((await call(handle, 'POST', '/api/sync', {body:{}, headers:{Authorization:'Bearer wrong'}})).status, 401);

  const auth = {Authorization:`Bearer ${SYNC_KEY}`};
  const first = await call(handle, 'POST', '/api/sync', {body:{}, headers:auth});
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.reports.map(report => report.note), ['Locked']);
  assert.deepEqual(first.data.usage.map(row => [row.key, row.count]), [['lab 9', 1]]);

  // A new count arrives before the PC confirms the first batch.
  await call(handle, 'POST', '/api/usage', {headers:{Origin:PAGES}, body:{type:'search-miss', key:'Lab 9'}});
  const second = await call(handle, 'POST', '/api/sync', {headers:auth, body:{
    ackReports:['rsync0001'], ackUsage:first.data.usage, statuses:{rsync0001:'resolved'}
  }});
  assert.deepEqual(second.data.reports, []);
  assert.deepEqual(second.data.usage.map(row => [row.key, row.count]), [['lab 9', 1]], 'only the new count is left');
  assert.equal(store.reports.get('rsync0001').payload, null, 'the cloud keeps no report text after delivery');
  const status = await call(handle, 'GET', '/api/reports/status?ids=rsync0001');
  assert.deepEqual(status.data.statuses, {rsync0001:'resolved'});
});

test('sync refuses to run with a short or missing key on the Worker', async () => {
  const handle = worker.createApp({store:memoryStore(), env:{SYNC_KEY:'short', ALLOWED_ORIGINS:PAGES}});
  assert.equal((await call(handle, 'POST', '/api/sync', {body:{}, headers:{Authorization:'Bearer short'}})).status, 503);
});

test('old data is cleaned up', async () => {
  const handle = app();
  await call(handle, 'POST', '/api/reports', {headers:{Origin:PAGES}, body:{id:'rold00001'}});
  clock.now += 91 * 86400000;
  await call(handle, 'POST', '/api/sync', {body:{}, headers:{Authorization:`Bearer ${SYNC_KEY}`}});
  assert.equal(store.reports.has('rold00001'), false);
});

// ── The PC server fetching from a cloud inbox ──

function serveWorker(handle){
  return http.createServer(async (req, res) => {
    const chunks = [];
    for await(const chunk of req) chunks.push(chunk);
    const response = await handle(new Request(`http://127.0.0.1${req.url}`, {
      method:req.method,
      headers:req.headers,
      body:['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks)
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
}

let tmp, pc, cloudServer, pcBase, cloudBase, cookie = '';

async function admin(method, url, body){
  const response = await fetch(pcBase + url, {
    method,
    headers:{'X-CampusWay-Admin':'1', ...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {})},
    body:body !== undefined ? JSON.stringify(body) : undefined
  });
  const set = response.headers.get('set-cookie');
  if(set) cookie = set.split(';')[0];
  return {status:response.status, data:await response.json().catch(() => null)};
}

test('the PC fetches cloud reports, sends statuses back, and does not double count', async t => {
  const handle = app();
  cloudServer = serveWorker(handle);
  await new Promise(resolve => cloudServer.listen(0, '127.0.0.1', resolve));
  cloudBase = `http://127.0.0.1:${cloudServer.address().port}/`;

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'campusway-cloud-'));
  const statusFile = path.join(tmp, 'campus-status.json');
  fs.copyFileSync(path.join(root, 'app/data/campus-status.json'), statusFile);
  ({server:pc} = createCampusWayServer({dbDir:path.join(tmp, 'db'), statusFile}));
  await new Promise(resolve => pc.listen(0, '127.0.0.1', resolve));
  pcBase = `http://127.0.0.1:${pc.address().port}`;
  t.after(() => { pc.close(); cloudServer.close(); fs.rmSync(tmp, {recursive:true, force:true}); });

  await admin('POST', '/api/admin/setup', {username:'boss', password:'a-long-test-password'});
  assert.equal((await admin('POST', '/api/admin/cloud/sync', {})).status, 409, 'not set up yet');
  assert.equal((await admin('PUT', '/api/admin/cloud', {url:'ftp://nope', key:SYNC_KEY})).status, 422);
  const saved = await admin('PUT', '/api/admin/cloud', {url:cloudBase.replace('127.0.0.1', 'localhost'), key:SYNC_KEY});
  assert.equal(saved.status, 200);
  assert.equal(saved.data.test.ok, true);
  assert.equal(saved.data.hasKey, true);
  assert.equal(saved.data.key, undefined, 'the key is never sent back');

  // Phones on the public site send to the cloud.
  await call(handle, 'POST', '/api/reports', {headers:{Origin:PAGES}, body:{reports:[
    {id:'rphone001', kind:'elevator', building:'rabin', connectorId:'elevator2', problem:'out-of-service', note:'Stuck'},
    {id:'rphone002', kind:'restroom', building:'main', problem:'cleaning'}
  ]}});
  for(let i = 0; i < 3; i += 1) await call(handle, 'POST', '/api/usage', {headers:{Origin:PAGES}, body:{type:'route', key:'Rabin Building'}});

  const sync = await admin('POST', '/api/admin/cloud/sync', {});
  assert.equal(sync.status, 200);
  assert.equal(sync.data.result.reports, 2);
  assert.equal(sync.data.result.counts, 3);

  const reports = (await admin('GET', '/api/admin/reports')).data.reports;
  const stuck = reports.find(report => report.id === 'rphone001');
  assert.equal(stuck.via, 'cloud');
  assert.equal(stuck.note, 'Stuck');
  assert.equal(await store.pendingCount(), 0, 'everything was confirmed');

  // Handle the report on the PC; the next sync tells the cloud.
  await admin('PATCH', '/api/admin/reports', {ids:['rphone001'], status:'resolved'});
  const again = await admin('POST', '/api/admin/cloud/sync', {});
  assert.equal(again.data.result.reports, 0);
  assert.equal(again.data.result.counts, 0, 'counts are not fetched twice');
  assert.deepEqual((await call(handle, 'GET', '/api/reports/status?ids=rphone001')).data.statuses, {rphone001:'resolved'});

  const usage = (await admin('GET', '/api/admin/usage')).data;
  const total = Object.values(usage.days).reduce((sum, day) => sum + ((day.route || {})['rabin building'] || 0), 0);
  assert.equal(total, 3);
});

test('a dropped connection does not lose or double count anything', async t => {
  const handle = app();
  let failNext = false;
  const flaky = http.createServer(async (req, res) => {
    const chunks = [];
    for await(const chunk of req) chunks.push(chunk);
    const response = await handle(new Request(`http://127.0.0.1${req.url}`, {method:req.method, headers:req.headers, body:req.method === 'GET' ? undefined : Buffer.concat(chunks)}));
    // Simulate a reply that never arrives after the second sync call was sent.
    if(failNext && req.url === '/api/sync'){ failNext = false; res.destroy(); return; }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => flaky.listen(0, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusway-flaky-'));
  fs.copyFileSync(path.join(root, 'app/data/campus-status.json'), path.join(dir, 'status.json'));
  const {server, db, cloudSync} = createCampusWayServer({dbDir:path.join(dir, 'db'), statusFile:path.join(dir, 'status.json')});
  t.after(() => { flaky.close(); server.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  db.write('cloud', {url:`http://localhost:${flaky.address().port}/`, key:SYNC_KEY});

  await call(handle, 'POST', '/api/usage', {headers:{Origin:PAGES}, body:{type:'route', key:'Main'}});
  await call(handle, 'POST', '/api/reports', {headers:{Origin:PAGES}, body:{id:'rflaky001'}});
  // First call returns the batch; the confirming call fails.
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (...args) => {
    calls += 1;
    if(calls === 2) failNext = true;
    return originalFetch(...args);
  };
  await assert.rejects(cloudSync());
  global.fetch = originalFetch;
  assert.ok(db.read('cloud').pendingAck, 'the unconfirmed batch is remembered');

  await cloudSync();
  const usage = db.read('usage');
  const main = Object.values(usage.days).reduce((sum, day) => sum + ((day.route || {}).main || 0), 0);
  assert.equal(main, 1, 'counted once');
  assert.equal(db.read('reports').filter(report => report.id === 'rflaky001').length, 1);
  assert.equal(await store.pendingCount(), 0);
  assert.equal(db.read('cloud').pendingAck, null);
});

// ── Storage and daily limits ──

test('the inbox refuses new data above its storage cap and daily caps', async () => {
  store = memoryStore();
  clock = {now:Date.parse('2026-10-09T09:00:00Z')};
  const handle = worker.createApp({store, env:{SYNC_KEY, ALLOWED_ORIGINS:PAGES, MAX_DB_MB:'1', REPORTS_PER_DAY:'3', USAGE_PER_DAY:'2'}, now:() => clock.now});
  const send = (id, ip) => call(handle, 'POST', '/api/reports', {headers:{Origin:PAGES, 'CF-Connecting-IP':ip}, body:{id}});

  // Daily cap for the whole inbox, across different devices.
  const results = [];
  for(let i = 0; i < 4; i += 1) results.push((await send(`rdaily00${i}`, `203.0.113.${i}`)).status);
  assert.deepEqual(results, [200, 200, 200, 503]);
  const usage = [];
  for(let i = 0; i < 3; i += 1) usage.push((await call(handle, 'POST', '/api/usage', {headers:{Origin:PAGES, 'CF-Connecting-IP':`203.0.113.${i}`}, body:{type:'route', key:'Main'}})).data.ok);
  assert.deepEqual(usage, [true, true, false]);
  clock.now += 86400000;
  assert.equal((await send('rnextday01', '203.0.113.9')).status, 200, 'a new day starts fresh');

  // Storage cap (1 MB here): new reports are refused, the PC can still fetch.
  store.sizeOverride = 2 * 1024 * 1024;
  const full = await send('rtoobig001', '203.0.113.10');
  assert.equal(full.status, 503);
  assert.match(full.data.error, /storage limit/);
  const sync = await call(handle, 'POST', '/api/sync', {body:{}, headers:{Authorization:`Bearer ${SYNC_KEY}`}});
  assert.equal(sync.status, 200);
  assert.equal(sync.data.stats.dbBytes, 2 * 1024 * 1024);
  assert.equal(sync.data.stats.limits.maxDbBytes, 1024 * 1024);
  assert.equal(sync.data.stats.pendingReports, 4);
  assert.equal(sync.data.stats.reportsToday, 1);
  assert.equal(sync.data.stats.freePlan.storageBytes, 5 * 1024 ** 3);
});

test('the PC stops taking new data at its storage limit and shows its usage', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusway-storage-'));
  fs.copyFileSync(path.join(root, 'app/data/campus-status.json'), path.join(dir, 'status.json'));
  // A tiny limit: 64 KB.
  const {server, db, cloudSync} = createCampusWayServer({dbDir:path.join(dir, 'db'), statusFile:path.join(dir, 'status.json'), maxDataBytes:64 * 1024});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); fs.rmSync(dir, {recursive:true, force:true}); });

  const post = body => fetch(`${base}/api/reports`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  assert.equal((await post({id:'rbefore001'})).status, 200);

  // Fill the data folder past the limit.
  fs.writeFileSync(path.join(dir, 'db', 'filler.bin'), Buffer.alloc(80 * 1024));
  await new Promise(resolve => setTimeout(resolve, 10));
  db.write('cloud', {url:'http://localhost:9/', key:SYNC_KEY});

  let cookie = '';
  const admin = async (method, url, body) => {
    const response = await fetch(base + url, {method, headers:{'X-CampusWay-Admin':'1', ...(body ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {})}, body:body ? JSON.stringify(body) : undefined});
    const set = response.headers.get('set-cookie');
    if(set) cookie = set.split(';')[0];
    return {status:response.status, data:await response.json().catch(() => null)};
  };
  await admin('POST', '/api/admin/setup', {username:'boss', password:'a-long-test-password'});
  const storage = await admin('GET', '/api/admin/storage');
  assert.equal(storage.status, 200);
  assert.equal(storage.data.pc.limitBytes, 64 * 1024);
  assert.equal(storage.data.pc.full, true);
  assert.ok(storage.data.pc.parts.some(part => part.key === 'reports' && part.bytes > 0));
  assert.ok(storage.data.pc.parts.some(part => part.key === 'other' && part.bytes >= 80 * 1024));
  assert.equal(storage.data.cloud.key, undefined);

  // Wait out the 30-second measurement cache by asking for a fresh check.
  const refused = await post({id:'rafter0001'});
  assert.equal(refused.status, 507);
  await assert.rejects(cloudSync(), /storage limit/);
  assert.match(db.read('cloud').lastError, /storage limit/);
});
