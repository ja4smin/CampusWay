#!/usr/bin/env node
// CampusWay local server: serves the app and keeps a small database on this PC.
//
//   node server/campusway-server.js            app + admin on http://localhost:8080
//   node server/campusway-server.js --lan      also reachable by phones on the same Wi-Fi
//
// Uses only Node.js built-in modules: nothing to install, no accounts, no cost.
// Data is saved as JSON files in server/db/ (not committed to git).
// The public GitHub Pages app keeps working without this server.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {execFile} = require('node:child_process');
const {JsonDb} = require('./db');
const TestRunner = require('./test-runner');
const Schema = require('../app/admin/status-schema');

const ROOT = path.resolve(__dirname, '..');
const STATUS_RELATIVE = 'app/data/campus-status.json';

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.cjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.gif':'image/gif',
  '.webp':'image/webp',
  '.ico':'image/x-icon',
  '.md':'text/markdown; charset=utf-8',
  '.txt':'text/plain; charset=utf-8',
  '.webmanifest':'application/manifest+json',
  '.mmd':'text/plain; charset=utf-8'
};

const REPORT_KINDS = ['elevator', 'elevator-group', 'restroom', 'rest-space', 'landmark', 'other'];
const REPORT_PROBLEMS = ['one-out', 'all-out', 'quiet', 'noisy', 'crowded', 'out-of-service', 'doors', 'closed', 'accessible-stall', 'cleaning', 'blocked', 'other'];
const USAGE_TYPES = ['route', 'search-miss', 'no-step-free', 'language', 'profile', 'indoor-mode', 'report'];
// Types the app may send; "report" is counted by the server itself.
const CLIENT_USAGE_TYPES = USAGE_TYPES.filter(type => type !== 'report');
const MAX_REPORTS = 5000;
const MAX_AUDIT = 5000;
const USAGE_KEEP_DAYS = 400;
const SESSION_HOURS = 12;
const STATUS_HISTORY_KEEP = 200;

const HELP = [
  'Live campus status for CampusWay. Edit it from the admin screen (admin.html, run server/campusway-server.js) or by hand; the app reads it every time it opens and keeps the last copy for offline use.',
  'elevators: {"building": "rabin", "elevator": "2", "status": "out-of-service", "from": "2026-10-04", "until": "2026-10-12", "note": "Maintenance"}. building is main, rabin, student, madriga, education or multi-purpose; use "campus" with "elevator": "main-600-outdoor" for the outdoor elevator next to Main Building floor 600. Routes avoid elevators listed here.',
  'closures: indoor {"building": "main", "nodeIds": ["floor600_n12"], "reason": "Construction", "until": "2026-11-01"} or an outdoor no-go zone {"area": [[32.7621, 35.0201], [32.7622, 35.0203], [32.7620, 35.0204]], "reason": "Construction", "until": "2026-11-01"}. Routes go around them.',
  'noiseAreas: outdoor path points that the Rest-space (mental) profile avoids while noisy or crowded: {"id": "garden-cafe", "label": "Garden Café", "outdoorNodeIds": ["campus_main_garden_path"], "noisy": true, "crowded": true, "until": "2026-10-20T23:59:59+03:00"}.',
  'announcements: banners on the campus map and indoor pages: {"id": "a1", "severity": "info" | "warning" | "critical", "text": {"en": "...", "he": "...", "ar": "...", "ru": "..."}, "from": "2026-10-04", "until": "2026-10-12"}. English is shown when a language is missing.',
  'emergency: {"active": true, "message": {"en": "..."}} shows a red banner with a Nearest shelter button on every page. Set active to false when it is over.',
  'openingHours: keyed by the place name: the English name in app/prototype/data.js (for example "Cafe Aguda", "University Clinic", "Minimarket") or the indoor label (for example "Library" in Main Building). Value: {"sun": "07:30-18:00", ..., "sat": "closed"}. Several ranges: "08:00-12:00,13:00-16:00".',
  'names: name corrections keyed by the English name of a building or place: {"Cafe Aguda": {"he": "...", "ar": "...", "ru": "..."}}. They replace the built-in names in that language.',
  'reportEmail: address that receives problem reports by email, for example the facilities office. Leave empty to hide the email button.',
  'reportEndpoint: address of the CampusWay cloud inbox (cloud/README.md), for example "https://campusway-inbox.example.workers.dev/". The public site sends problem reports and anonymous usage counts there; the admin PC fetches them. Leave empty to keep reports on the device.'
];

// ── Helpers ────────────────────────────────────────────────────────────

