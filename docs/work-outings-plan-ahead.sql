-- Out for Work: plan ahead, Back by, "Not coming back to the office today".
-- Run this once in the Supabase SQL Editor (project hbxzbowkucpqlhxdomap),
-- after docs/work-outings-schema.sql.
--
-- Until this has been run, Out for Work keeps working exactly as before
-- (Time Out for Work now / at a time already past); only planning ahead and
-- Back by say "not switched on yet".
--
-- How a planned outing works: it's an ordinary work_outings row whose
-- time_out is still in the future. Until then it shows as Upcoming; from that
-- moment it counts as out for work, with nobody needing to tap anything.
-- planned_time_out keeps the time that was planned, so the record can show
-- "planned 2:30 PM · changed to 2:45 PM" if the staff member corrects it.

alter table work_outings add column if not exists planned_time_out timestamptz;  -- set only when planned ahead
alter table work_outings add column if not exists back_by timestamptz;           -- optional "Back by" time
alter table work_outings add column if not exists rest_of_day boolean not null default false; -- not coming back today: ends at closing time
alter table work_outings add column if not exists start_notified_at timestamptz;   -- "starts in 10 minutes" reminder sent (cleared when moved later)
alter table work_outings add column if not exists back_by_notified_at timestamptz; -- "still out?" reminder sent (cleared when Back by changes)

-- The reminder job looks these up every minute.
create index if not exists work_outings_pending_idx on work_outings (time_out) where time_in is null;

-- The reminder notifications themselves (pg_cron calling the
-- work-outing-reminders Edge Function every minute) are set up separately,
-- after the Edge Function is deployed: see docs/work-outing-reminders-setup.md.
