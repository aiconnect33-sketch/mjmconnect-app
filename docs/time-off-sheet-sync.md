# Time Off — Google Sheet sync

`js/tab-timeoff.js` (staff app) and the matching self-service code in
`admin.html` best-effort mirror every Time Off record into a Google Sheet via
a small Apps Script Web App, the same `fetch(..., { mode: 'no-cors' })`
pattern Faulty Complain already uses. It's optional — while
`TIMEOFF_SHEET_WEBHOOK_URL` is blank in both files, this side is simply
skipped and Time Off still works fine against Supabase alone.

**This is a different spreadsheet from Faulty Complain's**, so it needs its
own Apps Script project and its own deployment — you can't reuse the Faulty
Complain one.

- Spreadsheet: `1IVv7KjRaUyxRU25P8xJ_-bhgWpnTOpNMXV59zPcyXWc` (the one you
  linked — this used to be fed by the old "Time Off" Google Form)
- The script writes into a **new tab named "In-App Time Off"** inside that
  same spreadsheet, created automatically the first time it runs. It never
  touches whatever tab the old Form responses landed in (`gid=0`), so that
  history stays exactly as it is.

## What the app sends

- `action: 'create'` once a trip is actually closed — either Time In on a
  live trip, or a backfilled ("Log a Missed Time Off") entry saved directly
  with both times already set. Never sent for a trip that's still open
  (nothing to log yet) or a Plan Ahead reminder (it isn't a trip until
  someone actually times out on it).
- `action: 'update'` when an already-logged trip changes after the fact —
  admin corrects the Time Out/Time In, or voids it ("Cancel This Trip").
  Matched to the existing row by `id`.
- Payload for both: `secret, action, id, staffName, reason, timeOut, timeIn,
  durationMinutes, entryType (live/edited/backfilled/voided), monthlyMinutes`
  (that staff member's running total for the calendar month, excluding
  voided trips, computed client-side at send time).

Requests are fire-and-forget, so the app never blocks or fails on this —
it only matters for keeping the Sheet up to date.

## Sheet layout

- **"In-App Time Off"** — one row per trip, in the order things happen.
  The limit check is split into two columns since they mean different
  things: **"Over 2.5h (Single Trip)?"** flags *that one trip's* own
  duration (2.5h) — this can still happen for a backfilled or corrected
  entry, since those aren't checked live the way starting a fresh Time Out
  is. **"Over 4h (Monthly)?"** flags whether *that staff member's month*
  had already gone over the 4h cap once this entry counted, which is the
  cap the app itself enforces before letting someone start a new Time Out.
- **"Staff Time Off Summary"** — one row per staff member per calendar
  month, upserted every time an entry for them syncs, so you don't have to
  scan the full log to see where everyone stands: `Staff Name | Month |
  Total This Month | Over 4h (Monthly)? | Last Updated`. The total mirrors
  whatever the app itself last computed for that person (the same
  `monthlyMinutes` value the log's "Month Total After This Entry" column
  gets), so it stays accurate through edits and voids without needing to
  re-derive anything from the log's text.

## One-time setup

1. Go to `script.google.com/home` while logged into the Google account that
   owns (or has edit access to) the spreadsheet above — use a single-account
   incognito/private window if that's not the only account signed in, to
   avoid Google's `authuser` mix-ups during the OAuth consent step.
2. **New Project** → clear the placeholder code → paste in `Code.gs` below.
3. If you want a different secret than the one already in the code (it
   already matches `TIMEOFF_SHEET_SECRET` in both `js/tab-timeoff.js` and
   `admin.html` — leave it as-is unless you have a reason to change it),
   update `SECRET` here and in both of those files together.
4. Save, then **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Approve the "Google hasn't verified this app" warning (it's your own
   script) and grant the Sheets permission prompt.
6. Copy the deployed `.../exec` URL and paste it as `TIMEOFF_SHEET_WEBHOOK_URL`
   in **both** `js/tab-timeoff.js` and the matching constant in `admin.html`
   — they must be identical, since both apps post to the same Web App.

## Updating the script later

Same as Faulty Complain's: **Deploy → Manage deployments → pick the
existing Web app → Edit (pencil) → Version: New version → Deploy.** That
keeps the same `.../exec` URL, so nothing in the app needs to change.

