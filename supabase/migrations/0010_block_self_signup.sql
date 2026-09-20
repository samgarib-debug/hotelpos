-- Block public self-signups at the database (applied 2026-09-20 as migration
-- `block_self_signup`). The dashboard's "Allow new users to sign up" toggle
-- repeatedly failed to persist for this project, and any successful signup
-- gets staff-level data access — so enforce it where we can verify it.
--
-- Self-signups insert an auth.users row with no confirmation timestamp
-- (email confirmation is ON for this project); dashboard "Add user" with
-- Auto Confirm — the way staff accounts are actually created — inserts a
-- confirmed row and passes. If mailer autoconfirm is ever enabled in the
-- dashboard, self-signups would arrive confirmed and bypass this trigger:
-- leave email confirmation ON.

create or replace function public.block_unconfirmed_signup()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is null and new.phone_confirmed_at is null then
    raise exception 'Sign-ups are disabled — ask an administrator to create your account';
  end if;
  return new;
end $$;

drop trigger if exists block_signup on auth.users;
create trigger block_signup before insert on auth.users
  for each row execute function public.block_unconfirmed_signup();

notify pgrst, 'reload schema';
