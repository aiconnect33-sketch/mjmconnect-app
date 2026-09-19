// ── tab-timeoff.js — Time Off tab (time-out/time-in tracking) + Home currently-out ──
//
// Two caps: 150 min per single trip is informational only -- a trip's real
// duration isn't known until Time In, so it can only be flagged after the
// fact, never blocked at the start. 240 min total per calendar month IS
// enforced at the start of a new Time Out / reminder conversion: blocked
// outright once already used up, a confirm-to-proceed warning once past the
// near-limit threshold (that new trip's own duration can still push the
// total over -- see loadTimeOff() for the same accounting after it closes).
// "Only one open record at a time" is enforced client-side the same way.

var TIMEOFF_PER_TRIP_CAP_MIN = 150; // 2.5h
var TIMEOFF_MONTHLY_CAP_MIN  = 240; // 4h
var TIMEOFF_NEAR_LIMIT_MIN   = 180; // 75% of the monthly cap, used for the amber "near limit" state

function formatClock(d) {
  var h = d.getHours(), m = d.getMinutes();
  var ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

function formatDuration(mins) {
  mins = Math.max(0, Math.round(mins));
  var h = Math.floor(mins / 60), m = mins % 60;
  if (h <= 0) return m + 'm';
  return h + 'h ' + String(m).padStart(2, '0') + 'm';
}

function timeOffMe() {
  var raw = localStorage.getItem('mjm_user');
  return raw ? JSON.parse(raw) : {};
}

// ── Optional Google Sheet sync — see docs/time-off-sheet-sync.md for the
// Apps Script + one-time setup. Skipped entirely while the URL is blank,
// same convention as FC_SHEET_WEBHOOK_URL in js/tab-faulty.js.
var TIMEOFF_SHEET_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbzQRDxP_90L3Y11d9A6RKZpVWtpkIeer2YSfNCNEW2MPbX5-spOH0sTaPAXFmyZ-XE1/exec';
var TIMEOFF_SHEET_SECRET = 'SeW2cUlObs6M2jCq-xxSrPlhB-MHCj6mqz';

async function timeOffMonthlyMinutes(email, monthStart) {
  try {
    var url = SURL + '/rest/v1/time_off_records?staff_email=eq.' + encodeURIComponent(email)
      + '&time_out=gte.' + monthStart + '&entry_type=neq.voided&select=duration_minutes';
    var res = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
    var rows = await res.json();
    return (rows || []).reduce(function (sum, r) { return sum + (r.duration_minutes || 0); }, 0);
  } catch (e) { return 0; }
}

// Fire-and-forget, like Faulty Complain's sync -- never blocks or fails the
// real Supabase save it accompanies.
function syncTimeOffToSheet(action, record, monthlyMinutes) {
  if (!TIMEOFF_SHEET_WEBHOOK_URL) return;
  fetch(TIMEOFF_SHEET_WEBHOOK_URL, {
    method: 'POST', mode: 'no-cors',
    body: JSON.stringify({
      secret: TIMEOFF_SHEET_SECRET, action: action, id: record.id,
      staffName: record.staff_name, reason: record.reason,
      timeOut: record.time_out, timeIn: record.time_in,
      durationMinutes: record.duration_minutes, entryType: record.entry_type,
      monthlyMinutes: monthlyMinutes
    })
  }).catch(function () {});
}

async function loadTimeOff() {
  if (window.location.protocol === 'file:') return;
  var today = localDateStr();
  var me = timeOffMe();
  var myEmailLow = (me.email || '').toLowerCase();

  // ── HOME TAB: who's currently out, team-wide (same pattern as Leave/Estate Trip) ──
  var homeEl = document.getElementById('home-timeoff-today');
  if (homeEl) {
    try {
      var url = SURL + '/rest/v1/time_off_records?time_in=is.null&entry_type=neq.voided&order=time_out.asc&limit=20';
      var res = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data = await res.json();
      if (data && data.length) {
        var names = data.map(function (r) { return r.staff_name; }).join(', ');
        homeEl.innerHTML = '<div class="home-summary-card" onclick="switchNav(\'timeoff\');loadTimeOff()">'
          + '<div class="home-summary-ic" style="background:var(--blue-bg);color:var(--blue-text);"><i class="ti ti-clock"></i></div>'
          + '<div style="flex:1;min-width:0;"><div class="home-summary-title">Currently Out</div>'
          + '<div class="home-summary-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(names) + '</div></div>'
          + '<div class="home-summary-count">' + data.length + '</div>'
          + '<i class="ti ti-chevron-right home-summary-chev"></i>'
          + '</div>';
      } else {
        homeEl.innerHTML = '<div class="card" style="cursor:pointer;" onclick="switchNav(\'timeoff\');loadTimeOff()"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">No one out right now.</div></div>';
      }
    } catch (e) {
      homeEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">Could not load Time Off.</div></div>';
    }
  }

  // ── TIME OFF TAB (open to all staff) ──
  var statusEl   = document.getElementById('timeoff-status');
  var mineEl     = document.getElementById('timeoff-mine');
  var overviewEl = document.getElementById('timeoff-overview');
  var allEl      = document.getElementById('timeoff-all');
  if (!statusEl && !mineEl && !allEl) return;
  if (!me.email) return;

  try {
    var monthStart = today.slice(0, 8) + '01';
    // Team-wide, like Leave's own tab list — everyone's Time Off this month,
    // not just mine. Ownership (for the personal meter and the Cancel button)
    // is worked out client-side by filtering this same list by email, rather
    // than firing a second request.
    var url2 = SURL + '/rest/v1/time_off_records?time_out=gte.' + monthStart + '&order=time_out.desc&limit=300';
    var res2 = await fetch(url2, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
    var allRecords = await res2.json();
    if (!allRecords) allRecords = [];
    var myRecords = allRecords.filter(function (r) { return r.staff_email && r.staff_email.toLowerCase() === myEmailLow; });

    var url3 = SURL + '/rest/v1/time_off_reminders?staff_email=eq.' + encodeURIComponent(me.email)
      + '&used=eq.false&planned_date=lte.' + today + '&order=planned_date.asc&limit=5';
    var res3 = await fetch(url3, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
    var dueReminders = await res3.json();
    if (!dueReminders) dueReminders = [];

    var openRecord = myRecords.find(function (r) { return !r.time_in; });
    var monthlyMinutes = myRecords.reduce(function (sum, r) {
      if (r.entry_type === 'voided' || !r.duration_minutes) return sum;
      return sum + r.duration_minutes;
    }, 0);

    timeoffState.today = today;
    timeoffState.myEmailLow = myEmailLow;
    timeoffState.allRecords = allRecords;
    timeoffState.canManageAll = typeof hasEditPermission === 'function' && hasEditPermission('timeoff');

    if (statusEl) statusEl.innerHTML = renderTimeOffStatus(openRecord, monthlyMinutes, dueReminders);
    if (mineEl) mineEl.innerHTML = renderTimeOffMineSection();
    if (overviewEl) overviewEl.innerHTML = timeoffState.canManageAll ? renderTimeOffOverview(allRecords) : '';
    if (allEl) allEl.innerHTML = renderTimeOffAllSection();
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Could not load your Time Off status.</div></div>';
    if (mineEl) mineEl.innerHTML = '';
    if (overviewEl) overviewEl.innerHTML = '';
    if (allEl) allEl.innerHTML = '';
  }
}

function renderTimeOffStatus(openRecord, monthlyMinutes, dueReminders) {
  var pct = Math.min(100, Math.round((monthlyMinutes / TIMEOFF_MONTHLY_CAP_MIN) * 100));
  var mCls = monthlyMinutes > TIMEOFF_MONTHLY_CAP_MIN ? 'over' : (monthlyMinutes >= TIMEOFF_NEAR_LIMIT_MIN ? 'warn' : '');
  var meter = '<div class="to-meter-card">'
    + '<div class="to-meter-top"><span class="to-meter-label">This Month</span>'
    + '<span class="to-meter-value ' + mCls + '">' + formatDuration(monthlyMinutes) + ' <span style="color:var(--text-light);font-weight:500;">/ 4h 00m</span></span></div>'
    + '<div class="to-meter-track"><div class="to-meter-fill ' + mCls + '" style="width:' + pct + '%;"></div></div>'
    + '</div>';

  var html = meter;

  if (openRecord) {
    var out = new Date(openRecord.time_out);
    var elapsed = formatDuration((Date.now() - out.getTime()) / 60000);
    html += '<div class="to-out-banner">'
      + '<div class="to-status-line"><span class="to-pulse-dot"></span>YOU\'RE CURRENTLY OUT</div>'
      + '<div class="to-reason-line">' + escHtml(openRecord.reason) + '</div>'
      + '<div class="to-time-line">Out since ' + formatClock(out) + ' · ' + elapsed + ' so far</div>'
      + '<button class="book-btn-primary" style="background:var(--green-dark);margin-bottom:0;" onclick="timeInNow(' + openRecord.id + ')">✓ I\'m Back — Time In</button>'
      + '</div>';
  } else {
    html += '<div class="card">'
      + '<div class="book-form-group"><label class="book-form-label">Reason</label>'
      + '<input class="book-form-input" id="timeoff-reason" placeholder="e.g. Bank errand, clinic appointment..."></div>'
      + '<button class="book-btn-primary" onclick="timeOutNow()">🚶 Time Out Now</button>'
      + '<button class="book-btn-ghost" onclick="showPlanAheadForm()">📅 Plan Ahead</button>'
      + '</div>';
  }

  dueReminders.forEach(function (r) {
    var disabled = !!openRecord;
    html += '<div class="to-out-banner" style="border-color:var(--amber-text);background:var(--amber-bg);' + (disabled ? 'opacity:0.65;' : '') + '">'
      + '<div class="to-status-line" style="color:var(--amber-text);"><span class="to-pulse-dot" style="background:var(--amber-text);"></span>UPCOMING — ' + escHtml(r.planned_time.slice(0, 5)) + '</div>'
      + '<div class="to-reason-line">' + escHtml(r.reason) + '</div>'
      + '<div class="to-time-line">Planned ahead · tap below when you actually leave</div>'
      + (disabled
        ? '<button class="book-btn-primary" style="background:var(--text-light);margin-bottom:0;" disabled>🚫 Time In your other one first</button>'
        : '<button class="book-btn-primary" style="background:var(--blue-text);margin-bottom:0;" onclick="convertReminder(' + r.id + ')">🚶 Time Out Now</button>')
      + '<button class="book-btn-ghost" style="border-color:var(--red-text);color:var(--red-text);margin-top:2px;" onclick="cancelReminder(' + r.id + ')">✕ Cancel — not taking this Time Off</button>'
      + '</div>';
  });

  html += '<button class="book-btn-ghost" style="border-color:var(--red-text);color:var(--red-text);margin-top:2px;" onclick="showBackfillForm()">📝 Log a Missed Time Off</button>';

  return html;
}

// Per-staff monthly totals, shown only to whoever can manage all Time Off
// records (HR Admin/Super Admin or a staff member granted the "Time Off"
// edit permission) -- mirrors the Staff Overview list in admin.html.
function renderTimeOffOverview(records) {
  var avColors = ['av-green', 'av-amber', 'av-coral', 'av-blue', 'av-purple', 'av-red'];
  var byStaff = {};
  records.forEach(function (r) {
    if (!byStaff[r.staff_name]) byStaff[r.staff_name] = { minutes: 0, count: 0 };
    byStaff[r.staff_name].count++;
    if (r.entry_type !== 'voided' && r.duration_minutes) byStaff[r.staff_name].minutes += r.duration_minutes;
  });
  var staffList = Object.keys(byStaff).map(function (name) { return { name: name, minutes: byStaff[name].minutes, count: byStaff[name].count }; });
  if (!staffList.length) return '';
  staffList.sort(function (a, b) { return b.minutes - a.minutes; });

  var html = '<div class="section-row"><div class="section-title">Staff Overview — This Month</div></div><div class="card">';
  html += staffList.map(function (s, i) {
    var ini = s.name.split(' ').filter(Boolean).slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join('');
    var avCls = avColors[i % avColors.length];
    var status = s.minutes >= TIMEOFF_MONTHLY_CAP_MIN ? { label: 'Over', cls: 'badge-urgent' }
      : s.minutes >= TIMEOFF_NEAR_LIMIT_MIN ? { label: 'Near limit', cls: 'badge-amber' }
      : { label: 'Within', cls: 'badge-blue' };
    return '<div class="person-row">'
      + '<div class="avatar ' + avCls + '">' + ini + '</div>'
      + '<div style="flex:1;"><div class="person-name">' + escHtml(s.name) + '</div>'
      + '<div class="person-sub">' + s.count + ' time-off' + (s.count === 1 ? '' : 's') + '</div></div>'
      + '<div style="text-align:right;"><div style="font-weight:700;font-size:12.5px;color:var(--text-primary);">' + formatDuration(s.minutes) + '</div>'
      + '<span class="badge ' + status.cls + '">' + status.label + '</span></div>'
      + '</div>';
  }).join('');
  html += '</div>';
  return html;
}

// ── My Records / All Records — both start collapsed to a one-line summary,
// tap to expand. State persists across re-renders (e.g. after a save) so
// the accordion doesn't snap shut mid-edit. ──
var timeoffState = {
  today: '', myEmailLow: '', allRecords: [], canManageAll: false,
  mineOpen: false, allOpen: false, mineCancelledOpen: false, allCancelledOpen: false
};

function timeoffToggleRowHtml(icon, title, summary, isOpen, onclickFn) {
  return '<button class="to-toggle-row" onclick="' + onclickFn + '">'
    + '<div class="to-toggle-left"><div class="to-toggle-ic">' + icon + '</div>'
    + '<div><div class="to-toggle-title">' + title + '</div><div class="to-toggle-sub">' + escHtml(summary) + '</div></div></div>'
    + '<span class="to-toggle-chev" style="' + (isOpen ? 'transform:rotate(180deg);' : '') + '">▾</span>'
    + '</button>';
}
function timeoffCancelToggleHtml(count, isOpen, onclickFn) {
  if (!count) return '';
  return '<button class="to-cancel-toggle" onclick="' + onclickFn + '">' + (isOpen ? 'Hide ' : 'Show ') + count + ' cancelled</button>';
}
function timeoffGroupByDate(records, today) {
  var groups = [], byLabel = {};
  records.forEach(function (r) {
    var out = new Date(r.time_out);
    var label = localDateStr(out) === today ? 'Today' : out.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
    if (!byLabel[label]) { byLabel[label] = { label: label, items: [] }; groups.push(byLabel[label]); }
    byLabel[label].items.push(r);
  });
  return groups;
}

// key namespaces the correction row's DOM ids by section ('mine-<id>' /
// 'all-<id>') -- a record the viewer owns shows up in both My Records and
// All Records, and without this, both correction rows would collide on the
// same element id.
function renderTimeOffRow(r, myEmailLow, canManageAll, sectionKey) {
  var isMine = r.staff_email && r.staff_email.toLowerCase() === myEmailLow;
  var canManage = canManageAll || isMine;
  var out = new Date(r.time_out);
  var timeLabel = formatClock(out) + (r.time_in ? ' → ' + formatClock(new Date(r.time_in)) : ' → still out');
  var badge = r.duration_minutes > TIMEOFF_PER_TRIP_CAP_MIN
    ? '<span class="badge badge-urgent">' + formatDuration(r.duration_minutes) + '</span>'
    : '<span class="badge badge-blue">' + formatDuration(r.duration_minutes || 0) + '</span>';
  var entryNote = r.entry_type === 'edited' ? ' <span style="color:var(--amber-text);font-weight:700;">(edited)</span>'
    : r.entry_type === 'backfilled' ? ' <span style="color:var(--red-text);font-weight:700;">(backfilled)</span>' : '';
  var reasonLabel = isMine ? escHtml(r.reason) : (escHtml(r.staff_name) + ' — ' + escHtml(r.reason));
  var key = sectionKey + '-' + r.id;

  // Correcting Time In/Out is admin/permission-only -- unlike the Cancel
  // button below, ownership alone must NOT unlock it, or every staff member
  // could quietly rewrite their own already-taken Time Off.
  var canCorrect = canManageAll && !!r.time_in;
  var editIcon = canCorrect
    ? '<div class="to-edit-icon" onclick="toggleTimeOffCorrection(\'' + key + '\', ' + r.id + ')" title="Correct Time In"><i class="ti ti-pencil"></i></div>'
    : '';

  var html = '<div class="to-history-row" data-timeoff-id="' + escHtml(r.id) + '" data-staff-email="' + escHtml(r.staff_email || '') + '">'
    + '<div class="to-history-top">'
    + '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:6px;">'
    + '<div class="to-history-reason">' + reasonLabel + '</div>' + editIcon
    + '</div>' + badge + '</div>'
    + '<div class="to-history-time">' + timeLabel + entryNote + '</div>';

  if (canCorrect) {
    var outHH = String(out.getHours()).padStart(2, '0');
    var outMM = String(out.getMinutes()).padStart(2, '0');
    var inD = new Date(r.time_in);
    var inHH = String(inD.getHours()).padStart(2, '0');
    var inMM = String(inD.getMinutes()).padStart(2, '0');
    html += '<div class="to-correct-row" id="to-correct-row-' + key + '" style="display:none;">'
      + '<div class="to-correct-field"><label>Time Out</label><input type="time" id="to-correct-out-' + key + '" value="' + outHH + ':' + outMM + '"></div>'
      + '<div class="to-correct-field"><label>Time In</label><input type="time" id="to-correct-in-' + key + '" value="' + inHH + ':' + inMM + '"></div>'
      + '<button class="book-btn-primary" style="width:100%;margin:0;" onclick="saveTimeOffCorrection(\'' + key + '\', ' + r.id + ')">Save</button>'
      + '</div>';
  }

  if (canManage && r.duration_minutes > TIMEOFF_PER_TRIP_CAP_MIN) {
    html += '<div class="to-warn red">'
      + '<b>⚠ This trip ran ' + formatDuration(r.duration_minutes) + ' — over the 2.5h single-application limit.</b>'
      + 'The whole trip needs to go through Annual Leave instead of Time Off.'
      + '<button style="width:100%;margin-top:10px;background:var(--red-text);color:#fff;border:none;border-radius:var(--radius-sm);padding:9px;font-size:11.5px;font-weight:700;" onclick="voidTimeOff(' + r.id + ')">↩ Cancel This Trip</button>'
      + '</div>';
  }
  html += '</div>';
  return html;
}

function renderTimeOffVoidedRow(r, myEmailLow) {
  var isMine = r.staff_email && r.staff_email.toLowerCase() === myEmailLow;
  var reasonLabel = isMine ? escHtml(r.reason) : (escHtml(r.staff_name) + ' — ' + escHtml(r.reason));
  var out = new Date(r.time_out);
  var timeLabel = formatClock(out) + (r.time_in ? ' → ' + formatClock(new Date(r.time_in)) : ' → still out');
  return '<div class="to-history-row" style="opacity:0.6;">'
    + '<div class="to-history-top"><div class="to-history-reason" style="text-decoration:line-through;">' + reasonLabel + '</div>'
    + '<span class="badge" style="background:var(--bg);color:var(--text-light);">Voided</span></div>'
    + '<div class="to-history-time">' + timeLabel + ' — moved to Annual Leave</div></div>';
}

function renderTimeOffMineSection() {
  var myEmailLow = timeoffState.myEmailLow;
  var today = timeoffState.today;
  var mine = timeoffState.allRecords.filter(function (r) { return r.staff_email && r.staff_email.toLowerCase() === myEmailLow; });
  var nonVoided = mine.filter(function (r) { return r.entry_type !== 'voided'; });
  var voided = mine.filter(function (r) { return r.entry_type === 'voided'; });
  var totalMinutes = nonVoided.reduce(function (sum, r) { return sum + (r.duration_minutes || 0); }, 0);
  var summary = timeoffState.mineOpen ? 'Tap to collapse'
    : (mine.length ? (mine.length + (mine.length === 1 ? ' entry' : ' entries') + ' this month · ' + formatDuration(totalMinutes)) : 'No entries this month');
  var html = timeoffToggleRowHtml('🗂', 'My Records', summary, timeoffState.mineOpen, "toggleTimeOffSection('mine')");
  if (timeoffState.mineOpen) {
    if (!mine.length) {
      html += '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No Time Off logged this month.</div>';
    } else {
      timeoffGroupByDate(nonVoided, today).forEach(function (g) {
        html += '<div class="to-day-label">' + escHtml(g.label) + '</div>';
        g.items.forEach(function (r) { html += renderTimeOffRow(r, myEmailLow, timeoffState.canManageAll, 'mine'); });
      });
      html += timeoffCancelToggleHtml(voided.length, timeoffState.mineCancelledOpen, "toggleTimeOffCancelled('mine')");
      if (timeoffState.mineCancelledOpen) voided.forEach(function (r) { html += renderTimeOffVoidedRow(r, myEmailLow); });
    }
  }
  return html;
}

function renderTimeOffAllSection() {
  var myEmailLow = timeoffState.myEmailLow;
  var today = timeoffState.today;
  var canManageAll = timeoffState.canManageAll;
  var all = timeoffState.allRecords;
  var nonVoided = all.filter(function (r) { return r.entry_type !== 'voided'; });
  var voided = all.filter(function (r) { return r.entry_type === 'voided'; });
  var staffSet = {}; all.forEach(function (r) { staffSet[r.staff_name] = 1; });
  var staffTotal = Object.keys(staffSet).length;
  var summary = timeoffState.allOpen ? 'Tap to collapse'
    : (all.length ? (all.length + (all.length === 1 ? ' entry' : ' entries') + ' this month · ' + staffTotal + (staffTotal === 1 ? ' staff' : ' staff')) : 'No entries this month');
  var html = timeoffToggleRowHtml('👥', 'All Records', summary, timeoffState.allOpen, "toggleTimeOffSection('all')");
  if (timeoffState.allOpen) {
    if (!all.length) {
      html += '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No Time Off logged this month.</div>';
    } else {
      timeoffGroupByDate(nonVoided, today).forEach(function (g) {
        html += '<div class="to-day-label">' + escHtml(g.label) + '</div>';
        g.items.forEach(function (r) { html += renderTimeOffRow(r, myEmailLow, canManageAll, 'all'); });
      });
      html += timeoffCancelToggleHtml(voided.length, timeoffState.allCancelledOpen, "toggleTimeOffCancelled('all')");
      if (timeoffState.allCancelledOpen) voided.forEach(function (r) { html += renderTimeOffVoidedRow(r, myEmailLow); });
    }
  }
  return html;
}

function rerenderTimeOffSections() {
  var mineEl = document.getElementById('timeoff-mine');
  var allEl = document.getElementById('timeoff-all');
  if (mineEl) mineEl.innerHTML = renderTimeOffMineSection();
  if (allEl) allEl.innerHTML = renderTimeOffAllSection();
}
function toggleTimeOffSection(which) {
  if (which === 'mine') timeoffState.mineOpen = !timeoffState.mineOpen;
  else timeoffState.allOpen = !timeoffState.allOpen;
  rerenderTimeOffSections();
}
function toggleTimeOffCancelled(which) {
  if (which === 'mine') timeoffState.mineCancelledOpen = !timeoffState.mineCancelledOpen;
  else timeoffState.allCancelledOpen = !timeoffState.allCancelledOpen;
  rerenderTimeOffSections();
}

// HR Admin/Super Admin, or a staff member granted "Time Off" edit permission,
// can manage anyone's record; everyone else can only manage their own -- the
// same ownership signal already used by Leave and Estate Trip. This governs
// self-service actions like cancelling your own over-cap trip.
function canManageTimeOff(id) {
  if (canCorrectTimeOff()) return true;
  var me = timeOffMe();
  var row = document.querySelector('[data-timeoff-id="' + id + '"]');
  var ownerEmail = row ? (row.getAttribute('data-staff-email') || '') : '';
  return !!(me.email && ownerEmail && me.email.toLowerCase() === ownerEmail.toLowerCase());
}

// Correcting Time In/Out is stricter than canManageTimeOff -- admin or the
// granted permission ONLY, never ownership alone, so staff can't quietly
// rewrite their own already-taken Time Off.
function canCorrectTimeOff() {
  return typeof hasEditPermission === 'function' && hasEditPermission('timeoff');
}

function toggleTimeOffCorrection(key, id) {
  if (!canCorrectTimeOff()) return;
  var row = document.getElementById('to-correct-row-' + key);
  if (!row) return;
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
}

async function saveTimeOffCorrection(key, id) {
  if (!canCorrectTimeOff()) { alert('You do not have permission to edit Time Off records.'); return; }
  var outInput = document.getElementById('to-correct-out-' + key);
  var inInput  = document.getElementById('to-correct-in-' + key);
  if (!outInput || !inInput || !outInput.value || !inInput.value) return;
  try {
    var rows = await fetch(SURL + '/rest/v1/time_off_records?id=eq.' + id, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    var record = rows && rows[0];
    if (!record) return;
    // Both fields are anchored to the trip's original day -- Time Off never
    // spans midnight, so there's no separate date picker for either one.
    var anchor = new Date(record.time_out);
    var outParts = outInput.value.split(':');
    var inParts  = inInput.value.split(':');
    var newTimeOut = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), parseInt(outParts[0], 10), parseInt(outParts[1], 10));
    var newTimeIn  = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), parseInt(inParts[0], 10), parseInt(inParts[1], 10));
    var duration = Math.round((newTimeIn.getTime() - newTimeOut.getTime()) / 60000);
    if (duration < 0) { alert('Time In cannot be before Time Out.'); return; }
    var patch = { time_out: newTimeOut.toISOString(), time_in: newTimeIn.toISOString(), duration_minutes: duration, entry_type: 'edited', corrected_at: new Date().toISOString() };
    if (!record.original_time_in) patch.original_time_in = record.time_in;
    await sbWrite('PATCH', 'time_off_records', patch, 'id=eq.' + id);
    loadTimeOff();
    record.time_in = newTimeIn.toISOString(); record.duration_minutes = duration;
    var monthStart = localDateStr().slice(0, 8) + '01';
    timeOffMonthlyMinutes(record.staff_email, monthStart).then(function (mins) { syncTimeOffToSheet('update', record, mins); });
  } catch (e) { alert('Could not save the correction. Please try again.'); }
}

