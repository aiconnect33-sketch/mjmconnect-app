// ── duty-plan.js — Duty Roster plans ──
// Shared by index.html (js/tab-duty.js) and admin.html. Each duty role can
// have a plan, of one of two kinds:
//   * "Same month every year" -- who's on duty in each calendar month.
//   * "Take turns in order"   -- groups take one month each, in order, from
//     a start month; after the last turn it starts again from Turn 1
//     (docs/duty-turns-plan.sql; plan rows' month = turn number).
// The database function ensure_duty_plan() keeps duty_roster filled in for
// this month + the next 2 from the plan, so everything that reads
// duty_roster keeps working unchanged. This file adds the plan editor (and
// its "See all turns" table), the "🔁" line for editors, and the "Show full
// year" view, which also shows the plan's later months that haven't been
// filled in yet.
//
// Relies on the page's SURL / SKEY / escHtml / localDateStr globals and on
// each page defining dutyPlanAfterChange() (re-load its duty list).

var dutyPlan = {};           // role -> { 1: [{name, email}], ..., 12: [...] } (month, or turn number)
var dutyPlanSettings = {};   // role -> { type: 'yearly'|'turns', start: 'YYYY-MM-01', turns: n }
var dutyPlanSettingsOk = false; // duty_plan_settings exists (docs/duty-turns-plan.sql has been run)
var DUTY_PLAN_MAX_TURNS = 60;
var dutyPlanGenerated = {};  // role -> { 'YYYY-MM-01': true } months already filled in
var dutyPlanEnsuredAt = 0;
var DUTY_PLAN_NEAR_MONTHS = 3;   // this month + next 2 show by default
var DUTY_PLAN_YEAR_MONTHS = 12;  // "Show full year"
var dpDraft = null;              // the plan being edited
var dpStaff = [];                // [{name, email}] for the editor's pickers
var dpRoles = [];

