-- Announcement scheduling — run this once in the Supabase SQL Editor
-- (project hbxzbowkucpqlhxdomap) before using the new "Show on Home
-- Screen" / "Active Until" controls on the New Announcement form.
--
-- Adds two date columns to the existing announcements table:
--   publish_date        the day it should first become visible. Left null
--                       for an announcement posted with "Post Now" -- the
--                       app treats a null publish_date the same as the
--                       day it was created, so every announcement posted
--                       before this migration keeps behaving exactly as
--                       it already does.
--   active_until_date   the last day (inclusive) it stays on the Home
--                       screen banner. Left null falls back to 2 days
--                       after publish_date, matching the fixed 2-day
--                       window the app used everywhere before this
--                       feature existed.
--
-- Both columns only control the Home screen banner's visibility window --
-- neither changes how long an announcement stays in the full
-- Announcements list, or whether it can be edited/deleted.

alter table announcements
  add column if not exists publish_date date,
  add column if not exists active_until_date date;
