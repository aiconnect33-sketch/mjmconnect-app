// ── faulty-progress.js — "In Progress" step for Faulty Complain ──
// Shared by index.html (Team Complaints, via js/tab-faulty.js) and
// admin.html (All Complaints). Lets someone on duty say "I'll handle this"
// so nobody else doubles up, and lets anyone post short updates as things
// change, so the whole team can see where a complaint stands.
//
// Data (see docs/faulty-in-progress-schema.sql):
//   faulty_complaints.status            'open' | 'in_progress' | 'resolved'
//   faulty_complaints.handled_by(_email) who tapped "I'll handle this", and when (handled_at)
//   faulty_complaint_updates            one row per note: 'claim' | 'update' | 'resolve'
//
// Relies on the page's own SURL / SKEY / escHtml globals (js/core.js on the
// staff app, inline in admin.html), and on each page defining:
//   fcpReload()  -- re-fetch and redraw its complaint list after a change
// Optional, used when present: syncFcResolveToSheet(), notifyFaultyClaimPush().

var fcpUpdates = {};     // complaint id -> [update rows], newest first
var fcpComplaints = {};  // complaint id -> complaint row, from the last render
var fcpExpanded = {};    // complaint id -> true while its full history is shown
var fcpListFilter = 'all'; // 'all' | 'open' | 'in_progress' | 'resolved'
var fcpBusy = false;
var fcpLastNameMap = {}; // email -> current name, for redrawing the history on toggle

// Styles live here rather than in each page so the staff and admin cards
// can't drift apart. Plain colour values on purpose: the two pages name
// their CSS variables differently.
(function fcpInjectStyles() {
  if (document.getElementById('fcp-styles')) return;
  var css = ''
    + '.fcp-filters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}'
    + '.fcp-pill{font-size:11px;font-weight:700;padding:5px 11px;border-radius:16px;border:1px solid #C3D2CB;color:#6B7A73;background:#fff;font-family:inherit;cursor:pointer}'
    + '.fcp-pill.active{background:#0F6E5C;border-color:#0F6E5C;color:#fff}'
    + '.fcp-pill .n{opacity:.75;font-weight:600}'
    + '.fcp-handled{background:#E6F1FB;border-radius:10px;padding:9px 10px;margin-bottom:10px}'
    + '.fcp-handled.done{background:#F4F6F5}'
    + '.fcp-handled-top{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#185FA5;font-weight:600}'
    + '.fcp-handled.done .fcp-handled-top{color:#6B7A73}'
    + '.fcp-you{margin-left:auto;font-size:9.5px;font-weight:700;background:#fff;color:#185FA5;border-radius:10px;padding:1px 7px}'
    + '.fcp-updates{margin-top:8px;border-left:2px solid #B9D3EE;padding-left:10px;display:flex;flex-direction:column;gap:7px}'
    + '.fcp-handled.done .fcp-updates{border-left-color:#D5DEDA}'
    + '.fcp-upd-when{font-size:9.5px;color:#5B7A99;font-weight:600}'
    + '.fcp-handled.done .fcp-upd-when{color:#9AABA3}'
    + '.fcp-upd-text{font-size:11.5px;color:#111C18;line-height:1.45;white-space:pre-wrap;word-break:break-word}'
    + '.fcp-latest{font-size:9px;font-weight:700;color:#fff;background:#185FA5;border-radius:8px;padding:0 6px;margin-left:5px}'
    + '.fcp-handled.done .fcp-latest{background:#9AABA3}'
    + '.fcp-toggle{display:flex;align-items:center;gap:5px;width:100%;margin-top:8px;background:#fff;border:1px dashed #B9D3EE;border-radius:8px;padding:6px 9px;font-family:inherit;font-size:11px;font-weight:600;color:#185FA5;text-align:left;cursor:pointer}'
    + '.fcp-toggle i{font-size:10px}'
    + '.fcp-row{display:flex;gap:8px;margin-top:8px}'
    + '.fcp-row>button{flex:1;margin-top:0!important}'
    + '.fcp-btn-handle{width:100%;margin-top:8px;background:#185FA5;color:#fff;border:none;border-radius:8px;padding:9px;font-size:12px;font-weight:700;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer}'
    + '.fcp-btn-resolve-ghost{width:100%;margin-top:8px;background:#fff;color:#0F6E5C;border:1px solid #0F6E5C;border-radius:8px;padding:8px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer}'
    + '.fcp-btn-update{background:#fff;color:#185FA5;border:1px solid #185FA5;border-radius:8px;padding:8px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer}'
    + '.fcp-btn-solid-resolve{background:#0F6E5C;color:#fff;border:none;border-radius:8px;padding:8px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer}'
    + '.fcp-form{background:#E6F1FB;border-radius:10px;padding:10px;margin-top:8px}'
    + '.fcp-form.resolve{background:#E1F5EE}'
    + '.fcp-form-label{font-size:11px;font-weight:700;color:#185FA5;margin-bottom:6px}'
    + '.fcp-form.resolve .fcp-form-label{color:#085041}'
    + '.fcp-form textarea{display:block;width:100%;box-sizing:border-box;background:#fff;border:1px solid #B9D3EE;border-radius:8px;padding:8px 10px;font-size:12.5px;font-family:inherit;color:#111C18;min-height:56px;line-height:1.45;resize:vertical}'
    + '.fcp-form.resolve textarea{border-color:#A9DCC9}'
    + '.fcp-form-hint{font-size:10px;color:#5B7A99;margin-top:5px}'
    + '.fcp-form-err{font-size:10.5px;color:#A32D2D;margin-top:5px;display:none}'
    + '.fcp-btn-cancel{background:transparent;color:#6B7A73;border:1px solid #CBD7D2;border-radius:8px;padding:8px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer}'
    + '.fcp-btn-confirm{background:#185FA5;color:#fff;border:none;border-radius:8px;padding:8px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer}'
    + '.fcp-form.resolve .fcp-btn-confirm{background:#0F6E5C}'
    + '.fcp-btn-confirm:disabled{opacity:.6}';
  var s = document.createElement('style');
  s.id = 'fcp-styles';
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
})();