### Picking up the split-limit column + summary tab on an already-deployed sheet

If your Apps Script project and sheet already existed before the "Over
4h (Monthly)?" column and the "Staff Time Off Summary" tab were added
above:

1. Replace your project's code with the updated `Code.gs` below, then
   redeploy a new version (steps just above).
2. The next time any Time Off entry syncs, the script fills in the new
   "Over 4h (Monthly)?" header automatically (existing headers are left
   untouched) and creates the "Staff Time Off Summary" tab on demand.
3. One manual step: the old "Over Limit?" header cell (column K, row 1)
   won't rename itself — the script only fills in *empty* header cells so
   it never overwrites something you might have customized. Rename that
   cell to "Over 2.5h (Single Trip)?" yourself; the values underneath it
   are unchanged, so nothing else about that column needs touching.
4. The summary tab only reflects entries that sync *after* the update —
   it doesn't backfill history from rows already in the log. If you want
   it caught up immediately rather than waiting for new activity, that's
   a one-time manual copy from the log rather than something the script
   needs to do automatically.

## Code.gs

```javascript
// MJMConnect — Time Off Google Sheet sync
// Standalone Apps Script project, deployed as a Web App, that writes into a
// dedicated "In-App Time Off" tab inside the linked spreadsheet (SHEET_ID
// below) -- never touches whatever tab the old Time Off Google Form's
// responses landed in. Receives POSTs from js/tab-timeoff.js
// (TIMEOFF_SHEET_WEBHOOK_URL) and the matching admin.html code for two
// actions:
//   - create: a trip was actually closed (Time In, or a backfilled entry) -> append a row
//   - update: an already-logged trip changed (admin correction, or voided) -> update that row

var SHEET_ID = '1IVv7KjRaUyxRU25P8xJ_-bhgWpnTOpNMXV59zPcyXWc';
var TAB_NAME = 'In-App Time Off';
var SUMMARY_TAB_NAME = 'Staff Time Off Summary';
var SECRET = 'SeW2cUlObs6M2jCq-xxSrPlhB-MHCj6mqz'; // must match TIMEOFF_SHEET_SECRET in js/tab-timeoff.js and admin.html

var HEADERS = ['Logged At', 'ID', 'Date', 'Staff Name', 'Reason', 'Time Out',
  'Time In', 'Duration', 'Entry Type', 'Month Total After This Entry',
  'Over 2.5h (Single Trip)?', 'Over 4h (Monthly)?'];

var SUMMARY_HEADERS = ['Staff Name', 'Month', 'Total This Month', 'Over 4h (Monthly)?', 'Last Updated'];

var PER_TRIP_CAP_MIN = 150;  // 2.5h, matches TIMEOFF_PER_TRIP_CAP_MIN client-side
var MONTHLY_CAP_MIN  = 240;  // 4h,   matches TIMEOFF_MONTHLY_CAP_MIN client-side

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput('bad request');
  }
  if (!body || body.secret !== SECRET) {
    return ContentService.createTextOutput('unauthorized');
  }

  var sheet = getOrCreateSheet();
  ensureHeaders(sheet);

  if (body.action === 'create') {
    handleCreate(sheet, body);
  } else if (body.action === 'update') {
    handleUpdate(sheet, body);
  }

  // The monthly total the app sends is already authoritative (computed
  // against live Supabase data at send time), so the summary tab just
  // mirrors it rather than trying to re-derive it from the log -- which
  // would otherwise mean parsing the log's human-formatted date/duration
  // text back into numbers.
  upsertSummary(getOrCreateSummarySheet(), body);

  return ContentService.createTextOutput('ok');
}

function doGet(e) {
  return ContentService.createTextOutput('MJMConnect Time Off sync is running.');
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) sheet = ss.insertSheet(TAB_NAME);
  return sheet;
}

function getOrCreateSummarySheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SUMMARY_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SUMMARY_TAB_NAME);
    sheet.getRange(1, 1, 1, SUMMARY_HEADERS.length).setValues([SUMMARY_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureHeaders(sheet) {
  var current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (!current[0]) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }
  // An existing sheet from before the monthly-limit column existed --
  // fill in any missing trailing header only, leave everything else as is.
  for (var col = 1; col <= HEADERS.length; col++) {
    if (!current[col - 1]) sheet.getRange(1, col).setValue(HEADERS[col - 1]);
  }
}

function handleCreate(sheet, body) {
  sheet.appendRow([
    formatMYTime(new Date().toISOString()),
    body.id || '',
    formatMYDate(body.timeOut),
    body.staffName || '',
    body.reason || '',
    formatMYTime(body.timeOut),
    formatMYTime(body.timeIn),
    formatDuration(body.durationMinutes),
    entryTypeLabel(body.entryType),
    formatDuration(body.monthlyMinutes),
    overTripLimitLabel(body.durationMinutes),
    overMonthlyLimitLabel(body.monthlyMinutes)
  ]);
}

function handleUpdate(sheet, body) {
  var ID_COL = 2, TIME_OUT_COL = 6, TIME_IN_COL = 7, DURATION_COL = 8,
    ENTRY_TYPE_COL = 9, MONTH_TOTAL_COL = 10, OVER_TRIP_COL = 11, OVER_MONTHLY_COL = 12;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][ID_COL - 1]) === String(body.id)) {
      var row = i + 1;
      sheet.getRange(row, TIME_OUT_COL).setValue(formatMYTime(body.timeOut));
      sheet.getRange(row, TIME_IN_COL).setValue(formatMYTime(body.timeIn));
      sheet.getRange(row, DURATION_COL).setValue(formatDuration(body.durationMinutes));
      sheet.getRange(row, ENTRY_TYPE_COL).setValue(entryTypeLabel(body.entryType));
      sheet.getRange(row, MONTH_TOTAL_COL).setValue(formatDuration(body.monthlyMinutes));
      sheet.getRange(row, OVER_TRIP_COL).setValue(overTripLimitLabel(body.durationMinutes));
      sheet.getRange(row, OVER_MONTHLY_COL).setValue(overMonthlyLimitLabel(body.monthlyMinutes));
      break;
    }
  }
}

// One row per staff member per calendar month, keyed off the trip's own
// date (not "today") so a backfilled entry from a past month still lands
// in that month's row rather than the current one.
function upsertSummary(sheet, body) {
  if (!body.staffName || !body.timeOut) return;
  var month = Utilities.formatDate(new Date(body.timeOut), 'Asia/Kuala_Lumpur', 'MMMM yyyy');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.staffName) && String(data[i][1]) === month) {
      var row = i + 1;
      sheet.getRange(row, 3).setValue(formatDuration(body.monthlyMinutes));
      sheet.getRange(row, 4).setValue(overMonthlyLimitLabel(body.monthlyMinutes));
      sheet.getRange(row, 5).setValue(formatMYTime(new Date().toISOString()));
      return;
    }
  }
  sheet.appendRow([
    body.staffName, month, formatDuration(body.monthlyMinutes),
    overMonthlyLimitLabel(body.monthlyMinutes), formatMYTime(new Date().toISOString())
  ]);
}

function entryTypeLabel(t) {
  if (t === 'edited') return 'Edited';
  if (t === 'backfilled') return 'Backfilled';
  if (t === 'voided') return 'Voided';
  return 'Live';
}

function overTripLimitLabel(durationMinutes) {
  return (durationMinutes || 0) > PER_TRIP_CAP_MIN ? 'Y' : 'N';
}

function overMonthlyLimitLabel(monthlyMinutes) {
  return (monthlyMinutes || 0) > MONTHLY_CAP_MIN ? 'Y' : 'N';
}

function formatDuration(mins) {
  mins = Math.max(0, Math.round(mins || 0));
  var h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (h + 'h ' + (m < 10 ? '0' : '') + m + 'm') : (m + 'm');
}

// Client sends UTC ISO timestamps (new Date().toISOString()) -- convert to
// Malaysia time here rather than trusting each device's local clock/timezone.
function formatMYTime(isoString) {
  if (!isoString) return '';
  return Utilities.formatDate(new Date(isoString), 'Asia/Kuala_Lumpur', 'dd MMM yyyy, hh:mm a');
}

function formatMYDate(isoString) {
  if (!isoString) return '';
  return Utilities.formatDate(new Date(isoString), 'Asia/Kuala_Lumpur', 'dd MMM yyyy');
}
```
