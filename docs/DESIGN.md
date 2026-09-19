# SambaPOS-Style Hotel Web POS — Architecture & Design Document

> **Status:** Draft v1 for client review · **Audience:** Engineering, Product, Front-desk/F&B stakeholders
> **Fixed decisions:** Browser/tablet PWA · Rooms are selectable entities carrying a folio · Charges post to the room folio and settle at check-out · Priority: folio/room-charge posting, check-in/out & room status, PMS integration (with standalone no-PMS mode), payments + KOT/receipt printing + reporting · UI replicates the client's existing SambaPOS-style layout.
> **Baseline stack:** React + TypeScript + Vite + Tailwind (PWA) · Supabase (Postgres/Auth/Realtime/RLS) · Cloudflare Pages.

---

## 1. Overview & Goals

We are building a **web-based, touch-first Point of Sale for a multi-property hotel company** that visually and ergonomically replicates the client's existing SambaPOS ("Samepos") layout, while adding hotel-specific capabilities the desktop product does not natively provide: room folios, check-in/out, room-status management, and PMS integration.

The single most important conceptual mapping is:

> **A hotel ROOM is modeled exactly like a SambaPOS table — a state-colored, selectable entity button on an entity screen. Each room links to an Account. That Account's live ledger balance IS the guest folio. A "Room Charge" tender debits the folio instead of taking cash, and the folio settles at check-out.**

### Goals

1. **Fidelity.** Reproduce the SambaPOS muscle memory: Department → Entity Screen → Order Ticket (3-zone) → Settle. Lock the screen skeletons; make only their contents data-driven. Deviate from the familiar layout only where it demonstrably helps, and validate with real front-desk + F&B staff before build.
2. **Financial correctness.** Model the folio as a strict **append-only double-entry ledger**, never a mutable balance. Every posting is **idempotent** (unique key), every correction is a reversing entry, and every state change writes an audit event.
3. **Hotel lifecycle.** Support reservation → check-in (open folio) → post charges from any outlet → transfer/split between folios → settle at check-out → night audit / business-date roll.
4. **PMS-optional.** Run as **master of the folio** (standalone "house account" mode) **or** as a **satellite** that posts charges to an external PMS, behind a single adapter interface. No screen is coupled to a specific PMS.
5. **Multi-property tenancy.** Every table carries `property_id`; isolation is enforced in Postgres RLS driven by JWT claims, and tenant isolation is a tested, gated deliverable.
6. **Realistic browser POS.** Be honest about browser limits: **offline covers order capture, cash, and room-charge — not card capture**; printing goes through network printers/agents, not raw ESC/POS from the browser; card payments use semi-integrated readers driven server-side.

### Non-goals (v1)

- Full reservation/booking engine, channel manager, rate management, or housekeeping-staff mobile app (we consume room/guest status; the PMS or a later phase owns booking).
- Cloning SambaPOS's fully user-configurable Rules/Actions/Calculation-Types **engine**. We ship a **curated, admin-configurable** subset (menus, buttons, entity states, automation commands, tax/discount rules) — not a general automation platform. *(See §9, and the scope risk below.)*

### Top risks (carried through the doc)

- **Scope creep:** cloning the *look* is weeks; cloning SambaPOS *configurability* is a platform. Decide hardcoded-vs-configurable explicitly.
- **Offline card capture gap:** not possible in a browser. If a property must take cards offline, that terminal needs a native (Capacitor) shell.
- **RLS misconfiguration = cross-property data breach.** Deny-by-default + pgTAP isolation tests are a security gate.
- **Double-posting to the folio/PMS** on retries; **misposting to the wrong room**; **checkout colliding with an open outlet ticket**. Solved by idempotency keys, a two-factor room match, and a non-zero-folio checkout block.
- **Fiscalization** (DE/IT/FR/PT/AT) may require certified receipt hardware/middleware — a rollout blocker if unaddressed early.

---

## 2. Recommended Architecture

### 2.1 Component diagram

```
                          ┌──────────────────────────────────────────────────────────┐
                          │                    CLIENT (per terminal)                    │
                          │            React + TS + Vite + Tailwind  (PWA)             │
                          │                                                            │
                          │  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐ │
                          │  │  UI Shell  │  │  POS Session │  │  Sync Engine        │ │
                          │  │ (routes,   │  │  store       │  │  - Dexie outbox     │ │
                          │  │  3-zone    │  │ (Zustand):   │  │    (IndexedDB)      │ │
                          │  │  order,    │  │  cart, keypad│  │  - append-only      │ │
                          │  │  entity    │  │  paymentSess │  │    order_events     │ │
                          │  │  board,    │  │  lockOwner   │  │  - client UUID keys │ │
                          │  │  settle)   │  │              │  │  - flush on reconnect│ │
                          │  └────────────┘  └──────────────┘  └────────────────────┘ │
                          │  Service Worker (Workbox app-shell precache) · Wake Lock ·  │
                          │  TanStack Query (server state) · kiosk locks               │
                          └───────┬───────────────────┬───────────────────┬───────────┘
                                  │ HTTPS/WSS          │ HTTP/XML          │ (native shell only)
                                  │                    │ (ePOS-Print)      │ Stripe/Adyen
              ┌───────────────────▼──────────┐   ┌─────▼─────────┐   Terminal SDK (offline cards)
              │        SUPABASE (per env)     │   │  Print target │
              │                               │   │  Epson TM     │
              │  ┌─────────┐  ┌────────────┐  │   │  network      │
              │  │ Postgres│  │  Auth      │  │   │  printer  OR  │
              │  │ + RLS   │  │  (JWT +    │  │   │  local print  │
              │  │ ledger, │  │  custom    │  │   │  agent (Go/   │
              │  │ folios, │  │  access-   │  │   │  Node, per    │
              │  │ tickets │  │  token hook│  │   │  property LAN)│
              │  └────┬────┘  └────────────┘  │   └──────▲────────┘
              │       │                        │          │ Realtime/webhook
              │  ┌────▼─────┐  ┌────────────┐  │          │ (KOT/receipt jobs)
              │  │ Realtime │  │Edge         │──┼──────────┘
              │  │ Broadcast│  │Functions:   │  │
              │  │ (from DB │  │ - PMS post  │──┼───────────────┐
              │  │ triggers)│  │ - payments  │  │               │
              │  │ Presence │  │ - webhooks  │──┼──────────┐    │
              │  └──────────┘  │ - token hook│  │          │    │
              │                │ - night audit│ │          │    │
              │                └─────────────┘  │          │    │
              └───────────────────────────────┘           │    │
                                                    ┌──────▼──┐ ┌▼───────────────┐
                                                    │ Payments│ │  PMS ADAPTER    │
                                                    │ gateway │ │  (pluggable)    │
                                                    │ Stripe/ │ │ Opera/OHIP,Mews,│
                                                    │ Adyen   │ │ Cloudbeds,Apaleo│
                                                    │ (cloud  │ │  + Standalone   │
                                                    │  reader │ │  house-account  │
                                                    │  REST)  │ │  fallback       │
                                                    └─────────┘ └─────────────────┘

   Static PWA hosting: Cloudflare Pages (per-PR preview deploys).
   All server logic lives in Supabase Edge Functions (avoid Cloudflare Workers split-brain unless an edge need arises).
```