function fcpMe() {
  var raw = localStorage.getItem('mjm_user');
  var u = raw ? JSON.parse(raw) : {};
  return { name: u.name || u.email || 'Unknown', email: (u.email || '').toLowerCase() };
}

async function fcpFetch(method, path, body, prefer) {
  var headers = { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY, 'Content-Type': 'application/json' };
  if (prefer) headers['Prefer'] = prefer;
  var res = await fetch(SURL + '/rest/v1/' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    var detail = '';
    try { var e = await res.json(); detail = e.message || e.hint || ''; } catch (x) {}
    throw new Error('Request failed: ' + res.status + (detail ? ' - ' + detail : ''));
  }
  try { return await res.json(); } catch (x) { return null; }
}

// Loads the update history for the complaints about to be drawn. Quietly
// leaves it empty if the table isn't there yet, so the list still works.
async function fcpLoadUpdates(complaints) {
  fcpUpdates = {};
  fcpComplaints = {};
  (complaints || []).forEach(function (c) { fcpComplaints[c.id] = c; });
  var ids = Object.keys(fcpComplaints);
  if (!ids.length) return;
  try {
    var rows = await fcpFetch('GET', 'faulty_complaint_updates?complaint_id=in.(' + ids.join(',') + ')&order=created_at.desc');
    if (Array.isArray(rows)) rows.forEach(function (r) { (fcpUpdates[r.complaint_id] = fcpUpdates[r.complaint_id] || []).push(r); });
  } catch (e) {}
}

function fcpItemLabel(c) { return c.item === 'Other Issues' && c.item_other ? c.item_other : c.item; }

function fcpName(email, fallback, nameMap) {
  var key = (email || '').toLowerCase();
  return (key && nameMap && nameMap[key]) || fallback || 'Someone';
}

