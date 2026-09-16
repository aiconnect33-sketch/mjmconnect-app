// ── tab-timeoff.js — Time Off tab (time-out/time-in tracking) + Home currently-out ──
//
// Two caps, both informational only (never block a save): 150 min per single
// trip, 240 min total per calendar month. "Only one open record at a time"
// is enforced client-side before a new Time Out / reminder conversion.

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
  var raw = sessionStorage.getItem('mjm_user');
  return raw ? JSON.parse(raw) : {};
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
        homeEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">No one out right now.</div></div>';
      }
    } catch (e) {
      homeEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">Could not load Time Off.</div></div>';
    }
  }

  // ── TIME OFF TAB (open to all staff) ──
  var statusEl  = document.getElementById('timeoff-status');
  var recordsEl = document.getElementById('timeoff-records');
  if (!statusEl && !recordsEl) return;
  if (!me.email) return;

  try {
    var monthStart = today.slice(0, 8) + '01';
    var url2 = SURL + '/rest/v1/time_off_records?staff_email=eq.' + encodeURIComponent(me.email)
      + '&time_out=gte.' + monthStart + '&order=time_out.desc&limit=200';
    var res2 = await fetch(url2, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
    var myRecords = await res2.json();
    if (!myRecords) myRecords = [];

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

    if (statusEl) statusEl.innerHTML = renderTimeOffStatus(openRecord, monthlyMinutes, dueReminders);
    if (recordsEl) recordsEl.innerHTML = renderTimeOffRecords(myRecords, today);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Could not load your Time Off status.</div></div>';
    if (recordsEl) recordsEl.innerHTML = '';
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
      + '</div>';
  });

  html += '<button class="book-btn-ghost" style="border:none;color:var(--text-secondary);font-size:11.5px;" onclick="showBackfillForm()">Forgot to tap either button? Log a Missed Time Off</button>';

  return html;
}

function renderTimeOffRecords(records, today) {
  if (!records.length) return '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No Time Off logged this month.</div>';

  var html = '<div class="section-row"><div class="section-title">This Month</div></div>';
  records.forEach(function (r) {
    var out = new Date(r.time_out);
    var dateLabel = localDateStr(out) === today ? 'Today' : out.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
    var timeLabel = formatClock(out) + (r.time_in ? ' → ' + formatClock(new Date(r.time_in)) : ' → still out');
    var voided = r.entry_type === 'voided';
    var badge = voided
      ? '<span class="badge" style="background:var(--bg);color:var(--text-light);">Voided</span>'
      : (r.duration_minutes > TIMEOFF_PER_TRIP_CAP_MIN
        ? '<span class="badge badge-urgent">' + formatDuration(r.duration_minutes) + '</span>'
        : '<span class="badge badge-blue">' + formatDuration(r.duration_minutes || 0) + '</span>');
    var entryNote = r.entry_type === 'edited' ? ' <span style="color:var(--amber-text);font-weight:700;">(edited)</span>'
      : r.entry_type === 'backfilled' ? ' <span style="color:var(--red-text);font-weight:700;">(backfilled)</span>'
      : voided ? ' <span style="color:var(--text-light);">— moved to Annual Leave</span>' : '';

    var canCorrect = !voided && r.time_in && (r.entry_type === 'live' || r.entry_type === 'edited') && localDateStr(new Date(r.time_in)) === today;
    var editIcon = canCorrect
      ? '<div class="to-edit-icon" onclick="toggleTimeOffCorrection(' + r.id + ')" title="Correct Time In"><i class="ti ti-pencil"></i></div>'
      : '';

    html += '<div class="to-history-row" style="' + (voided ? 'opacity:0.6;' : '') + '">'
      + '<div class="to-history-top">'
      + '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:6px;">'
      + '<div class="to-history-reason" style="' + (voided ? 'text-decoration:line-through;' : '') + '">' + escHtml(r.reason) + '</div>' + editIcon
      + '</div>' + badge + '</div>'
      + '<div class="to-history-time">' + dateLabel + ' · ' + timeLabel + entryNote + '</div>';

    if (canCorrect) {
      var hh = String(new Date(r.time_in).getHours()).padStart(2, '0');
      var mm = String(new Date(r.time_in).getMinutes()).padStart(2, '0');
      html += '<div class="to-correct-row" id="to-correct-row-' + r.id + '" style="display:none;">'
        + '<input type="time" id="to-correct-' + r.id + '" value="' + hh + ':' + mm + '">'
        + '<button class="book-btn-primary" style="width:auto;margin:0;padding:8px 12px;" onclick="saveTimeOffCorrection(' + r.id + ')">Save</button>'
        + '</div>';
    }
    if (!voided && r.duration_minutes > TIMEOFF_PER_TRIP_CAP_MIN) {
      html += '<div class="to-warn red">'
        + '<b>⚠ This trip ran ' + formatDuration(r.duration_minutes) + ' — over the 2.5h single-application limit.</b>'
        + 'The whole trip needs to go through Annual Leave instead of Time Off.'
        + '<button style="width:100%;margin-top:10px;background:var(--red-text);color:#fff;border:none;border-radius:var(--radius-sm);padding:9px;font-size:11.5px;font-weight:700;" onclick="voidTimeOff(' + r.id + ')">↩ Cancel This Trip</button>'
        + '</div>';
    }
    html += '</div>';
  });
  return html;
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
  } catch (e) { alert('Could not record Time In. Please try again.'); }
}

function toggleTimeOffCorrection(id) {
  var row = document.getElementById('to-correct-row-' + id);
  if (!row) return;
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
}

async function saveTimeOffCorrection(id) {
  var input = document.getElementById('to-correct-' + id);
  if (!input || !input.value) return;
  try {
    var rows = await fetch(SURL + '/rest/v1/time_off_records?id=eq.' + id, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    var record = rows && rows[0];
    if (!record) return;
    var oldTimeIn = new Date(record.time_in);
    var parts = input.value.split(':');
    var newTimeIn = new Date(oldTimeIn.getFullYear(), oldTimeIn.getMonth(), oldTimeIn.getDate(), parseInt(parts[0], 10), parseInt(parts[1], 10));
    var duration = Math.round((newTimeIn.getTime() - new Date(record.time_out).getTime()) / 60000);
    if (duration < 0) { alert('Time In cannot be before Time Out.'); return; }
    var patch = {
      time_in: newTimeIn.toISOString(), duration_minutes: duration,
      entry_type: 'edited', corrected_at: new Date().toISOString()
    };
    if (!record.original_time_in) patch.original_time_in = record.time_in;
    await sbWrite('PATCH', 'time_off_records', patch, 'id=eq.' + id);
    loadTimeOff();
  } catch (e) { alert('Could not save the correction. Please try again.'); }
}

async function voidTimeOff(id) {
  if (!confirm('Cancel this trip and apply Annual Leave instead? The record stays on file marked Voided, and the full duration is returned to your monthly buffer. You\'ll need to apply for Annual Leave separately to cover the day.')) return;
  try {
    await sbWrite('PATCH', 'time_off_records', { entry_type: 'voided' }, 'id=eq.' + id);
    loadTimeOff();
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
    await sbWrite('POST', 'time_off_records', {
      staff_name: me.name || me.email, staff_email: me.email,
      reason: reason, time_out: timeOut.toISOString(), time_in: timeIn.toISOString(),
      duration_minutes: duration, entry_type: 'backfilled'
    });
    hideBackfillForm();
    loadTimeOff();
  } catch (e) { alert('Could not log this Time Off. Please try again.'); }
}
