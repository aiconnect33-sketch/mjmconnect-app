# Approval email setup

Emails a staff member the moment Admin approves their OPISPRO sign-in
(`admin.html`'s Pending Approvals queue → **Approve as Staff**), letting
them know they can sign in now.

## How this works (and why there's no new service)

This reuses Supabase Auth's own built-in **Invite** email — the same
mechanism `admin.html` used to use for the old HR-invite flow — instead of
a third-party service like Resend. `approveStaff()` calls Supabase's
`/auth/v1/invite` endpoint for that person's email, using the
`service_role` key (`SVCKEY`) already present in `admin.html` for
`deleteInvite()`'s legacy cleanup.

This does create a record for that email in Supabase's own internal
authentication system (separate from the `profiles` table this app
actually runs on) — a harmless side effect, since nothing in MJMConnect
reads or relies on it. The email's link just carries the person to
`login.html`, where they sign in normally with their OPISPRO credentials;
nothing reads the Supabase session that clicking it creates.

If that email already has an older Supabase Auth account (e.g. a staff
member invited under the old HR-invite system, before OPISPRO sign-in
existed), Supabase returns an error for this call ("already registered")
instead of sending anything — expected and harmless, since the call is
fire-and-forget and never blocks the Approve action either way.

## One-time setup: edit the email's wording

By default this would send Supabase's generic "You have been invited"
email, which reads oddly for someone who already signed in on their own
and is just now being approved. Change the wording once:

1. In the [Supabase dashboard](https://supabase.com/dashboard), open this
   project → **Authentication** (left sidebar) → **Email Templates**.
2. Select **Invite user**.
3. Replace the **Subject** with something like:
   `Your MJMConnect access is approved!`
4. Replace the **Message body** with something like:

   ```html
   <h2>You're approved!</h2>
   <p>An Admin has approved your MJMConnect access. Click below to sign in with your OPISPRO email and password.</p>
   <p><a href="{{ .ConfirmationURL }}">Sign in to MJMConnect</a></p>
   ```

   Keep `{{ .ConfirmationURL }}` somewhere in the body — that's what
   Supabase replaces with the real link that lands on `login.html`.
5. Click **Save**.

No schema changes, no secrets, no Edge Function, no DNS. Done.

### Test it

1. Approve a pending sign-up in `admin.html`'s Pending Approvals.
2. Check that email's inbox for "Your MJMConnect access is approved!" —
   it should arrive within a minute or two (standard Supabase Auth email
   delivery, not instant like a dedicated transactional service).