### 2.2 Component responsibilities

**Frontend (React PWA)**
- **UI Shell** — fixed screen skeletons (see §4) via CSS Grid; contents data-driven from config tables. Router = react-router. Kiosk hardening: fullscreen, Wake Lock, `touch-action`/viewport locks, no text-selection/long-press callouts, ≥64px (ideally 80–120px) hit targets, sub-100ms tap feedback, auto-reload on new deploy.
- **POS Session store (Zustand)** — ephemeral UI/session state: selected department, active entity screen + floor-plan mode, active ticket, selected order-line ids, keypad buffer + quantity multiplier, active menu category + grid page, modifier sheet, payment session (tendered, splitPayments[], remaining, item-split selection), sync/connection status, lock owner.
- **Server state (TanStack Query)** — menus, entities, room status, tickets, reports.
- **Sync Engine** — Dexie/IndexedDB **outbox** of mutations with **client-generated UUID idempotency keys**; orders represented as an **append-only `order_events` log** so reconnect merge is additive (no lost line items); LWW+version only for scalar status fields. Flushes to Supabase on reconnect.

**Backend (Supabase)**
- **Postgres + RLS** — source of truth: the double-entry ledger, folios, tickets, entities, config. Server is authoritative.
- **Auth + custom access-token hook** — stamps `org_id`, `property_id[]`, and `role` into the JWT from a `memberships` table. **Never trust a client-supplied `property_id`.**
- **Realtime** — **Broadcast from database triggers** (`realtime.broadcast_changes`) for entity-state/ticket fan-out (scales better than raw Postgres Changes); **Presence** for who's-logged-in-per-terminal; RLS-scoped channels per property. This replaces SambaPOS's LAN Message Server.
- **Edge Functions** — PMS posting, payment orchestration (create PaymentIntent, drive cloud reader), gateway/PMS webhooks, the access-token hook, and the night-audit job.

**Integrations** — PMS behind a single adapter interface (§6); payments behind a gateway; printing behind ePOS-Print or a local agent (§7).

**Concurrency** — ticket locking / optimistic concurrency so two terminals cannot corrupt one room folio; show a `locked by <user>` state as SambaPOS does; evaluate credit-limit checks at commit, not read time.

---

## 3. Data Model — Postgres Schema Sketch

Conventions: every business table carries `property_id uuid not null` (tenancy key) and `org_id uuid not null`; `id uuid primary key default gen_random_uuid()`; `created_at timestamptz not null default now()`. Money is `numeric(14,4)` (store, round at presentation). "Business date" (`date`) is separate from wall-clock `timestamptz`.

### 3.1 Tenancy & auth

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  config jsonb not null default '{}'::jsonb
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  currency char(3) not null,
  timezone text not null,               -- for business-date & night-audit cutoff
  tax_jurisdiction text,
  fiscalization_profile text,           -- e.g. 'none','DE_TSE','IT','FR'
  business_date date,                   -- current open business date
  config jsonb not null default '{}'::jsonb
);

create table app_users (                -- mirrors auth.users
  id uuid primary key,                  -- = auth.uid()
  display_name text not null,
  pin_hash text,                        -- for on-terminal PIN re-auth
  is_active boolean not null default true
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,                   -- server, cashier, manager, night_auditor, admin
  permissions text[] not null default '{}'  -- void, refund, comp, price_override,
);                                          -- discount_over_threshold, folio_transfer,
                                            -- credit_limit_override, no_sale, close_day

create table memberships (              -- drives JWT claims via access-token hook
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  user_id uuid not null references app_users(id),
  property_id uuid not null references properties(id),
  role_id uuid not null references roles(id),
  unique (user_id, property_id)
);
```

**Access-token hook (Edge Function):** on token mint, read `memberships` for `auth.uid()` and inject `app_metadata.org_id`, `app_metadata.property_ids` (array), `app_metadata.role`. Client code never sets these.

### 3.2 Terminals, printers, devices

```sql
create table terminals (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null,
  default_department_id uuid,           -- FK added after departments
  default_entity_screen_id uuid,
  receipt_printer_id uuid,
  payment_device_id uuid,
  kiosk_config jsonb not null default '{}'::jsonb
);

create table printers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null,
  conn_type text not null check (conn_type in ('epos','agent','network')),
  host text, ip inet, port int,
  station_role text not null check (station_role in ('receipt','kitchen','expo'))
);

create table print_routes (             -- item/category -> printer/station
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  category_id uuid, product_id uuid,    -- one of the two set
  printer_id uuid not null references printers(id)
);

create table payment_devices (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  provider text not null check (provider in ('stripe','adyen')),
  reader_ref text not null,             -- Stripe reader id / Adyen POI id
  capabilities jsonb not null default '{}'::jsonb  -- contactless, offline_capable(native)
);
```

### 3.3 Rooms as entities, states, screens

```sql
create table entity_types (             -- 'Room','Guest','Table'
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null,
  account_type_template text,
  name_template text,                   -- e.g. '[Name]-[Phone]'
  custom_fields jsonb not null default '[]'::jsonb  -- [{key,type,hidden}]
);

create table entity_states (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  entity_type_id uuid not null references entity_types(id),
  dimension text not null check (dimension in ('FO','HK','AVAIL')),
  name text not null,                   -- VACANT/OCCUPIED ; DIRTY/CLEAN/INSPECTED ; ...
  color text not null                   -- state -> color map source of truth
);

