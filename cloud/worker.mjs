// CampusWay cloud inbox: a free Cloudflare Worker that collects problem reports
// and anonymous usage counts from the public CampusWay site, until the
// CampusWay server on the team's PC fetches them (server/campusway-server.js).
//
// The PC stays the real database. The inbox only holds reports that have not
// been fetched yet, plus each report's status so reporters can see progress.
//
// Public endpoints (same paths as the local server, so the app treats both alike):
//   GET  /api/health
//   POST /api/reports          {reports:[...]}
//   GET  /api/reports/status   ?ids=a,b
//   POST /api/usage            {type, key}
// For the PC only (Authorization: Bearer <SYNC_KEY>):
//   POST /api/sync             {ackReports, ackUsage, statuses}

const KINDS = ['elevator', 'elevator-group', 'restroom', 'rest-space', 'landmark', 'other'];
const PROBLEMS = ['one-out', 'all-out', 'quiet', 'noisy', 'crowded', 'out-of-service', 'doors', 'closed', 'accessible-stall', 'cleaning', 'blocked', 'other'];
const STATUSES = ['new', 'acknowledged', 'in-progress', 'resolved', 'rejected'];
const USAGE_TYPES = ['route', 'search-miss', 'no-step-free', 'language', 'profile', 'indoor-mode'];

// Limits keep the inbox far inside Cloudflare's free plan (at the time of
// writing: 5 GB of D1 storage, 100,000 Worker requests, 100,000 rows written
// and 5,000,000 rows read per day). On the free plan going over a Cloudflare
// limit makes requests fail until the next day; it never creates a bill.
const LIMITS = {
  reportsPerHour:30,          // per device (hashed address)
  usagePerHour:600,
  reportsPerRequest:20,
  maxPending:5000,            // undelivered reports kept at most
  keysPerDay:500,             // distinct usage keys per type and day
  deliveredKeepDays:60,       // status lookups after the PC fetched a report
  pendingKeepDays:90,         // reports the PC never fetched
  syncBatch:200,
  maxDbMb:100,                // inbox database size cap (env MAX_DB_MB)
  reportsPerDay:1000,         // report submissions for the whole inbox (env REPORTS_PER_DAY)
  usagePerDay:20000           // usage counts for the whole inbox (env USAGE_PER_DAY)
};

const FREE_PLAN = {
  storageBytes:5 * 1024 ** 3,
  requestsPerDay:100000,
  rowsWrittenPerDay:100000,
  rowsReadPerDay:5000000
};

