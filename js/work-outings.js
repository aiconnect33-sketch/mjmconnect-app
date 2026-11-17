// ── work-outings.js — Time Off tab → 💼 Work ("Out for Work") ──
//
// Shared by the staff app (index.html, called from loadTimeOff in
// js/tab-timeoff.js) and the admin page (admin.html, called from
// loadAdminTimeOffSelf), the same way js/faulty-progress.js is.
//
// A work outing is a Time Out for company business -- bank, LHDN, a
// supplier, a client. It lives in its own table (work_outings, see
// docs/work-outings-schema.sql), never in time_off_records, so nothing that
// counts personal Time Off (4h/month meter, 2h/trip limit, cancellation
// approvals, Annual Leave reminders, the Google Sheet sync) ever sees it.
// No approval: every outing is visible to all staff, and admins get it in
// the Time Off Report's 💼 Work tab.
//
// Both pages use the same element ids for the switch and the two panels:
//   #to-kind-personal / #to-kind-work   -- the 🚶 Personal | 💼 Work pills
//   #to-personal-panel / #to-work-panel -- what each pill shows
// A person can't be out on Personal and Work at the same time; the personal
// Time Out functions call woMyOpenOuting() before starting.

var WO_PURPLE = '#534AB7';
var WO_PURPLE_BG = '#EEEDFE';

var woState = {
  rows: [], today: '', myEmailLow: '', kind: 'personal', list: 'mine',
  cancelledOpen: false, autoSwitched: {}, missingTable: false, loaded: false
};

