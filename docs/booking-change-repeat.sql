-- Booking: change a booking + repeating room bookings. Run once in the
-- Supabase SQL Editor (project hbxzbowkucpqlhxdomap).
--
-- * "✎ Change date / time" works without this, but the "Changed from
--   18 Nov" note needs changed_from.
-- * "Repeat: Weekly / Monthly" on the room booking form needs series_id and
--   repeat_rule -- until they exist, booking a repeat says so and nothing
--   is saved. One-off bookings are not affected either way.

-- The date a booking was first made for, set the first time its date is
-- changed (never overwritten after that).
alter table room_bookings    add column if not exists changed_from date;
alter table vehicle_bookings add column if not exists changed_from date;

-- Repeating room bookings: every date of one "Repeat" is its own row (so
-- the calendar, clash checks and the rest of the app treat them as normal
-- bookings), linked by series_id. repeat_rule describes the pattern:
-- 'weekly-<0..6, Sunday=0>' or 'monthly-<day of month>'.
alter table room_bookings add column if not exists series_id text;
alter table room_bookings add column if not exists repeat_rule text;
create index if not exists room_bookings_series_idx on room_bookings (series_id) where series_id is not null;
