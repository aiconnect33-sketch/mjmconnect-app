# Out for Work reminders: setup

Sends two phone notifications for Out for Work, and ends "Not coming back to
the office today" outings at closing time:

1. **10 minutes before a planned outing starts:** *"📅 Your work outing
   starts at 2:00 PM. Public Bank — bank-in cheques. Running late or not
   going? Tap to change."* Tapping it opens Time Off → 💼 Work with the
   Change panel open, so the time can be moved later or the outing
   cancelled before it starts. (Only for outings planned at least 10 minutes
   ahead. If the time is moved later, the reminder comes again 10 minutes
   before the new time.) At the start time itself nothing is sent; the
   outing simply begins.
2. **At the Back by time, only if they haven't tapped I'm Back:** *"⏰ Still
   out for work? Public Bank: you planned to be back by 4:00 PM. Back
   already? Tap I'm Back. Need more time? Set a new back-by time."* Sent once
   per Back by time. If they set a new one, they get one more reminder at
   that time if still out.
3. **"Not coming back to the office today"** outings get their Time In at
   closing time (4:30 PM; 12:00 PM on Saturday), Malaysia time. The app does
   this too when the person opens it; this makes sure it happens even if
   they don't.

Notifications go only to the staff member who's out, on devices where they
allowed MJMConnect notifications (the same `push_subscriptions` that get
announcements). Nothing goes to HR.

A small timed job (pg_cron) calls the `work-outing-reminders` Edge Function
every minute. Each call only sends what's due and marks it as sent, so
nothing is ever sent twice.

## One-time setup

Do these in order. Steps 2 and 3 need the SQL from step 1.

### 1. Run the SQL

In the Supabase dashboard → **SQL Editor**, run
`docs/work-outings-plan-ahead.sql` once.

### 2. Deploy the Edge Function

1. **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly `work-outing-reminders`.
3. Paste in the code from the **Edge Function code** section below.
4. Click **Deploy**.
5. Open the function → **Settings** → turn off **"Verify JWT with legacy
   secret"** → **Save changes** (same as every Edge Function in this app).

No new secrets: it uses the `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`
already added for `send-announcement-push`.

### 3. Switch on the every-minute timer

1. **Database** → **Extensions**: enable **pg_cron** and **pg_net** (search
   for each, then toggle it on).
2. **SQL Editor**: run

```sql
select cron.schedule(
  'work-outing-reminders',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://hbxzbowkucpqlhxdomap.supabase.co/functions/v1/work-outing-reminders',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $cron$
);
```

To check it's running: **SQL Editor** →
`select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;`
should show `succeeded` every minute.

To switch it off later: `select cron.unschedule('work-outing-reminders');`

### Test it

1. On a phone with MJMConnect notifications enabled, go to Time Off →
   💼 Work, type a purpose, change **Time Out** to 12 minutes from now and
   set a **Back by** 2 minutes after that, then tap **📅 Plan Work
   Outing**.
2. About 2 minutes later (10 minutes before the start) you get *"Your work
   outing starts at …"*. Tapping it opens the Change panel.
3. Leave it: it starts by itself at the planned time. Don't tap I'm Back:
   within a minute of the Back by time you get *"Still out for work?"*.

## Edge Function code