function woInjectStyles() {
  if (document.getElementById('wo-styles')) return;
  var css = ''
    + '.wo-kind-wrap{margin:0 0 12px !important}'
    + '.wo-kind-wrap .to-pill{font-size:12px;padding:8px 4px}'
    + '.wo-card{background:#fff;border:1px solid #E2ECE8;border-radius:14px;padding:14px;margin-bottom:10px}'
    + '.wo-lbl{font-size:10.5px;font-weight:700;color:#70827D;letter-spacing:.04em;text-transform:uppercase;margin:0 0 5px}'
    + '.wo-input{width:100%;box-sizing:border-box;border:1px solid #D5DEDA;border-radius:10px;padding:10px 11px;font-size:13px;font-family:inherit;background:#fff;color:#111C18;margin-bottom:10px}'
    + '.wo-hint{font-size:10.5px;line-height:1.45;border-radius:10px;padding:8px 10px;margin-bottom:10px;background:' + WO_PURPLE_BG + ';color:' + WO_PURPLE + '}'
    + '.wo-btn{width:100%;border:none;border-radius:10px;padding:11px;font-size:13px;font-weight:700;font-family:inherit;color:#fff;background:' + WO_PURPLE + ';cursor:pointer}'
    + '.wo-btn.green{background:#0F6E5C}'
    + '.wo-toggle{text-align:center;font-size:11px;color:#70827D;margin-top:9px;cursor:pointer}'
    + '.wo-banner{background:' + WO_PURPLE_BG + ';border:1.5px dashed ' + WO_PURPLE + ';border-radius:16px;padding:15px;text-align:center;margin-bottom:10px}'
    + '.wo-status{font-size:11px;font-weight:800;letter-spacing:.06em;color:' + WO_PURPLE + ';margin-bottom:5px;display:flex;align-items:center;justify-content:center;gap:6px}'
    + '.wo-dot{width:8px;height:8px;border-radius:50%;background:' + WO_PURPLE + ';display:inline-block}'
    + '.wo-purpose{font-size:14px;font-weight:700;color:#111C18}'
    + '.wo-time{font-size:11.5px;color:#70827D;margin:3px 0 10px}'
    + '.wo-free{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.75);border:1px solid ' + WO_PURPLE + ';color:' + WO_PURPLE + ';font-size:11px;font-weight:700;padding:4px 11px;border-radius:20px;margin-bottom:12px}'
    + '.wo-mistake{font-size:11px;color:#A32D2D;margin-top:9px;cursor:pointer;display:inline-block}'
    + '.wo-sec{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;margin:12px 2px 8px;color:' + WO_PURPLE + '}'
    + '.wo-now{background:#fff;border:1.5px solid ' + WO_PURPLE + ';border-radius:14px;padding:2px 12px;margin-bottom:10px}'
    + '.wo-now-empty{background:#fff;border:1px solid #E2ECE8;border-radius:14px;padding:12px;margin-bottom:10px;font-size:11.5px;color:#70827D;text-align:center}'
    + '.wo-pr{display:flex;align-items:center;gap:10px;padding:9px 0}'
    + '.wo-pr+.wo-pr{border-top:1px solid #EEF2F0}'
    + '.wo-av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;flex-shrink:0;background:' + WO_PURPLE_BG + ';color:' + WO_PURPLE + '}'
    + '.wo-nm{font-size:12.5px;font-weight:600;color:#111C18}'
    + '.wo-sub{font-size:10.5px;color:#70827D;margin-top:1px}'
    + '.wo-tag{margin-left:auto;font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;flex-shrink:0}'
    + '.wo-tag.out{background:' + WO_PURPLE_BG + ';color:' + WO_PURPLE + '}'
    + '.wo-tag.done{background:#EEF2F0;color:#70827D}'
    + '.wo-row{background:#fff;border:1px solid #E2ECE8;border-radius:12px;padding:10px 12px;margin-bottom:8px}'
    + '.wo-row-top{display:flex;align-items:flex-start;gap:8px}'
    + '.wo-row-t{font-size:12.5px;font-weight:600;color:#111C18;flex:1;min-width:0;word-break:break-word}'
    + '.wo-row-s{font-size:10.5px;color:#70827D;margin-top:3px}'
    + '.wo-row.voided .wo-row-t{text-decoration:line-through;color:#9AABA3}'
    + '.wo-acts{display:flex;gap:12px;margin-top:6px}'
    + '.wo-act{font-size:10.5px;font-weight:700;cursor:pointer;color:#0F6E5C}'
    + '.wo-act.red{color:#A32D2D}'
    + '.wo-fix{display:flex;gap:6px;align-items:center;margin-top:8px}'
    + '.wo-fix input{border:1px solid #D5DEDA;border-radius:8px;padding:6px 8px;font-family:inherit;font-size:12px}'
    + '.wo-fix button{border:none;border-radius:8px;padding:7px 12px;font-size:11.5px;font-weight:700;font-family:inherit;background:#0F6E5C;color:#fff;cursor:pointer}'
    + '.wo-edited{color:#854F0B;font-weight:700}'
    + '.wo-note{font-size:11.5px;color:#70827D;text-align:center;padding:14px 0}'
    + '.wo-mini{display:inline-block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:' + WO_PURPLE_BG + ';color:' + WO_PURPLE + ';margin-top:5px;vertical-align:top}';
  var el = document.createElement('style');
  el.id = 'wo-styles';
  el.textContent = css;
  document.head.appendChild(el);
}

// ── helpers ──
function woIsAdminPage() { return !!document.getElementById('screen-timeoffreport'); }
function woMe() { try { return JSON.parse(localStorage.getItem('mjm_user') || '{}') || {}; } catch (e) { return {}; } }
function woCanManage() {
  if (woIsAdminPage()) return true;
  return typeof hasEditPermission === 'function' && hasEditPermission('timeoff');
}
function woName(r) { return typeof timeoffDisplayName === 'function' ? timeoffDisplayName(r) : r.staff_name; }
function woClock(d) {
  var h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}
