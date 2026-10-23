// ── core.js — shared utilities, Supabase, nav, clock ──

// Supabase config
var SURL = 'https://hbxzbowkucpqlhxdomap.supabase.co';
var SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhieHpib3drdWNwcWxoeGRvbWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5OTEwMjYsImV4cCI6MjEwMjU2NzAyNn0.tZMdtKy92OUdLEOxKkO2XAa2bgXzkEeQtCAjtYF8yGA';

// 'YYYY-MM-DD' for a Date in LOCAL time. new Date().toISOString() converts to
// UTC first, which silently rolls back to "yesterday" for anyone east of UTC
// (e.g. Malaysia, UTC+8) during the early hours of the day -- use this for
// every "today" date comparison instead.
function localDateStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function sbGet(table, filter) {
  var hasOwnOrder = filter && /(^|&)order=/.test(filter);
  var url = SURL + '/rest/v1/' + table + '?' + (hasOwnOrder ? '' : 'order=created_at.desc&') + (filter || '');
  url = url.replace(/[?&]$/, '');
  var res = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
  try { return await res.json(); } catch(e) { return []; }
}

async function sbWrite(method, table, body, filter) {
  var url = SURL + '/rest/v1/' + table;
  if (filter) url += '?' + filter;
  var res = await fetch(url, {
    method: method,
    headers: {
      'apikey': SKEY,
      'Authorization': 'Bearer ' + SKEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    var detail = '';
    try { var errBody = await res.json(); detail = errBody.message || errBody.hint || errBody.error_description || ''; } catch(e) {}
    throw new Error('Request failed: ' + res.status + (detail ? ' - ' + detail : ''));
  }
  try { return await res.json(); } catch(e) { return null; }
}

// ── Per-module permissions ──
var DEFAULT_PERMISSIONS = { announcements: 'view', duty: 'view', dutyRoles: 'view', events: 'view', faulty: 'view', timeoff: 'view' };

function hasEditPermission(module) {
  var raw = localStorage.getItem('mjm_user');
  if (!raw) return false;
  try {
    var u = JSON.parse(raw);
    if (!u) return false;
    if (u.role === 'hradmin' || u.role === 'superadmin') return true;
    var perms = u.permissions || DEFAULT_PERMISSIONS;
    var level = perms[module] !== undefined ? perms[module] : DEFAULT_PERMISSIONS[module];
    return level === 'edit';
  } catch(e) { return false; }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// For building onclick="fn('...')" handlers from untrusted values: JS-string-escapes
// the value for the inner '...' literal, then HTML-attribute-escapes the result so
// it's also safe as the outer onclick="..." attribute content.
function escJsAttr(str) {
  var jsEscaped = String(str).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  return jsEscaped.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Audit log (Announcements / Duty / Events only — see logAudit callers) ──
// Best-effort: never blocks or fails the real save/delete it accompanies.
function logAudit(module, recordId, action, itemTitle, details, originalBy) {
  try {
    var raw = localStorage.getItem('mjm_user');
    var u = raw ? JSON.parse(raw) : null;
    var changedBy = (u && (u.name || u.email)) || 'Unknown';
    sbWrite('POST', 'audit_log', {
      module: module,
      record_id: recordId != null ? String(recordId) : null,
      action: action,
      item_title: itemTitle || '',
      changed_by: changedBy,
      original_by: originalBy || null,
      details: details || null
    }).catch(function(){});
  } catch(e) {}
}

// ── Clock ──
function tick() {
  var now = new Date();
  var h = now.getHours(), m = now.getMinutes();
  var ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  document.getElementById('js-clock').textContent = h + ':' + String(m).padStart(2,'0') + ' ' + ap;
}
tick(); setInterval(tick, 10000);

// ── Page sub-header (back button) ──
// Shown on every screen except Home, which has its own hero and is the
// bottom nav's own "home" destination. Back always returns to whichever
// screen was active immediately before the current one, tracked here as a
// simple stack -- not hardcoded to Home, since the bottom nav's Home button
// already covers that case.
var SCREENS_WITH_BACK = {
  announce: 1, leave: 1, event: 1, duty: 1, estatetrip: 1, timeoff: 1,
  book: 1, faulty: 1, menu: 1
};
var currentScreenName = 'home';
var screenHistory = [];
var suppressHistoryPush = false;

function updatePageSubheader(name) {
  var bar = document.getElementById('page-subheader');
  if (!bar) return;
  if (!SCREENS_WITH_BACK[name]) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  document.getElementById('page-subheader-title').textContent = 'Back';
}

function recordScreenChange(name) {
  if (!suppressHistoryPush && name !== currentScreenName) {
    screenHistory.push(currentScreenName);
    if (screenHistory.length > 20) screenHistory.shift();
  }
  currentScreenName = name;
  updatePageSubheader(name);
  // Every screen-section shares the one scrollable .screen-body, so without
  // this a screen opens wherever the PREVIOUS screen happened to be
  // scrolled to -- e.g. Booking showing halfway down instead of its top.
  var body = document.querySelector('.screen-body');
  if (body) body.scrollTop = 0;
}

function goBackScreen() {
  var prev = screenHistory.pop() || 'home';
  suppressHistoryPush = true;
  switchNav(prev);
  suppressHistoryPush = false;
}

// ── Tab / Nav switching ──
// Every switch also remembers the tab in sessionStorage (see rememberTab
// below) so a refresh can restore it instead of always landing on Home.
function switchTab(btn, name) {
  document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.querySelectorAll('.screen-section').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  var navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  else document.getElementById('nav-home').classList.add('active');
  recordScreenChange(name);
  rememberTab(name);
}

function switchNav(name) {
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  var navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  document.querySelectorAll('.screen-section').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  var tabMap = { home:0, announce:1, leave:2, event:3, duty:4 };
  var tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(function(t){ t.classList.remove('active'); });
  if (tabMap[name] !== undefined) tabs[tabMap[name]].classList.add('active');
  recordScreenChange(name);
  rememberTab(name);
}

// iOS gives standalone (Add to Home Screen) web apps no native
// pull-to-refresh gesture at all -- pulling down just does nothing, which
// is why data can look stuck until someone signs out and back in (a real
// navigation, which happens to force a fresh load). This builds the same
// gesture ourselves: drag down from the very top past a threshold, then
// let go, and it does a real reload -- same fresh state a manual refresh
// would give on a normal browser tab.
function initPullToRefresh() {
  var THRESHOLD = 70;
  var SETTLE_MS = 400; // see lastScrollTs below
  var refreshing = false;
  var lastScrollTs = 0;

  // touchActive: a finger is down, regardless of whether the gesture has
  // turned into a pull yet. armed: it has -- scrollTop hit 0 partway
  // through this same drag and we're now tracking pull distance from that
  // moment, not from the original touchstart. startY anchors the
  // direction check before arming; pullBaseY anchors the distance once
  // armed, so reaching the top mid-scroll doesn't hand the gesture a
  // head start it never earned.
  var touchActive = false, armed = false, blockArm = false, startY = null, pullBaseY = null;

  var indicator = document.createElement('div');
  indicator.id = 'ptr-indicator';
  indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;z-index:9999;background:#0F6E5C;pointer-events:none;';
  indicator.innerHTML = '<div style="width:20px;height:20px;border:2.5px solid rgba(255,255,255,0.35);border-top-color:#fff;border-radius:50%;animation:ptr-spin 0.6s linear infinite;"></div>';
  document.body.appendChild(indicator);

  var style = document.createElement('style');
  style.textContent = '@keyframes ptr-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);

  // Checks both the inner list and the page itself, in case anything above
  // us ever leaves the outer page scrollable too -- either one still
  // having room to scroll means "not at the top yet."
  function scrollTop() {
    var body = document.querySelector('.screen-body');
    var bodyTop = body ? body.scrollTop : 0;
    var pageTop = (document.scrollingElement || document.documentElement).scrollTop;
    return Math.max(bodyTop, pageTop);
  }

  // A flick that scrolls a list up to the top arrives at scrollTop 0 via
  // momentum, after the finger has already lifted. Someone continuing to
  // swipe down out of habit right after that lands a NEW touch that also
  // begins at scrollTop 0, which used to arm the refresh even though they
  // just meant to keep scrolling. Requiring a brief idle gap since the
  // last scroll before a touch that STARTS at the top is allowed to arm
  // gives that momentum time to settle first. This only gates touches
  // that begin already at rest -- a touch that reaches the top through
  // its own ongoing drag arms immediately, since the drag's own scroll
  // events keep this timer fresh and would otherwise stall a completely
  // normal continuous pull.
  var body = document.querySelector('.screen-body');
  if (body) {
    body.addEventListener('scroll', function() { lastScrollTs = Date.now(); }, { passive: true });
  }

  document.addEventListener('touchstart', function(e) {
    if (refreshing) { touchActive = false; return; }
    touchActive = true;
    armed = false;
    pullBaseY = null;
    startY = e.touches[0].clientY;
    blockArm = scrollTop() === 0 && (Date.now() - lastScrollTs) < SETTLE_MS;
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!touchActive) return;
    var curY = e.touches[0].clientY;

    if (!armed) {
      // Only consider arming once the drag is actually headed downward --
      // dragging up while already at the top (nothing above to reveal)
      // shouldn't count. Until scrollTop genuinely hits 0, this branch
      // never preventDefault()s, so the list keeps scrolling normally the
      // whole way up.
      if (!blockArm && curY - startY > 0 && scrollTop() === 0) {
        armed = true;
        pullBaseY = curY;
      } else {
        return;
      }
    }

    var dy = curY - pullBaseY;
    e.preventDefault();
    indicator.style.height = Math.min(Math.max(dy, 0) * 0.5, THRESHOLD + 20) + 'px';
  }, { passive: false });

  document.addEventListener('touchend', function() {
    touchActive = false;
    if (!armed) return;
    var pulled = parseInt(indicator.style.height, 10) || 0;
    armed = false;
    pullBaseY = null;
    if (pulled >= THRESHOLD) {
      refreshing = true;
      indicator.style.height = '50px';
      // A real location.reload() tears the whole page down -- index.html
      // alone re-fetches itself plus nine js/tab-*.js files before anything
      // can paint again, so the browser's blank-navigation interval (a
      // flash of plain white, unstyled by any of this page's CSS) is long
      // enough to be obvious. Refreshing the data in place instead means
      // the page never unloads, so there's nothing to flash.
      refreshAppData().finally(function() {
        refreshing = false;
        indicator.style.height = '0px';
      });
    } else {
      indicator.style.height = '0px';
    }
  }, { passive: true });
}

function switchTabByName(name) {
  var tabs = document.querySelectorAll('.tab-btn');
  var map = { home:0, announce:1, leave:2, event:3, duty:4 };
  tabs.forEach(function(t){ t.classList.remove('active'); });
  if (map[name] !== undefined) tabs[map[name]].classList.add('active');
  document.querySelectorAll('.screen-section').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  var navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  recordScreenChange(name);
  rememberTab(name);
}

// ── Remember the active tab across a refresh ──
var LAST_TAB_KEY = 'mjm_last_tab';

function rememberTab(name) {
  try { sessionStorage.setItem(LAST_TAB_KEY, name); } catch (e) {}
}

// ── Back to Home after being away for a while ──
// Mobile browsers/PWAs often keep the page alive in the background rather
// than reloading it, so switching away and back on its own doesn't reset
// anything -- without this, coming back after a long gap just shows
// whatever screen was open when you left, however long ago that was.
// Tracks when the page was last hidden; if it's been visible again after
// more than HOME_RESET_AFTER_MS, jumps back to Home -- both live (the page
// stayed open the whole time) and on a fresh load (the OS actually killed
// and relaunched it, so restoreLastTab() below checks the same timestamp).
var BACKGROUNDED_AT_KEY = 'mjm_backgrounded_at';
var HOME_RESET_AFTER_MS = 2 * 60 * 1000;

function initHomeResetOnReturn() {
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      try { sessionStorage.setItem(BACKGROUNDED_AT_KEY, String(Date.now())); } catch (e) {}
      return;
    }
    var ts;
    try { ts = parseInt(sessionStorage.getItem(BACKGROUNDED_AT_KEY), 10); } catch (e) { ts = NaN; }
    if (ts && (Date.now() - ts) > HOME_RESET_AFTER_MS && currentScreenName !== 'home') {
      switchTabByName('home');
    }
  });
}

