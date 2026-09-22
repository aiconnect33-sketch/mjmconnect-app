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
//
// Sends Web Push directly via the Web Crypto API (RFC 8291 payload
// encryption + RFC 8292 VAPID auth) instead of the "web-push" npm package
// -- that package's internal request builder throws "'headers' of
// 'RequestInit' is not a valid ByteString" under Supabase's Deno runtime.
//
// SUPABASE_URL/SUPABASE_ANON_KEY come from the environment variables every
// Edge Function gets automatically -- do NOT hardcode the anon key as a
// string literal here. The Supabase code editor's secret-detection appears
// to silently corrupt a hardcoded JWT-shaped literal on save/deploy, which
// was the actual cause of every "not a valid ByteString" crash above (not
// a real Deno/runtime bug) -- confirmed by switching to Deno.env.get().

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const VAPID_SUBJECT = 'mailto:noreply@mjmconnect.app';

const PUSH_SECRET = Deno.env.get('PUSH_SECRET') || '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

// RFC 8292 -- signs a short-lived JWT identifying this server to the push
// service, using the VAPID keypair.
async function createVapidAuthHeader(endpoint: string): Promise<string> {
  const pubBytes = b64urlDecode(VAPID_PUBLIC_KEY); // 65 bytes: 0x04 || X(32) || Y(32)
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: b64urlEncode(pubBytes.slice(1, 33)),
    y: b64urlEncode(pubBytes.slice(33, 65)),
    d: VAPID_PRIVATE_KEY,
    ext: true,
  };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const encoder = new TextEncoder();
  const headerB64 = b64urlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payloadB64 = b64urlEncode(encoder.encode(JSON.stringify({ aud, exp, sub: VAPID_SUBJECT })));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoder.encode(signingInput));
  const jwt = `${signingInput}.${b64urlEncode(new Uint8Array(signature))}`;
  return `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`;
}

// RFC 8291 -- encrypts the notification payload for one subscriber, using
// their p256dh/auth keys plus a fresh ephemeral ECDH keypair per message.
async function encryptPayload(p256dhB64: string, authB64: string, plaintext: Uint8Array): Promise<Uint8Array> {
  const subscriberPublicKeyBytes = b64urlDecode(p256dhB64); // 65 bytes
  const authSecret = b64urlDecode(authB64); // 16 bytes

  const ephemeralKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephemeralPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey));

  const subscriberPublicKey = await crypto.subtle.importKey('raw', subscriberPublicKeyBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: subscriberPublicKey }, ephemeralKeyPair.privateKey, 256));

  const encoder = new TextEncoder();
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concatBytes(encoder.encode('WebPush: info'), new Uint8Array([0]), subscriberPublicKeyBytes, ephemeralPublicKeyRaw);
  const ikm = (await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);

  const cek = (await hmacSha256(prk, concatBytes(encoder.encode('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))).slice(0, 16);
  const nonce = (await hmacSha256(prk, concatBytes(encoder.encode('Content-Encoding: nonce'), new Uint8Array([0, 1])))).slice(0, 12);

  const paddedPlaintext = concatBytes(plaintext, new Uint8Array([2])); // padding delimiter, no extra padding
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, paddedPlaintext));

  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, 4096, false); // record size, big-endian
  const recordHeader = concatBytes(salt, rsBytes, new Uint8Array([ephemeralPublicKeyRaw.length]), ephemeralPublicKeyRaw);
  return concatBytes(recordHeader, ciphertext);
}

async function sendWebPush(subscription: { endpoint: string; p256dh: string; auth: string }, payloadObj: unknown) {
  const encoder = new TextEncoder();
  const body = await encryptPayload(subscription.p256dh, subscription.auth, encoder.encode(JSON.stringify(payloadObj)));
  const authorization = await createVapidAuthHeader(subscription.endpoint);

  const pushHeaders = new Headers();
  pushHeaders.set('authorization', authorization);
  pushHeaders.set('content-encoding', 'aes128gcm');
  pushHeaders.set('ttl', '86400');

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: pushHeaders,
    body,
  });
  if (!res.ok) {
    const err = new Error(`Push failed: ${res.status}`) as Error & { statusCode?: number };
    err.statusCode = res.status;
    throw err;
  }
}

function authHeaders() {
  return { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY };
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

  const subsRes = await fetch(
    SUPABASE_URL + '/rest/v1/push_subscriptions?select=endpoint,p256dh,auth',
    { headers: authHeaders() }
  );
  const subs = await subsRes.json();
  const list: { endpoint: string; p256dh: string; auth: string }[] = Array.isArray(subs) ? subs : [];

  let sent = 0, removed = 0;
  await Promise.all(list.map(async (s) => {
    try {
      await sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { title, body: message });
      sent++;
    } catch (err) {
      // 404/410 means the OS/browser invalidated this subscription (app
      // uninstalled, permission revoked, etc) -- stop retrying it forever.
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        removed++;
        await fetch(
          SUPABASE_URL + '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(s.endpoint),
          { method: 'DELETE', headers: authHeaders() }
        );
      }
    }
  }));

  return new Response(JSON.stringify({ ok: true, sent, removed, total: list.length }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
});
```
