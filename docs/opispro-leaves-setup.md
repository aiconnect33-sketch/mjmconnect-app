# OPISPRO leave data setup

Staff no longer log their own leave in MJMConnect. Every leave shown in the
app — on the Home calendar, the "On Leave Today" card, and the Leave tab's
Currently-on-Leave/Upcoming-Leave lists — is pulled live from OPISPRO's
Get-Leaves endpoint instead, in both `index.html` (staff) and `admin.html`
(admin). OPISPRO is the single source of truth for leave; MJMConnect never
writes leave data anywhere anymore.

**Only staff with approved MJMConnect access are shown.** OPISPRO returns
leave for everyone at the company, including people who have never signed
up for MJMConnect or whose sign-up is still sitting in the Pending
Approvals queue. The function cross-checks each OPISPRO `user_id` against
the `profiles` table (matched via `opispro_user_id`, saved on `profiles`
the first time someone signs in — see `docs/opispro-login-schema.sql`) and
drops anyone whose `role` is `pending` or who has no matching profile at
all. Only people an admin has actually approved show up anywhere in
MJMConnect's leave UI.

## Why this needs a server-side piece

Same reasoning as `opispro-login`: Get-Leaves needs the same OPISPRO
**service Bearer token**, which can never be placed in a client-side file.
A Supabase Edge Function (`opispro-get-leaves`) holds it server-side and
relays the call — and since Get-Leaves is scoped to one location per call
(`HQ`, `MILL` or `ESTATE`), this function calls it three times (one per
location) and merges the results, so the app only ever makes one request.
The same function also queries `profiles` (using the Edge Function's
built-in `SUPABASE_SERVICE_ROLE_KEY`, auto-provided by Supabase on every
project — nothing to set up) to filter the merged list down to approved
staff before returning it.

**No new secrets needed.** This reuses `OPISPRO_TOKEN` and
`OPISPRO_CLIENT_SECRET`, both already set up for `opispro-login` on this
same Supabase project, plus the `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
that Supabase automatically injects into every Edge Function.

## One-time setup

### Deploy the Edge Function

1. In the [Supabase dashboard](https://supabase.com/dashboard), open this
   project → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly `opispro-get-leaves` (must match the URL hardcoded in
   `js/tab-leave.js`, `js/tab-announcements.js`, and `admin.html`).
3. Paste in the code from the **Edge Function code** section below.
4. Click **Deploy**.
5. **Required:** open the function → **Settings** tab → turn off
   **"Verify JWT with legacy secret"** → **Save changes** — same reason as
   every other function here: nobody calling this has a Supabase session,
   so `OPISPRO_CLIENT_SECRET` is the only authentication it needs.

That's it — no schema changes, no new secrets.

### Test it

1. Open `index.html` or `admin.html` on Home — the calendar should show a
   purple "Leave" dot on any day someone has approved leave in OPISPRO
   (within the next 30 days), and the "Today on Leave" card right below
   the calendar should list real names pulled from OPISPRO.
2. Open the Leave tab — it should show **Currently on Leave** and
   **Upcoming Leave (next 3 weeks)**, read-only, no "Add Leave" button
   anywhere.
3. Tap a day with a leave dot on the calendar — the day-detail sheet
   should list who's on leave that day.
4. If someone in OPISPRO is on leave but has never signed up for
   MJMConnect, or is still sitting in the Pending Approvals queue, they
   should **not** appear anywhere in the Leave tab, the calendar, or the
   "Today on Leave" card — only approved MJMConnect staff show up.

## Edge Function code

```typescript
// supabase/functions/opispro-get-leaves/index.ts
//
// Proxies OPISPRO's Get-Leaves endpoint for MJMConnect's Home calendar,
// "On Leave Today" card, and Leave tab (js/tab-leave.js,
// js/tab-announcements.js, admin.html). Get-Leaves is scoped to one
// location per call, so this fans out to HQ/MILL/ESTATE and merges the
// results -- the app only ever makes one request to this function.
//
// Only approved MJMConnect staff are returned: OPISPRO's user_id is
// cross-checked against profiles.opispro_user_id, and anyone with no
// matching profile, or whose profile is still role:'pending', is dropped.
//
// Needs two secrets already set on this Supabase project for
// opispro-login (nothing new to add):
//   OPISPRO_TOKEN          - the Sanctum service bearer token from the OPISPRO team
//   OPISPRO_CLIENT_SECRET  - must match OPISPRO_CLIENT_SECRET in the calling pages
// Plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which Supabase injects
// into every Edge Function automatically -- nothing to set up for those.

const OPISPRO_TOKEN = Deno.env.get('OPISPRO_TOKEN') || '';
const OPISPRO_CLIENT_SECRET = Deno.env.get('OPISPRO_CLIENT_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OPISPRO_BASE_URL = 'https://opispro.com';
const LOCATIONS = ['HQ', 'MILL', 'ESTATE'];

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

type OpisproLeaf = { date: string; leave_type: string; day_type: string };
type OpisproUser = { user_id: number; name: string; leaves: OpisproLeaf[] };

async function getLeavesForLocation(date: string, location: string, days: number) {
  const url = OPISPRO_BASE_URL + '/api/application/mjm-connect/leaves/get-leaves/' + date
    + '?location=' + encodeURIComponent(location) + '&days=' + days;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json', // required -- without it a bad/missing token can redirect to a login page instead of 401
      'Authorization': 'Bearer ' + OPISPRO_TOKEN
    }
  });
  if (!res.ok) return [];
  const body = await res.json();
  if (body.error_no !== 0 || !body.data) return [];
  return (body.data.users || []) as OpisproUser[];
}

// Approved = has a profile row, linked by opispro_user_id, whose role
// isn't 'pending'. Returned as strings since Postgres bigint can exceed
// JS's safe integer range -- compare opispro_user_id as a string too.
async function getApprovedOpisproUserIds(): Promise<Set<string>> {
  const url = SUPABASE_URL + '/rest/v1/profiles?role=neq.pending&opispro_user_id=not.is.null&select=opispro_user_id';
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY
    }
  });
  if (!res.ok) return new Set();
  const rows = await res.json();
  return new Set((rows || []).map((r: { opispro_user_id: number | string }) => String(r.opispro_user_id)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: corsHeaders() });

  let body: { secret?: string; date?: string; days?: number };
  try {
    body = await req.json();
  } catch (_e) {
    return new Response('bad request', { status: 400, headers: corsHeaders() });
  }
  if (!body || body.secret !== OPISPRO_CLIENT_SECRET) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders() });
  }

  const date = String(body.date || '').trim();
  const days = Number(body.days) || 31;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ ok: false, message: 'date (YYYY-MM-DD) is required' }, 400);
  }

  try {
    const [results, approvedIds] = await Promise.all([
      Promise.all(LOCATIONS.map((loc) => getLeavesForLocation(date, loc, days))),
      getApprovedOpisproUserIds()
    ]);

    const users: (OpisproUser & { location: string })[] = [];
    results.forEach((locUsers, i) => {
      locUsers.forEach((u) => {
        if (approvedIds.has(String(u.user_id))) users.push({ ...u, location: LOCATIONS[i] });
      });
    });
    users.sort((a, b) => a.name.localeCompare(b.name));

    const end = new Date(date + 'T00:00:00');
    end.setDate(end.getDate() + days - 1);
    const endDate = end.toISOString().slice(0, 10);

    return jsonResponse({ ok: true, data: { start_date: date, end_date: endDate, users } });
  } catch (_e) {
    return jsonResponse({ ok: false, message: 'Could not reach OPISPRO. Please try again.' });
  }
});
```