(function dutyPlanInjectStyles() {
  if (document.getElementById('dp-styles')) return;
  var css = ''
    + '#duty-plan-panel{display:none;background:#fff;border:1px solid #E2ECE8;border-radius:16px;padding:14px;margin:10px 0 12px}'
    + '.dp-title{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700;color:#111C18;margin-bottom:10px}'
    + '.dp-x{background:none;border:none;font-size:20px;line-height:1;color:#9AABA3;cursor:pointer;padding:0 2px}'
    + '.dp-lbl{font-size:10.5px;font-weight:700;color:#70827D;letter-spacing:.4px;text-transform:uppercase;margin:0 0 5px}'
    + '.dp-sel{width:100%;box-sizing:border-box;border:1px solid #D5DEDA;border-radius:10px;padding:9px 10px;font-size:13px;font-family:inherit;background:#fff;color:#111C18;margin-bottom:12px}'
    + '.dp-help{font-size:11px;color:#70827D;line-height:1.45;margin:-4px 0 10px}'
    + '.dp-months{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}'
    + '.dp-m{display:flex;align-items:flex-start;gap:8px;border:1px solid #E2ECE8;border-radius:10px;padding:6px 8px;background:#FAFCFB}'
    + '.dp-m.now{background:#E1F5EE;border-color:#A9DCC9}'
    + '.dp-mn{width:30px;flex-shrink:0;font-size:11px;font-weight:800;color:#4B5A54;padding-top:5px}'
    + '.dp-chips{display:flex;flex-wrap:wrap;gap:4px;flex:1;min-width:0}'
    + '.dp-chip{display:inline-flex;align-items:center;gap:4px;background:#fff;border:1px solid #E2ECE8;border-radius:20px;padding:3px 4px 3px 9px;font-size:11.5px;color:#111C18}'
    + '.dp-chip button{border:none;background:#F1F4F3;color:#70827D;width:16px;height:16px;border-radius:50%;font-size:10px;line-height:1;cursor:pointer;padding:0}'
    + '.dp-add{border:1px dashed #A9C4BA;border-radius:20px;padding:3px 6px;font-size:11.5px;font-family:inherit;color:#0F6E5C;background:#fff;max-width:150px}'
    + '.dp-note{font-size:10.5px;color:#70827D;margin:0 0 12px;line-height:1.45}'
    + '.dp-row{display:flex;gap:8px}'
    + '.dp-btn{flex:1;border-radius:10px;padding:10px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer}'
    + '.dp-save{background:#0F6E5C;color:#fff;border:none}'
    + '.dp-cancel{background:#fff;color:#70827D;border:1px solid #D5DEDA}'
    + '.dp-stop{display:block;margin:10px auto 0;background:none;border:none;color:#A32D2D;font-size:11.5px;font-weight:600;font-family:inherit;cursor:pointer}'
    + '.dp-err{font-size:11px;color:#A32D2D;margin:-4px 0 8px;display:none}'
    + '.dp-rot{display:flex;align-items:center;gap:6px;margin:-6px 14px 10px 33px;font-size:11px;font-weight:600;color:#185FA5}'
    + '.dp-rot button{margin-left:auto;background:none;border:none;color:#70827D;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;padding:0}'
    + '.dp-crow{font-size:11.5px;color:#111C18;padding:6px 0 2px;line-height:1.45}'
    + '.dp-more{display:block;width:calc(100% + 47px);margin:12px -14px -12px -33px;padding:10px;text-align:center;font-size:12px;font-weight:700;color:#0F6E5C;background:#FAFCFB;border:none;border-top:1px solid #EEF2F0;font-family:inherit;cursor:pointer}'
    + '.dp-more span{font-weight:500;color:#70827D}'
    + '.dp-seg{display:flex;background:#fff;border:1px solid #D5DEDA;border-radius:10px;padding:3px;gap:3px;margin-bottom:12px}'
    + '.dp-seg button{flex:1;border:none;background:none;border-radius:7px;padding:7px 4px;font-size:11.5px;font-weight:700;font-family:inherit;color:#70827D;cursor:pointer}'
    + '.dp-seg button.on{background:#0F6E5C;color:#fff}'
    + '.dp-turn{border:1px solid #E2ECE8;border-radius:10px;padding:6px 8px;background:#FAFCFB}'
    + '.dp-turn.now{background:#E1F5EE;border-color:#A9DCC9}'
    + '.dp-th{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#4B5A54;margin-bottom:5px}'
    + '.dp-th small{font-weight:600;color:#70827D;font-size:10.5px}'
    + '.dp-tb{display:flex;gap:2px;flex-shrink:0}'
    + '.dp-tb button{border:none;background:#F1F4F3;color:#4B5A54;width:22px;height:22px;border-radius:6px;font-size:11px;line-height:1;cursor:pointer;padding:0;font-family:inherit}'
    + '.dp-tb button:disabled{opacity:.35;cursor:default}'
    + '.dp-addturn{display:block;width:100%;border:1.5px dashed #A9C4BA;border-radius:10px;padding:8px;background:#fff;font-size:12px;font-weight:700;font-family:inherit;color:#0F6E5C;cursor:pointer;margin-bottom:10px}'
    + '.dp-sum{background:#EEEDFE;border-radius:10px;padding:8px 10px;font-size:11.5px;color:#534AB7;margin-bottom:10px;line-height:1.5}'
    + '.dp-sum b{color:#3C3489}'
    + '.dp-all{display:block;width:100%;border:1px solid #D5DEDA;border-radius:10px;padding:9px;background:#fff;font-size:12px;font-weight:700;font-family:inherit;color:#0F6E5C;cursor:pointer;margin-bottom:10px}'
    + '.dp-search{width:100%;box-sizing:border-box;border:1px solid #D5DEDA;border-radius:10px;padding:8px 10px;font-size:13px;font-family:inherit;margin-bottom:8px}'
    + '.dp-tbl{border:1px solid #E2ECE8;border-radius:12px;overflow:hidden;margin-bottom:10px}'
    + '.dp-tr{padding:7px 10px;font-size:11.5px}'
    + '.dp-tr+.dp-tr{border-top:1px solid #EEF2F0}'
    + '.dp-tr.now{background:#E1F5EE}'
    + '.dp-trd{display:grid;grid-template-columns:30px 1fr 1fr 1fr;gap:4px;align-items:center}'
    + '.dp-trd .past{color:#9AABA3}'
    + '.dp-trn{font-size:11px;color:#4B5A54;margin:3px 0 0 34px;line-height:1.4}'
    + '.dp-tr.hd{background:#F1F4F3;font-size:9.5px;font-weight:700;color:#70827D;text-transform:uppercase;letter-spacing:.3px}'
    + '.dp-round{display:flex;align-items:center;gap:6px;margin:10px -14px 0 -33px;padding:7px 14px 7px 33px;background:#EEEDFE;color:#534AB7;font-size:11px;font-weight:800}'
    + '.dp-round.first{margin-top:0}'
    + '.dp-changed{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:#FAEEDA;color:#854F0B;white-space:nowrap}';
  var s = document.createElement('style');
  s.id = 'dp-styles';
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
})();

function dutyPlanCanEdit() {
  // Staff app: Duty Roster edit permission. Admin app: every admin.
  return typeof hasEditPermission === 'function' ? hasEditPermission('duty') : true;
}

function dpHeaders(extra) {
  var h = { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY, 'Content-Type': 'application/json' };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}
