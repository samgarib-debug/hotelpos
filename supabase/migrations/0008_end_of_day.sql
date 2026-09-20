-- End of Day (applied 2026-09-20 as migration `end_of_day`).
-- A manager-only, server-side day close: refuses while open tickets carry
-- lines, snapshots the trading period's totals into an immutable
-- `day_closures` row (the Z-report), then rolls config.business_date to the
-- next day. Periods are boundary-based, not clock-date-based: each closure
-- covers everything since the previous closure's cutoff.
--
-- Period-boundary correctness (reviewed adversarially):
--   * every money-writing RPC takes a SHARE lock on the config row before
--     stamping timestamps, and stamps with clock_timestamp() (app_clock_iso)
--     rather than transaction-start now(). run_end_of_day takes the config
--     row FOR UPDATE and computes its cutoff AFTER holding that lock, so a
--     payment either committed before the snapshot with created_at <= cutoff
--     (this closure) or was stamped after the close began with created_at >
--     cutoff (next closure). No payment can fall between periods.
--   * run_end_of_day takes the business date it intends to close as a
--     parameter: a concurrent second close, or a retry after a lost
--     response, gets a clean "already closed" error instead of silently
--     closing the brand-new day and skipping a date.
--   * config.business_date and seq become SERVER-OWNED on client updates
--     (guard_config keeps the stored values, like the financial fields):
--     the date is the Z-report's primary key, so a stale till's whole-row
--     config push — or a tampered staff PATCH — can no longer rewind it.
--
-- day_closures is NOT part of the client sync engine: only run_end_of_day
-- writes it (no insert/update/delete policies for anyone) and Reports reads
-- it on demand (manager/admin only), like manager_approvals.
-- Acknowledged: staff can numerically reconstruct day totals from the
-- payments table they can already read — the closure row is a locked,
-- immutable snapshot, not a secret.

create table if not exists public.day_closures (
  business_date text primary key,
  period_start text not null,
  period_end text not null,
  cash_total numeric not null default 0,
  cash_count int not null default 0,
  card_total numeric not null default 0,
  card_count int not null default 0,
  room_charge_total numeric not null default 0,
  room_charge_count int not null default 0,
  comp_total numeric not null default 0,
  comp_count int not null default 0,
  tickets_settled int not null default 0,
  approvals_count int not null default 0,
  open_folio_total numeric not null default 0,
  open_folio_count int not null default 0,
  closed_by uuid,
  closed_at timestamptz not null default now()
);

alter table public.day_closures enable row level security;
drop policy if exists closures_read on public.day_closures;
create policy closures_read on public.day_closures
  for select to authenticated using (public.app_role() in ('manager','admin'));
-- no insert/update/delete policies: only run_end_of_day() writes, ever.
revoke all on table public.day_closures from anon;

-- Wall-clock "now" (statement time, not transaction start) — money RPCs
-- stamp with this while holding the config share lock so End of Day period
-- boundaries are race-free.
create or replace function public.app_clock_iso() returns text
language sql volatile set search_path = public as
$$ select to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

revoke all on function public.app_clock_iso() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Money RPCs re-created with the EOD locking protocol:
--   config FOR SHARE before stamping + clock-based timestamps.
-- (Bodies otherwise identical to 0007.)
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

  -- share-lock the config row: serializes this money write against a
  -- concurrent End of Day close (which takes it FOR UPDATE)
  select * into cfg from public.config where id = 'default' for share;
  if not found then raise exception 'Property config missing'; end if;

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

  if p_kind = 'CASH' and p_tendered is not null and p_tendered < v_grand - 0.005 then
    raise exception 'Cash tendered is less than the total (%)', v_grand;
  end if;
  v_change := case when p_kind = 'CASH' and p_tendered is not null
                   then greatest(0, round(p_tendered - v_grand, 2)) end;

  v_now := public.app_clock_iso();
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
  v_bd text;
