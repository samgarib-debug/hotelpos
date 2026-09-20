-- Server-side enforcement of the permission-gated till actions (applied
-- 2026-09-20 as migration `server_enforcement`). Until now the discount /
-- void-after-submit / comp / cancel-booking gates lived only in the UI; a
-- tampered client with the anon key + a staff JWT could bypass them. These
-- triggers enforce the same rules in the database:
--
--   - managers/admins may perform gated actions directly (app_role())
--   - staff need a fresh manager-PIN approval: verify_manager_pin() logs an
--     approval row, and the guard consumes it (one approval = one action,
--     valid for 2 minutes, race-safe via FOR UPDATE SKIP LOCKED)
--   - ticket state may only move OPEN→SETTLED ungated; voids/reopens and all
--     off-path booking status changes are privileged
--   - payments and folio ledger lines are append-only for staff
--     (managers/admins may correct them — that also covers "Reset demo data",
--     which re-upserts seed rows with shifted dates)
--   - DELETE on app tables is manager/admin only (clients never delete)
--
-- Writes with auth.uid() IS NULL (service role, SQL editor, seed reloads)
-- bypass the guards — they are elevated by definition.
--
-- Known residuals (documented in README): totals and amounts are still
-- computed client-side, so a tampered client can record an understated CASH
-- payment or fabricate folio PAYMENT lines; folios columns other than
-- id/closed-status are unguarded; and a PIN approval authorizes an action
-- TYPE, not one specific ticket (the guards consume by action name). Closing
-- these requires server-priced settlement RPCs — the next hardening step.

-- ---------------------------------------------------------------------------
-- Value whitelists (block invented states like status='cancelled '/'GONE')
-- ---------------------------------------------------------------------------

alter table public.tickets drop constraint if exists tickets_state_check;
alter table public.tickets add constraint tickets_state_check
  check (state in ('OPEN','SETTLED','VOID'));
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('RESERVED','BOOKED','CHECKED_IN','CHECKED_OUT','CANCELLED','NO_SHOW'));
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check
  check (kind in ('CASH','CARD','ROOM_CHARGE','COMP'));
alter table public.folio_lines drop constraint if exists folio_lines_type_check;
alter table public.folio_lines add constraint folio_lines_type_check
  check (type in ('CHARGE','PAYMENT','ADJUSTMENT','CORRECTION'));
alter table public.folios drop constraint if exists folios_status_check;
alter table public.folios add constraint folios_status_check
  check (status in ('OPEN','SETTLED','CLOSED'));

-- ---------------------------------------------------------------------------
-- One-shot approval consumption
-- ---------------------------------------------------------------------------

alter table public.manager_approvals add column if not exists consumed_at timestamptz;

create index if not exists manager_approvals_consume_idx
  on public.manager_approvals (requested_by, action, created_at desc)
  where success and consumed_at is null;
create index if not exists manager_approvals_lockout_idx
  on public.manager_approvals (requested_by, created_at)
  where not success;
create index if not exists manager_approvals_global_lockout_idx
  on public.manager_approvals (created_at)
  where not success;

