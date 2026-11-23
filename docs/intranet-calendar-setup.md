# MJM Intranet calendar widget: leave & estate trips

The **Calendar** widget on the MJM Intranet home screen shows the same leave
and estate-trip data as MJMConnect's Home calendar: a coloured dot on each
day, and tapping a day lists who is on leave and who is going to which
estate.

The Intranet is a separate website on a separate Supabase project, so it
can't read MJMConnect's data directly. This Edge Function, `intranet-calendar`,
on **MJMConnect's** Supabase project, hands it over, but only to someone
who is signed in to the MJM Intranet **and** has been given access to the
MJMConnect icon there (the module with code `MJMCONNECT`). Everyone else
gets an error and just sees a plain calendar.

How it checks: the Intranet sends the user's Intranet login token. Using
that token, the function asks the Intranet's own database for the
`MJMCONNECT` module and for the list of modules this person may use
(`gw_my_module_ids`), so:

- not signed in or token expired → refused (401)
- signed in but no MJMConnect access → refused (403)
- signed in with access → gets the month's leave + estate trips

Data shown is the same as MJMConnect's own calendar:
- **Leave**: live from OPISPRO via the existing `opispro-get-leaves`
  function (approved MJMConnect staff only), plus Event Day Offs redeemed
  in MJMConnect.
- **Estate trips**: from the `estate_trips` table (name + estate).

**No new secrets and no database changes.** It reuses
`OPISPRO_CLIENT_SECRET` (already set for `opispro-login`) and the
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` that Supabase injects
automatically. The Intranet's address and public anon key are written in
the code below; they are public values.

## One-time setup

1. In the [Supabase dashboard](https://supabase.com/dashboard), open the
   **MJMConnect** project → **Edge Functions** → **Deploy a new function**
   → **Via Editor**.
2. Name it exactly `intranet-calendar` (the Intranet calls this URL).
3. Paste in the code from **Edge Function code** below and click **Deploy**.
4. **Required:** open the function → **Settings** tab → turn off
   **"Verify JWT with legacy secret"** → **Save changes**. The token it
   receives is an *Intranet* token, which this project can't verify itself;
   the function checks it with the Intranet instead.
5. In the MJM Intranet, the MJMConnect icon must use code **`MJMCONNECT`**.
   It is added by running `supabase/migrations/20261202100000_system_mjmconnect.sql`
   (MJM-Intranet repo) in the Intranet's SQL Editor.

## Test it

1. Sign in to the MJM Intranet as someone who has **Access** to MJMConnect.
2. Home → Add Widget → **Calendar**. Days with leave show a purple dot,
   days with estate trips a green dot.
3. Tap a day with a dot: a window lists who is on leave (and the leave
   type) and who is going to which estate.
4. Sign in as someone **without** MJMConnect access: the calendar shows
   with no dots.

## Edge Function code

```typescript
// supabase/functions/intranet-calendar/index.ts
//
// Gives the MJM Intranet's Calendar widget one month of leave + estate
// trips, the same data as MJMConnect's Home calendar. Only for people who
// are signed in to the Intranet AND have access to its MJMCONNECT module.
//
// Request:  POST { from: 'YYYY-MM-DD', days: 1..62 }
//           Authorization: Bearer <the user's MJM Intranet access token>
// Response: { ok: true,
//             leave:  [{ date, name, leave_type, day_type }],
//             estate: [{ date, name, estate }] }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OPISPRO_CLIENT_SECRET = Deno.env.get('OPISPRO_CLIENT_SECRET') || '';

// MJM Intranet (public values, same as its shared/config.js)
const INTRANET_URL = 'https://briqzyxfxsvulyizzbiu.supabase.co';
const INTRANET_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyaXF6eXhmeHN2dWx5aXp6Yml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDc3ODksImV4cCI6MjA4OTUyMzc4OX0.LGs2Jd3jiAQsfgtzBU_yfTIjEEVWsWgd0n_mOyrAl1Q';
const MODULE_CODE = 'MJMCONNECT';

// Websites allowed to call this from the browser
const ALLOWED_ORIGINS = ['https://mjmelon.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'];

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req) }
  });
}