```typescript
// supabase/functions/work-outing-reminders/index.ts
//
// Called every minute by pg_cron (see docs/work-outing-reminders-setup.md).
// Each run:
//   1. "Your work outing starts at 2:00 PM" -- 10 minutes before a planned
//      outing (planned_time_out set) starts, so a delay can be fixed in
//      time. Sent once (start_notified_at; the app clears it when the time
//      out is moved later). Nothing is sent at the start itself -- the
//      outing just begins by itself.
//   2. "Still out for work?" -- outings past their back_by time that nobody
//      has tapped I'm Back on yet. Sent once per back_by (back_by_notified_at
//      is cleared by the app whenever Back by changes).
//   3. Ends "Not coming back to the office today" outings at closing time
//      (4:30 PM, Saturday 12:00 PM, Malaysia time).
// Every step is idempotent -- each row is claimed with a conditional PATCH
// before sending -- so an extra or overlapping call never sends twice. That's
// also why no secret is needed: calling it early or often only sends what is
// already due.
//
// Shares VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY with send-announcement-push
// (same project, same secret store -- nothing new to add).
// SUPABASE_URL/SUPABASE_ANON_KEY come from the environment variables every
// Edge Function gets automatically -- do NOT hardcode the anon key here.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const VAPID_SUBJECT = 'mailto:noreply@mjmconnect.app';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';

const MY_OFFSET_MS = 8 * 60 * 60 * 1000; // Malaysia is UTC+8 all year
const LATE_LIMIT_MS = 60 * 60 * 1000;    // don't send a "still out" reminder more than 1h late
const HEADS_UP_MS = 10 * 60 * 1000;      // planned outing reminder: 10 minutes before it starts

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

async function sendWebPush(subscription: { endpoint: string; p256dh: string; auth: string }, payloadObj: unknown, ttlSeconds = 900) {
  const encoder = new TextEncoder();
  const body = await encryptPayload(subscription.p256dh, subscription.auth, encoder.encode(JSON.stringify(payloadObj)));
  const authorization = await createVapidAuthHeader(subscription.endpoint);

  const pushHeaders = new Headers();
  pushHeaders.set('authorization', authorization);
  pushHeaders.set('content-encoding', 'aes128gcm');
  pushHeaders.set('ttl', String(ttlSeconds)); // a reminder is no use hours late

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

function authHeaders(extra: Record<string, string> = {}) {
  return { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY, ...extra };
}

async function rest(method: string, path: string, body?: unknown) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: authHeaders(body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(method + ' ' + path.split('?')[0] + ' failed: ' + res.status);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// "2:30 PM" in Malaysia time.
function myClock(iso: string): string {
  const d = new Date(new Date(iso).getTime() + MY_OFFSET_MS);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

// Closing time (as a UTC Date) on the Malaysia day of `iso`.
function closingFor(iso: string): Date {
  const local = new Date(new Date(iso).getTime() + MY_OFFSET_MS);
  const sat = local.getUTCDay() === 6;
  const utc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), sat ? 12 : 16, sat ? 0 : 30) - MY_OFFSET_MS;
  return new Date(utc);
}

function short(s: string, n: number) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

async function pushTo(email: string, payload: { title: string; body: string; url: string; tag: string }) {
  const subs = await rest('GET', 'push_subscriptions?user_email=eq.' + encodeURIComponent(String(email).toLowerCase()) + '&select=endpoint,p256dh,auth');
  let sent = 0;
  for (const s of (Array.isArray(subs) ? subs : [])) {
    try {
      await sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await fetch(SUPABASE_URL + '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(s.endpoint), { method: 'DELETE', headers: authHeaders() });
      }
    }
  }
  return sent;
}

type Outing = { id: number; staff_email: string; purpose: string; time_out: string; back_by: string | null; rest_of_day: boolean; created_at?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  const now = new Date();
  const nowIso = encodeURIComponent(now.toISOString());
  const lateIso = encodeURIComponent(new Date(now.getTime() - LATE_LIMIT_MS).toISOString());
  const open = 'time_in=is.null&entry_type=neq.voided';
  const result = { startingSoon: 0, stillOut: 0, closed: 0, sent: 0 };

  try {
    // 1. Planned outings starting in the next 10 minutes. Only ones planned
    //    at least 10 minutes ahead (no reminder for something just keyed in),
    //    and never once the start time has passed.
    const soonIso = encodeURIComponent(new Date(now.getTime() + HEADS_UP_MS).toISOString());
    const starting: Outing[] = await rest('GET', 'work_outings?' + open + '&planned_time_out=not.is.null&start_notified_at=is.null'
      + '&time_out=gt.' + nowIso + '&time_out=lte.' + soonIso + '&select=id,staff_email,purpose,time_out,back_by,rest_of_day,created_at') || [];
    for (const r of starting) {
      if (r.created_at && new Date(r.created_at).getTime() > new Date(r.time_out).getTime() - HEADS_UP_MS) continue;
      const claimed = await rest('PATCH', 'work_outings?id=eq.' + r.id + '&start_notified_at=is.null', { start_notified_at: now.toISOString() });
      if (!claimed || !claimed.length) continue;
      result.startingSoon++;
      result.sent += await pushTo(r.staff_email, {
        title: '📅 Your work outing starts at ' + myClock(r.time_out),
        body: short(r.purpose, 80) + '. Running late or not going? Tap to change.',
        url: './?open=work-change', tag: 'wo-start-' + r.id,
      });
    }

    // 2. Still out after the back-by time.
    const late: Outing[] = await rest('GET', 'work_outings?' + open + '&rest_of_day=is.false&back_by_notified_at=is.null'
      + '&back_by=lte.' + nowIso + '&back_by=gte.' + lateIso + '&time_out=lte.' + nowIso + '&select=id,staff_email,purpose,time_out,back_by,rest_of_day') || [];
    for (const r of late) {
      const claimed = await rest('PATCH', 'work_outings?id=eq.' + r.id + '&back_by_notified_at=is.null&time_in=is.null', { back_by_notified_at: now.toISOString() });
      if (!claimed || !claimed.length) continue;
      result.stillOut++;
      result.sent += await pushTo(r.staff_email, {
        title: '⏰ Still out for work?',
        body: short(r.purpose, 80) + ': you planned to be back by ' + myClock(r.back_by!) + ". Back already? Tap I'm Back. Need more time? Set a new back-by time.",
        url: './?open=work', tag: 'wo-back-' + r.id,
      });
    }

    // 3. "Not coming back today" outings past closing time.
    const rest_: Outing[] = await rest('GET', 'work_outings?' + open + '&rest_of_day=is.true&time_out=lte.' + nowIso + '&select=id,staff_email,purpose,time_out,back_by,rest_of_day') || [];
    for (const r of rest_) {
      let end = closingFor(r.time_out);
      if (end.getTime() < new Date(r.time_out).getTime()) end = new Date(r.time_out);
      if (now.getTime() < end.getTime()) continue;
      const mins = Math.max(0, Math.round((end.getTime() - new Date(r.time_out).getTime()) / 60000));
      const done = await rest('PATCH', 'work_outings?id=eq.' + r.id + '&time_in=is.null', { time_in: end.toISOString(), duration_minutes: mins });
      if (done && done.length) result.closed++;
    }

    return new Response(JSON.stringify({ ok: true, ...result }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e), ...result }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }
});
```
