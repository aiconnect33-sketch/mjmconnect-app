// ── tab-announcements.js — Announcements tab + Home banner + Staff Calendar ──

// ── STAFF CALENDAR ──
var staffCalYear, staffCalMonth;
var staffCalLeave = {}, staffCalEvents = {}, staffCalEstate = {};
var STAFF_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function initStaffCalendar() {
  var n = new Date();
  staffCalYear = n.getFullYear(); staffCalMonth = n.getMonth();
  loadStaffCalendar();
}

async function loadStaffCalendar() {
  staffCalLeave = {}; staffCalEvents = {}; staffCalEstate = {};
  if (window.location.protocol === 'file:') { renderStaffCalendar(); return; }
  try {
    var leaveData = await sbGet('leave_records', 'select=date_from,date_to&limit=200');
    if (leaveData && leaveData.length) {
      leaveData.forEach(function(r) {
        if (!r.date_from || !r.date_to) return;
        var cur = new Date(r.date_from + 'T00:00:00');
        var end = new Date(r.date_to   + 'T00:00:00');
        while (cur <= end) {
          staffCalLeave[cur.getFullYear() + '-' + String(cur.getMonth()+1).padStart(2,'0') + '-' + String(cur.getDate()).padStart(2,'0')] = true;
          cur.setDate(cur.getDate() + 1);
        }
      });
    }
    var evData = await sbGet('events', 'select=event_date&limit=200');
    if (evData && evData.length) {
      evData.forEach(function(e){ staffCalEvents[e.event_date] = true; });
    }
    var estateData = await sbGet('estate_trips', 'select=trip_date&limit=200');
    if (estateData && estateData.length) {
      estateData.forEach(function(t){ staffCalEstate[t.trip_date] = true; });
    }
  } catch(e) {}
  renderStaffCalendar();
}

