// In-memory stand-in for the cloud inbox's D1 store (cloud/worker.mjs d1Store),
// with the same behaviour, for tests that run without Cloudflare.
const DAY = 86400000;

function memoryStore(limits = {keysPerDay:500, deliveredKeepDays:60, pendingKeepDays:90}){
  const reports = new Map();   // id → {receivedAt, payload, status, deliveredAt}
  const usage = new Map();     // day|type|key → {day, type, key, count}
  const hits = new Map();      // bucket → {count, expires}
  return {
    reports, usage, hits,
    // Rough size, like D1's meta.size_after; tests can override it.
    sizeOverride:null,
    lastSize(){
      if(this.sizeOverride !== null) return this.sizeOverride;
      return JSON.stringify([...reports, ...usage, ...hits]).length;
    },
    async getHit(bucket){
      return hits.has(bucket) ? hits.get(bucket).count : 0;
    },
    async hit(bucket, expires){
      const row = hits.get(bucket) || {count:0, expires};
      row.count += 1;
      hits.set(bucket, row);
      return row.count;
    },
    async pendingCount(){
      return [...reports.values()].filter(row => row.deliveredAt === null).length;
    },
    async insertReports(list){
      list.forEach(report => {
        if(!reports.has(report.id)) reports.set(report.id, {receivedAt:report.receivedAt, payload:JSON.stringify(report), status:'new', deliveredAt:null});
      });
    },
    async statuses(ids){
      return Object.fromEntries(ids.filter(id => reports.has(id)).map(id => [id, reports.get(id).status]));
    },
    async addUsage(day, type, key, count){
      const id = `${day}|${type}|${key}`;
      if(!usage.has(id)){
        if([...usage.values()].filter(row => row.day === day && row.type === type).length >= limits.keysPerDay) return;
        usage.set(id, {day, type, key, count:0});
      }
      usage.get(id).count += count;
    },
    async markDelivered(ids, now){
      ids.forEach(id => {
        const row = reports.get(id);
        if(row && row.deliveredAt === null){ row.payload = null; row.deliveredAt = now; }
      });
    },
    async setStatuses(entries){
      entries.forEach(([id, status]) => { if(reports.has(id)) reports.get(id).status = status; });
    },
    async ackUsage(rows){
      rows.forEach(row => {
        const id = `${row.day}|${row.type}|${row.key}`;
        if(usage.has(id)) usage.get(id).count -= row.count;
      });
      [...usage].forEach(([id, row]) => { if(row.count <= 0) usage.delete(id); });
    },
    async cleanup(now){
      [...reports].forEach(([id, row]) => {
        if((row.deliveredAt !== null && row.deliveredAt < now - limits.deliveredKeepDays * DAY) ||
          (row.deliveredAt === null && row.receivedAt < now - limits.pendingKeepDays * DAY)) reports.delete(id);
      });
      [...hits].forEach(([bucket, row]) => { if(row.expires < now) hits.delete(bucket); });
    },
    async pendingReports(limit){
      return [...reports.values()].filter(row => row.deliveredAt === null)
        .sort((a, b) => a.receivedAt - b.receivedAt).slice(0, limit).map(row => JSON.parse(row.payload));
    },
    async usageRows(limit){
      return [...usage.values()].filter(row => row.count > 0).sort((a, b) => a.day.localeCompare(b.day)).slice(0, limit).map(row => ({...row}));
    }
  };
}

module.exports = {memoryStore};
