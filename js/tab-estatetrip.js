// ── tab-estatetrip.js — Estate Trip tab (bottom nav) + Home today's estate trip ──

async function loadEstateTrips() {
  if (window.location.protocol === 'file:') return;
  var today = new Date().toISOString().split('T')[0];
  var avColors = ['av-green','av-amber','av-coral','av-blue','av-purple','av-red'];

  var rawUser = sessionStorage.getItem('mjm_user');
  var me = rawUser ? JSON.parse(rawUser) : {};
  var myEmailLow = (me.email || '').toLowerCase();
  var isAdminUser = me.role === 'hradmin' || me.role === 'superadmin';

  // ── HOME TAB: today's estate trips ──
  var homeEl = document.getElementById('home-estatetrip-today');
  if (homeEl) {
    try {
      var url = SURL + '/rest/v1/estate_trips?trip_date=eq.' + today + '&order=staff_name.asc&limit=50';
      var res  = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data = await res.json();
      if (data && data.length) {
        var names = data.map(function(r){ return r.staff_name; }).join(', ');
        homeEl.innerHTML = '<div class="home-summary-card" onclick="switchNav(\'estatetrip\');loadEstateTrips()">'
          + '<div class="home-summary-ic" style="background:var(--estate-bg);color:var(--estate-text);"><i class="ti ti-car"></i></div>'
          + '<div style="flex:1;min-width:0;"><div class="home-summary-title">Going to Estate Today</div>'
          + '<div class="home-summary-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(names) + '</div></div>'
          + '<div class="home-summary-count">' + data.length + '</div>'
          + '<i class="ti ti-chevron-right home-summary-chev"></i>'
          + '</div>';
      } else {
        homeEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">No estate trips today.</div></div>';
      }
    } catch(e) {
      homeEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">Could not load estate trips.</div></div>';
    }
  }

  // ── ESTATE TRIP TAB: today + upcoming (open to all staff) ──
  var tabEl = document.getElementById('estatetrip-tab-list');
  if (tabEl) {
    try {
      var url2  = SURL + '/rest/v1/estate_trips?trip_date=gte.' + today + '&order=trip_date.asc&limit=200';
      var res2  = await fetch(url2, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data2 = await res2.json();
      if (!data2 || !data2.length) {
        tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No estate trips scheduled.</div>';
        return;
      }
      var todays   = data2.filter(function(r){ return r.trip_date === today; });
      var upcoming = data2.filter(function(r){ return r.trip_date > today; });
      var html2 = '';
      function renderGroup(title, items) {
        if (!items.length) return '';
        var h = '<div class="section-row"><div class="section-title">' + title + '</div></div><div class="card">';
        items.forEach(function(r, i) {
          var ini = r.staff_name.split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
          var avCls = avColors[i % avColors.length];
          var d = new Date(r.trip_date + 'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
          var canManage = isAdminUser || (myEmailLow && r.staff_email && r.staff_email.toLowerCase() === myEmailLow);
          var editBtn = canManage
            ? '<div style="cursor:pointer;color:var(--text-secondary);margin-left:6px;" onclick="editEstateTrip(\'' + escJsAttr(r.id) + '\',\'' + escJsAttr(r.estate_name) + '\',\'' + escJsAttr(r.trip_date) + '\')"><i class="ti ti-pencil"></i></div>'
            : '';
          var delBtn = canManage
            ? '<div style="cursor:pointer;color:var(--red-text);margin-left:6px;" onclick="deleteEstateTrip(\'' + escJsAttr(r.id) + '\')"><i class="ti ti-trash"></i></div>'
            : '';
          h += '<div class="person-row" data-trip-id="' + escHtml(r.id) + '" data-staff-email="' + escHtml(r.staff_email || '') + '">'
            + '<div class="avatar ' + avCls + '">' + ini + '</div>'
            + '<div style="flex:1;"><div class="person-name">' + escHtml(r.staff_name) + '</div>'
            + '<div class="person-sub">Going to ' + escHtml(r.estate_name) + ' · ' + d + '</div></div>'
            + editBtn
            + delBtn
            + '</div>';
        });
        h += '</div>';
        return h;
      }
      html2 += renderGroup('Today', todays);
      html2 += renderGroup('Upcoming', upcoming);
      tabEl.innerHTML = html2;
    } catch(e) {
      tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Could not load estate trips.</div>';
    }
  }
}

// ── ESTATE TRIP — STAFF SELF-SERVICE (open to all staff) ──
var editingEstateTripId = null;

function showEstateTripForm() {
  editingEstateTripId = null;
  document.getElementById('estatetrip-form-title').textContent = 'Add Estate Trip';
  document.getElementById('estatetrip-form-going-to').value = '';
  document.getElementById('estatetrip-form-date').value = '';
  document.getElementById('estatetrip-form').style.display = 'block';
  document.getElementById('estatetrip-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideEstateTripForm() {
  document.getElementById('estatetrip-form').style.display = 'none';
  editingEstateTripId = null;
}

// HR Admin/Super Admin can manage any estate trip entry; everyone else can
// only manage their own, matched by the creating account's email.
function canManageEstateTrip(id) {
  var raw = sessionStorage.getItem('mjm_user');
  var me = raw ? JSON.parse(raw) : {};
  if (me.role === 'hradmin' || me.role === 'superadmin') return true;
  var row = document.querySelector('[data-trip-id="' + id + '"]');
  var ownerEmail = row ? (row.getAttribute('data-staff-email') || '') : '';
  return !!(me.email && ownerEmail && me.email.toLowerCase() === ownerEmail.toLowerCase());
}

function editEstateTrip(id, estateName, tripDate) {
  if (!canManageEstateTrip(id)) return;
  editingEstateTripId = id;
  document.getElementById('estatetrip-form-title').textContent = 'Edit Estate Trip';
  document.getElementById('estatetrip-form-going-to').value = estateName;
  document.getElementById('estatetrip-form-date').value = tripDate;
  document.getElementById('estatetrip-form').style.display = 'block';
  document.getElementById('estatetrip-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveEstateTrip() {
  if (editingEstateTripId && !canManageEstateTrip(editingEstateTripId)) { alert('You can only edit your own estate trip.'); return; }
  var goingTo = document.getElementById('estatetrip-form-going-to').value.trim();
  var date    = document.getElementById('estatetrip-form-date').value;
  if (!goingTo || !date) { alert('Please fill in the estate name and date.'); return; }
  var raw = sessionStorage.getItem('mjm_user');
  var user = raw ? JSON.parse(raw) : {};
  try {
    if (editingEstateTripId) {
      await sbWrite('PATCH', 'estate_trips', { estate_name: goingTo, trip_date: date }, 'id=eq.' + editingEstateTripId);
      editingEstateTripId = null;
    } else {
      await sbWrite('POST', 'estate_trips', { staff_name: user.name || user.email || 'Staff', staff_email: user.email || '', estate_name: goingTo, trip_date: date });
    }
    hideEstateTripForm();
    loadEstateTrips();
    if (typeof loadStaffCalendar === 'function') loadStaffCalendar();
  } catch(e) { alert('Could not save estate trip. ' + (e.message || 'Please try again.')); }
}

async function deleteEstateTrip(id) {
  if (!canManageEstateTrip(id)) { alert('You can only delete your own estate trip.'); return; }
  if (!confirm('Delete this estate trip?')) return;
  try {
    await sbWrite('DELETE', 'estate_trips', null, 'id=eq.' + id);
    loadEstateTrips();
    if (typeof loadStaffCalendar === 'function') loadStaffCalendar();
  } catch(e) { alert('Could not delete estate trip. Please try again.'); }
}
