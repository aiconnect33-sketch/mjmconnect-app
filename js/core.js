// ── core.js — shared utilities, Supabase, nav, clock ──

// Supabase config
var SURL = 'https://jkbxngfwkytscgxnnnnd.supabase.co';
var SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprYnhuZ2Z3a3l0c2NneG5ubm5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTcyMjcsImV4cCI6MjA5NTYzMzIyN30._FIzBEcmwtAkADDiDZVTS-YQY0kLoGBowL8n7T45Ulk';

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
  if (!res.ok) throw new Error('Request failed: ' + res.status);
  try { return await res.json(); } catch(e) { return null; }
}

// ── Per-module permissions ──
var DEFAULT_PERMISSIONS = { announcements: 'view', leave: 'view', duty: 'view', events: 'view', book: 'edit', timeoff: 'view' };

function hasEditPermission(module) {
  var raw = sessionStorage.getItem('mjm_user');
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
function switchTab(btn, name) {
  document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.querySelectorAll('.screen-section').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  var navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  else document.getElementById('nav-home').classList.add('active');
}

function switchNav(name) {
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  var navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  document.querySelectorAll('.screen-section').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  var tabMap = { home:0, announce:1, leave:2, duty:3, book:4 };
  var tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(function(t){ t.classList.remove('active'); });
  if (tabMap[name] !== undefined) tabs[tabMap[name]].classList.add('active');
}

function switchTabByName(name) {
  var tabs = document.querySelectorAll('.tab-btn');
  var map = { home:0, announce:1, leave:2, duty:3, book:4 };
  tabs.forEach(function(t){ t.classList.remove('active'); });
  if (map[name] !== undefined) tabs[map[name]].classList.add('active');
  document.querySelectorAll('.screen-section').forEach(function(s){ s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
  var navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
}

// ── Auth / Profile ──
function logout() {
  if (confirm('Sign out of MJMConnect?')) {
    sessionStorage.removeItem('mjm_user');
    window.location.href = 'login.html';
  }
}

function getCurrentUserName() {
  var raw = sessionStorage.getItem('mjm_user');
  if (!raw) return 'Unknown';
  var u = JSON.parse(raw);
  return u.name || u.email || 'Unknown';
}

// ── DOMContentLoaded bootstrap ──
window.addEventListener('DOMContentLoaded', function() {
  // Set top avatar initials
  var raw = sessionStorage.getItem('mjm_user');
  if (raw) {
    var u = JSON.parse(raw);
    var parts = (u.name || u.email || '').split(/[@.\s]/);
    var initials = parts.filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
    var el = document.getElementById('top-av-initials');
    if (el) el.textContent = initials || 'ST';
  }
  // Load live data
  if (window.location.protocol !== 'file:') {
    loadAnnouncements();
    loadLeave();
    loadDuty();
    loadStaffEvents();
    if (typeof loadNotifications === 'function') loadNotifications();
  }
  // Always init calendar
  if (typeof initStaffCalendar === 'function') initStaffCalendar();
  // Auto-switch to tab based on URL hash
  if (window.location.hash === '#book') {
    var bookBtn = document.querySelector('.tab-btn[onclick*="book"]');
    if (bookBtn) { bookBtn.click(); }
    window.location.hash = '';
  }
});