function woDur(mins) {
  mins = Math.max(0, Math.round(mins || 0));
  var h = Math.floor(mins / 60), m = mins % 60;
  if (h <= 0) return m + 'm';
  return h + 'h ' + String(m).padStart(2, '0') + 'm';
}
function woMinutes(r) {
  if (r.time_in) return r.duration_minutes != null ? r.duration_minutes : (new Date(r.time_in) - new Date(r.time_out)) / 60000;
  return (Date.now() - new Date(r.time_out).getTime()) / 60000;
}
// Two letters: first letters of the first two words, or for a one-word
// name like "ShirleyT" its capitals ("ST"), else its first two letters.
function woInitials(name) {
  var words = String(name || '?').split(' ').filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join('');
  var w = words[0] || '?', caps = w.replace(/[^A-Z]/g, '');
  return (caps.length >= 2 ? caps.slice(0, 2) : w.slice(0, 2)).toUpperCase();
}
function woIsOpen(r) { return !r.time_in && r.entry_type !== 'voided'; }

async function woReq(method, path, body) {
  var headers = { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY };
  if (body) { headers['Content-Type'] = 'application/json'; headers['Prefer'] = 'return=representation'; }
  var res = await fetch(SURL + '/rest/v1/' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  var data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    var err = new Error('work_outings request failed: ' + res.status);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}
// "Table doesn't exist yet" -- docs/work-outings-schema.sql not run.
function woIsMissingTable(e) { return e && (e.status === 404 || e.code === '42P01' || e.code === 'PGRST205'); }

// Everyone currently out for work -- used by the Home "Currently Out" card
// on both pages. Never throws: no table yet simply means nobody is out.
async function woFetchOpen() {
  try {
    return (await woReq('GET', 'work_outings?time_in=is.null&entry_type=neq.voided&order=time_out.asc&limit=50')) || [];
  } catch (e) { return []; }
}

// The signed-in person's own open work outing, or null. Called by the
// personal Time Out functions so nobody is out on both at once.
async function woMyOpenOuting(email) {
  if (!email) return null;
  try {
    var rows = await woReq('GET', 'work_outings?staff_email=eq.' + encodeURIComponent(email) + '&time_in=is.null&entry_type=neq.voided&limit=1');
    return rows && rows.length ? rows[0] : null;
  } catch (e) { return null; }
}

// The purple line under the Home "Currently Out" names.
function woHomeLineHtml(workRows) {
  if (!workRows || !workRows.length) return '';
  woInjectStyles(); // Home can render before the Time Off screen ever loads
  var names = workRows.map(function (r) { return woName(r); }).join(', ');
  return '<span class="wo-mini">💼 Out for work · ' + escHtml(names) + '</span>';
}

// ── Personal | Work switch ──
function woSwitchKind(kind) {
  woState.kind = kind;
  var p = document.getElementById('to-personal-panel');
  var w = document.getElementById('to-work-panel');
  if (p) p.style.display = kind === 'personal' ? 'block' : 'none';
  if (w) w.style.display = kind === 'work' ? 'block' : 'none';
  var pBtn = document.getElementById('to-kind-personal');
  var wBtn = document.getElementById('to-kind-work');
  var green = woIsAdminPage() ? 'var(--green)' : 'var(--green-dark)';
  var muted = woIsAdminPage() ? 'var(--text2)' : 'var(--text-secondary)';
  if (pBtn) { pBtn.style.background = kind === 'personal' ? green : 'transparent'; pBtn.style.color = kind === 'personal' ? '#fff' : muted; }
  if (wBtn) { wBtn.style.background = kind === 'work' ? WO_PURPLE : 'transparent'; wBtn.style.color = kind === 'work' ? '#fff' : muted; }
}

function woSetWorkPillLabel(isOut) {
  var wBtn = document.getElementById('to-kind-work');
  if (wBtn) wBtn.innerHTML = '💼 Work' + (isOut ? ' · Out' : '');
}

// ── load + render ──
async function woLoad() {
  if (window.location.protocol === 'file:') return;
  var panel = document.getElementById('to-work-panel');
  if (!panel) return;
  woInjectStyles();
  var me = woMe();
  if (!me.email) return;
  woState.today = localDateStr();
  woState.myEmailLow = me.email.toLowerCase();
  var monthStart = woState.today.slice(0, 8) + '01';
  try {
    // This month's outings, plus anything still open from before the 1st
    // (someone out across midnight on the last day of a month).
    var rows = await woReq('GET', 'work_outings?or=(time_out.gte.' + monthStart + ',and(time_in.is.null,entry_type.neq.voided))&order=time_out.desc&limit=500');
    woState.rows = rows || [];
    woState.missingTable = false;
  } catch (e) {
    woState.rows = [];
    woState.missingTable = woIsMissingTable(e);
    panel.innerHTML = '<div class="wo-note">' + (woState.missingTable
      ? 'Out for Work isn\'t switched on yet' + (woIsAdminPage() ? ' — run docs/work-outings-schema.sql in Supabase once.' : ' — please ask an admin.')
      : 'Could not load work outings.') + '</div>';
    woSetWorkPillLabel(false);
    return;
  }
  woState.loaded = true;
  var mine = woMyOpen();
  woSetWorkPillLabel(!!mine);
  // Opening Time Off while out for work lands on the Work side -- once per
  // outing, so tapping back to Personal isn't undone by the next refresh.
  if (mine && !woState.autoSwitched[mine.id]) {
    woState.autoSwitched[mine.id] = true;
    woSwitchKind('work');
  }
  woRender();
}

function woMyOpen() {
  return woState.rows.find(function (r) { return woIsOpen(r) && (r.staff_email || '').toLowerCase() === woState.myEmailLow; }) || null;
}

function woRender() {
  var panel = document.getElementById('to-work-panel');
  if (!panel) return;
  var mine = woMyOpen();
  var html = '';

  if (mine) {
    var out = new Date(mine.time_out);
    html += '<div class="wo-banner">'
      + '<div class="wo-status"><span class="wo-dot"></span>YOU\'RE OUT FOR WORK</div>'
      + '<div class="wo-purpose">' + escHtml(mine.purpose) + '</div>'
      + '<div class="wo-time">Out since ' + woClock(out) + ' · ' + woDur(woMinutes(mine)) + ' so far</div>'
      + '<div class="wo-free">💼 Not charged to your Time Off</div>'
      + '<button class="wo-btn green" onclick="woTimeIn(' + mine.id + ')">✓ I\'m Back — Time In</button>'
      // Only admins / Time Off editors can cancel an outing -- staff just
      // tap I'm Back (an accidental tap is a few minutes, never charged).
      + (woCanManage() ? '<div><span class="wo-mistake" onclick="woCancel(' + mine.id + ')">✕ Started this by mistake? Cancel it</span></div>' : '')
      + '</div>';
  } else {
    html += '<div class="wo-card">'
      + '<div class="wo-lbl">Where to &amp; what for</div>'
      + '<input class="wo-input" id="wo-purpose" maxlength="200" placeholder="e.g. Public Bank — company deposit">'
      + '<div class="wo-hint">💼 For Company errands only. Doesn\'t use your 4h Time Off.</div>'
      + '<div id="wo-now-row">'
      + '<button class="wo-btn" onclick="woTimeOutNow()">💼 Time Out for Work</button>'
      + '<div class="wo-toggle" onclick="woShowCustomTime()">⏱ Or key in a time instead</div>'
      + '</div>'
      + '<div id="wo-custom-row" style="display:none;">'
      + '<div class="wo-lbl">Time Out At</div>'
      + '<input class="wo-input" type="time" id="wo-custom-time">'
      + '<button class="wo-btn" onclick="woTimeOutAtCustomTime()">💼 Confirm Time Out for Work</button>'
      + '<div class="wo-toggle" onclick="woHideCustomTime()">↺ Use current time instead</div>'
      + '</div>'
      + '</div>';
  }

  // Everyone out for work right now -- visible to all staff.
  var openRows = woState.rows.filter(woIsOpen).sort(function (a, b) { return new Date(a.time_out) - new Date(b.time_out); });
  html += '<div class="wo-sec"><span class="wo-dot"></span>Out for work right now' + (openRows.length ? ' · ' + openRows.length : '') + '</div>';
  if (openRows.length) {
    html += '<div class="wo-now">' + openRows.map(function (r) {
      var isMe = (r.staff_email || '').toLowerCase() === woState.myEmailLow;
      return '<div class="wo-pr"><div class="wo-av">' + escHtml(woInitials(woName(r))) + '</div>'
        + '<div style="min-width:0;flex:1;"><div class="wo-nm">' + escHtml(woName(r)) + (isMe ? ' <span style="color:#70827D;font-weight:500;">(you)</span>' : '') + '</div>'
        + '<div class="wo-sub">' + escHtml(r.purpose) + '</div>'
        + '<div class="wo-sub">Since ' + woClock(new Date(r.time_out)) + ' · ' + woDur(woMinutes(r)) + ' so far</div></div>'
        + '<span class="wo-tag out">Out</span></div>';
    }).join('') + '</div>';
  } else {
    html += '<div class="wo-now-empty">No one is out for work right now.</div>';
  }

  // My Work Outings | All Work Outings -- same pattern as My/All Records.
  var green = woIsAdminPage() ? 'var(--green)' : 'var(--green-dark)';
  var muted = woIsAdminPage() ? 'var(--text2)' : 'var(--text-secondary)';
  function pill(key, label, icon) {
    var on = woState.list === key;
    return '<button id="wo-pill-' + key + '" class="to-pill" onclick="woSwitchList(\'' + key + '\')" style="background:' + (on ? green : 'transparent') + ';color:' + (on ? '#fff' : muted) + ';">'
      + '<i class="ti ' + icon + '"></i> ' + label + '</button>';
  }
  html += '<div class="to-pill-wrap">' + pill('mine', 'My Work Outings', 'ti-clipboard-list') + pill('all', 'All Work Outings', 'ti-users') + '</div>';
  html += '<div id="wo-list">' + woListHtml() + '</div>';

  panel.innerHTML = html;
}

function woSwitchList(which) {
  woState.list = which;
  woRender();
}

function woToggleCancelled() {
  woState.cancelledOpen = !woState.cancelledOpen;
  var el = document.getElementById('wo-list');
  if (el) el.innerHTML = woListHtml();
}

function woDayLabel(dayKey) {
  var today = woState.today;
  var y = new Date(today + 'T00:00:00'); y.setDate(y.getDate() - 1);
  if (dayKey === today) return 'Today';
  if (dayKey === localDateStr(y)) return 'Yesterday';
  return new Date(dayKey + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });
}

