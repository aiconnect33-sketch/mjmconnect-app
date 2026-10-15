-- OPISPRO login verification — run this once in the Supabase SQL Editor
-- (project hbxzbowkucpqlhxdomap) before using the OPISPRO sign-in on
-- login.html.
--
-- Every sign-in now verifies the person's OPISPRO email/password instead
-- of a separate MJMConnect password (see docs/opispro-login-setup.md), and
-- saves the office location OPISPRO returns ("HQ", "MILL" or "ESTATE")
-- plus their OPISPRO user_id onto the profile the first time they sign in.
-- Both are nullable: any profile created before this feature existed
-- simply has them unset.

alter table profiles
  add column opispro_user_id bigint,
  add column opispro_location text;
