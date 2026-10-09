// Live status without commits: the admin screen publishes the status to the
// cloud inbox when it is saved, and the public app reads it from there.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test, before} = require('node:test');
const {memoryStore} = require('./helpers/cloud-memory-store.cjs');
const {createCampusWayServer} = require('../server/campusway-server');

const root = path.join(__dirname, '..');
const SYNC_KEY = 'test-sync-key-0123456789abcdef';
const PAGES = 'https://ja4smin.github.io';
let worker;

before(async () => {
  worker = await import('../cloud/worker.mjs');
});

function inbox(){
  const store = memoryStore();
  const clock = {now:Date.parse('2026-10-09T09:00:00Z')};
  const handle = worker.createApp({store, env:{SYNC_KEY, ALLOWED_ORIGINS:PAGES}, now:() => clock.now});
  const call = async (method, url, {body, headers = {}} = {}) => {
    const response = await handle(new Request(`https://inbox.example${url}`, {
      method, headers:{...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...headers},
      body:body !== undefined ? JSON.stringify(body) : undefined
    }));
    return {status:response.status, headers:response.headers, data:await response.json().catch(() => null)};
  };
  return {store, clock, handle, call};
}

// ── The inbox ──

test('the inbox keeps the live status: only the PC can publish, everyone can read the latest', async () => {
  const {clock, call} = inbox();
  const auth = {Authorization:`Bearer ${SYNC_KEY}`};
  assert.deepEqual((await call('GET', '/api/status')).data, {status:null, updatedAt:null});
  assert.equal((await call('PUT', '/api/status', {body:{status:{announcements:[]}}})).status, 401);
  assert.equal((await call('PUT', '/api/status', {body:{status:[1, 2]}, headers:auth})).status, 422);
  await call('PUT', '/api/status', {headers:auth, body:{status:{_help:['notes'], announcements:[{id:'a1', text:{en:'First'}}]}}});
  clock.now += 1000;
  await call('PUT', '/api/status', {headers:auth, body:{status:{_help:['notes'], announcements:[{id:'a2', text:{en:'Second'}}]}}});
  const read = await call('GET', '/api/status', {headers:{Origin:PAGES}});
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('access-control-allow-origin'), PAGES, 'the public site may read it');
  assert.deepEqual(read.data.status, {announcements:[{id:'a2', text:{en:'Second'}}]}, 'latest wins, notes dropped');
  assert.equal(read.data.updatedAt, clock.now);
  const huge = await call('PUT', '/api/status', {headers:auth, body:{status:{names:{x:{he:'a'.repeat(300 * 1024)}}}}});
  assert.equal(huge.status, 413);
});

// ── The PC publishes on save ──

