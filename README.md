# HotelPOS

A custom, touch-first **hotel point of sale** for a multi-property hotel company —
a web app that reproduces the **SambaPOS / DigitotPOS** layout family but is
purpose-built for hotels: **rooms are selectable entities that carry a folio**, and
outlet charges (restaurant, bar, room service, minibar) **post to the room's folio**
and settle at check-out.

**Live demo:** https://hotelpos-demo.pages.dev (Cloudflare Pages · fresh seeded data per visitor)

> Full architecture, data model, and phased roadmap: [`docs/DESIGN.md`](docs/DESIGN.md).

Redeploy after changes: `npm run build && npx wrangler pages deploy dist --project-name hotelpos-demo`

## Status — Phase 1 (Standalone folio mode)

Our own append-only folio ledger is the source of truth; **no PMS** (that plugs in
later behind an adapter interface — see the design doc §6). Implemented:

- **Rooms board** — SambaPOS-style entity screen, state-colored buttons
  (vacant/occupied/checkout-due/dirty/OOO), floor filter, live folio balances.
- **Order ticket** — three-zone screen (ticket · category rail · product grid),
  quantity increment, per-line qty/void, ticket discount, submit/KOT, running
  subtotal/service/tax/total.
- **Folio ledger** — append-only `folioLines` (signed charges/payments); balance is
  always **derived**, never a mutable field. Charge posting is **idempotent**
  (keyed `ticket-<id>`).
- **Settle screen** — Cash (tender & change), Card (stub), **Room Charge** (posts to
  the guest folio behind a two-factor room+guest confirm), Comp; quick-cash chips +
  numeric keypad.
- **Check-in / check-out** — lightweight: open a folio + post the room-night charge
  on check-in; settle-to-zero + room flip (Occupied→Vacant/Dirty) on check-out.
- **Receipts** — white-paper receipt + folio statement, printable via the browser.
- **Work period** indicator, demo data reset.

Everything persists to `localStorage` (offline-friendly foundation); swap the store's
data layer for Supabase when the backend is provisioned (design doc §2, §3.10).

## Status — Phase 2 (Calendar, bookings & reservations)

- **Google-Calendar views** (`/`) — **Month / Week / Day** toggle. Month uses true
  **spanning bars** for multi-night stays (lane-stacked, with "+N more" overflow);
  Week/Day show an **all-day row** for stays plus an **hourly time-grid** for day-use
  bookings. Click a day (or a time slot) to add, click an event for detail.
- **Booking vs Reservation** — a **Booking is prepaid & guaranteed** (payment collected
  on creation); a **Reservation is a hold** (pay at check-in). Both supported for
  **nightly (date ranges)** and **day-use / hourly (time slots)**.
- **Availability guard** — a room can't be double-booked for overlapping dates/times.
- **Client capture** — name, phone, email, ID/passport, notes, stored per booking.
- **Check-in / check-out** from the calendar or bookings list — check-in opens the
  folio and posts the stay charge (crediting any prepayment); check-out settles to zero
  and flips the room to Vacant/Dirty. Room-status is reflected on the **Floor** board.
- **Open room charge** — from a checked-in booking, jump straight to the POS order
  screen for that room.
- **Bookings report** (`/bookings`) — filter by search, status, type, and date range;
  summary tiles for arrivals today, in-house, and revenue collected.

- **Reports** (`/reports`) — a full reporting section: Overview (occupancy, ADR, RevPAR,
  revenue), Revenue, Occupancy, POS Sales, Bookings, Payments, Folios and **Approvals**
  (the manager-PIN audit trail: attempts, failures, who requested and who approved,
  straight from the backend), each with KPI tiles, bar charts and tables, filterable
  by date range (today / 7d / 30d / month / custom).
- **Currency: South African Rand (ZAR / R), 15% VAT-inclusive.**

Navigation: left sidebar → **Calendar** · **Floor** (POS room board) · **Bookings** · **Reports** · **Staff**.

## Auth & roles

The hosted build is gated by **Supabase Auth** (staff sign-in; sessions persist). RLS
restricts every table to authenticated users — the public key gets `401`. Local/offline
builds carry no backend config and run without login, with full access.

Roles live in `public.profiles.role` (**staff → manager → admin**), constrained in the
database; the **first account ever created becomes admin**, later sign-ups start as
staff. Only admins can change roles (from the **Staff** screen), nobody can change
their own, and self role-escalation is blocked at the RLS layer.

| Capability | staff | manager | admin |
|---|---|---|---|
| Orders, settle, bookings, check-in/out | ✓ | ✓ | ✓ |
| Discounts, comps, void sent items, cancel bookings | | ✓ | ✓ |
| Reports, reset demo data | | ✓ | ✓ |
| Staff management (assign roles) | | | ✓ |

UI gating lives in `src/lib/permissions.ts` (`can(role, permission)`); the role is
served through `AuthGate` → `useAuth()`.

