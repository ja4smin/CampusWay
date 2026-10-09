// Announcements, emergency mode, name corrections and server sync in app/ui/campus-status.js.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app/ui/campus-status.js'), 'utf8');

function storage(){
  const data = new Map();
  return {
    getItem:key => data.has(key) ? data.get(key) : null,
    setItem:(key, value) => data.set(key, String(value)),
    removeItem:key => data.delete(key)
  };
}

function load({status, hostname = 'localhost', server = true, cloud = true}){
  const requests = [];
  const pages = hostname.endsWith('github.io');
  const context = {
    localStorage:storage(),
    sessionStorage:storage(),
    location:pages ? {href:`https://${hostname}/CampusWay/index.html`, protocol:'https:', hostname} : {href:`http://${hostname}:8080/index.html`, protocol:'http:', hostname},
    URL,
    console,
    setTimeout,
    fetch:async (url, options = {}) => {
      const href = String(url);
      requests.push({href, method:options.method || 'GET', body:options.body ? JSON.parse(options.body) : null});
      if(href.endsWith('campus-status.json')) return {ok:true, json:async () => status};
      if(href.startsWith('https://inbox.example') && href.endsWith('api/health')) return cloud ? {ok:true, json:async () => ({app:'campusway', cloud:true})} : {ok:false, json:async () => ({})};
      if(href.endsWith('api/health')) return server ? {ok:true, json:async () => ({app:'campusway'})} : {ok:false, json:async () => ({})};
      if(href.endsWith('api/reports')){
        const ids = JSON.parse(options.body).reports.map(report => report.id);
        return {ok:true, json:async () => ({accepted:ids})};
      }
      return {ok:true, json:async () => ({})};
    }
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return {CampusStatus:context.CampusStatus, requests, context};
}

const flush = () => new Promise(resolve => setTimeout(resolve, 10));

test('name corrections and active announcements come from the status file', async () => {
  const {CampusStatus} = load({status:{
    names:{'Cafe Aguda':{ar:'مقهى أغودا'}},
    announcements:[
      {id:'now', severity:'warning', text:{en:'Now'}, from:'2020-01-01', until:'2099-01-01'},
      {id:'old', severity:'info', text:{en:'Old'}, until:'2020-01-01'},
      {id:'later', severity:'info', text:{en:'Later'}, from:'2099-01-01'}
    ],
    emergency:{active:true}
  }});
  await CampusStatus.load('app/data/campus-status.json');
  assert.equal(CampusStatus.nameFor('Cafe Aguda', 'ar'), 'مقهى أغودا');
  assert.equal(CampusStatus.nameFor('Cafe Aguda', 'ru'), '');
  assert.deepEqual(CampusStatus.activeAnnouncements().map(item => item.id), ['now']);
  assert.equal(CampusStatus.emergencyActive, true);
});

test('reports and usage counts go to the local server when it is there', async () => {
  const {CampusStatus, requests} = load({status:{}});
  await CampusStatus.load('../app/data/campus-status.json');
  CampusStatus.addReport({kind:'restroom', building:'main', label:'Restroom', problem:'closed', lang:'he'});
  CampusStatus.track('route', 'Rabin Building');
  await flush();
  const post = requests.find(request => request.href === 'http://localhost:8080/api/reports');
  assert.ok(post, 'the API is found from the status file location');
  assert.equal(post.body.reports[0].lang, 'he');
  assert.equal(post.body.reports[0].synced, undefined);
  assert.ok(requests.some(request => request.href.endsWith('/api/usage') && request.body.key === 'Rabin Building'));
  assert.equal(CampusStatus.reports()[0].synced, true);
});

test('nothing is sent on GitHub Pages', async () => {
  const {CampusStatus, requests} = load({status:{}, hostname:'ja4smin.github.io'});
  await CampusStatus.load('app/data/campus-status.json');
  CampusStatus.addReport({kind:'other', problem:'blocked', label:'Path'});
  CampusStatus.track('route', 'Main Building');
  await flush();
  assert.deepEqual(requests.map(request => request.href.split('/').pop()), ['campus-status.json']);
  assert.equal(CampusStatus.reports()[0].synced, undefined, 'the report stays on the device');
});

test('on GitHub Pages, reports and counts go to the cloud inbox from the status file', async () => {
  const {CampusStatus, requests} = load({status:{reportEndpoint:'https://inbox.example/'}, hostname:'ja4smin.github.io'});
  await CampusStatus.load('app/data/campus-status.json');
  CampusStatus.addReport({kind:'restroom', building:'main', label:'Restroom', problem:'closed'});
  CampusStatus.track('route', 'Main Building');
  await flush();
  assert.ok(!requests.some(request => request.href.includes('github.io') && request.href.includes('/api/')), 'the static site is not asked');
  assert.ok(requests.some(request => request.href === 'https://inbox.example/api/reports' && request.method === 'POST'));
  assert.ok(requests.some(request => request.href === 'https://inbox.example/api/usage'));
  assert.equal(CampusStatus.reports()[0].synced, true);
});

test('the PC server wins over the cloud inbox when the app came from it', async () => {
  const {CampusStatus, requests} = load({status:{reportEndpoint:'https://inbox.example/'}});
  await CampusStatus.load('app/data/campus-status.json');
  CampusStatus.addReport({kind:'other', problem:'blocked', label:'Path'});
  await flush();
  assert.ok(requests.some(request => request.href === 'http://localhost:8080/api/reports'));
  assert.ok(!requests.some(request => request.href.startsWith('https://inbox.example/api/reports')));
});

test('an unreachable cloud inbox keeps reports on the device', async () => {
  const {CampusStatus, requests} = load({status:{reportEndpoint:'https://inbox.example/'}, hostname:'ja4smin.github.io', cloud:false});
  await CampusStatus.load('app/data/campus-status.json');
  CampusStatus.addReport({kind:'other', problem:'blocked', label:'Path'});
  await flush();
  assert.ok(!requests.some(request => request.href.endsWith('api/reports')));
  assert.equal(CampusStatus.reports()[0].synced, undefined);
});

test('without a server, reports wait on the device', async () => {
  const {CampusStatus, requests} = load({status:{}, server:false});
  await CampusStatus.load('app/data/campus-status.json');
  CampusStatus.addReport({kind:'other', problem:'blocked', label:'Path'});
  await flush();
  assert.ok(!requests.some(request => request.href.endsWith('api/reports')));
  assert.equal(CampusStatus.reports().length, 1);
});

test('names and zone reasons from the status file lose any markup, even if the file was edited by hand', async () => {
  const {CampusStatus} = load({status:{
    names:{'Main Building':{he:'<img src=x onerror=alert(1)>בניין'}},
    closures:[{area:[[32.761, 35.019], [32.762, 35.019], [32.762, 35.020]], reason:'<script>x</script>Works'}]
  }});
  await CampusStatus.load('app/data/campus-status.json');
  assert.ok(!/[<>]/.test(CampusStatus.nameFor('Main Building', 'he')));
  assert.ok(!/[<>]/.test(CampusStatus.noGoAreas()[0].reason));
});
