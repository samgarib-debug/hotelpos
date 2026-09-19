// Core domain types for HotelPOS — Phase 1 (standalone folio mode).
// Mirrors docs/DESIGN.md §3, trimmed to what Phase 1 needs.

export type UUID = string

export type FOState = 'VACANT' | 'OCCUPIED'
export type HKState = 'CLEAN' | 'DIRTY' | 'INSPECTED'
export type AvailState = 'IN_SERVICE' | 'OOO'

export interface Room {
  id: UUID
  number: string // display name, e.g. "101"
  floor: number
  wing?: string
  roomType: string // Standard / Deluxe / Suite ...
  fo: FOState
  hk: HKState
  avail: AvailState
  guestName?: string
  checkoutDate?: string // ISO date
  folioId?: UUID // open folio (present when OCCUPIED)
  openTicketId?: UUID // current open outlet ticket, if any
}

export interface Category {
  id: UUID
  name: string
  color: string // hex
  sortOrder: number
}

export interface Product {
  id: UUID
  categoryId: UUID
  name: string
  price: number
  color?: string
  taxRate?: number // overrides property default when set
}

export type OrderLineState = 'NEW' | 'SUBMITTED' | 'VOID'

export interface OrderLine {
  id: UUID
  productId: UUID
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
  state: OrderLineState
  note?: string
}

export type TicketState = 'OPEN' | 'SETTLED' | 'VOID'
export type TicketType = 'ROOM' | 'WALK_IN'

export interface Ticket {
  id: UUID
  number: string
  roomId?: UUID
  type: TicketType
  state: TicketState
  lines: OrderLine[]
  discountPct: number
  openedAt: string
  closedAt?: string
}

export type FolioLineType =
  | 'CHARGE'
  | 'PAYMENT'
  | 'ADJUSTMENT'
  | 'CORRECTION'

export interface FolioLine {
  id: UUID
  folioId: UUID
  type: FolioLineType
  description: string
  amount: number // SIGNED: charge +, payment/credit -
  businessDate: string
  postedAt: string
  sourceRef?: string // ticket id, etc.
  idempotencyKey: string
  isReversed: boolean
  reversalOfId?: UUID
}

export type FolioStatus = 'OPEN' | 'SETTLED' | 'CLOSED'

export interface Folio {
  id: UUID
  folioNumber: string
  roomId: UUID
  guestName: string
  status: FolioStatus
  openedAt: string
  closedAt?: string
}

export type PaymentKind = 'CASH' | 'CARD' | 'ROOM_CHARGE' | 'COMP'

export interface Payment {
  id: UUID
  kind: PaymentKind
  amount: number
  tendered?: number
  change?: number
  ticketId?: UUID
  folioId?: UUID
  createdAt: string
  idempotencyKey: string
}

export interface PropertyConfig {
  propertyName: string
  currency: string
  currencySymbol: string
  taxRate: number // e.g. 0.10
  taxInclusive: boolean
  serviceRate: number // e.g. 0 or 0.10
  businessDate: string // ISO date
}

export interface TicketTotals {
  subtotal: number
  discount: number
  service: number
  tax: number
  grandTotal: number
}

// ---- Phase 2: clients, bookings & reservations ----

export interface Client {
  id: string
  name: string
  phone?: string
  email?: string
  idNumber?: string
  notes?: string
  createdAt: string
}

/** BOOKING = prepaid & guaranteed. RESERVATION = hold, pay at check-in. */
export type BookingKind = 'BOOKING' | 'RESERVATION'
export type StayMode = 'NIGHTLY' | 'TIMED'
export type BookingStatus =
  | 'RESERVED'
  | 'BOOKED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW'

export interface Booking {
  id: string
  ref: string
  kind: BookingKind
  status: BookingStatus
  clientId: string
  roomId: string
  mode: StayMode
  start: string // ISO datetime (arrival / slot start)
  end: string // ISO datetime (departure / slot end)
  nights?: number // for NIGHTLY
  rate: number // nightly rate (NIGHTLY) or flat basis (TIMED)
  total: number
  amountPaid: number
  paymentKind?: PaymentKind
  folioId?: string
  notes?: string
  createdAt: string
}
