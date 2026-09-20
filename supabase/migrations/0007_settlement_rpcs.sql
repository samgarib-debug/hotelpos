-- Server-priced settlement RPCs (applied 2026-09-20 as migration
-- `settlement_rpcs`). Closes the "amounts are client-computed" residual from
-- 0005: money is now written only by SECURITY DEFINER RPCs that price from
-- server state, and the guard triggers block the direct staff write paths.
--
--   settle_ticket(ticket_id, kind, tendered)  — prices the ticket from the
--     PRODUCTS CATALOG (qty × products.price, client line prices ignored),
--     applies the (guard-gated) discount and config service/tax rules,
--     posts the folio CHARGE for room-charges, records the payment, settles
--     the ticket, clears the room's open ticket. COMP consumes the 'comp'
--     manager-PIN approval here.
--   post_folio_payment(folio_id, kind, amount) — interim folio payment,
--     validated: positive, folio OPEN, amount ≤ ledger balance.
--   post_prepaid_credit(booking_id, folio_id)  — posts the booking's prepaid
--     credit at check-in; amount comes from bookings.amount_paid (whose
--     changes are now guard-gated), idempotent per booking.
--   record_booking_deposit(booking_id)         — records the deposit payment
--     for a prepaid BOOKING; amount comes from bookings.amount_paid, idempotent.
--   close_folio(folio_id)                      — check-out: verifies the
--     ledger balance is zero server-side, closes the folio.
--
-- The RPCs mark their transaction with set_config('hotelpos.rpc', ...) —
-- clients cannot set GUCs through PostgREST, so the guards can trust it.
-- Direct writes are then limited to: staff folio_lines INSERT = positive
-- CHARGE only (check-in room/stay charges), payments INSERT = managers only
-- (reseed/bootstrap), ticket settle transition = RPC or manager, folio close
-- = RPC or manager, product/price + financial-config edits = managers only.
--
-- Remaining attestations (not solvable by pricing): check-in rate and a
-- booking's total/amount_paid are front-desk-entered; the DB now guarantees
-- they can't be silently altered after creation and that every payment and
-- ledger line records WHO wrote it (created_by).

-- ---------------------------------------------------------------------------
-- Audit + integrity columns/constraints
-- ---------------------------------------------------------------------------

alter table public.payments add column if not exists created_by uuid;
alter table public.folio_lines add column if not exists created_by uuid;

-- Pre-0007 the server never enforced key uniqueness (idempotency was a
-- client-side check), so a live DB can hold duplicates. Suffix any before
-- the unique indexes so the migration cannot abort half-way.
with d as (
  select id, row_number() over (partition by idempotency_key order by id) rn
  from public.payments
)
update public.payments p set idempotency_key = p.idempotency_key || '-dup' || d.rn
from d where d.id = p.id and d.rn > 1;
with d as (
  select id, row_number() over (partition by idempotency_key order by id) rn
  from public.folio_lines
)
update public.folio_lines f set idempotency_key = f.idempotency_key || '-dup' || d.rn
from d where d.id = f.id and d.rn > 1;

create unique index if not exists payments_idempotency_key_uidx
  on public.payments (idempotency_key);
create unique index if not exists folio_lines_idempotency_key_uidx
  on public.folio_lines (idempotency_key);

alter table public.bookings drop constraint if exists bookings_amount_paid_check;
alter table public.bookings add constraint bookings_amount_paid_check
  check (amount_paid >= 0 and amount_paid <= total);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True inside our settlement RPCs (transaction-local GUC set by them).
create or replace function public.app_from_rpc() returns boolean
language sql stable set search_path = public as
$$ select coalesce(current_setting('hotelpos.rpc', true), '') <> '' $$;

-- ISO-8601 UTC "now" in the exact shape the client writes (TEXT columns).
create or replace function public.app_now_iso() returns text
language sql stable set search_path = public as
$$ select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