begin
  if p_kind not in ('CASH','CARD') then
    raise exception 'Folio payments must be cash or card';
  end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Payment amount must be positive'; end if;

  -- share-lock config: serializes this money write against End of Day
  select business_date into v_bd from public.config where id = 'default' for share;
  if not found then raise exception 'Property config missing'; end if;

  select * into f from public.folios where id = p_folio_id for update;
  if not found then raise exception 'Folio not found'; end if;
  if f.status <> 'OPEN' then raise exception 'Folio is not open'; end if;

  select coalesce(sum(amount), 0) into v_bal
  from public.folio_lines where folio_id = f.id and not is_reversed;
  if v_amt > round(v_bal, 2) + 0.005 then
    raise exception 'Payment (%) exceeds the folio balance (%)', v_amt, round(v_bal, 2);
  end if;

  v_now := public.app_clock_iso();
  v_id := 'fp-' || replace(gen_random_uuid()::text, '-', '');
  perform set_config('hotelpos.rpc', 'post_folio_payment', true);

  insert into public.folio_lines
    (id, folio_id, type, description, amount, business_date, posted_at,
     idempotency_key, is_reversed, created_by)
  values
    ('fl-' || v_id, f.id, 'PAYMENT', 'Payment — ' || p_kind, -v_amt,
     coalesce(v_bd, substr(v_now, 1, 10)), v_now, v_id, false, auth.uid())
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
  v_bd text;
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

  -- share-lock config: serializes this money write against End of Day
  select business_date into v_bd from public.config where id = 'default' for share;
  if not found then raise exception 'Property config missing'; end if;

  select * into f from public.folios where id = p_folio_id for update;
  if not found then raise exception 'Folio not found'; end if;
  if f.status <> 'OPEN' then raise exception 'Folio is not open'; end if;
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

  v_now := public.app_clock_iso();
  perform set_config('hotelpos.rpc', 'post_prepaid_credit', true);

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
     coalesce(v_bd, substr(v_now, 1, 10)), v_now,
     b.ref, 'prepaid-' || b.id, false, auth.uid())
  returning * into fl;

  return jsonb_build_object(
    'folio_lines', jsonb_build_array(to_jsonb(fl)),
    'payments', jsonb_build_array(to_jsonb(pay))
  );
end $$;

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

  select * into pay from public.payments
  where idempotency_key = 'booking-deposit-' || b.id;
  if found then
    return jsonb_build_object('payments', jsonb_build_array(to_jsonb(pay)));
  end if;

  -- share-lock config: serializes this money write against End of Day
  perform 1 from public.config where id = 'default' for share;
  if not found then raise exception 'Property config missing'; end if;

  v_now := public.app_clock_iso();
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
-- business_date and seq become server-owned on client config updates:
-- business_date is the Z-report primary key (only run_end_of_day moves it),
-- and seq must never regress from a stale till's whole-row push.
-- ---------------------------------------------------------------------------

create or replace function public.guard_config()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.app_from_rpc() then return new; end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.config c where c.id = new.id) then
      return new; -- upsert conflict path: the UPDATE branch judges the diff
    end if;
    if new.id <> 'default' and public.app_role() not in ('manager','admin') then
      raise exception 'Only the default property config exists';
    end if;
    return new;
  end if;
  -- Server-owned for every client (stale tills push whole rows):
  new.business_date := old.business_date;
  new.seq := greatest(coalesce(new.seq, old.seq), old.seq);
  -- Financial fields stay manager-only:
  if public.app_role() not in ('manager','admin') then
    new.tax_rate := old.tax_rate;
    new.tax_inclusive := old.tax_inclusive;
    new.service_rate := old.service_rate;
    new.currency := old.currency;
    new.currency_symbol := old.currency_symbol;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- The close itself
-- ---------------------------------------------------------------------------