// "12 Nov, 10:05 AM"
function fcpShortDateTime(iso) {
  var d = new Date(iso);
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
    + ', ' + d.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ── List filter (All / Open / In Progress / Resolved) ──
function fcpMatchesFilter(c) {
  return fcpListFilter === 'all' || (c.status || 'open') === fcpListFilter;
}

function fcpFilterBarHtml(complaints) {
  var n = { open: 0, in_progress: 0, resolved: 0 };
  complaints.forEach(function (c) { var s = c.status || 'open'; if (n[s] !== undefined) n[s]++; });
  function pill(key, label, count) {
    return '<button class="fcp-pill' + (fcpListFilter === key ? ' active' : '') + '" onclick="fcpSetFilter(\'' + key + '\')">'
      + label + (count ? ' <span class="n">' + count + '</span>' : '') + '</button>';
  }
  return '<div class="fcp-filters">' + pill('all', 'All', 0) + pill('open', 'Open', n.open)
    + pill('in_progress', 'In Progress', n.in_progress) + pill('resolved', 'Resolved', n.resolved) + '</div>';
}

function fcpSetFilter(f) {
  fcpListFilter = f;
  if (typeof fcpReload === 'function') fcpReload();
}

// ── "Handled by" box with the update history ──
// Only the newest update shows until "Show N earlier updates" is tapped.
function fcpHandledHtml(c, nameMap) {
  fcpLastNameMap = nameMap || {};
  var ups = fcpUpdates[c.id] || [];
  if (!c.handled_by && !ups.length) return '';
  var me = fcpMe();
  var done = c.status === 'resolved';
  var top;
  if (c.handled_by) {
    var who = fcpName(c.handled_by_email, c.handled_by, nameMap);
    var mine = !done && me.email && (c.handled_by_email || '').toLowerCase() === me.email;
    var since = !done && !mine && c.handled_at
      ? ' · since ' + new Date(c.handled_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) : '';
    top = '<i class="ti ti-tool"></i> Handled by ' + escHtml(who) + since + (mine ? '<span class="fcp-you">YOU</span>' : '');
  } else {
    top = '<i class="ti ti-notes"></i> Updates';
  }
  return '<div class="fcp-handled' + (done ? ' done' : '') + '">'
    + '<div class="fcp-handled-top">' + top + '</div>'
    + '<div id="fcp-upd-' + c.id + '">' + fcpUpdatesHtml(c, nameMap) + '</div>'
    + '</div>';
}

function fcpUpdatesHtml(c, nameMap) {
  var ups = fcpUpdates[c.id] || [];
  if (!ups.length) return '';
  var many = ups.length > 1;
  var open = !!fcpExpanded[c.id];
  var shown = many && !open ? ups.slice(0, 1) : ups;
  var html = '<div class="fcp-updates">' + shown.map(function (u, i) {
    return '<div><div class="fcp-upd-when">' + fcpShortDateTime(u.created_at) + ' · ' + escHtml(fcpName(u.author_email, u.author_name, nameMap))
      + (many && i === 0 ? '<span class="fcp-latest">LATEST</span>' : '') + '</div>'
      + '<div class="fcp-upd-text">' + escHtml(u.note) + '</div></div>';
  }).join('') + '</div>';
  if (many) {
    var earlier = ups.length - 1;
    html += '<button class="fcp-toggle" onclick="fcpToggleHistory(' + c.id + ')">'
      + (open ? '<i class="ti ti-chevron-up"></i> Show less'
              : '<i class="ti ti-chevron-right"></i> Show ' + earlier + ' earlier update' + (earlier === 1 ? '' : 's'))
      + '</button>';
  }
  return html;
}

function fcpToggleHistory(id) {
  fcpExpanded[id] = !fcpExpanded[id];
  var box = document.getElementById('fcp-upd-' + id);
  if (box && fcpComplaints[id]) box.innerHTML = fcpUpdatesHtml(fcpComplaints[id], fcpLastNameMap);
}

// ── Buttons and the inline note form ──

// Buttons for an open / in-progress complaint. Resolved ones get nothing
// here (admin adds its own Reopen button).
function fcpActionsHtml(c) {
  return '<div id="fcp-actions-' + c.id + '">' + fcpButtonsHtml(c) + '</div>';
}

function fcpButtonsHtml(c) {
  var s = c.status || 'open';
  if (s === 'resolved') return '';
  if (s === 'open') {
    return '<button class="fcp-btn-handle" onclick="fcpOpenForm(' + c.id + ',\'claim\')"><i class="ti ti-tool"></i> I\'ll handle this</button>'
      + '<button class="fcp-btn-resolve-ghost" onclick="fcpOpenForm(' + c.id + ',\'resolve\')">✓ Mark Resolved</button>';
  }
  return '<div class="fcp-row">'
    + '<button class="fcp-btn-update" onclick="fcpOpenForm(' + c.id + ',\'update\')">+ Add update</button>'
    + '<button class="fcp-btn-solid-resolve" onclick="fcpOpenForm(' + c.id + ',\'resolve\')">✓ Mark Resolved</button>'
    + '</div>';
}

var FCP_FORMS = {
  claim:   { label: 'What are you doing about it?', hint: 'Optional — helps the rest of the team know where it stands.', confirm: 'I\'ll handle this', required: false, placeholder: 'e.g. Called ABC Aircond, technician coming Friday morning.' },
  update:  { label: 'What\'s the latest?', hint: 'The whole team will see this on the complaint.', confirm: 'Post update', required: true, placeholder: 'e.g. Contractor postponed to Monday — waiting for a spare part.' },
  resolve: { label: 'What fixed it?', hint: 'Optional — kept with the complaint\'s history.', confirm: '✓ Mark Resolved', required: false, placeholder: 'e.g. Replaced the part, cooling normally.' }
};

function fcpOpenForm(id, mode) {
  var box = document.getElementById('fcp-actions-' + id);
  var f = FCP_FORMS[mode];
  if (!box || !f) return;
  box.innerHTML = '<div class="fcp-form' + (mode === 'resolve' ? ' resolve' : '') + '">'
    + '<div class="fcp-form-label">' + f.label + '</div>'
    + '<textarea id="fcp-note-' + id + '" maxlength="500" placeholder="' + escHtml(f.placeholder) + '"></textarea>'
    + '<div class="fcp-form-hint">' + f.hint + '</div>'
    + '<div class="fcp-form-err" id="fcp-err-' + id + '"></div>'
    + '<div class="fcp-row"><button class="fcp-btn-cancel" onclick="fcpCloseForm(' + id + ')">Cancel</button>'
    + '<button class="fcp-btn-confirm" id="fcp-confirm-' + id + '" onclick="fcpSubmit(' + id + ',\'' + mode + '\')">' + f.confirm + '</button></div>'
    + '</div>';
  var ta = document.getElementById('fcp-note-' + id);
  if (ta) ta.focus();
}

function fcpCloseForm(id) {
  var box = document.getElementById('fcp-actions-' + id);
  if (box && fcpComplaints[id]) box.innerHTML = fcpButtonsHtml(fcpComplaints[id]);
}

function fcpFormError(id, msg) {
  var el = document.getElementById('fcp-err-' + id);
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}

async function fcpAddNote(id, kind, note, me) {
  await fcpFetch('POST', 'faulty_complaint_updates', {
    complaint_id: id, kind: kind, note: note, author_name: me.name, author_email: me.email || null
  });
}

async function fcpSubmit(id, mode) {
  if (fcpBusy) return;
  var f = FCP_FORMS[mode];
  var c = fcpComplaints[id];
  var ta = document.getElementById('fcp-note-' + id);
  var note = ta ? ta.value.trim() : '';
  if (!f || !c) return;
  if (f.required && !note) { fcpFormError(id, 'Please write a short update first.'); return; }
  fcpFormError(id, '');

  var me = fcpMe();
  var now = new Date().toISOString();
  var btn = document.getElementById('fcp-confirm-' + id);
  fcpBusy = true;
  if (btn) btn.disabled = true;
  try {
    if (mode === 'claim') {
      // Only succeeds while it's still Open -- if two people tap at the same
      // moment, the second one gets nothing back and is told who has it.
      var taken = await fcpFetch('PATCH', 'faulty_complaints?id=eq.' + id + '&status=eq.open',
        { status: 'in_progress', handled_by: me.name, handled_by_email: me.email || null, handled_at: now }, 'return=representation');
      if (!taken || !taken.length) {
        alert('Someone else has just taken this one — the list will refresh so you can see who.');
        if (ta) ta.value = '';
        if (typeof fcpReload === 'function') fcpReload();
        return;
      }
      if (note) await fcpAddNote(id, 'claim', note, me);
      if (typeof notifyFaultyClaimPush === 'function') {
        notifyFaultyClaimPush({ item: fcpItemLabel(c), location: c.location, note: note, handledBy: me.name, handlerEmail: me.email });
      }
    } else if (mode === 'update') {
      await fcpAddNote(id, 'update', note, me);
    } else if (mode === 'resolve') {
      var done = await fcpFetch('PATCH', 'faulty_complaints?id=eq.' + id + '&status=neq.resolved',
        { status: 'resolved', resolved_by: me.name, resolved_at: now }, 'return=representation');
      if (done && done.length) {
        if (note) await fcpAddNote(id, 'resolve', note, me);
        if (typeof syncFcResolveToSheet === 'function') syncFcResolveToSheet(id, 'resolve', me.name);
      }
    }
    if (ta) ta.value = ''; // so the auto-refresh guard doesn't see it as unsaved
    if (typeof fcpReload === 'function') fcpReload();
  } catch (e) {
    fcpFormError(id, 'Could not save: ' + e.message);
    if (btn) btn.disabled = false;
  } finally {
    fcpBusy = false;
  }
}
