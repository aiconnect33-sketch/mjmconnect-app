-- Optional remark at Time In ("Going straight to lunch, back 1:00 PM").
-- Run once in the Supabase SQL Editor (project hbxzbowkucpqlhxdomap).
--
-- Tapping "I'm Back" asks for an optional remark before Time In, for both
-- personal Time Off and Out for Work (js/time-in-remark.js). Until this has
-- been run, Time In works as before and any remark typed is simply not
-- saved. Safe to run more than once.

alter table time_off_records add column if not exists time_in_remark text;
alter table work_outings     add column if not exists time_in_remark text;
