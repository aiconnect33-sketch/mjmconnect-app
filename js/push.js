// ── push.js — Web Push notifications (subscribe/unsubscribe + send trigger) ──
// Shared by index.html and admin.html. Self-contained (its own SURL/SKEY,
// plain fetch calls) since admin.html doesn't load core.js.
//
// See docs/push-notifications-setup.md for the Supabase Edge Function this
// talks to, and how to deploy it.

var PUSH_SURL = 'https://hbxzbowkucpqlhxdomap.supabase.co';
var PUSH_SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhieHpib3drdWNwcWxoeGRvbWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5OTEwMjYsImV4cCI6MjEwMjU2NzAyNn0.tZMdtKy92OUdLEOxKkO2XAa2bgXzkEeQtCAjtYF8yGA';

// Public by design -- a VAPID public key is meant to travel with the client.
// Must match VAPID_PUBLIC_KEY set as an Edge Function secret (see the setup doc).
var PUSH_VAPID_PUBLIC_KEY = 'BB63ufkE6XiJk7SH8-_ceNK9E8baXmeH0ucYjX8pkrilKN9tzneDfRqR4-opveQpwq7eJ1JIGs9UeIZpuEo8zv0';

var PUSH_SEND_FUNCTION_URL = 'https://hbxzbowkucpqlhxdomap.supabase.co/functions/v1/send-announcement-push';
// Must match PUSH_SECRET set as an Edge Function secret (see the setup doc).
var PUSH_SEND_SECRET = 'NkFQfYHY9-H9iVvbUOxFetYsNk8k6-0U';

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  var out = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

// One of: 'unsupported', 'denied', 'subscribed', 'unsubscribed'
async function getPushSubscriptionStatus() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'unsubscribed';
  } catch (e) {
    return 'unsubscribed';
  }
}

async function enablePushNotifications() {
  if (!pushSupported()) return false;
  var permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  var reg, sub;
  try {
    reg = await navigator.serviceWorker.ready;
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY)
      });
    }
  } catch (e) {
    // Push service unreachable (offline, or the OS/browser rejected it) --
    // leave the toggle off rather than throwing past the caller.
    return false;
  }

  var raw = localStorage.getItem('mjm_user');
  var me = raw ? JSON.parse(raw) : {};
  var json = sub.toJSON();
  try {
    await fetch(PUSH_SURL + '/rest/v1/push_subscriptions', {
      method: 'POST',
      headers: {
        'apikey': PUSH_SKEY, 'Authorization': 'Bearer ' + PUSH_SKEY,
        'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        user_email: (me.email || '').toLowerCase(),
        p256dh: json.keys.p256dh,
        auth: json.keys.auth
      })
    });
  } catch (e) {}
  return true;
}

async function disablePushNotifications() {
  if (!pushSupported()) return;
  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    try {
      await fetch(PUSH_SURL + '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(sub.endpoint), {
        method: 'DELETE',
        headers: { 'apikey': PUSH_SKEY, 'Authorization': 'Bearer ' + PUSH_SKEY }
      });
    } catch (e) {}
    await sub.unsubscribe();
  } catch (e) {}
}

// Fire-and-forget, like syncTimeOffToSheet -- never blocks or fails the
// announcement save it accompanies. No explicit Content-Type: mode:'no-cors'
// only allows "simple" requests, and the Edge Function's req.json() doesn't
// care what Content-Type the browser ends up sending anyway.
function notifyAnnouncementPush(title, body) {
  fetch(PUSH_SEND_FUNCTION_URL, {
    method: 'POST', mode: 'no-cors',
    body: JSON.stringify({ secret: PUSH_SEND_SECRET, title: title, body: body })
  }).catch(function () {});
}

// ── Auto pre-prompt on Home ──
// Explains why before the OS's own permission dialog appears (asking cold
// tends to get a reflexive "Don't Allow", which the OS then remembers and
// never offers again). Shown once per device until enabled or dismissed;
// never shown again once denied, subscribed, or unsupported.
var PUSH_PROMPT_DISMISS_KEY = 'mjm_push_prompt_dismissed';

async function checkPushAutoPrompt() {
  var el = document.getElementById('push-prompt-banner');
  if (!el) return;
  if (!pushSupported() || localStorage.getItem(PUSH_PROMPT_DISMISS_KEY)
      || typeof Notification === 'undefined' || Notification.permission !== 'default') {
    el.style.display = 'none';
    return;
  }
  var status = await getPushSubscriptionStatus();
  if (status !== 'unsubscribed') {
    el.style.display = 'none';
    return;
  }
  el.innerHTML = ''
    + '<div style="background:#E1F5EE;border:1px solid #B7E4D3;border-radius:16px;padding:16px;margin-bottom:12px;display:flex;flex-direction:column;gap:10px;">'
    +   '<div style="display:flex;gap:10px;align-items:flex-start;">'
    +     '<div style="width:34px;height:34px;border-radius:10px;background:#0F6E56;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
    +       '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#E1F5EE" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'
    +     '</div>'
    +     '<div style="flex:1;">'
    +       '<div style="font-size:14px;font-weight:700;color:#085041;margin-bottom:3px;">Get notified instantly</div>'
    +       '<div style="font-size:12.5px;color:#3E5B51;line-height:1.5;">Turn on notifications so you don\'t miss it when HR posts an announcement — even when the app is closed.</div>'
    +     '</div>'
    +   '</div>'
    +   '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    +     '<button onclick="pushPromptDismiss()" style="border:none;background:none;color:#3E5B51;font-size:13px;font-weight:600;font-family:inherit;padding:9px 12px;cursor:pointer;">Not now</button>'
    +     '<button onclick="pushPromptEnableTap()" style="border:none;background:#0F6E56;color:#fff;font-size:13px;font-weight:700;font-family:inherit;padding:9px 18px;border-radius:10px;cursor:pointer;">Enable</button>'
    +   '</div>'
    + '</div>';
  el.style.display = 'block';
}

function pushPromptDismiss() {
  try { localStorage.setItem(PUSH_PROMPT_DISMISS_KEY, '1'); } catch (e) {}
  var el = document.getElementById('push-prompt-banner');
  if (el) el.style.display = 'none';
}

async function pushPromptEnableTap() {
  await enablePushNotifications();
  // Whether granted or not, stop nagging -- if denied, Profile's status
  // text explains how to fix it in phone/browser settings.
  try { localStorage.setItem(PUSH_PROMPT_DISMISS_KEY, '1'); } catch (e) {}
  var el = document.getElementById('push-prompt-banner');
  if (el) el.style.display = 'none';
}
