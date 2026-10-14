-- OPISPRO login verification — run this once in the Supabase SQL Editor
-- (project hbxzbowkucpqlhxdomap) before using the OPISPRO password field
-- on register.html.
--
-- Registration now verifies a new staff member's OPISPRO email/password
-- before letting them finish setting up their MJMConnect account (see
-- docs/opispro-login-setup.md), and saves the office location OPISPRO
-- returns ("HQ", "MILL" or "ESTATE") plus their OPISPRO user_id onto the
-- profile. Both are nullable: a password reset (flowType 'recovery')
-- never touches them, and any profile created before this feature existed
-- simply has them unset until that person re-registers.

alter table profiles
  add column opispro_user_id bigint,
  add column opispro_location text;