// Called once on load, after the tab-nav/screen markup and every tab-*.js
// file are in place. Restores whichever tab (and, for Book, which pill and
// room) the staff member was last on, so a refresh updates the data in
// place instead of resetting to Home -- unless it's been more than
// HOME_RESET_AFTER_MS since the app was last backgrounded (see
// initHomeResetOnReturn above), in which case it stays on Home instead.
function restoreLastTab() {
  var name;
  try { name = sessionStorage.getItem(LAST_TAB_KEY); } catch (e) { name = null; }
  if (!name || name === 'home' || !document.getElementById('screen-' + name)) return;
  var bgTs;
  try { bgTs = parseInt(sessionStorage.getItem(BACKGROUNDED_AT_KEY), 10); } catch (e) { bgTs = NaN; }
  if (bgTs && (Date.now() - bgTs) > HOME_RESET_AFTER_MS) return;
  switchNav(name);
  if (name === 'book' && typeof initBookTab === 'function') {
    initBookTab();
    var pill = null, room = null, vehicle = null;
    try {
      pill = sessionStorage.getItem('mjm_last_book_pill');
      room = sessionStorage.getItem('mjm_last_book_room');
      vehicle = sessionStorage.getItem('mjm_last_book_vehicle');
    } catch (e) {}
    if (pill === 'room' && typeof switchBookPill === 'function') switchBookPill('room');
    if (room && typeof selectRoom === 'function') selectRoom(room);
    if (vehicle && typeof selectVehicle === 'function') selectVehicle(vehicle);
  }
  if (name === 'faulty' && typeof initFaultyTab === 'function') initFaultyTab();
}

