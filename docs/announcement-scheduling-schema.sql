-- Announcement scheduling — run this once in the Supabase SQL Editor
-- (project hbxzbowkucpqlhxdomap) before using the new "Show on Home
-- Screen" / "Keep on Home Screen For" controls on the New Announcement
-- form.
--
-- Adds two columns to the existing announcements table:
--   publish_at         when it should first become visible. Left null for
--                       an announcement posted with "Post Now" -- the app
--                       treats a null publish_at the same as created_at
--                       (immediately visible), so every announcement
--                       posted before this migration keeps behaving
--                       exactly as it already does.
--   home_duration_days  how many days after publish_at it stays on the
--                       Home screen banner. Defaults to 2, matching the
--                       fixed 2-day window the app used everywhere before
--                       this feature existed.
--
-- Neither column changes how long an announcement stays in the full
-- Announcements list, or whether it can be edited/deleted -- only the
-- Home screen banner's visibility window.

alter table announcements
  add column if not exists publish_at timestamptz,
  add column if not exists home_duration_days integer not null default 2;
