// ── booking-extras.js — change a booking + repeating room bookings ──
//
// Shared by the staff app (index.html + js/tab-book.js) and the admin page
// (admin.html's own Booking copy) -- both use the same element ids and the
// same helper names (rSelectedRoom, vSelectedVehicle, isMyBooking,
// bookDisplayName, fmtDate, fmtTime, to24h, loadRoomCalendar, ...), the same
// way js/faulty-progress.js and js/work-outings.js are shared.
//
// 1. "✎ Change date / time" on your own bookings (vehicle + room): edit the
//    date, times and purpose in place, with the same clash check as a new
//    booking. The booking keeps its id, so the old slot stays yours until
//    Save -- nobody can grab it in between, unlike cancel + rebook.
// 2. "Repeat: Once | Weekly | Monthly" on the room booking form. Every date
//    is saved as its own normal booking, linked by series_id (see
//    docs/booking-change-repeat.sql). Dates already taken are shown and
//    skipped, never double-booked. Change / Cancel on one of them asks
//    "just this one" or "this one and every one after".

var BK_PURPLE = '#534AB7', BK_PURPLE_BG = '#EEEDFE';
var bkCache = {};       // 'room:<id>' / 'vehicle:<id>' -> booking row as rendered
var bkRep = { mode: 'once', wkend: 'next', preview: null };
var BK_REPEAT_MAX_MONTHS = 60; // 5 years -- weekly for 5 years is ~260 bookings
var BK_REPEAT_MAX_DATES = 270;

function bkInjectStyles() {
  if (document.getElementById('bk-styles')) return;
  var css = ''
    + '.bk-acts{display:flex;gap:18px;margin-top:8px;padding-top:8px;border-top:.5px solid var(--border,#E2ECE8)}'
    + '.bk-act{background:none;border:none;padding:0;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;color:#0F6E5C}'
    + '.bk-act.red{color:#A32D2D}'
    + '.bk-info{font-size:10.5px;color:#70827D;margin-top:3px}'
    + '.bk-tag{display:inline-block;font-size:10px;font-weight:700;padding:1px 8px;border-radius:10px;background:' + BK_PURPLE_BG + ';color:' + BK_PURPLE + ';margin-right:6px}'
    + '.bk-form{background:#E1F5EE;border:1px solid #BFE3D5;border-radius:14px;padding:12px;margin-top:10px}'
    + '.bk-lbl{font-size:10px;font-weight:700;color:#70827D;letter-spacing:.04em;text-transform:uppercase;margin:0 0 4px}'
    + '.bk-in{width:100%;box-sizing:border-box;background:#fff;border:1px solid #D5E7DF;border-radius:10px;padding:9px 10px;font-size:12.5px;font-family:inherit;color:#111C18;margin-bottom:9px}'
    + '.bk-two{display:flex;gap:8px}.bk-two>div{flex:1;min-width:0}'
    + '.bk-seg{display:flex;background:#fff;border:1px solid #D5E7DF;border-radius:10px;padding:3px;gap:3px;margin-bottom:9px}'
    + '.bk-seg button{flex:1;border:none;background:transparent;font-family:inherit;font-size:11px;font-weight:700;padding:7px 4px;border-radius:7px;color:#70827D;cursor:pointer}'
    + '.bk-seg button.on{background:#0F6E5C;color:#fff}'
    + '.bk-ok{background:#fff;border:1px solid #BFE3D5;color:#085041;font-size:11px;font-weight:600;border-radius:10px;padding:8px 10px;margin-bottom:9px}'
    + '.bk-bad{background:#FCEBEB;border:1px solid #F0C4C4;color:#A32D2D;font-size:11px;font-weight:600;border-radius:10px;padding:8px 10px;margin-bottom:9px;line-height:1.4}'
    + '.bk-btn{width:100%;border:none;border-radius:11px;padding:10px;font-size:12.5px;font-weight:700;font-family:inherit;color:#fff;background:#0F6E5C;margin-bottom:7px;cursor:pointer}'
    + '.bk-btn:disabled{background:#B9C9C2;cursor:default}'
    + '.bk-btn.red{background:#A32D2D}'
    + '.bk-btn.ghost{background:transparent;color:#0F6E5C;border:1.5px solid #0F6E5C}'
    + '.bk-hint{font-size:11px;color:#085041;margin:-3px 0 9px;line-height:1.45}'
    + '.bk-opt{display:block;width:100%;text-align:left;border:1.5px solid #D5E7DF;background:#fff;border-radius:12px;padding:9px 11px;margin-bottom:8px;font-family:inherit;font-size:12px;font-weight:600;color:#111C18;cursor:pointer}'
    + '.bk-opt.on{border-color:#0F6E5C;background:#F3FBF8}'
    + '.bk-opt small{display:block;font-weight:500;color:#70827D;font-size:10.5px;margin-top:2px}'
    + '.bk-dates{background:#fff;border:1px solid #D5E7DF;border-radius:10px;padding:2px 10px;margin-bottom:9px;max-height:280px;overflow-y:auto}'
    + '.bk-dt{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11.5px;padding:7px 0;color:#111C18}'
    + '.bk-dt+.bk-dt{border-top:1px solid #EEF2F0}'
    + '.bk-s{font-size:10px;font-weight:700;padding:1px 8px;border-radius:9px;white-space:nowrap;text-align:right}'
    + '.bk-mgrid{background:#fff;border:1px solid #D5E7DF;border-radius:12px;padding:8px;margin-bottom:9px}'
    + '.bk-mgh{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;font-weight:800;color:#0E3B33;padding:2px 4px 8px}'
    + '.bk-mgh button{border:none;background:none;font-size:16px;font-weight:700;color:#0F6E5C;cursor:pointer;padding:2px 10px;font-family:inherit}'
    + '.bk-mgh button:disabled{color:#D5DEDA;cursor:default}'
    + '.bk-mg{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}'
    + '.bk-mg button{border:none;font-family:inherit;font-size:11.5px;font-weight:700;padding:9px 0;border-radius:9px;background:#fff;color:#111C18;cursor:pointer}'
    + '.bk-mg button.in{background:#E1F5EE;color:#085041}'
    + '.bk-mg button.end{background:#0F6E5C;color:#fff}'
    + '.bk-mg button:disabled{color:#C5D1CC;background:#fff;cursor:default}'
    + '.bk-mg button.in:disabled{background:#E1F5EE;color:#085041}'
    + '.bk-sum{background:#fff;border:1px solid #BFE3D5;border-radius:10px;padding:8px 10px;font-size:11px;color:#085041;margin-bottom:9px}'
    + '.bk-s.free{background:#E1F5EE;color:#085041}.bk-s.moved{background:#E6F1FB;color:#185FA5}.bk-s.taken{background:#FCEBEB;color:#A32D2D}';
  var el = document.createElement('style');
  el.id = 'bk-styles';
  el.textContent = css;
  document.head.appendChild(el);
}

