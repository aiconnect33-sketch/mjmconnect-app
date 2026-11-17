-- Duty plan: "Take turns in order". Run once in the Supabase SQL Editor
-- (project hbxzbowkucpqlhxdomap), after docs/duty-yearly-plan.sql.
--
-- A duty role's plan can now be either:
--   * 'yearly' -- the same calendar month every year (as before), or
--   * 'turns'  -- groups take turns, one month each, in order, starting
--                 from start_month; after the last turn it goes back to
--                 Turn 1 (e.g. 10 groups = everyone every 10 months).
-- For a 'turns' plan, duty_yearly_plan.month holds the turn number
-- (1, 2, 3, ...) instead of the calendar month.
--
-- Until this has been run, the app only offers "Same month every year".
-- Safe to run more than once. If you ever run docs/duty-yearly-plan.sql
-- again, run this file again afterwards (it replaces ensure_duty_plan()).

-- 1. How each role's plan repeats. No row = 'yearly' (plans saved before this).
create table if not exists duty_plan_settings (
  duty_role text primary key,
  plan_type text not null default 'yearly' check (plan_type in ('yearly', 'turns')),
  start_month date,            -- 'turns': the month Turn 1 starts (always the 1st)
  turns int check (turns is null or turns between 1 and 120),
  updated_at timestamptz not null default now()
);

alter table duty_plan_settings enable row level security;
drop policy if exists "anon full access" on duty_plan_settings;
create policy "anon full access" on duty_plan_settings
  for all to anon using (true) with check (true);

-- 2. Turn numbers can go past 12.
alter table duty_yearly_plan drop constraint if exists duty_yearly_plan_month_check;
alter table duty_yearly_plan add constraint duty_yearly_plan_month_check check (month between 1 and 120);

-- 3. Same as before, but works out which turn each month is for 'turns'
--    plans. Everything else is unchanged: a month is filled in once, and a
--    month someone already added (or changed) by hand is left alone.
create or replace function ensure_duty_plan(months_ahead int default 3)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m date;
  m_end date;
  r record;
  slot int;
  diff int;
  this_month date := date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur'))::date;
begin
  perform pg_advisory_xact_lock(4207011);
  for i in 0 .. greatest(months_ahead, 1) - 1 loop
    m := (this_month + make_interval(months => i))::date;
    m_end := (m + interval '1 month' - interval '1 day')::date;
    for r in
      select p.duty_role, s.plan_type, s.start_month, s.turns
      from (select distinct duty_role from duty_yearly_plan) p
      left join duty_plan_settings s on s.duty_role = p.duty_role
    loop
      if r.plan_type = 'turns' then
        continue when r.start_month is null or r.turns is null or r.turns < 1 or m < r.start_month;
        diff := (extract(year from m)::int - extract(year from r.start_month)::int) * 12
              + extract(month from m)::int - extract(month from r.start_month)::int;
        slot := (diff % r.turns) + 1;
      else
        slot := extract(month from m)::int;
      end if;
      continue when not exists (
        select 1 from duty_yearly_plan p where p.duty_role = r.duty_role and p.month = slot
      );
      continue when exists (
        select 1 from duty_plan_generated g where g.duty_role = r.duty_role and g.month_start = m
      );
      if not exists (
        select 1 from duty_roster d
        where d.duty_role = r.duty_role and d.date_from <= m_end and d.date_to >= m
      ) then
        insert into duty_roster (duty_role, staff_name, staff_email, date_from, date_to, period, plan_status)
        select p.duty_role, p.staff_name, p.staff_email, m, m_end, m::text || ' to ' || m_end::text, 'plan'
        from duty_yearly_plan p
        where p.duty_role = r.duty_role and p.month = slot;
      end if;
      insert into duty_plan_generated (duty_role, month_start) values (r.duty_role, m)
      on conflict do nothing;
    end loop;
  end loop;
end;
$$;

grant execute on function ensure_duty_plan(int) to anon;
