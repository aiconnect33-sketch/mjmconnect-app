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
var DEFAULT_PERMISSIONS = { announcements: 'view', duty: 'view', dutyRoles: 'view', events: 'view', faulty: 'view' };

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
  rememberTab(name);
}

// Hide the bottom nav while scrolling down, reveal it again on scroll up
// (or once back near the top), so it doesn't permanently eat screen space
// on long lists. The page itself scrolls (not .screen-body, which sizes to
// its content), so this listens on window rather than any inner element.
function initScrollHideNav() {
  var nav = document.querySelector('.nav-bar-wrap');
  if (!nav) return;
  var lastTop = 0;
  window.addEventListener('scroll', function() {
    var top = window.scrollY || window.pageYOffset || 0;
    if (top <= 10 || top < lastTop) nav.classList.remove('nav-hidden');
    else if (top > lastTop) nav.classList.add('nav-hidden');
    lastTop = top;
  }, { passive: true });
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
  var startY = null, pulling = false, refreshing = false;

  var indicator = document.createElement('div');
  indicator.id = 'ptr-indicator';
  indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;z-index:9999;background:#075E54;pointer-events:none;';
  indicator.innerHTML = '<div style="width:20px;height:20px;border:2.5px solid rgba(255,255,255,0.35);border-top-color:#fff;border-radius:50%;animation:ptr-spin 0.6s linear infinite;"></div>';
  document.body.appendChild(indicator);

  var style = document.createElement('style');
  style.textContent = '@keyframes ptr-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);

  function scrollTop() {
    return (document.scrollingElement || document.documentElement).scrollTop;
  }

  document.addEventListener('touchstart', function(e) {
    if (refreshing || scrollTop() > 0) { pulling = false; return; }
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!pulling || startY === null) return;
    var dy = e.touches[0].clientY - startY;
    if (dy <= 0) { indicator.style.height = '0px'; return; }
    e.preventDefault();
    indicator.style.height = Math.min(dy * 0.5, THRESHOLD + 20) + 'px';
  }, { passive: false });

  document.addEventListener('touchend', function() {
    if (!pulling) return;
    var pulled = parseInt(indicator.style.height, 10) || 0;
    pulling = false;
    startY = null;
    if (pulled >= THRESHOLD) {
      refreshing = true;
      indicator.style.height = '50px';
      location.reload();
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
  rememberTab(name);
}

// ── Remember the active tab across a refresh ──
var LAST_TAB_KEY = 'mjm_last_tab';

function rememberTab(name) {
  try { sessionStorage.setItem(LAST_TAB_KEY, name); } catch (e) {}
}

// Called once on load, after the tab-nav/screen markup and every tab-*.js
// file are in place. Restores whichever tab (and, for Book, which pill and
// room) the staff member was last on, so a refresh updates the data in
// place instead of resetting to Home.
function restoreLastTab() {
  var name;
  try { name = sessionStorage.getItem(LAST_TAB_KEY); } catch (e) { name = null; }
  if (!name || name === 'home' || !document.getElementById('screen-' + name)) return;
  switchNav(name);
  if (name === 'book' && typeof initBookTab === 'function') {
    initBookTab();
    var pill = null, room = null;
    try {
      pill = sessionStorage.getItem('mjm_last_book_pill');
      room = sessionStorage.getItem('mjm_last_book_room');
    } catch (e) {}
    if (pill === 'room' && typeof switchBookPill === 'function') switchBookPill('room');
    if (room && typeof selectRoom === 'function') selectRoom(room);
  }
  if (name === 'faulty' && typeof initFaultyTab === 'function') initFaultyTab();
}

// ── Auth / Profile ──
function logout() {
  if (confirm('Sign out of MJMConnect?')) {
    localStorage.removeItem('mjm_user');
    window.location.href = 'login.html';
  }
}

function getCurrentUserName() {
  var raw = localStorage.getItem('mjm_user');
  if (!raw) return 'Unknown';
  var u = JSON.parse(raw);
  return u.name || u.email || 'Unknown';
}

// ── DOMContentLoaded bootstrap ──
window.addEventListener('DOMContentLoaded', function() {
  initScrollHideNav();
  initPullToRefresh();
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
  // Load live data
  if (window.location.protocol !== 'file:') {
    loadAnnouncements();
    loadLeave();
    loadDuty();
    loadStaffEvents();
    if (typeof loadEstateTrips === 'function') loadEstateTrips();
    if (typeof loadTimeOff === 'function') loadTimeOff();
    if (typeof loadNotifications === 'function') loadNotifications();
  }
  // Always init calendar
  if (typeof initStaffCalendar === 'function') initStaffCalendar();
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
