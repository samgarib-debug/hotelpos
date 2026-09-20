-- Staff deactivation (applied 2026-09-20 as migration `staff_deactivation`).
-- In-app "delete a staff member" that keeps the audit trail: instead of
-- deleting the auth user (which would orphan created_by/approved_by ids and
-- turn report names into "Unknown"), an admin deactivates the account:
--
--   - auth.users.banned_until is set far in the future → sign-in and token
--     refresh fail immediately (GoTrue's own ban semantics)
--   - profiles.deactivated = true, and app_role() now reports 'staff' for
--     deactivated users → a still-live access token (≤1h) instantly loses
--     every manager/admin power (RLS deletes, role assignment, closures,
--     RPC role checks) even before it expires
--   - a deactivated manager's PIN stops approving till overrides at once
--   - names/emails stay resolvable, so payments, ledger lines and PIN
--     approvals keep showing who did them
--
-- Rules enforced server-side: admins only; you cannot deactivate yourself;
-- the last active admin cannot be deactivated. Residual (documented): a
-- deactivated user's live token keeps plain staff-level DATA access until it
-- expires (≤1 hour) — identical to Supabase's own dashboard ban.

alter table public.profiles add column if not exists deactivated boolean not null default false;

-- profiles uses a column-level SELECT grant (0004): new columns must be
-- added explicitly or clients can't read them.
grant select (deactivated) on public.profiles to authenticated;

-- Deactivated users report as plain staff regardless of stored role:
-- every privilege gate in the system runs through app_role().
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as
$$ select coalesce(
     (select case when deactivated then 'staff' else role end
      from public.profiles where id = auth.uid()),
     'staff') $$;

-- A deactivated manager/admin's PIN no longer approves till overrides.
create or replace function public.verify_manager_pin(pin text, action_name text default 'unspecified')
returns table (approved_by_name text, approved_by_role text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  recent_failures int;
  day_failures int;
  global_failures int;
begin
  select count(*) into recent_failures
  from public.manager_approvals a
  where a.requested_by = auth.uid()
    and a.success = false
    and a.created_at > now() - interval '5 minutes';
  if recent_failures >= 5 then
    raise exception 'Too many attempts — try again in a few minutes';
  end if;

  select count(*) into day_failures
  from public.manager_approvals a
  where a.requested_by = auth.uid()
    and a.success = false
    and a.created_at > now() - interval '24 hours';
  if day_failures >= 20 then
    raise exception 'PIN entry locked after repeated failed attempts — ask an admin';
  end if;

  select count(*) into global_failures
  from public.manager_approvals a
  where a.success = false
    and a.created_at > now() - interval '24 hours';
  if global_failures >= 50 then
    raise exception 'PIN entry locked property-wide after repeated failures — ask an admin';
  end if;

  select p.id, p.full_name, p.role into m
  from public.profiles p
  where p.role in ('manager','admin')
    and not coalesce(p.deactivated, false)
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

-- Admin-only activate/deactivate. Writes both the profile flag (instant
-- privilege demotion + UI state) and the GoTrue ban (blocks sign-in).
create or replace function public.set_staff_active(p_user_id uuid, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
begin
  if public.app_role() <> 'admin' then
    raise exception 'Managing staff needs an admin';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account';
  end if;

  -- serialize concurrent (de)activations: two admins deactivating each
  -- other simultaneously must not slip past the last-admin check
  perform pg_advisory_xact_lock(hashtext('hotelpos_staff_admin'));

  select * into p from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Staff member not found'; end if;

  if not p_active and p.role = 'admin' then
    if not exists (select 1 from public.profiles x
                   where x.role = 'admin' and not coalesce(x.deactivated, false)
                     and x.id <> p_user_id) then
      raise exception 'Cannot deactivate the last active admin';
    end if;
  end if;

  perform set_config('hotelpos.rpc', 'set_staff_active', true);
  update public.profiles set deactivated = not p_active where id = p_user_id;
  update auth.users
  set banned_until = case when p_active then null else now() + interval '100 years' end
  where id = p_user_id;

  return jsonb_build_object(
    'id', p.id, 'email', p.email, 'active', p_active
  );
end $$;

revoke all on function public.set_staff_active(uuid, boolean) from public, anon;
grant execute on function public.set_staff_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- profiles guard: the deactivated flag moves ONLY through set_staff_active
-- (a direct admin PATCH would skip the not-self/last-admin checks and the
-- GoTrue ban — the reviewers demonstrated a permanent admin lockout). While
-- here, close the sibling holes RLS alone allows for admins: changing your
-- OWN role (last-admin self-demotion), rewriting row ids, and planting a
-- PIN hash on someone ELSE's profile (approval impersonation) — PINs move
-- only through set_manager_pin, which updates the caller's own row.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profiles()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.app_from_rpc() then return new; end if;

  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
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

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profiles();