create table entities (                 -- a Room instance = a selectable button
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  entity_type_id uuid not null references entity_types(id),
  name text not null,                   -- room_number for rooms
  fo_state_id uuid references entity_states(id),   -- VACANT/OCCUPIED
  hk_state_id uuid references entity_states(id),   -- DIRTY/CLEAN/INSPECTED
  avail_state_id uuid references entity_states(id),-- IN_SERVICE/OOO/OOS
  account_id uuid,                      -- the folio Account (FK below)
  open_ticket_id uuid,
  custom_values jsonb not null default '{}'::jsonb, -- floor,wing,room_type,guest,occupancy,checkout_date
  is_active boolean not null default true,
  unique (property_id, entity_type_id, name)
);

create table entity_screens (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  entity_type_id uuid not null references entity_types(id),
  name text not null,
  view_mode text not null check (view_mode in ('Automatic','Custom')),
  background_image_url text,
  filters jsonb not null default '{}'::jsonb,      -- floor/wing/room-type
  button_layout jsonb not null default '[]'::jsonb -- [{entity_id,x,y,w,h,shape,angle,cornerRadius}]
);

create table room_status_log (          -- append-only room status audit
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  entity_id uuid not null references entities(id),
  dimension text not null check (dimension in ('FO','HK','AVAIL')),
  from_state text, to_state text, reason text,
  changed_by uuid references app_users(id),
  business_date date not null,
  changed_at timestamptz not null default now()
);
```

### 3.4 Menu, products, modifiers

```sql
create table departments (              -- revenue/routing bucket (Room,Food,Bev,Minibar,Spa...)
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null,
  gl_code text, transaction_code text,
  outlet_id uuid,
  ticket_type text,
  default_entity_screen_id uuid, screen_menu_id uuid, printer_routing_id uuid
);

create table outlets (                  -- revenue center
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  code text, name text,
  type text check (type in ('RESTAURANT','BAR','ROOM_SERVICE','MINIBAR','SPA','FRONT_DESK','LAUNDRY')),
  is_postable_to_room boolean not null default true,
  default_tax_class_id uuid
);

create table screen_menus (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null
);

create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  screen_menu_id uuid not null references screen_menus(id),
  name text not null,
  department_id uuid references departments(id),
  columns int not null default 4,
  button_height int not null default 96,
  color text, page_count int not null default 1, sort_order int not null default 0
);

create table products (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  category_id uuid not null references menu_categories(id),
  name text not null, sku text,
  base_price numeric(14,4) not null default 0,
  is_open_price boolean not null default false,
  tax_class_id uuid, is_active boolean not null default true
);

create table portions (                 -- size/variant, own price (single mandatory select)
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  product_id uuid not null references products(id),
  name text not null, price numeric(14,4) not null, multiplier numeric not null default 1
);

create table menu_buttons (             -- the product grid button config
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  category_id uuid not null references menu_categories(id),
  product_id uuid not null references products(id),
  caption text, color text, image_url text,
  auto_select boolean not null default false,   -- auto-open portion/tag sheet on tap
  default_portion_id uuid, quick_tag_ids uuid[], sort_order int not null default 0
);

create table order_tag_groups (         -- modifiers: min/max multi-select
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  name text not null, min_select int not null default 0, max_select int,
  free_tagging boolean not null default false, button_color text
);

create table order_tags (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  group_id uuid not null references order_tag_groups(id),
  name text not null, price_delta numeric(14,4) not null default 0, sort_order int not null default 0
);

create table product_tag_groups (       -- M:N product <-> tag group
  product_id uuid not null references products(id),
  group_id uuid not null references order_tag_groups(id),
  primary key (product_id, group_id)
);
```

### 3.5 Tickets & order lines (short-lived outlet document)

```sql
create table work_periods (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  business_date date not null,
  started_by uuid, started_at timestamptz not null default now(),
  ended_by uuid, ended_at timestamptz,
  status text not null check (status in ('OPEN','CLOSED')),
  opening_float_total numeric(14,4)
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  ticket_number text,
  outlet_id uuid references outlets(id),
  department_id uuid references departments(id),
  terminal_id uuid references terminals(id),
  work_period_id uuid references work_periods(id),
  ticket_type text check (ticket_type in ('DINE_IN','ROOM_SERVICE','WALK_IN','BAR_TAB')),
  room_entity_id uuid references entities(id),   -- resolved room (nullable)
  folio_id uuid,                                 -- routing target (nullable)
  guest_id uuid, reservation_id uuid,
  state text not null check (state in ('OPEN','LOCKED','SETTLED','VOID')) default 'OPEN',
  subtotal numeric(14,4) not null default 0,
  tax_total numeric(14,4) not null default 0,
  service_charge_total numeric(14,4) not null default 0,
  discount_total numeric(14,4) not null default 0,
  grand_total numeric(14,4) not null default 0,
  paid_total numeric(14,4) not null default 0,
  balance numeric(14,4) not null default 0,
  covers int, locked_by uuid,
  version int not null default 0,               -- optimistic concurrency
  opened_by uuid, opened_at timestamptz not null default now(),
  closed_by uuid, closed_at timestamptz
);

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  ticket_id uuid not null references tickets(id),
  product_id uuid not null references products(id),
  portion_id uuid references portions(id),
  description text,
  quantity numeric not null default 1,
  unit_price numeric(14,4) not null,
  line_total numeric(14,4) not null,
  tax_amount numeric(14,4) not null default 0,
  service_charge_amount numeric(14,4) not null default 0,
  discount_amount numeric(14,4) not null default 0,
  state text not null check (state in ('NEW','SUBMITTED','PREPARED','VOID','COMP')) default 'NEW',
  seat int, void_reason text,
  added_by uuid, added_at timestamptz not null default now(),
  kitchen_sent_at timestamptz
);

create table order_line_modifiers (
  order_line_id uuid not null references order_lines(id),
  order_tag_id uuid not null references order_tags(id),
  price_delta numeric(14,4) not null default 0,
  primary key (order_line_id, order_tag_id)
);

create table order_events (             -- append-only, offline-merge source of truth
  id uuid primary key,                  -- client-generated UUID = idempotency key
  property_id uuid not null,
  ticket_id uuid not null,
  seq bigint not null,
  event_type text not null,             -- LINE_ADD, LINE_VOID, TAG_ADD, QTY_SET, ...
  payload jsonb not null,
  actor_id uuid, terminal_id uuid,
  created_at timestamptz not null default now(),
  unique (id)
);
```

### 3.6 Folio — the persistent double-entry ledger

```sql
create table account_types (            -- 'Guest Folio','City Ledger/AR','Cash','Card','Revenue'...
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null, name text not null
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  account_type_id uuid not null references account_types(id),
  name text not null
  -- NOTE: no mutable balance column. Balance is derived (view / cached-with-version).
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  confirmation_no text unique,
  guest_id uuid, room_type_id uuid, assigned_room_entity_id uuid references entities(id),
  arrival_date date, departure_date date, adults int, children int, rate_plan_id uuid,
  status text not null check (status in
    ('BOOKED','CONFIRMED','IN_HOUSE','CHECKED_OUT','CANCELLED','NO_SHOW')),
  deposit_amount numeric(14,4), external_pms_ref text
);

