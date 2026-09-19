import type {
  Booking,
  Category,
  Folio,
  FolioLine,
  Payment,
  Product,
  PropertyConfig,
  Room,
  Ticket,
} from '../types'
import { computeTotals, round2 } from './money'

export interface DateRange {
  from: string // YYYY-MM-DD inclusive
  to: string // YYYY-MM-DD inclusive
}

const d10 = (s: string) => s.slice(0, 10)
const inRange = (iso: string, r: DateRange) => {
  const d = d10(iso)
  return d >= r.from && d <= r.to
}

function isRoomCharge(l: FolioLine): boolean {
  if (l.sourceRef === 'ROOM_NIGHT') return true
  return /^Room charge|^Room booking/.test(l.description)
}

export interface ReportData {
  rooms: {
    total: number
    occupied: number
    vacant: number
    dirty: number
    inspected: number
    ooo: number
    occupancyRate: number
    byType: { type: string; total: number; occupied: number }[]
  }
  revenue: {
    room: number
    pos: number
    total: number
    bySource: { name: string; amount: number }[]
    byCategory: { name: string; amount: number; color: string }[]
    adr: number
    revpar: number
  }
  pos: {
    ticketCount: number
    avgTicket: number
    topProducts: { name: string; qty: number; amount: number }[]
  }
  bookings: {
    total: number
    byStatus: { status: string; count: number }[]
    booking: number // prepaid count
    reservation: number // hold count
    newInRange: number
    cancelledInRange: number
    prepaidValue: number
    holdValue: number
    arrivals: { booking: Booking; name: string; room: string }[]
    departures: { booking: Booking; name: string; room: string }[]
  }
  payments: {
    total: number
    byKind: { kind: string; amount: number; count: number }[]
  }
  folios: {
    openCount: number
    outstanding: number
    list: { folio: Folio; room: string; guest: string; balance: number }[]
  }
}