// ── helpers ──
function bkTable(type) { return type === 'vehicle' ? 'vehicle_bookings' : 'room_bookings'; }
function bkKey(type, id) { return type + '-' + String(id).replace(/[^A-Za-z0-9_-]/g, ''); }
function bkMe() { try { return JSON.parse(localStorage.getItem('mjm_user') || '{}') || {}; } catch (e) { return {}; } }
function bkD(ds) { return new Date(ds + 'T00:00:00'); }
function bkYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function bkShort(ds) { return bkD(ds).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }); }
function bkLong(ds) { return bkD(ds).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
function bkWeekday(i) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]; }
function bkOrdinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function bkHHMM(t) { return t ? String(t).slice(0, 5) : ''; }
// Overlap on HH:MM, so a booking ending 10:30 and one starting 10:30 don't clash.
function bkOverlap(from, to, o) { return from < bkHHMM(o.time_to) && to > bkHHMM(o.time_from); }

async function bkReq(method, path, body, extra) {
  var headers = { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY };
  if (body) { headers['Content-Type'] = 'application/json'; headers['Prefer'] = 'return=representation'; }
  if (extra) Object.assign(headers, extra);
  var res = await fetch(SURL + '/rest/v1/' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  var data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    var err = new Error('booking request failed: ' + res.status);
    err.status = res.status; err.code = data && data.code; err.detail = data && (data.message || '');
    throw err;
  }
  return data;
}
// "column ... does not exist" -- docs/booking-change-repeat.sql not run yet.
function bkMissingColumn(e) { return e && (e.code === 'PGRST204' || e.code === '42703' || /column/i.test(e.detail || '')); }

function bkRuleLabel(rule) {
  if (!rule) return '';
  var p = String(rule).split('-');
  if (p[0] === 'weekly') return '🔁 Weekly · every ' + bkWeekday(Number(p[1]));
  if (p[0] === 'monthly') return '🔁 Monthly · on the ' + bkOrdinal(Number(p[1]));
  return '🔁 Repeats';
}

function bkRefresh(type) {
  if (type === 'vehicle') {
    if (typeof loadVehicleCalendar === 'function') loadVehicleCalendar();
    if (typeof loadMyVehicleBookings === 'function') loadMyVehicleBookings();
    if (typeof vDetailDate !== 'undefined' && vDetailDate && typeof showDayDetail === 'function') showDayDetail('vehicle', vDetailDate, true);
  } else {
    if (typeof loadRoomCalendar === 'function') loadRoomCalendar();
    if (typeof loadMyRoomBookings === 'function') loadMyRoomBookings();
    if (typeof rDetailDate !== 'undefined' && rDetailDate && typeof showDayDetail === 'function') showDayDetail('room', rDetailDate, true);
  }
}

