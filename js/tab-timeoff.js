// ── tab-timeoff.js — Time Off tab (time-out/time-in tracking) + Home currently-out ──
//
// Two caps: 120 min per single trip (every trip is charged in whole hours,
// any part of an hour rounding up) IS enforced -- once a still-open trip's
// live elapsed time passes 120 min, Time In is blocked outright and the
// banner swaps to a "Request Cancellation" action instead (see
// renderTimeOffStatus/timeInNow below). A trip's real duration isn't known
// until Time In, so this can only be checked once already out, never at the
// moment of Time Out. 240 min total per calendar month IS enforced at the
// start of a new Time Out / reminder conversion too: blocked outright once
// already used up, a confirm-to-proceed warning once past the near-limit
// threshold (that new trip's own duration can still push the total over --
// see loadTimeOff() for the same accounting after it closes). Both caps are
// compared against CHARGED minutes (chargedMinutes() below), not raw clock
// duration. "Only one open record at a time" is enforced client-side the
// same way.
//
// Going over the per-trip cap no longer self-voids immediately: the staff
// requests a cancellation (requestCancelTimeOff), which HR Admin/a permitted
// staff member approves (approveCancelTimeOff) before it actually moves to
// Voided -- see the 'cancel_pending' entry_type throughout this file.

var TIMEOFF_PER_TRIP_CAP_MIN = 120; // 2h -- hard block once a trip runs longer than this
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

// Every trip is charged in whole hours, rounding any part of an hour up --
// 15 min and 40 min both charge "1h". A trip that hasn't closed yet (no
// duration recorded) still charges a minimum 1h, matching what the live
// "will be charged" pill on the Currently Out banner already shows before
// Time In. Used everywhere quota is computed; formatDuration above is kept
// for showing a record's own real clock-time duration alongside it.
function chargedMinutes(durationMinutes) {
  var m = Math.max(0, durationMinutes || 0);
  return Math.max(60, Math.ceil(m / 60) * 60);
}

// chargedMinutes() is always a multiple of 60, so this is just "/60 + h" --
// no need for formatDuration's h/m split.
function formatChargedHours(mins) {
  return Math.round(mins / 60) + 'h';
}

// How much a single record counts for towards the monthly total -- voided
// and pending-cancellation records count for nothing, a closed record uses
// its real duration, and a still-open one counts its LIVE elapsed charge
// (recomputed on every call, same as the Currently Out banner's own pill)
// so the meter keeps up with "will be charged if you Time In now" instead
// of sitting at 0 until Time In.
function timeoffRecordChargedMinutes(r) {
  if (r.entry_type === 'voided' || r.entry_type === 'cancel_pending') return 0;
  if (r.duration_minutes) return chargedMinutes(r.duration_minutes);
  if (!r.time_in) return chargedMinutes((Date.now() - new Date(r.time_out).getTime()) / 60000);
  return 0;
}

