-- Push Notifications feature — run this once in the Supabase SQL Editor
-- (project hbxzbowkucpqlhxdomap) before using the notification toggle in
-- profile.html or the "Notify" toggle when publishing an announcement.
--
-- See docs/push-notifications-setup.md for the rest of the setup (the
-- Edge Function that actually sends the push, and the secrets it needs).

-- One row per subscribed device/browser. `endpoint` is the unique push
-- address the browser gets from the OS's push service (FCM/APNs/etc) --
-- using it as the primary key makes re-subscribing on the same device a
-- clean upsert instead of a duplicate row.
create table push_subscriptions (
  endpoint text primary key,
  user_email text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

-- Matches the current app-wide convention: every existing table is read and
-- written directly from the client via the hardcoded anon key (see
-- docs/time-off-schema.sql for the same note).
create policy "anon full access" on push_subscriptions
  for all to anon using (true) with check (true);