create or replace function public.run_end_of_day(p_business_date text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg public.config;
  dc public.day_closures;
  v_open int;
  v_start text;
  v_end text;
  v_next_date text;
begin
  if public.app_role() not in ('manager','admin') then
    raise exception 'Closing the day needs a manager';
  end if;

  -- serialize concurrent closes AND in-flight money RPCs (they hold FOR SHARE)
  select * into cfg from public.config where id = 'default' for update;
  if not found then raise exception 'Property config missing'; end if;

  -- the caller names the date it is closing: a concurrent double-close or a
  -- retry after a lost response errors instead of closing the next day
  if cfg.business_date is distinct from p_business_date then
    if exists (select 1 from public.day_closures where business_date = p_business_date) then
      raise exception 'Business date % is already closed', p_business_date;
    end if;
    raise exception 'The till''s business date (%) is out of date — the property is now on %. Refresh and try again.',
      p_business_date, cfg.business_date;
  end if;
  if exists (select 1 from public.day_closures where business_date = cfg.business_date) then
    raise exception 'Business date % is already closed', cfg.business_date;
  end if;

  -- every open ticket that carries live lines must be settled first
  -- (empty placeholder tickets from tapping a room are ignored)
  select count(*) into v_open
  from public.tickets t
  where t.state = 'OPEN'
    and exists (select 1 from jsonb_array_elements(coalesce(t.lines, '[]'::jsonb)) l
                where coalesce(l->>'state','') <> 'VOID');
  if v_open > 0 then
    raise exception '% open ticket(s) must be settled or cleared before closing the day', v_open;
  end if;

  v_start := coalesce((select max(period_end) from public.day_closures), '');
  -- cutoff is taken AFTER the exclusive config lock is held: every committed
  -- money write is stamped <= this, every waiting one will stamp > this
  v_end := public.app_clock_iso();
  v_next_date := to_char(cfg.business_date::date + 1, 'YYYY-MM-DD');

  perform set_config('hotelpos.rpc', 'run_end_of_day', true);

  insert into public.day_closures
    (business_date, period_start, period_end,
     cash_total, cash_count, card_total, card_count,
     room_charge_total, room_charge_count, comp_total, comp_count,
     tickets_settled, approvals_count,
     open_folio_total, open_folio_count, closed_by)
  select
    cfg.business_date, v_start, v_end,
    coalesce(sum(amount) filter (where kind = 'CASH'), 0),
    count(*) filter (where kind = 'CASH'),
    coalesce(sum(amount) filter (where kind = 'CARD'), 0),
    count(*) filter (where kind = 'CARD'),
    coalesce(sum(amount) filter (where kind = 'ROOM_CHARGE'), 0),
    count(*) filter (where kind = 'ROOM_CHARGE'),
    coalesce(sum(amount) filter (where kind = 'COMP'), 0),
    count(*) filter (where kind = 'COMP'),
    (select count(*) from public.tickets t
      where t.state = 'SETTLED'
        and coalesce(t.closed_at, '') > v_start and coalesce(t.closed_at, '') <= v_end),
    (select count(*) from public.manager_approvals a
      where a.success
        and a.created_at > (case when v_start = '' then '-infinity'::timestamptz
                                 else v_start::timestamptz end)
        and a.created_at <= v_end::timestamptz),
    (select coalesce(sum(bal), 0) from (
       select sum(l.amount) as bal
       from public.folios f
       join public.folio_lines l on l.folio_id = f.id and not l.is_reversed
       where f.status = 'OPEN'
       group by f.id) b),
    (select count(*) from public.folios f where f.status = 'OPEN'),
    auth.uid()
  from public.payments p
  where p.created_at > v_start and p.created_at <= v_end
  returning * into dc;

  update public.config
  set business_date = v_next_date, work_period_open = true
  where id = 'default'
  returning * into cfg;

  return jsonb_build_object(
    'day_closure', to_jsonb(dc),
    'config', to_jsonb(cfg)
  );
end $$;

drop function if exists public.run_end_of_day();
revoke all on function public.run_end_of_day(text) from public, anon;
grant execute on function public.run_end_of_day(text) to authenticated;