revoke all on function public.app_from_rpc() from public, anon, authenticated;
revoke all on function public.app_now_iso() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: settle_ticket
-- ---------------------------------------------------------------------------

create or replace function public.settle_ticket(p_ticket_id text, p_kind text, p_tendered numeric default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tickets;
  cfg public.config;
  r public.rooms;
  f public.folios;
  pay public.payments;
  fl public.folio_lines;
  v_bad int;
  v_subtotal numeric;
  v_discount numeric;
  v_net numeric;
  v_service numeric;
  v_taxable numeric;
  v_tax numeric;
  v_grand numeric;
  v_change numeric;
  v_now text;
  v_n int;
  v_pay_key text;
  v_pay_id text;
  v_fl_key text;
  v_fl_id text;
begin
  if p_kind not in ('CASH','CARD','ROOM_CHARGE','COMP') then
    raise exception 'Unknown payment kind';
  end if;

  select * into t from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if t.state <> 'OPEN' then raise exception 'Ticket is not open'; end if;

  if p_kind = 'COMP'
     and public.app_role() not in ('manager','admin')
     and not public.app_consume_approval('comp') then
    raise exception 'Comping a ticket needs manager approval';
  end if;

  select * into cfg from public.config where id = 'default';
  if not found then raise exception 'Property config missing'; end if;

  -- Price from the products catalog; client line prices are never trusted.
  select count(*) into v_bad
  from jsonb_array_elements(coalesce(t.lines, '[]'::jsonb)) l
  where coalesce(l->>'state','') <> 'VOID'
    and (not exists (select 1 from public.products p where p.id = l->>'productId')
         or coalesce((l->>'qty')::numeric, 0) <= 0);
  if v_bad > 0 then raise exception 'Ticket has lines that cannot be priced'; end if;

  select coalesce(round(sum(round((l->>'qty')::numeric * p.price, 2)), 2), 0) into v_subtotal
  from jsonb_array_elements(coalesce(t.lines, '[]'::jsonb)) l
  join public.products p on p.id = l->>'productId'
  where coalesce(l->>'state','') <> 'VOID';

  v_discount := round(v_subtotal * coalesce(t.discount_pct, 0), 2);
  v_net := round(v_subtotal - v_discount, 2);
  v_service := round(v_net * coalesce(cfg.service_rate, 0), 2);
  if cfg.tax_inclusive then
    v_taxable := round(v_net + v_service, 2);
    v_tax := round(v_taxable - v_taxable / (1 + cfg.tax_rate), 2);
    v_grand := v_taxable;
  else
    v_tax := round((v_net + v_service) * cfg.tax_rate, 2);
    v_grand := round(v_net + v_service + v_tax, 2);
  end if;

  if v_grand <= 0 then raise exception 'Nothing to settle'; end if;

  -- half-cent tolerance: JS float rounding and numeric rounding can disagree
  -- by one cent at .xx5 boundaries; name the server total in the error so the
  -- till can recover when its display diverged from the catalog price.
  if p_kind = 'CASH' and p_tendered is not null and p_tendered < v_grand - 0.005 then
    raise exception 'Cash tendered is less than the total (%)', v_grand;
  end if;
  v_change := case when p_kind = 'CASH' and p_tendered is not null
                   then greatest(0, round(p_tendered - v_grand, 2)) end;

  v_now := public.app_now_iso();
  perform set_config('hotelpos.rpc', 'settle_ticket', true);

  if p_kind = 'ROOM_CHARGE' then
    if t.room_id is null then
      raise exception 'Walk-in tickets cannot be charged to a room';
    end if;
    select * into r from public.rooms where id = t.room_id for update;
    if not found or r.folio_id is null then
      raise exception 'Room has no open folio. Check the guest in first, or settle by cash/card.';
    end if;
    select * into f from public.folios where id = r.folio_id for update;
    if not found or f.status <> 'OPEN' then raise exception 'Folio is not open'; end if;

    -- The 'ticket-<id>*' key and 'fl-t-<id>*' id namespaces are reserved for
    -- this RPC (guard_folio_lines refuses them on staff inserts). Find the
    -- live outlet charge for this ticket, if any (reopen → re-settle):
    --   identical → reuse; reversed-only → post a fresh suffixed charge;
    --   amount changed → managers auto-correct (reverse + repost), staff get
    --   an error naming both amounts; different folio → always refuse (the
    --   old charge belongs to a reconciled stay).
    -- exact match on the ticket reference (a LIKE on the key would also
    -- match sibling tickets whose id is a string prefix of another); the
    -- key-namespace conjunct keeps staff-inserted rows out (reserved keys
    -- are refused on staff inserts, so any match is RPC/legacy/manager-made)
    select * into fl from public.folio_lines
    where source_ref = t.id
      and type = 'CHARGE'
      and not is_reversed
      and idempotency_key like 'ticket-%'
    order by posted_at desc
    limit 1;
    if found then
      if fl.folio_id is distinct from r.folio_id then
        raise exception 'This ticket was already charged to a different folio — ask a manager';
      end if;
      if round(fl.amount, 2) is distinct from v_grand then
        if public.app_role() in ('manager','admin') then
          update public.folio_lines set is_reversed = true where id = fl.id;
          fl := null; -- fall through: post the corrected charge
        else
          raise exception 'This ticket already posted a room charge of % (new total %) — a manager must re-settle it',
            round(fl.amount, 2), v_grand;
        end if;
      end if;
      -- identical live charge: reuse it (fl stays set, no insert)
    end if;

    if fl.id is null then
      v_n := 0;
      loop
        v_fl_key := 'ticket-' || t.id || case when v_n = 0 then '' else '-' || v_n::text end;
        exit when not exists (select 1 from public.folio_lines where idempotency_key = v_fl_key);
        v_n := v_n + 1;
      end loop;
      v_fl_id := 'fl-t-' || t.id || case when v_n = 0 then '' else '-' || v_n::text end;
      insert into public.folio_lines
        (id, folio_id, type, description, amount, business_date, posted_at,
         source_ref, idempotency_key, is_reversed, created_by)
      values
        (v_fl_id, r.folio_id, 'CHARGE',
         t.number || ' — ' || r.number || ' outlet charge', v_grand,
         coalesce(cfg.business_date, substr(v_now, 1, 10)), v_now,
         t.id, v_fl_key, false, auth.uid())
      returning * into fl;
    end if;
  end if;

  -- Attempt-suffixed keys: a reopened ticket (manager action) can be settled
  -- again without colliding with the payment row of the first settle.
  v_n := 0;
  loop
    v_pay_key := 'settle-' || t.id || case when v_n = 0 then '' else '-' || v_n::text end;
    exit when not exists (select 1 from public.payments where idempotency_key = v_pay_key);
    v_n := v_n + 1;
  end loop;
  v_pay_id := 'pay-t-' || t.id || case when v_n = 0 then '' else '-' || v_n::text end;

  insert into public.payments
    (id, kind, amount, tendered, change, ticket_id, folio_id, created_at,
     idempotency_key, created_by)
  values
    (v_pay_id, p_kind, v_grand,
     case when p_kind = 'CASH' then p_tendered end, v_change, t.id,
     case when p_kind = 'ROOM_CHARGE' then r.folio_id end, v_now,
     v_pay_key, auth.uid())
  returning * into pay;

  update public.tickets set state = 'SETTLED', closed_at = v_now
  where id = t.id
  returning * into t;

  if t.room_id is not null then
    update public.rooms set open_ticket_id = null
    where id = t.room_id and open_ticket_id = t.id;
  end if;

  return jsonb_build_object(
    'tickets', jsonb_build_array(to_jsonb(t)),
    'payments', jsonb_build_array(to_jsonb(pay)),
    'folio_lines', case when fl.id is not null
                        then jsonb_build_array(to_jsonb(fl)) else '[]'::jsonb end,
    'rooms', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
              from public.rooms x where x.id = t.room_id),
    'totals', jsonb_build_object(
      'subtotal', v_subtotal, 'discount', v_discount, 'service', v_service,
      'tax', v_tax, 'grandTotal', v_grand,
      'tendered', pay.tendered, 'change', pay.change)
  );