async function dpFetch(method, path, body, prefer) {
  var res = await fetch(SURL + '/rest/v1/' + path, { method: method, headers: dpHeaders(prefer ? { 'Prefer': prefer } : null), body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    var detail = '';
    try { var e = await res.json(); detail = e.message || e.hint || ''; } catch (x) {}
    throw new Error('Request failed: ' + res.status + (detail ? ' - ' + detail : ''));
  }
  try { return await res.json(); } catch (x) { return null; }
}

// ── Month helpers (all 'YYYY-MM-DD' strings, no timezone surprises) ──
function dpMonthStart(dateStr) { return dateStr.slice(0, 8) + '01'; }
function dpAddMonths(monthStart, n) {
  var y = +monthStart.slice(0, 4), m = +monthStart.slice(5, 7) - 1 + n;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  return y + '-' + String(m + 1).padStart(2, '0') + '-01';
}
function dpMonthEnd(monthStart) {
  var y = +monthStart.slice(0, 4), m = +monthStart.slice(5, 7);
  return monthStart.slice(0, 8) + String(new Date(y, m, 0).getDate()).padStart(2, '0');
}
function dpMonthNum(monthStart) { return +monthStart.slice(5, 7); }
function dpMonthsBetween(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }
var DP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var DP_MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function dpShortMonth(ms) { return DP_MONTHS[dpMonthNum(ms) - 1] + ' ' + ms.slice(0, 4); }
function dpLongMonth(ms) { return DP_MONTHS_LONG[dpMonthNum(ms) - 1] + ' ' + ms.slice(0, 4); }

// Which plan slot a month uses: the calendar month for a yearly plan, the
// turn number for a "take turns" plan (null before Turn 1 starts). round
// is 1 for the first time through the turns, 2 for the second, ...
function dpSlotFor(role, monthStart) {
  var s = dutyPlanSettings[role];
  if (s && s.type === 'turns') {
    if (!s.start || !s.turns || monthStart < s.start) return null;
    var diff = dpMonthsBetween(s.start, monthStart);
    return { slot: diff % s.turns + 1, round: Math.floor(diff / s.turns) + 1 };
  }
  return { slot: dpMonthNum(monthStart), round: 0 };
}
function dutyPlanIsTurns(role) { var s = dutyPlanSettings[role]; return !!(s && s.type === 'turns'); }

// Asks the database to fill in this month + the next 2 from the plan.
// At most every 10 minutes unless forced; quietly does nothing if the SQL
// hasn't been run yet.
async function dutyPlanEnsure(force) {
  if (!force && Date.now() - dutyPlanEnsuredAt < 10 * 60 * 1000) return;
  dutyPlanEnsuredAt = Date.now();
  try {
    await fetch(SURL + '/rest/v1/rpc/ensure_duty_plan', { method: 'POST', headers: dpHeaders(), body: JSON.stringify({ months_ahead: DUTY_PLAN_NEAR_MONTHS }) });
  } catch (e) {}
}

async function dutyPlanLoad() {
  dutyPlan = {}; dutyPlanGenerated = {}; dutyPlanSettings = {};
  try {
    var thisMonth = dpMonthStart(localDateStr());
    var both = await Promise.all([
      dpFetch('GET', 'duty_yearly_plan?select=duty_role,month,staff_name,staff_email&order=duty_role.asc,month.asc,staff_name.asc'),
      dpFetch('GET', 'duty_plan_generated?select=duty_role,month_start&month_start=gte.' + thisMonth),
      // Missing until docs/duty-turns-plan.sql is run: then every plan is yearly.
      dpFetch('GET', 'duty_plan_settings?select=duty_role,plan_type,start_month,turns').then(function (r) { dutyPlanSettingsOk = true; return r; }, function () { dutyPlanSettingsOk = false; return []; })
    ]);
    (Array.isArray(both[2]) ? both[2] : []).forEach(function (s) {
      if (s.plan_type === 'turns' && s.start_month && s.turns > 0) dutyPlanSettings[s.duty_role] = { type: 'turns', start: dpMonthStart(s.start_month), turns: +s.turns };
    });
    (Array.isArray(both[0]) ? both[0] : []).forEach(function (p) {
      var r = dutyPlan[p.duty_role] = dutyPlan[p.duty_role] || {};
      (r[p.month] = r[p.month] || []).push({ name: p.staff_name, email: p.staff_email || null });
    });
    (Array.isArray(both[1]) ? both[1] : []).forEach(function (g) {
      (dutyPlanGenerated[g.duty_role] = dutyPlanGenerated[g.duty_role] || {})[g.month_start] = true;
    });
  } catch (e) { dutyPlan = {}; dutyPlanGenerated = {}; }
}

function dutyPlanHas(role) {
  var r = dutyPlan[role];
  if (!r) return false;
  for (var k in r) if (r[k] && r[k].length) return true;
  return false;
}

// Splits one role's saved date-range groups (date_from/date_to) into what
// shows straight away (this month + next 2) and what "Show full year"
// reveals, and adds the plan's later months that aren't saved yet.
// Items: { group: g } for saved groups, { plan: {start, end, names} } for
// plan-only months. nameOf(member) resolves a plan member's current name.
function dutyPlanSplit(role, groups, nameOf) {
  var thisMonth = dpMonthStart(localDateStr());
  var nearEnd = dpAddMonths(thisMonth, DUTY_PLAN_NEAR_MONTHS);
  var near = [], later = [];
  groups.forEach(function (g) { (g.date_from < nearEnd ? near : later).push({ start: g.date_from, group: g }); });
  if (dutyPlanHas(role)) {
    var gen = dutyPlanGenerated[role] || {};
    for (var i = 0; i < DUTY_PLAN_YEAR_MONTHS; i++) {
      var ms = dpAddMonths(thisMonth, i), me = dpMonthEnd(ms);
      if (gen[ms]) continue;
      if (groups.some(function (g) { return g.date_from <= me && (g.date_to || g.date_from) >= ms; })) continue;
      var at = dpSlotFor(role, ms);
      var members = at ? ((dutyPlan[role] || {})[at.slot] || []) : [];
      if (!members.length) continue;
      var item = { start: ms, plan: { start: ms, end: me, names: members.map(nameOf || function (m) { return m.name; }) } };
      (ms < nearEnd ? near : later).push(item);
    }
  }
  var byStart = function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; };
  near.sort(byStart); later.sort(byStart);
  // "Take turns": mark the month a new round starts (Turn 1 again).
  if (dutyPlanIsTurns(role)) near.concat(later).forEach(function (it) {
    var at = dpSlotFor(role, dpMonthStart(it.start));
    if (at && at.slot === 1 && at.round > 1) it.round = at.round;
  });
  return { near: near, later: later };
}

