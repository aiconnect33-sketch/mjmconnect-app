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
//
// Planned ahead (docs/work-outings-plan-ahead.sql): an outing can be keyed
// in for a later time or day. It's simply a row whose time_out is still in
// the future -- "Upcoming" until then, and out for work from that moment on,
// with nobody needing to tap anything (planned_time_out keeps what was
// planned, so the record can show "planned 2:30 PM · changed to 2:45").
// Any outing can also have an optional back_by time, or rest_of_day = true
// ("not coming back to the office today"), which ends it by itself at
// closing time. The work-outing-reminders Edge Function
// (docs/work-outing-reminders-setup.md) sends the "starts in 10 minutes"
// and "still out?" notifications and closes rest-of-day outings server-side.

var WO_PURPLE = '#534AB7';
var WO_PURPLE_BG = '#EEEDFE';

var woState = {
  rows: [], today: '', myEmailLow: '', kind: 'personal', list: 'mine',
  cancelledOpen: false, autoSwitched: {}, missingTable: false, loaded: false,
  editing: {}, deepLink: ''
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
    + '.wo-up{background:#FFF6E5;border:1.5px dashed #D9A441;border-radius:16px;padding:13px;margin-bottom:10px}'
    + '.wo-up-st{font-size:10.5px;font-weight:800;letter-spacing:.05em;color:#854F0B;margin-bottom:4px}'
    + '.wo-up-tm{font-size:11px;color:#70827D;margin:3px 0 10px}'
    + '.wo-up-acts{display:flex;gap:8px}'
    + '.wo-up-acts button{flex:1;border-radius:10px;padding:8px;font-size:11.5px;font-weight:700;font-family:inherit;background:#fff;cursor:pointer}'
    + '.wo-up-ed{border:1.5px solid #854F0B;color:#854F0B}.wo-up-x{border:1.5px solid #E7B4B4;color:#A32D2D}'
    + '.wo-banner.late{background:#FFF6E5;border-color:#D9A441}.wo-banner.late .wo-status{color:#854F0B}.wo-banner.late .wo-dot{background:#854F0B}'
    + '.wo-chg{display:inline-block;font-size:11.5px;font-weight:700;color:' + WO_PURPLE + ';margin-top:10px;cursor:pointer}'
    + '.wo-two{display:flex;gap:14px}.wo-two>div{flex:1;min-width:0}'
    // iPhone Safari gives date/time boxes their own minimum width, so they
    // ran past the card edge; this keeps them inside their column.
    + '.wo-input[type=date],.wo-input[type=time]{-webkit-appearance:none;appearance:none;display:block;min-width:0;max-width:100%;min-height:40px}'
    + '.wo-input::-webkit-date-and-time-value{text-align:left;margin:0}'
    + '.wo-when{font-size:11px;font-weight:600;color:#70827D;margin:-4px 0 12px;line-height:1.45}.wo-when:empty{display:none}'
    + '.wo-when.later{color:#854F0B;background:#FFF6E5;border-radius:9px;padding:7px 10px}'
    + '.wo-check{display:flex;align-items:center;gap:8px;font-size:12px;color:#111C18;margin:0 0 10px;cursor:pointer}'
    + '.wo-check input{width:16px;height:16px;margin:0;accent-color:' + WO_PURPLE + '}'
    + '.wo-dur{font-size:11px;font-weight:700;color:' + WO_PURPLE + ';background:' + WO_PURPLE_BG + ';border-radius:9px;padding:7px 10px;margin:-4px 0 10px}'
    + '.wo-edit{text-align:left;background:#fff;border:1px solid #E2ECE8;border-radius:12px;padding:12px;margin-top:10px}'
    + '.wo-edit .wo-btn{margin-top:2px}'
    + '.wo-ext{display:flex;gap:8px;align-items:stretch;margin-top:4px}'
    + '.wo-ext input{flex:1;margin:0}'
    + '.wo-ext button{flex:0 0 90px;border:none;border-radius:10px;font-size:12.5px;font-weight:700;font-family:inherit;background:#854F0B;color:#fff;cursor:pointer}'
    + '.wo-plan{display:inline-block;max-width:100%;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-top:5px;background:' + WO_PURPLE_BG + ';color:' + WO_PURPLE + '}'
    + '.wo-plan.chg{background:#FFF6E5;color:#854F0B}'
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
  if (woIsUpcoming(r)) return 0;
  var end = woEndedAt(r);
  return ((end ? end.getTime() : Date.now()) - new Date(r.time_out).getTime()) / 60000;
}
// Two letters: first letters of the first two words, or for a one-word
// name like "ShirleyT" its capitals ("ST"), else its first two letters.
function woInitials(name) {
  var words = String(name || '?').split(' ').filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join('');
  var w = words[0] || '?', caps = w.replace(/[^A-Z]/g, '');
  return (caps.length >= 2 ? caps.slice(0, 2) : w.slice(0, 2)).toUpperCase();
}
// Closing time on the day of d: 12:00 PM on Saturday, 4:30 PM otherwise.
function woClosingFor(d) {
  var c = new Date(d);
  if (c.getDay() === 6) c.setHours(12, 0, 0, 0); else c.setHours(16, 30, 0, 0);
  return c;
}
// When a "not coming back today" outing ends by itself: closing time.
function woRestEnd(r) {
  if (!r.rest_of_day) return null;
  var out = new Date(r.time_out), c = woClosingFor(out);
  return c < out ? out : c;
}
// The real end: Time In, or closing time once a rest-of-day outing passes it.
function woEndedAt(r) {
  if (r.time_in) return new Date(r.time_in);
  var e = woRestEnd(r);
  return e && Date.now() >= e.getTime() ? e : null;
}
// Planned ahead and not started yet (time_out still in the future).
function woIsUpcoming(r) { return !r.time_in && r.entry_type !== 'voided' && new Date(r.time_out).getTime() > Date.now(); }
function woIsOpen(r) { return !r.time_in && r.entry_type !== 'voided' && !woIsUpcoming(r) && !woEndedAt(r); }
function woPastBackBy(r) { return woIsOpen(r) && !r.rest_of_day && r.back_by && Date.now() > new Date(r.back_by).getTime(); }
// Build a Date from 'YYYY-MM-DD' + 'HH:MM' (device local time).
function woAt(dateStr, timeStr) {
  var p = String(timeStr || '').split(':');
  var d = new Date(dateStr + 'T00:00:00');
  d.setHours(parseInt(p[0], 10), parseInt(p[1], 10), 0, 0);
  return d;
}
function woHHMM(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function woDayName(d) {
  var key = localDateStr(d), today = localDateStr();
  var tm = new Date(); tm.setDate(tm.getDate() + 1);
  if (key === today) return 'Today';
  if (key === localDateStr(tm)) return 'Tomorrow';
  return d.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });
}
// "back by 4:00 PM" / "rest of the day" / '' -- for banners and lists.
function woBackText(r) {
  if (r.rest_of_day) return 'rest of the day';
  if (r.back_by) return 'back by ' + woClock(new Date(r.back_by));
  return '';
}
// Plain text for planned outings: "planned · on time" or
// "planned 2:30 PM · changed to 2:45 PM". '' for outings started on the spot.
function woPlanTagText(r) {
  if (!r.planned_time_out) return '';
  var p = new Date(r.planned_time_out), o = new Date(r.time_out);
  if (Math.abs(p - o) < 60000) return 'planned · on time';
  var sameDay = localDateStr(p) === localDateStr(o);
  return 'planned ' + (sameDay ? '' : woDayName(p) + ' ') + woClock(p) + ' · changed to ' + (sameDay ? '' : woDayName(o) + ' ') + woClock(o);
}
function woPlanTagHtml(r) {
  var t = woPlanTagText(r);
  if (!t) return '';
  return '<div><span class="wo-plan' + (t.indexOf('changed') !== -1 ? ' chg' : '') + '">📅 ' + escHtml(t) + '</span></div>';
}

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
    // time_out <= now: planned-ahead outings that haven't started yet aren't out.
    var rows = (await woReq('GET', 'work_outings?time_in=is.null&entry_type=neq.voided&time_out=lte.' + encodeURIComponent(new Date().toISOString()) + '&order=time_out.asc&limit=50')) || [];
    return rows.filter(woIsOpen);
  } catch (e) { return []; }
}