create table folios (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  folio_number text unique,
  reservation_id uuid references reservations(id),
  guest_id uuid, room_entity_id uuid references entities(id),
  account_id uuid not null references accounts(id),   -- the ledger account
  folio_type text not null check (folio_type in ('GUEST','MASTER','GROUP','HOUSE','PERMANENT'))
    default 'GUEST',
  status text not null check (status in ('OPEN','SETTLED','CLOSED','TRANSFERRED','DISPUTED')),
  credit_limit numeric(14,4),
  currency char(3) not null,
  opened_by uuid, opened_at timestamptz, closed_by uuid, closed_at timestamptz,
  external_ref text                                   -- PMS folio id when satellite
);

create table folio_lines (              -- APPEND-ONLY. No UPDATE/DELETE of financial rows.
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  folio_id uuid not null references folios(id),
  line_type text not null check (line_type in
    ('CHARGE','PAYMENT','TAX','SERVICE_CHARGE','DISCOUNT','ADJUSTMENT',
     'TRANSFER_IN','TRANSFER_OUT','CORRECTION','DEPOSIT')),
  department_id uuid references departments(id),
  source_type text not null check (source_type in
    ('ROOM_NIGHT','POS_TICKET','MANUAL','DEPOSIT','NIGHT_AUDIT')),
  source_ref text,                       -- ticket_id / audit run id / etc.
  description text, quantity numeric, unit_amount numeric(14,4),
  amount numeric(14,4) not null,         -- SIGNED: charge +, payment/credit -
  tax_amount numeric(14,4) not null default 0,
  business_date date not null,
  posted_at timestamptz not null default now(), posted_by uuid,
  reference_no text,
  idempotency_key text not null,
  reversal_of_line_id uuid references folio_lines(id),
  transfer_id uuid,                      -- links balanced TRANSFER_OUT/IN pair
  is_reversed boolean not null default false,
  unique (property_id, idempotency_key)  -- the core double-post defense
);

create table payment_types (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  name text not null,
  kind text not null check (kind in
    ('CASH','CARD','ROOM_CHARGE','CITY_LEDGER','VOUCHER','COMP','DEPOSIT','GIFT_CARD')),
  settlement_account_id uuid references accounts(id),
  requires_folio boolean not null default false   -- true for ROOM_CHARGE/CITY_LEDGER
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  ticket_id uuid references tickets(id),
  folio_id uuid references folios(id),
  payment_type_id uuid not null references payment_types(id),
  amount numeric(14,4) not null,
  tip_amount numeric(14,4) not null default 0,
  tendered numeric(14,4), change numeric(14,4),
  currency char(3) not null, fx_rate numeric,
  card_token text, card_last4 text, auth_code text,   -- NEVER store PAN/CVV
  status text not null check (status in
    ('AUTHORIZED','CAPTURED','VOIDED','REFUNDED','SETTLED')),
  business_date date not null,
  allocated_order_line_ids uuid[],       -- item-based split
  settled_by uuid, settled_at timestamptz,
  work_period_id uuid, cash_drawer_session_id uuid,
  idempotency_key text not null,
  reversal_of_payment_id uuid references payments(id),
  reference_no text,
  unique (property_id, idempotency_key)
);

create table account_transactions (      -- explicit double-entry legs (optional but recommended)
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  source_account_id uuid not null references accounts(id),
  target_account_id uuid not null references accounts(id),
  amount numeric(14,4) not null,
  transaction_type_id uuid,
  ticket_id uuid, folio_line_id uuid, payment_id uuid,
  business_date date not null,
  created_at timestamptz not null default now()
);
```

### 3.7 Tax, service charge, discount, drawer, audit, PMS, night audit

```sql
create table tax_classes (
  id uuid primary key default gen_random_uuid(), property_id uuid not null,
  name text not null, rate numeric not null,
  method text not null check (method in ('INCLUSIVE','EXCLUSIVE')),
  gl_account text, component_order int not null default 0   -- supports stacked VAT + tourism levy
);
create table service_charges (
  id uuid primary key default gen_random_uuid(), property_id uuid not null,
  name text not null, rate_or_amount numeric not null,
  is_percent boolean not null default true, is_taxable boolean not null default true,
  auto_gratuity boolean not null default false
);
create table discounts (
  id uuid primary key default gen_random_uuid(), property_id uuid not null,
  name text not null,
  type text not null check (type in ('PERCENT','AMOUNT','PRICE_OVERRIDE','COMP')),
  scope text not null check (scope in ('LINE','TICKET')),
  max_value numeric, requires_reason boolean not null default false,
  requires_authorization boolean not null default false, promo_code text
);
create table ticket_calculations (       -- applied tax/sc/discount recorded for reproducibility
  id uuid primary key default gen_random_uuid(), property_id uuid not null,
  ticket_id uuid not null references tickets(id),
  kind text not null check (kind in ('Discount','ServiceCharge','Tax')),
  name text, is_percent boolean, value numeric, computed_amount numeric(14,4),
  scope text check (scope in ('Ticket','Line')), sort_order int not null default 0
);

create table cash_drawer_sessions (
  id uuid primary key default gen_random_uuid(), property_id uuid not null,
  terminal_id uuid, work_period_id uuid, user_id uuid,
  opened_at timestamptz, opening_float numeric(14,4),
  closed_at timestamptz, counted_cash numeric(14,4), expected_cash numeric(14,4),
  over_short numeric(14,4),
  status text not null check (status in ('OPEN','CLOSED'))
);
create table drawer_movements (
  id uuid primary key default gen_random_uuid(), property_id uuid not null,
  session_id uuid not null references cash_drawer_sessions(id),
  type text not null check (type in ('PAID_IN','PAID_OUT','DROP','SKIM','NO_SALE')),
  amount numeric(14,4), reason text, user_id uuid, created_at timestamptz not null default now()
);

create table night_audit_runs (
  id uuid primary key default gen_random_uuid(), property_id uuid not null,
  business_date date not null,
  status text not null check (status in ('RUNNING','COMPLETED','FAILED','ROLLED_BACK')),
  started_at timestamptz, completed_at timestamptz, run_by uuid,
  rooms_posted_count int, trial_balance_ref text,
  unique (property_id, business_date)    -- restartable / idempotent per date
);

