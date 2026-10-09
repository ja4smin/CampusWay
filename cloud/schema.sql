-- CampusWay cloud inbox (Cloudflare D1). Run once:
--   npx wrangler d1 execute campusway-inbox --remote --file schema.sql

-- Reports waiting for the PC. After the PC fetches one, its payload is cleared
-- and only the id and status stay, so reporters can see progress.
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS reports_pending ON reports (delivered_at, received_at);

-- Anonymous counts per day, removed once the PC has fetched them.
CREATE TABLE IF NOT EXISTS usage (
  day TEXT NOT NULL,
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, type, key)
);

-- Rate limits: hourly counters per hashed address, removed after two hours.
CREATE TABLE IF NOT EXISTS hits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
