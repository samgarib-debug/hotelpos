import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type {
  Booking,
  BookingKind,
  BookingStatus,
  Category,
  Client,
  Folio,
  FolioLine,
  Payment,
  PaymentKind,
  Product,
  PropertyConfig,
  Room,
  StayMode,
  Ticket,
} from '../types'
import { computeTotals, round2 } from '../lib/money'
import { overlaps, ymd } from '../lib/date'
import { supabaseEnabled } from '../lib/supabase'
import { settlementRpc } from '../lib/rpc'
import { applyServerConfig, reportSyncError, syncActive } from '../lib/sync'

/** Server-priced settlement path: only when the backend is configured AND
 *  sync actually started. */
const online = () => supabaseEnabled && syncActive()

/** A backend-configured till whose sync is NOT running (backend unreachable,
 *  uninitialised, or still connecting). Money must not be recorded in this
 *  state: local writes would be silently erased by the next hydrate, leaving
 *  cash in the drawer with no record anywhere. Offline/desktop builds
 *  (supabaseEnabled=false) are unaffected and keep full local behavior. */
const degraded = () => supabaseEnabled && !syncActive()
const DEGRADED_MSG =
  'Backend not connected — the till cannot record this right now. ' +
  'Try again in a moment, or reload the till once the connection is back.'
import {
  buildSeed,
  seedCategories,
  seedConfig,
  seedProducts,
  todayISO,
} from '../data/seed'

export interface NewBookingInput {
  kind: BookingKind
  roomId: string
  mode: StayMode
  start: string
  end: string
  nights?: number
  rate: number
  total: number
  client: {
    name: string
    phone?: string
    email?: string
    idNumber?: string
    notes?: string
  }
  /** When set, reuse this existing client instead of creating a new record
   *  (returning guest picked from the database); the record is refreshed with
   *  any edited details. */
  clientId?: string
  paymentKind?: PaymentKind // required when kind === 'BOOKING' (prepaid)
  notes?: string
}

export interface LastSettlement {
  ticketId: string
  kind: PaymentKind
  amount: number
  tendered?: number
  change?: number
  at: string
}

interface PosState {
  // domain
  config: PropertyConfig
  workPeriodOpen: boolean
  rooms: Room[]
  categories: Category[]
  products: Product[]
  tickets: Record<string, Ticket>
  folios: Record<string, Folio>
  folioLines: FolioLine[] // append-only
  payments: Payment[]
  clients: Client[]
  bookings: Booking[]
  seq: number

  // transient UI/session (not persisted)
  activeRoomId?: string
  activeTicketId?: string
  activeCategoryId?: string
  lastSettlement?: LastSettlement

  // actions
  openWorkPeriod: () => void
  closeWorkPeriod: () => void
  setActiveCategory: (categoryId: string) => void
  selectRoom: (roomId: string) => void
  clearActive: () => void
  addProduct: (productId: string) => void
  setLineQty: (lineId: string, qty: number) => void
  voidLine: (lineId: string) => void
  setDiscount: (pct: number) => void
  submitTicket: () => void
  settleTicket: (
    kind: PaymentKind,
    opts?: { tendered?: number },
  ) => Promise<LastSettlement | { error: string }>
  checkInRoom: (
    roomId: string,
    guestName: string,
    nights: number,
    nightlyRate: number,
  ) => void
  postFolioPayment: (
    folioId: string,
    kind: PaymentKind,
    amount: number,
  ) => Promise<{ ok: true } | { error: string }>
  checkOutRoom: (roomId: string) => Promise<{ ok: true } | { error: string }>
  setRoomHousekeeping: (roomId: string, hk: Room['hk']) => void
  // Phase 2: bookings & reservations
  isRoomAvailable: (
    roomId: string,
    startISO: string,
    endISO: string,
    excludeId?: string,
  ) => boolean
  createBooking: (input: NewBookingInput) => Booking | { error: string }
  /** Update a stored client's details (returning-guest edits). */
  updateClient: (id: string, patch: Partial<Omit<Client, 'id' | 'createdAt'>>) => void
  cancelBooking: (id: string) => void
  checkInBooking: (id: string) => Promise<{ ok: true } | { error: string }>
  checkOutBooking: (id: string) => Promise<{ ok: true } | { error: string }>
  /** Retry posting a booking's prepaid credit (idempotent server-side) —
   *  used when the credit RPC failed during check-in. */
  applyPrepaidCredit: (
    bookingId: string,
    folioId: string,
  ) => Promise<{ ok: true } | { error: string }>
  /** End of Day: server snapshots the trading period into day_closures and
   *  rolls the business date. Returns the closure row (the Z-report). */
  closeDay: () => Promise<{ ok: true; closure: DayClosure } | { error: string }>
  reseed: () => void
}

