// ── FAULTY COMPLAIN ──
// Native in-app replacement for the old Google Form Quick Access link.
// Submissions go straight into Supabase (faulty_complaints table + a
// faulty-photos storage bucket). Optionally, if FC_SHEET_WEBHOOK_URL is
// set to a deployed Google Apps Script Web App URL, each submission is
// also best-effort mirrored into a Google Sheet (with the photo copied
// into a Drive folder) — see docs/faulty-complain-sheet-sync.md for the
// script + one-time setup steps. Left blank, that side is simply skipped.
var FC_SHEET_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbx7_RMgbD7BLAqIb4BUCwIEMvpI4UJaIF3LNuhcKur6tOibCrjtVpECogIrGF8y25w/exec';
var FC_SHEET_SECRET = 'UOhnuGd169-c7WkKtKZcMvq6S9i-Se-O';
var FC_BUCKET = 'faulty-photos';

var FC_LOCATIONS = [
  "1st Floor (From Entrance to Herrick's office)",
  "1st Floor (Newly refurbished area)",
  "2nd Floor - New Wing (From Ryan's office to Mr. Pui's office)",
  "2nd Floor - Old Wing (From the stairs to Coco's office)"
];
var FC_ITEMS = [
  "Printer - Paper jam", "Printer - Scanning / printing issue", "Printer - Cartridge replacement",
  "Washroom - Clogging toilet", "Washroom - Bidet issues", "Washroom - broken toilet seat",
  "Washroom - building issues such as leaking pipes / basin", "Lighting issues", "Air conditioner issues",
  "Water dispenser issues", "Chair issues", "Table / drawer issues", "Cabinet issues", "Electrical issues",
  "Other Issues (Please state item and describe the issue)"
];

var FC_DUTY_ROLE = 'Faulty Complaint Maintenance';

var faultyTabInited = false;
var fcState = { loc: null, item: null, itemOther: '', urgency: null, photoFile: null, photoObjectUrl: null };

function initFaultyTab() {
  if (faultyTabInited) return;
  faultyTabInited = true;
  var raw = sessionStorage.getItem('mjm_user');
  var u = raw ? JSON.parse(raw) : {};
  var nameEl = document.getElementById('fc-staff-name');
  if (nameEl) nameEl.textContent = u.name || u.email || 'Unknown';

  renderFcOptionList('fc-loc-list', FC_LOCATIONS);
  renderFcOptionList('fc-item-list', FC_ITEMS);

  loadTeamComplaints();
}

// Is the logged-in staff member currently assigned the "Faulty Complaint
// Maintenance" On Duty role for today? Matched by email when the roster
// row has one (immune to display-name changes), falling back to name for
// older/legacy roster rows that predate the staff_email column.
async function isFaultyMaintainer() {
  var raw = sessionStorage.getItem('mjm_user');
  var u = raw ? JSON.parse(raw) : {};
  var today = localDateStr();
  try {
    var data = await sbGet('duty_roster', 'duty_role=eq.' + encodeURIComponent(FC_DUTY_ROLE) + '&date_from=lte.' + today + '&date_to=gte.' + today);
    if (!data || !data.length) return false;
    return data.some(function (r) {
      if (u.email && r.staff_email) return r.staff_email.toLowerCase() === u.email.toLowerCase();
      return u.name && r.staff_name && r.staff_name.toLowerCase() === u.name.toLowerCase();
    });
  } catch (e) { return false; }
}

// Option rows carry their value in data-val; clicks are handled by the
// single delegated listener below (keyed by which list they're inside),
// since onclick attributes can't safely carry arbitrary text values.
function renderFcOptionList(listId, options) {
  var el = document.getElementById(listId);
  if (!el) return;
  el.innerHTML = options.map(function (o) {
    return '<div class="fc-option-row" data-val="' + escHtml(o) + '">' + escHtml(o) + '</div>';
  }).join('');
}

document.addEventListener('click', function (e) {
  var row = e.target.closest && e.target.closest('.fc-option-row');
  if (!row) return;
  var listEl = row.closest('.fc-option-list');
  if (!listEl) return;
  var val = row.getAttribute('data-val');
  if (listEl.id === 'fc-loc-list') selectFcOption('loc', val);
  else if (listEl.id === 'fc-item-list') selectFcOption('item', val);
});