function woListHtml() {
  var isMineList = woState.list === 'mine';
  var rows = woState.rows.filter(function (r) {
    return !isMineList || (r.staff_email || '').toLowerCase() === woState.myEmailLow;
  });
  var live = rows.filter(function (r) { return r.entry_type !== 'voided'; });
  var voided = rows.filter(function (r) { return r.entry_type === 'voided'; });
  var total = live.reduce(function (s, r) { return s + woMinutes(r); }, 0);
  var staffSet = {};
  live.forEach(function (r) { staffSet[(r.staff_email || '').toLowerCase() || r.staff_name] = 1; });
  var staffCount = Object.keys(staffSet).length;
  var meta = live.length
    ? live.length + (live.length === 1 ? ' outing' : ' outings') + ' this month · ' + woDur(total) + ' out for work'
      + (isMineList ? '' : ' · ' + staffCount + ' staff')
    : 'No work outings this month';
  var html = '<div class="to-meta">' + escHtml(meta) + (live.length ? ' · not charged' : '') + '</div>';
  if (!live.length && !voided.length) {
    return html + '<div class="wo-note">' + (isMineList ? 'You haven\'t gone out for work this month.' : 'No one has gone out for work this month.') + '</div>';
  }
  var groups = [], byDay = {};
  live.forEach(function (r) {
    var key = localDateStr(new Date(r.time_out));
    if (!byDay[key]) { byDay[key] = []; groups.push(key); }
    byDay[key].push(r);
  });
  groups.forEach(function (key) {
    html += '<div class="to-day-label">' + escHtml(woDayLabel(key)) + '</div>';
    byDay[key].forEach(function (r) { html += woRowHtml(r, isMineList); });
  });
  if (voided.length) {
    html += '<button class="to-cancel-toggle" onclick="woToggleCancelled()">' + (woState.cancelledOpen ? 'Hide ' : 'Show ') + voided.length + ' cancelled</button>';
    if (woState.cancelledOpen) voided.forEach(function (r) { html += woRowHtml(r, isMineList); });
  }
  return html;
}

