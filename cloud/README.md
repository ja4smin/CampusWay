# CampusWay cloud inbox

A free [Cloudflare Worker](https://developers.cloudflare.com/workers/) with a [D1](https://developers.cloudflare.com/d1/) database that collects problem reports and anonymous usage counts from the public CampusWay site. The CampusWay server on the team's PC fetches them every few minutes, so the PC stays the real database ([docs/17-admin-screen.md](../docs/17-admin-screen.md)).

```
Phones on GitHub Pages ──reports, counts──▶ cloud inbox ◀──fetch every 5 min── PC server (admin screen)
                       ◀──report status─────            ──report statuses──▶
```

| File | What it is |
|---|---|
| `worker.mjs` | The Worker: public endpoints for the app (reports, counts, the live status) and key-protected `/api/sync` and `PUT /api/status` for the PC |
| `schema.sql` | The D1 tables |
| `wrangler.toml` | Worker settings: name, allowed sites, time zone, database |

## What it keeps

- **The live campus status** the admin screen publishes on every save (announcements, emergency mode, outages, closures, names, hours). The public app reads it from here, so changes are live without a commit.

- **Reports waiting for the PC**, deleted after 90 days if never fetched. Once fetched, the text is deleted and only the id and status stay for 60 days, so reporters can see "Fixed" in the app.
- **Usage counts** (destination, failed search, language…) per day, deleted once fetched.
- **Rate-limit counters** per device for two hours. Addresses are stored only as salted hashes.

Limits: 30 reports and 600 counts per device per hour, 20 reports per request, 5,000 waiting reports, and for the whole inbox 1,000 reports and 20,000 counts per day and a 100 MB database (`MAX_DB_MB`, `REPORTS_PER_DAY`, `USAGE_PER_DAY` in `wrangler.toml`). Above a limit the inbox refuses new data and phones keep their reports for later. The admin screen's **Storage** page shows the inbox's numbers after each fetch.

## Staying free

On Cloudflare's Free plan, going over a limit does not create a bill: requests fail until the limit resets the next day. Charges are only possible after upgrading to the paid Workers plan, which needs a payment method. Check once in the dashboard: **Workers & Pages → Plans** says **Free**, and **Manage account → Billing** has no subscription. The inbox's own caps keep it far below the free limits anyway.

## Set it up (about 15 minutes)

The admin screen (**Cloud inbox** page) shows these steps with copy buttons and a generated key.

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up). No credit card is needed.
2. Make a sync key: a random secret of at least 24 characters (the admin screen generates one).
3. In a terminal, in this folder (Node.js downloads Cloudflare's `wrangler` tool the first time):

   ```powershell
   npx wrangler login
   npx wrangler d1 create campusway-inbox
   ```

   Copy the `database_id` it prints into `wrangler.toml`, then:

   ```powershell
   npx wrangler d1 execute campusway-inbox --remote --file schema.sql
   npx wrangler secret put SYNC_KEY
   npx wrangler deploy
   ```

   Paste the key when asked for `SYNC_KEY`. `deploy` prints the address, for example `https://campusway-inbox.your-name.workers.dev`.
4. In the admin screen, **Cloud inbox → Connect this PC**: paste the address and the key, then **Save and test**.
5. **Tell the public site about the inbox**: this sets `reportEndpoint` in `app/data/campus-status.json`. Save, then commit and push the file.

If the site moves to another domain, add it to `ALLOWED_ORIGINS` in `wrangler.toml` and run `npx wrangler deploy` again.

## Updating the inbox, or fixing "Wrong sync key"

From the CampusWay folder:

```powershell
node cloud/update-inbox.mjs
```

It gives the inbox the sync key saved on this PC (so the two always match, with no copy-paste) and deploys the latest `worker.mjs`. Run it after changing the key in the admin screen or after updating CampusWay.

## Free plan

A campus app stays far inside Cloudflare's free limits for Workers and D1 (at the time of writing, about 100,000 requests a day and 5 GB of storage). Check the current numbers on Cloudflare's pricing pages. If a limit is ever reached, the app keeps reports on the phone and sends them later.

## Testing

`tests/cloud-inbox.test.cjs` runs the Worker in Node with an in-memory store and checks the full round trip with the PC server. No Cloudflare account is needed:

```powershell
node --test tests/cloud-inbox.test.cjs
```

To try the real Worker locally: `npx wrangler dev` (uses a local D1 database; run the `schema.sql` step with `--local` first).
