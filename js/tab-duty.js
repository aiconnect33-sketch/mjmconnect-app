// ── tab-duty.js — Duty tab ──

async function loadDuty() {
  if (window.location.protocol === 'file:') return;
  var today = localDateStr();
  var avColors = ['av-green','av-amber','av-coral','av-blue','av-purple','av-red'];

  // ── DUTY TAB: collapsed to "who's on now" per role, tap to expand ──
  var tabEl = document.getElementById('duty-tab-list');
  var canEdit = typeof hasEditPermission === 'function' && hasEditPermission('duty');
  var addTrigger = document.getElementById('duty-add-trigger');
  if (addTrigger) addTrigger.style.display = canEdit ? 'block' : 'none';

  if (tabEl) {
    try {
      // Sorted by role first so each role's date ranges land together in one section.
      var url2 = SURL + '/rest/v1/duty_roster?date_to=gte.' + today + '&order=duty_role.asc,date_from.asc&limit=200';
      var res2 = await fetch(url2, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data2 = await res2.json();
      if (!data2 || !data2.length) {
        tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No upcoming duty assignments.</div>';
        return;
      }
      // Two-level grouping: role -> date-range groups within that role.
      var roles = {};
      var roleOrder = [];
      data2.forEach(function(r) {
        var role = r.duty_role || 'General Duty';
        if (!roles[role]) { roles[role] = { groups: {}, order: [] }; roleOrder.push(role); }
        var rr = roles[role];
        var key = (r.date_from || '') + '||' + (r.date_to || '');
        if (!rr.groups[key]) { rr.groups[key] = { date_from: r.date_from, date_to: r.date_to, members: [], ids: [] }; rr.order.push(key); }
        rr.groups[key].members.push(r);
        rr.groups[key].ids.push(r.id);
      });

      tabEl.innerHTML = roleOrder.map(function(role, ri) {
        var rr = roles[role];
        var roleGroups = rr.order.map(function(k) { return rr.groups[k]; });
        var activeGroups = roleGroups.filter(function(g) { return g.date_from <= today && today <= (g.date_to || g.date_from); });

        var currentHtml;
        if (activeGroups.length) {
          var activeNames = [];
          activeGroups.forEach(function(g) { g.members.forEach(function(m) { activeNames.push(m.staff_name); }); });
          var label = activeNames.length > 2 ? (activeNames[0] + ' +' + (activeNames.length - 1)) : activeNames.join(', ');
          var ini = (activeNames[0] || '').split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
          currentHtml = '<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-secondary);flex-shrink:0;">'
            + '<div class="avatar ' + avColors[ri % avColors.length] + '" style="width:19px;height:19px;font-size:8.5px;">' + ini + '</div>'
            + escHtml(label) + '</div>';
        } else {
          currentHtml = '<div style="font-size:11px;color:var(--text-secondary);flex-shrink:0;">No one on duty now</div>';
        }

        var bodyHtml = roleGroups.map(function(g, gi) {
          var from = g.date_from ? new Date(g.date_from+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '';
          var to   = g.date_to   ? new Date(g.date_to+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '';
          var dateLabel  = from === to ? from : from + ' – ' + to;
          var isActive   = g.date_from <= today && today <= (g.date_to || g.date_from);
          var badgeCls   = isActive ? 'badge-success' : 'badge-info';
          var badgeLabel = isActive ? 'Active' : 'Upcoming';
          var memberNames = g.members.map(function(m){ return m.staff_name; }).join(', ');
          var delBtn = canEdit
            ? '<div style="cursor:pointer;color:var(--red-text);" onclick="event.stopPropagation();deleteDutyAssignment(\'' + escJsAttr(g.ids.join(',')) + '\',\'' + escJsAttr(role) + '\',\'' + escJsAttr(dateLabel) + '\',\'' + escJsAttr(memberNames) + '\')"><i class="ti ti-trash"></i></div>'
            : '';
          return '<div style="' + (gi > 0 ? 'border-top:1px solid var(--border);padding-top:9px;margin-top:9px;' : '') + '">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
            + '<div style="font-size:11px;color:var(--text-secondary);">' + dateLabel + '</div>'
            + '<div style="display:flex;align-items:center;gap:8px;"><span class="badge ' + badgeCls + '">' + badgeLabel + '</span>' + delBtn + '</div></div>'
            + g.members.map(function(r, mi) {
              var pIni   = r.staff_name.split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
              var avCls  = avColors[(gi + mi) % avColors.length];
              var editBtn = canEdit
                ? '<div style="cursor:pointer;color:var(--text-secondary);margin-left:6px;" onclick="event.stopPropagation();editDutyAssignment(\'' + escJsAttr(r.id) + '\',\'' + escJsAttr(r.staff_name) + '\',\'' + escJsAttr(r.duty_role || '') + '\',\'' + escJsAttr(r.date_from) + '\',\'' + escJsAttr(r.date_to) + '\')"><i class="ti ti-pencil"></i></div>'
                : '';
              return '<div class="person-row" style="padding:5px 0;">'
                + '<div class="avatar ' + avCls + '" style="font-size:10px;">' + pIni + '</div>'
                + '<div style="flex:1;"><div class="person-name" style="font-size:12px;">' + escHtml(r.staff_name) + '</div></div>'
                + editBtn
                + '</div>';
            }).join('')
            + '</div>';
        }).join('');

        return '<div class="card" style="margin-bottom:10px;padding:0;overflow:hidden;">'
          + '<div style="display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:pointer;" onclick="toggleDutySection(this)">'
          + '<i class="ti ti-chevron-right" style="font-size:11px;color:var(--text-secondary);flex-shrink:0;transition:transform .15s ease;"></i>'
          + '<div style="flex:1;font-size:12px;font-weight:600;color:var(--text-primary);">' + escHtml(role) + '</div>'
          + currentHtml
          + '</div>'
          + '<div style="display:none;padding:0 14px 12px 33px;">' + bodyHtml + '</div>'
          + '</div>';
      }).join('');
    } catch(e) {
      tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Could not load duty roster.</div>';
    }
  }
}

function toggleDutySection(headerEl) {
  var body = headerEl.nextElementSibling;
  var chev = headerEl.querySelector('.ti-chevron-right');
  var open = body.style.display !== 'block';
  body.style.display = open ? 'block' : 'none';
  if (chev) chev.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
}

// ── DUTY — STAFF EDIT (Duty module permission) ──
var editingDutyId = null;
var editingDutyOriginal = null;
var dutyStaffOptions = [];

// Staff Name is a picker sourced from registered accounts only (matches
// Admin's behaviour) -- not free text, so duty can't be assigned to
// someone who hasn't signed up yet. `preserveName` keeps an existing
// assignment's name selectable even if that account was later removed.
async function loadDutyStaffOptions(preserveName) {
  var sel = document.getElementById('duty-form-name');
  if (!sel) return;
  try {
    var data = await sbGet('profiles', 'role=neq.pending&order=full_name.asc&select=full_name');
    dutyStaffOptions = (data || []).map(function(p){ return p.full_name; }).filter(Boolean);
  } catch(e) { dutyStaffOptions = []; }
  var names = dutyStaffOptions.slice();
  if (preserveName && names.indexOf(preserveName) === -1) names.push(preserveName);
  sel.innerHTML = '<option value="" disabled' + (preserveName ? '' : ' selected') + '>Select staff…</option>'
    + names.map(function(n){ return '<option value="' + escHtml(n) + '">' + escHtml(n) + '</option>'; }).join('');
  if (preserveName) sel.value = preserveName;
}

async function showDutyForm() {
  editingDutyId = null;
  document.getElementById('duty-form-title').textContent = 'New Duty Assignment';
  await loadDutyStaffOptions();
  document.getElementById('duty-form-role').value = '';
  document.getElementById('duty-form-from').value = '';
  document.getElementById('duty-form-to').value   = '';
  document.getElementById('duty-form').style.display = 'block';
  document.getElementById('duty-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideDutyForm() {
  document.getElementById('duty-form').style.display = 'none';
  editingDutyId = null;
  editingDutyOriginal = null;
}

async function editDutyAssignment(id, name, role, from, to) {
  if (!hasEditPermission('duty')) return;
  editingDutyId = id;
  editingDutyOriginal = { name: name, role: role, from: from, to: to };
  document.getElementById('duty-form-title').textContent = 'Edit Duty Assignment';
  await loadDutyStaffOptions(name);
  document.getElementById('duty-form-role').value = role;
  document.getElementById('duty-form-from').value = from;
  document.getElementById('duty-form-to').value   = to;
  document.getElementById('duty-form').style.display = 'block';
  document.getElementById('duty-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveDutyAssignment() {
  if (!hasEditPermission('duty')) return;
  var name = document.getElementById('duty-form-name').value.trim();
  var role = document.getElementById('duty-form-role').value.trim();
  var from = document.getElementById('duty-form-from').value;
  var to   = document.getElementById('duty-form-to').value;
  if (!name || !from || !to) { alert('Please fill in staff name and dates.'); return; }
  if (from > to) { alert('The "From" date must be before the "To" date.'); return; }
  try {
    if (editingDutyId) {
      await sbWrite('PATCH', 'duty_roster', { staff_name: name, duty_role: role || 'General Duty', date_from: from, date_to: to, period: from + ' to ' + to }, 'id=eq.' + editingDutyId);
      var diffs = [];
      if (editingDutyOriginal) {
        var o = editingDutyOriginal;
        var newRole = role || 'General Duty';
        if (o.name !== name) diffs.push({ label: 'Staff', from: o.name, to: name });
        if ((o.role || 'General Duty') !== newRole) diffs.push({ label: 'Role', from: o.role || 'General Duty', to: newRole });
        if (o.from !== from || o.to !== to) diffs.push({ label: 'Dates', from: o.from + ' – ' + o.to, to: from + ' – ' + to });
      }
      if (diffs.length) logAudit('duty', editingDutyId, 'edited', role || 'General Duty', diffs, null);
      editingDutyId = null;
      editingDutyOriginal = null;
    } else {
      await sbWrite('POST', 'duty_roster', { staff_name: name, duty_role: role || 'General Duty', date_from: from, date_to: to, period: from + ' to ' + to });
    }
    hideDutyForm();
    loadDuty();
  } catch(e) { alert('Could not save duty assignment. Please try again.'); }
}

async function deleteDutyAssignment(idsStr, role, dateLabel, namesCsv) {
  if (!hasEditPermission('duty')) return;
  if (!confirm('Delete this duty assignment?')) return;
  var ids = idsStr.split(',').filter(Boolean);
  try {
    await sbWrite('DELETE', 'duty_roster', null, 'id=in.(' + ids.join(',') + ')');
    logAudit('duty', ids.join(','), 'deleted', role || 'General Duty', { role: role || 'General Duty', dates: dateLabel || '', staff: namesCsv || '' }, null);
    loadDuty();
  } catch(e) { alert('Could not delete duty assignment. Please try again.'); }
}
