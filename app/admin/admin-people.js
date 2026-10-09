// CampusWay admin: admin accounts, activity log and status-file history.
(function(){
  'use strict';
  const {h, clear, state, Schema} = Admin;

  const TABS = [
    {id:'log', text:'Activity log'},
    {id:'history', text:'Status history'},
    {id:'accounts', text:'Admin accounts'},
    {id:'me', text:'My account'}
  ];

  const ACTION_TEXT = {
    'user.setup':'created the first administrator',
    'user.login':'signed in',
    'user.password':'changed their password',
    'user.create':'added an admin account',
    'user.update':'changed an admin account',
    'status.save':'saved the live status',
    'status.restore':'restored an older live status',
    'report.create':'added a report',
    'report.update':'updated reports',
    'tests.run':'started the automated tests',
    'tests.done':'automated tests finished'
  };

  function roleOptions(value){
    return Admin.select(Object.entries(state.roles).map(([id, role]) => ({value:id, text:role.label})), value);
  }

  function roleHelp(){
    return h('ul', {class:'role-help'}, Object.entries(state.roles).map(([id, role]) =>
      h('li', {}, h('strong', {text:`${role.label}: `}), role.description)
    ));
  }

  function userForm(user){
    const isNew = !user;
    const displayName = h('input', {value:user ? user.displayName : '', maxlength:'80'});
    const username = h('input', {value:user ? user.username : '', disabled:!isNew, autocomplete:'off', pattern:'[a-zA-Z0-9._\\-]{3,40}'});
    const role = roleOptions(user ? user.role : 'facilities');
    const password = h('input', {type:'password', autocomplete:'new-password', placeholder:isNew ? 'At least 8 characters' : 'Leave empty to keep the current password'});
    const active = h('input', {type:'checkbox', checked:user ? user.active !== false : true});
    Admin.modal({
      title:isNew ? 'Add admin account' : `Edit ${user.username}`,
      body:h('div', {class:'editor'},
        h('div', {class:'field-row'}, Admin.field('Name', displayName), Admin.field('User name', username)),
        Admin.field('Role', role),
        roleHelp(),
        Admin.field(isNew ? 'Password' : 'New password', password, isNew ? 'Give it to the person in private; they can change it under “My account”.' : null),
        isNew ? null : h('label', {class:'inline-check'}, active, ' Account can sign in')
      ),
      actions:[
        {text:'Cancel'},
        {text:isNew ? 'Add account' : 'Save', kind:'primary', onClick:async () => {
          if(isNew){
            await Admin.api('POST', 'api/admin/users', {displayName:displayName.value, username:username.value, role:role.value, password:password.value});
          }else{
            const body = {displayName:displayName.value, role:role.value, active:active.checked};
            if(password.value) body.password = password.value;
            await Admin.api('PATCH', `api/admin/users/${user.id}`, body);
          }
          Admin.toast(isNew ? 'Account added.' : 'Account updated.', 'success');
          Admin.rerender();
        }}
      ]
    });
  }

  async function accountsTab(page){
    const data = await Admin.api('GET', 'api/admin/users');
    page.append(h('div', {class:'panel-actions'}, h('button', {type:'button', class:'btn btn-primary btn-sm', onclick:() => userForm(null)}, '+ Add admin account')));
    page.append(h('div', {class:'table-wrap'}, h('table', {class:'table'},
      h('thead', {}, h('tr', {}, ['Name', 'User name', 'Role', 'Last sign-in', 'Status', ''].map(text => h('th', {text})))),
      h('tbody', {}, data.users.map(user => h('tr', {},
        h('td', {}, h('strong', {text:user.displayName}), user.id === state.user.id ? h('span', {class:'muted', text:' (you)'}) : null),
        h('td', {}, h('code', {text:user.username})),
        h('td', {text:(state.roles[user.role] || {}).label || user.role}),
        h('td', {text:user.lastLoginAt ? Admin.relative(user.lastLoginAt) : 'never'}),
        h('td', {}, user.active === false ? Admin.badge('disabled', 'muted') : Admin.badge('active', 'success')),
        h('td', {class:'row-actions'}, h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:() => userForm(user)}, 'Edit'))
      )))
    )));
    page.append(h('section', {class:'panel'}, h('div', {class:'panel-head'}, h('h2', {text:'Roles'})), roleHelp()));
  }

  function meTab(page){
    const current = h('input', {type:'password', autocomplete:'current-password'});
    const next = h('input', {type:'password', autocomplete:'new-password', minlength:'8'});
    const again = h('input', {type:'password', autocomplete:'new-password', minlength:'8'});
    const form = h('form', {class:'panel narrow'},
      h('div', {class:'panel-head'}, h('h2', {text:'Change password'})),
      h('p', {class:'muted', text:`Signed in as ${state.user.displayName} (${state.user.username}), ${(state.roles[state.user.role] || {}).label || state.user.role}.`}),
      Admin.field('Current password', current),
      Admin.field('New password (at least 8 characters)', next),
      Admin.field('Repeat new password', again),
      h('button', {type:'submit', class:'btn btn-primary btn-sm'}, 'Change password')
    );
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if(next.value !== again.value) return Admin.toast('The new passwords do not match.', 'error');
      try{
        await Admin.api('POST', 'api/admin/password', {current:current.value, next:next.value});
        form.reset();
        Admin.toast('Password changed.', 'success');
      }catch(error){ Admin.toast(error.message, 'error'); }
    });
    page.append(form);
  }

  async function logTab(page){
    const data = await Admin.api('GET', 'api/admin/audit');
    const filter = h('input', {type:'search', placeholder:'Filter by person or action…', 'aria-label':'Filter log'});
    const host = h('div');
    const draw = () => {
      const query = filter.value.trim().toLowerCase();
      const rows = data.entries.filter(entry => !query || [entry.user, entry.action, ACTION_TEXT[entry.action], JSON.stringify(entry.detail)].join(' ').toLowerCase().includes(query)).slice(0, 300);
      clear(host).append(rows.length ? h('div', {class:'table-wrap'}, h('table', {class:'table table--compact'},
        h('thead', {}, h('tr', {}, ['When', 'Who', 'What', 'Details'].map(text => h('th', {text})))),
        h('tbody', {}, rows.map(entry => h('tr', {},
          h('td', {title:Admin.formatDate(entry.at), text:Admin.relative(entry.at)}),
          h('td', {}, h('strong', {text:entry.user})),
          h('td', {text:ACTION_TEXT[entry.action] || entry.action}),
          h('td', {class:'cell-note', text:describe(entry)})
        )))
      )) : Admin.empty('No activity yet.'));
    };
    filter.addEventListener('input', draw);
    page.append(h('div', {class:'toolbar'}, filter), host);
    draw();
  }

  function describe(entry){
    const detail = entry.detail || {};
    if(entry.action === 'status.save' || entry.action === 'status.restore') return (detail.sections || []).map(section => Admin.SECTION_LABELS[section] || section).join(', ');
    if(entry.action === 'report.update') return `${(detail.ids || []).length} report(s)${detail.status ? ` → ${Admin.STATUS_LABELS[detail.status] || detail.status}` : ''}${detail.comment ? ` · “${detail.comment}”` : ''}`;
    if(entry.action === 'report.create') return detail.label || '';
    if(entry.action === 'tests.run') return `${detail.files} test files`;
    if(entry.action === 'tests.done') return `${detail.status}: ${detail.pass} passed, ${detail.fail} failed of ${detail.tests}`;
    if(entry.action.startsWith('user.')) return [detail.username, detail.role, detail.active === false ? 'disabled' : '', detail.passwordReset ? 'password reset' : ''].filter(Boolean).join(' · ');
    return '';
  }

  async function historyTab(page){
    const data = await Admin.api('GET', 'api/admin/status/history');
    page.append(h('p', {class:'muted', text:'Every save keeps the version it replaced, in server/db/status-history/. Restoring an old version saves it as a new change.'}));
    if(!data.items.length){ page.append(Admin.empty('No saves yet.')); return; }
    page.append(h('div', {class:'table-wrap'}, h('table', {class:'table table--compact'},
      h('thead', {}, h('tr', {}, ['Replaced', 'By', 'What changed', ''].map(text => h('th', {text})))),
      h('tbody', {}, data.items.map(item => h('tr', {},
        h('td', {title:Admin.formatDate(item.savedAt), text:Admin.relative(item.savedAt)}),
        h('td', {text:item.replacedBy}),
        h('td', {text:(item.sections || []).map(section => Admin.SECTION_LABELS[section] || section).join(', ')}),
        h('td', {class:'row-actions'},
          h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:async () => {
            const version = await Admin.api('GET', `api/admin/status/history/${item.id}`);
            Admin.modal({title:`Version replaced ${Admin.formatDate(item.savedAt)}`, wide:true, body:h('pre', {class:'code code--scroll', text:JSON.stringify(version.status, null, 2)}), actions:[{text:'Close'}]});
          }}, 'View'),
          Admin.can('restore') ? h('button', {type:'button', class:'btn btn-ghost btn-sm', onclick:async () => {
            if(Admin.changedSections().length) return Admin.toast('Save or discard your unsaved changes first.', 'error');
            if(!await Admin.confirmBox('The live status goes back to this version. The current version is kept in the history.', {title:'Restore this version?', okText:'Restore'})) return;
            await Admin.api('POST', 'api/admin/status/restore', {id:item.id});
            await Admin.loadStatus();
            Admin.toast('Older version restored.', 'success');
            Admin.rerender();
          }}, 'Restore') : null
        )
      )))
    )));
  }

  async function render(page, params){
    const tabs = TABS.filter(tab => tab.id !== 'accounts' || Admin.can('users'));
    const tab = tabs.some(item => item.id === params[0]) ? params[0] : 'log';
    page.append(Admin.pageHeader('Admins & history', 'Who can sign in, what they changed, and older versions of the live status.'));
    page.append(Admin.tabs(tabs, tab, id => Admin.go('people', id)));
    if(tab === 'accounts') await accountsTab(page);
    else if(tab === 'me') meTab(page);
    else if(tab === 'history') await historyTab(page);
    else await logTab(page);
  }

  Admin.register('people', {title:'Admins & history', icon:'☺', render});
})();
