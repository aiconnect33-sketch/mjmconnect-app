# Faulty report push notification setup

Sends an app notification to whoever is on duty **today** under a duty
role marked "notify about faulty reports" (`duty_roles.notify_faulty`,
usually Maintenance) the moment a new faulty report is lodged -- the same
people the Google Sheet script already emails (see
`docs/faulty-complain-sheet-sync.md`). The email keeps working as before;
this adds an instant phone notification on top.

Triggered fire-and-forget by `notifyFaultyReportPush()` in `js/push.js`,
called from both `js/tab-faulty.js` and `admin.html` right after the report
saves. It never blocks or fails the report itself.

## Why the function looks up who's on duty itself

Unlike the Time Off one, the app doesn't tell this function *who* to
notify -- it works that out from `duty_roles` and `duty_roster`, exactly as
the app does for the email. So someone holding the shared push secret can't
use it to send notifications to arbitrary people; it only ever reaches
whoever is genuinely on duty. The person who lodged the report is left out,
so a Maintenance staff member reporting something isn't notified about
their own report.

"Today" is the Malaysia date (Asia/Kuala_Lumpur), not the server's UTC date,
so a report lodged just after midnight goes to the right day's duty.

**You do not need to add any new secrets** -- `PUSH_SECRET`,
`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` already exist as project-wide
secrets (added for `send-announcement-push`).

Only people who turned on notifications on their phone (the "Get notified
instantly" banner on Home, or Profile -> Notifications) can receive it.
Anyone on duty without that is simply skipped -- they still get the email.

## One-time setup

### Deploy the Edge Function

1. In the [Supabase dashboard](https://supabase.com/dashboard), open this
   project -> **Edge Functions** -> **Deploy a new function** -> **Via Editor**.
2. Name it exactly `notify-faulty-report` (must match the URL in
   `js/push.js`'s `notifyFaultyReportPush()`).
3. Paste in the code from the **Edge Function code** section below.
4. Click **Deploy**.

**Also required (same as every Edge Function in this app):** open the
function -> **Settings** tab -> turn off **"Verify JWT with legacy secret"**
-> **Save changes**. Left on, Supabase rejects every call with 401 before
the function's own code runs.

Until this is deployed, lodging a report still works exactly as before;
the app's call to it just quietly fails.

### Test it

1. Make sure someone is on the Duty Roster **today** under a role marked
   "notify about faulty reports", and that person has turned on
   notifications on their phone.
2. From a **different** account, lodge a faulty report.
3. Within a few seconds the on-duty person's phone should show a
   notification like *"New faulty report · Urgent -- Aircond at Meeting
   Room 1, reported by Aina Rahman."*, even if the app is closed.

## Edge Function code

```typescript
// supabase/functions/notify-faulty-report/index.ts
//
// Sends a Web Push notification about a new faulty report to whoever is on
// duty today under a duty role flagged notify_faulty -- the same people
// the Google Sheet script emails. Called fire-and-forget from
// notifyFaultyReportPush() in js/push.js, after the report has saved.
//
// Works out the recipients itself from duty_roles + duty_roster (never
// from the request), so the shared secret can't be used to notify anyone
// else. Leaves out the person who lodged the report.
//
// Shares its secrets with the other push functions (see
// docs/push-notifications-setup.md) -- nothing new to add:
//   PUSH_SECRET        - must match PUSH_SEND_SECRET in js/push.js
//   VAPID_PUBLIC_KEY   - public by design
//   VAPID_PRIVATE_KEY  - never exposed to any client code
//
// SUPABASE_URL/SUPABASE_ANON_KEY come from the environment variables every
// Edge Function gets automatically.

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

const URGENCY_LABELS: Record<string, string> = {
  immediate: 'Immediate',
  urgent: 'Urgent',
  'non-urgent': 'Non-urgent',
};

// Today's date in Malaysia, as YYYY-MM-DD (en-CA formats dates that way).
function malaysiaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
}

async function getJson(path: string): Promise<unknown[]> {
  const res = await fetch(SUPABASE_URL + path, { headers: authHeaders() });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Whoever is on duty today under a notify_faulty role -- same lookup as
// resolveFaultyNotifyEmails() in js/tab-faulty.js.
async function onDutyEmails(): Promise<string[]> {
  const today = malaysiaToday();
  const roles = await getJson('/rest/v1/duty_roles?notify_faulty=eq.true&select=name') as { name: string }[];
  const emails = new Set<string>();
  for (const role of roles) {
    const rows = await getJson(
      '/rest/v1/duty_roster?duty_role=eq.' + encodeURIComponent(role.name) +
      '&date_from=lte.' + today + '&date_to=gte.' + today + '&select=staff_email'
    ) as { staff_email: string | null }[];
    for (const r of rows) if (r.staff_email) emails.add(r.staff_email.toLowerCase());
  }
  return [...emails];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: corsHeaders() });

  let body: { secret?: string; item?: string; location?: string; urgency?: string; reportedBy?: string; reporterEmail?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return new Response('bad request', { status: 400, headers: corsHeaders() });
  }
  if (!body || body.secret !== PUSH_SECRET) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders() });
  }

  const item = String(body.item || 'An item').slice(0, 100);
  const location = String(body.location || 'an unknown location').slice(0, 100);
  const reportedBy = String(body.reportedBy || 'a staff member').slice(0, 100);
  const reporterEmail = String(body.reporterEmail || '').toLowerCase();
  const urgencyLabel = URGENCY_LABELS[String(body.urgency || '')] || '';

  const title = 'New faulty report' + (urgencyLabel ? ' · ' + urgencyLabel : '');
  const message = item + ' at ' + location + ', reported by ' + reportedBy + '.';

  try {
    const recipients = (await onDutyEmails()).filter((e) => e !== reporterEmail);

    let sent = 0, removed = 0, total = 0;
    for (const email of recipients) {
      const subs = await getJson(
        '/rest/v1/push_subscriptions?user_email=eq.' + encodeURIComponent(email) + '&select=endpoint,p256dh,auth'
      ) as { endpoint: string; p256dh: string; auth: string }[];
      total += subs.length;
      await Promise.all(subs.map(async (s) => {
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
    }

    return new Response(JSON.stringify({ ok: true, recipients: recipients.length, sent, removed, total }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  } catch (_e) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }
});
```