// ── 1. Footer on your own booking cards: series / changed info + actions ──
function bkItemFooter(type, b) {
  bkInjectStyles();
  bkCache[type + ':' + b.id] = b;
  var info = '';
  if (b.series_id && b.repeat_rule) info += '<div class="bk-info"><span class="bk-tag">' + escHtml(bkRuleLabel(b.repeat_rule)) + '</span></div>';
  if (b.changed_from && b.changed_from !== b.booking_date) info += '<div class="bk-info">✎ Changed from ' + escHtml(bkShort(b.changed_from)) + '</div>';
  var idArg = '\'' + type + '\',\'' + escHtml(String(b.id)).replace(/'/g, '&#39;') + '\'';
  return info
    + '<div class="bk-acts">'
    + '<button class="bk-act" onclick="bkOpenChange(' + idArg + ')">✎ Change date / time</button>'
    + '<button class="bk-act red" onclick="bkCancel(' + idArg + ')">✕ Cancel</button>'
    + '</div>'
    + '<div id="bk-panel-' + bkKey(type, b.id) + '"></div>';
}

function bkPanel(type, id) { return document.getElementById('bk-panel-' + bkKey(type, id)); }
function bkClosePanel(type, id) { var p = bkPanel(type, id); if (p) p.innerHTML = ''; }

// ── Change ──
function bkOpenChange(type, id) {
  var b = bkCache[type + ':' + id];
  var panel = bkPanel(type, id);
  if (!b || !panel) return;
  if (panel.getAttribute('data-open') === 'change' && panel.innerHTML) { panel.innerHTML = ''; panel.removeAttribute('data-open'); return; }
  panel.setAttribute('data-open', 'change');
  var k = bkKey(type, id);
  var today = localDateStr();
  var html = '<div class="bk-form" data-type="' + type + '" data-id="' + escHtml(String(id)) + '">';
  if (type === 'room' && b.series_id) {
    html += '<div class="bk-lbl">Change</div><div class="bk-seg" id="bk-scope-' + k + '">'
      + '<button class="on" data-v="one" onclick="bkSetScope(\'' + k + '\',this)">Just ' + escHtml(bkShort(b.booking_date)) + '</button>'
      + '<button data-v="after" onclick="bkSetScope(\'' + k + '\',this)">This &amp; every one after</button></div>';
  }
  html += '<div id="bk-datewrap-' + k + '"><div class="bk-lbl">Date</div>'
    + '<input class="bk-in" type="date" id="bk-date-' + k + '" min="' + today + '" value="' + escHtml(b.booking_date) + '" oninput="bkCheckChange(\'' + type + '\',\'' + escHtml(String(id)) + '\')"></div>';
  if (type === 'vehicle') {
    var full = !!b.is_full_day;
    html += '<div class="bk-seg" id="bk-full-' + k + '">'
      + '<button class="' + (full ? 'on' : '') + '" data-v="full" onclick="bkSetFull(\'' + type + '\',\'' + escHtml(String(id)) + '\',true)">Full day</button>'
      + '<button class="' + (full ? '' : 'on') + '" data-v="times" onclick="bkSetFull(\'' + type + '\',\'' + escHtml(String(id)) + '\',false)">Set times</button></div>';
  }
  var hideTimes = type === 'vehicle' && b.is_full_day;
  html += '<div class="bk-two" id="bk-times-' + k + '" style="' + (hideTimes ? 'display:none;' : '') + '">'
    + '<div><div class="bk-lbl">From</div><input class="bk-in" type="time" id="bk-from-' + k + '" value="' + bkHHMM(b.time_from) + '" oninput="bkCheckChange(\'' + type + '\',\'' + escHtml(String(id)) + '\')"></div>'
    + '<div><div class="bk-lbl">To</div><input class="bk-in" type="time" id="bk-to-' + k + '" value="' + bkHHMM(b.time_to) + '" oninput="bkCheckChange(\'' + type + '\',\'' + escHtml(String(id)) + '\')"></div></div>'
    + '<div class="bk-lbl">Purpose</div><input class="bk-in" type="text" id="bk-purpose-' + k + '" maxlength="200" value="' + escHtml(b.purpose || '') + '">'
    + '<div id="bk-msg-' + k + '"></div>'
    + '<button class="bk-btn" id="bk-save-' + k + '" onclick="bkSaveChange(\'' + type + '\',\'' + escHtml(String(id)) + '\')">Save changes</button>'
    + '<button class="bk-btn ghost" onclick="bkClosePanel(\'' + type + '\',\'' + escHtml(String(id)) + '\')">Keep as it is</button>'
    + '</div>';
  panel.innerHTML = html;
  bkCheckChange(type, id);
}

function bkSetScope(k, btn) {
  var seg = document.getElementById('bk-scope-' + k);
  seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === btn); });
  // "Every one after" changes times / purpose only -- each keeps its own date.
  document.getElementById('bk-datewrap-' + k).style.display = btn.getAttribute('data-v') === 'after' ? 'none' : '';
  var form = seg.closest('.bk-form');
  bkCheckChange(form.getAttribute('data-type'), form.getAttribute('data-id'));
}

