// ── tab-leave.js — Leave tab + Home "Today on Leave" card ──
//
// Read-only: leave is managed in OPISPRO, not here. Pulled via the
// opispro-get-leaves Edge Function (see docs/opispro-leaves-setup.md),
// which merges HQ/MILL/ESTATE into one call. No self-entry, no edit, no
// delete -- OPISPRO is the single source of truth for leave.

// Same shared-secret pattern as OPISPRO_CLIENT_SECRET in login.html --
// this just blocks drive-by hits on the function URL; it isn't, and can't
// be, a real secret since it ships in this public file.
var OPISPRO_CLIENT_SECRET = 'mWfK3xNqL8vY2bRz6cTdP9hJ4sAeU1oG';

var LEAVE_SHORT_CODE = {
  ANNUAL: 'AL', SICK: 'MC', HOSPITALIZATION: 'HL', COMPASSIONATE: 'CL',
  MATERNITY: 'ML', PATERNITY: 'PL', UNPAID: 'UL'
};
var LEAVE_FULL_NAME = {
  ANNUAL: 'Annual Leave', SICK: 'Sick Leave', HOSPITALIZATION: 'Hospitalisation Leave',
  COMPASSIONATE: 'Compassionate Leave', MATERNITY: 'Maternity Leave', PATERNITY: 'Paternity Leave',
  UNPAID: 'Unpaid Leave'
};

async function fetchOpisproLeaves(date, days) {
  try {
    var res = await fetch(SURL + '/functions/v1/opispro-get-leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: OPISPRO_CLIENT_SECRET, date: date, days: days })
    });
    var result = await res.json();
    return (result && result.ok) ? result.data : null;
  } catch (e) { return null; }
}

// Merges consecutive calendar days with the same leave_type into one run,
// so a 3-day annual leave reads as one row ("ANNUAL · 13-15 Oct") instead
// of three. Assumes `leaves` is already sorted by date (OPISPRO guarantees it).
function groupLeaveRuns(leaves) {
  var runs = [];
  leaves.forEach(function(lv) {
    var last = runs[runs.length - 1];
    if (last && last.leave_type === lv.leave_type) {
      var next = new Date(last.to + 'T00:00:00');
      next.setDate(next.getDate() + 1);
      var nextStr = next.getFullYear() + '-' + String(next.getMonth()+1).padStart(2,'0') + '-' + String(next.getDate()).padStart(2,'0');
      if (nextStr === lv.date) { last.to = lv.date; last.dayType = lv.day_type; return; }
    }
    runs.push({ from: lv.date, to: lv.date, leave_type: lv.leave_type, dayType: lv.day_type });
  });
  return runs;
}

function leaveBadgeCls(type) {
  return (type === 'SICK' || type === 'HOSPITALIZATION') ? 'badge-urgent' : 'badge-amber';
}

function fmtLeaveDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
}

function leaveRunLabel(run) {
  var code = LEAVE_SHORT_CODE[run.leave_type] || run.leave_type;
  if (run.from === run.to && run.dayType && run.dayType !== 'FULL') {
    code += ' · ' + (run.dayType === 'AM' ? 'AM' : run.dayType === 'PM' ? 'PM' : 'Hourly');
  }
  return code;
}

async function loadLeave() {
  if (window.location.protocol === 'file:') return;
  var today = localDateStr();
  var avColors = ['av-green','av-amber','av-coral','av-blue','av-purple','av-red'];

  var data = await fetchOpisproLeaves(today, 14);
  var users = (data && data.users) || [];

  // ── HOME TAB: today on leave ──
  var homeEl = document.getElementById('home-leave-today');
  if (homeEl) {
    var todayUsers = users.filter(function(u) { return u.leaves.some(function(lv) { return lv.date === today; }); });
    if (todayUsers.length) {
      var names = todayUsers.map(function(u){ return u.name; }).join(', ');
      homeEl.innerHTML = '<div class="home-summary-card" onclick="switchTabByName(\'leave\')">'
        + '<div class="home-summary-ic" style="background:var(--green-bg);color:var(--green-text);"><i class="ti ti-leaf"></i></div>'
        + '<div style="flex:1;min-width:0;"><div class="home-summary-title">Today on Leave</div>'
        + '<div class="home-summary-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(names) + '</div></div>'
        + '<div class="home-summary-count">' + todayUsers.length + '</div>'
        + '<i class="ti ti-chevron-right home-summary-chev"></i>'
        + '</div>';
    } else {
      homeEl.innerHTML = '<div class="card" style="cursor:pointer;" onclick="switchTabByName(\'leave\')"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">No one on leave today.</div></div>';
    }
  }

  // ── LEAVE TAB: currently + upcoming (read-only) ──
  var tabEl = document.getElementById('leave-tab-list');
  if (!tabEl) return;
  if (!data) {
    tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Could not load leave records.</div>';
    return;
  }
  if (!users.length) {
    tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No leave records.</div>';
    return;
  }

  function renderGroup(title, rows) {
    if (!rows.length) return '';
    var isCurrent = title === 'Currently on Leave';
    var dotStyle = isCurrent
      ? 'width:8px;height:8px;border-radius:50%;background:var(--green-dark);flex-shrink:0;'
      : 'width:8px;height:8px;border-radius:50%;border:1.5px solid var(--text-primary);flex-shrink:0;';
    var titleColor = isCurrent ? 'var(--green-dark)' : 'var(--text-primary)';
    var cardBorder = isCurrent ? 'border:1.5px solid var(--green-dark);' : '';
    var h = '<div class="section-row"><div class="section-title" style="display:flex;align-items:center;gap:7px;color:' + titleColor + ';">'
      + '<span style="' + dotStyle + '"></span>' + title + '</div></div><div class="card" style="' + cardBorder + '">';
    rows.forEach(function(row, i) {
      var ini = row.name.split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
      var avCls = avColors[i % avColors.length];
      var from = fmtLeaveDate(row.run.from), to = fmtLeaveDate(row.run.to);
      h += '<div class="person-row">'
        + '<div class="avatar ' + avCls + '">' + ini + '</div>'
        + '<div style="flex:1;"><div class="person-name">' + escHtml(row.name) + '</div>'
        + '<div class="person-sub">' + (LEAVE_FULL_NAME[row.run.leave_type] || row.run.leave_type) + ' · ' + from + (from !== to ? ' – ' + to : '') + '</div></div>'
        + '<span class="badge ' + leaveBadgeCls(row.run.leave_type) + '">' + leaveRunLabel(row.run) + '</span>'
        + '</div>';
    });
    h += '</div>';
    return h;
  }

  var current = [], upcoming = [];
  users.forEach(function(u) {
    var todayLeaves = u.leaves.filter(function(lv){ return lv.date === today; });
    var futureLeaves = u.leaves.filter(function(lv){ return lv.date > today; });
    todayLeaves.forEach(function(lv) { current.push({ name: u.name, run: { from: lv.date, to: lv.date, leave_type: lv.leave_type, dayType: lv.day_type } }); });
    groupLeaveRuns(futureLeaves).forEach(function(run) { upcoming.push({ name: u.name, run: run }); });
  });
  upcoming.sort(function(a, b) { return a.run.from < b.run.from ? -1 : a.run.from > b.run.from ? 1 : 0; });

  tabEl.innerHTML = renderGroup('Currently on Leave', current) + renderGroup('Upcoming Leave', upcoming);
  if (!current.length && !upcoming.length) {
    tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No leave records.</div>';
  }
}
