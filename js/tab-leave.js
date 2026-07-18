// ── tab-leave.js — Leave tab + Home today on leave ──

async function loadLeave() {
  if (window.location.protocol === 'file:') return;
  var today = new Date().toISOString().split('T')[0];
  var avColors = ['av-green','av-amber','av-coral','av-blue','av-purple','av-red'];

  // ── HOME TAB: today on leave ──
  var homeEl = document.getElementById('home-leave-today');
  if (homeEl) {
    try {
      var url = SURL + '/rest/v1/leave_records?date_from=lte.' + today + '&date_to=gte.' + today + '&order=staff_name.asc&limit=20';
      var res  = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data = await res.json();
      if (data && data.length) {
        var names = data.map(function(r){ return r.staff_name; }).join(', ');
        homeEl.innerHTML = '<div class="home-summary-card" onclick="switchTabByName(\'leave\')">'
          + '<div class="home-summary-ic" style="background:var(--green-bg);color:var(--green-text);"><i class="ti ti-leaf"></i></div>'
          + '<div style="flex:1;min-width:0;"><div class="home-summary-title">On Leave Today</div>'
          + '<div class="home-summary-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(names) + '</div></div>'
          + '<div class="home-summary-count">' + data.length + '</div>'
          + '<i class="ti ti-chevron-right home-summary-chev"></i>'
          + '</div>';
      } else {
        homeEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">No one on leave today.</div></div>';
      }
    } catch(e) {}
  }

  // ── LEAVE TAB: current + upcoming (open to all staff) ──
  var tabEl = document.getElementById('leave-tab-list');
  var addTrigger = document.getElementById('leave-add-trigger');
  if (addTrigger) addTrigger.style.display = 'block';
  var rawUser = sessionStorage.getItem('mjm_user');
  var me = rawUser ? JSON.parse(rawUser) : {};
  var myName  = me.name || '';
  var isAdminUser = me.role === 'hradmin' || me.role === 'superadmin';

  if (tabEl) {
    try {
      var url2 = SURL + '/rest/v1/leave_records?date_to=gte.' + today + '&order=date_from.asc&limit=100';
      var res2 = await fetch(url2, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data2 = await res2.json();
      if (!data2 || !data2.length) {
        tabEl.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.8);text-align:center;padding:14px 0;">No leave records.</div>';
        return;
      }
      var current  = data2.filter(function(r){ return r.date_from <= today && today <= r.date_to; });
      var upcoming = data2.filter(function(r){ return r.date_from > today; });
      var html2 = '';
      function renderGroup(title, items) {
        if (!items.length) return '';
        var h = '<div class="section-row"><div class="section-title">' + title + '</div></div><div class="card">';
        items.forEach(function(r, i) {
          var ini = r.staff_name.split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
          var avCls = avColors[i % avColors.length];
          var shortType = r.leave_type === 'Annual Leave' ? 'AL' : r.leave_type === 'Medical Leave' ? 'MC' : 'CL';
          var badgeCls  = r.leave_type === 'Medical Leave' ? 'badge-urgent' : 'badge-amber';
          var from = new Date(r.date_from+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
          var to   = new Date(r.date_to+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
          var canManage = isAdminUser || (myName && r.staff_name.toLowerCase() === myName.toLowerCase());
          var editBtn = canManage
            ? '<div style="cursor:pointer;color:var(--text-secondary);margin-left:6px;" onclick="editLeaveRequest(\'' + escJsAttr(r.id) + '\',\'' + escJsAttr(r.leave_type) + '\',\'' + escJsAttr(r.date_from) + '\',\'' + escJsAttr(r.date_to) + '\')"><i class="ti ti-pencil"></i></div>'
            : '';
          var delBtn = canManage
            ? '<div style="cursor:pointer;color:var(--red-text);margin-left:6px;" onclick="deleteLeaveRequest(\'' + escJsAttr(r.id) + '\')"><i class="ti ti-trash"></i></div>'
            : '';
          h += '<div class="person-row" data-leave-id="' + escHtml(r.id) + '" data-staff-name="' + escHtml(r.staff_name) + '">'
            + '<div class="avatar ' + avCls + '">' + ini + '</div>'
            + '<div style="flex:1;"><div class="person-name">' + escHtml(r.staff_name) + '</div>'
            + '<div class="person-sub">' + escHtml(r.leave_type) + ' · ' + from + (from !== to ? ' – ' + to : '') + '</div></div>'
            + '<span class="badge ' + badgeCls + '">' + shortType + '</span>'
            + editBtn
            + delBtn
            + '</div>';
        });
        h += '</div>';
        return h;
      }
      html2 += renderGroup('Currently on Leave', current);
      html2 += renderGroup('Upcoming Leave', upcoming);
      tabEl.innerHTML = html2;
    } catch(e) {
      tabEl.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.8);text-align:center;padding:14px 0;">Could not load leave records.</div>';
    }
  }
}

// ── LEAVE — STAFF SELF-SERVICE (open to all staff) ──
var editingLeaveId = null;

function showLeaveForm() {
  var raw = sessionStorage.getItem('mjm_user');
  var user = raw ? JSON.parse(raw) : {};
  editingLeaveId = null;
  document.getElementById('leave-form-title').textContent = 'Add Leave';
  document.getElementById('leave-form-name').value = user.name || user.email || '';
  document.getElementById('leave-form-type').value = 'Annual Leave';
  document.getElementById('leave-form-from').value = '';
  document.getElementById('leave-form-to').value   = '';
  document.getElementById('leave-form').style.display = 'block';
  document.getElementById('leave-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideLeaveForm() {
  document.getElementById('leave-form').style.display = 'none';
  editingLeaveId = null;
}

// HR Admin/Super Admin can manage any leave record; everyone else can only
// manage their own, matched by staff name -- the same ownership signal
// already used for the Delete button on this tab, since the "Staff" field
// is locked to the logged-in user's own name when adding a new record.
function canManageLeave(id) {
  var raw = sessionStorage.getItem('mjm_user');
  var me = raw ? JSON.parse(raw) : {};
  if (me.role === 'hradmin' || me.role === 'superadmin') return true;
  var row = document.querySelector('[data-leave-id="' + id + '"]');
  var ownerName = row ? (row.getAttribute('data-staff-name') || '') : '';
  return !!(me.name && ownerName && me.name.toLowerCase() === ownerName.toLowerCase());
}

function editLeaveRequest(id, type, from, to) {
  if (!canManageLeave(id)) return;
  var raw = sessionStorage.getItem('mjm_user');
  var user = raw ? JSON.parse(raw) : {};
  var row = document.querySelector('[data-leave-id="' + id + '"]');
  var ownerName = row ? row.getAttribute('data-staff-name') : (user.name || user.email || '');
  editingLeaveId = id;
  document.getElementById('leave-form-title').textContent = 'Edit Leave';
  document.getElementById('leave-form-name').value = ownerName;
  document.getElementById('leave-form-type').value = type;
  document.getElementById('leave-form-from').value = from;
  document.getElementById('leave-form-to').value   = to;
  document.getElementById('leave-form').style.display = 'block';
  document.getElementById('leave-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveLeaveRequest() {
  if (editingLeaveId && !canManageLeave(editingLeaveId)) { alert('You can only edit your own leave records.'); return; }
  var name = document.getElementById('leave-form-name').value.trim();
  var type = document.getElementById('leave-form-type').value;
  var from = document.getElementById('leave-form-from').value;
  var to   = document.getElementById('leave-form-to').value;
  if (!name || !from || !to) { alert('Please fill in the leave dates.'); return; }
  if (from > to) { alert('The "From" date must be before the "To" date.'); return; }
  try {
    if (editingLeaveId) {
      await sbWrite('PATCH', 'leave_records', { leave_type: type, date_from: from, date_to: to }, 'id=eq.' + editingLeaveId);
      editingLeaveId = null;
    } else {
      await sbWrite('POST', 'leave_records', { staff_name: name, leave_type: type, date_from: from, date_to: to });
    }
    hideLeaveForm();
    loadLeave();
  } catch(e) { alert('Could not save leave. Please try again.'); }
}

async function deleteLeaveRequest(id) {
  if (!canManageLeave(id)) { alert('You can only delete your own leave records.'); return; }
  if (!confirm('Delete this leave record?')) return;
  try {
    await sbWrite('DELETE', 'leave_records', null, 'id=eq.' + id);
    loadLeave();
  } catch(e) { alert('Could not delete leave record. Please try again.'); }
}
