// CampusWay admin: the free cloud inbox (cloud/worker.mjs) that collects
// reports from the public site until this PC fetches them.
(function(){
  'use strict';
  const {h, clear, state} = Admin;

  // The suggested key is kept in this browser until the PC is connected, so
  // reloading the page does not show a different key from the one given to
  // wrangler.
  const KEY_STORAGE = 'campusway.admin.suggestedSyncKey';

  function randomKey(){
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function suggestedKey({fresh = false} = {}){
    let key = '';
    try{ key = fresh ? '' : localStorage.getItem(KEY_STORAGE) || ''; }catch(error){ /* storage unavailable */ }
    if(!key){
      key = randomKey();
      try{ localStorage.setItem(KEY_STORAGE, key); }catch(error){ /* storage unavailable */ }
    }
    return key;
  }

  function forgetSuggestedKey(){
    try{ localStorage.removeItem(KEY_STORAGE); }catch(error){ /* storage unavailable */ }
  }

  function copyButton(getText, label = 'Copy'){
    return h('button', {type:'button', class:'chip', onclick:async event => {
      const button = event.currentTarget;
      try{
        await navigator.clipboard.writeText(getText());
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = label; }, 1500);
      }catch(error){
        Admin.toast('Copy did not work. Select the text and copy it by hand.', 'error');
      }
    }}, label);
  }

  function command(textValue){
    return h('div', {class:'command'}, h('pre', {class:'code', text:textValue}), copyButton(() => textValue));
  }

  async function fetchNow(){
    const result = await Admin.api('POST', 'api/admin/cloud/sync', {});
    await Admin.loadReports();
    const {reports, counts} = result.result;
    Admin.toast(reports || counts
      ? `Fetched ${reports} new report(s) and ${counts} usage count(s) from the cloud inbox.`
      : 'The cloud inbox had nothing new.', 'success');
    return result;
  }

  function statusPanel(cloud){
    const configured = Boolean(cloud.url && cloud.hasKey);
    const published = state.status.reportEndpoint === cloud.url && Boolean(cloud.url);
    // "Connected" only after a fetch has really worked with the saved key.
    const state_ = !configured ? ['not set up', 'muted']
      : cloud.lastError ? ['problem', 'warning']
      : cloud.lastSync ? ['connected', 'success']
      : ['not checked yet', 'info'];
    const panel = h('section', {class:'panel'},
      h('div', {class:'panel-head'},
        h('h2', {text:'Status'}),
        Admin.badge(state_[0], state_[1])
      )
    );
    if(!configured){
      panel.append(h('p', {class:'muted', text:'Follow the steps below once. After that, this PC fetches new reports every few minutes while the server runs.'}));
      return panel;
    }
    panel.append(h('dl', {class:'facts'},
      h('dt', {text:'Inbox'}), h('dd', {}, h('code', {text:cloud.url})),
      h('dt', {text:'Last fetch'}), h('dd', {text:cloud.lastSync ? `${Admin.relative(cloud.lastSync)}${cloud.lastResult ? ` · ${cloud.lastResult.reports} report(s), ${cloud.lastResult.counts} count(s)` : ''}` : 'never'}),
      h('dt', {text:'Automatic'}), h('dd', {text:cloud.minutes && cloud.autoSync ? `every ${cloud.minutes} min while the server runs` : 'off — use Fetch now'}),
      h('dt', {text:'Public site'}), h('dd', {},
        published ? 'sends reports to this inbox' : h('span', {class:'text-warning', text:'not told about the inbox yet (step 5)'})
      ),
      h('dt', {text:'Live status'}), h('dd', {},
        cloud.liveUpToDate
          ? `published ${Admin.relative(cloud.lastPublish.at)} — the public site shows the latest announcements, outages and closures`
          : h('span', {class:'text-warning', text:cloud.lastPublish && cloud.lastPublish.error ? `not published: ${cloud.lastPublish.error}` : 'not published yet'})
      )
    ));
    if(cloud.lastError){
      panel.append(h('p', {class:'note note--warning', text:`Last problem${cloud.lastErrorAt ? ` (${Admin.relative(cloud.lastErrorAt)})` : ''}: ${cloud.lastError}${/sync key/i.test(cloud.lastError) ? ' Fix: in a terminal in the CampusWay folder, run “node cloud/update-inbox.mjs”. It gives the inbox the key saved on this PC.' : ''}`}));
    }else if(!cloud.lastSync){
      panel.append(h('p', {class:'note note--info', text:'Press Fetch now to check that the inbox accepts the saved sync key.'}));
    }
    if(Admin.can('reports')){
      panel.append(h('div', {class:'panel-actions'}, h('button', {type:'button', class:'btn btn-primary btn-sm', onclick:async event => {
        event.currentTarget.disabled = true;
        try{ await fetchNow(); }catch(error){ Admin.toast(error.message, 'error', 8000); }
        Admin.rerender();
      }}, 'Fetch now')));
    }
    return panel;
  }

  function setupSteps(cloud){
    const configured = Boolean(cloud.url && cloud.hasKey);
    let key = suggestedKey();
    const keyText = h('code', {class:'key-text', text:key});
    const isAdmin = Admin.can('users');

    const urlInput = h('input', {type:'url', value:cloud.url || '', placeholder:'https://campusway-inbox.your-name.workers.dev', disabled:!isAdmin});
    const keyInput = h('input', {type:'password', placeholder:cloud.hasKey ? 'Saved — paste a new key only to change it' : 'Paste the sync key from step 2', autocomplete:'off', disabled:!isAdmin});
    const useKey = h('button', {type:'button', class:'link-btn', onclick:() => { keyInput.value = key; Admin.toast('The key from step 2 is filled in.', 'info'); }}, 'Use the key from step 2');
    const testResult = h('div');

    const publish = () => {
      state.draft.reportEndpoint = cloud.url;
      Admin.markDirty();
      Admin.toast('Added to the draft. Press “Save to live status”, then commit and push app/data/campus-status.json.', 'success', 9000);
    };

    const steps = h('ol', {class:'steps'},
      h('li', {},
        h('h3', {text:'Create a free Cloudflare account'}),
        h('p', {}, 'Sign up at ', h('a', {href:'https://dash.cloudflare.com/sign-up', target:'_blank', rel:'noopener', text:'dash.cloudflare.com'}), '. The free plan is enough and needs no credit card.')
      ),
      h('li', {},
        h('h3', {text:'Make a sync key'}),
        h('p', {text:'A long random password that only this PC and the inbox know. Keep it private; it is not stored in the project files.'}),
        h('div', {class:'command'}, keyText,
          copyButton(() => key),
          h('button', {type:'button', class:'chip', onclick:() => { key = suggestedKey({fresh:true}); keyText.textContent = key; }}, 'New key')
        ),
        h('p', {class:'muted', text:'This key stays the same until the PC is connected. Use exactly this key in step 3 and step 4.'})
      ),
      h('li', {},
        h('h3', {text:'Put the inbox online'}),
        h('p', {}, 'In a terminal, in the CampusWay folder. Node.js downloads Cloudflare’s ', h('code', {text:'wrangler'}), ' tool the first time.'),
        command('cd cloud\nnpx wrangler login\nnpx wrangler d1 create campusway-inbox'),
        h('p', {}, 'Copy the ', h('code', {text:'database_id'}), ' it prints into ', h('code', {text:'cloud/wrangler.toml'}), ', then:'),
        command('npx wrangler d1 execute campusway-inbox --remote --file schema.sql\nnpx wrangler secret put SYNC_KEY\nnpx wrangler deploy'),
        h('p', {class:'muted'}, 'When asked for SYNC_KEY, paste the key from step 2. ', h('code', {text:'deploy'}), ' prints the inbox address, ending in ', h('code', {text:'.workers.dev'}), '.')
      ),
      h('li', {},
        h('h3', {text:'Connect this PC'}),
        isAdmin ? null : h('p', {class:'note note--info', text:'Only an administrator can change these settings.'}),
        h('div', {class:'field-row'}, Admin.field('Inbox address', urlInput), Admin.field('Sync key', keyInput)),
        isAdmin ? useKey : null,
        isAdmin ? h('div', {class:'panel-actions'}, h('button', {type:'button', class:'btn btn-primary btn-sm', onclick:async () => {
          try{
            const saved = await Admin.api('PUT', 'api/admin/cloud', {url:urlInput.value, key:keyInput.value || undefined});
            keyInput.value = '';
            if(!saved.test){
              clear(testResult).append(h('p', {class:'note note--info', text:'The cloud inbox is turned off.'}));
              return;
            }
            if(!saved.test.ok){
              clear(testResult).append(h('p', {class:'note note--warning', text:saved.test.message}));
              return;
            }
            // The inbox answered; now check the key with a real fetch.
            try{
              await fetchNow();
              forgetSuggestedKey();
              clear(testResult).append(h('p', {class:'note note--info', text:'Connected: the inbox answered and accepted the sync key.'}));
              Admin.rerender();
            }catch(error){
              clear(testResult).append(h('p', {class:'note note--warning', text:/sync key/i.test(error.message)
                ? 'The inbox is online, but the sync key does not match the one stored in Cloudflare. In a terminal in the CampusWay folder, run “node cloud/update-inbox.mjs”: it gives the inbox the key you just saved here. Then press Fetch now.'
                : error.message}));
            }
          }catch(error){ Admin.toast(error.message, 'error', 8000); }
        }}, 'Save and test')) : null,
        testResult
      ),
      h('li', {},
        h('h3', {text:'Tell the public site about the inbox'}),
        h('p', {}, 'This puts the inbox address in the live status file as ', h('code', {text:'reportEndpoint'}), '. After you save and push it, phones using the GitHub Pages site send their reports there.'),
        Admin.can('settings') && cloud.url
          ? h('button', {type:'button', class:'btn btn-ghost btn-sm', disabled:state.draft.reportEndpoint === cloud.url, onclick:publish},
            state.draft.reportEndpoint === cloud.url ? 'Already in the status file' : 'Add the inbox address to the live status')
          : h('p', {class:'muted', text:cloud.url ? 'Your role cannot change this setting.' : 'Finish step 4 first.'})
      )
    );

    return h('details', {class:'panel setup', open:!configured || undefined},
      h('summary', {}, h('h2', {text:configured ? 'Setup steps' : 'Set up the cloud inbox (about 15 minutes)'})),
      steps
    );
  }

  async function render(page){
    const cloud = await Admin.api('GET', 'api/admin/cloud');
    page.append(Admin.pageHeader('Cloud inbox',
      'A free Cloudflare service that collects problem reports and usage counts from the public GitHub Pages site. This PC fetches them, so the PC stays the database.'));
    page.append(h('div', {class:'two-col'},
      statusPanel(cloud),
      h('section', {class:'panel'},
        h('div', {class:'panel-head'}, h('h2', {text:'How it works'})),
        h('ul', {class:'plain-list'},
          h('li', {text:'Phones on the public site send reports and anonymous counts to the inbox.'}),
          h('li', {text:'This PC fetches them every few minutes while the server runs, then the inbox deletes the report text.'}),
          h('li', {text:'The inbox keeps only each report’s id and status for 60 days, so reporters can see when it is fixed.'}),
          h('li', {text:'Unfetched reports are deleted after 90 days. Limits: 30 reports per device per hour, 5,000 waiting reports.'})
        )
      )
    ));
    page.append(setupSteps(cloud));
  }

  Admin.fetchFromCloud = fetchNow;
  Admin.register('cloud', {title:'Cloud inbox', icon:'☁', render});
})();