export function buildReport(args: {
  rooms: Room[]
  bookings: Booking[]
  folios: Record<string, Folio>
  folioLines: FolioLine[]
  payments: Payment[]
  tickets: Record<string, Ticket>
  categories: Category[]
  products: Product[]
  config: PropertyConfig
  range: DateRange
}): ReportData {
  const { rooms, bookings, folios, folioLines, payments, tickets, categories, products, config, range } = args
  const productById = new Map(products.map((p) => [p.id, p]))
  const catById = new Map(categories.map((c) => [c.id, c]))
  const roomById = new Map(rooms.map((r) => [r.id, r]))

  // ---- Rooms / occupancy (current snapshot) ----
  const inService = rooms.filter((r) => r.avail !== 'OOO')
  const occupied = rooms.filter((r) => r.fo === 'OCCUPIED')
  const ooo = rooms.filter((r) => r.avail === 'OOO')
  const dirty = rooms.filter((r) => r.fo === 'VACANT' && r.hk === 'DIRTY')
  const inspected = rooms.filter((r) => r.fo === 'VACANT' && r.hk === 'INSPECTED')
  const vacant = rooms.filter((r) => r.fo === 'VACANT' && r.avail !== 'OOO')
  const typeSet = Array.from(new Set(rooms.map((r) => r.roomType)))
  const byType = typeSet.map((type) => ({
    type,
    total: rooms.filter((r) => r.roomType === type).length,
    occupied: rooms.filter((r) => r.roomType === type && r.fo === 'OCCUPIED').length,
  }))
  const occupancyRate = inService.length ? round2((occupied.length / inService.length) * 100) : 0

  // ---- Revenue ----
  const roomRevenue = round2(
    folioLines
      .filter((l) => l.type === 'CHARGE' && !l.isReversed && isRoomCharge(l) && inRange(l.businessDate, range))
      .reduce((s, l) => s + l.amount, 0),
  )

  const settledTickets = Object.values(tickets).filter(
    (t) => t.state === 'SETTLED' && t.closedAt && inRange(t.closedAt, range),
  )
  let posRevenue = 0
  const catAmount = new Map<string, number>()
  const prodAgg = new Map<string, { name: string; qty: number; amount: number }>()
  for (const t of settledTickets) {
    posRevenue += computeTotals(t, config).grandTotal
    for (const l of t.lines) {
      if (l.state === 'VOID') continue
      const p = productById.get(l.productId)
      const catId = p?.categoryId ?? 'other'
      catAmount.set(catId, round2((catAmount.get(catId) ?? 0) + l.lineTotal))
      const agg = prodAgg.get(l.productId) ?? { name: l.name, qty: 0, amount: 0 }
      agg.qty += l.qty
      agg.amount = round2(agg.amount + l.lineTotal)
      prodAgg.set(l.productId, agg)
    }
  }
  posRevenue = round2(posRevenue)
  const byCategory = Array.from(catAmount.entries())
    .map(([catId, amount]) => ({
      name: catById.get(catId)?.name ?? 'Other',
      amount,
      color: catById.get(catId)?.color ?? '#64748b',
    }))
    .sort((a, b) => b.amount - a.amount)
  const topProducts = Array.from(prodAgg.values()).sort((a, b) => b.amount - a.amount).slice(0, 10)

  const totalRevenue = round2(roomRevenue + posRevenue)
  const roomNights = occupied.length // snapshot approximation
  const adr = roomNights
    ? round2(
        occupied.reduce((s, r) => {
          const b = bookings.find((x) => x.roomId === r.id && x.status === 'CHECKED_IN')
          return s + (b?.rate ?? 0)
        }, 0) / roomNights,
      )
    : 0
  const revpar = inService.length ? round2((adr * occupied.length) / inService.length) : 0

  // ---- Bookings ----
  const statuses = ['RESERVED', 'BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW']
  const byStatus = statuses.map((s) => ({ status: s, count: bookings.filter((b) => b.status === s).length }))
  const nameFor = (b: Booking) => roomById.get(b.roomId)?.number ?? '—'
  const arrivals = bookings
    .filter((b) => inRange(b.start, range) && (b.status === 'RESERVED' || b.status === 'BOOKED' || b.status === 'CHECKED_IN'))
    .map((b) => ({ booking: b, name: '', room: nameFor(b) }))
  const departures = bookings
    .filter((b) => inRange(b.end, range) && (b.status === 'CHECKED_IN' || b.status === 'CHECKED_OUT'))
    .map((b) => ({ booking: b, name: '', room: nameFor(b) }))
  const activeForValue = bookings.filter((b) => b.status !== 'CANCELLED' && b.status !== 'NO_SHOW')

  // ---- Payments ----
  const payKinds = ['CASH', 'CARD', 'ROOM_CHARGE', 'COMP']
  const payInRange = payments.filter((p) => inRange(p.createdAt, range))
  const byKind = payKinds
    .map((kind) => {
      const list = payInRange.filter((p) => p.kind === kind)
      return { kind, amount: round2(list.reduce((s, p) => s + p.amount, 0)), count: list.length }
    })
    .filter((k) => k.count > 0 || k.amount > 0)
  const paymentsTotal = round2(payInRange.filter((p) => p.kind !== 'ROOM_CHARGE' && p.kind !== 'COMP').reduce((s, p) => s + p.amount, 0))

  // ---- Folios ----
  const openFolios = Object.values(folios).filter((f) => f.status === 'OPEN')
  const folioList = openFolios
    .map((f) => {
      const balance = round2(
        folioLines.filter((l) => l.folioId === f.id && !l.isReversed).reduce((s, l) => s + l.amount, 0),
      )
      return { folio: f, room: roomById.get(f.roomId)?.number ?? '—', guest: f.guestName, balance }
    })
    .sort((a, b) => b.balance - a.balance)
  const outstanding = round2(folioList.reduce((s, f) => s + f.balance, 0))

  return {
    rooms: {
      total: rooms.length,
      occupied: occupied.length,
      vacant: vacant.length,
      dirty: dirty.length,
      inspected: inspected.length,
      ooo: ooo.length,
      occupancyRate,
      byType,
    },
    revenue: {
      room: roomRevenue,
      pos: posRevenue,
      total: totalRevenue,
      bySource: [
        { name: 'Rooms', amount: roomRevenue },
        { name: 'Food & Beverage', amount: posRevenue },
      ],
      byCategory,
      adr,
      revpar,
    },
    pos: {
      ticketCount: settledTickets.length,
      avgTicket: settledTickets.length ? round2(posRevenue / settledTickets.length) : 0,
      topProducts,
    },
    bookings: {
      total: bookings.length,
      byStatus,
      booking: bookings.filter((b) => b.kind === 'BOOKING').length,
      reservation: bookings.filter((b) => b.kind === 'RESERVATION').length,
      newInRange: bookings.filter((b) => inRange(b.createdAt, range)).length,
      cancelledInRange: bookings.filter((b) => b.status === 'CANCELLED' && inRange(b.createdAt, range)).length,
      prepaidValue: round2(activeForValue.reduce((s, b) => s + b.amountPaid, 0)),
      holdValue: round2(
        activeForValue
          .filter((b) => b.status === 'RESERVED' || b.status === 'BOOKED')
          .reduce((s, b) => s + (b.total - b.amountPaid), 0),
      ),
      arrivals,
      departures,
    },
    payments: { total: paymentsTotal, byKind },
    folios: { openCount: openFolios.length, outstanding, list: folioList },
  }
}