// Planned outings starting later today -- the Home "later today" line.
async function woFetchUpcomingToday() {
  try {
    var end = new Date(); end.setHours(23, 59, 59, 999);
    return (await woReq('GET', 'work_outings?time_in=is.null&entry_type=neq.voided&time_out=gt.' + encodeURIComponent(new Date().toISOString())
      + '&time_out=lte.' + encodeURIComponent(end.toISOString()) + '&order=time_out.asc&limit=50')) || [];
  } catch (e) { return []; }
}

// The signed-in person's own open work outing, or null. Called by the
// personal Time Out functions so nobody is out on both at once.
async function woMyOpenOuting(email) {
  if (!email) return null;
  try {
    var rows = await woReq('GET', 'work_outings?staff_email=eq.' + encodeURIComponent(email) + '&time_in=is.null&entry_type=neq.voided&time_out=lte.' + encodeURIComponent(new Date().toISOString()) + '&limit=5');
    rows = (rows || []).filter(woIsOpen);
    return rows.length ? rows[0] : null;
  } catch (e) { return null; }
}

// The purple line under the Home "Currently Out" names, plus an amber one
// for outings planned for later today.
function woHomeLineHtml(workRows, upcomingRows) {
  var html = '';
  woInjectStyles(); // Home can render before the Time Off screen ever loads
  if (workRows && workRows.length) {
    var names = workRows.map(function (r) {
      var back = r.rest_of_day ? ' (away rest of day)' : (r.back_by ? ' (back ~' + woClock(new Date(r.back_by)) + ')' : '');
      return woName(r) + back;
    }).join(', ');
    html += '<span class="wo-mini">💼 Out for work · ' + escHtml(names) + '</span>';
  }
  if (upcomingRows && upcomingRows.length) {
    var later = upcomingRows.map(function (r) { return woName(r) + ' ' + woClock(new Date(r.time_out)); }).join(', ');
    html += (html ? '<br>' : '') + '<span class="wo-mini" style="background:#FFF6E5;color:#854F0B;">📅 Out for work later today · ' + escHtml(later) + '</span>';
  }
  return html;
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
  await woTidyMine();
  var mine = woMyOpen();
  woSetWorkPillLabel(!!mine);
  // Opening Time Off while out for work lands on the Work side -- once per
  // outing, so tapping back to Personal isn't undone by the next refresh.
  if (mine && !woState.autoSwitched[mine.id]) {
    woState.autoSwitched[mine.id] = true;
    woSwitchKind('work');
  }
  // Opened from a reminder notification (?open=work / ?open=work-change).
  var deep = woState.deepLink;
  if (deep) { woState.deepLink = ''; woSwitchKind('work'); }
  // "Starts in 10 minutes" opens the Change panel of the next planned one.
  var target = mine || woMyUpcoming()[0];
  if (deep === 'work-change' && target) woState.editing[target.id] = true;
  woRender();
}