function bkSetFull(type, id, full) {
  var k = bkKey(type, id);
  document.querySelectorAll('#bk-full-' + k + ' button').forEach(function (x) { x.classList.toggle('on', (x.getAttribute('data-v') === 'full') === full); });
  document.getElementById('bk-times-' + k).style.display = full ? 'none' : '';
  bkCheckChange(type, id);
}

// Reads the change form. Returns { err } or the new values.
function bkReadChange(type, id) {
  var b = bkCache[type + ':' + id];
  var k = bkKey(type, id);
  var scopeBtn = document.querySelector('#bk-scope-' + k + ' button.on');
  var scope = scopeBtn ? scopeBtn.getAttribute('data-v') : 'one';
  var full = type === 'vehicle' && !!document.querySelector('#bk-full-' + k + ' button.on[data-v="full"]');
  var date = scope === 'after' ? b.booking_date : (document.getElementById('bk-date-' + k) || {}).value;
  var from = (document.getElementById('bk-from-' + k) || {}).value;
  var to = (document.getElementById('bk-to-' + k) || {}).value;
  var purpose = ((document.getElementById('bk-purpose-' + k) || {}).value || '').trim();
  if (!date) return { err: 'Please pick a date.' };
  if (scope !== 'after' && date < localDateStr()) return { err: 'Please pick today or a later date.' };
  if (!full) {
    if (!from || !to) return { err: 'Please set both From and To.' };
    if (from >= to) return { err: '"To" has to be after "From".' };
  }
  return { b: b, scope: scope, full: full, date: date, from: full ? null : from, to: full ? null : to, purpose: purpose };
}

// Every booking this change touches: just this one, or this and every later
// one in its series.
async function bkTargets(type, v) {
  if (v.scope !== 'after') return [{ id: v.b.id, booking_date: v.date }];
  var rows = await bkReq('GET', 'room_bookings?series_id=eq.' + encodeURIComponent(v.b.series_id) + '&booking_date=gte.' + v.b.booking_date + '&order=booking_date.asc&limit=1000');
  return (rows || []).map(function (r) { return { id: r.id, booking_date: r.booking_date }; });
}

// First clash for the new values, or null. Bookings being changed never
// clash with themselves.
async function bkFindClash(type, v, targets) {
  var ownIds = {};
  targets.forEach(function (t) { ownIds[String(t.id)] = 1; });
  var dates = targets.map(function (t) { return t.booking_date; });
  var item = type === 'vehicle' ? 'vehicle_name=eq.' + encodeURIComponent(v.b.vehicle_name) : 'room_name=eq.' + encodeURIComponent(v.b.room_name);
  var rows = await bkReq('GET', bkTable(type) + '?' + item + '&booking_date=in.(' + dates.join(',') + ')&limit=1000');
  var from = v.from ? bkHHMM(to24h(v.from)) : null, to = v.to ? bkHHMM(to24h(v.to)) : null;
  return (rows || []).find(function (o) {
    if (ownIds[String(o.id)]) return false;
    if (type === 'vehicle' && (v.full || o.is_full_day)) return true;
    return bkOverlap(from, to, o);
  }) || null;
}

function bkClashText(type, c) {
  var when = type === 'vehicle' && c.is_full_day ? 'full day' : fmtTime(c.time_from) + ' – ' + fmtTime(c.time_to);
  return 'Already booked by ' + bookDisplayName(c) + ' on ' + bkShort(c.booking_date) + ' (' + when + '). Pick another time.';
}

var bkCheckSeq = 0;
async function bkCheckChange(type, id) {
  var k = bkKey(type, id);
  var msg = document.getElementById('bk-msg-' + k), save = document.getElementById('bk-save-' + k);
  if (!msg || !save) return;
  var v = bkReadChange(type, id);
  if (v.err) { msg.innerHTML = '<div class="bk-bad">' + escHtml(v.err) + '</div>'; save.disabled = true; return; }
  var seq = ++bkCheckSeq;
  try {
    var targets = await bkTargets(type, v);
    var clash = await bkFindClash(type, v, targets);
    if (seq !== bkCheckSeq) return;
    if (clash) {
      if (typeof bookNameMapReady !== 'undefined' && bookNameMapReady) await bookNameMapReady;
      msg.innerHTML = '<div class="bk-bad">⚠ ' + escHtml(bkClashText(type, clash)) + '</div>';
      save.disabled = true;
    } else {
      var what = type === 'vehicle' ? 'The vehicle is' : 'The room is';
      msg.innerHTML = '<div class="bk-ok">✓ ' + what + ' free' + (targets.length > 1 ? ' on all ' + targets.length + ' dates.' : ' then.') + '</div>';
      save.disabled = false;
    }
  } catch (e) {
    if (seq !== bkCheckSeq) return;
    msg.innerHTML = '';
    save.disabled = false; // can't check right now -- Save re-checks
  }
}