// ── Auth / Profile ──
function logout() {
  if (confirm('Sign out of MJMConnect?')) {
    localStorage.removeItem('mjm_user');
    // Clear the remembered tab too, so logging back in always lands on
    // Home instead of restoreLastTab() picking up where this session left off.
    try {
      sessionStorage.removeItem(LAST_TAB_KEY);
      sessionStorage.removeItem('mjm_last_book_pill');
      sessionStorage.removeItem('mjm_last_book_room');
      sessionStorage.removeItem('mjm_last_book_vehicle');
    } catch (e) {}
    window.location.href = 'login.html';
  }
}

function getCurrentUserName() {
  var raw = localStorage.getItem('mjm_user');
  if (!raw) return 'Unknown';
  var u = JSON.parse(raw);
  return u.name || u.email || 'Unknown';
}

// ── Pending-approval gate ──
// A brand-new OPISPRO sign-in (see login.html) lands here with role:'pending'
// until an Admin approves them in admin.html's Pending Approvals queue. They
// have a valid session, so skip them past the normal login redirect -- but
// nothing of the real app (Announcements, Leave, etc.) should be reachable
// until that approval happens, so this replaces the whole page instead of
// just hiding one screen.
function showPendingApprovalScreen(u) {
  var parts = (u.name || u.email || '').split(/[@.\s]/);
  var initials = parts.filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('') || 'ST';
  document.body.innerHTML =
    '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px 40px;background:var(--bg);font-family:\'Inter\',-apple-system,sans-serif;">' +
      '<div style="width:100%;max-width:360px;background:var(--surface);border-radius:20px;border:0.5px solid var(--border);box-shadow:0 4px 24px rgba(15,110,86,0.08);overflow:hidden;">' +
        '<div style="background:var(--green-dark);padding:20px 24px;display:flex;align-items:center;gap:10px;">' +
          '<div style="width:34px;height:34px;border-radius:10px;background:var(--green-mid);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ti ti-building-community" style="color:#E1F5EE;font-size:17px;"></i></div>' +
          '<div style="font-size:15px;font-weight:700;color:#E1F5EE;">MJM<span style="color:var(--green-light);font-weight:400;">Connect</span></div>' +
        '</div>' +
        '<div style="padding:28px 24px 24px;text-align:center;">' +
          '<div style="width:72px;height:72px;border-radius:50%;background:var(--amber-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;"><i class="ti ti-hourglass" style="font-size:34px;color:var(--amber-text);"></i></div>' +
          '<div style="display:inline-flex;align-items:center;gap:6px;background:var(--green-bg);border-radius:20px;padding:6px 14px;font-size:11.5px;font-weight:700;color:var(--green-text);margin-bottom:14px;"><i class="ti ti-check" style="font-size:12px;"></i> Verified with OPISPRO</div>' +
          '<div style="font-size:17px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">Almost there!</div>' +
          '<div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:18px;">Your identity\'s confirmed, but an Admin still needs to approve your MJMConnect access. This page checks automatically and takes you in the moment that happens — no need to do anything else.</div>' +
          '<div style="background:var(--bg);border-radius:14px;border:0.5px solid var(--border);padding:14px;display:flex;align-items:center;gap:12px;text-align:left;margin-bottom:18px;">' +
            '<div style="width:40px;height:40px;border-radius:50%;background:var(--green-bg);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--green-text);flex-shrink:0;">' + escHtml(initials) + '</div>' +
            '<div><div style="font-size:13px;font-weight:700;color:var(--text-primary);">' + escHtml(u.name || '') + '</div><div style="font-size:11.5px;color:var(--text-secondary);margin-top:1px;">' + escHtml(u.email || '') + (u.opispro_location ? ' · ' + escHtml(u.opispro_location) : '') + '</div></div>' +
          '</div>' +
          '<div id="pending-push-block"></div>' +
          '<button onclick="logout()" style="width:100%;background:transparent;color:var(--text-secondary);border:1px solid var(--border);border-radius:10px;padding:10px;font-size:12.5px;font-weight:600;font-family:inherit;cursor:pointer;">Sign Out</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  renderPendingPushOptIn();
  initPendingApprovalPoll(u.email);
}