-- Consume the newest unconsumed approval for this user+action (2-minute
-- window). The consumption predicates are repeated in the outer WHERE and the
-- row is locked with SKIP LOCKED so two concurrent statements cannot
-- double-spend one approval (READ COMMITTED EvalPlanQual only rechecks the
-- outer qual). SECURITY DEFINER so guard triggers can mark rows despite
-- manager_approvals having no client write policies; not client-callable
-- (execute revoked below — guards run as the function owner).
create or replace function public.app_consume_approval(p_action text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare hit uuid;
begin
  update public.manager_approvals a set consumed_at = now()
  where a.id = (
    select m.id from public.manager_approvals m
    where m.requested_by = auth.uid()
      and m.action = p_action
      and m.success
      and m.consumed_at is null
      and m.created_at > now() - interval '2 minutes'
    order by m.created_at desc
    limit 1
    for update skip locked
  )
    and a.success
    and a.consumed_at is null
    and a.created_at > now() - interval '2 minutes'
  returning a.id into hit;
  return hit is not null;
end $$;

revoke all on function public.app_consume_approval(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Harden the PIN lockout: the 5-fails-per-5-minutes cap alone allows ~1,440
-- guesses/day against a 4-6 digit space. Add a per-user daily cap AND a
-- property-wide daily cap — per-user budgets alone are defeated by scripted
-- throwaway self-signup accounts, each arriving with a fresh budget.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Guard triggers
--
-- The sync engine upserts collections, so BEFORE INSERT fires even for rows
-- that will take the ON CONFLICT UPDATE path. Each INSERT branch first checks
-- whether the row already exists and defers to the UPDATE branch, which
-- judges the real OLD→NEW diff (unchanged re-upserts always pass).
-- ---------------------------------------------------------------------------

-- Ticket lines must be a JSON array with unique line ids: a non-array value
-- would make jsonb_array_elements raise on every future update of the row
-- (permanent row poisoning), and duplicate-id siblings would let a copy of a
-- SUBMITTED line satisfy the guard while a same-id twin carries tampered data.
create or replace function public.assert_ticket_lines(p_lines jsonb)
returns void
language plpgsql immutable as $$
begin
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Ticket lines must be a JSON array';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))) <>
     (select count(distinct value->>'id') from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))) then
    raise exception 'Ticket lines must have unique ids';
  end if;
end $$;

create or replace function public.guard_tickets()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ol jsonb;
  nl jsonb;
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.tickets t where t.id = new.id) then
      return new;
    end if;
    perform public.assert_ticket_lines(new.lines);
    if coalesce(new.discount_pct, 0) <> 0
       and not (public.app_role() in ('manager','admin') or public.app_consume_approval('discount')) then
      raise exception 'Applying a discount needs manager approval';
    end if;
    return new;
  end if;

  -- Renaming a row's id would let a fresh INSERT take over its identity,
  -- dodging every OLD→NEW check. No flow ever changes an id.
  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
  end if;
  perform public.assert_ticket_lines(new.lines);

  if new.discount_pct is distinct from old.discount_pct
     and not (public.app_role() in ('manager','admin') or public.app_consume_approval('discount')) then
    raise exception 'Changing a discount needs manager approval';
  end if;

  -- OPEN→SETTLED is the normal ungated settle; every other state change
  -- (void a ticket, reopen a settled/void one) is privileged.
  if new.state is distinct from old.state
     and not (old.state = 'OPEN' and new.state = 'SETTLED')
     and not (public.app_role() in ('manager','admin') or public.app_consume_approval('void_submitted')) then
    raise exception 'Voiding or reopening a ticket needs manager approval';
  end if;

  -- Every line that was already SUBMITTED must survive unchanged; voiding,
  -- editing or removing one is the gated void-after-submit action.
  if new.lines is distinct from old.lines then
    for ol in select value from jsonb_array_elements(coalesce(old.lines, '[]'::jsonb)) loop
      if ol->>'state' = 'SUBMITTED' then
        select value into nl
        from jsonb_array_elements(coalesce(new.lines, '[]'::jsonb))
        where value->>'id' = ol->>'id';
        if nl is null or nl is distinct from ol then
          if not (public.app_role() in ('manager','admin') or public.app_consume_approval('void_submitted')) then
            raise exception 'Voiding a submitted line needs manager approval';
          end if;
          exit; -- one approval covers this update
        end if;
      end if;
    end loop;
  end if;

  return new;
end $$;

create or replace function public.guard_payments()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.payments p where p.id = new.id) then
      return new;
    end if;
    if new.kind = 'COMP'
       and not (public.app_role() in ('manager','admin') or public.app_consume_approval('comp')) then
      raise exception 'Comping a ticket needs manager approval';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
  end if;
  -- Append-only for staff; managers/admins may correct (incl. demo reseed).
  if to_jsonb(new) is distinct from to_jsonb(old)
     and public.app_role() not in ('manager','admin') then
    raise exception 'Payments are immutable once recorded';
  end if;
  return new;