test('saving in the admin publishes the live status; when the inbox is down it retries on the next fetch', async t => {
  const cloud = inbox();
  let down = false;
  const cloudServer = http.createServer(async (req, res) => {
    if(down){ res.destroy(); return; }
    const chunks = [];
    for await(const chunk of req) chunks.push(chunk);
    const response = await cloud.handle(new Request(`http://127.0.0.1${req.url}`, {
      method:req.method, headers:req.headers,
      body:['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks)
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => cloudServer.listen(0, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusway-live-'));
  fs.copyFileSync(path.join(root, 'app/data/campus-status.json'), path.join(dir, 'status.json'));
  const {server, db, cloudSync} = createCampusWayServer({dbDir:path.join(dir, 'db'), statusFile:path.join(dir, 'status.json')});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); cloudServer.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  db.write('cloud', {url:`http://localhost:${cloudServer.address().port}/`, key:SYNC_KEY});

  let cookie = '';
  const admin = async (method, url, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers:{'X-CampusWay-Admin':'1', ...(body ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {})},
      body:body ? JSON.stringify(body) : undefined
    });
    const set = response.headers.get('set-cookie');
    if(set) cookie = set.split(';')[0];
    return {status:response.status, data:await response.json().catch(() => null)};
  };
  await admin('POST', '/api/admin/setup', {username:'boss', password:'a-long-test-password'});
  const announce = async text => {
    const current = (await admin('GET', '/api/admin/status')).data;
    return admin('PUT', '/api/admin/status', {version:current.version, status:{...current.status, announcements:[{id:'a1', severity:'info', text:{en:text}}]}});
  };
  const published = async () => (await cloud.call('GET', '/api/status')).data.status;

  const saved = await announce('Library closes early today');
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.live, {state:'live'});
  assert.equal((await published()).announcements[0].text.en, 'Library closes early today');
  assert.equal((await published())._help, undefined, 'the file’s notes are not published');
  assert.equal((await admin('GET', '/api/admin/overview')).data.cloud.liveUpToDate, true);

  down = true;
  const offline = await announce('Path behind the library is closed');
  assert.equal(offline.status, 200, 'the save itself still works');
  assert.equal(offline.data.live.state, 'failed');
  assert.equal((await admin('GET', '/api/admin/overview')).data.cloud.liveUpToDate, false);
  assert.equal((await published()).announcements[0].text.en, 'Library closes early today');

  down = false;
  await cloudSync();
  assert.equal((await published()).announcements[0].text.en, 'Path behind the library is closed');
  assert.equal((await admin('GET', '/api/admin/overview')).data.cloud.liveUpToDate, true);

  // "Publish now" button.
  const manual = await admin('POST', '/api/admin/cloud/publish', {});
  assert.equal(manual.data.live.state, 'live');
});

test('without a cloud inbox, saving still works and nothing is published', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusway-nolive-'));
  fs.copyFileSync(path.join(root, 'app/data/campus-status.json'), path.join(dir, 'status.json'));
  const {server} = createCampusWayServer({dbDir:path.join(dir, 'db'), statusFile:path.join(dir, 'status.json')});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const admin = async (method, url, body) => {
    const response = await fetch(base + url, {method, headers:{'X-CampusWay-Admin':'1', ...(body ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {})}, body:body ? JSON.stringify(body) : undefined});
    const set = response.headers.get('set-cookie');
    if(set) cookie = set.split(';')[0];
    return {status:response.status, data:await response.json().catch(() => null)};
  };
  await admin('POST', '/api/admin/setup', {username:'boss', password:'a-long-test-password'});
  const current = (await admin('GET', '/api/admin/status')).data;
  const saved = await admin('PUT', '/api/admin/status', {version:current.version, status:{...current.status, announcements:[{id:'a1', text:{en:'Hello'}}]}});
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.live, {state:'off'});
});

// ── The app reads it ──

const appSource = fs.readFileSync(path.join(root, 'app/ui/campus-status.js'), 'utf8');

function storage(){
  const data = new Map();
  return {getItem:key => data.has(key) ? data.get(key) : null, setItem:(key, value) => data.set(key, String(value)), removeItem:key => data.delete(key)};
}

function appWith({fileStatus, cloudStatus, hostname = 'ja4smin.github.io', cloudUp = true}){
  const requests = [];
  const pages = hostname.endsWith('github.io');
  const context = {
    localStorage:storage(), sessionStorage:storage(),
    location:pages ? {href:`https://${hostname}/CampusWay/index.html`, protocol:'https:', hostname} : {href:`http://${hostname}:8080/index.html`, protocol:'http:', hostname},
    URL, console, setTimeout,
    fetch:async url => {
      const href = String(url);
      requests.push(href);
      if(href.endsWith('campus-status.json')) return {ok:true, json:async () => fileStatus};
      if(href === 'https://inbox.example/api/health') return cloudUp ? {ok:true, json:async () => ({app:'campusway', cloud:true})} : {ok:false, json:async () => ({})};
      if(href === 'https://inbox.example/api/status') return {ok:true, json:async () => ({status:cloudStatus, updatedAt:1})};
      if(href.endsWith('/api/health')) return {ok:true, json:async () => ({app:'campusway'})};
      return {ok:false, json:async () => ({})};
    }
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(appSource, context);
  return {CampusStatus:context.CampusStatus, requests};
}

const FILE = {reportEndpoint:'https://inbox.example/', announcements:[]};
const PUBLISHED = [{id:'a1', severity:'warning', text:{en:'Published from the admin'}}];
const shown = CampusStatus => CampusStatus.activeAnnouncements().map(item => item.text.en);

test('the public site shows what the admin published, without a commit', async () => {
  const {CampusStatus} = appWith({fileStatus:FILE, cloudStatus:{...FILE, announcements:PUBLISHED, emergency:{active:true}}});
  await CampusStatus.load('app/data/campus-status.json');
  assert.deepEqual(shown(CampusStatus), ['Published from the admin']);
  assert.equal(CampusStatus.emergencyActive, true);
});

test('if the inbox has nothing yet or cannot be reached, the status file is used', async () => {
  const fromFile = {...FILE, announcements:[{id:'f', text:{en:'From the file'}}]};
  const empty = appWith({fileStatus:fromFile, cloudStatus:null});
  await empty.CampusStatus.load('app/data/campus-status.json');
  assert.deepEqual(shown(empty.CampusStatus), ['From the file']);
  const down = appWith({fileStatus:fromFile, cloudStatus:{announcements:PUBLISHED}, cloudUp:false});
  await down.CampusStatus.load('app/data/campus-status.json');
  assert.deepEqual(shown(down.CampusStatus), ['From the file']);
});

test('opened from the PC server, the PC file is used and the inbox is not asked', async () => {
  const {CampusStatus, requests} = appWith({fileStatus:{...FILE, announcements:[{id:'pc', text:{en:'On this PC'}}]}, cloudStatus:{announcements:PUBLISHED}, hostname:'localhost'});
  await CampusStatus.load('app/data/campus-status.json');
  assert.deepEqual(shown(CampusStatus), ['On this PC']);
  assert.ok(!requests.includes('https://inbox.example/api/status'));
});

test('markup in a published status is removed before the app uses it', async () => {
  const {CampusStatus} = appWith({fileStatus:FILE, cloudStatus:{...FILE, names:{'Main Building':{he:'<img src=x onerror=alert(1)>בניין'}}}});
  await CampusStatus.load('app/data/campus-status.json');
  assert.ok(!/[<>]/.test(CampusStatus.nameFor('Main Building', 'he')));
});