// Someone stuck here has no way to know the moment an Admin approves them
// unless this tab/PWA is still open (the poll below handles that) -- a push
// notification covers them even if it's closed. Unlike the usual push
// opt-in on Home, this can't check getPushSubscriptionStatus() first (that
// needs the service worker to be fully ready, which may still be mid-flight
// this early), so it just goes off Notification.permission directly and
// lets enablePushNotifications()'s own POST be the idempotent part.
function renderPendingPushOptIn() {
  var el = document.getElementById('pending-push-block');
  if (!el) return;
  if (typeof pushSupported !== 'function' || !pushSupported() || Notification.permission !== 'default') return;
  el.innerHTML =
    '<div style="background:var(--blue-bg);border-radius:14px;border:1px solid #B7D4EE;padding:14px;margin-bottom:12px;text-align:left;">' +
      '<div style="font-size:12.5px;font-weight:700;color:var(--blue-text);margin-bottom:3px;">🔔 Get notified the moment you\'re in</div>' +
      '<div style="font-size:11.5px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px;">Turn on notifications so you know the second an Admin approves you, even if you\'ve closed the app.</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button onclick="pendingPushDismiss()" style="flex:1;background:none;border:none;color:var(--text-secondary);font-size:12px;font-weight:600;font-family:inherit;padding:8px;cursor:pointer;">Not now</button>' +
        '<button onclick="pendingPushEnableTap()" style="flex:1;background:var(--blue-text);color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:700;font-family:inherit;padding:8px;cursor:pointer;">Enable</button>' +
      '</div>' +
    '</div>';
}
function pendingPushDismiss() {
  var el = document.getElementById('pending-push-block');
  if (el) el.innerHTML = '';
}
async function pendingPushEnableTap() {
  if (typeof enablePushNotifications === 'function') await enablePushNotifications();
  pendingPushDismiss();
}

