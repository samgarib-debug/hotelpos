-- Let admin-created accounts through the self-signup block (migration
-- `admin_created_signups`).
--
-- 0010's block_unconfirmed_signup refuses any auth.users insert whose
-- email/phone confirmation timestamp is null. That correctly stops public
-- /signup, but GoTrue's admin.createUser (used by the create-staff edge
-- function) inserts the row UNCONFIRMED first and only stamps
-- email_confirmed_at in a second step — so the create-staff path was being
-- rejected too.
--
-- The reliable differentiator: raw_app_meta_data (app_metadata) can ONLY be
-- written by the admin API — GoTrue's public /signup endpoint ignores/forbids
-- app_metadata and only accepts user_metadata. So a marker there cannot be
-- forged by a member of the public. create-staff stamps
-- app_metadata.hotelpos_admin_created = true; we allow those inserts and keep
-- rejecting everything else that arrives unconfirmed. Dashboard "Add user +
-- Auto Confirm" still passes on the confirmed-timestamp branch.

create or replace function public.block_unconfirmed_signup()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_app_meta_data->>'hotelpos_admin_created', 'false') = 'true' then
    return new; -- created by an admin/manager via create-staff (service role)
  end if;
  if new.email_confirmed_at is null and new.phone_confirmed_at is null then
    raise exception 'Sign-ups are disabled — ask an administrator to create your account';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