function addDays(date: string, n: number) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Signed in to the Intranet and given Access to MJMConnect there?
// Compares the MJMCONNECT module id with the person's own usable modules
// (gw_my_module_ids: Access ticked + module in one of their Businesses;
// super admins have every module). Being an admin alone is not enough.
async function intranetAccess(token: string): Promise<number> {
  const headers = { apikey: INTRANET_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const [modRes, mineRes] = await Promise.all([
    fetch(INTRANET_URL + '/rest/v1/gw_modules?code=eq.' + MODULE_CODE + '&is_active=is.true&select=id', { headers }),
    fetch(INTRANET_URL + '/rest/v1/rpc/gw_my_module_ids', { method: 'POST', headers, body: '{}' })
  ]);
  if ([modRes.status, mineRes.status].some((s) => s === 401 || s === 403)) return 401;
  if (!modRes.ok || !mineRes.ok) return 502;
  const mod = await modRes.json();
  const mine = await mineRes.json();
  const id = Array.isArray(mod) && mod[0] && mod[0].id;
  const ids = (Array.isArray(mine) ? mine : []).map((x) => (typeof x === 'string' ? x : x && x.gw_my_module_ids));
  return id && ids.includes(id) ? 200 : 403;
}

async function db(path: string) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY }
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

type Leave = { date: string; name: string; leave_type: string; day_type: string };

async function getLeave(from: string, days: number, to: string, nameByEmail: Map<string, string>) {
  const leave: Leave[] = [];
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/opispro-get-leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: OPISPRO_CLIENT_SECRET, date: from, days })
    });
    const body = await res.json();
    const users = (body && body.ok && body.data && body.data.users) || [];
    for (const u of users) {
      for (const lv of u.leaves || []) {
        if (lv.date >= from && lv.date <= to) {
          leave.push({ date: lv.date, name: u.name, leave_type: lv.leave_type, day_type: lv.day_type });
        }
      }
    }
  } catch (_e) { /* estate trips still show without leave */ }

  // Event Day Offs live in MJMConnect, not OPISPRO (same as js/tab-leave.js)
  const credits = await db('event_day_off_credits?redeemed_date=gte.' + from + '&redeemed_date=lte.' + to
    + '&select=staff_email,staff_name,redeemed_date');
  for (const c of credits) {
    const name = nameByEmail.get(String(c.staff_email || '').toLowerCase()) || c.staff_name || c.staff_email;
    const same = leave.filter((l) => l.date === c.redeemed_date && l.name.toLowerCase() === String(name).toLowerCase());
    if (same.length) same.forEach((l) => { l.leave_type = 'EVENT_DAY_OFF'; l.day_type = 'FULL'; });
    else leave.push({ date: c.redeemed_date, name, leave_type: 'EVENT_DAY_OFF', day_type: 'FULL' });
  }
  return leave;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { ok: false, message: 'method not allowed' }, 405);

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(req, { ok: false, message: 'not signed in' }, 401);

  let body: { from?: string; days?: number };
  try { body = await req.json(); } catch (_e) { return json(req, { ok: false, message: 'bad request' }, 400); }
  const from = String((body && body.from) || '');
  const days = Math.min(62, Math.max(1, Math.floor(Number(body && body.days) || 31)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return json(req, { ok: false, message: 'from (YYYY-MM-DD) is required' }, 400);
  const to = addDays(from, days - 1);

  const access = await intranetAccess(token);
  if (access === 401) return json(req, { ok: false, message: 'not signed in' }, 401);
  if (access === 403) return json(req, { ok: false, message: 'no MJMConnect access' }, 403);
  if (access !== 200) return json(req, { ok: false, message: 'could not check access' }, 502);

  try {
    const profiles = await db('profiles?select=email,full_name&limit=1000');
    const nameByEmail = new Map<string, string>();
    for (const p of profiles) if (p.email && p.full_name) nameByEmail.set(String(p.email).toLowerCase(), p.full_name);

    const [leave, trips] = await Promise.all([
      getLeave(from, days, to, nameByEmail),
      db('estate_trips?trip_date=gte.' + from + '&trip_date=lte.' + to
        + '&select=trip_date,staff_name,staff_email,estate_name&order=trip_date.asc&limit=1000')
    ]);
    const estate = trips.map((t) => ({
      date: t.trip_date,
      name: nameByEmail.get(String(t.staff_email || '').toLowerCase()) || t.staff_name,
      estate: t.estate_name
    }));
    leave.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
    estate.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.name).localeCompare(String(b.name))));
    return json(req, { ok: true, leave, estate });
  } catch (_e) {
    return json(req, { ok: false, message: 'could not load calendar' }, 500);
  }
});
```
