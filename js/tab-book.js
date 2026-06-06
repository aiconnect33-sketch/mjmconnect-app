// ── tab-book.js — Book tab (Vehicle + Conference Room) ──

var bookTabInited = false;
var vCalYear, vCalMonth, rCalYear, rCalMonth;

function initBookTab() {
  if (bookTabInited) return;
  bookTabInited = true;
  var now = new Date();
  vCalYear = now.getFullYear(); vCalMonth = now.getMonth();
  rCalYear = now.getFullYear(); rCalMonth = now.getMonth();
  if (window.location.protocol !== 'file:') {
    loadVehicleCalendar();
    loadRoomCalendar();
    loadMyVehicleBookings();
  }
}

// ── PILL TOGGLE ──
function switchBookPill(type) {
  var isVehicle = type === 'vehicle';
  document.getElementById('book-panel-vehicle').style.display = isVehicle ? 'block' : 'none';
  document.getElementById('book-panel-room').style.display    = isVehicle ? 'none'  : 'block';
  var pV = document.getElementById('book-pill-vehicle');
  var pR = document.getElementById('book-pill-room');
  pV.style.background = isVehicle ? 'var(--green-dark)' : 'transparent';
  pV.style.color       = isVehicle ? '#fff' : 'var(--text-secondary)';
  pR.style.background  = isVehicle ? 'transparent' : 'var(--green-dark)';
  pR.style.color        = isVehicle ? 'var(--text-secondary)' : '#fff';
}

// ════════════════════════════
//  VEHICLE
// ════════════════════════════

var vIsFullDay = true;

function showVehicleForm() {
  vIsFullDay = true;
  document.getElementById('vehicle-form').style.display = 'block';
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('v-date').min    = today;
  document.getElementById('v-date').value  = '';
  document.getElementById('v-date-to').min = today;
  document.getElementById('v-date-to').value = '';
  document.getElementById('v-time-from').value = '';
  document.getElementById('v-time-to').value   = '';
  document.getElementById('v-purpose').value   = '';
  document.getElementById('v-time-row').style.display = 'none';
  document.getElementById('v-fullday-toggle').className = 'book-toggle on';
  document.getElementById('v-clash-alert').style.display = 'none';
  clearBookErrors(['v-date','v-time-from','v-time-to']);
  hideBookAlert('v-success'); hideBookAlert('v-error');
}

function hideVehicleForm() {
  document.getElementById('vehicle-form').style.display = 'none';
  document.getElementById('v-date-to').value = '';
  document.getElementById('v-clash-alert').style.display = 'none';
  clearBookErrors(['v-date','v-time-from','v-time-to']);
}

function toggleVehicleFullDay() {
  vIsFullDay = !vIsFullDay;
  document.getElementById('v-fullday-toggle').className = 'book-toggle' + (vIsFullDay ? ' on' : '');
  document.getElementById('v-time-row').style.display = vIsFullDay ? 'none' : 'block';
  document.getElementById('v-clash-alert').style.display = 'none';
  checkVehicleClash();
}

function onVehicleDateChange() {
  var df = document.getElementById('v-date').value;
  var dt = document.getElementById('v-date-to');
  if (df) dt.min = df;
  checkVehicleClash();
}

var vehicleBookingsCache = [];
async function checkVehicleClash() {
  var dateFrom = document.getElementById('v-date').value;
  var dateTo   = document.getElementById('v-date-to').value || dateFrom;
  document.getElementById('v-clash-alert').style.display = 'none';
  if (!dateFrom) return;
  try {
    // Check if any existing booking overlaps the selected date range
    var url = SURL + '/rest/v1/vehicle_bookings?booking_date=gte.' + dateFrom + '&booking_date=lte.' + dateTo + '&select=*';
    var res  = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
    vehicleBookingsCache = await res.json() || [];
  } catch(e) { vehicleBookingsCache = []; return; }
  if (!vehicleBookingsCache.length) return;
  var tfrom = document.getElementById('v-time-from').value;
  var tto   = document.getElementById('v-time-to').value;
  var clash = null;
  if (vIsFullDay) {
    clash = vehicleBookingsCache[0];
  } else {
    if (!tfrom || !tto) return;
    clash = vehicleBookingsCache.find(function(b) {
      if (b.is_full_day) return true;
      return tfrom < b.time_to && tto > b.time_from;
    });
  }
  if (clash) {
    var msg = 'Already booked by ' + clash.booked_by;
    msg += clash.is_full_day ? ' on ' + fmtDate(clash.booking_date) + '.' : ' (' + fmtTime(clash.time_from) + '–' + fmtTime(clash.time_to) + ').';
    document.getElementById('v-clash-msg').textContent = msg;
    document.getElementById('v-clash-alert').style.display = 'flex';
  }
}

