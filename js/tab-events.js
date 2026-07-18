// ── tab-events.js — Staff Event tab ──

async function loadStaffEvents() {
  var el = document.getElementById('staff-event-list');
  if (!el) return;
  var today = new Date().toISOString().split('T')[0];
  var canEdit = typeof hasEditPermission === 'function' && hasEditPermission('events');
  var addTrigger = document.getElementById('event-add-trigger');
  if (addTrigger) addTrigger.style.display = canEdit ? 'block' : 'none';

  var rawUser = sessionStorage.getItem('mjm_user');
  var me = rawUser ? JSON.parse(rawUser) : {};
  var isAdminUser = me.role === 'hradmin' || me.role === 'superadmin';
  var myEmailLow = (me.email || '').toLowerCase();

  el.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Loading...</div>';
  try {
    var url  = SURL + '/rest/v1/events?event_date=gte.' + today + '&order=event_date.asc,event_time.asc&limit=200';
    var res  = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
    var data = await res.json();
    if (!data || !data.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No upcoming events.</div>';
      return;
    }
    el.innerHTML = data.map(function(ev) {
      var d = new Date(ev.event_date + 'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'});
      var t = ev.event_time ? (function(s){
        var p = s.split(':'), h = parseInt(p[0]), m = p[1], ap = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12; return h + ':' + m + ' ' + ap;
      })(ev.event_time) : '';
      var isOwner = isAdminUser || (myEmailLow && ev.created_by_email && ev.created_by_email.toLowerCase() === myEmailLow);
      var canManage = canEdit && isOwner;
      var actions = canManage
        ? '<div style="display:flex;gap:6px;margin-top:8px;">'
          + '<div style="cursor:pointer;font-size:11px;color:var(--text-secondary);" onclick="editStaffEvent(\'' + escJsAttr(ev.id) + '\')"><i class="ti ti-pencil"></i> Edit</div>'
          + '<div style="cursor:pointer;font-size:11px;color:var(--red-text);" onclick="deleteStaffEvent(\'' + escJsAttr(ev.id) + '\')"><i class="ti ti-trash"></i> Delete</div>'
          + '</div>'
        : '';
      return '<div class="card" style="margin-bottom:10px;border-left:3px solid #534AB7;border-radius:0 var(--radius-lg) var(--radius-lg) 0;" data-event-id="' + escHtml(ev.id) + '" data-event-date="' + escHtml(ev.event_date) + '" data-event-time="' + escHtml(ev.event_time || '') + '" data-created-by-email="' + escHtml(ev.created_by_email || '') + '">'
        + '<div class="card-meta">'
        + '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;background:#EEEDFE;color:#534AB7;">Event</span>'
        + '<span class="card-time">' + d + (t ? ' · ' + t : '') + '</span>'
        + '</div>'
        + '<div class="card-title">' + escHtml(ev.title) + '</div>'
        + (ev.description ? '<div class="card-body">' + escHtml(ev.description) + '</div>' : '')
        + '<div style="font-size:11px;color:var(--text-light);margin-top:6px;"><i class="ti ti-user"></i> ' + escHtml(ev.created_by || 'Staff') + '</div>'
        + actions
        + '</div>';
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Could not load events.</div>';
  }
}

// ── EVENTS — STAFF EDIT (Events module permission) ──
var editingStaffEventId = null;

function showStaffEventForm(id) {
  if (!id) {
    editingStaffEventId = null;
    document.getElementById('staff-event-form-title').textContent = 'New Event';
    document.getElementById('staff-event-title').value = '';
    document.getElementById('staff-event-date').value  = '';
    document.getElementById('staff-event-time').value  = '';
    document.getElementById('staff-event-desc').value  = '';
  }
  document.getElementById('staff-event-form').style.display = 'block';
  document.getElementById('staff-event-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideStaffEventForm() {
  document.getElementById('staff-event-form').style.display = 'none';
  editingStaffEventId = null;
}

// HR Admin/Super Admin can manage any event; everyone else can only manage
// the ones they personally created (matched by the creating account's
// email, read off the rendered card -- events created before this feature
// existed have no recorded owner, so nobody but an admin can touch those).
function canManageEvent(id) {
  var raw = sessionStorage.getItem('mjm_user');
  var me = raw ? JSON.parse(raw) : {};
  if (me.role === 'hradmin' || me.role === 'superadmin') return true;
  var card = document.querySelector('[data-event-id="' + id + '"]');
  var ownerEmail = card ? (card.getAttribute('data-created-by-email') || '') : '';
  return !!(me.email && ownerEmail && me.email.toLowerCase() === ownerEmail.toLowerCase());
}

function editStaffEvent(id) {
  if (!canManageEvent(id)) return;
  var card = document.querySelector('[data-event-id="' + id + '"]');
  if (!card) return;
  editingStaffEventId = id;
  document.getElementById('staff-event-form-title').textContent = 'Edit Event';
  document.getElementById('staff-event-title').value = card.querySelector('.card-title').textContent;
  document.getElementById('staff-event-date').value  = card.getAttribute('data-event-date') || '';
  document.getElementById('staff-event-time').value  = card.getAttribute('data-event-time') || '';
  var bodyEl = card.querySelector('.card-body');
  document.getElementById('staff-event-desc').value = bodyEl ? bodyEl.textContent : '';
  showStaffEventForm(id);
}

async function saveStaffEvent() {
  if (!hasEditPermission('events')) return;
  if (editingStaffEventId && !canManageEvent(editingStaffEventId)) { alert('You can only edit events you created.'); return; }
  var title = document.getElementById('staff-event-title').value.trim();
  var date  = document.getElementById('staff-event-date').value;
  var time  = document.getElementById('staff-event-time').value;
  var desc  = document.getElementById('staff-event-desc').value.trim();
  if (!title || !date) { alert('Please fill in the event title and date.'); return; }

  var raw = sessionStorage.getItem('mjm_user');
  var user = raw ? JSON.parse(raw) : {};
  try {
    if (editingStaffEventId) {
      await sbWrite('PATCH', 'events', { title: title, event_date: date, event_time: time || null, description: desc || null }, 'id=eq.' + editingStaffEventId);
    } else {
      await sbWrite('POST', 'events', { title: title, event_date: date, event_time: time || null, description: desc || null, created_by: user.name || 'Staff', created_by_email: user.email || '' });
    }
    hideStaffEventForm();
    loadStaffEvents();
  } catch(e) { alert('Could not save event. Please try again.'); }
}

async function deleteStaffEvent(id) {
  if (!hasEditPermission('events')) return;
  if (!canManageEvent(id)) { alert('You can only delete events you created.'); return; }
  if (!confirm('Delete this event?')) return;
  try {
    await sbWrite('DELETE', 'events', null, 'id=eq.' + id);
    loadStaffEvents();
  } catch(e) { alert('Could not delete event. Please try again.'); }
}