// Housekeeping on the signed-in person's own rows, so the record is right
// even before the server-side reminder job catches up:
//  - a "not coming back today" outing past closing time gets its Time In
//  - a planned outing that started while an earlier one was still open ends
//    the earlier one at that moment (they went straight from one to the next)
async function woTidyMine() {
  var mineRows = woState.rows.filter(function (r) {
    return (r.staff_email || '').toLowerCase() === woState.myEmailLow && !r.time_in && r.entry_type !== 'voided' && !woIsUpcoming(r);
  }).sort(function (a, b) { return new Date(a.time_out) - new Date(b.time_out); });
  var patches = [];
  mineRows.forEach(function (r, i) {
    var end = woEndedAt(r);
    var next = mineRows[i + 1];
    if (next && (!end || new Date(next.time_out) < end)) end = new Date(next.time_out);
    if (!end) return;
    var mins = Math.max(0, Math.round((end - new Date(r.time_out)) / 60000));
    r.time_in = end.toISOString(); r.duration_minutes = mins;
    patches.push(woReq('PATCH', 'work_outings?id=eq.' + r.id + '&time_in=is.null', { time_in: r.time_in, duration_minutes: mins }).catch(function () {}));
  });
  if (patches.length) await Promise.all(patches);
}

function woMyOpen() {
  return woState.rows.find(function (r) { return woIsOpen(r) && (r.staff_email || '').toLowerCase() === woState.myEmailLow; }) || null;
}
function woMyUpcoming() {
  return woState.rows.filter(function (r) { return woIsUpcoming(r) && (r.staff_email || '').toLowerCase() === woState.myEmailLow; })
    .sort(function (a, b) { return new Date(a.time_out) - new Date(b.time_out); });
}

// Re-render by itself when the next thing changes on screen: a planned
// outing starting, a back-by time passing, or closing time for rest-of-day.
var woTick = null;
function woScheduleTick() {
  if (woTick) { clearTimeout(woTick); woTick = null; }
  var now = Date.now(), next = Infinity;
  woState.rows.forEach(function (r) {
    if (r.time_in || r.entry_type === 'voided') return;
    [new Date(r.time_out).getTime(), r.back_by ? new Date(r.back_by).getTime() : 0, r.rest_of_day ? woRestEnd(r).getTime() : 0].forEach(function (t) {
      if (t > now && t < next) next = t;
    });
  });
  if (next === Infinity || next - now > 12 * 3600e3) return;
  woTick = setTimeout(function () {
    if (document.getElementById('to-work-panel')) woLoad();
  }, next - now + 1500);
}

// The Back by / "not coming back today" fields, shared by the new-outing
// form and the Change panels. prefix: 'wo' or 'wo-ed-<id>'.
function woBackFieldsHtml(prefix, r) {
  var back = r && r.back_by ? woHHMM(new Date(r.back_by)) : '';
  var rest = !!(r && r.rest_of_day);
  return '<div class="wo-lbl">Back by <span style="text-transform:none;font-weight:500;">(optional)</span></div>'
    + '<input class="wo-input" type="time" id="' + prefix + '-backby" value="' + back + '"' + (rest ? ' disabled' : '') + ' oninput="woUpdateDurHint(\'' + prefix + '\')">'
    + '<div class="wo-dur" id="' + prefix + '-dur" style="display:none;"></div>'
    + '<label class="wo-check"><input type="checkbox" id="' + prefix + '-rest"' + (rest ? ' checked' : '') + ' onchange="woToggleRest(\'' + prefix + '\')">Not coming back to the office today</label>';
}

