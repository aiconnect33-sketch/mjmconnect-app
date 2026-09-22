# Push Notifications setup

Lets HR post an announcement and have every staff member's phone get a
notification pop-up on the lock screen, the way a WhatsApp message does —
even if MJMConnect isn't open at the time.

This uses the standard **Web Push** system built into the browser/OS, not a
third-party notification service. Three pieces work together:

- **`js/push.js`** (already in the repo) — asks the visitor's phone for
  notification permission, subscribes it with the OS's push service, and
  saves that subscription to Supabase. Loaded by `index.html`, `admin.html`
  and `profile.html`.
- **`push_subscriptions` table** (`docs/push-notifications-schema.sql`) —
  one row per subscribed device.
- **A Supabase Edge Function** (`send-announcement-push`, code below) — the
  only piece that actually sends the push. This has to run server-side
  (a browser can't push to *other* people's phones on its own), which is
  why it needs a one-time deploy, similar in spirit to the Time Off Google
  Sheet sync's Apps Script.

## Where notifications get triggered from

- **Admin app**: the existing "Notify" toggle on the announcement composer
  (`admin.html`, next to Title/Body) now actually does something — when a
  *new* announcement is published with it switched on, every subscribed
  device gets pushed. Editing an existing announcement never re-notifies.
- **Staff app**: posting a new announcement (for whichever staff have the
  Announcements module's edit permission) always notifies — there's no
  separate toggle there.

## What the user sees

A "Push Notifications" toggle on the **Profile** page (`profile.html`),
reachable from both the staff and admin apps since they share that page.
Turning it on asks the browser/OS for permission once, then that device is
registered. Turning it off unsubscribes and removes its row from the table.

### The iPhone catch

Safari only supports push for a PWA that's been **added to the Home
Screen** (Share → Add to Home Screen) — a normal Safari tab can't receive
push notifications at all, no matter what's toggled on. It also needs
**iOS 16.4 or later**. Android/Chrome has no such restriction — it works
whether installed or just opened in the browser. The Profile page's status
text explains this automatically when push isn't supported.

## One-time setup

### 1. Create the table

Run `docs/push-notifications-schema.sql` once in the Supabase SQL Editor
(project `hbxzbowkucpqlhxdomap`) — same place every other table in this
app was created.

### 2. Deploy the Edge Function

1. In the [Supabase dashboard](https://supabase.com/dashboard), open this
   project → **Edge Functions** (left sidebar) → **Deploy a new function**.
2. Name it exactly `send-announcement-push` (this must match the URL
   already hardcoded in `js/push.js`).
3. Paste in the code from the `Edge Function code` section below, replacing
   whatever placeholder code the dashboard starts you with.
4. Click **Deploy**.
5. Still on the Edge Functions page, go to **Manage secrets** (or **Project
   Settings → Edge Functions → Secrets**) and add these three:

   | Secret name | Value |
   |---|---|
   | `PUSH_SECRET` | `NkFQfYHY9-H9iVvbUOxFetYsNk8k6-0U` |
   | `VAPID_PUBLIC_KEY` | `BB63ufkE6XiJk7SH8-_ceNK9E8baXmeH0ucYjX8pkrilKN9tzneDfRqR4-opveQpwq7eJ1JIGs9UeIZpuEo8zv0` |
   | `VAPID_PRIVATE_KEY` | `EbQGfMKcXufijA8LV__TULQVGtUxLQv3g7a0HIP-qpQ` |

   `PUSH_SECRET` and `VAPID_PUBLIC_KEY` already match the values hardcoded
   in `js/push.js` — nothing in the app code needs to change. Only
   `VAPID_PRIVATE_KEY` is a genuine secret; it's never sent to any browser.
6. Redeploy the function once after adding the secrets so it picks them up
   (Edge Functions → the function → **Deploy** again; secrets set after the
   first deploy don't apply retroactively).

That's it — no CLI, no local install required.

### 3. Test it

1. Open the app on a phone (installed to Home Screen if it's an iPhone),
   go to **Profile**, and turn on **Push Notifications**. Approve the
   permission prompt.
2. From the admin app, publish a test announcement with "Notify" on.
3. The phone should show a notification within a couple of seconds, even
   if the app is in the background or closed. Tapping it opens the app.

## Updating the function later

Same pattern as the sheet sync: **Edge Functions → send-announcement-push
→ edit the code → Deploy**. The function's URL never changes, so nothing
in `js/push.js` needs updating unless the function is renamed.

## Edge Function code

```typescript
// supabase/functions/send-announcement-push/index.ts
//
// MJMConnect — sends a Web Push notification to every subscribed device
// whenever an announcement is published. Called fire-and-forget from
// js/push.js's notifyAnnouncementPush(), itself called right after a new
// announcement is saved (admin.html's publishAnnouncement, or
// js/tab-announcements.js's saveAnnouncement).
//
// Needs three secrets set on this Supabase project (see the setup doc):
//   PUSH_SECRET        - must match PUSH_SEND_SECRET in js/push.js
//   VAPID_PUBLIC_KEY   - must match PUSH_VAPID_PUBLIC_KEY in js/push.js
//   VAPID_PRIVATE_KEY  - never exposed to any client code

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = 'https://hbxzbowkucpqlhxdomap.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhieHpib3drdWNwcWxoeGRvbWFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5OTEwMjYsImV4cCI6MjEwMjU2NzAyNn0.tZMdtKy92OUdLEOxKkO2XAa2bgXzkEeQtCAjtYF8yGA';

const PUSH_SECRET = Deno.env.get('PUSH_SECRET') || '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';

webpush.setVapidDetails('mailto:noreply@mjmconnect.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: corsHeaders() });

  let body;
  try {
    body = await req.json();
  } catch (_e) {
    return new Response('bad request', { status: 400, headers: corsHeaders() });
  }
  if (!body || body.secret !== PUSH_SECRET) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders() });
  }

  const title = String(body.title || 'MJMConnect').slice(0, 100);
  const message = String(body.body || '').slice(0, 300);

  const subsRes = await fetch(SUPABASE_URL + '/rest/v1/push_subscriptions?select=endpoint,p256dh,auth', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY }
  });
  const subs = await subsRes.json();
  const list = Array.isArray(subs) ? subs : [];

  let sent = 0, removed = 0;
  await Promise.all(list.map(async (s) => {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, JSON.stringify({ title, body: message }));
      sent++;
    } catch (err) {
      // 404/410 means the OS/browser invalidated this subscription (app
      // uninstalled, permission revoked, etc) -- stop retrying it forever.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        removed++;
        await fetch(SUPABASE_URL + '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(s.endpoint), {
          method: 'DELETE',
          headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY }
        });
      }
    }
  }));

  return new Response(JSON.stringify({ ok: true, sent, removed, total: list.length }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
});
```
