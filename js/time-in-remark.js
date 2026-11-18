// ── time-in-remark.js — optional remark when tapping "I'm Back" ──
// Shared by index.html and admin.html, for personal Time Off and Out for
// Work alike. Tapping I'm Back asks for an optional remark (e.g. "Going
// straight to lunch, back 12:30") before Time In; leaving it empty is the
// normal case. The remark is saved as time_in_remark
// (docs/time-in-remark.sql), shown on the record, in the admin report and
// CSVs, and for TI_NOTE_SHOW_MIN after Time In on Home's Currently Out card,
// so colleagues know the person isn't necessarily back at their desk.
// It never changes the hours charged.
//
// Relies on the page's SURL / SKEY / escHtml globals.

// Lunch is flexible (any time 11am-2pm) but at most 1h 30m, so a remark
// like "Going straight to lunch" stays on Home for 1h 30m after Time In --
// by then they're due back in the office.
var TI_NOTE_SHOW_MIN = 90;    // how long a remark shows on Home after Time In
var TI_REMARK_MAX = 100;

(function tiInjectStyles() {
  if (document.getElementById('ti-styles')) return;
  var css = ''
    + '#ti-overlay{position:fixed;inset:0;background:rgba(17,28,24,.45);z-index:10000;display:flex;align-items:flex-end;justify-content:center}'
    + '@media (min-width:600px){#ti-overlay{align-items:center}}'
    + '#ti-sheet{background:#fff;width:100%;max-width:420px;border-radius:20px 20px 0 0;padding:18px 16px calc(16px + env(safe-area-inset-bottom));box-sizing:border-box;font-family:inherit}'
    + '@media (min-width:600px){#ti-sheet{border-radius:20px}}'
    + '#ti-sheet h4{margin:0 0 4px;font-size:15px;font-weight:800;color:#111C18}'
    + '#ti-sheet p{margin:0 0 12px;font-size:12px;color:#70827D;line-height:1.45}'
    + '#ti-sheet label{display:block;font-size:10.5px;font-weight:700;color:#70827D;letter-spacing:.4px;text-transform:uppercase;margin:0 0 5px}'
    + '#ti-remark{width:100%;box-sizing:border-box;border:1.5px solid #D5DEDA;border-radius:12px;padding:10px 12px;font-size:14px;font-family:inherit;color:#111C18;resize:none;height:64px;outline:none}'
    + '#ti-remark:focus{border-color:#0F6E5C}'
    + '#ti-count{font-size:10.5px;color:#9AABA3;text-align:right;margin:3px 0 12px}'
    + '.ti-row{display:flex;gap:8px}'
    + '.ti-btn{flex:1;border-radius:12px;padding:12px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer}'
    + '.ti-go{background:#0F6E5C;color:#fff;border:none}'
    + '.ti-no{background:#fff;color:#70827D;border:1px solid #D5DEDA;flex:0 0 32%}'
    + '.ti-remark-line{font-size:11px;font-weight:600;color:#854F0B;margin-top:4px;line-height:1.4;word-break:break-word}'
    + '.ti-home{display:block;margin-top:5px}'
    + '.ti-home-line{display:block;font-size:10.5px;font-weight:600;color:#854F0B;background:#FAEEDA;border-radius:8px;padding:4px 8px;margin-top:4px;line-height:1.35;word-break:break-word}'
    + '.ti-home-line b{font-weight:800}';
  var s = document.createElement('style');
  s.id = 'ti-styles';
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
})();

