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