create table event_log (                 -- append-only system-wide audit trail
  id uuid primary key default gen_random_uuid(), property_id uuid not null,
  entity_type text, entity_id uuid, action text,
  actor_id uuid, approver_id uuid, terminal_id uuid,
  business_date date, occurred_at timestamptz not null default now(),
  before_json jsonb, after_json jsonb, correlation_id uuid, reason_code text
);

create table pms_connections (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references properties(id),
  pms_type text not null check (pms_type in ('apaleo','mews','cloudbeds','opera','standalone')),
  credential_ref text,                   -- vault reference, secrets stored server-side
  base_url text, sync_cursor jsonb not null default '{}'::jsonb,
  is_active boolean not null default true
);

create table folio_postings (            -- outbox: POS charge -> PMS folio
  id uuid primary key default gen_random_uuid(), property_id uuid not null,
  folio_id uuid, ticket_id uuid, folio_line_id uuid,
  pms_connection_id uuid references pms_connections(id),
  pms_charge_id text,
  idempotency_key text not null,
  status text not null check (status in ('PENDING','POSTED','FAILED','REVERSED')),
  attempts int not null default 0, last_error text,
  created_at timestamptz not null default now(),
  unique (property_id, idempotency_key)
);

create table feature_flags (
  property_id uuid not null references properties(id),
  key text not null, value jsonb not null,
  primary key (property_id, key)         -- offline_mode, pms_enabled, fiscalization, printing_mode
);
```

### 3.8 Balance is derived (never a mutable field)

```sql
create view folio_balances as
  select f.id as folio_id, f.property_id,
         coalesce(sum(fl.amount),0) as balance
  from folios f
  left join folio_lines fl on fl.folio_id = f.id and fl.is_reversed = false
  group by f.id, f.property_id;
```
Optionally cache into `folios.cached_balance` + `folios.balance_version` for fast reads, updated by trigger; the **credit-limit check evaluates at commit**, not at read.

### 3.9 Core invariants (enforced in schema + triggers/automation)

1. `folio balance = SUM(folio_lines.amount WHERE NOT is_reversed)` — always derived.
2. No `folio_lines` insert unless `folios.status = 'OPEN'`.
3. A `ROOM_CHARGE` payment MUST create **exactly one** `folio_lines` CHARGE row under the same idempotency scope.
4. **Check-out is blocked while folio balance ≠ 0** unless an authorized City-Ledger (AR) transfer clears it.
5. Transfers are **balanced pairs**: `TRANSFER_OUT + TRANSFER_IN` net to zero, linked by `transfer_id`.
6. A room can be room-charged only if `fo_state = OCCUPIED` **and** a matching `OPEN` folio exists **and** guest is in-house on the current business date **and** the outlet is `is_postable_to_room` **and** within `credit_limit` **and** a two-factor match (room number + guest last name) passes. Fail any → fall back to walk-in drawer settlement.
7. `folio_lines` and `payments` are **append-only**: corrections are reversing rows (`reversal_of_line_id` / `reversal_of_payment_id`), never UPDATE/DELETE.
8. Post-midnight sales carry the prior `business_date` until Night Audit rolls it; business date is owned by Night Audit, not by opening/closing a work period.

### 3.10 RLS strategy

- **Deny by default.** `alter table <t> enable row level security;` with **no** permissive policy until one is written.
- **Tenant scope from JWT only.** Helper:
  ```sql
  create or replace function auth_property_ids() returns uuid[]
  language sql stable security definer as $$
    select coalesce((auth.jwt() -> 'app_metadata' ->> 'property_ids')::jsonb, '[]'::jsonb)
           ::text::uuid[];  -- normalized in the hook; never client-set
  $$;
  ```
  Policy pattern on every table:
  ```sql
  create policy tenant_read on folio_lines for select
    using (property_id = any (auth_property_ids()));
  create policy tenant_write on folio_lines for insert
    with check (property_id = any (auth_property_ids()));
  ```
- **Role gating** for sensitive tables via a `has_permission(text)` `SECURITY DEFINER` helper reading `app_metadata.role` → `roles.permissions`.
- **Financial rows are insert-only at the DB layer:** no UPDATE/DELETE policy on `folio_lines`/`payments`/`event_log` for any app role; reversals are inserts.
- **pgTAP isolation tests are a required CI gate** — a missing/broad policy is a cross-property breach. Test: user of property A cannot select/insert/update rows of property B, and cannot smuggle a foreign `property_id` on insert.

---

## 4. Screen / Module Map

Fixed skeletons (locked for muscle memory); only contents are data-driven. Navigation hierarchy mirrors SambaPOS: **Navigation home → Department → Entity Screen → Order Ticket → Settle**, with Check-in/out, Room-status, Reports, and Admin as siblings.

### 4.1 Navigation / Home (landing)
Large configurable widget buttons routing into departments, entity screens, reports, work-period actions. PIN-pad login tied to Roles. Terminal shows its default department/entity screen/printer.

### 4.2 Room / Entity Board (default landing for F&B + front desk)
- **Two view modes** (per SambaPOS): **Automatic** (auto grid of room buttons, filterable by floor/wing/room-type) and **Custom** (designed property/floor-plan: SVG/image background + absolutely-positioned room components from `entity_screens.button_layout`, saved x/y/w/h/shape/angle/cornerRadius; red border = Design Mode).
- Each room button is **state-colored** from a single state→color map (Vacant-Clean=green, Occupied=orange, Checkout-due=red, DND=purple, Dirty=grey, OOO=hatched). FO/HK/AVAIL combine into label + color (e.g. "VC").
- Tapping a room **opens/creates its open ticket** and shows the live **folio balance**.

### 4.3 Order Ticket (three-zone, fixed CSS Grid) — the heart
```
┌───────────────────────────┬───────────────────────┬───────────────────────────┐
│  LEFT: Ticket / Order      │  CENTER: Category rail │  RIGHT: Product grid       │
│  - line = qty × product    │  (tabbed / paged       │  (columns, buttonHeight,   │
│    price; order-tags       │   category buttons)    │   color, image, autoSelect │
│    indented, colored by    │                        │   from menu_buttons)       │
│    order state             │                        │   left/right paging, no    │
│  - running subtotal, tax,  │                        │   scroll during ordering   │
│    service, discount,      │                        │                            │
│    grand total             │                        │                            │
│  - FOLIO BALANCE for room  │                        │                            │
├───────────────────────────┴───────────────────────┴───────────────────────────┤
│  FUNCTION BAR (Automation Commands, permission-gated):                          │
│  Submit · Void · Cancel · Discount · Service Charge · Gift/Comp · Change Price ·│
│  Move/Transfer · Split/Merge · Settle · Close                                   │
└────────────────────────────────────────────────────────────────────────────────┘
```
- **Ergonomics:** tapping same product **increments qty** (no duplicate line); keypad **multiplier** prefix (type 3, tap product → qty 3); shared numeric keypad across order (qty/price override) and settle (tender).
- **Modifiers (two mechanisms, separate):** **Portions** = single mandatory single-select setting base price; **Order Tag Groups** = min/max multi-select with per-tag deltas — shown in a bottom-sheet on `auto_select`, editable by selecting an existing line.
- **New/unsent lines render bold/accent**; Submit fires KOT print/route → SUBMITTED.

### 4.4 Settle / Payment (own route, mirrors SambaPOS)
- Ticket lines + folio on **left**, shared numeric **keypad** center, **tender buttons** right (Cash, Card, Voucher, Comp, and a first-class **ROOM CHARGE / Post to Folio**).
- Quick-cash chips (exact, next round), amount-based split (type amount → tender), equal-split (N ways), **item-based split** (tap lines to allocate). Each partial payment (type/amount/time/user) logged in a running list. Overpayment auto-calculates change.
- **ROOM CHARGE** debits the room Account (writes a `folio_lines` CHARGE) rather than capturing money; enforces the §3.9(6) guard including the **two-factor room + last-name** confirmation.

### 4.5 Check-in / Check-out
- **Check-in:** select reservation/room, flip FO Vacant→Occupied, set reservation IN_HOUSE, **open folio** (issue `folio_number`, set `credit_limit` from card auth/payment method). Nothing may post to a non-OPEN folio.
- **Check-out:** present folio (dated debit/credit lines + balance), take payment(s) to zero; folio SETTLED→CLOSED, reservation CHECKED_OUT, room Occupied→Vacant + HK Clean→Dirty. Residual balance requires an **authorized City-Ledger (AR) transfer** — check-out cannot silently leave a non-zero folio.

### 4.6 Room-status Board (housekeeping/front-desk view)
Projection over FO + HK + AVAIL states and open tickets; live via Realtime Broadcast. Bulk status changes (Dirty→Clean→Inspected), OOO/OOS toggles, DND. Every change writes `room_status_log`.

### 4.7 Manager / Reports
Work-period X/Z reports, sales by department/outlet, tender mix, voids/comps/discounts trail, drawer over/short, folio/AR aging, night-audit trial balance, **three-way reconciliation** (POS ↔ processor ↔ PMS folio). Sensitive actions require manager-PIN re-auth.

### 4.8 Admin / Menu-Builder
Data-driven editors for: screen menus/categories/buttons (columns, height, color, pages, autoSelect), products/portions/order-tags, entity types/states/screens (grid + floor-plan designer), departments/outlets, printers + print routes, payment types, tax/service/discount, terminals/users/roles, feature flags, PMS connection config.

### 4.9 Kitchen Display (KDS) — routed orders
Separate view of order cards with bump/recall and age-timing colors; per-department routing (room service vs outlet dining have different prep/delivery flows) from `print_routes`/station config.

---

## 5. Folio & Charge-Posting Lifecycle

```
RESERVATION            CHECK-IN            POST CHARGES         TRANSFER/SPLIT        SETTLE / CHECK-OUT        NIGHT AUDIT
BOOKED                 assign room         outlet ticket        move charge between   present folio             verify outlets closed
  ↓ deposit→credit     FO: VAC→OCC         → "Charge to Room"   folios = atomic pair  take payment(s) → 0       post room-night + tax