async function submitVehicleBooking() {
  var dateFrom = document.getElementById('v-date').value;
  var dateTo   = document.getElementById('v-date-to').value || dateFrom;
  var tfrom    = document.getElementById('v-time-from').value;
  var tto      = document.getElementById('v-time-to').value;
  var purpose  = document.getElementById('v-purpose').value.trim();
  var valid    = true;
  clearBookErrors(['v-date','v-time-from','v-time-to']);
  if (!dateFrom) { showBookError('v-date'); valid = false; }
  if (!vIsFullDay) {
    if (!tfrom) { showBookError('v-time-from'); valid = false; }
    if (!tto)   { showBookError('v-time-to');   valid = false; }
    if (valid && tfrom >= tto) { showBookError('v-time-to'); return; }
  }
  if (!valid) return;
  if (document.getElementById('v-clash-alert').style.display !== 'none') return;
  setBookLoading('v-submit-btn','v-submit-label','v-spinner', true);
  try {
    // Generate one row per day in the range
    var dates = [];
    var cur = new Date(dateFrom + 'T00:00:00');
    var end = new Date(dateTo   + 'T00:00:00');
    while (cur <= end) {
      dates.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }
    var posts = dates.map(function(d) {
      return fetch(SURL + '/rest/v1/vehicle_bookings', {
        method: 'POST',
        headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY,
                   'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          booked_by:    getCurrentUserName(),
          booking_date: d,
          is_full_day:  vIsFullDay,
          time_from:    vIsFullDay ? null : tfrom,
          time_to:      vIsFullDay ? null : tto,
          purpose:      purpose || null
        })
      });
    });
    var results = await Promise.all(posts);
    setBookLoading('v-submit-btn','v-submit-label','v-spinner', false);
    var allOk = results.every(function(r){ return r.ok || r.status === 201; });
    if (allOk) {
      hideVehicleForm(); showBookAlert('v-success');
      bookTabInited = false; initBookTab();
      loadMyVehicleBookings();
    } else {
      document.getElementById('v-error-msg').textContent = 'Could not save booking. Please try again.';
      showBookAlert('v-error');
    }
  } catch(e) {
    setBookLoading('v-submit-btn','v-submit-label','v-spinner', false);
    document.getElementById('v-error-msg').textContent = 'Connection error. Try again.';
    showBookAlert('v-error');
  }
}

async function loadVehicleCalendar() {
  var bookedDates = {};
  try {
    var data = await sbGet('vehicle_bookings', 'select=booking_date');
    if (data && data.length) {
      data.forEach(function(b) { bookedDates[b.booking_date] = true; });
    }
  } catch(e) {}
  renderVehicleCalendar(bookedDates);
}

function renderVehicleCalendar(bookedDates) {
  var grid  = document.getElementById('v-cal-grid');
  var label = document.getElementById('v-cal-label');
  if (!grid || !label) return;
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  label.textContent = MONTHS[vCalMonth] + ' ' + vCalYear;
  while (grid.children.length > 7) grid.removeChild(grid.lastChild);
  var firstDay    = new Date(vCalYear, vCalMonth, 1).getDay();
  var daysInMonth = new Date(vCalYear, vCalMonth + 1, 0).getDate();
  var today = new Date();
  for (var i = 0; i < firstDay; i++) { grid.appendChild(document.createElement('div')); }
  for (var d = 1; d <= daysInMonth; d++) {
    var cell = document.createElement('div');
    cell.className = 'cal-day';
    var dateStr  = vCalYear + '-' + String(vCalMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday  = (d === today.getDate() && vCalMonth === today.getMonth() && vCalYear === today.getFullYear());
    var isBooked = bookedDates && bookedDates[dateStr];
    if (isToday) cell.classList.add('today');
    if (isBooked && !isToday) cell.classList.add('booked');
    // Today + booked: show green circle with red ring
    var spanStyle = (isToday && isBooked) ? ' style="outline:2.5px solid #E24B4A;outline-offset:2px;"' : '';
    cell.innerHTML = '<span' + spanStyle + '>' + d + '</span>';
    if (isBooked) {
      cell.style.cursor = 'pointer';
      (function(ds){ cell.onclick = function(){ showDayDetail('vehicle', ds); }; })(dateStr);
    }
    grid.appendChild(cell);
  }
}

function vCalPrev() { vCalMonth--; if (vCalMonth < 0)  { vCalMonth = 11; vCalYear--; } loadVehicleCalendar(); }
function vCalNext() { vCalMonth++; if (vCalMonth > 11) { vCalMonth = 0;  vCalYear++; } loadVehicleCalendar(); }

async function cancelVehicleBookingFromModal(id) {
  if (!confirm('Cancel your vehicle booking?')) return;
  try {
    var res = await fetch(SURL + '/rest/v1/vehicle_bookings?id=eq.' + id, {
      method: 'DELETE',
      headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY }
    });
    if (res.ok) { closeDayModal(); bookTabInited = false; initBookTab(); }
  } catch(e) {}
}