function woRowHtml(r, isMineList) {
  var isMine = (r.staff_email || '').toLowerCase() === woState.myEmailLow;
  var canManage = woCanManage();
  var out = new Date(r.time_out);
  var voided = r.entry_type === 'voided';
  var open = woIsOpen(r);
  var title = (isMineList ? '' : escHtml(woName(r)) + ' — ') + escHtml(r.purpose);
  var sub = woClock(out) + ' → ' + (r.time_in ? woClock(new Date(r.time_in)) : 'still out')
    + (r.entry_type === 'edited' ? ' · <span class="wo-edited">edited</span>' : '');
  var tag = voided ? '<span class="wo-tag done">Cancelled</span>'
    : open ? '<span class="wo-tag out">Out · ' + woDur(woMinutes(r)) + '</span>'
    : '<span class="wo-tag done">' + woDur(woMinutes(r)) + '</span>';
  var acts = '';
  if (!voided) {
    if (canManage && r.time_in) acts += '<span class="wo-act" onclick="woShowFix(' + r.id + ')">✎ Correct Time In</span>';
    if (canManage) acts += '<span class="wo-act red" onclick="woCancel(' + r.id + ')">✕ Cancel</span>';
  }
  return '<div class="wo-row' + (voided ? ' voided' : '') + '" data-wo-id="' + r.id + '">'
    + '<div class="wo-row-top"><div class="wo-row-t">' + title + '</div>' + tag + '</div>'
    + '<div class="wo-row-s">' + sub + '</div>'
    + (acts ? '<div class="wo-acts">' + acts + '</div>' : '')
    + '<div id="wo-fix-' + r.id + '"></div>'
    + '</div>';
}