end $$;

-- ---------------------------------------------------------------------------
-- RPC: post_folio_payment
-- ---------------------------------------------------------------------------

create or replace function public.post_folio_payment(p_folio_id text, p_kind text, p_amount numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f public.folios;
  fl public.folio_lines;
  pay public.payments;
  v_bal numeric;
  v_amt numeric;
  v_now text;
  v_id text;
begin
  if p_kind not in ('CASH','CARD') then
    raise exception 'Folio payments must be cash or card';
  end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Payment amount must be positive'; end if;

  select * into f from public.folios where id = p_folio_id for update;
  if not found then raise exception 'Folio not found'; end if;
  if f.status <> 'OPEN' then raise exception 'Folio is not open'; end if;

  select coalesce(sum(amount), 0) into v_bal
  from public.folio_lines where folio_id = f.id and not is_reversed;
  if v_amt > round(v_bal, 2) + 0.005 then
    raise exception 'Payment (%) exceeds the folio balance (%)', v_amt, round(v_bal, 2);
  end if;

  v_now := public.app_now_iso();
  v_id := 'fp-' || replace(gen_random_uuid()::text, '-', '');
  perform set_config('hotelpos.rpc', 'post_folio_payment', true);

  insert into public.folio_lines
    (id, folio_id, type, description, amount, business_date, posted_at,
     idempotency_key, is_reversed, created_by)
  values
    ('fl-' || v_id, f.id, 'PAYMENT', 'Payment — ' || p_kind, -v_amt,
     coalesce((select business_date from public.config where id = 'default'),
              substr(v_now, 1, 10)),
     v_now, v_id, false, auth.uid())
  returning * into fl;

  insert into public.payments
    (id, kind, amount, folio_id, created_at, idempotency_key, created_by)
  values
    ('pay-' || v_id, p_kind, v_amt, f.id, v_now, 'pay-' || v_id, auth.uid())
  returning * into pay;

  return jsonb_build_object(
    'folio_lines', jsonb_build_array(to_jsonb(fl)),
    'payments', jsonb_build_array(to_jsonb(pay))
  );
end $$;

-- ---------------------------------------------------------------------------
-- RPC: post_prepaid_credit (booking prepayment onto the check-in folio)
-- ---------------------------------------------------------------------------

create or replace function public.post_prepaid_credit(p_booking_id text, p_folio_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  f public.folios;
  fl public.folio_lines;
  pay public.payments;
  v_bal numeric;
  v_amt numeric;
  v_now text;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('RESERVED','BOOKED','CHECKED_IN') then
    raise exception 'Booking is not active';
  end if;
  v_amt := round(coalesce(b.amount_paid, 0), 2);
  if v_amt <= 0 then raise exception 'Booking has no prepayment'; end if;
  if b.payment_kind is null then raise exception 'Booking has no payment method'; end if;

  -- idempotent: one prepaid credit per booking
  select * into fl from public.folio_lines
  where idempotency_key = 'prepaid-' || b.id;
  if found then
    return jsonb_build_object('folio_lines', jsonb_build_array(to_jsonb(fl)));
  end if;

  select * into f from public.folios where id = p_folio_id for update;
  if not found then raise exception 'Folio not found'; end if;
  if f.status <> 'OPEN' then raise exception 'Folio is not open'; end if;
  -- the credit is bound to the booking's own stay
  if b.folio_id is not null and b.folio_id <> f.id then
    raise exception 'Booking is tied to a different folio';
  end if;
  if f.room_id <> b.room_id then
    raise exception 'Folio belongs to a different room';
  end if;

  select coalesce(sum(amount), 0) into v_bal
  from public.folio_lines where folio_id = f.id and not is_reversed;
  if v_amt > round(v_bal, 2) + 0.005 then
    raise exception 'Prepaid credit exceeds the folio balance — post the stay charge first';
  end if;

  v_now := public.app_now_iso();
  perform set_config('hotelpos.rpc', 'post_prepaid_credit', true);

  -- A ledger credit must never exist without its recorded payment: ensure the
  -- booking's deposit payment row exists (self-heals a missed/failed
  -- record_booking_deposit; also stops a fabricated booking from crediting a
  -- folio while leaving the payments record empty).
  select * into pay from public.payments
  where idempotency_key = 'booking-deposit-' || b.id;
  if not found then
    insert into public.payments
      (id, kind, amount, created_at, idempotency_key, created_by)
    values
      ('pay-bk-' || b.id, b.payment_kind, v_amt, v_now,
       'booking-deposit-' || b.id, auth.uid())
    returning * into pay;
  end if;

  insert into public.folio_lines
    (id, folio_id, type, description, amount, business_date, posted_at,
     source_ref, idempotency_key, is_reversed, created_by)
  values
    ('fl-pre-' || b.id, f.id, 'PAYMENT',
     'Prepaid (' || coalesce(b.payment_kind, 'BOOKING') || ')', -v_amt,
     coalesce((select business_date from public.config where id = 'default'),
              substr(v_now, 1, 10)),
     v_now, b.ref, 'prepaid-' || b.id, false, auth.uid())
  returning * into fl;

  return jsonb_build_object(
    'folio_lines', jsonb_build_array(to_jsonb(fl)),
    'payments', jsonb_build_array(to_jsonb(pay))
  );
end $$;

-- ---------------------------------------------------------------------------
-- RPC: record_booking_deposit (prepaid BOOKING creation)
-- ---------------------------------------------------------------------------

create or replace function public.record_booking_deposit(p_booking_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  pay public.payments;
  v_now text;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.kind <> 'BOOKING' then raise exception 'Only prepaid bookings carry a deposit'; end if;
  if coalesce(b.amount_paid, 0) <= 0 then raise exception 'Booking has no amount to record'; end if;
  if b.payment_kind is null then raise exception 'Booking has no payment method'; end if;

  -- idempotent: one deposit per booking
  select * into pay from public.payments
  where idempotency_key = 'booking-deposit-' || b.id;
  if found then
    return jsonb_build_object('payments', jsonb_build_array(to_jsonb(pay)));
  end if;

  v_now := public.app_now_iso();
  perform set_config('hotelpos.rpc', 'record_booking_deposit', true);

  insert into public.payments
    (id, kind, amount, created_at, idempotency_key, created_by)
  values
    ('pay-bk-' || b.id, b.payment_kind, round(b.amount_paid, 2), v_now,
     'booking-deposit-' || b.id, auth.uid())
  returning * into pay;

  return jsonb_build_object('payments', jsonb_build_array(to_jsonb(pay)));
end $$;

-- ---------------------------------------------------------------------------
-- RPC: close_folio (check-out; balance must be zero)
-- ---------------------------------------------------------------------------

create or replace function public.close_folio(p_folio_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f public.folios;
  v_bal numeric;
begin
  select * into f from public.folios where id = p_folio_id for update;
  if not found then raise exception 'Folio not found'; end if;
  if f.status = 'CLOSED' then
    return jsonb_build_object('folios', jsonb_build_array(to_jsonb(f)));
  end if;

  select coalesce(sum(amount), 0) into v_bal
  from public.folio_lines where folio_id = f.id and not is_reversed;
  if v_bal > 0.001 then
    raise exception 'Folio balance is %. Settle to zero before check-out.', round(v_bal, 2);
  end if;

  perform set_config('hotelpos.rpc', 'close_folio', true);
  update public.folios
  set status = 'CLOSED', closed_at = public.app_now_iso()
  where id = f.id
  returning * into f;

  return jsonb_build_object('folios', jsonb_build_array(to_jsonb(f)));
end $$;

revoke all on function public.settle_ticket(text, text, numeric) from public, anon;
revoke all on function public.post_folio_payment(text, text, numeric) from public, anon;
revoke all on function public.post_prepaid_credit(text, text) from public, anon;
revoke all on function public.record_booking_deposit(text) from public, anon;
revoke all on function public.close_folio(text) from public, anon;
grant execute on function public.settle_ticket(text, text, numeric) to authenticated;
grant execute on function public.post_folio_payment(text, text, numeric) to authenticated;
grant execute on function public.post_prepaid_credit(text, text) to authenticated;
grant execute on function public.record_booking_deposit(text) to authenticated;
grant execute on function public.close_folio(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Guard updates: the RPCs become the only staff path for money writes.
-- Every guard gains the RPC bypass; the rules below are what changed.
-- ---------------------------------------------------------------------------

create or replace function public.guard_tickets()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ol jsonb;
  nl jsonb;
begin
  if auth.uid() is null or public.app_from_rpc() then return new; end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.tickets t where t.id = new.id) then
      return new;
    end if;
    perform public.assert_ticket_lines(new.lines);
    if new.state <> 'OPEN' and public.app_role() not in ('manager','admin') then
      raise exception 'New tickets must be open — settlement goes through the till';
    end if;
    if coalesce(new.discount_pct, 0) <> 0
       and not (public.app_role() in ('manager','admin') or public.app_consume_approval('discount')) then
      raise exception 'Applying a discount needs manager approval';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
  end if;
  perform public.assert_ticket_lines(new.lines);

  if new.discount_pct is distinct from old.discount_pct
     and not (public.app_role() in ('manager','admin') or public.app_consume_approval('discount')) then
    raise exception 'Changing a discount needs manager approval';
  end if;

  if new.state is distinct from old.state then
    if old.state = 'OPEN' and new.state = 'SETTLED' then
      -- settlement is priced server-side: RPC (bypasses above) or manager
      if public.app_role() not in ('manager','admin') then
        raise exception 'Tickets are settled by the till — use Settle';
      end if;
    elsif not (public.app_role() in ('manager','admin') or public.app_consume_approval('void_submitted')) then
      raise exception 'Voiding or reopening a ticket needs manager approval';
    end if;
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
  if auth.uid() is null or public.app_from_rpc() then return new; end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.payments p where p.id = new.id) then
      return new;
    end if;
    -- All till payments are recorded by the settlement RPCs; direct inserts
    -- are for managers/admins (demo reseed, bootstrap, corrections).
    if public.app_role() not in ('manager','admin') then
      raise exception 'Payments are recorded by the till — use the settle functions';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
  end if;
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
  if auth.uid() is null or public.app_from_rpc() then return new; end if;

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

  -- Money fields are fixed at creation (they back the deposit / prepaid
  -- credit RPCs); no app flow ever changes them.
  if (new.rate is distinct from old.rate
      or new.total is distinct from old.total
      or new.amount_paid is distinct from old.amount_paid
      or new.payment_kind is distinct from old.payment_kind)
     and public.app_role() not in ('manager','admin') then
    raise exception 'Booking amounts are fixed once created — ask a manager';
  end if;

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
  if auth.uid() is null or public.app_from_rpc() then return new; end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.folio_lines x where x.id = new.id) then
      return new; -- upsert conflict path: the UPDATE branch judges the diff
    end if;
    if public.app_role() in ('manager','admin') then return new; end if;
    -- Staff may post positive CHARGEs directly (check-in room/stay charges);
    -- payments, adjustments and corrections go through the RPCs or a manager.
    if not (new.type = 'CHARGE' and new.amount > 0) then
      raise exception 'Folio payments and adjustments are recorded by the till';
    end if;
    -- the settlement RPCs' idempotency keys AND their deterministic row ids
    -- cannot be squatted (a pre-claimed id would abort the RPC's insert)
    if new.idempotency_key like 'ticket-%' or new.idempotency_key like 'prepaid-%'
       or new.id like 'fl-t-%' or new.id like 'fl-pre-%' then
      raise exception 'Reserved ledger key';
    end if;
    new.created_by := auth.uid(); -- attribution is not client-chosen
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
  end if;

  if public.app_role() in ('manager','admin') then return new; end if;

  if (new.folio_id, new.type, new.description, new.amount, new.business_date,
      new.posted_at, new.source_ref, new.idempotency_key, new.created_by)
     is distinct from
     (old.folio_id, old.type, old.description, old.amount, old.business_date,
      old.posted_at, old.source_ref, old.idempotency_key, old.created_by) then
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
  if auth.uid() is null or public.app_from_rpc() then return new; end if;
  if tg_op = 'INSERT' then return new; end if;
  if new.id is distinct from old.id then
    raise exception 'Row ids are immutable';
  end if;
  -- Folio status changes (close at checkout, reopen) go through close_folio
  -- or a manager — closing verifies the balance server-side.
  if new.status is distinct from old.status
     and public.app_role() not in ('manager','admin') then
    raise exception 'Folios are closed at check-out by the till';
  end if;
  return new;
end $$;

-- Products & categories are the pricing basis: staff cannot edit them.
create or replace function public.guard_catalog()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.app_from_rpc() then return new; end if;
  if tg_op = 'INSERT' then
    if (tg_table_name = 'products'
        and exists (select 1 from public.products p where p.id = new.id))
       or (tg_table_name = 'categories'
        and exists (select 1 from public.categories c where c.id = new.id)) then
      return new; -- upsert conflict path: UPDATE branch judges the diff
    end if;
  end if;
  if tg_op = 'UPDATE' and to_jsonb(new) is not distinct from to_jsonb(old) then
    return new; -- unchanged re-upsert
  end if;
  if public.app_role() not in ('manager','admin') then
    raise exception 'The product catalog is managed by managers';
  end if;
  return new;
end $$;

-- Financial config (rates/currency) is manager-only; the operational fields
-- (business date, work period, sequence) stay staff-writable.
create or replace function public.guard_config()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.app_from_rpc() then return new; end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.config c where c.id = new.id) then
      return new; -- upsert conflict path: the UPDATE branch judges the diff
    end if;
    -- One property config: staff cannot create rogue rows (every till's
    -- realtime handler follows the 'default' row only, but keep the table
    -- clean at the source too).
    if new.id <> 'default' and public.app_role() not in ('manager','admin') then
      raise exception 'Only the default property config exists';
    end if;
    return new;
  end if;
  -- Staff tills upsert the whole config row for operational changes (seq,
  -- work period, business date) and may briefly hold stale financial fields
  -- after a manager edit. Keep the server's financial values instead of
  -- rejecting the operational write (which would silently drop it).
  if public.app_role() not in ('manager','admin') then
    new.tax_rate := old.tax_rate;
    new.tax_inclusive := old.tax_inclusive;
    new.service_rate := old.service_rate;
    new.currency := old.currency;
    new.currency_symbol := old.currency_symbol;
  end if;
  return new;
end $$;

drop trigger if exists products_guard on public.products;
create trigger products_guard before insert or update on public.products
  for each row execute function public.guard_catalog();

drop trigger if exists categories_guard on public.categories;
create trigger categories_guard before insert or update on public.categories
  for each row execute function public.guard_catalog();

drop trigger if exists config_guard on public.config;
create trigger config_guard before insert or update on public.config
  for each row execute function public.guard_config();