async function loadMyVehicleBookings() {
  var el = document.getElementById('v-my-bookings');
  if (!el) return;
  var me = getCurrentUserName();
  var now = new Date();
  var monthStart = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
  var monthEnd   = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().split('T')[0];
  var today      = now.toISOString().split('T')[0];
  try {
    var url  = SURL + '/rest/v1/vehicle_bookings?booked_by=eq.' + encodeURIComponent(me)
             + '&booking_date=gte.' + monthStart + '&booking_date=lte.' + monthEnd
             + '&booking_date=gte.' + today
             + '&order=booking_date.asc&limit=50';
    var res  = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
    var data = await res.json();
    if (!data || !data.length) {
      el.innerHTML = '<div class="book-empty">No bookings this month.</div>';
      return;
    }
    el.innerHTML = data.map(function(b) {
      var d       = fmtDate(b.booking_date);
      var timeStr = b.is_full_day ? 'Full Day' : fmtTime(b.time_from) + ' – ' + fmtTime(b.time_to);
      return '<div class="book-item">'
        + '<div class="book-item-header">'
        + '<div class="book-item-name">' + d + '</div>'
        + '<span class="badge badge-info">Mine</span></div>'
        + '<div class="book-item-date"><i class="ti ti-clock" style="font-size:11px;"></i> ' + timeStr + '</div>'
        + (b.purpose ? '<div class="book-item-purpose">' + escHtml(b.purpose) + '</div>' : '')
        + '<button class="book-cancel-btn" onclick="cancelMyVehicleBooking(\'' + b.id + '\')">'
        + '<i class="ti ti-trash"></i> Cancel this booking</button>'
        + '</div>';
    }).join('');
  } catch(e) { el.innerHTML = '<div class="book-empty">Could not load bookings.</div>'; }
}

async function cancelMyVehicleBooking(id) {
  if (!confirm('Cancel this vehicle booking?')) return;
  try {
    await fetch(SURL + '/rest/v1/vehicle_bookings?id=eq.' + id, {
      method: 'DELETE',
      headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY }
    });
    bookTabInited = false; initBookTab();
  } catch(e) {}
}

// ════════════════════════════
//  CONFERENCE ROOM
// ════════════════════════════

function showRoomForm() {
  document.getElementById('room-form').style.display = 'block';
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('r-date').min = today;
  hideBookAlert('r-success'); hideBookAlert('r-error');
}

function hideRoomForm() {
  document.getElementById('room-form').style.display = 'none';
  document.getElementById('r-date').value      = '';
  document.getElementById('r-time-from').value = '';
  document.getElementById('r-time-to').value   = '';
  document.getElementById('r-purpose').value   = '';
  document.getElementById('r-clash-alert').style.display = 'none';
  clearBookErrors(['r-date','r-time-from','r-time-to']);
}

var roomBookingsCache = [];
async function loadRoomSlots() {
  var date = document.getElementById('r-date').value;
  if (!date) return;
  try {
    var data = await sbGet('room_bookings', 'booking_date=eq.' + date + '&order=time_from.asc');
    roomBookingsCache = data || [];
  } catch(e) { roomBookingsCache = []; }
  checkRoomClash();
}

