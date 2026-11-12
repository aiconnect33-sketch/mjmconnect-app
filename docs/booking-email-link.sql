-- Link vehicle and room bookings to the booker's email. Run once in the
-- Supabase SQL Editor (project hbxzbowkucpqlhxdomap) BEFORE the app update
-- that starts saving booked_by_email goes live -- until this column exists,
-- that update can't save new bookings.
--
-- Bookings used to store only the booker's name (booked_by), so renaming
-- someone stopped "My Bookings" recognising their older bookings, and the
-- name shown on a booking never updated. The app now saves the booker's
-- email too, and uses it to decide whose booking it is and to show their
-- current name. booked_by stays as the name they had at the time.

-- 1. Add the column.
alter table vehicle_bookings add column if not exists booked_by_email text;
alter table room_bookings    add column if not exists booked_by_email text;

-- 2. Fill it in for existing bookings whose saved name matches exactly one
--    person's current name (or that saved an email instead of a name).
--    A name shared by two people is skipped rather than guessed.
update vehicle_bookings b
set booked_by_email = lower(p.email)
from profiles p
where b.booked_by_email is null
  and (lower(b.booked_by) = lower(p.full_name) or lower(b.booked_by) = lower(p.email))
  and (select count(*) from profiles p2 where lower(p2.full_name) = lower(b.booked_by)) <= 1;

update room_bookings b
set booked_by_email = lower(p.email)
from profiles p
where b.booked_by_email is null
  and (lower(b.booked_by) = lower(p.full_name) or lower(b.booked_by) = lower(p.email))
  and (select count(*) from profiles p2 where lower(p2.full_name) = lower(b.booked_by)) <= 1;

-- 3. See what's left: bookings saved under a name nobody has any more
--    (made before a rename), or a name two people share.
select 'vehicle' as type, booked_by, count(*) as bookings
from vehicle_bookings where booked_by_email is null group by booked_by
union all
select 'room', booked_by, count(*)
from room_bookings where booked_by_email is null group by booked_by
order by 1, 2;

-- 4. For each name listed above, link it to the right person's email
--    (replace both values), e.g.:
--
-- update vehicle_bookings set booked_by_email = 'their.email@example.com'
--   where booked_by = 'Their Old Name' and booked_by_email is null;
-- update room_bookings    set booked_by_email = 'their.email@example.com'
--   where booked_by = 'Their Old Name' and booked_by_email is null;