// Without this, a brand-new sign-in's localStorage role:'pending' never
// changes on its own -- an Admin approving them in admin.html only updates
// the database, and the only thing that ever re-reads it is signing in
// again from login.html. Someone sitting on this screen had no way to find
// that out: it looks identical before and after being approved, with
// nothing telling them to sign out and back in. Polling the same profiles
// row this page is already showing, and logging them straight in the
// moment role stops being 'pending', removes that dead end entirely.
function initPendingApprovalPoll(email) {
  var checking = false;
  async function checkApproval() {
    if (checking) return;
    checking = true;
    try {
      var res = await fetch(SURL + '/rest/v1/profiles?email=eq.' + encodeURIComponent(email) + '&select=role,full_name,permissions,opispro_location',
        { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var rows = await res.json();
      var profile = rows && rows[0];
      if (profile && profile.role && profile.role !== 'pending') {
        localStorage.setItem('mjm_user', JSON.stringify({
          email: email, role: profile.role, name: profile.full_name,
          permissions: profile.permissions || null, opispro_location: profile.opispro_location
        }));
        var dest = (profile.role === 'superadmin' || profile.role === 'hradmin') ? 'admin.html' : 'index.html';
        window.location.replace(dest);
      }
    } catch (e) {} finally { checking = false; }
  }
  checkApproval();
  setInterval(checkApproval, 10000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkApproval();
  });
}

// Re-fetches every tab's live data and the calendar in place, without
// navigating -- used both on initial load and by the pull-to-refresh
// gesture below, so "pull to refresh" never has to fall back to a real
// location.reload() (which blanks the whole page while index.html and
// every js/tab-*.js file it loads re-fetch over the network).
async function refreshAppData() {
  if (window.location.protocol !== 'file:') {
    await Promise.all([
      loadAnnouncements(),
      loadLeave(),
      loadDuty(),
      loadStaffEvents(),
      typeof loadEstateTrips === 'function' ? loadEstateTrips() : null,
      typeof loadTimeOff === 'function' ? loadTimeOff() : null,
      typeof loadNotifications === 'function' ? loadNotifications() : null
    ]);
    if (typeof checkPushAutoPrompt === 'function') checkPushAutoPrompt();
  }
  if (typeof initStaffCalendar === 'function') initStaffCalendar();
}

// ── Auto-update check ──
// This is a long-lived single-page app -- switching tabs never reloads
// index.html, so a deploy only ever reaches someone already using the app
// by chance (closing and reopening it, or navigating away and back via
// Setting/logout). HEAD-polling the page's own URL with cache:no-store and
// comparing ETag/Last-Modified catches a new deploy without waiting on
// that, and without the cost of re-fetching the full ~300KB page body just
// to check. Checks on load (to capture the baseline), whenever the tab/PWA
// becomes visible again, and every 5 minutes while it stays open.
function initVersionCheck() {
  var selfUrl = location.pathname.split('/').pop() || 'index.html';
  var knownTag = null;
  var checking = false;

  function checkForUpdate() {
    if (checking) return;
    checking = true;
    fetch(selfUrl, { method: 'HEAD', cache: 'no-store' }).then(function (res) {
      var tag = res.headers.get('etag') || res.headers.get('last-modified');
      if (!tag) return;
      if (knownTag === null) { knownTag = tag; return; }
      if (tag !== knownTag) showUpdateBanner();
    }).catch(function () {}).finally(function () { checking = false; });
  }

  function showUpdateBanner() {
    if (document.getElementById('update-banner')) return;
    var el = document.createElement('div');
    el.id = 'update-banner';
    el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:92px;z-index:9998;'
      + 'background:#0F6E5C;color:#fff;border-radius:14px;padding:12px 14px;'
      + 'display:flex;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,0.25);font-family:inherit;';
    el.innerHTML = '<div style="flex:1;font-size:12.5px;font-weight:600;">A new version of the app is available.</div>'
      + '<button onclick="location.reload()" style="background:#fff;color:#0F6E5C;border:none;border-radius:9px;padding:8px 14px;font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;">Refresh</button>';
    document.body.appendChild(el);
  }

  checkForUpdate();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  setInterval(checkForUpdate, 5 * 60 * 1000);
}

// ── DOMContentLoaded bootstrap ──
window.addEventListener('DOMContentLoaded', function() {
  var rawEarly = localStorage.getItem('mjm_user');
  if (rawEarly) {
    try {
      var uEarly = JSON.parse(rawEarly);
      if (uEarly && uEarly.role === 'pending') { showPendingApprovalScreen(uEarly); return; }
    } catch (e) {}
  }
  initPullToRefresh();
  initVersionCheck();
  initHomeResetOnReturn();
  // Set top avatar initials
  var raw = localStorage.getItem('mjm_user');
  if (raw) {
    var u = JSON.parse(raw);
    var parts = (u.name || u.email || '').split(/[@.\s]/);
    var initials = parts.filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
    var el = document.getElementById('top-av-initials');
    if (el) el.textContent = initials || 'ST';
    var el2 = document.getElementById('menu-av-initials');
    if (el2) el2.textContent = initials || 'ST';
    var greetEl = document.getElementById('greet-name-text');
    if (greetEl && (u.name || u.email)) greetEl.textContent = u.name || u.email;
  }
  var dateEl = document.getElementById('greet-date-text');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'short' });
  refreshAppData();
  // Auto-switch to tab based on URL hash
  if (window.location.hash === '#book') {
    switchNav('book');
    if (typeof initBookTab === 'function') initBookTab();
    window.location.hash = '';
  } else {
    restoreLastTab();
  }
  initBackButtonTrap('home');
});

// index.html is a single page -- every "tab" is just a div toggled by
// switchNav/switchTabByName, not a real navigation. Without this, the
// Android/browser back button falls through to whatever page was open
// before this one (usually login.html), which looks like an unexpected
// sign-out rather than "go back a screen" within the app.
function initBackButtonTrap(homeName) {
  history.pushState({ mjmApp: true }, '');
  window.addEventListener('popstate', function() {
    history.pushState({ mjmApp: true }, '');
    if (typeof switchNav === 'function') switchNav(homeName);
  });
}