// ── actions ──
function woShowCustomTime() {
  var now = new Date();
  var t = document.getElementById('wo-custom-time');
  if (t) t.value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  document.getElementById('wo-now-row').style.display = 'none';
  document.getElementById('wo-custom-row').style.display = 'block';
}
function woHideCustomTime() {
  document.getElementById('wo-now-row').style.display = 'block';
  document.getElementById('wo-custom-row').style.display = 'none';
}
async function woTimeOutNow() { await woStart(new Date()); }
async function woTimeOutAtCustomTime() {
  var t = document.getElementById('wo-custom-time');
  var val = t ? t.value : '';
  if (!val) { alert('Please choose a time.'); return; }
  var parts = val.split(':');
  var d = new Date();
  d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
  if (d.getTime() > Date.now() + 60000) { alert('Time Out can\'t be in the future.'); return; }
  await woStart(d);
}

// Is the signed-in person on personal Time Off right now?
async function woHasOpenPersonal(email) {
  try {
    var rows = await woReq('GET', 'time_off_records?staff_email=eq.' + encodeURIComponent(email) + '&time_in=is.null&entry_type=neq.voided&entry_type=neq.cancel_pending&limit=1');
    return !!(rows && rows.length);
  } catch (e) { return false; }
}

async function woStart(timeOutDate) {
  var me = woMe();
  if (!me.email) return;
  var el = document.getElementById('wo-purpose');
  var purpose = el ? el.value.trim() : '';
  if (!purpose) { alert('Please say where you\'re going and what for.'); return; }
  try {
    if (await woHasOpenPersonal(me.email)) {
      alert('You\'re on personal Time Off right now. Tap I\'m Back on the 🚶 Personal side first.');
      return;
    }
    if (await woMyOpenOuting(me.email)) { alert('You\'re already out for work. Tap I\'m Back on that one first.'); return; }
    await woReq('POST', 'work_outings', {
      staff_name: me.name || me.email, staff_email: me.email,
      purpose: purpose, time_out: timeOutDate.toISOString()
    });
    woAfterChange();
  } catch (e) {
    alert(woIsMissingTable(e) ? 'Out for Work isn\'t switched on yet. Please ask an admin.' : 'Could not start your work outing. Please try again.');
  }
}