CONFIRMED              reservation IN_HOUSE resolve Room+Folio   TRANSFER_OUT (src)    folio SETTLED→CLOSED        to in-house folios
  ↓ check-in           OPEN folio          settle ROOM_CHARGE   TRANSFER_IN (dst)     reservation CHECKED_OUT   process no-shows
IN_HOUSE ─────────────►(folio_number,      → folio_lines CHARGE equal, linked by      room OCC→VAC, HK→DIRTY    roll business_date
                        credit_limit)      (dept, tax, sc)      transfer_id           residual → City Ledger    snapshot trial balance
                                           night audit posts    split by dept:         (authorized) only          (restartable per
                                           room-night+tax auto  room+tax→company,                                 room+date+charge)
                                                                incidentals→guest
```

### 5.1 Idempotency (the #1 financial defense)
- Every posting path (POS→folio, payment capture, night-audit room post, PMS post) carries a **unique idempotency key**: deterministic `hash(source_type, source_id, operation, business_date, seq)` for server operations; a persisted **client UUID** for terminal-initiated ones.
- `UNIQUE (property_id, idempotency_key)` on `folio_lines`, `payments`, `folio_postings`.
- Re-posting = `INSERT ... ON CONFLICT DO NOTHING RETURNING` then return the existing row — safe under network retries, double-taps, and night-audit re-runs.
- Cross-service posting uses the **transactional outbox** (`folio_postings`: PENDING→POSTED→FAILED/REVERSED).

### 5.2 Charge routing decided at settlement (not at order time)
Room-charge requires ALL of §3.9(6). Any failure → walk-in drawer settlement at the outlet.

### 5.3 Audit trail
- `folio_lines`/`payments` append-only; corrections are reversing entries.
- Every state transition (room status, reservation, folio open/close, void, comp, discount, transfer, credit-limit override) writes an `event_log` row with actor, approver, terminal, business_date, before/after JSON, `correlation_id` (links a whole business transaction), and `reason_code`.
- Backdated corrections after Work-Period close / Night-Audit roll post as **current-date adjustments**, never backdated edits.

### 5.4 Concurrency
Ticket lock states + optimistic concurrency (`tickets.version`); "locked by X" UI. Append-only ledger avoids lost inserts; cached balance uses version check; credit-limit evaluated at commit. Checkout colliding with an open outlet ticket is blocked by the non-zero-folio guard.

---

## 6. PMS Integration Design

### 6.1 Adapter interface (single boundary; no screen couples to a PMS)

```typescript
interface PmsAdapter {
  // Identity / capability
  capabilities(): PmsCapabilities;                       // supportsFolioSplit, supportsRoomStatusPush, ...