// Per staff member, walks that month's countable records in chronological
// order and flags the ONE that first pushes the running total past the
// monthly cap -- mirrors the live Currently-Out banner's own check
// (renderTimeOffStatus), but for a record that's already closed (so there
// was no "still open" moment to block Time In on). Only the crossing
// record is flagged, not every record after it, so a month that's already
// over the cap doesn't light up every later trip too. Returns a plain
// object of {id: true} for fast lookup in renderTimeOffRow.
function timeoffComputeMonthlyTriggers(records) {
  // Grouped by staff AND calendar month (not just staff) -- every current
  // caller already passes one month's records, so this changes nothing for
  // them, but it keeps the cumulative sum from bleeding across a month
  // boundary if a caller (e.g. a multi-month report) ever passes more.
  var byStaffMonth = {};
  records.forEach(function (r) {
    var staffKey = (r.staff_email || '').toLowerCase() || r.staff_name;
    var monthKey = (r.time_out || '').slice(0, 7);
    var key = staffKey + '|' + monthKey;
    if (!byStaffMonth[key]) byStaffMonth[key] = [];
    byStaffMonth[key].push(r);
  });
  var triggers = {};
  Object.keys(byStaffMonth).forEach(function (key) {
    var list = byStaffMonth[key].filter(function (r) {
      return r.entry_type !== 'voided' && r.entry_type !== 'cancel_pending';
    }).slice().sort(function (a, b) { return new Date(a.time_out) - new Date(b.time_out); });
    var cumulative = 0;
    list.forEach(function (r) {
      var before = cumulative;
      cumulative += timeoffRecordChargedMinutes(r);
      if (before <= TIMEOFF_MONTHLY_CAP_MIN && cumulative > TIMEOFF_MONTHLY_CAP_MIN) {
        triggers[r.id] = true;
      }
    });
  });
  return triggers;
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
      + '&time_out=gte.' + monthStart + '&entry_type=neq.voided&entry_type=neq.cancel_pending&select=duration_minutes';
    var res = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
    var rows = await res.json();
    return (rows || []).reduce(function (sum, r) { return sum + (r.duration_minutes ? chargedMinutes(r.duration_minutes) : 0); }, 0);
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

  // Resolve each staff's CURRENT name by email, rather than trusting the
  // name snapshotted onto each record at the time it was created -- a
  // staff member who renames themselves would otherwise fragment into two
  // separate people wherever records are grouped/labeled by name (the
  // Home "Currently Out" card below, Staff Overview, and everyone else's
  // view of "All Records"). Their own "My Records" is unaffected either
  // way, since that's already filtered by email, not name.
  try {
    var nameMapRows = await fetch(SURL + '/rest/v1/profiles?select=email,full_name&limit=500',
      { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    timeoffNameMap = {};
    (nameMapRows || []).forEach(function (p) { if (p.email && p.full_name) timeoffNameMap[p.email.toLowerCase()] = p.full_name; });
  } catch (e) { timeoffNameMap = {}; }

  // ── HOME TAB: who's currently out, team-wide (same pattern as Leave/Estate Trip) ──
  var homeEl = document.getElementById('home-timeoff-today');
  if (homeEl) {
    try {
      var url = SURL + '/rest/v1/time_off_records?time_in=is.null&entry_type=neq.voided&entry_type=neq.cancel_pending&order=time_out.asc&limit=20';
      var res = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data = await res.json();
      if (data && data.length) {
        var names = data.map(function (r) { return timeoffDisplayName(r); }).join(', ');
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

    // A record pending cancellation is no longer "open" for Time In purposes
    // -- the staff is done acting on it; it just sits waiting for HR.
    var openRecord = myRecords.find(function (r) { return !r.time_in && r.entry_type !== 'cancel_pending'; });
    var monthlyMinutes = myRecords.reduce(function (sum, r) { return sum + timeoffRecordChargedMinutes(r); }, 0);

    timeoffState.today = today;
    timeoffState.myEmailLow = myEmailLow;
    timeoffState.allRecords = allRecords;
    timeoffState.canManageAll = typeof hasEditPermission === 'function' && hasEditPermission('timeoff');
    timeoffState.monthlyTriggers = timeoffComputeMonthlyTriggers(allRecords);

    if (statusEl) statusEl.innerHTML = timeoffApprovalToastHtml(myRecords) + renderTimeOffStatus(openRecord, monthlyMinutes, dueReminders);
    if (mineEl) mineEl.innerHTML = renderTimeOffMineSection();
    if (overviewEl) overviewEl.innerHTML = timeoffState.canManageAll ? renderTimeOffOverview(allRecords) : '';
    if (allEl) allEl.innerHTML = renderTimeOffAllSection();
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Could not load your Time Off status.</div></div>';
    if (mineEl) mineEl.innerHTML = '';
    if (overviewEl) overviewEl.innerHTML = '';
    if (allEl) allEl.innerHTML = '';
  }

  // Event Day Off credits -- a separate table from time_off_records, so a
  // failure here is kept independent of the rest of the tab above. The note
  // (always visible, if there's anything to say) and the cards (only shown
  // under the "Event Day Off" pill) are rendered separately.
  var noteEl = document.getElementById('timeoff-credit-note');
  var edoEl  = document.getElementById('timeoff-edo');
  if (noteEl || edoEl) {
    try {
      var creditRows = await fetch(SURL + '/rest/v1/event_day_off_credits?staff_email=eq.' + encodeURIComponent(me.email) + '&order=created_at.desc&limit=20',
        { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
      timeoffCreditsState.mine = creditRows || [];
      if (noteEl) noteEl.innerHTML = renderTimeOffCreditNote();
      if (edoEl) edoEl.innerHTML = renderTimeOffCredits();
    } catch (e) {
      if (noteEl) noteEl.innerHTML = '';
      if (edoEl) edoEl.innerHTML = '';
    }
  }
}

// ── EVENT DAY OFF CREDITS — admin grants one (no date attached); staff
// redeems it on a date of their own choosing. Exempt from the monthly cap
// above and from Annual Leave by construction: it lives in its own table,
// never time_off_records, so neither is ever touched by this feature. ──
var timeoffCreditsState = { mine: [] };

function renderTimeOffCreditNote() {
  return timeoffCreditsState.mine.length ? '<div class="to-credit-note">🏆 Event Day Off credits don\'t count towards the limit above.</div>' : '';
}

// Never redeemed, and "Must Be Used By" has passed -- redemption is blocked
// from here on, regardless of whether the card above was ever opened.
function timeoffCreditExpired(c) {
  var today = timeoffState.today || localDateStr();
  return !c.redeemed_date && !!c.expires_at && c.expires_at < today;
}

function renderTimeOffCredits() {
  var rows = timeoffCreditsState.mine;
  if (!rows.length) return '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No Event Day Off credits yet.</div>';
  var today = timeoffState.today || localDateStr();
  var html = '';
  rows.forEach(function (c) {
    var redeemed = !!c.redeemed_date;
    var expired = timeoffCreditExpired(c);
    var canEdit = redeemed ? (c.redeemed_date >= today) : !expired;
    html += '<div class="to-reward-card' + (expired ? ' expired' : '') + '">'
      + '<div class="to-reward-top"><div class="to-reward-icon">🏆</div>'
      + '<div><div class="to-reward-title">' + (redeemed ? 'Event Reward — Full Day Off' : 'Event Day Off Credit') + '</div>'
      + '<div class="to-reward-sub">' + escHtml(c.reason) + '</div></div></div>';
    if (redeemed) {
      var when = new Date(c.redeemed_date + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      html += '<div class="to-reward-footer"><span>' + when + ' · Granted by ' + escHtml(c.granted_by || 'HR') + '</span>'
        + '<span class="to-reward-badge">Full Day</span></div>';
    } else if (expired) {
      var wasDue = new Date(c.expires_at + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
      html += '<div class="to-reward-footer"><span>Granted by ' + escHtml(c.granted_by || 'HR') + ' · was due by ' + wasDue + '</span>'
        + '<span class="to-reward-badge expired">Expired</span></div>'
        + '<div class="to-expired-note">This credit expired before it was used and can no longer be redeemed. Contact HR if this looks wrong.</div>';
    } else {
      var expiryNote = c.expires_at ? ('use by ' + new Date(c.expires_at + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })) : 'no expiry';
      html += '<div class="to-reward-footer" style="border-top:none;margin-top:0;padding-top:0;"><span>Granted by ' + escHtml(c.granted_by || 'HR') + ' · ' + expiryNote + '</span></div>';
    }
    if (canEdit) {
      html += '<div id="to-credit-action-' + c.id + '">'
        + (redeemed
          ? '<div class="to-credit-change" onclick="showCreditRedeemForm(' + c.id + ')">Change date</div>'
          : '<button class="to-credit-btn" onclick="showCreditRedeemForm(' + c.id + ')">📅 Pick a Date</button>')
        + '</div>';
    }
    html += '</div>';
  });
  return html;
}

function showCreditRedeemForm(id) {
  var c = timeoffCreditsState.mine.find(function (x) { return x.id === id; });
  var container = document.getElementById('to-credit-action-' + id);
  if (!c || !container) return;
  if (timeoffCreditExpired(c)) return; // defense in depth -- the button isn't rendered once expired
  var today = timeoffState.today || localDateStr();
  // "Must Be Used By" is the latest day OFF allowed, not a deadline to act
  // by -- the day they pick has to fall on or before it, so the date input
  // itself refuses anything past that (and anything already in the past).
  var rangeNote = c.expires_at
    ? ('Pick any date from today up to ' + new Date(c.expires_at + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) + '.')
    : 'Pick any date from today onward.';
  container.innerHTML = '<div class="to-credit-expand">'
    + '<label class="to-credit-label">Which day will you take off?</label>'
    + '<input class="to-credit-input" type="date" id="to-credit-date-' + id + '" min="' + today + '"' + (c.expires_at ? ' max="' + c.expires_at + '"' : '') + ' value="' + (c.redeemed_date && c.redeemed_date >= today ? c.redeemed_date : today) + '">'
    + '<div style="font-size:10.5px;color:var(--text-light);margin:-4px 0 10px;">' + rangeNote + '</div>'
    + '<button class="to-credit-confirm" onclick="confirmCreditRedeem(' + id + ')">Confirm Day Off</button>'
    + '</div>';
}

async function confirmCreditRedeem(id) {
  var c = timeoffCreditsState.mine.find(function (x) { return x.id === id; });
  if (c && timeoffCreditExpired(c)) { alert('This credit has expired and can no longer be redeemed.'); return; }
  var input = document.getElementById('to-credit-date-' + id);
  var date = input ? input.value : '';
  if (!date) { alert('Please choose a date.'); return; }
  var today = timeoffState.today || localDateStr();
  if (date < today) { alert('Please pick today or a future date.'); return; }
  if (c && c.expires_at && date > c.expires_at) {
    alert('This credit must be used by ' + new Date(c.expires_at + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) + '. Please pick a date on or before then.');
    return;
  }
  try {
    var res = await fetch(SURL + '/rest/v1/event_day_off_credits?id=eq.' + id, {
      method: 'PATCH',
      headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ redeemed_date: date, redeemed_at: new Date().toISOString() })
    });
    var updated = await res.json();
    if (!updated || !updated.length) throw new Error('Credit update did not persist');
    loadTimeOff();
  } catch (e) { alert('Could not save your chosen date. Please try again.'); }
}

// Tells the staff member once their own cancellation request was approved --
// shown the next time this tab loads, since there's no live push channel
// for a single-recipient notification like this one (the only existing push
// senders are a broadcast-to-everyone announcement push and a sign-up
// one-off; neither fits). Tracked per-record in localStorage so it only
// shows once per device, then stays gone -- consistent with how
// mjm_push_prompt_dismissed in js/push.js is used for the same purpose.
function timeoffApprovalToastHtml(myRecords) {
  var html = '';
  myRecords.forEach(function (r) {
    if (r.entry_type !== 'voided' || !r.cancel_requested_at) return;
    var ackKey = 'mjm_to_ack_' + r.id;
    var acked = false;
    try { acked = !!localStorage.getItem(ackKey); } catch (e) {}
    if (acked) return;
    var day = new Date(r.time_out).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
    html += '<div class="to-toast">'
      + '<div class="to-toast-icon">✓</div>'
      + '<div><div class="to-toast-title">Cancellation approved</div>'
      + '<div class="to-toast-body">Your "' + escHtml(r.reason) + '" Time Off was cancelled. Please apply Annual Leave to cover ' + day + '.</div></div>'
      + '</div>';
    try { localStorage.setItem(ackKey, '1'); } catch (e) {}
  });
  return html;
}

function renderTimeOffStatus(openRecord, monthlyMinutes, dueReminders) {
  var pct = Math.min(100, Math.round((monthlyMinutes / TIMEOFF_MONTHLY_CAP_MIN) * 100));
  var mCls = monthlyMinutes > TIMEOFF_MONTHLY_CAP_MIN ? 'over' : (monthlyMinutes >= TIMEOFF_NEAR_LIMIT_MIN ? 'warn' : '');
  var meter = '<div class="to-meter-card">'
    + '<div class="to-meter-top"><span class="to-meter-label">This Month</span>'
    + '<span class="to-meter-value ' + mCls + '">' + formatChargedHours(monthlyMinutes) + ' <span style="color:var(--text-light);font-weight:500;">/ 4h</span></span></div>'
    + '<div class="to-meter-track"><div class="to-meter-fill ' + mCls + '" style="width:' + pct + '%;"></div></div>'
    + '</div>';

  var html = meter;

  if (openRecord) {
    var out = new Date(openRecord.time_out);
    var elapsedMin = (Date.now() - out.getTime()) / 60000;
    var elapsedLabel = formatDuration(elapsedMin);
    // Two independent ways a still-open trip can be over cap: its own
    // elapsed time past the 2h/trip limit, or -- even while well under
    // that -- its live charge (already folded into monthlyMinutes, which
    // loadTimeOff() computes including this open record) pushing the
    // month's total past the 4h/month limit. Either blocks Time In the
    // same way; only the explanation differs.
    var tripOverCap = elapsedMin > TIMEOFF_PER_TRIP_CAP_MIN;
    var monthOverCap = monthlyMinutes > TIMEOFF_MONTHLY_CAP_MIN;
    if (tripOverCap || monthOverCap) {
      var statusLine = tripOverCap ? 'YOU\'VE PASSED THE 2H LIMIT' : 'YOU\'VE PASSED THE MONTHLY LIMIT';
      var warnTitle, warnBody;
      if (tripOverCap) {
        warnTitle = 'This trip has gone over the 2-hour Time Off limit.';
        warnBody = 'This needs to be covered by Annual Leave instead of Time Off. Request a cancellation below — once HR approves it, you\'ll be reminded to apply Annual Leave for today.';
      } else {
        warnTitle = 'Timing in now would push this month\'s total over the 4-hour limit.';
        warnBody = 'This trip is still under the 2h/trip limit on its own, but it would bring this month\'s total to ' + formatChargedHours(monthlyMinutes) + '. The same rule as a single over-cap trip applies here — this needs to go through Annual Leave instead. Request a cancellation below — once HR approves it, you\'ll be reminded to apply Annual Leave for today.';
      }
      html += '<div class="to-out-banner over">'
        + '<div class="to-status-line">⚠ ' + statusLine + '</div>'
        + '<div class="to-reason-line">' + escHtml(openRecord.reason) + '</div>'
        + '<div class="to-time-line">Out since ' + formatClock(out) + ' · ' + elapsedLabel + ' so far</div>'
        + '<button class="book-btn-primary" style="margin-bottom:0;" disabled>✓ I\'m Back — Time In</button>'
        + '</div>'
        + '<div class="to-warn red">'
        + '<b>⚠ ' + warnTitle + '</b>' + warnBody
        + '<button style="width:100%;margin-top:10px;background:var(--red-text);color:#fff;border:none;border-radius:var(--radius-sm);padding:9px;font-size:11.5px;font-weight:700;" onclick="requestCancelTimeOff(' + openRecord.id + ')">↩ Request Cancellation</button>'
        + '</div>';
    } else {
      var charged = chargedMinutes(elapsedMin);
      html += '<div class="to-out-banner">'
        + '<div class="to-status-line"><span class="to-pulse-dot"></span>YOU\'RE CURRENTLY OUT</div>'
        + '<div class="to-reason-line">' + escHtml(openRecord.reason) + '</div>'
        + '<div class="to-time-line">Out since ' + formatClock(out) + ' · ' + elapsedLabel + ' so far</div>'
        + '<div class="to-charge-pill">⏱ ' + formatChargedHours(charged) + ' will be charged if you Time In now</div>'
        + '<button class="book-btn-primary" style="background:var(--green-dark);margin-bottom:0;" onclick="timeInNow(' + openRecord.id + ')">✓ I\'m Back — Time In</button>'
        + '</div>';
    }
  } else {
    html += '<div class="card">'
      + '<div class="book-form-group"><label class="book-form-label">Reason</label>'
      + '<input class="book-form-input" id="timeoff-reason" placeholder="e.g. Bank errand, clinic appointment..."></div>'
      + '<div id="timeoff-now-row">'
      + '<button class="book-btn-primary" onclick="timeOutNow()">🚶 Time Out Now</button>'
      + '<div class="to-time-toggle" onclick="showTimeOffCustomTime()">⏱ Or key in a time instead</div>'
      + '</div>'
      + '<div id="timeoff-custom-row" style="display:none;">'
      + '<div class="book-form-group"><label class="book-form-label">Time Out At</label>'
      + '<input class="book-form-input" type="time" id="timeoff-custom-time"></div>'
      + '<button class="book-btn-primary" onclick="timeOutAtCustomTime()">🚶 Confirm Time Out</button>'
      + '<div class="to-time-toggle" onclick="hideTimeOffCustomTime()">↺ Use current time instead</div>'
      + '</div>'
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

// email -> current full_name, refreshed by loadTimeOff() on every load.
// Falls back to the record's own stored staff_name when an email has no
// match (profile deleted, or staff_email missing on an old record).
var timeoffNameMap = {};
function timeoffDisplayName(r) {
  var email = (r.staff_email || '').toLowerCase();
  return (email && timeoffNameMap[email]) || r.staff_name;
}

// Per-staff monthly totals, shown only to whoever can manage all Time Off
// records (HR Admin/Super Admin or a staff member granted the "Time Off"
// edit permission) -- mirrors the Staff Overview list in admin.html.
function renderTimeOffOverview(records) {
  var avColors = ['av-green', 'av-amber', 'av-coral', 'av-blue', 'av-purple', 'av-red'];
  var byStaff = {};
  records.forEach(function (r) {
    // Grouped by email (falling back to name only if email is ever
    // missing), so a staff member who renamed themselves mid-month still
    // shows as one row, not two.
    var key = (r.staff_email || '').toLowerCase() || r.staff_name;
    if (!byStaff[key]) byStaff[key] = { name: timeoffDisplayName(r), minutes: 0, count: 0 };
    byStaff[key].count++;
    byStaff[key].minutes += timeoffRecordChargedMinutes(r);
  });
  var staffList = Object.keys(byStaff).map(function (key) { return { name: byStaff[key].name, minutes: byStaff[key].minutes, count: byStaff[key].count }; });
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
      + '<div style="text-align:right;"><div style="font-weight:700;font-size:12.5px;color:var(--text-primary);">' + formatChargedHours(s.minutes) + '</div>'
      + '<span class="badge ' + status.cls + '">' + status.label + '</span></div>'
      + '</div>';
  }).join('');
  html += '</div>';
  return html;
}

// ── My Records / All Records — a pill toggle (same pattern as Book's
// Vehicle/Room) switches which one is visible; both are rendered in full on
// every load, same as Book's two panels, so switching is instant. ──
var timeoffState = {
  today: '', myEmailLow: '', allRecords: [], canManageAll: false,
  mineCancelledOpen: false, allCancelledOpen: false, monthlyTriggers: {}
};

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
  var isPending = r.entry_type === 'cancel_pending';
  var stillOpen = !r.time_in;
  var timeLabel = formatClock(out) + (r.time_in ? ' → ' + formatClock(new Date(r.time_in)) : ' → still out');
  var actualMin = r.time_in ? r.duration_minutes : (Date.now() - out.getTime()) / 60000;
  var charged = chargedMinutes(actualMin);
  var overCap = actualMin > TIMEOFF_PER_TRIP_CAP_MIN;
  // Even a trip well under the 2h/trip cap can be the one that tipped this
  // month's total past 4h -- timeoffComputeMonthlyTriggers() flags exactly
  // one record per staff member per month for that (the one that crosses
  // the line), computed once in loadTimeOff().
  var monthlyTrigger = !!(timeoffState.monthlyTriggers && timeoffState.monthlyTriggers[r.id]);
  var flagged = overCap || monthlyTrigger;
  var badge = isPending
    ? '<span class="badge badge-amber">Pending Cancellation</span>'
    : (flagged
      ? '<span class="badge badge-urgent">' + formatChargedHours(charged) + ' charged</span>'
      : '<span class="badge badge-blue">' + formatChargedHours(charged) + ' charged</span>');
  var entryNote = r.entry_type === 'edited' ? ' <span style="color:var(--amber-text);font-weight:700;">(edited)</span>'
    : r.entry_type === 'backfilled' ? ' <span style="color:var(--red-text);font-weight:700;">(backfilled)</span>' : '';
  var reasonLabel = isMine ? escHtml(r.reason) : (escHtml(timeoffDisplayName(r)) + ' — ' + escHtml(r.reason));
  if (isPending) reasonLabel = '<span style="text-decoration:line-through;">' + reasonLabel + '</span>';
  var key = sectionKey + '-' + r.id;

  // Correcting Time In/Out is admin/permission-only -- unlike the Cancel
  // button below, ownership alone must NOT unlock it, or every staff member
  // could quietly rewrite their own already-taken Time Off. Not offered on
  // a pending-cancellation row -- it's about to be voided, not corrected.
  var canCorrect = canManageAll && !!r.time_in && !isPending;
  var editIcon = canCorrect
    ? '<div class="to-edit-icon" onclick="toggleTimeOffCorrection(\'' + key + '\', ' + r.id + ')" title="Correct Time In"><i class="ti ti-pencil"></i></div>'
    : '';

  var html = '<div class="to-history-row" data-timeoff-id="' + escHtml(r.id) + '" data-staff-email="' + escHtml(r.staff_email || '') + '">'
    + '<div class="to-history-top">'
    + '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:6px;">'
    + '<div class="to-history-reason">' + reasonLabel + '</div>' + editIcon
    + '</div>' + badge + '</div>'
    + '<div class="to-history-time">' + timeLabel + (r.time_in ? ' · ' + formatDuration(r.duration_minutes || 0) + ' actual' : '') + entryNote + '</div>';

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

  if (isPending) {
    html += '<div class="to-warn amber">'
      + (canManageAll
        ? '<b>⏳ Staff requested cancellation.</b>Approve to move this trip to Annual Leave and let them know.'
          + '<button style="width:100%;margin-top:10px;background:var(--green-dark);color:#fff;border:none;border-radius:var(--radius-sm);padding:9px;font-size:11.5px;font-weight:700;" onclick="approveCancelTimeOff(' + r.id + ')">✓ Approve Cancellation</button>'
        : '<b>⏳ Waiting on HR approval.</b>Once approved, you\'ll be reminded to apply Annual Leave to cover this day.')
      + '</div>';
  } else if (canManage && flagged && !stillOpen) {
    // A still-open flagged record already offers Request Cancellation from
    // the Currently Out banner -- no need to repeat the same box here too.
    var flagTitle, flagBody;
    if (overCap) {
      flagTitle = 'This trip ran ' + formatChargedHours(charged) + ' — over the 2h single-trip limit.';
      flagBody = 'This needs to go through Annual Leave instead of Time Off.';
    } else {
      flagTitle = 'This trip pushed the monthly total over the 4h limit.';
      flagBody = 'It\'s only ' + formatChargedHours(charged) + ' on its own — under the 2h/trip limit — but it\'s the one that tipped the month over 4h. The same rule as a single over-cap trip applies here.';
    }
    html += '<div class="to-warn red">'
      + '<b>⚠ ' + flagTitle + '</b>' + flagBody
      + '<button style="width:100%;margin-top:10px;background:var(--red-text);color:#fff;border:none;border-radius:var(--radius-sm);padding:9px;font-size:11.5px;font-weight:700;" onclick="requestCancelTimeOff(' + r.id + ')">↩ Request Cancellation</button>'
      + '</div>';
  }
  html += '</div>';
  return html;
}

function renderTimeOffVoidedRow(r, myEmailLow) {
  var isMine = r.staff_email && r.staff_email.toLowerCase() === myEmailLow;
  var reasonLabel = isMine ? escHtml(r.reason) : (escHtml(timeoffDisplayName(r)) + ' — ' + escHtml(r.reason));
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
  var totalMinutes = nonVoided.reduce(function (sum, r) { return sum + timeoffRecordChargedMinutes(r); }, 0);
  var summary = mine.length ? (mine.length + (mine.length === 1 ? ' entry' : ' entries') + ' this month · ' + formatChargedHours(totalMinutes)) : 'No entries this month';
  var html = '<div class="to-meta">' + escHtml(summary) + '</div>';
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
  return html;
}

function renderTimeOffAllSection() {
  var myEmailLow = timeoffState.myEmailLow;
  var today = timeoffState.today;
  var canManageAll = timeoffState.canManageAll;
  var all = timeoffState.allRecords;
  var nonVoided = all.filter(function (r) { return r.entry_type !== 'voided'; });
  var voided = all.filter(function (r) { return r.entry_type === 'voided'; });
  // Keyed by email -- a distinct-staff count, so a mid-month rename never
  // inflates it the way grouping by staff_name would.
  var staffSet = {}; all.forEach(function (r) { staffSet[(r.staff_email || '').toLowerCase() || r.staff_name] = 1; });
  var staffTotal = Object.keys(staffSet).length;
  var summary = all.length ? (all.length + (all.length === 1 ? ' entry' : ' entries') + ' this month · ' + staffTotal + (staffTotal === 1 ? ' staff' : ' staff')) : 'No entries this month';
  var html = '<div class="to-meta">' + escHtml(summary) + '</div>';
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
  return html;
}

function rerenderTimeOffSections() {
  var mineEl = document.getElementById('timeoff-mine');
  var allEl = document.getElementById('timeoff-all');
  if (mineEl) mineEl.innerHTML = renderTimeOffMineSection();
  if (allEl) allEl.innerHTML = renderTimeOffAllSection();
}
// Mirrors switchBookPill in js/tab-book.js -- both panels are already
// rendered in full, so switching is just a display + pill-style toggle.
function switchTimeOffPill(which) {
  document.getElementById('timeoff-mine').style.display = which === 'mine' ? 'block' : 'none';
  document.getElementById('timeoff-all').style.display  = which === 'all'  ? 'block' : 'none';
  document.getElementById('timeoff-edo').style.display  = which === 'edo'  ? 'block' : 'none';
  [['mine', 'timeoff-pill-mine'], ['all', 'timeoff-pill-all'], ['edo', 'timeoff-pill-edo']].forEach(function (pair) {
    var el = document.getElementById(pair[1]);
    var active = which === pair[0];
    el.style.background = active ? 'var(--green-dark)' : 'transparent';
    el.style.color       = active ? '#fff' : 'var(--text-secondary)';
  });
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
  await startTimeOff(new Date());
}

// Lets someone who stepped out a few minutes before opening the app log the
// actual time they left, instead of the time they happen to tap the button.
// Only accepts a time up to now (plus a small grace window for clock skew) --
// this is a correction for "just now", not a future Plan Ahead reminder.
function showTimeOffCustomTime() {
  var now = new Date();
  var timeInput = document.getElementById('timeoff-custom-time');
  if (timeInput) timeInput.value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  var nowRow = document.getElementById('timeoff-now-row');
  var customRow = document.getElementById('timeoff-custom-row');
  if (nowRow) nowRow.style.display = 'none';
  if (customRow) customRow.style.display = 'block';
}

function hideTimeOffCustomTime() {
  var nowRow = document.getElementById('timeoff-now-row');
  var customRow = document.getElementById('timeoff-custom-row');
  if (nowRow) nowRow.style.display = 'block';
  if (customRow) customRow.style.display = 'none';
}

async function timeOutAtCustomTime() {
  var timeInput = document.getElementById('timeoff-custom-time');
  var val = timeInput ? timeInput.value : '';
  if (!val) { alert('Please choose a time.'); return; }
  var parts = val.split(':');
  var d = new Date();
  d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
  if (d.getTime() > Date.now() + 60000) { alert('Time Out can\'t be in the future.'); return; }
  await startTimeOff(d);
}

async function startTimeOff(timeOutDate) {
  var me = timeOffMe();
  var reasonEl = document.getElementById('timeoff-reason');
  var reason = reasonEl ? reasonEl.value.trim() : '';
  if (!reason) { alert('Please describe the reason for this Time Off.'); return; }
  try {
    var existing = await fetch(SURL + '/rest/v1/time_off_records?staff_email=eq.' + encodeURIComponent(me.email) + '&time_in=is.null&entry_type=neq.cancel_pending&limit=1',
      { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    if (existing && existing.length) { alert('You already have an open Time Off. Time In on that one first.'); return; }

    var monthStart = localDateStr().slice(0, 8) + '01';
    var monthlyMinutes = await timeOffMonthlyMinutes(me.email, monthStart);
    if (monthlyMinutes >= TIMEOFF_MONTHLY_CAP_MIN) {
      alert('Monthly limit reached\n\nYou\'ve used your full 4h Time Off allowance this month. Please go through Annual Leave instead of Time Off.');
      return;
    }
    if (monthlyMinutes >= TIMEOFF_NEAR_LIMIT_MIN) {
      var remaining = formatChargedHours(TIMEOFF_MONTHLY_CAP_MIN - monthlyMinutes);
      if (!confirm('Low Time Off balance\n\nYou have ' + remaining + ' left this month. If this trip runs longer, it\'ll be flagged for HR to review.\n\nContinue?')) return;
    }

    await sbWrite('POST', 'time_off_records', {
      staff_name: me.name || me.email, staff_email: me.email,
      reason: reason, time_out: timeOutDate.toISOString()
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
    // Defense in depth -- the button driving this is normally swapped out
    // for Request Cancellation once a render shows the trip is over either
    // cap (see renderTimeOffStatus), but re-check here too in case this
    // fires against a stale render (e.g. a cap was crossed the instant
    // this was tapped). timeOffMonthlyMinutes() already excludes this
    // still-open record (its duration_minutes is still null), so adding
    // this trip's own charge to it gives the true total Timing In now
    // would produce.
    var monthStart = localDateStr().slice(0, 8) + '01';
    var monthlyBefore = await timeOffMonthlyMinutes(record.staff_email, monthStart);
    if (duration > TIMEOFF_PER_TRIP_CAP_MIN) {
      alert('This trip has run ' + formatDuration(duration) + ' — over the 2-hour Time Off limit.\n\nPlease apply Annual Leave for today instead. Use "Request Cancellation" to let HR cancel this Time Off record.');
      loadTimeOff();
      return;
    }
    if (monthlyBefore + chargedMinutes(duration) > TIMEOFF_MONTHLY_CAP_MIN) {
      alert('Timing in now would push this month\'s total over the 4-hour limit.\n\nPlease apply Annual Leave for today instead. Use "Request Cancellation" to let HR cancel this Time Off record.');
      loadTimeOff();
      return;
    }
    await sbWrite('PATCH', 'time_off_records', { time_in: timeIn.toISOString(), duration_minutes: duration }, 'id=eq.' + id);
    loadTimeOff();
    record.time_in = timeIn.toISOString(); record.duration_minutes = duration;
    timeOffMonthlyMinutes(record.staff_email, monthStart).then(function (mins) { syncTimeOffToSheet('create', record, mins); });
  } catch (e) { alert('Could not record Time In. Please try again.'); }
}

// Staff-initiated -- requests cancellation of an over-cap trip instead of
// immediately self-voiding it (the old voidTimeOff behavior). Leaves
// time_in/duration_minutes untouched either way (still null if the trip was
// still open) -- approveCancelTimeOff below is what finally closes it out.
async function requestCancelTimeOff(id) {
  if (!canManageTimeOff(id)) { alert('You can only request cancellation for your own Time Off records.'); return; }
  if (!confirm('Request to cancel this trip?\n\nHR will review and approve it. Once approved, you\'ll need to apply Annual Leave separately to cover this day.')) return;
  try {
    await sbWrite('PATCH', 'time_off_records', { entry_type: 'cancel_pending', cancel_requested_at: new Date().toISOString() }, 'id=eq.' + id);
    loadTimeOff();
  } catch (e) { alert('Could not request cancellation. Please try again.'); }
}

// HR Admin/permission-only -- approves a pending cancellation request,
// finally moving the trip to Voided. If it was still open (never timed
// back in), this is also what closes it out, timestamped to the moment of
// approval -- matches cancel_requested_at being left alone by
// requestCancelTimeOff above.
async function approveCancelTimeOff(id) {
  if (!canCorrectTimeOff()) { alert('You do not have permission to approve this.'); return; }
  if (!confirm('Approve this cancellation? The trip will be marked Voided and moved to Annual Leave. The staff member will be shown a reminder to apply Annual Leave for this day.')) return;
  try {
    var rows = await fetch(SURL + '/rest/v1/time_off_records?id=eq.' + id, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    var record = rows && rows[0];
    if (!record) return;
    var patch = { entry_type: 'voided' };
    if (!record.time_in) {
      var timeIn = new Date();
      patch.time_in = timeIn.toISOString();
      patch.duration_minutes = Math.round((timeIn.getTime() - new Date(record.time_out).getTime()) / 60000);
    }
    await sbWrite('PATCH', 'time_off_records', patch, 'id=eq.' + id);
    loadTimeOff();
    Object.assign(record, patch);
    var monthStart = localDateStr().slice(0, 8) + '01';
    timeOffMonthlyMinutes(record.staff_email, monthStart).then(function (mins) { syncTimeOffToSheet('update', record, mins); });
  } catch (e) { alert('Could not approve this cancellation. Please try again.'); }
}

// ── PLAN AHEAD reminders (time_off_reminders) ──
// Creating new ones was removed in favor of keying in a time directly on
// the main Time Out card (see showTimeOffCustomTime/timeOutAtCustomTime
// above); convertReminder/cancelReminder stay so any reminder already on
// file from before still has a way to be acted on.

async function convertReminder(id) {
  var me = timeOffMe();
  try {
    var existing = await fetch(SURL + '/rest/v1/time_off_records?staff_email=eq.' + encodeURIComponent(me.email) + '&time_in=is.null&entry_type=neq.cancel_pending&limit=1',
      { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } }).then(function (r) { return r.json(); });
    if (existing && existing.length) { alert('You already have an open Time Off. Time In on that one first.'); return; }

    var monthStart = localDateStr().slice(0, 8) + '01';
    var monthlyMinutes = await timeOffMonthlyMinutes(me.email, monthStart);
    if (monthlyMinutes >= TIMEOFF_MONTHLY_CAP_MIN) {
      alert('Monthly limit reached\n\nYou\'ve used your full 4h Time Off allowance this month. Please go through Annual Leave instead of Time Off.');
      return;
    }
    if (monthlyMinutes >= TIMEOFF_NEAR_LIMIT_MIN) {
      var remaining = formatChargedHours(TIMEOFF_MONTHLY_CAP_MIN - monthlyMinutes);
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