function checkRoomClash() {
  var from = document.getElementById('r-time-from').value;
  var to   = document.getElementById('r-time-to').value;
  document.getElementById('r-clash-alert').style.display = 'none';
  if (!from || !to || !roomBookingsCache.length) return;
  var clash = roomBookingsCache.find(function(b) {
    return from < b.time_to && to > b.time_from;
  });
  if (clash) {
    document.getElementById('r-clash-msg').textContent =
      'Already booked by ' + clash.booked_by + ' (' + fmtTime(clash.time_from) + '–' + fmtTime(clash.time_to) + ').';
    document.getElementById('r-clash-alert').style.display = 'flex';
  }
}

async function submitRoomBooking() {
  var date    = document.getElementById('r-date').value;
  var tfrom   = document.getElementById('r-time-from').value;
  var tto     = document.getElementById('r-time-to').value;
  var purpose = document.getElementById('r-purpose').value.trim();
  var valid   = true;
  clearBookErrors(['r-date','r-time-from','r-time-to']);
  if (!date)  { showBookError('r-date');      valid = false; }
  if (!tfrom) { showBookError('r-time-from'); valid = false; }
  if (!tto)   { showBookError('r-time-to');   valid = false; }
  if (!valid) return;
  if (tfrom >= tto) { showBookError('r-time-to'); return; }
  if (document.getElementById('r-clash-alert').style.display !== 'none') return;
  setBookLoading('r-submit-btn','r-submit-label','r-spinner', true);
  try {
    var body = JSON.stringify({
      booked_by:    getCurrentUserName(),
      booking_date: date,
      time_from:    tfrom,
      time_to:      tto,
      purpose:      purpose || null
    });
    var res = await fetch(SURL + '/rest/v1/room_bookings', {
      method: 'POST',
      headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY,
                 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: body
    });
    setBookLoading('r-submit-btn','r-submit-label','r-spinner', false);
    if (res.ok || res.status === 201) {
      hideRoomForm(); showBookAlert('r-success');
      bookTabInited = false; initBookTab();
    } else {
      document.getElementById('r-error-msg').textContent = 'Could not save booking. Please try again.';
      showBookAlert('r-error');
    }
  } catch(e) {
    setBookLoading('r-submit-btn','r-submit-label','r-spinner', false);
    document.getElementById('r-error-msg').textContent = 'Connection error. Try again.';
    showBookAlert('r-error');
  }
}

async function loadRoomCalendar() {
  var bookedDates = {};
  try {
    var data = await sbGet('room_bookings', 'select=booking_date');
    if (data && data.length) {
      data.forEach(function(b) { bookedDates[b.booking_date] = true; });
    }
  } catch(e) {}
  renderRoomCalendar(bookedDates);
}

function renderRoomCalendar(bookedDates) {
  var grid  = document.getElementById('r-cal-grid');
  var label = document.getElementById('r-cal-label');
  if (!grid || !label) return;
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  label.textContent = MONTHS[rCalMonth] + ' ' + rCalYear;
  while (grid.children.length > 7) grid.removeChild(grid.lastChild);
  var firstDay    = new Date(rCalYear, rCalMonth, 1).getDay();
  var daysInMonth = new Date(rCalYear, rCalMonth + 1, 0).getDate();
  var today = new Date();
  for (var i = 0; i < firstDay; i++) { grid.appendChild(document.createElement('div')); }
  for (var d = 1; d <= daysInMonth; d++) {
    var cell = document.createElement('div');
    cell.className = 'cal-day';
    var dateStr  = rCalYear + '-' + String(rCalMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday  = (d === today.getDate() && rCalMonth === today.getMonth() && rCalYear === today.getFullYear());
    var isBooked = bookedDates && bookedDates[dateStr];
    if (isToday)  cell.classList.add('today');
    if (isBooked) {
      cell.classList.add('booked');
      cell.style.cursor = 'pointer';
      (function(ds){ cell.onclick = function(){ showDayDetail('room', ds); }; })(dateStr);
    }
    cell.innerHTML = '<span>' + d + '</span>';
    grid.appendChild(cell);
  }
}

function rCalPrev() { rCalMonth--; if (rCalMonth < 0)  { rCalMonth = 11; rCalYear--; } loadRoomCalendar(); }
function rCalNext() { rCalMonth++; if (rCalMonth > 11) { rCalMonth = 0;  rCalYear++; } loadRoomCalendar(); }

async function cancelRoomBooking(id) {
  if (!confirm('Cancel your room booking?')) return;
  try {
    var res = await fetch(SURL + '/rest/v1/room_bookings?id=eq.' + id, {
      method: 'DELETE',
      headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY }
    });
    if (res.ok) { closeDayModal(); bookTabInited = false; initBookTab(); }
  } catch(e) {}
}

