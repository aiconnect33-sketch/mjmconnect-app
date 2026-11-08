# "Sign in with OPIS PRO" (OAuth2/OIDC) setup

Replaces `login.html`'s email/password form with a single "Sign in with
OPIS PRO" button. Clicking it opens a small popup window (or falls back to
a full-page redirect if the popup is blocked, or on a narrow/mobile
viewport) to OPIS PRO's own hosted login page -- MJMConnect never sees the
staff member's password. This is the OpenID Connect Authorization Code
flow with PKCE (S256), per OPIS PRO's own integration guide.

The first-time pending-approval flow is completely unchanged: a brand new
sign-in still lands as `role:'pending'` until an Admin approves it in
`admin.html`'s Pending Approvals queue (see `docs/approval-push-notify-setup.md`
and `docs/pending-approval-notify-setup.md`) -- this only replaces *how the
identity gets verified*, not anything downstream of that.

## Why this needs its own Edge Function

The OAuth client OPIS PRO issued for MJMConnect is a *confidential* client
(it has a client secret) -- the token exchange (`POST /oauth/token`, which
needs that secret) must happen server-side, never from the browser. The
browser only ever talks to:
- `opispro.com/oauth/authorize` directly (starting the sign-in -- no secret
  involved, just the public client ID), and
- this new `opispro-sso-exchange` Edge Function (handing it the
  authorization code once OPIS PRO redirects back), which does the real
  exchange + verification using the real client secret, kept as an Edge
  Function secret, and returns back only the verified identity.

