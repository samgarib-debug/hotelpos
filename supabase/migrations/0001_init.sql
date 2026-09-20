-- HotelPOS backend schema (demo-grade).
-- Tables mirror the app's domain model (string ids = app-generated nanoid/seed ids).
-- IDs are text so the client and server share the same identifiers.
-- Timestamp-like fields are stored as TEXT to round-trip the app's exact
-- ISO strings without timezone drift (booking start/end are wall-clock times).

create table if not exists config (
  id text primary key default 'default',
  property_name text not null default 'Grand Harbour Hotel',
  currency text not null default 'ZAR',
  currency_symbol text not null default 'R',
  tax_rate numeric not null default 0.15,
  tax_inclusive boolean not null default true,
  service_rate numeric not null default 0,
  business_date text,
  work_period_open boolean not null default true,
  seq int not null default 1000,
  updated_at timestamptz not null default now()
);

create table if not exists rooms (
  id text primary key,
  number text not null,
  floor int not null default 1,
  wing text,
  room_type text not null,
  fo text not null,
  hk text not null,
  avail text not null,
  guest_name text,
  checkout_date text,
  folio_id text,
  open_ticket_id text
);

create table if not exists categories (
  id text primary key,
  name text not null,
  color text not null default '#2f6fed',
  sort_order int not null default 0
);

create table if not exists products (
  id text primary key,
  category_id text not null,
  name text not null,
  price numeric not null default 0,
  color text,
  tax_rate numeric
);

create table if not exists clients (
  id text primary key,
  name text not null,
  phone text,
  email text,
  id_number text,
  notes text,
  created_at text
);

create table if not exists bookings (
  id text primary key,
  ref text not null,
  kind text not null,
  status text not null,
  client_id text not null,
  room_id text not null,
  mode text not null,
  start_at text not null,
  end_at text not null,
  nights int,
  rate numeric not null default 0,
  total numeric not null default 0,
  amount_paid numeric not null default 0,
  payment_kind text,
  folio_id text,
  notes text,
  created_at text
);

create table if not exists folios (
  id text primary key,
  folio_number text not null,
  room_id text not null,
  guest_name text not null,
  status text not null,
  opened_at text,
  closed_at text
);

create table if not exists folio_lines (
  id text primary key,
  folio_id text not null,
  type text not null,
  description text not null,
  amount numeric not null,
  business_date text not null,
  posted_at text,
  source_ref text,
  idempotency_key text not null,
  is_reversed boolean not null default false,
  reversal_of_id text
);

create table if not exists tickets (
  id text primary key,
  number text not null,
  room_id text,
  type text not null,
  state text not null,
  lines jsonb not null default '[]'::jsonb,
  discount_pct numeric not null default 0,
  opened_at text,
  closed_at text
);

create table if not exists payments (
  id text primary key,
  kind text not null,
  amount numeric not null,
  tendered numeric,
  change numeric,
  ticket_id text,
  folio_id text,
  created_at text,
  idempotency_key text not null
);

-- Row Level Security. NOTE: demo-grade — the public anon key is allowed full
-- access so the shared demo works without per-user auth. Lock these down
-- (per-tenant, JWT-driven) before any production/multi-property use.
do $$
declare t text;
begin
  foreach t in array array['config','rooms','categories','products','clients','bookings','folios','folio_lines','tickets','payments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists demo_all on public.%I', t);
    execute format('create policy demo_all on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Realtime: broadcast row changes to subscribed clients.
alter publication supabase_realtime add table
  public.config, public.rooms, public.categories, public.products,
  public.clients, public.bookings, public.folios, public.folio_lines,
  public.tickets, public.payments;
