-- Gate self-signup on the staff email domain, and narrow the email-change
-- block (migration `signup_domain_gate`).
--
-- Migration 0012 tried to admit create-staff's admin.createUser insert by a
-- raw_app_meta_data marker, but this GoTrue version does NOT populate
-- app_metadata at INSERT time (it lands after), so the BEFORE INSERT
-- block_unconfirmed_signup never saw the marker and kept rejecting the create.
--
-- The signal that IS reliable at INSERT is the email domain. Staff accounts
-- created in-app carry the synthetic `<username>@hotelpos.invalid` address —
-- only the create-staff edge function (service role) mints those. A public
-- /signup aimed at that domain is inert: `.invalid` can never receive the
-- confirmation mail, so with email confirmation ON the row can never be
-- confirmed and can never sign in (and GoTrue typically rolls the signup back
-- when the confirmation mail fails to send). So admitting that domain is safe;
-- everything else must arrive already confirmed (dashboard Add-user with Auto
-- Confirm) or it is a public self-signup and stays blocked. The app_metadata
-- marker is kept as belt-and-braces for GoTrue builds that DO set it at insert.
create or replace function public.block_unconfirmed_signup()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_app_meta_data->>'hotelpos_admin_created', 'false') = 'true'
     or new.email like '%@hotelpos.invalid'
     or new.email_confirmed_at is not null
     or new.phone_confirmed_at is not null then
    return new;
  end if;
  raise exception 'Sign-ups are disabled — ask an administrator to create your account';
end $$;

-- Narrow the email-change block so it can only ever stop the real threat — a
-- signed-in staff member swapping their synthetic (@hotelpos.invalid) login
-- identity for a REAL address via GoTrue's email-change flow. GoTrue's own
-- account creation/confirmation (which keeps the synthetic address) and
-- service-role migrations (session_user <> supabase_auth_admin) pass untouched.
create or replace function public.block_auth_email_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if session_user = 'supabase_auth_admin'
     and new.email is distinct from old.email
     and old.email like '%@hotelpos.invalid'
     and new.email is not null and new.email <> ''
     and new.email not like '%@hotelpos.invalid' then
    raise exception 'Staff sign in with usernames — the login address cannot be changed';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