// The purple "Round 2 starts" line shown above such a month, or ''.
function dutyPlanRoundHtml(item, first) {
  if (!item || !item.round) return '';
  return '<div class="dp-round' + (first ? ' first' : '') + '">🔁 Round ' + item.round + ' starts — back to Turn 1</div>';
}

// A plan month that isn't saved yet: same month band, dates and one row
// per person (initials + name) as the saved months, just without edit
// buttons -- there's nothing saved to edit yet.
var DP_AV = [['#E1F5EE', '#085041'], ['#FAEEDA', '#854F0B'], ['#FAECE7', '#993C1D'], ['#E6F1FB', '#185FA5'], ['#EEEDFE', '#534AB7'], ['#FCEBEB', '#A32D2D']];
function dutyPlanCompactHtml(item, first) {
  var p = item.plan;
  var label = typeof dutyMonthLabel === 'function' ? dutyMonthLabel(p.start, p.end) : p.start;
  var today = localDateStr();
  var now = p.start <= today && today <= p.end;
  return '<div style="' + (first ? '' : 'margin-top:10px;') + '">'
    + '<div class="duty-month-band' + (now ? ' now' : '') + '" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 -14px 0 -33px;padding:8px 14px 8px 33px;background:' + (now ? '#E1F5EE' : '#F1F4F3') + ';">'
    + '<div style="font-size:11.5px;font-weight:800;letter-spacing:.8px;color:' + (now ? '#085041' : '#4B5A54') + ';">' + escHtml(label) + '</div>'
    + '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:#fff;color:' + (now ? '#085041' : '#185FA5') + ';">' + (now ? 'On duty now' : 'Upcoming') + '</span></div>'
    + '<div style="font-size:10.5px;color:#70827D;margin:6px 0 2px;">' + (typeof dutyShortRange === 'function' ? dutyShortRange(p.start, p.end) : '') + '</div>'
    + p.names.map(function (n, i) {
      var ini = String(n || '').split(' ').filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('');
      var c = DP_AV[i % DP_AV.length];
      return '<div class="dp-prow" style="display:flex;align-items:center;gap:10px;padding:5px 0;' + (i ? 'border-top:1px solid #EEF2F0;' : '') + '">'
        + '<div style="width:30px;height:30px;border-radius:50%;background:' + c[0] + ';color:' + c[1] + ';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;">' + escHtml(ini) + '</div>'
        + '<div style="font-size:12px;color:#111C18;">' + escHtml(n) + '</div></div>';
    }).join('')
    + '</div>';
}

// "Show full year" button + the hidden later months, or '' if there's nothing later.
function dutyPlanLaterHtml(laterHtml, lastStart) {
  if (!laterHtml) return '';
  var upto = lastStart ? new Date(lastStart + 'T00:00:00').toLocaleDateString('en-MY', { month: 'short', year: 'numeric' }) : '';
  return '<div class="dp-later" style="display:none;margin-top:10px;">' + laterHtml + '</div>'
    + '<button class="dp-more" onclick="event.stopPropagation();dutyPlanToggleYear(this)" data-upto="' + escHtml(upto) + '">'
    + '▾ Show full year' + (upto ? ' <span>· up to ' + escHtml(upto) + '</span>' : '') + '</button>';
}

function dutyPlanToggleYear(btn) {
  var later = btn.previousElementSibling;
  if (!later) return;
  var open = later.style.display !== 'block';
  later.style.display = open ? 'block' : 'none';
  var upto = btn.getAttribute('data-upto');
  btn.innerHTML = open ? '▴ Show less' : '▾ Show full year' + (upto ? ' <span>· up to ' + escHtml(upto) + '</span>' : '');
}

// "🔁 Same every year · Edit plan" (or "🔁 Takes turns · every 10 months")
// under a team name -- editors only.
function dutyPlanRotLineHtml(role) {
  if (!dutyPlanCanEdit() || !dutyPlanHas(role)) return '';
  var s = dutyPlanSettings[role];
  var what = dutyPlanIsTurns(role) ? 'Takes turns · ' + (s.turns === 1 ? 'every month' : 'every ' + s.turns + ' months') : 'Same every year';
  return '<div class="dp-rot">🔁 ' + what + '<button onclick="event.stopPropagation();dutyPlanOpen(\'' + escJsAttr(role) + '\')">Edit plan</button></div>';
}

function dutyPlanChangedTag(group) {
  return group.members.some(function (m) { return m.plan_status === 'changed'; }) ? '<span class="dp-changed">Changed</span>' : '';
}

