-- Manager PIN override at the till (applied 2026-09-20 as migration `manager_pin`).
-- PINs are bcrypt-hashed in profiles.pin_hash; the column is never readable
-- by clients (column-level SELECT grant). Verification happens in a
-- SECURITY DEFINER RPC with per-user attempt lockout and an audit log.

create extension if not exists pgcrypto with schema extensions;

alter table public.profiles add column if not exists pin_hash text;

-- Hide pin_hash from client reads: replace table-level SELECT with a
-- column list. (New profile columns need adding to this grant.)
revoke select on public.profiles from authenticated;
grant select (id, email, full_name, role, created_at) on public.profiles to authenticated;

-- Audit log: every PIN attempt (success or failure)
create table if not exists public.manager_approvals (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null,
  approved_by uuid,
  action text not null,
  success boolean not null,
  created_at timestamptz not null default now()
);
alter table public.manager_approvals enable row level security;
drop policy if exists approvals_read on public.manager_approvals;
create policy approvals_read on public.manager_approvals
  for select to authenticated using (public.app_role() in ('manager','admin'));
-- no insert/update/delete policies: only the definer functions write

-- Managers/admins set their own PIN (4-6 digits)
create or replace function public.set_manager_pin(pin text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.app_role() not in ('manager','admin') then
    raise exception 'Only managers can set a PIN';
  end if;
  if pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4-6 digits';
  end if;
  update public.profiles set pin_hash = crypt(pin, gen_salt('bf')) where id = auth.uid();
end $$;

-- Verify a PIN against all managers/admins. Logs every attempt.
-- Lockout: 5 failed attempts per user per 5 minutes.
create or replace function public.verify_manager_pin(pin text, action_name text default 'unspecified')
returns table (approved_by_name text, approved_by_role text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  recent_failures int;
begin
  select count(*) into recent_failures
  from public.manager_approvals a
  where a.requested_by = auth.uid()
    and a.success = false
    and a.created_at > now() - interval '5 minutes';
  if recent_failures >= 5 then
    raise exception 'Too many attempts — try again in a few minutes';
  end if;

  select p.id, p.full_name, p.role into m
  from public.profiles p
  where p.role in ('manager','admin')
    and p.pin_hash is not null
    and p.pin_hash = crypt(pin, p.pin_hash)
  limit 1;

  insert into public.manager_approvals (requested_by, approved_by, action, success)
  values (auth.uid(), m.id, action_name, m.id is not null);

  if m.id is null then
    return; -- empty result = wrong PIN
  end if;
  return query select m.full_name, m.role;
end $$;

revoke all on function public.set_manager_pin(text) from public, anon;
revoke all on function public.verify_manager_pin(text, text) from public, anon;
grant execute on function public.set_manager_pin(text) to authenticated;
grant execute on function public.verify_manager_pin(text, text) to authenticated;
