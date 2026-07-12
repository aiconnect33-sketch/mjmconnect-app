---
name: run
description: Launch and drive the MJMConnect PWA (static HTML/JS + Supabase, no build step) in this repo. Use when asked to run, start, preview, or screenshot the app.
---

# Running MJMConnect

This is a **static PWA** — plain HTML/CSS/JS served directly, no
`package.json`, no bundler, no build step. Auth and data come from
Supabase (config in `js/core.js`); everything else is client-side.

Entry points: `login.html` (default landing — redirects here unless
`sessionStorage.mjm_user` is set), `index.html` (main dashboard, tabs
for Announcements/Leave/Duty/Book), `admin.html`, `register.html`,
`profile.html`.

## Start

Serve the repo root as static files — any static server works:

```bash
cd /home/user/mjmconnect-app
python3 -m http.server 8899 &
echo $! > /tmp/mjm-server.pid
timeout 15 bash -c 'until curl -sf http://localhost:8899/login.html >/dev/null; do sleep 1; done'
```

Stop with `kill $(cat /tmp/mjm-server.pid)` (or `pkill -f "http.server 8899"`)
before relaunching, or the next run hits `EADDRINUSE`.

## Drive it

No `chromium-cli` in this environment. Instead use the **global**
Playwright install with the pre-fetched Chromium binary:

```js
// node driver.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
// resolve dynamically — the numbered build dir (e.g. chromium-1194) can change:
const { execSync } = require('child_process');
const chromePath = execSync("find /opt/pw-browsers -maxdepth 3 -type f -name chrome | head -1")
  .toString().trim();

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto('http://localhost:8899/login.html', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/mjm-login.png' });
  await browser.close();
})();
```

Do **not** run `npx playwright install` — browsers are pre-fetched at
`/opt/pw-browsers` and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` blocks re-fetching.
There is no local `node_modules/playwright`; `require` it from
`/opt/node22/lib/node_modules/playwright` directly (or `npm link` it).

## Auth for testing past the login gate

There's no seeded test account. To view `index.html`/`admin.html` etc.
without real Supabase credentials, set the same sessionStorage key
`login.html` sets after a real sign-in, then navigate directly:

```js
await page.evaluate(() => {
  sessionStorage.setItem('mjm_user', JSON.stringify({ name: 'Demo User', email: 'demo@mjm.local' }));
});
await page.goto('http://localhost:8899/index.html', { waitUntil: 'networkidle' });
```

This only proves the UI shell renders — Supabase-backed reads
(`loadAnnouncements`, `loadLeave`, `loadDuty`, etc.) will show
"Loading…" / "Could not load …" if Supabase can't be reached (see
gotcha below), which is expected and not a bug in that case.

## Gotchas

- **Expect console errors for blocked external hosts** in this sandboxed
  network: `fonts.googleapis.com`, the Tabler Icons CDN, and the Supabase
  REST API (`jkbxngfwkytscgxnnnnd.supabase.co`) may fail with
  `ERR_TUNNEL_CONNECTION_FAILED` / `ERR_CONNECTION_RESET` / 404. These are
  network-policy blocks, not app bugs — don't chase them unless the task
  is specifically about Supabase connectivity.
- `login.html`'s inline `<script>` redirects to itself immediately unless
  `sessionStorage.mjm_user` is present, so `nav`-ing straight to
  `index.html` without setting it first will just bounce back to login.