function woRender() {
  var panel = document.getElementById('to-work-panel');
  if (!panel) return;
  // A refresh (pull-to-refresh, or the timer when an outing starts) must
  // not wipe what someone is in the middle of typing.
  // (After a save, woAfterChange() asks for a clean form instead.)
  var kept = {};
  if (!woState.resetForm) {
    panel.querySelectorAll('input[id]').forEach(function (el) {
      if (el.dataset && el.dataset.auto === '1') return; // still "now": show the new now
      kept[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
  }
  woState.resetForm = false;
  var mine = woMyOpen();
  var upcoming = woMyUpcoming();
  var html = '';

  if (mine) {
    var out = new Date(mine.time_out);
    var late = woPastBackBy(mine);
    var timeLine = 'Out since ' + woClock(out) + (mine.planned_time_out && Math.abs(new Date(mine.planned_time_out) - out) < 60000 ? ' (as planned)' : '');
    if (mine.rest_of_day) timeLine += ' · rest of the day';
    else if (mine.back_by) {
      var left = (new Date(mine.back_by) - Date.now()) / 60000;
      timeLine += ' · back by ' + woClock(new Date(mine.back_by)) + (left > 0 ? ' · ' + woDur(left) + ' left' : '');
    } else timeLine += ' · ' + woDur(woMinutes(mine)) + ' so far';
    html += '<div class="wo-banner' + (late ? ' late' : '') + '">'
      + '<div class="wo-status"><span class="wo-dot"></span>' + (late ? 'PAST YOUR BACK-BY TIME' : 'YOU\'RE OUT FOR WORK') + '</div>'
      + '<div class="wo-purpose">' + escHtml(mine.purpose) + '</div>'
      + '<div class="wo-time">' + escHtml(timeLine) + '</div>'
      + (late ? '' : '<div class="wo-free">💼 Not charged to your Time Off</div>')
      + '<button class="wo-btn green" onclick="woTimeIn(' + mine.id + ')">✓ I\'m Back — Time In</button>'
      + (late
        ? '<div class="wo-lbl" style="text-align:left;margin-top:12px;">Need more time? New back-by time</div>'
          + '<div class="wo-ext"><input class="wo-input" type="time" id="wo-extend-' + mine.id + '"><button onclick="woExtend(' + mine.id + ')">Update</button></div>'
        : '')
      + '<div><span class="wo-chg" onclick="woShowEdit(' + mine.id + ')">✎ ' + (mine.planned_time_out ? 'Left at a different time? Change it' : 'Change back-by time') + '</span></div>'
      + '<div id="wo-edit-' + mine.id + '"></div>'
      // Only admins / Time Off editors can cancel an outing that wasn't
      // planned -- staff just tap I'm Back (an accidental tap is a few
      // minutes, never charged). A planned one can be cancelled in Change.
      + (woCanManage() ? '<div><span class="wo-mistake" onclick="woCancel(' + mine.id + ')">✕ Started this by mistake? Cancel it</span></div>' : '')
      + '</div>';
  }

  upcoming.forEach(function (r) {
    var o = new Date(r.time_out);
    var when = woDayName(o).toUpperCase() + ' ' + woClock(o) + (r.back_by && !r.rest_of_day ? ' – ' + woClock(new Date(r.back_by)) : '');
    html += '<div class="wo-up">'
      + '<div class="wo-up-st">📅 UPCOMING · ' + escHtml(when) + '</div>'
      + '<div class="wo-purpose">' + escHtml(r.purpose) + '</div>'
      + '<div class="wo-up-tm">Starts by itself ' + (woDayName(o) === 'Today' ? '' : woDayName(o) === 'Tomorrow' ? 'tomorrow ' : 'on ' + woDayName(o) + ' ') + 'at ' + woClock(o) + (r.rest_of_day ? ' · rest of the day' : '') + '</div>'
      + '<div class="wo-up-acts"><button class="wo-up-ed" onclick="woShowEdit(' + r.id + ')">✎ Change</button><button class="wo-up-x" onclick="woCancelPlanned(' + r.id + ')">✕ Cancel</button></div>'
      + '<div id="wo-edit-' + r.id + '"></div>'
      + '</div>';
  });

  if (!mine) {
    var today = localDateStr();
    html += '<div class="wo-card">'
      + '<div class="wo-lbl">Where to &amp; what for</div>'
      + '<input class="wo-input" id="wo-purpose" maxlength="200" placeholder="e.g. Public Bank — company deposit">'
      + '<div class="wo-hint">💼 For Company errands only. Doesn\'t use your 4h Time Off.</div>'
      // One form for now, earlier today or later: Date starts at today and
      // Time Out at the current time (kept ticking until the staff member
      // changes it). A later date/time is simply saved as planned.
      + '<div class="wo-two"><div><div class="wo-lbl">Date</div><input class="wo-input" type="date" id="wo-new-date" min="' + today + '" value="' + today + '" oninput="woFormChanged(\'date\')"></div>'
      + '<div><div class="wo-lbl">Time Out</div><input class="wo-input" type="time" id="wo-new-time" data-auto="1" value="' + woHHMM(new Date()) + '" oninput="woFormChanged(\'time\')"></div></div>'
      + '<div class="wo-when" id="wo-when"></div>'
      + woBackFieldsHtml('wo', null)
      + '<button class="wo-btn" id="wo-go-btn" onclick="woSubmitNew()">💼 Time Out for Work</button>'
      + '</div>';
  }

  // Everyone out for work right now -- visible to all staff.
  var openRows = woState.rows.filter(woIsOpen).sort(function (a, b) { return new Date(a.time_out) - new Date(b.time_out); });
  html += '<div class="wo-sec"><span class="wo-dot"></span>Out for work right now' + (openRows.length ? ' · ' + openRows.length : '') + '</div>';
  if (openRows.length) {
    html += '<div class="wo-now">' + openRows.map(function (r) {
      var isMe = (r.staff_email || '').toLowerCase() === woState.myEmailLow;
      var back = woBackText(r);
      return '<div class="wo-pr"><div class="wo-av">' + escHtml(woInitials(woName(r))) + '</div>'
        + '<div style="min-width:0;flex:1;"><div class="wo-nm">' + escHtml(woName(r)) + (isMe ? ' <span style="color:#70827D;font-weight:500;">(you)</span>' : '') + '</div>'
        + '<div class="wo-sub">' + escHtml(r.purpose) + '</div>'
        + '<div class="wo-sub">Since ' + woClock(new Date(r.time_out)) + ' · ' + (back ? escHtml(back) : woDur(woMinutes(r)) + ' so far') + '</div></div>'
        + '<span class="wo-tag out">Out</span></div>';
    }).join('') + '</div>';
  } else {
    html += '<div class="wo-now-empty">No one is out for work right now.</div>';
  }

  // Planned for later today -- everyone's, so colleagues know in advance.
  var endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  var laterRows = woState.rows.filter(function (r) { return woIsUpcoming(r) && new Date(r.time_out) <= endOfDay; })
    .sort(function (a, b) { return new Date(a.time_out) - new Date(b.time_out); });
  if (laterRows.length) {
    html += '<div class="wo-sec" style="color:#854F0B;"><span class="wo-dot" style="background:#854F0B;"></span>Out for work later today · ' + laterRows.length + '</div>'
      + '<div class="wo-now" style="border-color:#D9A441;">' + laterRows.map(function (r) {
        var isMe = (r.staff_email || '').toLowerCase() === woState.myEmailLow;
        var o = new Date(r.time_out);
        var span = woClock(o) + (r.rest_of_day ? ' · rest of the day' : (r.back_by ? ' – ' + woClock(new Date(r.back_by)) : ''));
        return '<div class="wo-pr"><div class="wo-av" style="background:#FFF6E5;color:#854F0B;">' + escHtml(woInitials(woName(r))) + '</div>'
          + '<div style="min-width:0;flex:1;"><div class="wo-nm">' + escHtml(woName(r)) + (isMe ? ' <span style="color:#70827D;font-weight:500;">(you)</span>' : '') + '</div>'
          + '<div class="wo-sub">' + escHtml(r.purpose) + '</div>'
          + '<div class="wo-sub">' + escHtml(span) + '</div></div>'
          + '<span class="wo-tag" style="background:#FFF6E5;color:#854F0B;">Later</span></div>';
      }).join('') + '</div>';
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
  Object.keys(woState.editing).forEach(function (id) {
    if (document.getElementById('wo-edit-' + id)) woShowEdit(parseInt(id, 10)); else delete woState.editing[id];
  });
  Object.keys(kept).forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') { el.checked = kept[id]; if (id.slice(-5) === '-rest') woToggleRest(id.slice(0, -5)); }
    else if (!el.disabled) { el.value = kept[id]; if (id === 'wo-new-time') delete el.dataset.auto; }
  });
  woFormChanged();
  woScheduleTick();
  woStartClock();
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
    if (woIsUpcoming(r)) return false; // shown as Upcoming / later today instead
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
  var ended = woEndedAt(r);
  var sub = woClock(out) + ' → ' + (ended ? woClock(ended) : 'still out')
    + (r.rest_of_day ? ' · rest of the day' : (open && r.back_by ? ' · back by ' + woClock(new Date(r.back_by)) : ''))
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
    + woPlanTagHtml(r)
    + (typeof tiRemarkLineHtml === 'function' ? tiRemarkLineHtml(r) : '')
    + (acts ? '<div class="wo-acts">' + acts + '</div>' : '')
    + '<div id="wo-fix-' + r.id + '"></div>'
    + '</div>';
}

// ── actions ──
// The new-outing form's Date + Time Out, or null if incomplete. While the
// time hasn't been touched (data-auto) and the date is today, that's "now"
// to the second.
function woNewTimeOut() {
  var d = document.getElementById('wo-new-date'), t = document.getElementById('wo-new-time');
  if (!d || !t || !d.value || !t.value) return null;
  if (t.dataset.auto === '1' && d.value === localDateStr()) return new Date();
  return woAt(d.value, t.value);
}
function woIsLater(d) { return !!d && d.getTime() > Date.now() + 60000; }
// Called whenever Date or Time Out changes (what: 'date' | 'time'), and
// after each render / clock tick: updates the button and the line under
// the fields.
function woFormChanged(what) {
  var dEl = document.getElementById('wo-new-date'), tEl = document.getElementById('wo-new-time');
  if (!dEl || !tEl) return;
  // Once they pick the time themselves -- or another day -- it stops
  // following the clock.
  if (what === 'time' || (what === 'date' && dEl.value !== localDateStr())) delete tEl.dataset.auto;
  var d = woNewTimeOut(), later = woIsLater(d);
  var btn = document.getElementById('wo-go-btn');
  if (btn) btn.innerHTML = later ? '📅 Plan Work Outing' : '💼 Time Out for Work';
  var when = document.getElementById('wo-when');
  if (when) {
    var txt = '';
    if (!d) txt = '';
    else if (later) {
      var day = woDayName(d);
      txt = '📅 Starts by itself ' + (day === 'Today' ? 'today' : day === 'Tomorrow' ? 'tomorrow' : 'on ' + day) + ' at ' + woClock(d) + '.'
        + (d.getTime() - Date.now() >= 10 * 60000 ? ' You\'ll get a reminder 10 minutes before.' : '');
    } else if (tEl.dataset.auto === '1' || Date.now() - d.getTime() < 60000) txt = '🕑 Leaving now';
    else txt = '🕑 Left earlier, at ' + woClock(d);
    when.textContent = txt;
    when.className = 'wo-when' + (later ? ' later' : '');
  }
  woUpdateDurHint('wo');
}
// Keeps an untouched Time Out showing the current time.
var woClockTimer = null;
function woStartClock() {
  if (woClockTimer) return;
  woClockTimer = setInterval(function () {
    var t = document.getElementById('wo-new-time');
    if (!document.getElementById('to-work-panel')) { clearInterval(woClockTimer); woClockTimer = null; return; }
    if (!t) return;
    if (t.dataset.auto === '1') {
      var now = woHHMM(new Date());
      if (t.value !== now) t.value = now;
    }
    woFormChanged();
  }, 15000);
}
function woToggleRest(prefix) {
  var rest = document.getElementById(prefix + '-rest'), back = document.getElementById(prefix + '-backby');
  if (back) { back.disabled = !!(rest && rest.checked); if (back.disabled) back.value = ''; }
  woUpdateDurHint(prefix);
}
// The time out the Back by hint measures from, for a form prefix.
function woFormTimeOut(prefix) {
  if (prefix === 'wo') return woNewTimeOut();
  var id = parseInt(prefix.replace('wo-ed-', ''), 10);
  var r = woState.rows.find(function (x) { return x.id === id; });
  var dEl = document.getElementById(prefix + '-date'), tEl = document.getElementById(prefix + '-time');
  if (!r) return null;
  if (tEl && tEl.value) return woAt(dEl && dEl.value ? dEl.value : localDateStr(new Date(r.time_out)), tEl.value);
  return new Date(r.time_out);
}
// "⏱ That's 1h 30m out" under Back by.
function woUpdateDurHint(prefix) {
  var box = document.getElementById(prefix + '-dur');
  var back = document.getElementById(prefix + '-backby');
  if (!box) return;
  var out = woFormTimeOut(prefix);
  if (!back || !back.value || !out) { box.style.display = 'none'; return; }
  var b = woAt(localDateStr(out), back.value);
  box.style.display = 'block';
  box.textContent = b > out ? '⏱ That\'s ' + woDur((b - out) / 60000) + ' out' : '⚠ Back by has to be after the time out (' + woClock(out) + ').';
}
// Reads Back by / "not coming back today" for an outing starting at
// timeOut. Returns {} (nothing set), the fields to save, or null after an alert.
function woReadBackFields(prefix, timeOut) {
  var back = document.getElementById(prefix + '-backby'), rest = document.getElementById(prefix + '-rest');
  if (rest && rest.checked) {
    if (woClosingFor(timeOut) <= timeOut) { alert('That\'s already after closing time (' + woClock(woClosingFor(timeOut)) + '), so "Not coming back to the office today" doesn\'t apply.'); return null; }
    return { rest_of_day: true, back_by: null };
  }
  if (back && back.value) {
    var b = woAt(localDateStr(timeOut), back.value);
    if (b <= timeOut) { alert('Back by has to be after the time out (' + woClock(timeOut) + ').'); return null; }
    return { back_by: b.toISOString(), rest_of_day: false };
  }
  return { back_by: null, rest_of_day: false };
}
// New columns only go in when used, so outings keep working the old way
// until docs/work-outings-plan-ahead.sql has been run.
function woNewColsMissing(e) { return e && (e.code === 'PGRST204' || e.code === '42703'); }
var WO_NOT_SET_UP = 'Planning ahead and Back by aren\'t switched on yet.' + '\n\nPlease ask an admin to run docs/work-outings-plan-ahead.sql in Supabase.';

// The one button: a later date/time is planned (starts by itself), now or
// earlier today starts the outing straight away.
async function woSubmitNew() {
  var d = woNewTimeOut();
  if (!d) { alert('Please choose a date and time.'); return; }
  if (localDateStr(d) < localDateStr()) { alert('Please pick today or a later day.'); return; }
  if (woIsLater(d)) { await woPlan(d); return; }
  await woStart(d.getTime() > Date.now() ? new Date() : d);
}

async function woPlan(timeOutDate) {
  var me = woMe();
  if (!me.email) return;
  var el = document.getElementById('wo-purpose');
  var purpose = el ? el.value.trim() : '';
  if (!purpose) { alert('Please say where you\'re going and what for.'); return; }
  if (timeOutDate.getTime() - Date.now() > 120 * 24 * 3600e3) { alert('You can plan up to 4 months ahead.'); return; }
  var extra = woReadBackFields('wo', timeOutDate);
  if (!extra) return;
  var body = { staff_name: me.name || me.email, staff_email: me.email, purpose: purpose, time_out: timeOutDate.toISOString(), planned_time_out: timeOutDate.toISOString() };
  if (extra.back_by) body.back_by = extra.back_by;
  if (extra.rest_of_day) body.rest_of_day = true;
  try {
    await woReq('POST', 'work_outings', body);
    woAfterChange();
  } catch (e) {
    alert(woNewColsMissing(e) ? WO_NOT_SET_UP : woIsMissingTable(e) ? 'Out for Work isn\'t switched on yet. Please ask an admin.' : 'Could not plan your work outing. Please try again.');
  }
}

// ✎ Change: an upcoming outing (date, time out, back by) or the one you're
// out on now (time out if it was planned, back by).
function woShowEdit(id) {
  var r = woState.rows.find(function (x) { return x.id === id; });
  var box = document.getElementById('wo-edit-' + id);
  if (!r || !box) return;
  if (box.innerHTML) { box.innerHTML = ''; delete woState.editing[id]; return; }
  woState.editing[id] = true;
  var pre = 'wo-ed-' + id, o = new Date(r.time_out), up = woIsUpcoming(r);
  var html = '<div class="wo-edit">';
  if (up) {
    html += '<div class="wo-two"><div><div class="wo-lbl">Date</div><input class="wo-input" type="date" id="' + pre + '-date" min="' + localDateStr() + '" value="' + localDateStr(o) + '" oninput="woUpdateDurHint(\'' + pre + '\')"></div>'
      + '<div><div class="wo-lbl">Time out</div><input class="wo-input" type="time" id="' + pre + '-time" value="' + woHHMM(o) + '" oninput="woUpdateDurHint(\'' + pre + '\')"></div></div>';
  } else if (r.planned_time_out) {
    html += '<div class="wo-lbl">When did you actually leave?</div>'
      + '<input class="wo-input" type="time" id="' + pre + '-time" value="' + woHHMM(o) + '" oninput="woUpdateDurHint(\'' + pre + '\')">'
      + '<div style="font-size:10.5px;color:#70827D;margin:-4px 0 10px;line-height:1.45;">Planned for ' + woClock(new Date(r.planned_time_out)) + '. Not left yet? Put a later time and it goes back to Upcoming.</div>';
  }
  html += woBackFieldsHtml(pre, r)
    + '<button class="wo-btn" onclick="woSaveEdit(' + id + ')">Save</button>'
    + (!up && r.planned_time_out ? '<div style="text-align:center;"><span class="wo-mistake" onclick="woCancelPlanned(' + id + ')">✕ Didn\'t go? Cancel this outing</span></div>' : '')
    + '</div>';
  box.innerHTML = html;
  woUpdateDurHint(pre);
}

async function woSaveEdit(id) {
  var r = woState.rows.find(function (x) { return x.id === id; });
  if (!r) return;
  var pre = 'wo-ed-' + id, up = woIsUpcoming(r);
  var tEl = document.getElementById(pre + '-time'), dEl = document.getElementById(pre + '-date');
  var out = new Date(r.time_out);
  if (tEl) {
    if (!tEl.value || (dEl && !dEl.value)) { alert('Please choose a date and time.'); return; }
    out = woAt(dEl ? dEl.value : localDateStr(out), tEl.value);
    if (localDateStr(out) < localDateStr()) { alert('Please pick today or a later day.'); return; }
  }
  var extra = woReadBackFields(pre, out);
  if (!extra) return;
  var patch = { back_by: extra.back_by, rest_of_day: extra.rest_of_day };
  var oldBack = r.back_by ? new Date(r.back_by).getTime() : null, newBack = extra.back_by ? new Date(extra.back_by).getTime() : null;
  if (oldBack !== newBack) patch.back_by_notified_at = null; // remind again at the new time
  if (tEl && Math.abs(out - new Date(r.time_out)) >= 60000) {
    patch.time_out = out.toISOString();
    if (out.getTime() > Date.now()) patch.start_notified_at = null; // moved later: remind when it starts
    else if (!r.start_notified_at) patch.start_notified_at = new Date().toISOString(); // already fixed by hand
  }
  try {
    await woReq('PATCH', 'work_outings?id=eq.' + id + '&time_in=is.null', patch);
    delete woState.editing[id];
    woAfterChange();
  } catch (e) { alert(woNewColsMissing(e) ? WO_NOT_SET_UP : 'Could not save the change. Please try again.'); }
}

// Past the back-by time: set a new one in one step.
async function woExtend(id) {
  var r = woState.rows.find(function (x) { return x.id === id; });
  var input = document.getElementById('wo-extend-' + id);
  if (!r || !input) return;
  if (!input.value) { alert('Please choose the new back-by time.'); return; }
  var b = woAt(localDateStr(), input.value);
  if (b.getTime() <= Date.now()) { alert('The new back-by time has to be later than now.'); return; }
  try {
    await woReq('PATCH', 'work_outings?id=eq.' + id + '&time_in=is.null', { back_by: b.toISOString(), back_by_notified_at: null });
    woAfterChange();
  } catch (e) { alert(woNewColsMissing(e) ? WO_NOT_SET_UP : 'Could not update the back-by time. Please try again.'); }
}

// A planned outing that's cancelled (or didn't happen) leaves no record.
async function woCancelPlanned(id) {
  var r = woState.rows.find(function (x) { return x.id === id; });
  if (!r || r.time_in || !r.planned_time_out) return;
  if ((r.staff_email || '').toLowerCase() !== woState.myEmailLow && !woCanManage()) return;
  if (!confirm('Cancel this planned work outing?\n\n' + r.purpose + '\n\nNothing will be recorded.')) return;
  try {
    await woReq('DELETE', 'work_outings?id=eq.' + id + '&time_in=is.null');
    delete woState.editing[id];
    woAfterChange();
  } catch (e) { alert('Could not cancel this work outing. Please try again.'); }
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
    var extra = woReadBackFields('wo', timeOutDate);
    if (!extra) return;
    var body = { staff_name: me.name || me.email, staff_email: me.email, purpose: purpose, time_out: timeOutDate.toISOString() };
    if (extra.back_by) body.back_by = extra.back_by;
    if (extra.rest_of_day) body.rest_of_day = true;
    await woReq('POST', 'work_outings', body);
    woAfterChange();
  } catch (e) {
    alert(woNewColsMissing(e) ? WO_NOT_SET_UP : woIsMissingTable(e) ? 'Out for Work isn\'t switched on yet. Please ask an admin.' : 'Could not start your work outing. Please try again.');
  }
}

async function woTimeIn(id) {
  // Optional remark first (js/time-in-remark.js) -- null means Cancel.
  var remark = typeof tiAskRemark === 'function' ? await tiAskRemark() : '';
  if (remark === null) return;
  try {
    var rows = await woReq('GET', 'work_outings?id=eq.' + id);
    var r = rows && rows[0];
    if (!r) return;
    if (r.time_in) { woAfterChange(); return; }
    var timeIn = new Date();
    var mins = Math.max(0, Math.round((timeIn - new Date(r.time_out)) / 60000));
    // time_in=is.null guard: a second tap (or another device) can't
    // overwrite the first Time In.
    var tiPatch = { time_in: timeIn.toISOString(), duration_minutes: mins };
    if (typeof tiPatchWithRemark === 'function') await tiPatchWithRemark(function (p) { return woReq('PATCH', 'work_outings?id=eq.' + id + '&time_in=is.null', p); }, tiPatch, remark);
    else await woReq('PATCH', 'work_outings?id=eq.' + id + '&time_in=is.null', tiPatch);
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
  woState.resetForm = true;
  if (woIsAdminPage()) {
    woLoad();
    if (typeof loadAdminLeaveDuty === 'function') loadAdminLeaveDuty();
  } else if (typeof loadTimeOff === 'function') {
    loadTimeOff(); // reloads the Home card and calls woLoad() itself
  } else {
    woLoad();
  }
}

// ── opened from a reminder notification ──
// The work-outing-reminders Edge Function's notifications open
// ?open=work (back-by reminder) or ?open=work-change ("starts in 10 minutes:
// running late or not going?"). Runs after each page's own start-up (which restores
// the last tab), then goes to Time Off → 💼 Work.
(function () {
  var m = /[?&]open=(work-change|work)\b/.exec(window.location.search);
  if (!m) return;
  woState.deepLink = m[1];
  try { history.replaceState(history.state, '', window.location.pathname + window.location.hash); } catch (e) {}
  window.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      if (woIsAdminPage()) { if (typeof switchTabByName === 'function') switchTabByName('timeoff'); }
      else if (typeof switchNav === 'function') { switchNav('timeoff'); if (typeof loadTimeOff === 'function') loadTimeOff(); }
    }, 0);
  });
})();
