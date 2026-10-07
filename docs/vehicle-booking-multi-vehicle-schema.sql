-- Multiple vehicles for booking — run this once in the Supabase SQL Editor
-- (project hbxzbowkucpqlhxdomap) before using the vehicle picker in the
-- Book tab.
--
-- vehicle_bookings previously assumed a single vehicle (QPA1234, hardcoded
-- in the UI) and had no column naming which vehicle a booking was for. The
-- app now lets staff pick between multiple vehicles (see the VEHICLES array
-- in js/tab-book.js and admin.html), so each booking needs to record which
-- one it's for.
--
-- The default below backfills every existing row to 'QPA1234' — the only
-- vehicle that existed before this change — so past bookings keep showing
-- up under the right vehicle. New rows always set vehicle_name explicitly
-- from the app, but the default is left in place as a safety net.

alter table vehicle_bookings
  add column vehicle_name text not null default 'QPA1234';

create index if not exists idx_vehicle_bookings_vehicle_date
  on vehicle_bookings (vehicle_name, booking_date);