**You do not need any new database table or column.** `profiles` already
has `opispro_user_id` (bigint) and `opispro_location` (text), added by
`docs/opispro-login-schema.sql` for the old password-based login -- these
are exactly the OIDC `sub`/`location` claims, so the existing
find-or-create-profile logic in `login.html` keeps working unchanged. This
function's response is deliberately shaped the same as the old
`opispro-login` function's (`{error_no, data:{user_id, name, email,
location}}`), specifically so that logic didn't need to change.

## One-time setup

### Deploy the Edge Function

1. In the [Supabase dashboard](https://supabase.com/dashboard), open this
   project (`hbxzbowkucpqlhxdomap`) -> **Edge Functions** -> **Deploy a new
   function** -> **Via Editor**.
2. Name it exactly `opispro-sso-exchange` (must match the URL hardcoded in
   `login.html`).
3. Paste in the code from the **Edge Function code** section below.
4. Click **Deploy**.
5. **Edge Functions -> opispro-sso-exchange -> Manage secrets** (or the
   project's shared secrets, if it has one) and set:

   | Secret name | Value |
   | --- | --- |
   | `OPISPRO_CLIENT_SECRET` | the existing shared soft secret, same one `opispro-login` and `login.html`'s `OPISPRO_CLIENT_SECRET` constant already use -- **not** the real OAuth secret, just the existing client->function gate |
   | `OPISPRO_OAUTH_CLIENT_ID` | `01a1af8d-7e6e-71bd-8bc7-e375641e47c0` (from the OPIS PRO admin) |
   | `OPISPRO_OAUTH_CLIENT_SECRET` | the real OAuth client secret from the OPIS PRO admin -- never put this anywhere else, including in this doc, a commit, or a chat message again |

   Redeploy after adding secrets if the dashboard doesn't do it for you.
6. **Also required (same as every Edge Function in this app):** open the
   function -> **Settings** tab -> turn off **"Verify JWT with legacy
   secret"** -> **Save changes**. Left on, Supabase rejects every call with
   401 before the function's own code runs -- nobody calling this has a
   Supabase session (there is no Supabase Auth anywhere in this app), so
   the function's own `OPISPRO_CLIENT_SECRET` check is the only
   authentication it needs.

### Register the callback URL with the OPIS PRO admin

Confirm `https://mjmconnect.opispro.com/login.html` is the exact callback
URL on file for client `01a1af8d-7e6e-71bd-8bc7-e375641e47c0` -- it must
match exactly or sign-in fails with an OPIS PRO-side error that never
returns to the app (see the guide's "Callback URL isn't registered" row).

### Test it

1. Open `login.html` and click **Sign in with OPIS PRO**.
2. A small popup should open to OPIS PRO's own login page. Sign in there.
3. The popup should close itself and the main window should either:
   - Show the "Almost there" pending-approval screen (first time signing
     in with this email), or
   - Go straight into `admin.html`/`index.html` (an already-approved
     account).
4. Try it again with popups blocked (disable popups for the site) -- it
   should fall back to a normal full-page redirect instead, and still work.
5. Click Cancel on OPIS PRO's page (or close the popup without finishing)
   -- the main window should recover with a clear error, not hang on
   "Finish signing in in the OPIS PRO window." forever.

## Edge Function code

```typescript
// supabase/functions/opispro-sso-exchange/index.ts
//
// Server-side half of "Sign in with OPIS PRO" (OpenID Connect,
// Authorization Code + PKCE S256). Called from login.html once OPIS PRO
// redirects back with an authorization code -- the client never sees the
// OAuth client secret or talks to opispro.com/oauth/token directly.
//
// Secrets this function needs (Supabase project hbxzbowkucpqlhxdomap):
//   OPISPRO_CLIENT_SECRET       - the existing shared "soft" secret every
//                                 Edge Function in this app gates on; ships
//                                 in login.html's public source, so it's
//                                 anti-abuse, not a real secret
//   OPISPRO_OAUTH_CLIENT_ID     - the real OAuth client id from the OPIS
//                                 PRO admin
//   OPISPRO_OAUTH_CLIENT_SECRET - the real OAuth client secret from the
//                                 OPIS PRO admin -- never logged, never
//                                 returned to the client

import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';

const OPISPRO_ISSUER = 'https://opispro.com';
const TOKEN_URL = OPISPRO_ISSUER + '/oauth/token';
const JWKS_URL = OPISPRO_ISSUER + '/oauth/jwks';

const CLIENT_GATE_SECRET = Deno.env.get('OPISPRO_CLIENT_SECRET') || '';
const CLIENT_ID = Deno.env.get('OPISPRO_OAUTH_CLIENT_ID') || '';
const CLIENT_SECRET = Deno.env.get('OPISPRO_OAUTH_CLIENT_SECRET') || '';

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// Mirrors opispro-login's convention: most failures return HTTP 200 with
// an {error_no, message} payload the client already knows how to show,
// rather than a bare HTTP error -- only a malformed/unauthorized request
// to THIS function gets a real HTTP error status.
function failResponse(error_no: number, message: string) {
  return jsonResponse({ error_no, status: 'fail', message, data: null });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: corsHeaders() });

  let body: { secret?: string; code?: string; code_verifier?: string; nonce?: string; redirect_uri?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return new Response('bad request', { status: 400, headers: corsHeaders() });
  }
  if (!body || body.secret !== CLIENT_GATE_SECRET) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders() });
  }

  const code = String(body.code || '');
  const codeVerifier = String(body.code_verifier || '');
  const nonce = String(body.nonce || '');
  const redirectUri = String(body.redirect_uri || '');
  if (!code || !codeVerifier || !nonce || !redirectUri) {
    return failResponse(2002, 'Missing sign-in details. Please try again.');
  }

  // Exchange the authorization code for tokens -- server-side only, per
  // the guide's Step 5. 10s timeout, same as the guide recommends.
  let tokenRes: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          code: code,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (_e) {
    return failResponse(9998, "Can't reach OPIS PRO. Please try again.");
  }

  if (!tokenRes.ok) {
    let errBody: { error?: string } | null = null;
    try { errBody = await tokenRes.json(); } catch (_e) { /* non-JSON error body */ }
    if (tokenRes.status === 401 || errBody?.error === 'invalid_client') {
      return failResponse(9401, 'MJMConnect could not authenticate with OPIS PRO. Please contact HR.');
    }
    if (errBody?.error === 'invalid_grant') {
      return failResponse(9400, 'Sign-in failed. Please try signing in again.');
    }
    return failResponse(9999, 'Sign-in failed. Please try again.');
  }

  let tokens: { id_token?: string };
  try {
    tokens = await tokenRes.json();
  } catch (_e) {
    return failResponse(9999, 'Sign-in failed. Please try again.');
  }
  if (!tokens.id_token) return failResponse(9999, 'Sign-in failed. Please try again.');

  // Verify the ID token before trusting anything in it -- signature, iss,
  // aud, exp (30s clock tolerance), then nonce. Per the guide's Step 6.
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(tokens.id_token, jwks, {
      issuer: OPISPRO_ISSUER,
      audience: CLIENT_ID,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
      clockTolerance: 30,
    });
    payload = result.payload;
  } catch (_e) {
    return failResponse(9402, 'Could not verify your OPIS PRO sign-in. Please try again.');
  }

  if (payload.nonce !== nonce) {
    return failResponse(9403, 'Could not verify your OPIS PRO sign-in. Please try again.');
  }

  return jsonResponse({
    error_no: 0,
    status: 'ok',
    data: {
      user_id: payload.user_id ?? payload.sub,
      name: payload.name || '',
      email: payload.email || '',
      location: payload.location || null,
    },
  });
});
```
