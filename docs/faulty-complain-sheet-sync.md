# Faulty Complain — Google Sheet/Drive sync

`js/tab-faulty.js` best-effort mirrors each Faulty Complain submission into a
Google Sheet (with the photo saved to a Drive folder) via a small Apps Script
Web App. It's optional — if `FC_SHEET_WEBHOOK_URL` is blank, this side is
simply skipped and the complaint still saves fine to Supabase.

Current live setup (as of the aiconnect33-sketch migration):
- Spreadsheet: `1xZDXiaLnkBH7ZC4U0Dov1UN4qyhGDnZbOXqfvSr-V0g`, owned by `aiconnect33@gmail.com`
- Drive folder: `1iPSxednlNHX_h8mtcWamJj70hTacGfYb`, owned by `aiconnect33@gmail.com`
- Apps Script project: standalone (not bound to the sheet), under `aiconnect33@gmail.com`

## What the app sends

- `action: 'create'` on every new submission — `secret, id, timestamp, staffName,
  location, item, itemOther, description, urgency, photoName, photoMime, photoBase64`
- `action: 'resolve'` / `action: 'reopen'` when staff toggles a complaint's status —
  `secret, action, id, resolvedBy, resolvedAt`

Requests are fire-and-forget (`mode: 'no-cors'`), so the app never blocks or
fails on this sync — it only matters for keeping the Sheet up to date.

## One-time setup (re-run if migrating to a new Google account again)

1. Go to `script.google.com/home` while logged into the account that should
   own this (e.g. `aiconnect33@gmail.com`) — use a single-account
   incognito/private window if that account isn't the only one signed in on
   the machine, to avoid Google's `authuser` mix-ups during the OAuth consent step.
2. **New Project** → clear the placeholder code → paste in `Code.gs` below.
3. Update `SHEET_ID`, `FOLDER_ID`, and `SECRET` at the top of the script to
   match the target spreadsheet, Drive folder, and `FC_SHEET_SECRET` in
   `js/tab-faulty.js`.
4. Save, then **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Approve the "Google hasn't verified this app" warning (it's your own
   script) and grant the Sheets/Drive permission prompts.
6. Copy the deployed `.../exec` URL and set it as `FC_SHEET_WEBHOOK_URL` in
   `js/tab-faulty.js`.

## Code.gs

```javascript
// MJMConnect — Faulty Complain Sheet/Drive sync
// Standalone Apps Script project, deployed as a Web App, that writes into the
// Faulty Complain Google Sheet (SHEET_ID below) and Drive folder (FOLDER_ID).
// Receives POSTs from js/tab-faulty.js (FC_SHEET_WEBHOOK_URL) for three actions:
//   - create:  a new complaint was submitted -> append a row (+ save photo to Drive)
//   - resolve: staff marked a complaint resolved -> flip Status, record who/when
//   - reopen:  staff reopened a resolved complaint -> flip Status back to Open

var SHEET_ID = '1xZDXiaLnkBH7ZC4U0Dov1UN4qyhGDnZbOXqfvSr-V0g';
var FOLDER_ID = '1iPSxednlNHX_h8mtcWamJj70hTacGfYb';
var SECRET = 'UOhnuGd169-c7WkKtKZcMvq6S9i-Se-O'; // must match FC_SHEET_SECRET in js/tab-faulty.js

var HEADERS = ['Timestamp', 'ID', 'Staff Name', 'Location', 'Item', 'Item (Other)',
  'Description', 'Urgency', 'Status', 'Photo Link', 'Resolved By', 'Resolved At'];

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

  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  ensureHeaders(sheet);

  if (body.action === 'create') {
    handleCreate(sheet, body);
  } else if (body.action === 'resolve' || body.action === 'reopen') {
    handleStatusChange(sheet, body);
  }
  return ContentService.createTextOutput('ok');
}

function doGet(e) {
  return ContentService.createTextOutput('MJMConnect Faulty Complain sync is running.');
}

function ensureHeaders(sheet) {
  if (!sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function handleCreate(sheet, body) {
  var photoLink = '';
  if (body.photoBase64) {
    try {
      var folder = DriveApp.getFolderById(FOLDER_ID);
      var bytes = Utilities.base64Decode(body.photoBase64);
      var blob = Utilities.newBlob(bytes, body.photoMime || 'application/octet-stream', body.photoName || ('photo-' + Date.now()));
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoLink = file.getUrl();
    } catch (err) {
      photoLink = 'ERROR saving photo: ' + err;
    }
  }
  sheet.appendRow([
    formatMYTime(body.timestamp),
    body.id || '',
    body.staffName || '',
    body.location || '',
    body.item || '',
    body.itemOther || '',
    body.description || '',
    body.urgency || '',
    'Open',
    photoLink,
    '',
    ''
  ]);
}

function handleStatusChange(sheet, body) {
  var ID_COL = 2, STATUS_COL = 9, RESOLVED_BY_COL = 11, RESOLVED_AT_COL = 12;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][ID_COL - 1]) === String(body.id)) {
      var row = i + 1;
      if (body.action === 'resolve') {
        sheet.getRange(row, STATUS_COL).setValue('Resolved');
        sheet.getRange(row, RESOLVED_BY_COL).setValue(body.resolvedBy || '');
        sheet.getRange(row, RESOLVED_AT_COL).setValue(formatMYTime(body.resolvedAt));
      } else {
        sheet.getRange(row, STATUS_COL).setValue('Open');
        sheet.getRange(row, RESOLVED_BY_COL).setValue('');
        sheet.getRange(row, RESOLVED_AT_COL).setValue('');
      }
      break;
    }
  }
}

// Client sends UTC ISO timestamps (new Date().toISOString()) -- convert to
// Malaysia time here rather than trusting each device's local clock/timezone.
function formatMYTime(isoString) {
  var d = isoString ? new Date(isoString) : new Date();
  return Utilities.formatDate(d, 'Asia/Kuala_Lumpur', 'dd MMM yyyy, hh:mm a');
}
```
