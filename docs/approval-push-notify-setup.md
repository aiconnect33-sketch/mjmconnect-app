# Approval push notification setup

Pushes a notification to a staff member's device the moment an Admin
approves their pending OPISPRO sign-in (`admin.html`'s Pending Approvals
queue → **Approve as Staff**) — on top of the existing approval email (see
`docs/approval-email-setup.md`) and the pending screen's own automatic
check-and-continue (it polls every 10s and logs them straight in once
approved, as long as that tab/PWA is still open). This covers the case
where they've closed it.

## Why this needs its own Edge Function, and its own opt-in

A brand-new sign-in can't have a push subscription yet the normal way —
that only ever happens from the "Get notified instantly" banner on Home,
which a `pending` account can never reach (they're stuck on the "Almost
there" screen, not inside the real app). So the pending screen itself
(`showPendingApprovalScreen()` in `js/core.js`) now shows its own small
"Get notified the moment you're in" opt-in, which calls the exact same
`enablePushNotifications()` from `js/push.js` the Home banner uses —
same `push_subscriptions` row, same VAPID keys, nothing new on that side.

The one new piece is a second Edge Function, `notify-approved`, that
targets just the one email being approved instead of everyone (like
`send-announcement-push`) or every admin (like `notify-pending-approval`).

**You do not need to add any new secrets.** `PUSH_SECRET`, `VAPID_PUBLIC_KEY`
and `VAPID_PRIVATE_KEY` already exist as project-wide secrets (added for
`send-announcement-push`) — every Edge Function on the same Supabase project
shares the same secret store, so this new function picks them up
automatically once deployed.

If that person never tapped "Enable" on the pending screen's opt-in (or
their browser doesn't support push), they simply have no subscribed
device to send to — the function treats that as success with `sent: 0`,
same as `send-announcement-push` does for an unreachable subscription.

## One-time setup

### Deploy the Edge Function

1. In the [Supabase dashboard](https://supabase.com/dashboard), open this
   project → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly `notify-approved` (must match the URL hardcoded in
   `admin.html`'s `notifyApprovalPush()`).
3. Paste in the code from the **Edge Function code** section below.
4. Click **Deploy**.

That's it — no new secrets, no schema changes. It reads the same secrets
`send-announcement-push` already uses.

**Also required (same as every Edge Function in this app):** open the
function → **Settings** tab → turn off **"Verify JWT with legacy secret"**
→ **Save changes**. Left on, Supabase rejects every call with 401 before
the function's own code runs — nobody calling this has a Supabase session,
so the function's own `PUSH_SECRET` check is the only authentication it
needs.

### Test it

1. Sign in on `login.html` with an OPISPRO email that has no existing
   MJMConnect profile yet (a fresh test account, or delete an existing
   `pending` row first) — this lands on the "Almost there" pending screen.
2. Tap **Enable** on its "Get notified the moment you're in" card and grant
   the permission prompt.
3. From another device/session, approve that email in `admin.html`'s
   Pending Approvals queue.
4. The first device should get a notification like *"You're approved! 🎉
   Your MJMConnect access is ready — tap to open the app."* within a couple
   of seconds — even if that tab/PWA has since been closed.

## Edge Function code

```typescript
// supabase/functions/notify-approved/index.ts
//
// Sends a Web Push notification to one staff member's subscribed device(s)
// the moment an Admin approves their pending sign-in. Called fire-and-forget
// from admin.html's approveStaff() right after the profiles row's role is
// patched to 'staff' -- never blocks or fails the Approve action.
//
// Shares its secrets with send-announcement-push and notify-pending-approval
// (see docs/push-notifications-setup.md) -- same project, same secret
// store, nothing new to add:
//   PUSH_SECRET        - must match PUSH_SEND_SECRET in admin.html
//   VAPID_PUBLIC_KEY   - public by design
//   VAPID_PRIVATE_KEY  - never exposed to any client code
//
// SUPABASE_URL/SUPABASE_ANON_KEY come from the environment variables every
// Edge Function gets automatically -- do NOT hardcode the anon key as a
// string literal here (see send-announcement-push's note on why).

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

  let body: { secret?: string; email?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return new Response('bad request', { status: 400, headers: corsHeaders() });
  }
  if (!body || body.secret !== PUSH_SECRET) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders() });
  }

  const email = String(body.email || '').toLowerCase().slice(0, 200);
  if (!email) return new Response('bad request', { status: 400, headers: corsHeaders() });

  const title = "You're approved! 🎉";
  const message = 'Your MJMConnect access is ready — tap to open the app.';

  try {
    const subsRes = await fetch(
      SUPABASE_URL + '/rest/v1/push_subscriptions?user_email=eq.' + encodeURIComponent(email) + '&select=endpoint,p256dh,auth',
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
  } catch (_e) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }
});
```