async function bkSaveChange(type, id) {
  var k = bkKey(type, id);
  var v = bkReadChange(type, id);
  var msg = document.getElementById('bk-msg-' + k), save = document.getElementById('bk-save-' + k);
  if (v.err) { msg.innerHTML = '<div class="bk-bad">' + escHtml(v.err) + '</div>'; return; }
  save.disabled = true;
  try {
    var targets = await bkTargets(type, v);
    var clash = await bkFindClash(type, v, targets);
    if (clash) { msg.innerHTML = '<div class="bk-bad">⚠ ' + escHtml(bkClashText(type, clash)) + '</div>'; return; }
    var patch = { purpose: v.purpose || null };
    if (type === 'vehicle') {
      patch.is_full_day = v.full;
      patch.time_from = v.full ? null : to24h(v.from);
      patch.time_to = v.full ? null : to24h(v.to);
    } else {
      patch.time_from = to24h(v.from);
      patch.time_to = to24h(v.to);
    }
    var filter;
    if (v.scope === 'after') {
      filter = 'series_id=eq.' + encodeURIComponent(v.b.series_id) + '&booking_date=gte.' + v.b.booking_date;
    } else {
      filter = 'id=eq.' + encodeURIComponent(v.b.id);
      if (v.date !== v.b.booking_date) {
        patch.booking_date = v.date;
        if (!v.b.changed_from) patch.changed_from = v.b.booking_date;
      }
    }
    try {
      await bkReq('PATCH', bkTable(type) + '?' + filter, patch);
    } catch (e) {
      // Before docs/booking-change-repeat.sql: save without the note.
      if (!bkMissingColumn(e) || !('changed_from' in patch)) throw e;
      delete patch.changed_from;
      await bkReq('PATCH', bkTable(type) + '?' + filter, patch);
    }
    bkRefresh(type);
  } catch (e) {
    msg.innerHTML = '<div class="bk-bad">Could not save the change. Please try again.</div>';
    save.disabled = false;
  }
}

// ── Cancel (asks "just this one / this and after" for a repeat) ──
async function bkCancel(type, id) {
  var b = bkCache[type + ':' + id];
  if (!b) return;
  if (!(type === 'room' && b.series_id)) {
    if (!confirm('Cancel this ' + (type === 'vehicle' ? 'vehicle' : 'room') + ' booking on ' + bkShort(b.booking_date) + '?')) return;
    try { await bkReq('DELETE', bkTable(type) + '?id=eq.' + encodeURIComponent(b.id)); } catch (e) { alert('Could not cancel this booking. Please try again.'); return; }
    bkRefresh(type);
    return;
  }
  var panel = bkPanel(type, id);
  if (!panel) return;
  panel.setAttribute('data-open', 'cancel');
  var k = bkKey(type, id);
  panel.innerHTML = '<div class="bk-form" style="background:#fff;border-color:#F0C4C4;">'
    + '<div style="font-size:12.5px;font-weight:700;margin-bottom:3px;">Cancel the booking on ' + escHtml(bkLong(b.booking_date)) + '?</div>'
    + '<div class="bk-info" style="margin:0 0 9px;">It\'s part of a repeat (' + escHtml(bkRuleLabel(b.repeat_rule)) + ').</div>'
    + '<div id="bk-cscope-' + k + '">'
    + '<button class="bk-opt on" data-v="one" onclick="bkPickCancel(\'' + k + '\',this)">Just ' + escHtml(bkLong(b.booking_date)) + '<small>Every other date stays booked.</small></button>'
    + '<button class="bk-opt" data-v="after" onclick="bkPickCancel(\'' + k + '\',this)">' + escHtml(bkShort(b.booking_date)) + ' and every one after<small>Earlier dates stay booked.</small></button>'
    + '</div>'
    + '<button class="bk-btn red" onclick="bkDoCancel(\'' + type + '\',\'' + escHtml(String(id)) + '\')">Cancel booking</button>'
    + '<button class="bk-btn ghost" onclick="bkClosePanel(\'' + type + '\',\'' + escHtml(String(id)) + '\')">Keep it</button>'
    + '</div>';
}

function bkPickCancel(k, btn) {
  document.querySelectorAll('#bk-cscope-' + k + ' .bk-opt').forEach(function (x) { x.classList.toggle('on', x === btn); });
}

async function bkDoCancel(type, id) {
  var b = bkCache[type + ':' + id];
  var on = document.querySelector('#bk-cscope-' + bkKey(type, id) + ' .bk-opt.on');
  var after = on && on.getAttribute('data-v') === 'after';
  var filter = after
    ? 'series_id=eq.' + encodeURIComponent(b.series_id) + '&booking_date=gte.' + b.booking_date
    : 'id=eq.' + encodeURIComponent(b.id);
  try { await bkReq('DELETE', bkTable(type) + '?' + filter); } catch (e) { alert('Could not cancel. Please try again.'); return; }
  bkRefresh(type);
}