end $$;

create or replace function public.guard_bookings()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.bookings b where b.id = new.id) then
      return new;
    end if;
    if new.status in ('CANCELLED','NO_SHOW')
       and not (public.app_role() in ('manager','admin') or public.app_consume_approval('cancel_booking')) then
      raise exception 'Cancelling a booking needs manager approval';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
  end if;

  -- Ungated transitions are exactly the check-in/check-out flow; anything
  -- else that changes status (cancel, no-show, un-cancel, skip-to-checkout)
  -- is privileged — the check-value whitelist above blocks invented strings.
  if new.status is distinct from old.status
     and not ( (old.status in ('RESERVED','BOOKED') and new.status = 'CHECKED_IN')
            or (old.status = 'CHECKED_IN' and new.status = 'CHECKED_OUT') )
     and not (public.app_role() in ('manager','admin') or public.app_consume_approval('cancel_booking')) then
    raise exception 'Cancelling or overriding a booking status needs manager approval';
  end if;
  return new;
end $$;

create or replace function public.guard_folio_lines()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then return new; end if;
  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
  end if;

  -- Append-only ledger for staff; managers/admins may correct rows
  -- (reversals, demo reseed). Unchanged re-upserts always pass.
  if public.app_role() in ('manager','admin') then return new; end if;

  if (new.folio_id, new.type, new.description, new.amount, new.business_date,
      new.posted_at, new.source_ref, new.idempotency_key)
     is distinct from
     (old.folio_id, old.type, old.description, old.amount, old.business_date,
      old.posted_at, old.source_ref, old.idempotency_key) then
    raise exception 'Folio ledger lines are immutable — post a correction instead';
  end if;
  if new.is_reversed is distinct from old.is_reversed
     or new.reversal_of_id is distinct from old.reversal_of_id then
    raise exception 'Reversing a ledger line needs a manager';
  end if;
  return new;
end $$;

create or replace function public.guard_folios()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then return new; end if;
  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
  end if;
  -- Closing at checkout is the normal flow; reopening closed history is not.
  if old.status = 'CLOSED' and new.status is distinct from old.status
     and public.app_role() not in ('manager','admin') then
    raise exception 'Reopening a closed folio needs a manager';
  end if;
  return new;
end $$;

drop trigger if exists tickets_guard on public.tickets;
create trigger tickets_guard before insert or update on public.tickets
  for each row execute function public.guard_tickets();

drop trigger if exists payments_guard on public.payments;
create trigger payments_guard before insert or update on public.payments
  for each row execute function public.guard_payments();

drop trigger if exists bookings_guard on public.bookings;
create trigger bookings_guard before insert or update on public.bookings
  for each row execute function public.guard_bookings();

drop trigger if exists folio_lines_guard on public.folio_lines;
create trigger folio_lines_guard before insert or update on public.folio_lines
  for each row execute function public.guard_folio_lines();

drop trigger if exists folios_guard on public.folios;
create trigger folios_guard before insert or update on public.folios
  for each row execute function public.guard_folios();

-- ---------------------------------------------------------------------------
-- DELETE becomes manager/admin only. The app never deletes rows (the ledger
-- is append-only and the sync engine only upserts), so this is pure
-- tamper-hardening: split the old FOR ALL staff policy per command.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['config','rooms','categories','products','clients','bookings','folios','folio_lines','tickets','payments']
  loop
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('drop policy if exists staff_select on public.%I', t);
    execute format('create policy staff_select on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists staff_insert on public.%I', t);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check (true)', t);
    execute format('drop policy if exists staff_update on public.%I', t);
    execute format('create policy staff_update on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('drop policy if exists manager_delete on public.%I', t);
    execute format('create policy manager_delete on public.%I for delete to authenticated using (public.app_role() in (''manager'',''admin''))', t);
  end loop;
end $$;