// ── Plan editor ──
async function dutyPlanOpen(role) {
  if (!dutyPlanCanEdit()) return;
  var panel = document.getElementById('duty-plan-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = '<div style="font-size:12px;color:#70827D;text-align:center;padding:10px 0;">Loading…</div>';
  try {
    var both = await Promise.all([
      dpFetch('GET', 'duty_roles?select=name&order=name.asc'),
      dpFetch('GET', 'profiles?role=neq.pending&order=full_name.asc&select=full_name,email&limit=500')
    ]);
    dpRoles = (both[0] || []).map(function (r) { return r.name; });
    dpStaff = (both[1] || []).filter(function (p) { return p.full_name; }).map(function (p) { return { name: p.full_name, email: p.email || null }; });
  } catch (e) { dpRoles = []; dpStaff = []; }
  await dutyPlanLoad();
  dpStartDraft(role || dpRoles[0] || '');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function dpCopy(list) { return (list || []).map(function (p) { return { name: dpCurrentName(p), email: p.email }; }); }

function dpStartDraft(role) {
  var src = dutyPlan[role] || {};
  var s = dutyPlanSettings[role];
  var turnsPlan = !!(s && s.type === 'turns');
  var months = {};
  for (var m = 1; m <= 12; m++) months[m] = turnsPlan ? [] : dpCopy(src[m]);
  var turns, start;
  if (turnsPlan) {
    turns = [];
    for (var t = 1; t <= s.turns; t++) turns.push(dpCopy(src[t]));
    start = s.start;
  } else {
    var conv = dpTurnsFromYearly(months);
    turns = conv.turns; start = conv.start;
  }
  dpDraft = { role: role, type: turnsPlan ? 'turns' : 'yearly', months: months, turns: turns, start: start, existing: dutyPlanHas(role), view: 'edit' };
  dpRender();
}

// Turns pre-filled from a yearly plan, so switching doesn't mean typing
// everyone in again: the filled-in months in calendar order, starting
// after a month with nobody (e.g. Jul..Apr when May and Jun are empty),
// with Turn 1 in the latest such month up to now -- so this month keeps
// the same people. Empty months are left out.
function dpTurnsFromYearly(months) {
  var thisMs = dpMonthStart(localDateStr()), nowM = dpMonthNum(thisMs), y = +thisMs.slice(0, 4);
  var filled = [];
  for (var m = 1; m <= 12; m++) if (months[m].length) filled.push(m);
  if (!filled.length) return { turns: [[]], start: thisMs };
  var first = 1;
  if (filled.length < 12) {
    first = filled[0];
    for (var i = 0; i < filled.length; i++) {
      var prev = filled[i] === 1 ? 12 : filled[i] - 1;
      if (!months[prev].length) { first = filled[i]; break; }
    }
  }
  var turns = [];
  for (var k = 0; k < 12; k++) {
    var mm = (first - 1 + k) % 12 + 1;
    if (months[mm].length) turns.push(months[mm].map(function (p) { return { name: p.name, email: p.email }; }));
  }
  var year = first <= nowM ? y : y - 1;
  return { turns: turns, start: year + '-' + String(first).padStart(2, '0') + '-01' };
}

function dpCurrentName(p) {
  var email = (p.email || '').toLowerCase();
  var hit = email && dpStaff.find(function (s) { return (s.email || '').toLowerCase() === email; });
  return hit ? hit.name : p.name;
}

// Where a "take turns" draft stands this month: index of this month's turn
// (-1 before Turn 1 starts) and how many full rounds are behind us.
function dpDraftNow() {
  var thisMs = dpMonthStart(localDateStr());
  var n = dpDraft.turns.length || 1;
  var diff = dpMonthsBetween(dpDraft.start, thisMs);
  if (diff < 0) return { idx: -1, round: 0, thisMs: thisMs };
  return { idx: diff % n, round: Math.floor(diff / n), thisMs: thisMs };
}
// The month turn i (0-based) falls in, in round r (0-based).
function dpTurnMonth(i, r) { return dpAddMonths(dpDraft.start, r * dpDraft.turns.length + i); }

function dpPeopleHtml(people, addCall, removeCall) {
  var chips = people.map(function (p, i) {
    return '<span class="dp-chip">' + escHtml(p.name) + '<button title="Remove" onclick="' + removeCall + ',' + i + ')">✕</button></span>';
  }).join('');
  var taken = people.map(function (p) { return p.name; });
  var opts = dpStaff.filter(function (s) { return taken.indexOf(s.name) === -1; })
    .map(function (s) { return '<option value="' + escHtml(s.name) + '">' + escHtml(s.name) + '</option>'; }).join('');
  return '<div class="dp-chips">' + chips + '<select class="dp-add" onchange="' + addCall + ',this.value)"><option value="">+ Add</option>' + opts + '</select></div>';
}

function dpRender() {
  var panel = document.getElementById('duty-plan-panel');
  if (!panel || !dpDraft) return;
  if (dpDraft.view === 'table') { panel.innerHTML = dpTableHtml(); return; }
  var turnsMode = dpDraft.type === 'turns';
  var roleOpts = dpRoles.slice();
  if (dpDraft.role && roleOpts.indexOf(dpDraft.role) === -1) roleOpts.push(dpDraft.role);
  var html = '<div class="dp-title"><span>🔁 Duty Plan</span><button class="dp-x" onclick="dutyPlanClose()">&times;</button></div>'
    + '<div class="dp-lbl">Duty Role</div>'
    + '<select class="dp-sel" id="dp-role" onchange="dpStartDraft(this.value)">'
    + roleOpts.map(function (r) { return '<option value="' + escHtml(r) + '"' + (r === dpDraft.role ? ' selected' : '') + '>' + escHtml(r) + '</option>'; }).join('')
    + '</select>'
    + '<div class="dp-lbl">How it repeats</div>'
    + '<div class="dp-seg" id="dp-type"><button class="' + (turnsMode ? '' : 'on') + '" onclick="dpSetType(\'yearly\')">Same month every year</button>'
    + '<button class="' + (turnsMode ? 'on' : '') + '" onclick="dpSetType(\'turns\')">Take turns in order</button></div>';
  html += turnsMode ? dpTurnsEditorHtml() : dpYearlyEditorHtml();
  html += '<div class="dp-note">🔁 Changes apply from next month — this month and months already changed by hand stay as they are.</div>'
    + '<div class="dp-err" id="dp-err"></div>'
    + '<div class="dp-row"><button class="dp-btn dp-save" id="dp-save" onclick="dutyPlanSave()">Save Plan</button><button class="dp-btn dp-cancel" onclick="dutyPlanClose()">Cancel</button></div>'
    + (dpDraft.existing ? '<button class="dp-stop" onclick="dutyPlanStop()">Stop this plan</button>' : '');
  panel.innerHTML = html;
}

function dpYearlyEditorHtml() {
  var nowMonth = dpMonthNum(dpMonthStart(localDateStr()));
  var rows = '';
  for (var m = 1; m <= 12; m++) {
    rows += '<div class="dp-m' + (m === nowMonth ? ' now' : '') + '"><div class="dp-mn">' + DP_MONTHS[m - 1] + '</div>'
      + dpPeopleHtml(dpDraft.months[m], 'dpAdd(' + m, 'dpRemove(' + m) + '</div>';
  }
  return '<div class="dp-help">Who\'s on duty in each month. It repeats every year, and the roster fills itself in for the next few months.</div>'
    + '<div class="dp-months">' + rows + '</div>';
}

function dpTurnsEditorHtml() {
  var n = dpDraft.turns.length;
  var now = dpDraftNow();
  // "Turn 1 starts": 3 years back to 2 years ahead (and the saved month).
  var opts = [], seen = {};
  for (var k = -36; k <= 24; k++) { var ms = dpAddMonths(now.thisMs, k); opts.push(ms); seen[ms] = 1; }
  if (!seen[dpDraft.start]) { opts.push(dpDraft.start); opts.sort(); }
  var startSel = '<select class="dp-sel" id="dp-start" onchange="dpSetStart(this.value)">'
    + opts.map(function (ms) { return '<option value="' + ms + '"' + (ms === dpDraft.start ? ' selected' : '') + '>' + dpLongMonth(ms) + '</option>'; }).join('') + '</select>';
  var rows = dpDraft.turns.map(function (people, i) {
    // Each turn is labelled with its first month (Turn 1 = the start month,
    // Turn 2 the month after, ...), so the labels don't move while turns
    // are being added; then when it's next on duty.
    var firstMs = dpTurnMonth(i, 0), when = '';
    if (firstMs === now.thisMs) when = 'on duty now';
    else if (firstMs < now.thisMs) {
      var nextMs = dpAddMonths(firstMs, Math.ceil(dpMonthsBetween(firstMs, now.thisMs) / n) * n);
      when = nextMs === now.thisMs ? 'on duty now' : 'next ' + dpShortMonth(nextMs);
    }
    return '<div class="dp-turn' + (i === now.idx ? ' now' : '') + '">'
      + '<div class="dp-th"><span>Turn ' + (i + 1) + ' · ' + dpShortMonth(firstMs) + (when ? ' <small>· ' + when + '</small>' : '') + '</span>'
      + '<span class="dp-tb"><button title="Move up" onclick="dpMoveTurn(' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button title="Move down" onclick="dpMoveTurn(' + i + ',1)"' + (i === n - 1 ? ' disabled' : '') + '>↓</button>'
      + '<button title="Remove this turn" onclick="dpRemoveTurn(' + i + ')"' + (n === 1 ? ' disabled' : '') + '>✕</button></span></div>'
      + dpPeopleHtml(people, 'dpAddT(' + i, 'dpRemoveT(' + i) + '</div>';
  }).join('');
  var sum;
  if (now.idx === -1) {
    sum = '🔁 <b>' + n + (n === 1 ? ' turn' : ' turns') + '</b>, one per month. Turn 1 starts <b>' + dpShortMonth(dpDraft.start) + '</b>.';
  } else if (n === 1) {
    sum = '🔁 <b>1 turn</b> — the same people every month.';
  } else {
    var lead = dpDraft.turns[0][0];
    sum = '🔁 <b>' + n + ' turns</b>, one per month — everyone\'s on duty <b>once every ' + n + ' months</b>.<br>'
      + 'Round ' + (now.round + 2) + ' starts <b>' + dpShortMonth(dpTurnMonth(0, now.round + 1)) + '</b>' + (lead ? ' with ' + escHtml(lead.name) + '\'s group' : '') + '.';
  }
  return '<div class="dp-help">Each turn is one month, in this order. After the last turn it starts again from Turn 1, round after round.</div>'
    + '<div class="dp-lbl">Turn 1 starts</div>' + startSel
    + '<div class="dp-months">' + rows + '</div>'
    + (n < DUTY_PLAN_MAX_TURNS ? '<button class="dp-addturn" id="dp-addturn" onclick="dpAddTurn()">+ Add a turn</button>' : '')
    + '<div class="dp-sum" id="dp-sum">' + sum + '</div>'
    + '<button class="dp-all" id="dp-all" onclick="dpShowTable()">📋 See all turns</button>';
}

// "See all turns": every turn with its dates for this round and the next
// two, and who's in it. Uses the draft, so unsaved changes show too.
function dpTableHtml() {
  var n = dpDraft.turns.length;
  var now = dpDraftNow();
  var r0 = Math.max(0, now.round);
  var thisMs = now.thisMs;
  var head = '<div class="dp-tr hd"><div class="dp-trd"><div>Turn</div>'
    + [0, 1, 2].map(function (r) { return '<div>Round ' + (r0 + r + 1) + '</div>'; }).join('') + '</div></div>';
  var rows = dpDraft.turns.map(function (people, i) {
    var names = people.map(function (p) { return p.name; });
    return '<div class="dp-tr' + (i === now.idx ? ' now' : '') + '" data-names="' + escHtml(names.join(' ').toLowerCase()) + '"><div class="dp-trd"><div><b>' + (i + 1) + '</b></div>'
      + [0, 1, 2].map(function (r) {
        var ms = dpTurnMonth(i, r0 + r);
        return '<div class="' + (ms < thisMs ? 'past' : '') + '">' + dpShortMonth(ms) + '</div>';
      }).join('') + '</div>'
      + '<div class="dp-trn">' + (names.length ? escHtml(names.join(', ')) : '<span style="color:#A32D2D;">Nobody yet</span>') + '</div></div>';
  }).join('');
  return '<div class="dp-title"><span>📋 When is everyone on duty?</span><button class="dp-x" title="Back to the plan" onclick="dpHideTable()">&times;</button></div>'
    + '<div class="dp-help" style="margin:0 0 8px;">' + escHtml(dpDraft.role) + ' · ' + n + (n === 1 ? ' turn' : ' turns') + ', one month each'
    + (dpDraft.dirty ? ' · includes changes not saved yet' : '') + '</div>'
    + '<input class="dp-search" id="dp-search" type="search" placeholder="Find a name…" oninput="dpFilterTable(this.value)">'
    + '<div class="dp-tbl" id="dp-tbl">' + head + rows + '</div>'
    + '<div class="dp-help" id="dp-nomatch" style="display:none;text-align:center;margin:-2px 0 10px;">Nobody by that name in the turns.</div>'
    + '<button class="dp-btn dp-cancel" style="width:100%;" onclick="dpHideTable()">← Back to the plan</button>';
}
function dpFilterTable(q) {
  q = String(q || '').trim().toLowerCase();
  var shown = 0;
  document.querySelectorAll('#dp-tbl .dp-tr[data-names]').forEach(function (row) {
    var hit = !q || row.getAttribute('data-names').indexOf(q) !== -1;
    row.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });
  var none = document.getElementById('dp-nomatch');
  if (none) none.style.display = shown ? 'none' : 'block';
}
function dpShowTable() { if (dpDraft) { dpDraft.view = 'table'; dpRender(); } }
function dpHideTable() { if (dpDraft) { dpDraft.view = 'edit'; dpRender(); } }

function dpTouch() { dpDraft.dirty = true; dpRender(); }
function dpSetType(t) { if (dpDraft && dpDraft.type !== t) { dpDraft.type = t; dpTouch(); } }
function dpSetStart(ms) { if (dpDraft && ms) { dpDraft.start = ms; dpTouch(); } }
function dpStaffEntry(name) { var s = dpStaff.find(function (x) { return x.name === name; }); return { name: name, email: s ? s.email : null }; }
function dpAdd(m, name) { if (name && dpDraft) { dpDraft.months[m].push(dpStaffEntry(name)); dpTouch(); } }
function dpRemove(m, i) { if (dpDraft) { dpDraft.months[m].splice(i, 1); dpTouch(); } }
function dpAddT(t, name) { if (name && dpDraft && dpDraft.turns[t]) { dpDraft.turns[t].push(dpStaffEntry(name)); dpTouch(); } }
function dpRemoveT(t, i) { if (dpDraft && dpDraft.turns[t]) { dpDraft.turns[t].splice(i, 1); dpTouch(); } }
function dpAddTurn() { if (dpDraft && dpDraft.turns.length < DUTY_PLAN_MAX_TURNS) { dpDraft.turns.push([]); dpTouch(); } }
function dpRemoveTurn(t) {
  if (!dpDraft || dpDraft.turns.length <= 1) return;
  if (dpDraft.turns[t].length && !confirm('Remove Turn ' + (t + 1) + ' (' + dpDraft.turns[t].map(function (p) { return p.name; }).join(', ') + ')? The turns after it move up a month.')) return;
  dpDraft.turns.splice(t, 1); dpTouch();
}
function dpMoveTurn(t, d) {
  if (!dpDraft) return;
  var j = t + d;
  if (j < 0 || j >= dpDraft.turns.length) return;
  var x = dpDraft.turns[t]; dpDraft.turns[t] = dpDraft.turns[j]; dpDraft.turns[j] = x; dpTouch();
}

function dutyPlanClose() {
  var panel = document.getElementById('duty-plan-panel');
  if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
  dpDraft = null;
}

function dpError(msg) { var el = document.getElementById('dp-err'); if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; } }

// Replaces the role's plan (and how it repeats), then clears the months
// after this one that were filled in from the old plan and left untouched,
// so they get filled in again from the new one. Months changed or deleted
// by hand stay as they are (their "already filled in" mark is kept).
// settings: a duty_plan_settings row to save, 'delete', or null (table
// not there yet -- leave it).
async function dpReplacePlan(role, rows, settings) {
  var nextMonth = dpAddMonths(dpMonthStart(localDateStr()), 1);
  var enc = encodeURIComponent(role);
  await dpFetch('DELETE', 'duty_yearly_plan?duty_role=eq.' + enc);
  if (rows.length) await dpFetch('POST', 'duty_yearly_plan', rows);
  if (settings === 'delete') await dpFetch('DELETE', 'duty_plan_settings?duty_role=eq.' + enc);
  else if (settings) await dpFetch('POST', 'duty_plan_settings?on_conflict=duty_role', settings, 'resolution=merge-duplicates,return=minimal');
  // Only months where every row is still exactly as the plan filled it in --
  // one swapped person ('changed') or a row added by hand leaves the whole
  // month alone.
  var future = await dpFetch('GET', 'duty_roster?duty_role=eq.' + enc + '&date_from=gte.' + nextMonth + '&select=id,date_from,plan_status');
  var byMonth = {};
  (Array.isArray(future) ? future : []).forEach(function (r) {
    var ms = dpMonthStart(r.date_from);
    var b = byMonth[ms] = byMonth[ms] || { ids: [], untouched: true };
    b.ids.push(r.id);
    if (r.plan_status !== 'plan') b.untouched = false;
  });
  var months = Object.keys(byMonth).filter(function (ms) { return byMonth[ms].untouched; });
  var ids = [];
  months.forEach(function (ms) { ids = ids.concat(byMonth[ms].ids); });
  if (ids.length) await dpFetch('DELETE', 'duty_roster?id=in.(' + ids.join(',') + ')');
  if (months.length) await dpFetch('DELETE', 'duty_plan_generated?duty_role=eq.' + enc + '&month_start=in.(' + months.join(',') + ')');
  await dutyPlanEnsure(true);
}

async function dutyPlanSave() {
  if (!dutyPlanCanEdit() || !dpDraft) return;
  var role = dpDraft.role;
  if (!role) { dpError('Please pick a duty role.'); return; }
  var rows = [], settings = null, summary;
  if (dpDraft.type === 'turns') {
    if (!dutyPlanSettingsOk) { dpError('"Take turns in order" needs a one-time database update first: run docs/duty-turns-plan.sql in the Supabase SQL Editor, then try again.'); return; }
    var n = dpDraft.turns.length;
    for (var t = 0; t < n; t++) if (!dpDraft.turns[t].length) { dpError('Turn ' + (t + 1) + ' has nobody yet — add someone or remove that turn.'); return; }
    dpDraft.turns.forEach(function (people, i) { people.forEach(function (p) { rows.push({ duty_role: role, month: i + 1, staff_name: p.name, staff_email: p.email }); }); });
    settings = { duty_role: role, plan_type: 'turns', start_month: dpDraft.start, turns: n, updated_at: new Date().toISOString() };
    summary = n + ' turns from ' + dpShortMonth(dpDraft.start) + ', ' + rows.length + ' people';
  } else {
    for (var m = 1; m <= 12; m++) dpDraft.months[m].forEach(function (p) { rows.push({ duty_role: role, month: m, staff_name: p.name, staff_email: p.email }); });
    if (!rows.length) { dpError('Add at least one person to a month, or use "Stop this plan".'); return; }
    if (dutyPlanSettingsOk) settings = { duty_role: role, plan_type: 'yearly', start_month: null, turns: null, updated_at: new Date().toISOString() };
    summary = rows.length + ' people across the year';
  }
  dpError('');
  var btn = document.getElementById('dp-save'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await dpReplacePlan(role, rows, settings);
    if (typeof logAudit === 'function') logAudit('duty', null, dpDraft.existing ? 'edited' : 'added', role, { dutyPlan: summary }, null);
    dutyPlanClose();
    if (typeof dutyPlanAfterChange === 'function') dutyPlanAfterChange();
  } catch (e) {
    dpError('Could not save the plan: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Save Plan'; }
  }
}

async function dutyPlanStop() {
  if (!dutyPlanCanEdit() || !dpDraft) return;
  var role = dpDraft.role;
  if (!confirm('Stop the duty plan for ' + role + '? This month stays as it is; later months filled in from the plan are removed.')) return;
  try {
    await dpReplacePlan(role, [], dutyPlanSettingsOk ? 'delete' : null);
    if (typeof logAudit === 'function') logAudit('duty', null, 'deleted', role, { dutyPlan: 'stopped' }, null);
    dutyPlanClose();
    if (typeof dutyPlanAfterChange === 'function') dutyPlanAfterChange();
  } catch (e) { dpError('Could not stop the plan: ' + e.message); }
}

// When a month that came from the plan is changed by hand, mark it so it
// shows a "Changed" tag and isn't replaced if the plan is edited later.
async function dutyPlanMarkChanged(ids) {
  if (!ids || !ids.length) return;
  try { await dpFetch('PATCH', 'duty_roster?id=in.(' + ids.join(',') + ')&plan_status=eq.plan', { plan_status: 'changed' }); } catch (e) {}
}

// Keeps plans pointing at a renamed duty role.
async function dutyPlanRenameRole(oldName, newName) {
  try {
    await dpFetch('PATCH', 'duty_yearly_plan?duty_role=eq.' + encodeURIComponent(oldName), { duty_role: newName });
    await dpFetch('PATCH', 'duty_plan_generated?duty_role=eq.' + encodeURIComponent(oldName), { duty_role: newName });
  } catch (e) {}
  if (dutyPlanSettingsOk) try { await dpFetch('PATCH', 'duty_plan_settings?duty_role=eq.' + encodeURIComponent(oldName), { duty_role: newName }); } catch (e) {}
}