// ── 2. Repeat on the room booking form ──
function bkRepeatEnsure() {
  bkInjectStyles();
  if (document.getElementById('bk-rep')) return;
  var okSpan = document.querySelector('#r-success span');
  if (okSpan) bkRep.okText = okSpan.textContent;
  var anchor = document.getElementById('r-clash-alert');
  if (!anchor) return;
  var wrap = document.createElement('div');
  wrap.id = 'bk-rep';
  wrap.innerHTML = '<div class="bk-lbl" style="margin-top:4px;">Repeat</div>'
    + '<div class="bk-seg" id="bk-rep-seg">'
    + '<button class="on" data-v="once" onclick="bkRepeatSet(\'once\')">Once</button>'
    + '<button data-v="weekly" onclick="bkRepeatSet(\'weekly\')">Weekly</button>'
    + '<button data-v="monthly" onclick="bkRepeatSet(\'monthly\')">Monthly</button></div>'
    + '<div id="bk-rep-opts" style="display:none;">'
    + '<div class="bk-hint" id="bk-rep-hint"></div>'
    + '<div class="bk-lbl">Until</div><input type="hidden" id="bk-rep-until">'
    + '<div class="bk-mgrid" id="bk-rep-grid"></div><div class="bk-sum" id="bk-rep-sum"></div>'
    + '<div id="bk-rep-wk"><div class="bk-lbl">If that day is a Saturday or Sunday</div>'
    + '<div class="bk-seg" id="bk-rep-wkend">'
    + '<button class="on" data-v="next" onclick="bkRepeatWkend(\'next\')">Next working day</button>'
    + '<button data-v="skip" onclick="bkRepeatWkend(\'skip\')">Skip that month</button></div></div>'
    + '</div>'
    + '<div id="bk-rep-preview"></div>';
  anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
}

function bkRepeatIsOn() { return bkRep.mode !== 'once' && !!document.getElementById('bk-rep'); }

// Called whenever the room form opens or closes.
function bkRepeatReset() {
  bkRepeatEnsure();
  bkRep.preview = null;
  bkRep.untilPicked = false;
  // Back to the normal success text once the form is opened again (not
  // when it closes right after a repeat, which sets "N dates booked!").
  var form = document.getElementById('room-form');
  var okSpan = document.querySelector('#r-success span');
  if (okSpan && bkRep.okText && form && form.style.display !== 'none') okSpan.textContent = bkRep.okText;
  bkRepeatWkend('next');
  bkRepeatSet('once');
}

function bkRepeatStartDate() {
  if (typeof rSelectedDates !== 'undefined' && rSelectedDates.length) return rSelectedDates[0];
  var el = document.getElementById('r-date');
  return el && el.value ? el.value : '';
}

function bkRepeatSet(mode) {
  if (mode !== bkRep.mode) bkRep.untilPicked = false; // new default for the new pattern
  bkRep.mode = mode;
  document.querySelectorAll('#bk-rep-seg button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-v') === mode); });
  var opts = document.getElementById('bk-rep-opts');
  if (opts) opts.style.display = mode === 'once' ? 'none' : '';
  var label = document.getElementById('r-submit-label');
  if (label) label.textContent = mode === 'once' ? 'Confirm Booking' : 'Check dates →';
  bkRepeatRefresh();
}

function bkRepeatWkend(v) {
  bkRep.wkend = v;
  document.querySelectorAll('#bk-rep-wkend button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-v') === v); });
  bkRepeatClearPreview();
  bkRepeatSummary();
}

// Re-labels the hint and the Until list for the chosen start date.
function bkRepeatRefresh() {
  bkRepeatClearPreview();
  var hint = document.getElementById('bk-rep-hint'), until = document.getElementById('bk-rep-until');
  if (!hint || !until) return;
  var start = bkRepeatStartDate();
  var wk = document.getElementById('bk-rep-wk');
  if (wk) wk.style.display = bkRep.mode === 'monthly' ? '' : 'none';
  var base = start ? bkD(start) : new Date();
  if (!start) hint.innerHTML = 'Pick the first date above.';
  else if (bkRep.mode === 'weekly') hint.innerHTML = '🔁 Every <b>' + bkWeekday(base.getDay()) + '</b>';
  else hint.innerHTML = '🔁 On the <b>' + bkOrdinal(base.getDate()) + '</b> of every month'
    + (base.getDate() > 28 ? ' (shorter months use their last day)' : '');
  // Until = the last month to repeat in, picked on a small month grid (‹ ›
  // to change year): any month after the first booking, up to 5 years
  // ahead -- a safety limit against a mistaken tap, not a rule. Default:
  // 12 bookings for Monthly (Dec 2026 → Nov 2027), 3 months for Weekly.
  // A month the person tapped is kept.
  var startYm = bkYmOf(base);
  bkRep.minYm = bkYmAdd(startYm, 1);
  bkRep.maxYm = bkYmAdd(startYm, BK_REPEAT_MAX_MONTHS);
  if (!bkRep.untilPicked || !until.value || until.value < bkRep.minYm || until.value > bkRep.maxYm) {
    until.value = bkYmAdd(startYm, bkRep.mode === 'weekly' ? 2 : 11);
  }
  bkRep.gridYear = Number(until.value.slice(0, 4));
  bkRep.startYm = startYm;
  bkRepeatGrid();
}

function bkYmOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function bkYmAdd(ym, n) { var p = ym.split('-'); return bkYmOf(new Date(Number(p[0]), Number(p[1]) - 1 + n, 1)); }

function bkRepeatGrid() {
  var grid = document.getElementById('bk-rep-grid'), until = document.getElementById('bk-rep-until');
  if (!grid || !until) return;
  var y = bkRep.gridYear, html = '<div class="bk-mgh">'
    + '<button onclick="bkRepeatYear(-1)"' + (String(y) <= bkRep.minYm.slice(0, 4) ? ' disabled' : '') + '>‹</button>' + y
    + '<button onclick="bkRepeatYear(1)"' + (String(y) >= bkRep.maxYm.slice(0, 4) ? ' disabled' : '') + '>›</button></div><div class="bk-mg">';
  for (var m = 1; m <= 12; m++) {
    var ym = y + '-' + String(m).padStart(2, '0');
    var cls = ym === until.value ? 'end' : (ym >= bkRep.startYm && ym < until.value ? 'in' : '');
    var off = ym < bkRep.minYm || ym > bkRep.maxYm;
    html += '<button data-ym="' + ym + '" class="' + cls + '"' + (off ? ' disabled' : ' onclick="bkRepeatPick(\'' + ym + '\')"') + '>'
      + new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'short' }).replace('Sept', 'Sep') + '</button>';
  }
  grid.innerHTML = html + '</div>';
  bkRepeatSummary();
}

function bkRepeatYear(dir) { bkRep.gridYear += dir; bkRepeatGrid(); }

function bkRepeatPick(ym) {
  document.getElementById('bk-rep-until').value = ym;
  bkRep.untilPicked = true;
  bkRepeatClearPreview();
  bkRepeatGrid();
}