function toggleFcList(which) {
  var field = document.getElementById('fc-' + which + '-field');
  var list = document.getElementById('fc-' + which + '-list');
  if (!field || !list) return;
  var opening = list.style.display === 'none';
  document.querySelectorAll('.fc-option-list').forEach(function (l) { l.style.display = 'none'; });
  document.querySelectorAll('.fc-select').forEach(function (f) { f.classList.remove('open'); });
  if (opening) { list.style.display = 'block'; field.classList.add('open'); }
}

function selectFcOption(which, val) {
  fcState[which] = val;
  var label = document.getElementById('fc-' + which + '-label');
  var field = document.getElementById('fc-' + which + '-field');
  if (label) label.textContent = val;
  if (field) { field.classList.remove('placeholder', 'error'); field.classList.remove('open'); }
  var list = document.getElementById('fc-' + which + '-list');
  if (list) list.style.display = 'none';
  var err = document.getElementById('fc-' + which + '-err');
  if (err) err.classList.remove('visible');
  if (which === 'item') {
    var otherInput = document.getElementById('fc-item-other');
    if (otherInput) otherInput.style.display = val.indexOf('Other Issues') === 0 ? 'block' : 'none';
  }
}

function setFcUrgency(u) {
  fcState.urgency = u;
  document.querySelectorAll('.fc-urgency-pill').forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-u') === u); });
  var err = document.getElementById('fc-urgency-err');
  if (err) err.classList.remove('visible');
}

// ── Photo attach: two real file inputs (camera vs. library/files) ──
document.addEventListener('change', function (e) {
  if (!e.target.matches('#fc-photo-camera, #fc-photo-file')) return;
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  fcState.photoFile = file;
  renderFcPhotoThumb(file);
});

function renderFcPhotoThumb(file) {
  var area = document.getElementById('fc-photo-area');
  if (!area) return;
  if (fcState.photoObjectUrl) { URL.revokeObjectURL(fcState.photoObjectUrl); fcState.photoObjectUrl = null; }
  var thumb = document.createElement('div');
  thumb.className = 'fc-photo-thumb';
  var swatch = document.createElement('span');
  swatch.className = 'fc-photo-swatch';
  if (file.type.indexOf('image/') === 0) {
    fcState.photoObjectUrl = URL.createObjectURL(file);
    swatch.style.background = 'center / cover no-repeat url(' + fcState.photoObjectUrl + ')';
  }
  thumb.appendChild(swatch);
  var label = document.createElement('span');
  label.textContent = file.name + ' · ' + Math.round(file.size / 1024) + 'KB';
  thumb.appendChild(label);
  var rm = document.createElement('span');
  rm.className = 'fc-rm';
  rm.textContent = '✕';
  rm.onclick = resetFcPhoto;
  thumb.appendChild(rm);
  area.innerHTML = '';
  area.appendChild(thumb);
}

function resetFcPhoto() {
  fcState.photoFile = null;
  if (fcState.photoObjectUrl) { URL.revokeObjectURL(fcState.photoObjectUrl); fcState.photoObjectUrl = null; }
  var area = document.getElementById('fc-photo-area');
  if (!area) return;
  area.innerHTML = '<label class="fc-btn-attach" for="fc-photo-camera"><i class="ti ti-camera"></i> Take Photo</label>'
    + '<input type="file" id="fc-photo-camera" accept="image/*" capture="environment" style="display:none;">'
    + '<label class="fc-btn-attach" for="fc-photo-file"><i class="ti ti-paperclip"></i> Add File</label>'
    + '<input type="file" id="fc-photo-file" accept="image/*,video/*" style="display:none;">';
}