  // Rooms & guests (source for "rooms as buttons" + status board)
  listRooms(cursor?): Promise<{ rooms: PmsRoom[]; cursor?: string }>;
  listInHouseGuests(cursor?): Promise<{ guests: PmsGuest[]; cursor?: string }>;
  getReservation(ref): Promise<PmsReservation>;

  // Folio lifecycle
  resolveFolio(roomNo, guestLastName): Promise<PmsFolioRef>;   // enforces two-factor match
  postCharge(req: {
    folioRef; amount; taxAmount; departmentCode; description;
    businessDate; idempotencyKey;                        // idempotent, retriable
  }): Promise<{ pmsChargeId: string }>;
  voidCharge(req: { pmsChargeId; reason; idempotencyKey }): Promise<void>;
  postPayment?(req): Promise<{ pmsPaymentId }>;          // when PMS owns settlement

  // Status sync
  pushRoomStatus?(roomNo, hkStatus): Promise<void>;      // optional; else PMS is master
  reconcile(businessDate): Promise<ReconResult>;         // POS charges ↔ PMS folio lines by dept
}
```

Operations at a glance: **listRooms, listInHouseGuests, getReservation, resolveFolio, postCharge, voidCharge, postPayment?, pushRoomStatus?, reconcile.** All charge/void/payment calls take an **idempotencyKey**; all failures route through the `folio_postings` outbox with retry + reconciliation.

### 6.2 Standalone (no-PMS) mode
- A built-in `standalone` adapter backed by the **local house-account ledger** (`folios` + `folio_lines`). The POS is **master of the folio**: check-in/out, folio, night-audit, and AR all run locally. Feature flag `pms_enabled=false`.
- Same adapter surface, so switching a property to a real PMS later is config, not a rewrite. Also the automatic fallback when a configured PMS is **down** (queue locally, reconcile on recovery — but validate folio status at post time; never post blindly from the queue to a checked-out/closed folio).

### 6.3 Per-PMS notes
| PMS | API | Notes |
|---|---|---|
| **Apaleo** | REST, OAuth2, **free sandbox** | Best DX; **build the first adapter here** to prove the flow. |
| **Mews** | Modern REST, charge posting | Solid; second adapter. |
| **Cloudbeds** | Modern REST, charge posting | Third adapter. |
| **Oracle OPERA Cloud (OHIP)** | 3,000+ REST ops | **Metered/billed per call incl. sandbox** → treat as a paid adapter; minimize calls, cache aggressively; night-audit windows can lock folios (posts fail for reasons unrelated to our app). |

General: no single PMS standard; some field integrations are still CSV-based. **Confirm the client's actual PMS and whether the POS is master or satellite before finalizing checkout.** Guest PII is synced across properties/countries → store **references, not full profiles**, mind data residency/GDPR (region choice, retention, minimization).

---

## 7. Offline, Printing & Payments Strategy

### 7.1 Offline — realistic scope
- **Covered offline:** order capture, cash tender, **room-charge posting** (queued), and reads of cached menu/rooms.
- **NOT covered offline:** **card capture** (see §7.3). Set stakeholder expectations explicitly.
- **Mechanism:** Workbox service-worker app-shell precache + runtime caching; **Dexie/IndexedDB outbox** with client-UUID idempotency keys; orders as **append-only `order_events`** (additive merge, no lost line items); LWW+version only for scalar status. On reconnect, the sync engine flushes the outbox; room charges post to the folio/PMS with the same key + reconciliation pass. Consider **PowerSync** (works directly on Supabase Postgres) if the hand-rolled outbox grows complex; otherwise the event-sourced outbox is the pragmatic default.
- **Queued room-charge caveat:** validate folio `status='OPEN'` **at post time**; if the folio was checked out/closed while offline, route to a reversal + re-route path (drawer settlement or AR), never a blind post.

### 7.2 Printing — browsers can't reliably speak raw ESC/POS
- **Receipts (web-native path):** **Epson ePOS-Print** — browser POSTs XML over HTTP to Epson TM **network** printers. Standardize on Epson TM hardware where possible.
- **Kitchen/KOT + mixed/USB hardware:** a small **local print agent per property** (Go or Node) subscribes to Supabase Realtime / an Edge Function webhook, renders ESC/POS, and manages **routing + retries + observability** per station. Model stations and item→printer routing as data (`printers`, `print_routes`).
- **Fallback only:** `window.print()` + CSS for A4/letter or degraded receipts (poor thermal alignment). WebUSB is Chrome-only, per-device-permissioned, and conflicts with OS drivers — avoid as a primary path.
- The print agent becomes a per-site dependency → build retry/observability and a remote-config/MDM update story.

### 7.3 Payments — semi-integrated, server-driven
- **Readers:** semi-integrated smart readers (Stripe Terminal S700 / BBPOS WisePOS E; or Adyen if the group already uses Adyen).
- **Prefer SERVER-DRIVEN cloud reader control:** create the PaymentIntent **server-side** (Supabase Edge Function) and push to the reader via the **Terminal REST API** (`POST /v1/terminal/readers/{id}/process_payment_intent`) — **not** the on-LAN JS SDK. This survives **Chrome 142+ Local Network Access** changes (Oct 2025) that can silently break the JS SDK on browser auto-update, works across networks, and keeps card data entirely off our app.
- **PCI scope minimal** (SAQ, effectively P2PE/semi-integrated). **Never render or transmit PAN/CVV in the browser**; store only gateway **token + masked last-4 + auth_code**. Refunds/webhooks handled server-side. Build **three-way reconciliation** (POS tenders ↔ processor ↔ PMS folio) for the night auditor.
- **Offline cards (only if a hard requirement for a property):** ship the **same React codebase in a Capacitor (Android) shell** for those terminals and use the **native Stripe/Adyen Terminal SDK** (the only path supporting offline capture). Scope and budget this up front; do not attempt offline card capture in the browser.

### 7.4 Fiscalization / compliance
Several EU markets (DE KassenSichV/TSE, IT, FR, PT, AT) require fiscally **certified** receipts — a generic web receipt is non-compliant and may force certified hardware/middleware per country. **Check the company's operating countries early**; it constrains the ticket/void data model and can block rollout.

---

## 8. Phased Delivery Roadmap

### Phase 0 — Foundations (enablement)
- Repo, CI (GitHub Actions), Cloudflare Pages preview deploys, Supabase projects (dev/staging/prod) + migrations + seed + a dedicated staging property.
- Auth + **custom access-token hook** (org/property/role claims); `organizations`, `properties`, `memberships`, `roles`.
- **RLS deny-by-default + pgTAP tenant-isolation tests as a CI gate.**
- Kiosk PWA shell (Workbox, Wake Lock, touch locks), design tokens/Tailwind theme matching SambaPOS colors.

### Phase 1 — Walking-skeleton MVP *(rooms board → order ticket → post to folio → settle → receipt)*
**Deliverables:**
- Rooms as **entities** on an **Automatic** entity board, state-colored; tap opens/creates the room's open ticket.
- Three-zone **Order Ticket** (data-driven category rail + product grid; portions + order tags; qty increment + keypad multiplier).
- **Folio ledger** (`accounts`, `folios`, `folio_lines`) append-only; balance as a view.
- **Settle screen** with Cash + **ROOM CHARGE** tender (writes a CHARGE with idempotency key; two-factor room+name guard).
- **Receipt printing** via ePOS-Print (or window.print fallback) — receipt + basic KOT submit.
- **Standalone (no-PMS) mode** only; single property.
- Basic Work Period open/close.

**Exit criteria:** a server can seat a room, ring items, post to the folio, settle by cash or room-charge, and print a receipt — end to end, single terminal, idempotent posting proven by a retry test.

### Phase 2 — Check-in/out, room status, realtime
- Reservation stub + **check-in** (open folio, FO Vacant→Occupied) / **check-out** (settle-to-zero, non-zero block, room/HK flip).
- **Room-status board** (FO/HK/AVAIL) + `room_status_log`.
- **Realtime Broadcast-from-triggers** for entity-state/ticket fan-out + Presence; **ticket locking/optimistic concurrency** with "locked by X".
- **Custom floor-plan** entity-screen designer (SVG background + positioned rooms).

### Phase 3 — Payments & KDS
- Semi-integrated **card payments** (server-driven cloud reader), refunds/webhooks server-side; split payments (amount/equal/item), quick-cash chips.
- **Cash drawer sessions** + movements (over/short).
- **KDS** view with bump/recall, age-timing, per-department routing; **local print agent** for kitchen/mixed hardware.
- **Automation commands** hardened: Void vs Cancel, Discount/Service/Tax calculations, Gift/Comp, Change Price, Move/Transfer, Split/Merge — permission-gated with manager-PIN re-auth and `event_log`.

### Phase 4 — PMS adapters
- **PmsAdapter** boundary + `folio_postings` outbox (idempotent, retriable, reconcilable).
- **Apaleo** adapter first (free sandbox) → **Mews**, **Cloudbeds** → **Opera/OHIP** (metered, cache-heavy).
- Folio **transfer/split** between windows (guest vs company), City-Ledger/AR.
- **Three-way reconciliation** reporting.

### Phase 5 — Night audit & reporting
- **Idempotent, restartable Night Audit** (verify outlets closed → post room-night + occupancy tax to in-house folios → no-shows → **roll business date** → trial-balance snapshot), with `night_audit_runs` linking created lines for reversible re-run.
- Manager/Reports: X/Z, sales by department/outlet, tender mix, void/comp/discount trail, drawer over/short, folio/AR aging.
- **Business-date** discipline across all financial rows.

### Phase 6 — Multi-property & admin hardening
- Full **Admin/Menu-Builder** (menus, entities/states/screens, printers/routes, payment/tax/discount, terminals/users/roles, feature flags, PMS config).
- Multi-property rollout tooling, per-property feature flags, RBAC UI gates in parity with RLS.
- Load-test Realtime; region/read-replica considerations for dispersed properties.

### Phase 7 — Offline hardening (& optional native shell)
- Full outbox/event-sourcing hardening, conflict UX, queued-charge folio-status revalidation, reconnect reconciliation.
- **Capacitor native shell** for any terminal that must take **cards offline** (native Terminal SDK).
- Fiscalization middleware where required by operating country.
- Playwright E2E incl. **offline simulation** + **multi-terminal concurrency**; hardware smoke-test lab (real reader + real Epson) before each rollout.

---

## 9. Open Questions to Confirm with the Client

1. **SambaPOS screenshots & exact layout.** Screenshots are pending — we need the current button positions, colors, category structure, and function-button placement to lock the skeletons faithfully.
2. **Configurability vs hardcoding.** How much must be **admin-configurable** (menus, buttons, entity states, automation commands, tax/discount) vs hardcoded for this hotel? This single decision most affects scope (§1 risk).
3. **PMS — which one(s), and master vs satellite?** Which PMS do the properties run (Opera/OHIP, Mews, Cloudbeds, Apaleo, protel, RoomRaccoon, other)? Is the POS the **master of the folio** or a **satellite**? Any properties with **no PMS** (standalone mode)?
4. **Offline requirements per property.** Which properties have unreliable connectivity, and must **any** of them take **card payments while offline** (→ Capacitor native shell, added budget)? Cash/room-charge offline is assumed in-scope.
5. **Payments provider & readers.** Existing Stripe/Adyen relationship? Preferred reader hardware? Any legacy terminals to integrate?
6. **Printing hardware.** Can we standardize on **Epson TM network** printers? Current kitchen printer brands/connections and station layout?
7. **Fiscalization / legal.** Which countries do the hotels operate in? Any certified-receipt/fiscalization mandates (DE TSE, IT, FR, PT, AT), sequential invoicing, or audit-trail rules?
8. **Business-date & night-audit cutoff.** What is each property's audit cut-off time and time zone? Who runs night audit, and is it currently automated?
9. **Room model & states.** Confirm the room-state vocabulary and colors (FO/HK/AVAIL combinations), room types, floors/wings, and whether housekeeping status is owned here or in the PMS.
10. **Folio complexity.** Do we need **master/group folios**, **split windows** (guest-pay vs company-pay), **City Ledger/AR**, tax-exempt (gov/diplomat), and comp/house-use rooms in v1 or a later phase?
11. **Outlets & routing.** Full list of revenue centers (Restaurant, Bar, Room Service, Minibar, Spa, Laundry…), which are **postable-to-room**, and their GL/department codes and tax classes.
12. **Roles & authorization.** Confirm the permission matrix (server/cashier/manager/night-auditor/admin) and whether manager approvals use **PIN** (and any biometric expectation from the current DigitotPOS/DigitalPersona setup).
13. **Terminals & scale.** How many properties, terminals per property, target tablet hardware/resolution/orientation, and network topology (for the print agent + realtime load)?
14. **Data residency / PII.** Any GDPR/region constraints on where guest data lives and retention limits?
15. **Migration & go-live.** Do we import existing menus/rooms/guests from SambaPOS/the PMS, and is there a parallel-run expectation before cutover?
