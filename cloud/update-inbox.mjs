// Puts the cloud inbox online with the current code and the sync key saved
// on this PC (server/db/cloud.json), so the two keys always match.
//
//   node cloud/update-inbox.mjs
//
// Needs a Cloudflare login on this PC (npx wrangler login, once).
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.join(here, '..', 'server', 'db', 'cloud.json');

function stop(message){
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

let key = '';
try{
  key = String(JSON.parse(fs.readFileSync(configFile, 'utf8')).key || '');
}catch(error){
  stop('No cloud inbox settings on this PC yet. In the admin screen, open Cloud inbox and save the inbox address and a sync key first (step 4).');
}
if(key.length < 24) stop('The sync key saved on this PC is missing or too short. Save one in the admin screen (Cloud inbox, step 4) first.');

// The commands are fixed text (no input from anywhere else). Windows needs a
// shell to start npx, so the whole command is passed as one string.
const wrangler = (args, options = {}) => spawnSync(['npx', '--yes', 'wrangler', ...args].join(' '), {
  cwd:here,
  shell:true,
  stdio:options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
  input:options.input
});

console.log('\n  1/2  Giving the inbox the sync key saved on this PC…\n');
// The key goes through standard input, exactly as saved: never shown or written anywhere else.
if(wrangler(['secret', 'put', 'SYNC_KEY'], {input:key}).status !== 0){
  stop('Storing the key failed. If wrangler says you are not logged in, run "npx wrangler login" in the cloud folder and try again.');
}

console.log('\n  2/2  Putting the latest inbox code online…\n');
if(wrangler(['deploy']).status !== 0) stop('Deploying failed. See the messages above.');

console.log('\n  Done. In the admin screen, open Cloud inbox and press "Fetch now" to check the connection.\n');