async function woTimeIn(id) {
  try {
    var rows = await woReq('GET', 'work_outings?id=eq.' + id);
    var r = rows && rows[0];
    if (!r) return;
    if (r.time_in) { woAfterChange(); return; }
    var timeIn = new Date();
    var mins = Math.max(0, Math.round((timeIn - new Date(r.time_out)) / 60000));
    // time_in=is.null guard: a second tap (or another device) can't
    // overwrite the first Time In.
    await woReq('PATCH', 'work_outings?id=eq.' + id + '&time_in=is.null', { time_in: timeIn.toISOString(), duration_minutes: mins });
    woAfterChange();
  } catch (e) { alert('Could not record your Time In. Please try again.'); }
}

async function woCancel(id) {
  var r = woState.rows.find(function (x) { return x.id === id; });
  var isMine = r && (r.staff_email || '').toLowerCase() === woState.myEmailLow;
  if (!woCanManage()) return; // staff can't cancel, not even their own
  var who = r && !isMine ? (' for ' + woName(r)) : '';
  if (!confirm('Cancel this work outing' + who + '?\n\nIt will be marked as cancelled and left out of the report.')) return;
  try {
    await woReq('PATCH', 'work_outings?id=eq.' + id, { entry_type: 'voided' });
    woAfterChange();
  } catch (e) { alert('Could not cancel this work outing. Please try again.'); }
}

// Admin / Time Off editors only: fix a wrong Time In (e.g. forgot to tap
// I'm Back until the next morning).
function woShowFix(id) {
  if (!woCanManage()) return;
  var r = woState.rows.find(function (x) { return x.id === id; });
  var box = document.getElementById('wo-fix-' + id);
  if (!r || !box) return;
  if (box.innerHTML) { box.innerHTML = ''; return; }
  var tin = new Date(r.time_in);
  var val = String(tin.getHours()).padStart(2, '0') + ':' + String(tin.getMinutes()).padStart(2, '0');
  box.innerHTML = '<div class="wo-fix"><span style="font-size:11px;color:#70827D;">Time In</span>'
    + '<input type="time" id="wo-fix-time-' + id + '" value="' + val + '">'
    + '<button onclick="woSaveFix(' + id + ')">Save</button></div>';
}

async function woSaveFix(id) {
  if (!woCanManage()) return;
  var r = woState.rows.find(function (x) { return x.id === id; });
  var input = document.getElementById('wo-fix-time-' + id);
  if (!r || !input || !input.value) return;
  var out = new Date(r.time_out);
  var parts = input.value.split(':');
  var tin = new Date(out);
  tin.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
  if (tin <= out) { alert('Time In has to be after the Time Out (' + woClock(out) + ').'); return; }
  if (tin.getTime() > Date.now() + 60000) { alert('Time In can\'t be in the future.'); return; }
  var patch = {
    time_in: tin.toISOString(),
    duration_minutes: Math.round((tin - out) / 60000),
    entry_type: 'edited', corrected_at: new Date().toISOString()
  };
  if (!r.original_time_in) patch.original_time_in = r.time_in;
  try {
    await woReq('PATCH', 'work_outings?id=eq.' + id, patch);
    woAfterChange();
  } catch (e) { alert('Could not save the correction. Please try again.'); }
}

// Refresh this panel plus the Home "Currently Out" card on whichever page
// we're on.
function woAfterChange() {
  if (woIsAdminPage()) {
    woLoad();
    if (typeof loadAdminLeaveDuty === 'function') loadAdminLeaveDuty();
  } else if (typeof loadTimeOff === 'function') {
    loadTimeOff(); // reloads the Home card and calls woLoad() itself
  } else {
    woLoad();
  }
}
