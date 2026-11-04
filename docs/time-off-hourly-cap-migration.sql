-- Time Off hourly-cap redesign — run this once in the Supabase SQL Editor
-- (project hbxzbowkucpqlhxdomap), the same hand-run way every other table/
-- migration in this repo was applied (see docs/time-off-schema.sql).
--
-- Adds the 'cancel_pending' entry_type needed by the new staff-requests /
-- HR-approves cancellation flow (replaces the old self-service immediate
-- void for over-2h trips), plus a timestamp recording when that request
-- was made.

alter table time_off_records drop constraint if exists time_off_records_entry_type_check;
alter table time_off_records add constraint time_off_records_entry_type_check
  check (entry_type in ('live','edited','backfilled','voided','cancel_pending'));

alter table time_off_records add column if not exists cancel_requested_at timestamptz;
