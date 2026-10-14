# OPISPRO login verification setup

Checks a new staff member's OPISPRO email and password during registration
(`register.html`), so their MJMConnect account can only be set up by someone
who can actually sign into OPISPRO as that person. On success, their real
name and office location (`HQ`, `MILL` or `ESTATE`) come straight from
OPISPRO instead of being typed by hand.

## Why this needs a server-side piece

OPISPRO's API (see the API reference PDF) requires a **service Bearer
token** issued by the OPISPRO team to call its Login endpoint. That token
is a genuine secret — unlike Supabase's anon key, anyone who got hold of it
could call OPISPRO as MJMConnect's service account. It can never be placed
in `register.html` or any other client-side file.

So, same reasoning as the push-notifications feature
(`docs/push-notifications-setup.md`): a **Supabase Edge Function**
(`opispro-login`) holds the token server-side and relays the call.
`register.html` calls this function instead of opispro.com directly.

## One-time setup

### 1. Add the profile columns

Run `docs/opispro-login-schema.sql` once in the Supabase SQL Editor
(project `hbxzbowkucpqlhxdomap`) — same place every other table/column in
this app was created.

### 2. Deploy the Edge Function

1. In the [Supabase dashboard](https://supabase.com/dashboard), open this
   project → **Edge Functions** → **Deploy a new function**.
2. Name it exactly `opispro-login` (must match the URL hardcoded in
   `register.html`'s `handleVerifyAndContinue()`).
3. Paste in the code from the **Edge Function code** section below.
4. Click **Deploy**.
5. Still on the Edge Functions page, go to **Manage secrets** and add:

   | Secret name | Value |
   |---|---|
   | `OPISPRO_TOKEN` | *(the Sanctum service token the OPISPRO team issues you)* |
   | `OPISPRO_CLIENT_SECRET` | `mWfK3xNqL8vY2bRz6cTdP9hJ4sAeU1oG` |

   `OPISPRO_CLIENT_SECRET` must match the `OPISPRO_CLIENT_SECRET` constant
   already hardcoded in `register.html` — nothing in the app code needs to
   change. Only `OPISPRO_TOKEN` is a genuine secret; it's never sent to any
   browser.
6. Redeploy the function once after adding the secrets so it picks them up.
7. **Required:** open the function → **Settings** tab, and turn **off**
   **"Verify JWT with legacy secret"** (or "Enforce JWT Verification"),
   then **Save changes**. Left on, Supabase rejects every call with 401
   before the function's own code runs — the client here has no Supabase
   session to attach (the person hasn't finished creating their account
   yet), so `OPISPRO_CLIENT_SECRET` is the only authentication this
   endpoint can use.

That's it — no CLI, no local install required.

### 3. Test it

1. Send yourself (or a test account) a staff invite from the admin app.
2. Open the invite link, and on the "Your Info" step, enter your real
   OPISPRO password.
3. Tap **Verify & Continue** — your name should fill in automatically from
   OPISPRO and the form should advance to the password step. A wrong
   password should show OPISPRO's own "Unauthorized. Invalid email and/or
   password." message and stay on the same step.

## A known limitation

`OPISPRO_CLIENT_SECRET` stops the function from being hit by someone who
stumbles on the URL, but — like `PUSH_SECRET` before it — it ships inside
this public, static repo, so it isn't a real secret and can't block a
determined caller who reads the page source. That caller can only ever try
*one* OPISPRO email/password guess per request (same as hitting OPISPRO's
own login form), and every wrong guess still has to go through this
function — there's no bulk/rate-limit protection here beyond whatever
OPISPRO's own login endpoint already does. Worth keeping in mind if this
ever needs tightening further (e.g. a per-IP or per-email attempt limit).

## Edge Function code

```typescript
// supabase/functions/opispro-login/index.ts
//
// Verifies a staff member's OPISPRO email + password during MJMConnect
// registration (register.html's handleVerifyAndContinue()) and returns
// their name + office location from OPISPRO. The OPISPRO service token is
// a genuine secret and must never reach the browser, so this function
// holds it server-side and relays the call -- see docs/opispro-login-setup.md.
//
// Needs two secrets set on this Supabase project:
//   OPISPRO_TOKEN          - the Sanctum service bearer token from the OPISPRO team
//   OPISPRO_CLIENT_SECRET  - must match OPISPRO_CLIENT_SECRET in register.html

const OPISPRO_TOKEN = Deno.env.get('OPISPRO_TOKEN') || '';
const OPISPRO_CLIENT_SECRET = Deno.env.get('OPISPRO_CLIENT_SECRET') || '';
const OPISPRO_BASE_URL = 'https://opispro.com';

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: corsHeaders() });

  let body: { secret?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return new Response('bad request', { status: 400, headers: corsHeaders() });
  }

  if (!body || body.secret !== OPISPRO_CLIENT_SECRET) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders() });
  }

  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!email || !password) {
    return jsonResponse({ error_no: 2001, status: 'fail', message: 'Unauthorized. No username or password specified.', data: null });
  }

  try {
    const res = await fetch(OPISPRO_BASE_URL + '/api/application/mjm-connect/login', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPISPRO_TOKEN
      },
      body: JSON.stringify({ email, password })
    });

    if (res.status === 401) {
      return jsonResponse({ error_no: 9401, status: 'fail', message: 'MJMConnect could not authenticate with OPISPRO. Please contact HR.', data: null });
    }

    const data = await res.json();
    return jsonResponse(data);
  } catch (_e) {
    return jsonResponse({ error_no: 9999, status: 'fail', message: 'Could not reach OPISPRO. Please try again.', data: null });
  }
});
```
