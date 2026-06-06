// ── tab-announcements.js — Announcements tab + Home banner + Staff Calendar ──

// ── STAFF CALENDAR ──
var staffCalYear, staffCalMonth;
var staffCalLeave = {}, staffCalEvents = {};
var STAFF_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function initStaffCalendar() {
  var n = new Date();
  staffCalYear = n.getFullYear(); staffCalMonth = n.getMonth();
  loadStaffCalendar();
}

async function loadStaffCalendar() {
  staffCalLeave = {}; staffCalEvents = {};
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
    var cell    = document.createElement('div');
    var dateStr = staffCalYear + '-' + String(staffCalMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday  = (d === today.getDate() && staffCalMonth === today.getMonth() && staffCalYear === today.getFullYear());
    var hasLeave = staffCalLeave[dateStr];
    var hasEvent = staffCalEvents[dateStr];
    var cls = 'cal-day';
    if (isToday)  cls += ' today';
    if (hasEvent) cls += ' has-event';
    cell.className = cls;
    cell.innerHTML = '<span>' + d + '</span>' + (hasLeave ? '<div class="cal-underline leave"></div>' : '');
    if (hasLeave || hasEvent) {
      cell.style.cursor = 'pointer';
      (function(ds, hl, he){ cell.onclick = function(){ showStaffDayDetail(ds, hl, he); }; })(dateStr, hasLeave, hasEvent);
    }
    grid.appendChild(cell);
  }
}

function staffCalPrev() { staffCalMonth--; if (staffCalMonth < 0)  { staffCalMonth = 11; staffCalYear--; } loadStaffCalendar(); }
function staffCalNext() { staffCalMonth++; if (staffCalMonth > 11) { staffCalMonth = 0;  staffCalYear++; } loadStaffCalendar(); }

// ── DAY DETAIL MODAL ──
async function showStaffDayDetail(dateStr, hasLeave, hasEvent) {
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
          return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:0.5px solid #E2E8E5;">'
            + '<div style="width:30px;height:30px;border-radius:50%;background:#E1F5EE;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:#085041;flex-shrink:0;">' + ini + '</div>'
            + '<div style="flex:1;"><div style="font-size:12px;font-weight:500;color:#111C18;">' + escHtml(r.staff_name) + '</div>'
            + '<div style="font-size:11px;color:#6B7A73;">' + escHtml(r.leave_type) + ' · ' + from + '–' + to + '</div></div>'
            + '<span style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:10px;background:#FAEEDA;color:#854F0B;">' + shortType + '</span></div>';
        }).join('');
      }
    }
    if (hasEvent) {
      var events = await sbGet('events', 'event_date=eq.' + dateStr + '&order=event_time.asc');
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
    var cut7  = new Date(now - 7  * 24 * 60 * 60 * 1000);
    var cut14 = new Date(now - 14 * 24 * 60 * 60 * 1000);
    var bannerItems = data.filter(function(a){ return new Date(a.created_at) >= cut7; });
    var tabItems    = data.filter(function(a){ return new Date(a.created_at) >= cut14; });

    // Banner
    var bannerEl = document.getElementById('home-ann-banner');
    if (bannerEl) {
      if (bannerItems.length) {
        bannerEl.innerHTML = bannerItems.map(function(a) {
          var d = new Date(a.created_at).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' });
          var t = new Date(a.created_at).toLocaleTimeString('en-MY', { hour:'numeric', minute:'2-digit', hour12:true });
          return '<div class="alert-banner" style="margin-bottom:6px;">'
            + '<i class="ti ti-alert-circle"></i>'
            + '<div class="alert-text">'
            + '<div style="font-weight:700;">' + escHtml(a.title) + '</div>'
            + '<div>' + escHtml(a.body) + '</div>'
            + '<div style="font-size:10px;opacity:0.7;margin-top:2px;">' + d + ' · ' + t + '</div>'
            + '</div></div>';
        }).join('');
        bannerEl.style.display = 'block';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    // Tab
    var tabEl = document.getElementById('ann-tab-list');
    if (tabEl) {
      if (!tabItems.length) {
        tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No announcements.</div>';
        return;
      }
      tabEl.innerHTML = tabItems.map(function(ann) {
        var d = new Date(ann.created_at).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' });
        var t = new Date(ann.created_at).toLocaleTimeString('en-MY', { hour:'numeric', minute:'2-digit', hour12:true });
        return '<div class="card card-info" style="margin-bottom:10px;">'
          + '<div class="card-meta"><span class="card-time">' + d + ' · ' + t + '</span></div>'
          + '<div class="card-title">' + escHtml(ann.title) + '</div>'
          + '<div class="card-body">'  + escHtml(ann.body)  + '</div>'
          + '</div>';
      }).join('');
    }
  } catch(e) {}
}