function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      var result = reader.result; // data:<mime>;base64,<data>
      var comma = result.indexOf(',');
      resolve(result.slice(comma + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadFcPhoto(file) {
  var safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  var path = 'faulty/' + Date.now() + '-' + safeName;
  var res = await fetch(SURL + '/storage/v1/object/' + FC_BUCKET + '/' + path, {
    method: 'POST',
    headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY, 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  });
  if (!res.ok) throw new Error('Photo upload failed: ' + res.status);
  return SURL + '/storage/v1/object/public/' + FC_BUCKET + '/' + path;
}

// Best-effort — mirrors the submission into a Google Sheet (and the photo
// into a Drive folder) via a small Apps Script Web App. Fire-and-forget:
// no-cors means we can't read the response, so this never blocks or fails
// the real submission, which already succeeded in Supabase by this point.
async function syncFcToSheet(payload, file, id) {
  if (!FC_SHEET_WEBHOOK_URL) return;
  try {
    var body = {
      secret: FC_SHEET_SECRET,
      action: 'create',
      id: id || null,
      timestamp: new Date().toISOString(),
      staffName: payload.staff_name, location: payload.location, item: payload.item,
      itemOther: payload.item_other, description: payload.description, urgency: payload.urgency,
      photoName: null, photoMime: null, photoBase64: null
    };
    if (file) {
      body.photoName = file.name;
      body.photoMime = file.type;
      body.photoBase64 = await fileToBase64(file);
    }
    fetch(FC_SHEET_WEBHOOK_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(body) }).catch(function () {});
  } catch (e) { /* best-effort only */ }
}

// Best-effort — tells the same Apps Script to flip an existing Sheet row's
// Status column, matched by the complaint's Supabase id written at create time.
function syncFcResolveToSheet(id, action, resolvedBy) {
  if (!FC_SHEET_WEBHOOK_URL || !id) return;
  try {
    var body = { secret: FC_SHEET_SECRET, action: action, id: id, resolvedBy: resolvedBy || null, resolvedAt: new Date().toISOString() };
    fetch(FC_SHEET_WEBHOOK_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(body) }).catch(function () {});
  } catch (e) { /* best-effort only */ }
}

function clearFcErrors() {
  document.querySelectorAll('#screen-faulty .book-field-error').forEach(function (e) { e.classList.remove('visible'); });
  document.querySelectorAll('#screen-faulty .fc-select').forEach(function (e) { e.classList.remove('error'); });
}

async function submitFaultyComplaint() {
  clearFcErrors();
  var desc = document.getElementById('fc-desc').value.trim();
  var itemOther = document.getElementById('fc-item-other').value.trim();
  var valid = true;

  if (!fcState.loc) { document.getElementById('fc-loc-err').classList.add('visible'); document.getElementById('fc-loc-field').classList.add('error'); valid = false; }
  var isOther = fcState.item && fcState.item.indexOf('Other Issues') === 0;
  if (!fcState.item || (isOther && !itemOther)) { document.getElementById('fc-item-err').classList.add('visible'); document.getElementById('fc-item-field').classList.add('error'); valid = false; }
  if (!desc) { document.getElementById('fc-desc-err').classList.add('visible'); valid = false; }
  if (!fcState.urgency) { document.getElementById('fc-urgency-err').classList.add('visible'); valid = false; }
  if (!valid) return;

  setFcLoading(true);
  hideFcAlert('fc-success'); hideFcAlert('fc-error');
  try {
    var raw = sessionStorage.getItem('mjm_user');
    var u = raw ? JSON.parse(raw) : {};
    var photoUrl = null;
    if (fcState.photoFile) photoUrl = await uploadFcPhoto(fcState.photoFile);

    var payload = {
      staff_email: u.email || null,
      staff_name: u.name || u.email || 'Unknown',
      location: fcState.loc,
      item: isOther ? 'Other Issues' : fcState.item,
      item_other: isOther ? itemOther : null,
      description: desc,
      photo_url: photoUrl,
      urgency: fcState.urgency,
      status: 'open'
    };
    var inserted = await sbWrite('POST', 'faulty_complaints', payload);
    var newId = inserted && inserted[0] ? inserted[0].id : null;
    syncFcToSheet(payload, fcState.photoFile, newId);

    resetFaultyForm();
    showFcAlert('fc-success');
    loadTeamComplaints();
  } catch (e) {
    document.getElementById('fc-error-msg').textContent = e.message || 'Could not submit complaint.';
    showFcAlert('fc-error');
  } finally {
    setFcLoading(false);
  }
}

