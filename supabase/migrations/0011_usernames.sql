-- Username-based staff identity (migration `usernames`).
-- Staff accounts stop using real email addresses: the login identity is a
-- username, and the auth row carries a synthetic address
-- `<username>@hotelpos.invalid` (.invalid is RFC-2606 reserved — it can never
-- resolve or receive mail, so a leaked "recovery" email has nowhere to go).
-- Accounts are created in-app by managers/admins through the `create-staff`
-- edge function (service role), which is also why the public sign-up screen
-- is gone. The profiles.username column is the display identity everywhere
-- the UI used to show an email.

-- 1) Column + read grant (profiles uses COLUMN-level SELECT grants — 0004)
alter table public.profiles add column if not exists username text;
grant select (username) on public.profiles to authenticated;

-- Shared derivation: sanitize an arbitrary string into a valid, unique
-- username (<=32 chars, matching profiles_username_format below). The suffix
-- path trims the base so base||n never exceeds 32 and never trips the CHECK.
create or replace function public.hotelpos_unique_username(raw text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  base text;
  cand text;
  n int := 1;
begin
  base := lower(coalesce(raw, ''));
  base := regexp_replace(base, '[^a-z0-9._-]', '', 'g');
  base := regexp_replace(base, '^[^a-z0-9]+', '');
  if base is null or base = '' then base := 'user'; end if;
  base := left(base, 32);
  cand := base;
  while exists (select 1 from public.profiles p where lower(p.username) = lower(cand)) loop
    n := n + 1;
    cand := left(base, 32 - length(n::text)) || n::text;
  end loop;
  return cand;
end $$;

-- Internal-only: called by the backfill and handle_new_user (both run in the
-- definer/trigger context). It is SECURITY DEFINER and probes profiles, so
-- leaving the default PUBLIC execute grant would expose it via PostgREST as an
-- anon username-enumeration oracle. Lock it down like every other helper.
revoke all on function public.hotelpos_unique_username(text) from public, anon, authenticated;

-- 2) Backfill existing rows from the email local part (deduped, <=32)
do $$
declare r record;
begin
  for r in select id, email from public.profiles where username is null order by created_at
  loop
    update public.profiles
      set username = public.hotelpos_unique_username(split_part(coalesce(r.email, ''), '@', 1))
      where id = r.id;
  end loop;
end $$;

alter table public.profiles alter column username set not null;
create unique index if not exists profiles_username_key on public.profiles (lower(username));
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[a-z0-9][a-z0-9._-]{0,31}$');

-- 3) New auth users get a username AND the role.
--    - create-staff supplies a pre-validated username in signup metadata:
--      use it VERBATIM so profiles.username stays == the synthetic auth email
--      local part (no truncation/rename, or the login mapping desyncs). A
--      username collision then rolls the auth insert back and create-staff
--      surfaces "already taken" — a clean failure beats a silent rename.
--    - otherwise (dashboard "Add user") derive + dedupe from the email.
--    - role: the FIRST account ever created becomes admin (kept from 0003 —
--      the bootstrap the rest of the account chain depends on); everyone
--      else starts as staff.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_username text;
  uname text;
  new_role text;
begin
  meta_username := lower(nullif(new.raw_user_meta_data->>'username', ''));
  if meta_username is not null and meta_username ~ '^[a-z0-9][a-z0-9._-]{0,31}$' then
    uname := meta_username; -- verbatim; unique index backstops races
  else
    uname := public.hotelpos_unique_username(
      coalesce(meta_username, split_part(coalesce(new.email, ''), '@', 1)));
  end if;

  new_role := case when exists (select 1 from public.profiles) then 'staff' else 'admin' end;

  insert into public.profiles (id, email, full_name, username, role)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), uname),
          uname, new_role)
  on conflict (id) do nothing;
  return new;
end $$;

-- 4) Usernames and the stored auth email are fixed once created: a client
-- rename would desync the login identity from the synthetic auth address.
-- (Renames would need a dedicated RPC that updates both sides atomically.)
create or replace function public.guard_profiles()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.app_from_rpc() then return new; end if;

  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
  end if;
  if new.username is distinct from old.username then
    raise exception 'Usernames are fixed at account creation';
  end if;
  if new.email is distinct from old.email then
    raise exception 'The stored login address cannot be edited';
  end if;
  if new.deactivated is distinct from old.deactivated then
    raise exception 'Use Deactivate/Reactivate on the Staff page — it applies the sign-in ban and safety checks';
  end if;
  if new.role is distinct from old.role and old.id = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;
  if new.pin_hash is distinct from old.pin_hash and old.id <> auth.uid() then
    raise exception 'PINs are set by their owner';
  end if;
  return new;
end $$;

-- 5) The auth email is the username in disguise — keep it that way. GoTrue's
-- public email-change endpoint would let a signed-in user swap their synthetic
-- address for a real one (desyncing the login identity and re-introducing
-- email). GoTrue runs as supabase_auth_admin; its other row updates (sign-in
-- timestamps, ban changes) leave email untouched and pass. Elevated SQL
-- (postgres/service role) still changes emails for migrations.
create or replace function public.block_auth_email_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email
     and session_user = 'supabase_auth_admin' then
    raise exception 'Staff sign in with usernames — the login address cannot be changed';
  end if;
  return new;
end $$;

drop trigger if exists block_email_change on auth.users;
create trigger block_email_change before update on auth.users
  for each row execute function public.block_auth_email_change();

notify pgrst, 'reload schema';
