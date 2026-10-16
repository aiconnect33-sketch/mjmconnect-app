# Staff status email setup

Emails a staff member twice during the OPISPRO sign-in / approval flow:

1. **Right after their first-ever OPISPRO sign-in** (`login.html`'s
   `handleSignIn()`, when a new `role: 'pending'` profile is created) —
   lets them know their request reached Admin and is waiting on approval.
2. **The moment Admin approves them** (`admin.html`'s `approveStaff()`) —
   lets them know they can sign in and use the app now.

## Why this needs a server-side piece, and a new service

Browsers can't send email directly, and this app has no email-sending
infrastructure of its own — the only emails it ever sent were Supabase
Auth's built-in invite/reset emails, which only cover fixed auth-link
flows (not free-form text like this) and were removed along with the old
HR-invite system. So this uses [Resend](https://resend.com) — a
transactional email API — called from a new Supabase Edge Function,
same server-side-secret reasoning as `opispro-login` and the push
notification functions.

## One-time setup

### 1. Get a Resend API key

1. Sign up at [resend.com](https://resend.com) (free tier, no card
   needed).
2. **API Keys** → **Create API Key** → name it anything (e.g.
   "MJMConnect") → copy the key (starts with `re_...`; shown once).

This starts sending immediately from `onboarding@resend.dev` — no domain
verification needed. If a branded sender address (e.g.
`notifications@mjmconnect.app`) is wanted later, that requires verifying
a domain under **Domains** in Resend and updating `FROM_EMAIL` below —
not required to get this working today.

### 2. Deploy the Edge Function

1. In the [Supabase dashboard](https://supabase.com/dashboard), open this
   project → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly `notify-staff-status` (must match the URL hardcoded in
   `login.html`'s `notifyStaffEmail()` and `admin.html`'s
   `notifyStaffApproved()`).
3. Paste in the code from the **Edge Function code** section below.
4. Click **Deploy**.
5. **Manage secrets** → add:

   | Secret name | Value |
   |---|---|
   | `RESEND_API_KEY` | *(the `re_...` key from step 1)* |
   | `EMAIL_NOTIFY_SECRET` | `NkFQfYHY9-H9iVvbUOxFetYsNk8k6-0U` |

   `EMAIL_NOTIFY_SECRET` must match the constant of the same name already
   hardcoded in `login.html` and `admin.html` — nothing in the app code
   needs to change. Only `RESEND_API_KEY` is a genuine secret.
6. Redeploy once after adding the secrets so it picks them up.
7. **Required:** open the function → **Settings** tab → turn off
   **"Verify JWT with legacy secret"** → **Save changes**. Same reason as
   every other function in this app: nobody calling this has a Supabase
   session, so `EMAIL_NOTIFY_SECRET` is the only authentication it needs.

That's it — no schema changes.

### 3. Test it

1. Sign in on `login.html` with an OPISPRO email that has no existing
   MJMConnect profile — that inbox should get a "We've received your
   request" email within a few seconds.
2. In `admin.html`'s Pending Approvals, click **Approve as Staff** for
   that person — the same inbox should get a "You're approved" email.
3. Check the function's **Invocations**/**Logs** tab in Supabase if
   either doesn't arrive (also check spam — `onboarding@resend.dev` is
   more likely to land there than a verified domain would).

## Edge Function code

```typescript
// supabase/functions/notify-staff-status/index.ts
//
// Emails a staff member at two points in the OPISPRO sign-in / approval
// flow: right after their first sign-in creates a pending profile
// (login.html's notifyStaffEmail('pending', ...)), and right after Admin
// approves them (admin.html's notifyStaffApproved(...)). Both calls are
// fire-and-forget and never block the action that triggers them.
//
// Needs two secrets set on this Supabase project:
//   RESEND_API_KEY       - from resend.com's API Keys page
//   EMAIL_NOTIFY_SECRET  - must match EMAIL_NOTIFY_SECRET in login.html/admin.html

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const EMAIL_NOTIFY_SECRET = Deno.env.get('EMAIL_NOTIFY_SECRET') || '';

// Resend requires no domain verification to send from this address.
// Swap for a verified domain's address later if wanted (see the setup doc).
const FROM_EMAIL = 'MJMConnect <onboarding@resend.dev>';

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function emailContent(type: string, name: string): { subject: string; html: string } | null {
  const safeName = escapeHtml(name || 'there');
  if (type === 'pending') {
    return {
      subject: "MJMConnect — We've received your request",
      html: `<p>Hi ${safeName},</p>`
        + `<p>Thanks for signing in to MJMConnect with your OPISPRO account. Your identity's confirmed, but an Admin still needs to approve your access before you can use the app.</p>`
        + `<p>You'll get another email as soon as that happens — usually within a day.</p>`
        + `<p>— MJMConnect</p>`
    };
  }
  if (type === 'approved') {
    return {
      subject: 'MJMConnect — You\'re approved!',
      html: `<p>Hi ${safeName},</p>`
        + `<p>Good news — an Admin has approved your MJMConnect access. You can sign in now with your OPISPRO email and password to see the full app.</p>`
        + `<p>— MJMConnect</p>`
    };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: corsHeaders() });

  let body: { secret?: string; type?: string; name?: string; email?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return new Response('bad request', { status: 400, headers: corsHeaders() });
  }
  if (!body || body.secret !== EMAIL_NOTIFY_SECRET) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders() });
  }

  const email = String(body.email || '').trim();
  const name = String(body.name || '').trim();
  const content = emailContent(String(body.type || ''), name);
  if (!email || !content) {
    return new Response('bad request', { status: 400, headers: corsHeaders() });
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: content.subject,
        html: content.html
      })
    });
    const ok = res.ok;
    return new Response(JSON.stringify({ ok }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  } catch (_e) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }
});
```
