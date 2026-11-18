// ── time-in-remark.js — optional remark when tapping "I'm Back" ──
// Shared by index.html and admin.html, for personal Time Off and Out for
// Work alike. Tapping I'm Back asks for an optional remark (e.g. "Going
// straight to lunch") before Time In; leaving it empty is the normal case.
// The remark is saved as time_in_remark (docs/time-in-remark.sql) and shown
// on the record -- My / All Records, My / All Work Outings -- and in the
// admin report and CSVs, so colleagues know the person isn't necessarily
// back at their desk. A remark about lunch also says when they're due back
// (see tiLunchBackBy). It never changes the hours charged, and nothing is
// shown on Home.
//
// Relies on the page's escHtml global.

// Lunch is flexible (any time 11am-2pm) but at most 1h 30m.
var TI_LUNCH_MAX_MIN = 90;
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
    + '#ti-hint{font-size:12px;color:#854F0B;background:#FAEEDA;border-radius:9px;padding:7px 10px;margin-top:6px}'
    + '.ti-row{display:flex;gap:8px}'
    + '.ti-btn{flex:1;border-radius:12px;padding:12px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer}'
    + '.ti-go{background:#0F6E5C;color:#fff;border:none}'
    + '.ti-no{background:#fff;color:#70827D;border:1px solid #D5DEDA;flex:0 0 32%}'
    + '.ti-remark-line{font-size:11px;font-weight:600;color:#854F0B;margin-top:4px;line-height:1.4;word-break:break-word}'
    + '.ti-remark-line b{font-weight:800}';
  var s = document.createElement('style');
  s.id = 'ti-styles';
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
})();

function tiClock(d) { return d.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' }); }

// Lunch is flexible from 11am to 2pm and at most 1h 30m. When a remark
// mentions lunch, the app works out "be back before": 1h 30m after Time
// In, but never later than 2pm. Null if it isn't about lunch, or if Time
// In is already 2pm or later (lunch time is over).
var TI_LUNCH_END_HOUR = 14;
// Does the remark mean lunch? Forgiving of slips: punctuation or a space
// inside the word ("lun.ch", "lun ch"), "lunchtime", and one wrong,
// missing, extra or swapped letter ("luch", "lunhc", "lumch") -- but not
// real words that happen to be one letter off ("launch", "punch", ...).
var TI_LUNCH_WORDS = ['lunch', 'makan'];
var TI_NOT_LUNCH = { launch: 1, bunch: 1, punch: 1, hunch: 1, munch: 1, lynch: 1, lunar: 1, makin: 1, makna: 1, maka: 1, mana: 1, malam: 1 };
function tiOneSlip(a, b) {
  // true when a and b differ by at most one insert / delete / change / swap
  if (a === b) return true;
  var la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  var i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;                                   // one change
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);    // one swap
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);          // one extra / missing
}
function tiIsLunch(remark) {
  var words = String(remark || '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  var cands = words.slice();
  for (var i = 0; i + 1 < words.length; i++) cands.push(words[i] + words[i + 1]); // "lun ch"
  return cands.some(function (w) {
    if (TI_NOT_LUNCH[w]) return false;
    return TI_LUNCH_WORDS.some(function (t) {
      return w.indexOf(t) === 0 || (w.length >= 4 && tiOneSlip(w, t)); // "lunchtime", or one slip
    });
  });
}

function tiLunchBackBy(remark, timeIn) {
  if (!remark || !tiIsLunch(remark)) return null;
  var t = new Date(timeIn);
  var end = new Date(t); end.setHours(TI_LUNCH_END_HOUR, 0, 0, 0);
  if (t >= end) return null;
  var back = new Date(t.getTime() + TI_LUNCH_MAX_MIN * 60000);
  return back > end ? end : back;
}

// The remark as shown to others, e.g. "Going straight to lunch · be back
// before 1:00 pm".
function tiNoteHtml(r) {
  var back = tiLunchBackBy(r.time_in_remark, r.time_in);
  return escHtml(r.time_in_remark) + (back ? ' · <b>be back before ' + escHtml(tiClock(back)) + '</b>' : '');
}

function tiUpdateHint() {
  var box = document.getElementById('ti-remark'), hint = document.getElementById('ti-hint');
  if (!box || !hint) return;
  var back = tiLunchBackBy(box.value, new Date());
  hint.innerHTML = back ? '🍽 Others will see: <b>be back before ' + escHtml(tiClock(back)) + '</b>' : '';
  hint.style.display = back ? 'block' : 'none';
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
      + '<textarea id="ti-remark" maxlength="' + TI_REMARK_MAX + '" placeholder="e.g. Going straight to lunch"></textarea>'
      + '<div id="ti-hint" style="display:none;"></div>'
      + '<div id="ti-count">0 / ' + TI_REMARK_MAX + '</div>'
      + '<div class="ti-row"><button class="ti-btn ti-no" id="ti-no">Cancel</button><button class="ti-btn ti-go" id="ti-go">Time In</button></div>'
      + '</div>';
    document.body.appendChild(ov);
    var box = document.getElementById('ti-remark');
    var done = function (val) { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    var onKey = function (e) { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    box.addEventListener('input', function () { document.getElementById('ti-count').textContent = box.value.length + ' / ' + TI_REMARK_MAX; tiUpdateHint(); });
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
  return '<div class="ti-remark-line">📝 ' + tiNoteHtml(r) + '</div>';
}