// "🗓 12 bookings · Dec 2026 → Nov 2027"
function bkRepeatSummary() {
  var el = document.getElementById('bk-rep-sum'), until = document.getElementById('bk-rep-until');
  if (!el || !until || !until.value) return;
  var start = bkRepeatStartDate();
  if (!start) { el.innerHTML = ''; return; }
  var n = bkRepeatDates(start, bkRep.mode, until.value, bkRep.wkend).filter(function (x) { return !x.skip; }).length;
  var lbl = function (ym) { return new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' }).replace('Sept', 'Sep'); };
  el.innerHTML = '🗓 <b>' + n + (n === 1 ? ' booking' : ' bookings') + '</b> · ' + lbl(bkRep.startYm) + ' → <b>' + lbl(until.value) + '</b>';
}

function bkRepeatClearPreview() {
  bkRep.preview = null;
  var p = document.getElementById('bk-rep-preview');
  if (p) p.innerHTML = '';
  var btn = document.getElementById('r-submit-btn');
  if (btn) btn.style.display = '';
}

// Every date of the repeat: [{ date, note }] (note set when moved off a weekend).
function bkRepeatDates(start, mode, untilYm, wkend) {
  var out = [], s = bkD(start);
  var u = untilYm.split('-');
  var end = new Date(Number(u[0]), Number(u[1]), 0); // last day of the Until month
  if (mode === 'weekly') {
    for (var d = new Date(s); d <= end && out.length < BK_REPEAT_MAX_DATES; d.setDate(d.getDate() + 7)) out.push({ date: bkYmd(d) });
    return out;
  }
  var day = s.getDate();
  for (var k = 0; out.length < BK_REPEAT_MAX_DATES; k++) {
    var last = new Date(s.getFullYear(), s.getMonth() + k + 1, 0).getDate();
    var t = new Date(s.getFullYear(), s.getMonth() + k, Math.min(day, last));
    if (t > end) break;
    var dow = t.getDay(), note = null;
    if (k > 0 && (dow === 0 || dow === 6)) {
      if (wkend === 'skip') { out.push({ date: bkYmd(t), skip: 'weekend', dow: dow }); continue; }
      var orig = bkYmd(t);
      t.setDate(t.getDate() + (dow === 6 ? 2 : 1));
      note = bkShort(orig) + ' is a ' + (dow === 6 ? 'Saturday' : 'Sunday') + ' → ' + t.toLocaleDateString('en-MY', { weekday: 'short' });
    }
    out.push({ date: bkYmd(t), note: note });
  }
  return out;
}

// "Check dates →" -- called from submitRoomBooking() when Repeat is on.
async function bkRepeatCheck() {
  var tfrom = document.getElementById('r-time-from').value;
  var tto = document.getElementById('r-time-to').value;
  var ok = true;
  clearBookErrors(['r-date', 'r-time-from', 'r-time-to']);
  var start = bkRepeatStartDate();
  if (!start) { showBookError('r-date'); ok = false; }
  if (!tfrom) { showBookError('r-time-from'); ok = false; }
  if (!tto) { showBookError('r-time-to'); ok = false; }
  if (!ok) return;
  if (tfrom >= tto) { showBookError('r-time-to'); return; }
  var all = bkRepeatDates(start, bkRep.mode, document.getElementById('bk-rep-until').value, bkRep.wkend);
  var dates = all.filter(function (x) { return !x.skip; });
  var preview = document.getElementById('bk-rep-preview');
  preview.innerHTML = '<div class="bk-info" style="margin-bottom:9px;">Checking ' + dates.length + ' dates…</div>';
  var taken = {};
  try {
    var rows = await bkReq('GET', 'room_bookings?room_name=eq.' + encodeURIComponent(rSelectedRoom) + '&booking_date=in.(' + dates.map(function (x) { return x.date; }).join(',') + ')&limit=2000');
    (rows || []).forEach(function (o) {
      if (bkOverlap(bkHHMM(to24h(tfrom)), bkHHMM(to24h(tto)), o) && !taken[o.booking_date]) taken[o.booking_date] = o;
    });
  } catch (e) { preview.innerHTML = '<div class="bk-bad">Could not check the dates. Please try again.</div>'; return; }
  if (typeof bookNameMapReady !== 'undefined' && bookNameMapReady) await bookNameMapReady;
  var free = dates.filter(function (x) { return !taken[x.date]; });
  var html = '<div class="bk-lbl">' + dates.length + ' dates · ' + fmtTime(to24h(tfrom)) + ' – ' + fmtTime(to24h(tto)) + '</div><div class="bk-dates">';
  all.forEach(function (x) {
    var t = taken[x.date], s;
    if (x.skip) s = '<span class="bk-s taken">' + (x.dow === 6 ? 'Saturday' : 'Sunday') + ' — skipped</span>';
    else if (t) s = '<span class="bk-s taken">Taken by ' + escHtml(bookDisplayName(t)) + ' ' + escHtml(fmtTime(t.time_from)) + '–' + escHtml(fmtTime(t.time_to)) + '</span>';
    else if (x.note) s = '<span class="bk-s moved">' + escHtml(x.note) + '</span>';
    else s = '<span class="bk-s free">Free</span>';
    html += '<div class="bk-dt"><span>' + escHtml(bkLong(x.date)) + '</span>' + s + '</div>';
  });
  html += '</div>';
  var nTaken = dates.length - free.length;
  if (nTaken) html += '<div class="bk-bad">' + nTaken + (nTaken === 1 ? ' date is' : ' dates are') + ' already taken and will be skipped — you can book ' + (nTaken === 1 ? 'it' : 'them') + ' separately.</div>';
  html += free.length
    ? '<button class="bk-btn" id="bk-rep-book" onclick="bkRepeatBook()">Book ' + free.length + (free.length === 1 ? ' date' : ' dates') + '</button>'
    : '<div class="bk-bad">Every date is taken at this time — try another time.</div>';
  html += '<button class="bk-btn ghost" onclick="bkRepeatClearPreview()">← Back</button>';
  preview.innerHTML = html;
  bkRep.preview = { dates: free.map(function (x) { return x.date; }), from: to24h(tfrom), to: to24h(tto), start: start };
  document.getElementById('r-submit-btn').style.display = 'none';
}

async function bkRepeatBook() {
  var p = bkRep.preview;
  if (!p || !p.dates.length) return;
  var btn = document.getElementById('bk-rep-book');
  if (btn) btn.disabled = true;
  var u = bkMe();
  var s = bkD(p.start);
  var rule = bkRep.mode === 'weekly' ? 'weekly-' + s.getDay() : 'monthly-' + s.getDate();
  var series = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var purpose = (document.getElementById('r-purpose').value || '').trim();
  var rows = p.dates.map(function (d) {
    return { booked_by: u.name || u.email || 'Unknown', booked_by_email: myBookingEmail(), booking_date: d, room_name: rSelectedRoom,
      time_from: p.from, time_to: p.to, purpose: purpose || null, series_id: series, repeat_rule: rule };
  });
  try {
    await bkReq('POST', 'room_bookings', rows, { 'Prefer': 'return=minimal' });
  } catch (e) {
    if (btn) btn.disabled = false;
    var msg = document.getElementById('r-error-msg');
    if (msg) msg.textContent = bkMissingColumn(e)
      ? 'Repeating bookings need a one-time database update — please ask an admin to run docs/booking-change-repeat.sql.'
      : 'Could not save the bookings. Please try again.';
    showBookAlert('r-error');
    return;
  }
  hideRoomForm();
  var ok = document.getElementById('r-success');
  if (ok) { var span = ok.querySelector('span'); if (span) span.textContent = p.dates.length + ' dates booked!'; }
  showBookAlert('r-success');
  bkRefresh('room');
}