// ── ACTIONS ──

async function timeOutNow() {
  var me = timeOffMe();
  var reasonEl = document.getElementById('timeoff-reason');
  var reason = reasonEl ? reasonEl.value.trim() : '';
  if (!reason) { alert('Please describe the reason for this Time Off.'); return; }
  try {
    var existing = await fetch(SURL + '/rest/v1/time_off_records?staff_email=eq.' + encodeURIComponent(me.email) + '&time_in=is.null&limit=1',
      { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    if (existing && existing.length) { alert('You already have an open Time Off. Time In on that one first.'); return; }

    var monthStart = localDateStr().slice(0, 8) + '01';
    var monthlyMinutes = await timeOffMonthlyMinutes(me.email, monthStart);
    if (monthlyMinutes >= TIMEOFF_MONTHLY_CAP_MIN) {
      alert('Monthly limit reached\n\nYou\'ve used your full 4h 00m Time Off allowance this month. Please go through Annual Leave instead of Time Off.');
      return;
    }
    if (monthlyMinutes >= TIMEOFF_NEAR_LIMIT_MIN) {
      var remaining = formatDuration(TIMEOFF_MONTHLY_CAP_MIN - monthlyMinutes);
      if (!confirm('Low Time Off balance\n\nYou have ' + remaining + ' left this month. If this trip runs longer, it\'ll be flagged for HR to review.\n\nContinue?')) return;
    }

    await sbWrite('POST', 'time_off_records', {
      staff_name: me.name || me.email, staff_email: me.email,
      reason: reason, time_out: new Date().toISOString()
    });
    loadTimeOff();
  } catch (e) { alert('Could not start Time Off. Please try again.'); }
}

async function timeInNow(id) {
  try {
    var rows = await fetch(SURL + '/rest/v1/time_off_records?id=eq.' + id, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    var record = rows && rows[0];
    if (!record) return;
    var timeIn = new Date();
    var duration = Math.round((timeIn.getTime() - new Date(record.time_out).getTime()) / 60000);
    await sbWrite('PATCH', 'time_off_records', { time_in: timeIn.toISOString(), duration_minutes: duration }, 'id=eq.' + id);
    loadTimeOff();
    record.time_in = timeIn.toISOString(); record.duration_minutes = duration;
    var monthStart = localDateStr().slice(0, 8) + '01';
    timeOffMonthlyMinutes(record.staff_email, monthStart).then(function (mins) { syncTimeOffToSheet('create', record, mins); });
  } catch (e) { alert('Could not record Time In. Please try again.'); }
}

async function voidTimeOff(id) {
  if (!canManageTimeOff(id)) { alert('You can only cancel your own Time Off records.'); return; }
  if (!confirm('Cancel this trip and apply Annual Leave instead? The record stays on file marked Voided, and the full duration is returned to your monthly buffer. You\'ll need to apply for Annual Leave separately to cover the day.')) return;
  try {
    var rows = await fetch(SURL + '/rest/v1/time_off_records?id=eq.' + id, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    var record = rows && rows[0];
    await sbWrite('PATCH', 'time_off_records', { entry_type: 'voided' }, 'id=eq.' + id);
    loadTimeOff();
    if (record) {
      record.entry_type = 'voided';
      var monthStart = localDateStr().slice(0, 8) + '01';
      timeOffMonthlyMinutes(record.staff_email, monthStart).then(function (mins) { syncTimeOffToSheet('update', record, mins); });
    }
  } catch (e) { alert('Could not cancel this trip. Please try again.'); }
}

// ── PLAN AHEAD ──

function showPlanAheadForm() {
  document.getElementById('timeoff-pa-reason').value = '';
  document.getElementById('timeoff-pa-date').value = localDateStr();
  document.getElementById('timeoff-pa-time').value = '';
  document.getElementById('timeoff-planahead-form').style.display = 'block';
  document.getElementById('timeoff-planahead-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function hidePlanAheadForm() {
  document.getElementById('timeoff-planahead-form').style.display = 'none';
}
async function savePlanAheadReminder() {
  var me = timeOffMe();
  var reason = document.getElementById('timeoff-pa-reason').value.trim();
  var date   = document.getElementById('timeoff-pa-date').value;
  var time   = document.getElementById('timeoff-pa-time').value;
  if (!reason || !date || !time) { alert('Please fill in the reason, date, and time.'); return; }
  try {
    await sbWrite('POST', 'time_off_reminders', {
      staff_name: me.name || me.email, staff_email: me.email,
      reason: reason, planned_date: date, planned_time: time
    });
    hidePlanAheadForm();
    loadTimeOff();
  } catch (e) { alert('Could not save the reminder. Please try again.'); }
}

async function convertReminder(id) {
  var me = timeOffMe();
  try {
    var existing = await fetch(SURL + '/rest/v1/time_off_records?staff_email=eq.' + encodeURIComponent(me.email) + '&time_in=is.null&limit=1',
      { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    if (existing && existing.length) { alert('You already have an open Time Off. Time In on that one first.'); return; }

    var monthStart = localDateStr().slice(0, 8) + '01';
    var monthlyMinutes = await timeOffMonthlyMinutes(me.email, monthStart);
    if (monthlyMinutes >= TIMEOFF_MONTHLY_CAP_MIN) {
      alert('Monthly limit reached\n\nYou\'ve used your full 4h 00m Time Off allowance this month. Please go through Annual Leave instead of Time Off.');
      return;
    }
    if (monthlyMinutes >= TIMEOFF_NEAR_LIMIT_MIN) {
      var remaining = formatDuration(TIMEOFF_MONTHLY_CAP_MIN - monthlyMinutes);
      if (!confirm('Low Time Off balance\n\nYou have ' + remaining + ' left this month. If this trip runs longer, it\'ll be flagged for HR to review.\n\nContinue?')) return;
    }

    var rows = await fetch(SURL + '/rest/v1/time_off_reminders?id=eq.' + id, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    var reminder = rows && rows[0];
    if (!reminder) return;
    await sbWrite('POST', 'time_off_records', {
      staff_name: reminder.staff_name, staff_email: reminder.staff_email,
      reason: reminder.reason, time_out: new Date().toISOString()
    });
    await sbWrite('PATCH', 'time_off_reminders', { used: true }, 'id=eq.' + id);
    loadTimeOff();
  } catch (e) { alert('Could not start this Time Off. Please try again.'); }
}

async function cancelReminder(id) {
  if (!confirm('Cancel this planned Time Off? No trip will be recorded.')) return;
  try {
    await sbWrite('DELETE', 'time_off_reminders', null, 'id=eq.' + id);
    loadTimeOff();
  } catch (e) { alert('Could not cancel this reminder. Please try again.'); }
}

// ── LOG A MISSED TIME OFF (backfill) ──

function showBackfillForm() {
  document.getElementById('timeoff-bf-reason').value = '';
  document.getElementById('timeoff-bf-date').value = localDateStr();
  document.getElementById('timeoff-bf-out').value = '';
  document.getElementById('timeoff-bf-in').value = '';
  document.getElementById('timeoff-backfill-form').style.display = 'block';
  document.getElementById('timeoff-backfill-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function hideBackfillForm() {
  document.getElementById('timeoff-backfill-form').style.display = 'none';
}
async function saveBackfillEntry() {
  var me = timeOffMe();
  var reason = document.getElementById('timeoff-bf-reason').value.trim();
  var date   = document.getElementById('timeoff-bf-date').value;
  var outT   = document.getElementById('timeoff-bf-out').value;
  var inT    = document.getElementById('timeoff-bf-in').value;
  if (!reason || !date || !outT || !inT) { alert('Please fill in the reason, date, and both times.'); return; }
  var outParts = outT.split(':'), inParts = inT.split(':');
  var timeOut = new Date(date + 'T00:00:00'); timeOut.setHours(parseInt(outParts[0], 10), parseInt(outParts[1], 10));
  var timeIn  = new Date(date + 'T00:00:00'); timeIn.setHours(parseInt(inParts[0], 10), parseInt(inParts[1], 10));
  if (timeIn <= timeOut) { alert('Time In must be after Time Out.'); return; }
  var duration = Math.round((timeIn.getTime() - timeOut.getTime()) / 60000);
  try {
    var created = await sbWrite('POST', 'time_off_records', {
      staff_name: me.name || me.email, staff_email: me.email,
      reason: reason, time_out: timeOut.toISOString(), time_in: timeIn.toISOString(),
      duration_minutes: duration, entry_type: 'backfilled'
    });
    hideBackfillForm();
    loadTimeOff();
    var newRecord = created && created[0];
    if (newRecord) {
      var monthStart = localDateStr().slice(0, 8) + '01';
      timeOffMonthlyMinutes(me.email, monthStart).then(function (mins) { syncTimeOffToSheet('create', newRecord, mins); });
    }
  } catch (e) { alert('Could not log this Time Off. Please try again.'); }
}