function text(value, max){
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

// Free text from the public never carries markup.
function plain(value, max){
  return text(String(value === undefined || value === null ? '' : value).replace(/[<>]/g, ''), max);
}

function cleanReport(input, now){
  const time = Number(input.time);
  return {
    id:/^[a-z0-9]{6,40}$/i.test(String(input.id || '')) ? String(input.id) : `r${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    time:Number.isFinite(time) && time <= now + 300000 && now - time < 30 * 86400000 ? time : now,
    receivedAt:now,
    kind:KINDS.includes(input.kind) ? input.kind : 'other',
    building:plain(input.building, 40),
    buildingName:plain(input.buildingName, 160),
    connectorId:plain(input.connectorId, 60),
    connectorIds:(Array.isArray(input.connectorIds) ? input.connectorIds : []).map(value => plain(value, 60)).filter(Boolean).slice(0, 20),
    nodeId:plain(input.nodeId, 60),
    label:plain(input.label, 200),
    problem:PROBLEMS.includes(input.problem) ? input.problem : 'other',
    note:plain(input.note, 500),
    lang:['en', 'he', 'ar', 'ru'].includes(input.lang) ? input.lang : ''
  };
}

function dayIn(timeZone, now){
  try{
    return new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(now));
  }catch(error){
    return new Date(now).toISOString().slice(0, 10);
  }
}

async function sha256(value){
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b){
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let difference = left.length ^ right.length;
  for(let i = 0; i < Math.max(left.length, right.length); i += 1){
    difference |= (left[i] || 0) ^ (right[i] || 0);
  }
  return difference === 0;
}

class HttpError extends Error{
  constructor(status, message){
    super(message);
    this.status = status;
  }
}

// ── Storage on Cloudflare D1 (SQLite). Tables: cloud/schema.sql ──
// Every D1 result reports the database size in meta.size_after, so the inbox
// knows its size without extra queries (which would count toward the free
// plan's daily row reads).
export function d1Store(db){
  const placeholders = count => Array.from({length:count}, (_, i) => `?${i + 1}`).join(', ');
  let size = null;
  const track = result => {
    const value = result && result.meta ? Number(result.meta.size_after) : NaN;
    if(Number.isFinite(value) && value > 0) size = value;
    return result;
  };
  const rows = async statement => (track(await statement.all()).results || []);
  return {
    lastSize:() => size,
    async hit(bucket, expires){
      const [row] = await rows(db.prepare(
        'INSERT INTO hits (bucket, count, expires) VALUES (?1, 1, ?2) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count'
      ).bind(bucket, expires));
      return row ? Number(row.count) : 1;
    },
    async getHit(bucket){
      const [row] = await rows(db.prepare('SELECT count FROM hits WHERE bucket = ?1').bind(bucket));
      return row ? Number(row.count) : 0;
    },
    async pendingCount(){
      const [row] = await rows(db.prepare('SELECT COUNT(*) AS n FROM reports WHERE delivered_at IS NULL'));
      return row ? Number(row.n) : 0;
    },
    async insertReports(reports){
      if(!reports.length) return;
      (await db.batch(reports.map(report => db.prepare(
        'INSERT OR IGNORE INTO reports (id, received_at, payload) VALUES (?1, ?2, ?3)'
      ).bind(report.id, report.receivedAt, JSON.stringify(report))))).forEach(track);
    },
    async statuses(ids){
      if(!ids.length) return {};
      const results = await rows(db.prepare(`SELECT id, status FROM reports WHERE id IN (${placeholders(ids.length)})`).bind(...ids));
      return Object.fromEntries(results.map(row => [row.id, row.status]));
    },
    async addUsage(day, type, key, count){
      const [existing] = await rows(db.prepare('SELECT count FROM usage WHERE day = ?1 AND type = ?2 AND key = ?3').bind(day, type, key));
      if(!existing){
        const [row] = await rows(db.prepare('SELECT COUNT(*) AS n FROM usage WHERE day = ?1 AND type = ?2').bind(day, type));
        if(row && Number(row.n) >= LIMITS.keysPerDay) return;
      }
      track(await db.prepare(
        'INSERT INTO usage (day, type, key, count) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(day, type, key) DO UPDATE SET count = count + excluded.count'
      ).bind(day, type, key, count).run());
    },
    async markDelivered(ids, now){
      if(!ids.length) return;
      // The PC has the report now: keep only its id and status in the cloud.
      track(await db.prepare(`UPDATE reports SET payload = NULL, delivered_at = ?1 WHERE delivered_at IS NULL AND id IN (${ids.map((_, i) => `?${i + 2}`).join(', ')})`)
        .bind(now, ...ids).run());
    },
    async setStatuses(entries){
      if(!entries.length) return;
      (await db.batch(entries.map(([id, status]) => db.prepare('UPDATE reports SET status = ?2 WHERE id = ?1').bind(id, status)))).forEach(track);
    },
    async ackUsage(list){
      if(!list.length) return;
      (await db.batch([
        ...list.map(row => db.prepare('UPDATE usage SET count = count - ?4 WHERE day = ?1 AND type = ?2 AND key = ?3').bind(row.day, row.type, row.key, row.count)),
        db.prepare('DELETE FROM usage WHERE count <= 0')
      ])).forEach(track);
    },
    async cleanup(now){
      (await db.batch([
        db.prepare('DELETE FROM reports WHERE (delivered_at IS NOT NULL AND delivered_at < ?1) OR (delivered_at IS NULL AND received_at < ?2)')
          .bind(now - LIMITS.deliveredKeepDays * 86400000, now - LIMITS.pendingKeepDays * 86400000),
        db.prepare('DELETE FROM hits WHERE expires < ?1').bind(now)
      ])).forEach(track);
    },
    async pendingReports(limit){
      const results = await rows(db.prepare('SELECT payload FROM reports WHERE delivered_at IS NULL ORDER BY received_at LIMIT ?1').bind(limit));
      return results.map(row => { try{ return JSON.parse(row.payload); }catch(error){ return null; } }).filter(Boolean);
    },
    async usageRows(limit){
      const results = await rows(db.prepare('SELECT day, type, key, count FROM usage WHERE count > 0 ORDER BY day LIMIT ?1').bind(limit));
      return results.map(row => ({day:row.day, type:row.type, key:row.key, count:Number(row.count)}));
    }
  };
}

// ── Request handling ──
export function createApp({store, env = {}, now = () => Date.now()}){
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean);
  const timeZone = env.TIMEZONE || 'Asia/Jerusalem';

  function corsHeaders(request){
    const origin = request.headers.get('Origin');
    if(!origin || !allowed.includes(origin)) return {Vary:'Origin'};
    return {
      'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',
      'Access-Control-Max-Age':'86400',
      Vary:'Origin'
    };
  }

  function json(request, status, body){
    return new Response(JSON.stringify(body), {
      status,
      headers:{'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...corsHeaders(request)}
    });
  }

  async function readJson(request, maxBytes){
    const type = request.headers.get('Content-Type') || '';
    if(!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
    const raw = await request.text();
    if(raw.length > maxBytes) throw new HttpError(413, 'Request too large.');
    try{ return raw ? JSON.parse(raw) : {}; }catch(error){ throw new HttpError(400, 'Invalid JSON.'); }
  }

  function checkOrigin(request){
    const origin = request.headers.get('Origin');
    if(origin && !allowed.includes(origin)) throw new HttpError(403, 'This site may not send to the CampusWay inbox.');
  }

  async function limit(request, kind, max){
    const address = request.headers.get('CF-Connecting-IP') || 'unknown';
    const hour = Math.floor(now() / 3600000);
    // Addresses are hashed with the secret key, so the inbox never stores them.
    const bucket = `${kind}:${hour}:${(await sha256(`${env.SYNC_KEY || ''}|${address}`)).slice(0, 32)}`;
    const count = await store.hit(bucket, (hour + 2) * 3600000);
    return count <= max;
  }

  const number = (value, fallback) => Number(value) > 0 ? Number(value) : fallback;
  const caps = {
    maxDbBytes:number(env.MAX_DB_MB, LIMITS.maxDbMb) * 1024 * 1024,
    reportsPerDay:number(env.REPORTS_PER_DAY, LIMITS.reportsPerDay),
    usagePerDay:number(env.USAGE_PER_DAY, LIMITS.usagePerDay)
  };

  // A whole-inbox daily cap, so even many devices together stay inside the
  // free plan's daily limits.
  async function dailyCap(kind, max){
    const day = dayIn(timeZone, now());
    return await store.hit(`day:${kind}:${day}`, now() + 3 * 86400000) <= max;
  }

  // Waiting reports are counted at most every 5 minutes (counting reads rows).
  let pending = {at:-Infinity, count:0};
  async function inboxFull(){
    if(now() - pending.at > 300000) pending = {at:now(), count:await store.pendingCount()};
    const size = store.lastSize ? store.lastSize() : null;
    if(Number.isFinite(size) && size >= caps.maxDbBytes) return 'The inbox has reached its storage limit until the campus team fetches it.';
    if(pending.count >= LIMITS.maxPending) return 'The inbox is full until the campus team fetches it.';
    return '';
  }

  const routes = {
    'GET /api/health':async () => ({ok:true, app:'campusway', cloud:true}),

    'POST /api/reports':async request => {
      checkOrigin(request);
      const body = await readJson(request, 12 * 1024);
      if(!await limit(request, 'r', LIMITS.reportsPerHour)) throw new HttpError(429, 'Too many reports from this device. Try again later.');
      const full = await inboxFull();
      if(full) throw new HttpError(503, full);
      if(!await dailyCap('r', caps.reportsPerDay)) throw new HttpError(503, 'The inbox has taken all the reports it accepts today. Try again tomorrow.');
      const time = now();
      const incoming = (Array.isArray(body.reports) ? body.reports : [body]).slice(0, LIMITS.reportsPerRequest)
        .filter(item => item && typeof item === 'object');
      const reports = incoming.map(item => cleanReport(item, time));
      await store.insertReports(reports);
      pending.count += reports.length;
      return {ok:true, accepted:reports.map(report => report.id)};
    },

    'GET /api/reports/status':async (request, url) => {
      const ids = String(url.searchParams.get('ids') || '').split(',').map(id => id.trim()).filter(id => /^[a-z0-9]{6,40}$/i.test(id)).slice(0, 50);
      return {statuses:await store.statuses(ids)};
    },

    'POST /api/usage':async request => {
      checkOrigin(request);
      const body = await readJson(request, 2 * 1024);
      const type = String(body.type || '');
      if(!USAGE_TYPES.includes(type)) return {ok:false};
      if(!await limit(request, 'u', LIMITS.usagePerHour)) return {ok:false};
      if(await inboxFull()) return {ok:false};
      if(!await dailyCap('u', caps.usagePerDay)) return {ok:false};
      await store.addUsage(dayIn(timeZone, now()), type, text(body.key, 80).toLowerCase() || '(none)', 1);
      return {ok:true};
    },

    'POST /api/sync':async request => {
      const header = request.headers.get('Authorization') || '';
      if(!env.SYNC_KEY || String(env.SYNC_KEY).length < 24) throw new HttpError(503, 'SYNC_KEY is not set on the Worker (at least 24 characters).');
      if(!safeEqual(header, `Bearer ${env.SYNC_KEY}`)) throw new HttpError(401, 'Wrong sync key.');
      const body = await readJson(request, 512 * 1024);
      const time = now();
      const ackReports = (Array.isArray(body.ackReports) ? body.ackReports : []).map(String).filter(id => /^[a-z0-9]{6,40}$/i.test(id)).slice(0, 1000);
      const ackUsage = (Array.isArray(body.ackUsage) ? body.ackUsage : [])
        .filter(row => row && /^\d{4}-\d{2}-\d{2}$/.test(row.day) && USAGE_TYPES.includes(row.type) && Number.isInteger(row.count) && row.count > 0)
        .map(row => ({day:row.day, type:row.type, key:text(row.key, 80), count:row.count}))
        .slice(0, 5000);
      const statuses = Object.entries(body.statuses && typeof body.statuses === 'object' ? body.statuses : {})
        .filter(([id, status]) => /^[a-z0-9]{6,40}$/i.test(id) && STATUSES.includes(status))
        .slice(0, 5000);

      // Process in chunks so each D1 statement stays small.
      for(let i = 0; i < ackReports.length; i += 50) await store.markDelivered(ackReports.slice(i, i + 50), time);
      for(let i = 0; i < ackUsage.length; i += 100) await store.ackUsage(ackUsage.slice(i, i + 100));
      for(let i = 0; i < statuses.length; i += 100) await store.setStatuses(statuses.slice(i, i + 100));
      await store.cleanup(time);

      const reports = await store.pendingReports(LIMITS.syncBatch);
      const usage = await store.usageRows(1000);
      const today = dayIn(timeZone, time);
      pending = {at:time, count:await store.pendingCount()};
      const stats = {
        at:time,
        dbBytes:store.lastSize ? store.lastSize() : null,
        pendingReports:pending.count,
        reportsToday:await store.getHit(`day:r:${today}`),
        usageToday:await store.getHit(`day:u:${today}`),
        limits:{
          maxDbBytes:caps.maxDbBytes,
          maxPending:LIMITS.maxPending,
          reportsPerDay:caps.reportsPerDay,
          usagePerDay:caps.usagePerDay,
          reportsPerDeviceHour:LIMITS.reportsPerHour,
          usagePerDeviceHour:LIMITS.usagePerHour
        },
        freePlan:FREE_PLAN
      };
      return {reports, usage, more:reports.length === LIMITS.syncBatch, serverTime:time, stats};
    }
  };

  return async function handle(request){
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if(request.method === 'OPTIONS'){
      return new Response(null, {status:204, headers:corsHeaders(request)});
    }
    const route = routes[`${request.method} ${path}`];
    if(!route){
      const exists = Object.keys(routes).some(key => key.endsWith(` ${path}`));
      return json(request, exists ? 405 : 404, {error:exists ? 'Method not allowed.' : 'Unknown address.'});
    }
    try{
      return json(request, 200, await route(request, url));
    }catch(error){
      if(error instanceof HttpError) return json(request, error.status, {error:error.message});
      console.error(error);
      return json(request, 500, {error:'Inbox error.'});
    }
  };
}

export default {
  async fetch(request, env){
    if(!env.DB) return new Response(JSON.stringify({error:'The D1 database binding "DB" is missing. See cloud/README.md.'}), {status:500, headers:{'Content-Type':'application/json'}});
    return createApp({store:d1Store(env.DB), env})(request);
  }
};

export {LIMITS, FREE_PLAN, cleanReport, dayIn};