function renderStaffCalendar() {
  var grid  = document.getElementById('staff-cal-grid');
  var label = document.getElementById('staff-cal-label');
  if (!grid || !label) return;
  label.textContent = STAFF_MONTHS[staffCalMonth] + ' ' + staffCalYear;
  while (grid.children.length > 7) grid.removeChild(grid.lastChild);
  var firstDay    = new Date(staffCalYear, staffCalMonth, 1).getDay();
  var daysInMonth = new Date(staffCalYear, staffCalMonth + 1, 0).getDate();
  var today = new Date();
  for (var i = 0; i < firstDay; i++) { grid.appendChild(document.createElement('div')); }
  for (var d = 1; d <= daysInMonth; d++) {
    var cell     = document.createElement('div');
    var dateStr  = staffCalYear + '-' + String(staffCalMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday  = (d === today.getDate() && staffCalMonth === today.getMonth() && staffCalYear === today.getFullYear());
    var hasLeave = staffCalLeave[dateStr];
    var hasEvent = staffCalEvents[dateStr];
    var hasEstate = staffCalEstate[dateStr];
    var cls = 'cal-day';
    if (isToday) cls += ' today';
    cell.className = cls;
    var dots = (hasEvent ? '<div class="cal-underline event"></div>' : '')
      + (hasLeave ? '<div class="cal-underline leave"></div>' : '')
      + (hasEstate ? '<div class="cal-underline estate"></div>' : '');
    cell.innerHTML = '<span>' + d + '</span>'
      + '<div class="cal-day-dots">' + dots + '</div>';
    if (hasLeave || hasEvent || hasEstate) {
      cell.style.cursor = 'pointer';
      (function(ds, hl, he, hes){ cell.onclick = function(){ showStaffDayDetail(ds, hl, he, hes); }; })(dateStr, hasLeave, hasEvent, hasEstate);
    }
    grid.appendChild(cell);
  }
}

function staffCalPrev() { staffCalMonth--; if (staffCalMonth < 0)  { staffCalMonth = 11; staffCalYear--; } loadStaffCalendar(); }
function staffCalNext() { staffCalMonth++; if (staffCalMonth > 11) { staffCalMonth = 0;  staffCalYear++; } loadStaffCalendar(); }

// ── DAY DETAIL MODAL ──
async function showStaffDayDetail(dateStr, hasLeave, hasEvent, hasEstate) {
  var modal = document.getElementById('staff-day-modal');
  var title = document.getElementById('staff-day-modal-title');
  var body  = document.getElementById('staff-day-modal-body');
  var d = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'});
  title.textContent = d;
  body.innerHTML = '<div style="font-size:12px;color:#9AABA3;text-align:center;padding:10px 0;">Loading...</div>';
  modal.style.display = 'block';
  var html = '';
  try {
    if (hasLeave) {
      var leaves = await sbGet('leave_records', 'date_from=lte.' + dateStr + '&date_to=gte.' + dateStr + '&select=*');
      if (leaves && leaves.length) {
        html += '<div style="font-size:10px;font-weight:600;color:#6B7A73;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">On Leave</div>';
        html += leaves.map(function(r) {
          var ini  = r.staff_name.split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
          var from = new Date(r.date_from+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
          var to   = new Date(r.date_to+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
          var shortType = r.leave_type === 'Annual Leave' ? 'AL' : r.leave_type === 'Medical Leave' ? 'MC' : 'CL';
          if (r.day_period === 'am') shortType += ' · AM';
          else if (r.day_period === 'pm') shortType += ' · PM';
          return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:0.5px solid #E2E8E5;">'
            + '<div style="width:30px;height:30px;border-radius:50%;background:#E1F5EE;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:#085041;flex-shrink:0;">' + ini + '</div>'
            + '<div style="flex:1;"><div style="font-size:12px;font-weight:500;color:#111C18;">' + escHtml(r.staff_name) + '</div>'
            + '<div style="font-size:11px;color:#6B7A73;">' + escHtml(r.leave_type) + ' · ' + from + '–' + to + '</div></div>'
            + '<span style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:10px;background:#FAEEDA;color:#854F0B;">' + shortType + '</span></div>';
        }).join('');
      }
    }
    if (hasEvent) {
      var evUrl = SURL + '/rest/v1/events?event_date=eq.' + dateStr + '&order=event_time.asc&limit=50';
      var evRes = await fetch(evUrl, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var events = await evRes.json();
      if (events && events.length) {
        if (html) html += '<div style="height:1px;background:#E2E8E5;margin:8px 0;"></div>';
        html += '<div style="font-size:10px;font-weight:600;color:#6B7A73;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Events</div>';
        html += events.map(function(ev) {
          var t = ev.event_time ? (function(s){ var p=s.split(':'),h=parseInt(p[0]),m=p[1],ap=h>=12?'PM':'AM'; h=h%12||12; return h+':'+m+' '+ap; })(ev.event_time) : 'All day';
          return '<div style="padding:7px 0;border-bottom:0.5px solid #E2E8E5;">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;">'
            + '<div style="font-size:12px;font-weight:600;color:#111C18;">' + escHtml(ev.title) + '</div>'
            + '<span style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:10px;background:#EEEDFE;color:#534AB7;">' + t + '</span></div>'
            + (ev.description ? '<div style="font-size:11px;color:#6B7A73;margin-top:3px;">' + escHtml(ev.description) + '</div>' : '')
            + '</div>';
        }).join('');
      }
    }
    if (hasEstate) {
      var tripUrl = SURL + '/rest/v1/estate_trips?trip_date=eq.' + dateStr + '&order=staff_name.asc&limit=50';
      var tripRes = await fetch(tripUrl, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var trips = await tripRes.json();
      if (trips && trips.length) {
        if (html) html += '<div style="height:1px;background:#E2E8E5;margin:8px 0;"></div>';
        html += '<div style="font-size:10px;font-weight:600;color:#6B7A73;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Estate Trip</div>';
        html += trips.map(function(t) {
          var ini = t.staff_name.split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
          return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:0.5px solid #E2E8E5;">'
            + '<div style="width:30px;height:30px;border-radius:50%;background:var(--estate-bg);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:var(--estate-text);flex-shrink:0;">' + ini + '</div>'
            + '<div style="flex:1;"><div style="font-size:12px;font-weight:500;color:#111C18;">' + escHtml(t.staff_name) + '</div>'
            + '<div style="font-size:11px;color:#6B7A73;">Going to ' + escHtml(t.estate_name) + '</div></div>'
            + '</div>';
        }).join('');
      }
    }
    body.innerHTML = html || '<div style="font-size:12px;color:#9AABA3;text-align:center;padding:10px 0;">No details found.</div>';
  } catch(e) { body.innerHTML = '<div style="font-size:12px;color:#9AABA3;text-align:center;padding:10px 0;">Could not load details.</div>'; }
}

function closeStaffDayModal() {
  document.getElementById('staff-day-modal').style.display = 'none';
}

// ── ANNOUNCEMENTS ──
async function loadAnnouncements() {
  if (window.location.protocol === 'file:') return;
  try {
    var data = await sbGet('announcements', 'limit=200');
    if (!data) return;
    var now   = Date.now();
    var cut2  = new Date(now - 2  * 24 * 60 * 60 * 1000);
    var cut5  = new Date(now - 5 * 24 * 60 * 60 * 1000);
    var bannerItems = data.filter(function(a){ return new Date(a.created_at) >= cut2; });
    var tabItems    = data.filter(function(a){ return new Date(a.created_at) >= cut5; });

    // Banner
    var bannerEl = document.getElementById('home-ann-banner');
    if (bannerEl) {
      if (bannerItems.length) {
        bannerEl.innerHTML = bannerItems.map(function(a) {
          var d = new Date(a.created_at).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' });
          var t = new Date(a.created_at).toLocaleTimeString('en-MY', { hour:'numeric', minute:'2-digit', hour12:true });
          return '<div class="alert-banner" style="cursor:pointer;" onclick="switchNav(\'announce\')">'
            + '<div class="alert-icon-box"><i class="ti ti-speakerphone"></i></div>'
            + '<div class="alert-text" style="flex:1;">'
            + '<div>' + escHtml(a.title) + '</div>'
            + '<div>' + escHtml(a.body) + '</div>'
            + '<div style="font-size:10px;opacity:0.7;margin-top:2px;">' + d + ' · ' + t + '</div>'
            + '</div>'
            + '<i class="ti ti-chevron-right alert-chev"></i>'
            + '</div>';
        }).join('');
        bannerEl.style.display = 'block';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    // Tab
    var canEdit = typeof hasEditPermission === 'function' && hasEditPermission('announcements');
    var addTrigger = document.getElementById('ann-add-trigger');
    if (addTrigger) addTrigger.style.display = canEdit ? 'block' : 'none';

    var rawUser = sessionStorage.getItem('mjm_user');
    var me = rawUser ? JSON.parse(rawUser) : {};
    var isAdminUser = me.role === 'hradmin' || me.role === 'superadmin';
    var myEmailLow = (me.email || '').toLowerCase();

    var tabEl = document.getElementById('ann-tab-list');
    if (tabEl) {
      if (!tabItems.length) {
        tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No announcements.</div>';
        return;
      }
      tabEl.innerHTML = tabItems.map(function(ann) {
        var d = new Date(ann.created_at).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' });
        var t = new Date(ann.created_at).toLocaleTimeString('en-MY', { hour:'numeric', minute:'2-digit', hour12:true });
        var isOwner = isAdminUser || (myEmailLow && ann.posted_by_email && ann.posted_by_email.toLowerCase() === myEmailLow);
        var canManage = canEdit && isOwner;
        var actions = canManage
          ? '<div style="display:flex;gap:6px;margin-top:8px;">'
            + '<div style="cursor:pointer;font-size:11px;color:var(--text-secondary);" onclick="editAnnouncement(\'' + escJsAttr(ann.id) + '\')"><i class="ti ti-pencil"></i> Edit</div>'
            + '<div style="cursor:pointer;font-size:11px;color:var(--red-text);" onclick="deleteAnnouncement(\'' + escJsAttr(ann.id) + '\')"><i class="ti ti-trash"></i> Delete</div>'
            + '</div>'
          : '';
        return '<div class="card card-info" style="margin-bottom:10px;" data-ann-id="' + escHtml(ann.id) + '" data-posted-by-email="' + escHtml(ann.posted_by_email || '') + '" data-posted-by="' + escHtml(ann.posted_by || 'Staff') + '">'
          + '<div class="card-meta"><span class="card-time">' + d + ' · ' + t + '</span></div>'
          + '<div class="card-title">' + escHtml(ann.title) + '</div>'
          + '<div class="card-body">'  + escHtml(ann.body)  + '</div>'
          + '<div style="font-size:11px;color:var(--text-light);margin-top:6px;"><i class="ti ti-user"></i> ' + escHtml(ann.posted_by || 'Staff') + '</div>'
          + actions
          + '</div>';
      }).join('');
    }
  } catch(e) {}
}

// ── ANNOUNCEMENTS — STAFF EDIT (Announcements module permission) ──
var editingAnnId = null;
var editingAnnOriginal = null;

function showAnnForm(id) {
  document.getElementById('ann-form').style.display = 'block';
  document.getElementById('ann-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!id) {
    editingAnnId = null;
    document.getElementById('ann-form-title').textContent = 'New Announcement';
    document.getElementById('ann-form-title-input').value = '';
    document.getElementById('ann-form-body-input').value  = '';
  }
}

function hideAnnForm() {
  document.getElementById('ann-form').style.display = 'none';
  document.getElementById('ann-form-title-input').value = '';
  document.getElementById('ann-form-body-input').value  = '';
  editingAnnId = null;
  editingAnnOriginal = null;
}

// HR Admin/Super Admin can manage any announcement; everyone else can only
// manage the ones they personally posted (matched by the owning account's
// email, read off the rendered card since that's already the source of
// truth for this list -- announcements posted before this feature existed
// have no recorded owner, so nobody but an admin can touch those).
function canManageAnnouncement(id) {
  var raw = sessionStorage.getItem('mjm_user');
  var me = raw ? JSON.parse(raw) : {};
  if (me.role === 'hradmin' || me.role === 'superadmin') return true;
  var card = document.querySelector('[data-ann-id="' + id + '"]');
  var ownerEmail = card ? (card.getAttribute('data-posted-by-email') || '') : '';
  return !!(me.email && ownerEmail && me.email.toLowerCase() === ownerEmail.toLowerCase());
}

async function editAnnouncement(id) {
  if (!canManageAnnouncement(id)) return;
  var card = document.querySelector('[data-ann-id="' + id + '"]');
  if (!card) return;
  var title = card.querySelector('.card-title').textContent;
  var body  = card.querySelector('.card-body').textContent;
  editingAnnId = id;
  editingAnnOriginal = { title: title, body: body, postedBy: card.getAttribute('data-posted-by') || 'Staff' };
  document.getElementById('ann-form-title').textContent = 'Edit Announcement';
  document.getElementById('ann-form-title-input').value = title;
  document.getElementById('ann-form-body-input').value  = body;
  showAnnForm(id);
}

async function saveAnnouncement() {
  if (!hasEditPermission('announcements')) return;
  if (editingAnnId && !canManageAnnouncement(editingAnnId)) { alert('You can only edit your own announcements.'); return; }
  var title = document.getElementById('ann-form-title-input').value.trim();
  var body  = document.getElementById('ann-form-body-input').value.trim();
  if (!title || !body) { alert('Please fill in both title and message.'); return; }
  var raw = sessionStorage.getItem('mjm_user');
  var user = raw ? JSON.parse(raw) : {};
  try {
    if (editingAnnId) {
      await sbWrite('PATCH', 'announcements', { title: title, body: body }, 'id=eq.' + editingAnnId);
      var diffs = [];
      if (editingAnnOriginal) {
        if (editingAnnOriginal.title !== title) diffs.push({ label: 'Title', from: editingAnnOriginal.title, to: title });
        if (editingAnnOriginal.body  !== body)  diffs.push({ label: 'Body',  from: editingAnnOriginal.body,  to: body });
      }
      if (diffs.length) logAudit('announcements', editingAnnId, 'edited', title, diffs, editingAnnOriginal ? editingAnnOriginal.postedBy : null);
    } else {
      await sbWrite('POST', 'announcements', { title: title, body: body, badge: 'general', posted_by: user.name || 'Staff', posted_by_email: user.email || '' });
    }
    hideAnnForm();
    loadAnnouncements();
  } catch(e) { alert('Could not save announcement. Please try again.'); }
}

async function deleteAnnouncement(id) {
  if (!hasEditPermission('announcements')) return;
  if (!canManageAnnouncement(id)) { alert('You can only delete your own announcements.'); return; }
  if (!confirm('Delete this announcement?')) return;
  var card = document.querySelector('[data-ann-id="' + id + '"]');
  var snapshot = card ? { title: card.querySelector('.card-title').textContent, body: card.querySelector('.card-body').textContent, posted_by: card.getAttribute('data-posted-by') || 'Staff' } : null;
  try {
    await sbWrite('DELETE', 'announcements', null, 'id=eq.' + id);
    if (snapshot) logAudit('announcements', id, 'deleted', snapshot.title, snapshot, snapshot.posted_by);
    loadAnnouncements();
  } catch(e) { alert('Could not delete announcement. Please try again.'); }
}

// ── NOTIFICATION BELL ──
var NOTIF_KEY = 'mjm_notif_seen';

function getLastSeen() {
  var v = localStorage.getItem(NOTIF_KEY);
  return v ? new Date(v) : new Date(0);
}

function markAllSeen() {
  localStorage.setItem(NOTIF_KEY, new Date().toISOString());
  var cnt = document.getElementById('notif-count');
  if (cnt) { cnt.classList.remove('visible'); cnt.textContent = '0'; }
}

async function loadNotifications() {
  if (window.location.protocol === 'file:') return;
  var lastSeen = getLastSeen();
  var now = Date.now();
  var cut7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
  try {
    var annData = await sbGet('announcements', 'limit=200');
    var evData  = await sbGet('events', 'select=id,title,event_date,created_at&limit=200');
    var items = [];
    if (annData && annData.length) {
      annData.filter(function(a){ return new Date(a.created_at) >= cut7; })
        .forEach(function(a) {
          items.push({ type:'ann', title: a.title, sub: a.body, created_at: a.created_at });
        });
    }
    if (evData && evData.length) {
      evData.filter(function(e){ return new Date(e.created_at) >= cut7; })
        .forEach(function(e) {
          var d = new Date(e.event_date+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'});
          items.push({ type:'event', title: e.title, sub: 'Event on ' + d, created_at: e.created_at });
        });
    }
    // Sort newest first
    items.sort(function(a,b){ return new Date(b.created_at) - new Date(a.created_at); });
    var unread = items.filter(function(i){ return new Date(i.created_at) > lastSeen; });
    // Update badge
    var cnt = document.getElementById('notif-count');
    if (cnt) {
      if (unread.length > 0) {
        cnt.textContent = unread.length > 9 ? '9+' : String(unread.length);
        cnt.classList.add('visible');
      } else {
        cnt.classList.remove('visible');
      }
    }
    // Populate dropdown
    var list = document.getElementById('notif-list');
    if (list) {
      if (!items.length) {
        list.innerHTML = '<div class="notif-empty">No new notifications.</div>';
      } else {
        list.innerHTML = items.slice(0,10).map(function(item) {
          var isUnread = new Date(item.created_at) > lastSeen;
          var icon = item.type === 'ann' ? '📢' : '📅';
          return '<div class="notif-item" style="' + (isUnread ? 'background:var(--green-bg);' : '') + '">'
            + '<div class="notif-item-title">' + icon + ' ' + escHtml(item.title) + '</div>'
            + '<div class="notif-item-sub">' + escHtml(item.sub) + '</div>'
            + '</div>';
        }).join('');
      }
    }
  } catch(e) {}
}

function toggleNotifDropdown() {
  var dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  var isOpen = dd.classList.contains('open');
  if (!isOpen) {
    dd.classList.add('open');
    markAllSeen();
  } else {
    dd.classList.remove('open');
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  var bell = document.getElementById('notif-bell');
  var dd   = document.getElementById('notif-dropdown');
  if (dd && dd.classList.contains('open') && bell && !bell.contains(e.target)) {
    dd.classList.remove('open');
  }
});