/** Snake_case row from run_end_of_day / the day_closures table. */
export interface DayClosure {
  business_date: string
  period_start: string
  period_end: string
  cash_total: number
  cash_count: number
  card_total: number
  card_count: number
  room_charge_total: number
  room_charge_count: number
  comp_total: number
  comp_count: number
  tickets_settled: number
  approvals_count: number
  open_folio_total: number
  open_folio_count: number
  closed_at: string
}

/** Folio balance = sum of non-reversed signed lines. */
export function folioBalance(lines: FolioLine[], folioId: string): number {
  return round2(
    lines
      .filter((l) => l.folioId === folioId && !l.isReversed)
      .reduce((s, l) => s + l.amount, 0),
  )
}

function nowISO() {
  return new Date().toISOString()
}

function initialDomain() {
  const { rooms, folios, folioLines, clients, bookings, tickets, payments } = buildSeed()
  return {
    config: { ...seedConfig, businessDate: todayISO() },
    workPeriodOpen: true,
    rooms,
    categories: seedCategories,
    products: seedProducts,
    tickets,
    folios,
    folioLines,
    payments,
    clients,
    bookings,
    seq: 1000,
  }
}

export const usePos = create<PosState>()(
  persist(
    (set, get) => ({
      ...initialDomain(),
      activeRoomId: undefined,
      activeTicketId: undefined,
      activeCategoryId: undefined,
      lastSettlement: undefined,

      openWorkPeriod: () => set({ workPeriodOpen: true }),
      closeWorkPeriod: () => set({ workPeriodOpen: false }),

      setActiveCategory: (categoryId) => set({ activeCategoryId: categoryId }),

      selectRoom: (roomId) => {
        const s = get()
        const room = s.rooms.find((r) => r.id === roomId)
        if (!room) return

        let ticketId = room.openTicketId
        const existing = ticketId ? s.tickets[ticketId] : undefined
        if (!existing || existing.state !== 'OPEN') {
          // create a fresh open ticket for this room
          const seq = s.seq + 1
          ticketId = nanoid()
          const ticket: Ticket = {
            id: ticketId,
            number: `T${seq}`,
            roomId,
            type: 'ROOM',
            state: 'OPEN',
            lines: [],
            discountPct: 0,
            openedAt: nowISO(),
          }
          set({
            seq,
            tickets: { ...s.tickets, [ticketId]: ticket },
            rooms: s.rooms.map((r) =>
              r.id === roomId ? { ...r, openTicketId: ticketId } : r,
            ),
          })
        }

        set({
          activeRoomId: roomId,
          activeTicketId: ticketId,
          activeCategoryId:
            get().activeCategoryId ?? s.categories[0]?.id,
        })
      },

      clearActive: () =>
        set({ activeRoomId: undefined, activeTicketId: undefined }),

      addProduct: (productId) => {
        const s = get()
        const tid = s.activeTicketId
        if (!tid) return
        const ticket = s.tickets[tid]
        const product = s.products.find((p) => p.id === productId)
        if (!ticket || !product) return

        const idx = ticket.lines.findIndex(
          (l) => l.productId === productId && l.state === 'NEW',
        )
        let lines
        if (idx >= 0) {
          lines = ticket.lines.map((l, i) =>
            i === idx
              ? {
                  ...l,
                  qty: l.qty + 1,
                  lineTotal: round2((l.qty + 1) * l.unitPrice),
                }
              : l,
          )
        } else {
          lines = [
            ...ticket.lines,
            {
              id: nanoid(),
              productId,
              name: product.name,
              qty: 1,
              unitPrice: product.price,
              lineTotal: round2(product.price),
              state: 'NEW' as const,
            },
          ]
        }
        set({ tickets: { ...s.tickets, [tid]: { ...ticket, lines } } })
      },

      setLineQty: (lineId, qty) => {
        const s = get()
        const tid = s.activeTicketId
        if (!tid) return
        const ticket = s.tickets[tid]
        if (!ticket) return
        let lines = ticket.lines
        const line = lines.find((l) => l.id === lineId)
        if (!line) return
        // Submitted lines are locked (server enforces this too): void + re-add.
        if (line.state !== 'NEW') return
        if (qty <= 0 && line.state === 'NEW') {
          lines = lines.filter((l) => l.id !== lineId)
        } else {
          const q = Math.max(1, qty)
          lines = lines.map((l) =>
            l.id === lineId
              ? { ...l, qty: q, lineTotal: round2(q * l.unitPrice) }
              : l,
          )
        }
        set({ tickets: { ...s.tickets, [tid]: { ...ticket, lines } } })
      },

      voidLine: (lineId) => {
        const s = get()
        const tid = s.activeTicketId
        if (!tid) return
        const ticket = s.tickets[tid]
        if (!ticket) return
        const line = ticket.lines.find((l) => l.id === lineId)
        if (!line) return
        const lines =
          line.state === 'NEW'
            ? ticket.lines.filter((l) => l.id !== lineId)
            : ticket.lines.map((l) =>
                l.id === lineId ? { ...l, state: 'VOID' as const } : l,
              )
        set({ tickets: { ...s.tickets, [tid]: { ...ticket, lines } } })
      },

      setDiscount: (pct) => {
        const s = get()
        const tid = s.activeTicketId
        if (!tid) return
        const ticket = s.tickets[tid]
        if (!ticket) return
        set({
          tickets: {
            ...s.tickets,
            [tid]: { ...ticket, discountPct: Math.min(1, Math.max(0, pct)) },
          },
        })
      },

      submitTicket: () => {
        const s = get()
        const tid = s.activeTicketId
        if (!tid) return
        const ticket = s.tickets[tid]
        if (!ticket) return
        const lines = ticket.lines.map((l) =>
          l.state === 'NEW' ? { ...l, state: 'SUBMITTED' as const } : l,
        )
        set({ tickets: { ...s.tickets, [tid]: { ...ticket, lines } } })
      },

      settleTicket: async (kind, opts) => {
        if (degraded()) return { error: DEGRADED_MSG }
        const s = get()
        const tid = s.activeTicketId
        if (!tid) return { error: 'No active ticket' }
        const ticket = s.tickets[tid]
        if (!ticket) return { error: 'Ticket not found' }

        if (online()) {
          // Server-priced: the RPC prices the ticket from the products
          // catalog, records the payment and settles — we merge its rows.
          const res = await settlementRpc('settle_ticket', {
            p_ticket_id: tid,
            p_kind: kind,
            p_tendered: opts?.tendered ?? null,
          })
          if (res.error) return { error: res.error }
          const tot = res.data?.totals ?? {}
          const settlement: LastSettlement = {
            ticketId: tid,
            kind,
            amount: Number(tot.grandTotal ?? 0),
            tendered: tot.tendered != null ? Number(tot.tendered) : undefined,
            change: tot.change != null ? Number(tot.change) : undefined,
            at: nowISO(),
          }
          set({ lastSettlement: settlement })
          return settlement
        }

        const totals = computeTotals(ticket, s.config)
        const grandTotal = totals.grandTotal
        if (grandTotal <= 0) return { error: 'Nothing to settle' }

        const room = ticket.roomId
          ? s.rooms.find((r) => r.id === ticket.roomId)
          : undefined

        const key = nanoid()
        const newFolioLines = [...s.folioLines]
        if (kind === 'ROOM_CHARGE') {
          if (!room?.folioId) {
            return {
              error:
                'Room has no open folio. Check the guest in first, or settle by cash/card.',
            }
          }
          const folio = s.folios[room.folioId]
          if (!folio || folio.status !== 'OPEN') {
            return { error: 'Folio is not open' }
          }
          // append-only CHARGE line, idempotency key guards double-post
          if (!newFolioLines.some((l) => l.idempotencyKey === `ticket-${tid}`)) {
            newFolioLines.push({
              id: nanoid(),
              folioId: room.folioId,
              type: 'CHARGE',
              description: `${ticket.number} — ${room.number} outlet charge`,
              amount: grandTotal,
              businessDate: s.config.businessDate,
              postedAt: nowISO(),
              sourceRef: tid,
              idempotencyKey: `ticket-${tid}`,
              isReversed: false,
            })
          }
        }

        const payment: Payment = {
          id: nanoid(),
          kind,
          amount: grandTotal,
          tendered: opts?.tendered,
          change:
            opts?.tendered != null
              ? round2(opts.tendered - grandTotal)
              : undefined,
          ticketId: tid,
          folioId: kind === 'ROOM_CHARGE' ? room?.folioId : undefined,
          createdAt: nowISO(),
          idempotencyKey: key,
        }

        const settlement: LastSettlement = {
          ticketId: tid,
          kind,
          amount: grandTotal,
          tendered: payment.tendered,
          change: payment.change,
          at: nowISO(),
        }

        set({
          folioLines: newFolioLines,
          payments: [...s.payments, payment],
          tickets: {
            ...s.tickets,
            [tid]: { ...ticket, state: 'SETTLED', closedAt: nowISO() },
          },
          rooms: room
            ? s.rooms.map((r) =>
                r.id === room.id ? { ...r, openTicketId: undefined } : r,
              )
            : s.rooms,
          lastSettlement: settlement,
        })
        return settlement
      },

      checkInRoom: (roomId, guestName, nights, nightlyRate) => {
        if (degraded()) {
          reportSyncError('folios', DEGRADED_MSG)
          return
        }
        const s = get()
        const room = s.rooms.find((r) => r.id === roomId)
        if (!room || room.fo === 'OCCUPIED') return
        const folioId = nanoid()
        const co = new Date()
        co.setDate(co.getDate() + nights)
        const folio: Folio = {
          id: folioId,
          folioNumber: `F-${room.number}-${s.seq + 1}`,
          roomId,
          guestName,
          status: 'OPEN',
          openedAt: nowISO(),
        }
        const stayAmount = round2(nights * nightlyRate)
        const roomNight: FolioLine = {
          id: nanoid(),
          folioId,
          type: 'CHARGE',
          description: `Room charge x${nights} night(s) — ${room.roomType}`,
          amount: stayAmount,
          businessDate: s.config.businessDate,
          postedAt: nowISO(),
          sourceRef: 'ROOM_NIGHT',
          idempotencyKey: nanoid(),
          isReversed: false,
        }
        set({
          seq: s.seq + 1,
          folios: { ...s.folios, [folioId]: folio },
          // zero-rate stays post no charge (the DB only accepts positive ones)
          folioLines: stayAmount > 0 ? [...s.folioLines, roomNight] : s.folioLines,
          rooms: s.rooms.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  fo: 'OCCUPIED',
                  hk: 'CLEAN',
                  guestName,
                  checkoutDate: co.toISOString().slice(0, 10),
                  folioId,
                }
              : r,
          ),
        })
      },

      postFolioPayment: async (folioId, kind, amount) => {
        if (degraded()) return { error: DEGRADED_MSG }
        const s = get()
        if (amount <= 0) return { error: 'Payment amount must be positive' }

        if (online()) {
          // Server-validated: positive, folio open, capped at the ledger balance.
          const res = await settlementRpc('post_folio_payment', {
            p_folio_id: folioId,
            p_kind: kind,
            p_amount: round2(amount),
          })
          if (res.error) return { error: res.error }
          return { ok: true as const }
        }

        const line: FolioLine = {
          id: nanoid(),
          folioId,
          type: 'PAYMENT',
          description: `Payment — ${kind}`,
          amount: -round2(amount),
          businessDate: s.config.businessDate,
          postedAt: nowISO(),
          idempotencyKey: nanoid(),
          isReversed: false,
        }
        const payment: Payment = {
          id: nanoid(),
          kind,
          amount: round2(amount),
          folioId,
          createdAt: nowISO(),
          idempotencyKey: nanoid(),
        }
        set({
          folioLines: [...s.folioLines, line],
          payments: [...s.payments, payment],
        })
        return { ok: true as const }
      },

      checkOutRoom: async (roomId) => {
        if (degraded()) return { error: DEGRADED_MSG }
        const room = get().rooms.find((r) => r.id === roomId)
        if (!room?.folioId) return { error: 'No open folio for this room' }

        if (online()) {
          // The RPC verifies the ledger balance is zero and closes the folio;
          // its updated folio row is merged, so only rooms/bookings remain.
          const res = await settlementRpc('close_folio', { p_folio_id: room.folioId })
          if (res.error) return { error: res.error }
        } else {
          const bal = folioBalance(get().folioLines, room.folioId)
          if (bal > 0.001) {
            return {
              error: `Folio balance is ${bal.toFixed(2)}. Settle to zero before check-out.`,
            }
          }
        }

        const s = get()
        const folio = s.folios[room.folioId]
        set({
          folios:
            !online() && folio
              ? {
                  ...s.folios,
                  [folio.id]: { ...folio, status: 'CLOSED', closedAt: nowISO() },
                }
              : s.folios,
          rooms: s.rooms.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  fo: 'VACANT',
                  hk: 'DIRTY',
                  guestName: undefined,
                  checkoutDate: undefined,
                  folioId: undefined,
                  openTicketId: undefined,
                }
              : r,
          ),
          // keep any in-house booking for this room in sync
          bookings: s.bookings.map((b) =>
            b.roomId === roomId && b.status === 'CHECKED_IN'
              ? { ...b, status: 'CHECKED_OUT' }
              : b,
          ),
        })
        return { ok: true }
      },

      setRoomHousekeeping: (roomId, hk) =>
        set((s) => ({
          rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, hk } : r)),
        })),

      isRoomAvailable: (roomId, startISO, endISO, excludeId) => {
        const active: BookingStatus[] = ['RESERVED', 'BOOKED', 'CHECKED_IN']
        return !get().bookings.some(
          (b) =>
            b.id !== excludeId &&
            b.roomId === roomId &&
            active.includes(b.status) &&
            overlaps(startISO, endISO, b.start, b.end),
        )
      },

      createBooking: (input) => {
        if (degraded()) return { error: DEGRADED_MSG }
        const s = get()
        if (input.end <= input.start) return { error: 'End must be after start.' }
        if (!s.isRoomAvailable(input.roomId, input.start, input.end)) {
          return { error: 'That room is already booked for the selected dates/times.' }
        }
        if (input.kind === 'BOOKING' && !input.paymentKind) {
          return { error: 'A booking is prepaid — choose a payment method.' }
        }

        const seq = s.seq + 1
        // Returning guest: reuse the existing client record (refreshed with any
        // edited details) instead of creating a duplicate. New guest: enroll.
        const existing = input.clientId
          ? s.clients.find((c) => c.id === input.clientId)
          : undefined
        const clientId = existing ? existing.id : nanoid()
        const client: Client = {
          id: clientId,
          name: input.client.name.trim(),
          phone: input.client.phone?.trim() || undefined,
          email: input.client.email?.trim() || undefined,
          idNumber: input.client.idNumber?.trim() || undefined,
          notes: input.client.notes?.trim() || undefined,
          createdAt: existing ? existing.createdAt : nowISO(),
        }
        const clients = existing
          ? s.clients.map((c) => (c.id === clientId ? client : c))
          : [...s.clients, client]

        const kind = input.kind
        const status: BookingStatus = kind === 'BOOKING' ? 'BOOKED' : 'RESERVED'
        const amountPaid = kind === 'BOOKING' ? round2(input.total) : 0

        const booking: Booking = {
          id: nanoid(),
          ref: `${kind === 'BOOKING' ? 'BK' : 'RS'}${seq}`,
          kind,
          status,
          clientId,
          roomId: input.roomId,
          mode: input.mode,
          start: input.start,
          end: input.end,
          nights: input.nights,
          rate: round2(input.rate),
          total: round2(input.total),
          amountPaid,
          paymentKind: input.paymentKind,
          notes: input.notes?.trim() || undefined,
          createdAt: nowISO(),
        }

        // Prepaid deposit recorded as a Payment (not yet on a folio).
        // Online, the server records it from the booking row (RPC below).
        const payments =
          kind === 'BOOKING' && input.paymentKind && !online()
            ? [
                ...s.payments,
                {
                  id: nanoid(),
                  kind: input.paymentKind,
                  amount: round2(input.total),
                  createdAt: nowISO(),
                  idempotencyKey: `booking-deposit-${booking.id}`,
                } as Payment,
              ]
            : s.payments

        set({
          seq,
          clients,
          bookings: [...s.bookings, booking],
          payments,
        })
        if (kind === 'BOOKING' && input.paymentKind && online()) {
          void settlementRpc('record_booking_deposit', { p_booking_id: booking.id }).then(
            (res) => {
              if (res.error)
                reportSyncError('payments', `Booking deposit not recorded: ${res.error}`)
            },
          )
        }
        return booking
      },

      updateClient: (id, patch) =>
        set((s) => ({
          clients: s.clients.map((c) =>
            c.id === id
              ? {
                  ...c,
                  ...('name' in patch ? { name: patch.name?.trim() || c.name } : {}),
                  ...('phone' in patch ? { phone: patch.phone?.trim() || undefined } : {}),
                  ...('email' in patch ? { email: patch.email?.trim() || undefined } : {}),
                  ...('idNumber' in patch ? { idNumber: patch.idNumber?.trim() || undefined } : {}),
                  ...('notes' in patch ? { notes: patch.notes?.trim() || undefined } : {}),
                }
              : c,
          ),
        })),

      cancelBooking: (id) =>
        set((s) => ({
          bookings: s.bookings.map((b) =>
            b.id === id && (b.status === 'RESERVED' || b.status === 'BOOKED')
              ? { ...b, status: 'CANCELLED' }
              : b,
          ),
        })),

      checkInBooking: async (id) => {
        if (degraded()) return { error: DEGRADED_MSG }
        const s = get()
        const b = s.bookings.find((x) => x.id === id)
        if (!b) return { error: 'Booking not found' }
        if (b.status !== 'RESERVED' && b.status !== 'BOOKED') {
          return { error: 'Only active reservations/bookings can be checked in.' }
        }
        const room = s.rooms.find((r) => r.id === b.roomId)
        if (!room) return { error: 'Room not found' }
        if (room.fo === 'OCCUPIED') return { error: 'Room is currently occupied.' }
        const client = s.clients.find((c) => c.id === b.clientId)
        const guestName = client?.name ?? 'Guest'

        const folioId = nanoid()
        const folio: Folio = {
          id: folioId,
          folioNumber: `F-${room.number}-${s.seq + 1}`,
          roomId: room.id,
          guestName,
          status: 'OPEN',
          openedAt: nowISO(),
        }

        const stayDesc =
          b.mode === 'NIGHTLY'
            ? `Room charge x${b.nights ?? 1} night(s) — ${room.roomType}`
            : `Room booking (day-use) — ${room.roomType}`

        const lines: FolioLine[] = []
        if (round2(b.total) > 0) {
          // zero-total stays post no charge (the DB only accepts positive ones)
          lines.push({
            id: nanoid(),
            folioId,
            type: 'CHARGE',
            description: stayDesc,
            amount: round2(b.total),
            businessDate: s.config.businessDate,
            postedAt: nowISO(),
            sourceRef: b.ref,
            idempotencyKey: `stay-${b.id}`,
            isReversed: false,
          })
        }
        // Online, the prepaid credit is posted server-side from the booking
        // row (post_prepaid_credit RPC below) — the ledger stays RPC-priced.
        if (b.amountPaid > 0 && !online()) {
          lines.push({
            id: nanoid(),
            folioId,
            type: 'PAYMENT',
            description: `Prepaid (${b.paymentKind ?? 'BOOKING'})`,
            amount: -round2(b.amountPaid),
            businessDate: s.config.businessDate,
            postedAt: nowISO(),
            sourceRef: b.ref,
            idempotencyKey: `prepaid-${b.id}`,
            isReversed: false,
          })
        }

        set({
          seq: s.seq + 1,
          folios: { ...s.folios, [folioId]: folio },
          folioLines: [...s.folioLines, ...lines],
          rooms: s.rooms.map((r) =>
            r.id === room.id
              ? {
                  ...r,
                  fo: 'OCCUPIED',
                  hk: 'CLEAN',
                  guestName,
                  checkoutDate: ymd(new Date(b.end)),
                  folioId,
                }
              : r,
          ),
          bookings: s.bookings.map((x) =>
            x.id === id ? { ...x, status: 'CHECKED_IN', folioId } : x,
          ),
        })
        if (b.amountPaid > 0 && online()) {
          const res = await settlementRpc('post_prepaid_credit', {
            p_booking_id: b.id,
            p_folio_id: folioId,
          })
          if (res.error) {
            return { error: `Checked in, but the prepaid credit failed to post: ${res.error}` }
          }
        }
        return { ok: true }
      },

      checkOutBooking: async (id) => {
        const s = get()
        const b = s.bookings.find((x) => x.id === id)
        if (!b) return { error: 'Booking not found' }
        if (b.status !== 'CHECKED_IN') return { error: 'Booking is not checked in.' }
        const res = await get().checkOutRoom(b.roomId)
        if ('error' in res) return res
        set((st) => ({
          bookings: st.bookings.map((x) =>
            x.id === id ? { ...x, status: 'CHECKED_OUT' } : x,
          ),
        }))
        return { ok: true }
      },

      applyPrepaidCredit: async (bookingId, folioId) => {
        if (degraded()) return { error: DEGRADED_MSG }
        if (!online()) return { error: 'Backend not connected' }
        const res = await settlementRpc('post_prepaid_credit', {
          p_booking_id: bookingId,
          p_folio_id: folioId,
        })
        if (res.error) return { error: res.error }
        return { ok: true as const }
      },

      closeDay: async () => {
        if (degraded()) return { error: DEGRADED_MSG }
        if (!supabaseEnabled) return { error: 'End of Day needs the online backend.' }
        // Name the date we're closing: a double-click race or a retry after a
        // lost response errors cleanly instead of closing the next day.
        const res = await settlementRpc('run_end_of_day', {
          p_business_date: get().config.businessDate,
        })
        if (res.error) return { error: res.error }
        applyServerConfig(res.data?.config)
        return { ok: true as const, closure: res.data?.day_closure as DayClosure }
      },

      reseed: () =>
        set({
          ...initialDomain(),
          activeRoomId: undefined,
          activeTicketId: undefined,
          activeCategoryId: undefined,
          lastSettlement: undefined,
        }),
    }),
    {
      name: 'hotelpos-v4',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({
        config: s.config,
        workPeriodOpen: s.workPeriodOpen,
        rooms: s.rooms,
        categories: s.categories,
        products: s.products,
        tickets: s.tickets,
        folios: s.folios,
        folioLines: s.folioLines,
        payments: s.payments,
        clients: s.clients,
        bookings: s.bookings,
        seq: s.seq,
      }),
    },
  ),
)