// ════════════════════════════
//  DAY DETAIL MODAL
// ════════════════════════════

async function showDayDetail(type, dateStr) {
  var modal = document.getElementById('book-day-modal');
  var title = document.getElementById('book-day-modal-title');
  var body  = document.getElementById('book-day-modal-body');
  var icon  = type === 'vehicle' ? '🚗' : '🏢';
  title.textContent = icon + ' ' + fmtDate(dateStr);
  body.innerHTML = '<div class="book-empty">Loading...</div>';
  modal.style.display = 'block';
  try {
    var me   = getCurrentUserName();
    var data = type === 'vehicle'
      ? await sbGet('vehicle_bookings', 'booking_date=eq.' + dateStr + '&order=time_from.asc')
      : await sbGet('room_bookings',    'booking_date=eq.' + dateStr + '&order=time_from.asc');
    if (!data || data.length === 0) {
      body.innerHTML = '<div class="book-empty">No bookings found.</div>'; return;
    }
    body.innerHTML = data.map(function(b) {
      var isMine   = b.booked_by === me;
      var timeStr  = type === 'vehicle'
        ? (b.is_full_day ? 'Full Day' : fmtTime(b.time_from) + ' – ' + fmtTime(b.time_to))
        : fmtTime(b.time_from) + ' – ' + fmtTime(b.time_to);
      var cancelFn = type === 'vehicle'
        ? 'cancelVehicleBookingFromModal(\'' + b.id + '\')'
        : 'cancelRoomBooking(\'' + b.id + '\')';
      return '<div class="book-item" style="margin-bottom:8px;">'
        + '<div class="book-item-header"><div class="book-item-name">' + escHtml(b.booked_by) + '</div>'
        + '<span class="badge ' + (isMine ? 'badge-info' : 'badge-amber') + '">' + (isMine ? 'Mine' : 'Booked') + '</span></div>'
        + '<div class="book-item-date"><i class="ti ti-clock" style="font-size:11px;"></i> ' + timeStr + '</div>'
        + (b.purpose ? '<div class="book-item-purpose">' + escHtml(b.purpose) + '</div>' : '')
        + (isMine ? '<button class="book-cancel-btn" onclick="' + cancelFn + '"><i class="ti ti-trash"></i> Cancel my booking</button>' : '')
        + '</div>';
    }).join('');
  } catch(e) { body.innerHTML = '<div class="book-empty">Could not load bookings.</div>'; }
}

function closeDayModal() {
  document.getElementById('book-day-modal').style.display = 'none';
}

// ════════════════════════════
//  HELPERS
// ════════════════════════════

function fmtDate(str) {
  if (!str) return '';
  return new Date(str + 'T00:00:00').toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' });
}

function fmtTime(str) {
  if (!str) return '';
  var parts = str.split(':');
  var h = parseInt(parts[0]); var m = parts[1];
  var ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + m + ' ' + ap;
}

function showBookAlert(id) {
  var el = document.getElementById(id);
  if (el) { el.classList.add('visible'); setTimeout(function(){ el.classList.remove('visible'); }, 4000); }
}
function hideBookAlert(id) {
  var el = document.getElementById(id); if (el) el.classList.remove('visible');
}
function showBookError(fieldId) {
  var input = document.getElementById(fieldId); if (input) input.classList.add('error');
  var err   = document.getElementById(fieldId + '-error'); if (err) err.classList.add('visible');
}
function clearBookErrors(ids) {
  ids.forEach(function(id) {
    var input = document.getElementById(id); if (input) input.classList.remove('error');
    var err   = document.getElementById(id + '-error'); if (err) err.classList.remove('visible');
  });
}
function setBookLoading(btnId, labelId, spinnerId, on) {
  var btn = document.getElementById(btnId); if (btn) btn.disabled = on;
  var lbl = document.getElementById(labelId); if (lbl) lbl.style.display = on ? 'none' : 'inline';
  var spn = document.getElementById(spinnerId); if (spn) spn.style.display = on ? 'block' : 'none';
}