function resetFaultyForm() {
  resetFcPhoto(); // revokes any object URL before it's dropped
  fcState.loc = null; fcState.item = null; fcState.itemOther = ''; fcState.urgency = null;
  document.getElementById('fc-loc-label').textContent = 'Tap to select location';
  document.getElementById('fc-loc-field').classList.add('placeholder');
  document.getElementById('fc-item-label').textContent = 'Tap to select item';
  document.getElementById('fc-item-field').classList.add('placeholder');
  document.getElementById('fc-item-other').style.display = 'none';
  document.getElementById('fc-item-other').value = '';
  document.getElementById('fc-desc').value = '';
  document.querySelectorAll('.fc-urgency-pill').forEach(function (p) { p.classList.remove('active'); });
  clearFcErrors();
}

function setFcLoading(loading) {
  var btn = document.getElementById('fc-submit-btn');
  var label = document.getElementById('fc-submit-label');
  var spinner = document.getElementById('fc-spinner');
  if (btn) btn.disabled = loading;
  if (label) label.style.display = loading ? 'none' : 'inline';
  if (spinner) spinner.style.display = loading ? 'block' : 'none';
}

function showFcAlert(id) { var el = document.getElementById(id); if (el) el.classList.add('visible'); }
function hideFcAlert(id) { var el = document.getElementById(id); if (el) el.classList.remove('visible'); }

function fcUrgencyBadge(u) {
  if (u === 'immediate') return '<span class="badge badge-urgent">Immediate</span>';
  if (u === 'urgent') return '<span class="badge badge-amber">Urgent</span>';
  return '<span class="badge badge-success">Non-urgent</span>';
}

async function loadTeamComplaints() {
  var el = document.getElementById('fc-team-complaints');
  var bannerEl = document.getElementById('fc-duty-banner');
  if (!el) return;
  var onDuty = await isFaultyMaintainer();
  if (bannerEl) {
    bannerEl.innerHTML = onDuty
      ? '<div class="fc-duty-banner on"><i class="ti ti-tool"></i> You\'re on Faulty Complaint Maintenance duty this month — you can resolve any complaint below.</div>'
      : '<div class="fc-duty-banner off"><i class="ti ti-eye"></i> You can see every complaint, but only this month\'s maintenance duty can mark them resolved.</div>';
  }
  try {
    var data = await sbGet('faulty_complaints', 'status=eq.open&order=created_at.desc&limit=100');
    if (!data || !data.length) { el.innerHTML = '<div class="book-empty">No open complaints right now.</div>'; return; }
    el.innerHTML = data.map(function (c) {
      var itemLabel = c.item === 'Other Issues' && c.item_other ? c.item_other : c.item;
      var d = new Date(c.created_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
      var resolveBtn = onDuty ? '<button class="fc-btn-resolve" onclick="resolveFaultyComplaint(' + c.id + ')">✓ Mark Resolved</button>' : '';
      return '<div class="book-item">'
        + '<div class="book-item-header"><div class="book-item-name">' + escHtml(itemLabel) + '</div>' + fcUrgencyBadge(c.urgency) + '</div>'
        + '<div class="book-item-date">' + escHtml(c.location) + ' · ' + d + '</div>'
        + '<div class="book-item-purpose">' + escHtml(c.description) + '</div>'
        + '<div style="font-size:10.5px;color:var(--text-light);margin-top:4px;">Submitted by ' + escHtml(c.staff_name) + '</div>'
        + resolveBtn
        + '</div>';
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="book-empty">Could not load complaints.</div>';
  }
}

async function resolveFaultyComplaint(id) {
  var raw = sessionStorage.getItem('mjm_user');
  var u = raw ? JSON.parse(raw) : {};
  var resolvedBy = u.name || u.email || 'Unknown';
  try {
    await sbWrite('PATCH', 'faulty_complaints', { status: 'resolved', resolved_by: resolvedBy, resolved_at: new Date().toISOString() }, 'id=eq.' + id);
    syncFcResolveToSheet(id, 'resolve', resolvedBy);
    loadTeamComplaints();
  } catch (e) {
    alert('Could not update: ' + e.message);
  }
}