function today(date = new Date()){
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function text(value, max = 300){
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

// Free text from the public (report notes and labels) never carries markup.
function plain(value, max = 300){
  return text(String(value === undefined || value === null ? '' : value).replace(/[<>]/g, ''), max);
}

function isLoopback(address){
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function lanAddresses(){
  return Object.values(os.networkInterfaces()).flat()
    .filter(item => item && item.family === 'IPv4' && !item.internal)
    .map(item => item.address);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')){
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return {salt, hash};
}

function passwordMatches(password, user){
  if(!user || !user.salt || !user.hash) return false;
  const attempt = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const stored = Buffer.from(user.hash, 'hex');
  return attempt.length === stored.length && crypto.timingSafeEqual(attempt, stored);
}

function publicUser(user){
  if(!user) return null;
  const {salt, hash, ...rest} = user;
  return {...rest, permissions:(Schema.ROLES[user.role] || {can:[]}).can};
}

// Total size of a folder in bytes, and how many files it holds.
function folderSize(directory, skip = () => false){
  let bytes = 0, files = 0;
  const walk = folder => {
    let entries = [];
    try{ entries = fs.readdirSync(folder, {withFileTypes:true}); }catch(error){ return; }
    for(const entry of entries){
      const full = path.join(folder, entry.name);
      if(skip(full, entry)) continue;
      if(entry.isDirectory()) walk(full);
      else if(entry.isFile()){
        try{ bytes += fs.statSync(full).size; files += 1; }catch(error){ /* removed meanwhile */ }
      }
    }
  };
  walk(directory);
  return {bytes, files};
}

function git(args, cwd){
  return new Promise(resolve => {
    execFile('git', args, {cwd, timeout:4000, windowsHide:true}, (error, stdout) => {
      resolve(error ? null : String(stdout));
    });
  });
}

// Reads `const NAME = {...};` from a source file without running the file.
function extractObjectLiteral(source, name){
  const start = source.search(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`));
  if(start < 0) return null;
  const open = source.indexOf('{', start);
  let depth = 0, quote = null;
  for(let i = open; i < source.length; i += 1){
    const character = source[i];
    if(quote){
      if(character === '\\'){ i += 1; continue; }
      if(character === quote) quote = null;
      continue;
    }
    if(character === '"' || character === '\'' || character === '`'){ quote = character; continue; }
    if(character === '{') depth += 1;
    if(character === '}'){
      depth -= 1;
      if(depth === 0){
        try{
          return vm.runInNewContext(`(${source.slice(open, i + 1)})`, Object.create(null), {timeout:200});
        }catch(error){
          return null;
        }
      }
    }
  }
  return null;
}

class RateLimiter{
  constructor(limit, windowMs){
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  allow(key){
    const now = Date.now();
    const list = (this.hits.get(key) || []).filter(time => now - time < this.windowMs);
    if(list.length >= this.limit){ this.hits.set(key, list); return false; }
    list.push(now);
    this.hits.set(key, list);
    if(this.hits.size > 5000) this.hits.clear();
    return true;
  }
}

class HttpError extends Error{
  constructor(status, message, extra){
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ── Server ─────────────────────────────────────────────────────────────

function createCampusWayServer(options = {}){
  const root = options.root || ROOT;
  const statusFile = options.statusFile || path.join(root, STATUS_RELATIVE);
  const db = new JsonDb(options.dbDir || path.join(__dirname, 'db'));
  const historyDir = path.join(db.directory, 'status-history');
  const collectUsage = options.collectUsage !== false;
  const lanAdmin = options.lanAdmin === true;
  const cloudMinutes = Number(options.cloudSyncMinutes) > 0 ? Number(options.cloudSyncMinutes) : 0;
  // Hard limit for everything CampusWay stores on this PC (default 10 GB).
  const maxDataBytes = Number(options.maxDataBytes) > 0 ? Number(options.maxDataBytes) : 10 * 1024 ** 3;
  const sessions = new Map();

  const limits = {
    reports:new RateLimiter(30, 3600000),
    usage:new RateLimiter(600, 3600000),
    login:new RateLimiter(10, 15 * 60000)
  };

  fs.mkdirSync(historyDir, {recursive:true});

  // ── Collections ──
  const users = () => db.read('users', []);
  const reports = () => db.read('reports', []);
  const usage = () => db.read('usage', {days:{}});
  const auditLog = () => db.read('audit', []);

  function audit(user, action, detail = {}){
    db.update('audit', [], list => {
      list.unshift({at:new Date().toISOString(), user:user ? user.username : 'system', role:user ? user.role : '', action, detail});
      return list.slice(0, MAX_AUDIT);
    });
  }

  // ── Storage on this PC ──
  // Measured at most every 30 seconds. When CampusWay's data reaches the limit,
  // new reports, usage counts and cloud fetches are refused (phones keep their
  // reports and send them later); admin edits keep working.
  let storageCache = {at:-Infinity, value:null};
  let projectCache = {at:-Infinity, value:null};

  function storageUsage({fresh = false} = {}){
    if(!fresh && Date.now() - storageCache.at < 30000) return storageCache.value;
    const parts = [
      {key:'reports', label:'Problem reports', file:'reports.json'},
      {key:'usage', label:'Usage counts', file:'usage.json'},
      {key:'audit', label:'Activity log', file:'audit.json'},
      {key:'users', label:'Admin accounts', file:'users.json'},
      {key:'cloud', label:'Cloud inbox settings', file:'cloud.json'},
      {key:'tests', label:'Last test run', file:'tests.json'}
    ].map(part => {
      let bytes = 0;
      try{ bytes = fs.statSync(path.join(db.directory, part.file)).size; }catch(error){ /* not created yet */ }
      return {...part, bytes};
    });
    const history = folderSize(historyDir);
    parts.push({key:'history', label:'Status file backups', file:'status-history/', bytes:history.bytes, files:history.files});
    const total = folderSize(db.directory);
    const other = Math.max(0, total.bytes - parts.reduce((sum, part) => sum + part.bytes, 0));
    if(other) parts.push({key:'other', label:'Other files in the data folder', file:'', bytes:other});
    let statusBytes = 0;
    try{ statusBytes = fs.statSync(statusFile).size; }catch(error){ /* missing */ }
    parts.push({key:'status', label:'Live status file', file:path.relative(root, statusFile).split(path.sep).join('/'), bytes:statusBytes});
    const bytes = total.bytes + statusBytes;
    const value = {bytes, limitBytes:maxDataBytes, full:bytes >= maxDataBytes, parts, directory:db.directory, measuredAt:new Date().toISOString()};
    storageCache = {at:Date.now(), value};
    return value;
  }

  // The app's own files (maps, code), for information only.
  function projectUsage(){
    if(Date.now() - projectCache.at < 10 * 60000) return projectCache.value;
    const dbDir = path.resolve(db.directory);
    const value = folderSize(root, (full, entry) =>
      entry.isDirectory() && (['.git', 'node_modules', '.wrangler'].includes(entry.name) || path.resolve(full) === dbDir));
    projectCache = {at:Date.now(), value};
    return value;
  }

  function storageFull(){
    return storageUsage().full;
  }

  // ── Status file ──
  function readStatusFile(){
    const raw = fs.readFileSync(statusFile, 'utf8');
    return {raw, data:JSON.parse(raw), version:crypto.createHash('sha1').update(raw).digest('hex')};
  }

  function knownGraphData(){
    const knownNodes = {};
    const knownElevators = {};
    for(const building of Schema.BUILDINGS){
      try{
        const graph = JSON.parse(fs.readFileSync(path.join(root, building.graph), 'utf8'));
        const nodes = new Set();
        const elevators = new Set();
        Object.values(graph.floors || {}).forEach(floor => (floor.nodes || []).forEach(node => {
          nodes.add(String(node.id));
          if(node.type === 'elevator' && node.connectorId){
            const match = String(node.connectorId).match(/\d+/);
            elevators.add(match ? String(Number(match[0])) : String(node.connectorId).trim().toLowerCase());
          }
        }));
        knownNodes[building.key] = nodes;
        knownElevators[building.key] = elevators;
      }catch(error){ /* a missing graph only disables that check */ }
    }
    return {knownNodes, knownElevators};
  }

  function saveStatus(user, nextStatus, {baseVersion, action = 'status.save', note = ''} = {}){
    const current = readStatusFile();
    if(baseVersion && baseVersion !== current.version){
      throw new HttpError(409, 'The status file changed since you opened it (another admin or a hand edit). Reload to see the latest version, then make your change again.');
    }
    const missing = Schema.missingPermissions(user.role, current.data, nextStatus);
    if(missing.length){
      throw new HttpError(403, `Your role (${user.role}) cannot change: ${missing.join(', ')}.`);
    }
    const result = Schema.validateStatus(nextStatus, knownGraphData());
    if(result.errors.length){
      throw new HttpError(422, 'The status has errors.', {errors:result.errors, warnings:result.warnings});
    }
    const sections = Schema.changedSections(current.data, result.status);
    if(!sections.length && action === 'status.save'){
      return {version:current.version, status:current.data, warnings:result.warnings, unchanged:true};
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(historyDir, `${stamp}.json`), JSON.stringify({
      savedAt:new Date().toISOString(), replacedBy:user.username, action, sections, status:current.data
    }, null, 2));
    const old = fs.readdirSync(historyDir).filter(name => name.endsWith('.json')).sort();
    old.slice(0, Math.max(0, old.length - STATUS_HISTORY_KEEP)).forEach(name => {
      try{ fs.unlinkSync(path.join(historyDir, name)); }catch(error){ /* ignore */ }
    });

    const status = {...result.status};
    if(status.emergency.active && !status.emergency.since) status.emergency.since = new Date().toISOString();
    if(!status.emergency.active) delete status.emergency.since;
    const file = {_help:HELP, ...status, updated:today()};
    const temporary = `${statusFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`);
    fs.renameSync(temporary, statusFile);
    audit(user, action, {sections, note});
    const saved = readStatusFile();
    return {version:saved.version, status:saved.data, warnings:result.warnings};
  }

  // ── Sessions ──
  function sessionUser(req){
    const cookie = String(req.headers.cookie || '');
    const match = cookie.match(/(?:^|;\s*)cw_admin=([a-f0-9]{64})/);
    if(!match) return null;
    const session = sessions.get(match[1]);
    if(!session || session.expires < Date.now()){ sessions.delete(match[1]); return null; }
    const user = users().find(item => item.id === session.userId && item.active !== false);
    return user ? {user, token:match[1]} : null;
  }

  function startSession(res, user){
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {userId:user.id, expires:Date.now() + SESSION_HOURS * 3600000});
    res.setHeader('Set-Cookie', `cw_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
  }

  // ── HTTP plumbing ──
  function send(res, status, body, headers = {}){
    const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type':typeof body === 'string' || Buffer.isBuffer(body) ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      ...headers
    });
    res.end(payload);
  }

  function readBody(req, maxBytes){
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', chunk => {
        size += chunk.length;
        if(size > maxBytes){ reject(new HttpError(413, 'Request too large.')); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if(!chunks.length) return resolve({});
        try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch(error){ reject(new HttpError(400, 'Invalid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  function checkWriteRequest(req, {admin}){
    const type = String(req.headers['content-type'] || '');
    if(!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
    const origin = req.headers.origin;
    if(origin){
      let host = '';
      try{ host = new URL(origin).host; }catch(error){ /* invalid origin */ }
      if(host !== req.headers.host) throw new HttpError(403, 'Cross-site request refused.');
    }
    if(admin && req.headers['x-campusway-admin'] !== '1') throw new HttpError(403, 'Missing admin header.');
  }

  function requireUser(req, permission){
    const session = sessionUser(req);
    if(!session) throw new HttpError(401, 'Please sign in.');
    if(permission && !Schema.can(session.user.role, permission)){
      throw new HttpError(403, `Your role (${session.user.role}) cannot do this.`);
    }
    return session.user;
  }

  // ── Public API (used by the CampusWay app) ──
  function cleanReport(input, source){
    const now = Date.now();
    const time = Number(input.time);
    const report = {
      id:/^[a-z0-9]{6,40}$/i.test(String(input.id || '')) ? String(input.id) : `r${now.toString(36)}${crypto.randomBytes(3).toString('hex')}`,
      time:Number.isFinite(time) && time <= now + 300000 && now - time < 30 * 86400000 ? time : now,
      receivedAt:now,
      source,
      kind:REPORT_KINDS.includes(input.kind) ? input.kind : 'other',
      building:plain(input.building, 40),
      buildingName:plain(input.buildingName, 160),
      connectorId:plain(input.connectorId, 60),
      connectorIds:(Array.isArray(input.connectorIds) ? input.connectorIds : []).map(value => plain(value, 60)).filter(Boolean).slice(0, 20),
      nodeId:plain(input.nodeId, 60),
      label:plain(input.label, 200),
      problem:REPORT_PROBLEMS.includes(input.problem) ? input.problem : 'other',
      note:plain(input.note, 500),
      lang:['en', 'he', 'ar', 'ru'].includes(input.lang) ? input.lang : '',
      status:'new',
      assignee:'',
      internalNote:'',
      history:[]
    };
    if(source === 'admin'){
      report.reporter = plain(input.reporter, 160);
      report.channel = plain(input.channel, 40);
    }
    return report;
  }

  function addUsage(type, key, {day = today(), count = 1} = {}){
    if(!collectUsage || !USAGE_TYPES.includes(type)) return;
    const value = text(key, 80).toLowerCase() || '(none)';
    db.update('usage', {days:{}}, data => {
      data.days[day] = data.days[day] || {};
      const bucket = data.days[day][type] = data.days[day][type] || {};
      if(bucket[value] !== undefined || Object.keys(bucket).length < 500){
        bucket[value] = (bucket[value] || 0) + count;
      }
      const days = Object.keys(data.days).sort();
      days.slice(0, Math.max(0, days.length - USAGE_KEEP_DAYS)).forEach(old => delete data.days[old]);
      return data;
    });
  }

  // ── Routes ──
  const routes = [];
  const route = (method, pattern, handler) => routes.push({method, pattern, handler});

  route('GET', /^\/api\/health$/, () => ({ok:true, app:'campusway', usage:collectUsage}));

  route('POST', /^\/api\/reports$/, async (req) => {
    checkWriteRequest(req, {admin:false});
    if(!limits.reports.allow(req.socket.remoteAddress)) throw new HttpError(429, 'Too many reports from this device. Try again later.');
    if(storageFull()) throw new HttpError(507, 'The CampusWay PC has reached its storage limit. The report stays on this device and is sent later.');
    const body = await readBody(req, 8 * 1024);
    const incoming = Array.isArray(body.reports) ? body.reports.slice(0, 50) : [body];
    const accepted = [];
    const added = [];
    db.update('reports', [], list => {
      const known = new Set(list.map(report => report.id));
      for(const input of incoming){
        if(!input || typeof input !== 'object') continue;
        const report = cleanReport(input, 'app');
        accepted.push(report.id);
        if(known.has(report.id)) continue;
        list.unshift(report);
        known.add(report.id);
        added.push(report);
      }
      return list.slice(0, MAX_REPORTS);
    });
    added.forEach(report => addUsage('report', `${report.kind}:${report.problem}`));
    return {ok:true, accepted};
  });

  // Reporters can see whether their own reports were handled.
  route('GET', /^\/api\/reports\/status$/, (req, url) => {
    const ids = String(url.searchParams.get('ids') || '').split(',').map(id => id.trim()).filter(id => /^[a-z0-9]{6,40}$/i.test(id)).slice(0, 50);
    const wanted = new Set(ids);
    return {statuses:Object.fromEntries(reports().filter(report => wanted.has(report.id)).map(report => [report.id, report.status]))};
  });

  route('POST', /^\/api\/usage$/, async (req) => {
    checkWriteRequest(req, {admin:false});
    if(!limits.usage.allow(req.socket.remoteAddress) || storageFull()) return {ok:false};
    const body = await readBody(req, 2 * 1024);
    const type = String(body.type || '');
    if(CLIENT_USAGE_TYPES.includes(type)) addUsage(type, body.key);
    return {ok:true};
  });

  // ── Admin API ──
  function adminGuard(req){
    if(!lanAdmin && !isLoopback(req.socket.remoteAddress)){
      throw new HttpError(403, 'The admin screen only works on the PC that runs the server. Start it with --lan-admin to allow other computers.');
    }
  }

  route('GET', /^\/api\/admin\/session$/, (req) => {
    adminGuard(req);
    const session = sessionUser(req);
    return {needsSetup:users().length === 0, user:publicUser(session && session.user), roles:Schema.ROLES};
  });

  route('POST', /^\/api\/admin\/setup$/, async (req, url, res) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    if(users().length) throw new HttpError(409, 'An administrator already exists. Sign in instead.');
    if(!isLoopback(req.socket.remoteAddress)) throw new HttpError(403, 'Create the first administrator on the PC that runs the server.');
    const body = await readBody(req, 4 * 1024);
    const user = createUser({username:body.username, displayName:body.displayName, role:'admin', password:body.password});
    audit(user, 'user.setup', {username:user.username});
    startSession(res, user);
    return {user:publicUser(user)};
  });

  function createUser({username, displayName, role, password}){
    const name = text(username, 40).toLowerCase();
    if(!/^[a-z0-9._-]{3,40}$/.test(name)) throw new HttpError(422, 'User name: 3–40 letters, digits, dots, dashes or underscores.');
    if(String(password || '').length < 8) throw new HttpError(422, 'Password: at least 8 characters.');
    if(!Schema.ROLES[role]) throw new HttpError(422, 'Unknown role.');
    if(users().some(user => user.username === name)) throw new HttpError(409, 'That user name is taken.');
    const user = {
      id:`u${crypto.randomBytes(6).toString('hex')}`,
      username:name,
      displayName:text(displayName, 80) || name,
      role,
      active:true,
      createdAt:new Date().toISOString(),
      lastLoginAt:null,
      ...hashPassword(password)
    };
    db.update('users', [], list => { list.push(user); return list; });
    return user;
  }

  route('POST', /^\/api\/admin\/login$/, async (req, url, res) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    if(!limits.login.allow(req.socket.remoteAddress)) throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes.');
    const body = await readBody(req, 4 * 1024);
    const user = users().find(item => item.username === text(body.username, 40).toLowerCase() && item.active !== false);
    if(!passwordMatches(body.password, user)) throw new HttpError(401, 'Wrong user name or password.');
    db.update('users', [], list => {
      const stored = list.find(item => item.id === user.id);
      if(stored) stored.lastLoginAt = new Date().toISOString();
      return list;
    });
    audit(user, 'user.login');
    startSession(res, user);
    return {user:publicUser(user)};
  });

  route('POST', /^\/api\/admin\/logout$/, async (req, url, res) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const session = sessionUser(req);
    if(session) sessions.delete(session.token);
    res.setHeader('Set-Cookie', 'cw_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return {ok:true};
  });

  route('POST', /^\/api\/admin\/password$/, async (req) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const user = requireUser(req);
    const body = await readBody(req, 4 * 1024);
    if(!passwordMatches(body.current, user)) throw new HttpError(401, 'The current password is wrong.');
    if(String(body.next || '').length < 8) throw new HttpError(422, 'New password: at least 8 characters.');
    db.update('users', [], list => {
      const stored = list.find(item => item.id === user.id);
      Object.assign(stored, hashPassword(body.next));
      return list;
    });
    audit(user, 'user.password');
    return {ok:true};
  });

  // Overview
  route('GET', /^\/api\/admin\/overview$/, async (req) => {
    adminGuard(req);
    requireUser(req);
    const relative = path.relative(root, statusFile).split(path.sep).join('/');
    const [porcelain, lastCommit] = await Promise.all([
      git(['status', '--porcelain', '--', relative], root),
      git(['log', '-1', '--format=%cI', '--', relative], root)
    ]);
    const list = reports();
    return {
      reports:{
        total:list.length,
        open:list.filter(report => !['resolved', 'rejected'].includes(report.status)).length,
        new:list.filter(report => report.status === 'new').length
      },
      publish:{
        git:porcelain !== null,
        unpublished:porcelain !== null && porcelain.trim().length > 0,
        lastCommit:lastCommit ? lastCommit.trim() : null,
        file:relative
      },
      usage:collectUsage,
      cloud:publicCloud(),
      storage:(({bytes, limitBytes, full}) => ({bytes, limitBytes, full}))(storageUsage()),
      dbDir:db.directory,
      lan:lanAddresses()
    };
  });

  // Status
  route('GET', /^\/api\/admin\/status$/, (req) => {
    adminGuard(req);
    requireUser(req);
    const current = readStatusFile();
    return {status:current.data, version:current.version};
  });

  route('PUT', /^\/api\/admin\/status$/, async (req) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const user = requireUser(req);
    const body = await readBody(req, 1024 * 1024);
    return saveStatus(user, body.status, {baseVersion:body.version, note:text(body.note, 200)});
  });

  route('GET', /^\/api\/admin\/status\/history$/, (req) => {
    adminGuard(req);
    requireUser(req);
    const items = fs.readdirSync(historyDir).filter(name => name.endsWith('.json')).sort().reverse().slice(0, 100)
      .map(name => {
        try{
          const entry = JSON.parse(fs.readFileSync(path.join(historyDir, name), 'utf8'));
          return {id:name.replace(/\.json$/, ''), savedAt:entry.savedAt, replacedBy:entry.replacedBy, action:entry.action, sections:entry.sections};
        }catch(error){ return null; }
      }).filter(Boolean);
    return {items};
  });

  route('GET', /^\/api\/admin\/status\/history\/([\w-]+)$/, (req, url, res, match) => {
    adminGuard(req);
    requireUser(req);
    const file = path.join(historyDir, `${match[1]}.json`);
    if(!fs.existsSync(file)) throw new HttpError(404, 'Not found.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  });

  route('POST', /^\/api\/admin\/status\/restore$/, async (req) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const user = requireUser(req, 'restore');
    const body = await readBody(req, 4 * 1024);
    const file = path.join(historyDir, `${text(body.id, 80).replace(/[^\w-]/g, '')}.json`);
    if(!fs.existsSync(file)) throw new HttpError(404, 'That version was not found.');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    return saveStatus(user, entry.status, {action:'status.restore', note:body.id});
  });

  // Reports
  route('GET', /^\/api\/admin\/reports$/, (req) => {
    adminGuard(req);
    requireUser(req);
    return {reports:reports()};
  });

  route('POST', /^\/api\/admin\/reports$/, async (req) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const user = requireUser(req, 'reports');
    const body = await readBody(req, 8 * 1024);
    const report = cleanReport({...body, id:''}, 'admin');
    report.history.push({at:new Date().toISOString(), by:user.username, action:'created'});
    db.update('reports', [], list => { list.unshift(report); return list.slice(0, MAX_REPORTS); });
    audit(user, 'report.create', {id:report.id, label:report.label});
    return {report};
  });

  route('PATCH', /^\/api\/admin\/reports$/, async (req) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const user = requireUser(req, 'reports');
    const body = await readBody(req, 16 * 1024);
    const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(String));
    if(!ids.size) throw new HttpError(422, 'No reports chosen.');
    const changes = {};
    if(body.status !== undefined){
      if(!Schema.REPORT_STATUSES.includes(body.status)) throw new HttpError(422, 'Unknown status.');
      changes.status = body.status;
    }
    if(body.assignee !== undefined) changes.assignee = text(body.assignee, 80);
    if(body.internalNote !== undefined) changes.internalNote = text(body.internalNote, 1000);
    const comment = text(body.comment, 500);
    const updated = [];
    db.update('reports', [], list => {
      list.forEach(report => {
        if(!ids.has(report.id)) return;
        const entry = {at:new Date().toISOString(), by:user.username};
        if(changes.status && changes.status !== report.status){
          entry.action = 'status';
          entry.from = report.status;
          entry.to = changes.status;
          if(!report.firstResponseAt && report.status === 'new') report.firstResponseAt = Date.now();
          if(['resolved', 'rejected'].includes(changes.status)) report.closedAt = Date.now();
          else delete report.closedAt;
        }
        if(changes.assignee !== undefined && changes.assignee !== report.assignee){
          entry.action = entry.action || 'assign';
          entry.assignee = changes.assignee;
        }
        if(comment){ entry.action = entry.action || 'comment'; entry.note = comment; }
        Object.assign(report, changes);
        report.history = report.history || [];
        if(entry.action) report.history.push(entry);
        updated.push(report);
      });
      return list;
    });
    audit(user, 'report.update', {ids:[...ids], ...changes, comment});
    return {reports:updated};
  });

  // Usage insights
  route('GET', /^\/api\/admin\/usage$/, (req) => {
    adminGuard(req);
    requireUser(req);
    return {...usage(), collecting:collectUsage};
  });

  // Built-in names, so the content editor can show what the app shows today.
  route('GET', /^\/api\/admin\/builtin-names$/, (req) => {
    adminGuard(req);
    requireUser(req);
    const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const data = fs.readFileSync(path.join(root, 'app/prototype/data.js'), 'utf8');
    return {
      buildingRu:extractObjectLiteral(index, 'BUILDING_NAMES_RU') || {},
      buildingAr:extractObjectLiteral(index, 'BUILDING_NAMES_AR') || {},
      placeRu:extractObjectLiteral(index, 'PLACE_NAMES_RU') || {},
      placeHe:extractObjectLiteral(data, 'PLACE_NAMES_HE') || {}
    };
  });

  // Users and audit log
  route('GET', /^\/api\/admin\/users$/, (req) => {
    adminGuard(req);
    requireUser(req, 'users');
    return {users:users().map(publicUser)};
  });

  route('POST', /^\/api\/admin\/users$/, async (req) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const actor = requireUser(req, 'users');
    const body = await readBody(req, 4 * 1024);
    const user = createUser(body);
    audit(actor, 'user.create', {username:user.username, role:user.role});
    return {user:publicUser(user)};
  });

  route('PATCH', /^\/api\/admin\/users\/([\w-]+)$/, async (req, url, res, match) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const actor = requireUser(req, 'users');
    const body = await readBody(req, 4 * 1024);
    // Check everything before changing anything.
    const list = users();
    const user = list.find(item => item.id === match[1]);
    if(!user) throw new HttpError(404, 'User not found.');
    if(body.role !== undefined && !Schema.ROLES[body.role]) throw new HttpError(422, 'Unknown role.');
    if(body.password && String(body.password).length < 8) throw new HttpError(422, 'Password: at least 8 characters.');
    const activeAdmins = list.filter(item => item.role === 'admin' && item.active !== false);
    const removesLastAdmin = user.role === 'admin' && user.active !== false && activeAdmins.length === 1 &&
      ((body.role && body.role !== 'admin') || body.active === false);
    if(removesLastAdmin) throw new HttpError(409, 'Keep at least one active administrator.');
    db.update('users', [], () => {
      if(body.role !== undefined) user.role = body.role;
      if(body.displayName !== undefined) user.displayName = text(body.displayName, 80) || user.username;
      if(body.active !== undefined) user.active = body.active === true;
      if(body.password) Object.assign(user, hashPassword(body.password));
    });
    const result = user;
    if(body.active === false || body.password){
      for(const [token, session] of sessions) if(session.userId === result.id && result.id !== actor.id) sessions.delete(token);
    }
    audit(actor, 'user.update', {username:result.username, role:body.role, active:body.active, passwordReset:Boolean(body.password)});
    return {user:publicUser(result)};
  });

  route('GET', /^\/api\/admin\/audit$/, (req) => {
    adminGuard(req);
    requireUser(req);
    return {entries:auditLog().slice(0, 1000)};
  });

  // ── Cloud inbox (cloud/worker.mjs) ──
  // Reports from the public site wait in a free Cloudflare Worker until this
  // PC fetches them. Each fetch confirms ("acks") the previous batch, so the
  // inbox can forget it; unconfirmed batches are kept in cloud.json and sent
  // again, so nothing is counted twice or lost if the connection drops.
  const cloudDefaults = {url:'', key:'', autoSync:true, lastSync:null, lastError:'', lastResult:null, pendingAck:null};
  const cloudConfig = () => ({...cloudDefaults, ...db.read('cloud', {})});
  let cloudRunning = null;

  function normalizeCloudUrl(value){
    const raw = text(value, 300);
    if(!raw) return '';
    let url;
    try{ url = new URL(raw); }catch(error){ throw new HttpError(422, 'The inbox address is not a valid URL.'); }
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if(url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new HttpError(422, 'The inbox address must start with https://');
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}/`;
  }

  async function cloudCall(config, body){
    let response;
    try{
      response = await fetch(new URL('api/sync', config.url), {
        method:'POST',
        headers:{'Content-Type':'application/json', Authorization:`Bearer ${config.key}`},
        body:JSON.stringify(body),
        signal:AbortSignal.timeout(20000)
      });
    }catch(error){
      throw new Error(`The cloud inbox could not be reached (${error.name === 'TimeoutError' ? 'timed out' : error.message}).`);
    }
    const data = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(data.error || `The cloud inbox answered ${response.status}.`);
    return data;
  }

  function importCloudBatch(data){
    const incoming = Array.isArray(data.reports) ? data.reports.filter(item => item && typeof item === 'object') : [];
    const usageRows = Array.isArray(data.usage) ? data.usage.filter(row => row && USAGE_TYPES.includes(row.type) && Number.isInteger(row.count) && row.count > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.day)) : [];
    const added = [];
    if(incoming.length){
      db.update('reports', [], list => {
        const known = new Set(list.map(report => report.id));
        incoming.forEach(input => {
          const report = cleanReport(input, 'app');
          if(String(input.id || '') !== report.id || known.has(report.id)) return;
          const received = Number(input.receivedAt);
          if(Number.isFinite(received) && received <= Date.now()) report.receivedAt = received;
          report.via = 'cloud';
          list.unshift(report);
          known.add(report.id);
          added.push(report);
        });
        list.sort((a, b) => (b.receivedAt || b.time) - (a.receivedAt || a.time));
        return list.slice(0, MAX_REPORTS);
      });
      added.forEach(report => addUsage('report', `${report.kind}:${report.problem}`, {day:today(new Date(report.receivedAt))}));
    }
    usageRows.forEach(row => addUsage(row.type, row.key, {day:row.day, count:row.count}));
    return {
      added:added.length,
      counts:usageRows.reduce((sum, row) => sum + row.count, 0),
      ack:{
        ackReports:incoming.map(report => String(report.id || '')).filter(id => /^[a-z0-9]{6,40}$/i.test(id)),
        ackUsage:usageRows.map(row => ({day:row.day, type:row.type, key:row.key, count:row.count}))
      }
    };
  }

  function cloudSync({user = null} = {}){
    if(cloudRunning) return cloudRunning;
    cloudRunning = (async () => {
      const config = cloudConfig();
      if(!config.url || !config.key) throw new HttpError(409, 'The cloud inbox is not set up yet.');
      if(storageUsage({fresh:true}).full){
        const message = `This PC has reached its CampusWay storage limit (${Math.round(maxDataBytes / 1024 ** 3 * 10) / 10} GB), so nothing more is fetched. Reports wait safely in the inbox. See the Storage page.`;
        db.update('cloud', {}, stored => ({...cloudDefaults, ...stored, lastError:message, lastErrorAt:new Date().toISOString()}));
        throw new HttpError(507, message);
      }
      const statuses = Object.fromEntries(reports()
        .filter(report => report.via === 'cloud' && Date.now() - (report.receivedAt || report.time) < 60 * 86400000)
        .slice(0, 5000)
        .map(report => [report.id, report.status]));
      let ack = config.pendingAck || {ackReports:[], ackUsage:[]};
      const result = {reports:0, counts:0, at:new Date().toISOString()};
      try{
        for(let round = 0; round < 50; round += 1){
          const data = await cloudCall(config, {...ack, statuses:round === 0 ? statuses : {}});
          if(data.stats && typeof data.stats === 'object') result.stats = data.stats;
          const batch = importCloudBatch(data);
          result.reports += batch.added;
          result.counts += batch.counts;
          ack = batch.ack;
          db.update('cloud', {}, stored => ({...cloudDefaults, ...stored, pendingAck:ack}));
          if(!ack.ackReports.length && !ack.ackUsage.length) break;
        }
        if(ack.ackReports.length || ack.ackUsage.length){
          // Stopped after many rounds: confirm the last batch, fetch the rest next time.
          await cloudCall(config, {...ack, statuses:{}});
        }
        const {stats, ...summary} = result;
        db.update('cloud', {}, stored => ({...cloudDefaults, ...stored, pendingAck:null, lastSync:result.at, lastError:'', lastResult:summary, lastStats:stats || stored.lastStats || null}));
        if(user || result.reports) audit(user, 'cloud.sync', result);
        return result;
      }catch(error){
        db.update('cloud', {}, stored => ({...cloudDefaults, ...stored, lastError:error.message, lastErrorAt:new Date().toISOString()}));
        throw error instanceof HttpError ? error : new HttpError(502, error.message);
      }
    })().finally(() => { cloudRunning = null; });
    return cloudRunning;
  }

  function publicCloud(){
    const config = cloudConfig();
    return {
      url:config.url, hasKey:Boolean(config.key), autoSync:config.autoSync !== false,
      lastSync:config.lastSync, lastError:config.lastError, lastErrorAt:config.lastErrorAt || null,
      lastResult:config.lastResult, lastStats:config.lastStats || null, minutes:cloudMinutes, waitingToConfirm:Boolean(config.pendingAck)
    };
  }

  route('GET', /^\/api\/admin\/storage$/, (req) => {
    adminGuard(req);
    requireUser(req);
    const list = reports();
    const usageDays = Object.keys(usage().days || {});
    return {
      pc:{
        ...storageUsage({fresh:true}),
        counts:{
          reports:list.length, maxReports:MAX_REPORTS,
          auditEntries:auditLog().length, maxAudit:MAX_AUDIT,
          usageDays:usageDays.length, maxUsageDays:USAGE_KEEP_DAYS,
          statusVersions:storageUsage().parts.find(part => part.key === 'history').files || 0, maxStatusVersions:STATUS_HISTORY_KEEP
        },
        project:projectUsage(),
        disk:diskSpace()
      },
      cloud:publicCloud()
    };
  });

  function diskSpace(){
    try{
      if(typeof fs.statfsSync !== 'function') return null;
      const stats = fs.statfsSync(db.directory);
      return {freeBytes:stats.bavail * stats.bsize, totalBytes:stats.blocks * stats.bsize};
    }catch(error){
      return null;
    }
  }

  route('GET', /^\/api\/admin\/cloud$/, (req) => {
    adminGuard(req);
    requireUser(req);
    return publicCloud();
  });

  route('PUT', /^\/api\/admin\/cloud$/, async (req) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const user = requireUser(req, 'users');
    const body = await readBody(req, 4 * 1024);
    const url = normalizeCloudUrl(body.url);
    const key = body.key === undefined || body.key === '' ? cloudConfig().key : text(body.key, 200);
    if(url && key && key.length < 24) throw new HttpError(422, 'The sync key must be at least 24 characters.');
    db.update('cloud', {}, stored => ({...cloudDefaults, ...stored, url, key:url ? key : '', autoSync:body.autoSync !== false, lastError:'', pendingAck:null}));
    audit(user, 'cloud.config', {url, keyChanged:Boolean(body.key)});
    let test = null;
    if(url){
      try{
        const response = await fetch(new URL('api/health', url), {signal:AbortSignal.timeout(10000)});
        const health = await response.json().catch(() => ({}));
        test = health.cloud ? {ok:true} : {ok:false, message:'That address answered, but it is not a CampusWay inbox.'};
      }catch(error){
        test = {ok:false, message:'That address could not be reached.'};
      }
    }
    return {...publicCloud(), test};
  });

  route('POST', /^\/api\/admin\/cloud\/sync$/, async (req) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const user = requireUser(req, 'reports');
    const result = await cloudSync({user});
    return {...publicCloud(), result};
  });

  // ── Automated tests (admin only) ──
  // Runs the fixed files in tests/ with Node's test runner; nothing from the
  // request reaches the command. One run at a time; the last run is kept.
  let testRun = null;
  let testRunning = false;

  // The saved copy keeps the full output only for files that failed.
  function storedRun(run){
    return {...run, files:run.files.map(file => file.status === 'failed' ? file : {...file, output:''})};
  }

  route('GET', /^\/api\/admin\/tests$/, (req) => {
    adminGuard(req);
    requireUser(req, 'tests');
    let files = [];
    try{ files = TestRunner.testFiles(root); }catch(error){ /* no tests folder */ }
    return {running:testRunning, run:testRun || db.read('tests', null), files, node:process.version};
  });

  route('POST', /^\/api\/admin\/tests\/run$/, async (req) => {
    adminGuard(req);
    checkWriteRequest(req, {admin:true});
    const user = requireUser(req, 'tests');
    if(testRunning) throw new HttpError(409, 'The tests are already running.');
    let files = [];
    try{ files = TestRunner.testFiles(root); }catch(error){ /* reported below */ }
    if(!files.length) throw new HttpError(404, 'No test files were found in the tests folder.');
    testRunning = true;
    audit(user, 'tests.run', {files:files.length});
    TestRunner.runTests(root, run => { testRun = JSON.parse(JSON.stringify(run)); })
      .then(run => {
        db.write('tests', storedRun(run));
        audit(user, 'tests.done', {status:run.status, ...run.totals});
      })
      .catch(error => {
        testRun = {...(testRun || {}), status:'error', error:error.message, finishedAt:new Date().toISOString()};
      })
      .finally(() => { testRunning = false; });
    return {started:true, files:files.length};
  });

  // ── Static files ──
  // Only the app's public files are served, from an allow-list of top-level
  // names (exact, case-sensitive). Everything else — the database, the server
  // code, git data, tests, the cloud folder — is never reachable, whatever the
  // spelling: other letter case, backslashes, "..", 8.3 short names, trailing
  // dots or alternate data streams all fail the checks below.
  const PUBLIC_ENTRIES = new Set(['index.html', 'admin.html', 'manifest.json', 'service-worker.js', 'app', 'buildings', 'wayframe']);
  const dbDirectory = path.resolve(db.directory);

  function insideFolder(file, folder){
    const relative = path.relative(folder, file);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  function publicFile(pathname){
    // No backslashes, drive letters, alternate data streams or NUL bytes.
    if(/[\\:\0]/.test(pathname)) return null;
    const parts = pathname.split('/').filter(Boolean);
    if(!parts.length) return {parts, file:path.join(root, 'index.html')};
    if(!PUBLIC_ENTRIES.has(parts[0])) return null;
    // No dot-segments or hidden files, and no names Windows would silently
    // change (trailing dots or spaces).
    if(parts.some(part => part.startsWith('.') || /[. ]$/.test(part))) return null;
    const file = path.resolve(root, ...parts);
    if(!insideFolder(file, root) || insideFolder(file, dbDirectory)) return null;
    return {parts, file};
  }

  function serveStatic(req, res, url){
    let pathname;
    try{ pathname = decodeURIComponent(url.pathname); }catch(error){ return send(res, 400, 'Bad path'); }
    const target = publicFile(pathname);
    if(!target) return send(res, 404, 'Not found');
    let file = target.file;
    // The app reads the status file this server edits (it can be a copy, see --status-file).
    if(target.parts.join('/') === STATUS_RELATIVE) file = statusFile;
    fs.stat(file, (error, stats) => {
      if(!error && stats.isDirectory()){
        if(!pathname.endsWith('/')){
          // Built from the checked parts, so it can only point back to this server.
          res.writeHead(301, {Location:`/${target.parts.map(encodeURIComponent).join('/')}/`});
          return res.end();
        }
        file = path.join(file, 'index.html');
      }
      fs.readFile(file, (readError, content) => {
        if(readError) return send(res, 404, 'Not found');
        const headers = {
          'Content-Type':MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control':'no-cache',
          'X-Content-Type-Options':'nosniff'
        };
        if(target.parts.length === 1 && target.parts[0] === 'admin.html') Object.assign(headers, ADMIN_PAGE_HEADERS);
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : content);
      });
    });
  }

  // The admin page only runs its own script files: an injected <img onerror>
  // or inline script cannot run, and other sites cannot frame it.
  const ADMIN_PAGE_HEADERS = {
    'Content-Security-Policy':[
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '),
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'same-origin'
  };

  // Requests must name this server (localhost, or its network address with
  // --lan). This blocks DNS-rebinding pages that point their own domain at
  // 127.0.0.1 to reach the server from a browser.
  function hostAllowed(req){
    const header = String(req.headers.host || '').toLowerCase();
    const host = header.startsWith('[') ? header.slice(1, header.indexOf(']')) : header.replace(/:\d+$/, '');
    if(['localhost', '127.0.0.1', '::1'].includes(host)) return true;
    if(!options.lan) return false;
    return lanAddresses().includes(host) || host === os.hostname().toLowerCase() || host === `${os.hostname().toLowerCase()}.local`;
  }

  const server = http.createServer(async (req, res) => {
    if(!hostAllowed(req)) return send(res, 421, 'Unknown host');
    let url;
    try{ url = new URL(req.url, 'http://localhost'); }catch(error){ return send(res, 400, 'Bad request'); }
    if(!url.pathname.startsWith('/api/')){
      if(req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url);
    }
    const candidates = routes.filter(item => item.pattern.test(url.pathname));
    const match = candidates.find(item => item.method === req.method);
    if(!match) return send(res, candidates.length ? 405 : 404, {error:candidates.length ? 'Method not allowed.' : 'Unknown API.'});
    try{
      const result = await match.handler(req, url, res, url.pathname.match(match.pattern));
      send(res, 200, result);
    }catch(error){
      if(error instanceof HttpError) return send(res, error.status, {error:error.message, ...(error.extra || {})});
      console.error('[server]', error);
      send(res, 500, {error:'Server error. See the server window for details.'});
    }
  });

  // Fetch from the cloud inbox now and then while the server runs.
  if(cloudMinutes){
    const tick = () => {
      const config = cloudConfig();
      if(config.url && config.key && config.autoSync !== false){
        cloudSync().then(result => {
          if(result.reports) console.log(`[cloud] ${result.reports} new report(s) fetched from the cloud inbox.`);
        }).catch(error => console.warn(`[cloud] ${error.message}`));
      }
    };
    const first = setTimeout(tick, 3000);
    const timer = setInterval(tick, cloudMinutes * 60000);
    first.unref();
    timer.unref();
    server.on('close', () => { clearTimeout(first); clearInterval(timer); });
  }

  return {server, db, sessions, cloudSync};
}

// ── Command line ───────────────────────────────────────────────────────

function parseArgs(argv){
  const options = {port:Number(process.env.CAMPUSWAY_PORT) || 8080, lan:false, lanAdmin:false, collectUsage:true, cloudSyncMinutes:5};
  for(let i = 0; i < argv.length; i += 1){
    const arg = argv[i];
    if(arg === '--lan') options.lan = true;
    else if(arg === '--lan-admin'){ options.lan = true; options.lanAdmin = true; }
    else if(arg === '--no-usage') options.collectUsage = false;
    else if(arg === '--port') options.port = Number(argv[++i]);
    else if(arg === '--db') options.dbDir = path.resolve(argv[++i]);
    else if(arg === '--status-file') options.statusFile = path.resolve(argv[++i]);
    else if(arg === '--cloud-minutes') options.cloudSyncMinutes = Number(argv[++i]);
    else if(arg === '--max-data-gb') options.maxDataBytes = Number(argv[++i]) * 1024 ** 3;
    else if(arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

if(require.main === module){
  const options = parseArgs(process.argv.slice(2));
  if(options.help){
    console.log([
      'CampusWay local server',
      '',
      '  node server/campusway-server.js [--port 8080] [--lan] [--lan-admin] [--no-usage] [--db folder] [--status-file file]',
      '',
      '  --lan        let phones and computers on the same network open the app and send reports',
      '  --lan-admin  also allow the admin screen from other computers (passwords travel unencrypted)',
      '  --no-usage   do not collect anonymous usage counts',
      '  --db         folder for the database files (default server/db)',
      '  --status-file  status file to edit (default app/data/campus-status.json), e.g. a copy for testing',
      '  --cloud-minutes  how often to fetch from the cloud inbox when it is set up (default 5, 0 = only by hand)',
      '  --max-data-gb    storage limit for CampusWay data on this PC (default 10)'
    ].join('\n'));
    process.exit(0);
  }
  const {server, db} = createCampusWayServer(options);
  const host = options.lan ? '0.0.0.0' : '127.0.0.1';
  server.on('error', error => {
    if(error.code === 'EADDRINUSE') console.error(`Port ${options.port} is already in use. Close the other server or use --port 8081.`);
    else console.error(error);
    process.exit(1);
  });
  server.listen(options.port, host, () => {
    const lines = [
      '',
      '  CampusWay is running',
      `    App:    http://localhost:${options.port}/`,
      `    Admin:  http://localhost:${options.port}/admin.html`,
      `    Data:   ${db.directory}`
    ];
    if(options.lan){
      lanAddresses().forEach(address => lines.push(`    Phones: http://${address}:${options.port}/`));
      if(options.lanAdmin) lines.push('    Warning: the admin screen is reachable from your network over plain HTTP.');
    }
    lines.push('', '  Keep this window open. Press Ctrl+C to stop.', '');
    console.log(lines.join('\n'));
  });
}

module.exports = {createCampusWayServer, extractObjectLiteral, parseArgs};