function tiClock(d) { return d.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' }); }

// The grey example in the box. Lunch can start any time from 11am to 2pm,
// so inside that window it also says when they'd be due back (1h 30m on).
function tiExample() {
  var now = new Date(), h = now.getHours();
  if (h >= 11 && h < 14) return 'e.g. Going straight to lunch, back ' + tiClock(new Date(now.getTime() + TI_NOTE_SHOW_MIN * 60000));
  return 'e.g. Going straight to lunch';
}

// Opens the "Time In at 11:30 AM" box. Resolves with the remark ('' when
// left empty) once Time In is tapped, or null if cancelled.
function tiAskRemark() {
  return new Promise(function (resolve) {
    var old = document.getElementById('ti-overlay');
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'ti-overlay';
    ov.innerHTML = '<div id="ti-sheet" role="dialog" aria-modal="true" aria-labelledby="ti-title">'
      + '<h4 id="ti-title">Time In at ' + escHtml(tiClock(new Date())) + '</h4>'
      + '<p>Anything people should know? <b>Optional</b> — leave it empty if you\'re back in the office.</p>'
      + '<label for="ti-remark">Remark (optional)</label>'
      + '<textarea id="ti-remark" maxlength="' + TI_REMARK_MAX + '" placeholder="' + escHtml(tiExample()) + '"></textarea>'
      + '<div id="ti-count">0 / ' + TI_REMARK_MAX + '</div>'
      + '<div class="ti-row"><button class="ti-btn ti-no" id="ti-no">Cancel</button><button class="ti-btn ti-go" id="ti-go">Time In</button></div>'
      + '</div>';
    document.body.appendChild(ov);
    var box = document.getElementById('ti-remark');
    var done = function (val) { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    var onKey = function (e) { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    box.addEventListener('input', function () { document.getElementById('ti-count').textContent = box.value.length + ' / ' + TI_REMARK_MAX; });
    document.getElementById('ti-go').onclick = function () { done(box.value.replace(/\s+/g, ' ').trim().slice(0, TI_REMARK_MAX)); };
    document.getElementById('ti-no').onclick = function () { done(null); };
    ov.addEventListener('click', function (e) { if (e.target === ov) done(null); });
  });
}

// "Column doesn't exist yet" -- docs/time-in-remark.sql not run.
function tiIsMissingColumn(e) {
  if (!e) return false;
  return e.code === 'PGRST204' || e.code === '42703' || /time_in_remark/.test(String(e.message || ''));
}

// Runs patchFn(patch) with the remark added; if the column isn't there
// yet, Times In without it rather than failing.
async function tiPatchWithRemark(patchFn, patch, remark) {
  if (!remark) return patchFn(patch);
  var withRemark = {};
  for (var k in patch) withRemark[k] = patch[k];
  withRemark.time_in_remark = remark;
  try {
    return await patchFn(withRemark);
  } catch (e) {
    if (!tiIsMissingColumn(e)) throw e;
    console.warn('time_in_remark column missing -- run docs/time-in-remark.sql. Timed in without the remark.');
    return patchFn(patch);
  }
}

// The amber "📝 remark" line under a record.
function tiRemarkLineHtml(r) {
  if (!r || !r.time_in_remark) return '';
  return '<div class="ti-remark-line">📝 ' + escHtml(r.time_in_remark) + '</div>';
}

// Remarks from the last TI_NOTE_SHOW_MIN minutes, newest per person,
// leaving out anyone who's out again now. Never throws.
async function tiFetchRecentNotes(outRows) {
  var since = new Date(Date.now() - TI_NOTE_SHOW_MIN * 60000).toISOString();
  var q = '?time_in=gte.' + encodeURIComponent(since) + '&time_in_remark=not.is.null&entry_type=neq.voided&order=time_in.desc&limit=30';
  var get = function (table) {
    return fetch(SURL + '/rest/v1/' + table + q, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } })
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; });
  };
  var both = await Promise.all([get('time_off_records'), get('work_outings')]);
  var outNow = {};
  (outRows || []).forEach(function (r) { if (r.staff_email) outNow[r.staff_email.toLowerCase()] = true; });
  var seen = {}, notes = [];
  (Array.isArray(both[0]) ? both[0] : []).concat(Array.isArray(both[1]) ? both[1] : [])
    .filter(function (r) { return r.time_in_remark && r.entry_type !== 'cancel_pending'; })
    .sort(function (a, b) { return new Date(b.time_in) - new Date(a.time_in); })
    .forEach(function (r) {
      var key = (r.staff_email || r.staff_name || '').toLowerCase();
      if (seen[key] || outNow[key]) return;
      seen[key] = true;
      notes.push(r);
    });
  return notes;
}

// Lines for Home's Currently Out card. nameOf(record) gives the display name.
function tiHomeNotesHtml(notes, nameOf) {
  if (!notes || !notes.length) return '';
  return '<span class="ti-home">' + notes.map(function (r) {
    var name = nameOf ? nameOf(r) : (r.staff_name || '');
    return '<span class="ti-home-line">📝 <b>' + escHtml(name) + '</b> · in ' + escHtml(tiClock(new Date(r.time_in))) + ' · ' + escHtml(r.time_in_remark) + '</span>';
  }).join('') + '</span>';
}
