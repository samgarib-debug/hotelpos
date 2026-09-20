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
served through `AuthGate` → `useAuth()`. Note: action-level rules are enforced in the
UI — hard server-side enforcement per action (e.g. via RPCs) is future hardening.

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