**Server-side enforcement** (`supabase/migrations/0005_server_enforcement.sql`):
the gated till actions are also enforced by database triggers, so a tampered client
with a staff JWT can't bypass the UI. Discount changes, voiding/editing/removing an
already-submitted ticket line, ticket voids/reopens (only OPEN→SETTLED is ungated),
COMP payments, and any off-path booking status change (cancel, no-show, un-cancel —
only check-in/check-out transitions are ungated) require the caller to be
manager/admin (`app_role()`) or to hold a fresh manager-PIN approval —
`verify_manager_pin` logs the approval and the guard trigger consumes it (one
approval = one action, 2-minute validity, race-safe via `FOR UPDATE SKIP LOCKED`).
Payments and folio ledger lines are append-only for staff (managers/admins may
correct them — this also lets *Reset demo data* re-date the seeded history), row
ids are immutable, closed folios can't be reopened by staff, state columns have
CHECK whitelists, ticket lines must be well-formed unique-id arrays, DELETE on
all app tables is manager/admin only, and PIN brute-force is capped (5 fails/
5 min + 20 fails/24 h per user + 50 fails/24 h property-wide, so throwaway
sign-ups can't reset the budget). Service-role writes (seed reloads, SQL editor)
bypass the guards. Failed pushes surface as a red banner at the till.

**Server-priced settlement** (`supabase/migrations/0007_settlement_rpcs.sql`):
money is written only by SECURITY DEFINER RPCs that price from server state —
`settle_ticket` prices the ticket from the **products catalog** (client line
prices are ignored), applies the gated discount and the config tax/service
rules, posts the folio charge and the payment, and settles; `post_folio_payment`
validates interim payments against the ledger balance; `post_prepaid_credit` /
`record_booking_deposit` take their amounts from the booking row (whose money
fields are locked after creation); `close_folio` verifies a zero balance at
check-out. The guards then close the direct staff paths: payment inserts,
folio PAYMENT/adjustment lines, ticket settle transitions and folio closes are
RPC-or-manager only; staff may still post positive CHARGEs (check-in room/stay
charges). The product catalog and the tax/service/currency config are
manager-only, and every payment and ledger line records `created_by`.
Offline/desktop builds keep the pure-local computation (no backend, no
triggers).

Known residuals: front-desk **attestations** — the check-in rate and a
booking's total/prepayment are typed in by staff at creation (the DB locks
them afterwards and records who wrote what, but no POS can verify cash
physically changed hands); a PIN approval authorizes an action *type* for
2 minutes, not one specific ticket. Also disable public sign-ups in the
Supabase dashboard once your staff accounts exist — any successful sign-up
gets staff-level data access.

**Manager PIN override at the till:** staff tapping a locked action (discount, comp,
void-after-KOT, cancel booking) get a PIN pad; a manager's PIN approves that single
action without switching accounts, with an "Approved by …" toast. Managers set their
own 4-6 digit PIN via Floor → ⚙ → *Set my manager PIN*. PINs are bcrypt-hashed
server-side (`verify_manager_pin` / `set_manager_pin` SECURITY DEFINER RPCs); the
hash is never readable by clients (column-level grant), 5 failed attempts per user
per 5 minutes are locked out, and every attempt is logged in `manager_approvals`
(readable by managers/admins). Local test tip: `VITE_DEFAULT_ROLE=staff` builds the
backend-free bundle as the staff experience.

## Tech stack

React + TypeScript + Vite · Tailwind CSS v4 · Zustand (persisted) · React Router.
Planned backend: Supabase (Postgres + Auth + Realtime + RLS) on Cloudflare Pages.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # type-check + production build
```

## Builds (offline bundle & desktop installer)

App icon (regenerates `build/icon.ico` from `build/icon.svg`):

```bash
node build/make-icon.mjs
```

Self-contained offline bundle (single inlined `index.html`, hash routing) into `dist-offline/`:

```bash
# blank the Supabase vars so a local .env.local doesn't leak the backend
# into the offline bundle (offline builds are local-only, no login)
VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= VITE_HASH=1 VITE_SINGLEFILE=1 \
  npx vite build --base=./ --outDir dist-offline
```

Windows desktop installer (Electron) — bundles the offline UI (the app icon
`desktop/build/icon.ico` is versioned in the repo):

```bash
# stage the built UI into the desktop app, then build the installer
cp -r dist-offline/* desktop/ui/
cd desktop && npm install && npm run dist   # -> desktop/release/HotelPOS Setup <v>.exe
```

> On a virtualized filesystem (e.g. VirtioFS) electron-builder's extract step can throw
> `EPERM` on a directory rename — build to a local NTFS path instead:
> `npm run dist -- --config.directories.output=C:\hotelpos-build`

**Automated:** pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which builds
the Windows installer on a runner and attaches it (plus the offline zip) to a GitHub Release.
Every push to `main` also auto-deploys the web app to Cloudflare Pages
(`.github/workflows/deploy.yml`).

## Project layout

```
src/
  types.ts             domain model (rooms, tickets, folio, payments)
  data/seed.ts         sample property: rooms, menu, occupied folios
  store/pos.ts         Zustand store — all POS actions + folio ledger
  lib/                 money math, room-state colors, classnames
  components/          RoomButton, Numpad, Modal, ReceiptView, dialogs
  screens/             RoomsBoard, OrderScreen, SettleScreen
docs/DESIGN.md         full architecture & roadmap
```

## Next (Phase 3+)

Realtime multi-terminal sync, drag-to-create / drag-to-resize on the calendar,
card payments (semi-integrated), KDS, then **PMS adapters** (Apaleo → Mews →
Cloudbeds → Opera/OHIP), night audit, and multi-property/RLS hardening.
