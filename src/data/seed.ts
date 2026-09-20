import type {
  Booking,
  Category,
  Client,
  Folio,
  FolioLine,
  OrderLine,
  Payment,
  Product,
  PropertyConfig,
  Room,
  Ticket,
} from '../types'
import { addDays, ymd } from '../lib/date'

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Default nightly rate (ZAR) by room type (used by check-in + booking dialogs). */
export const DEFAULT_RATE: Record<string, number> = {
  Standard: 1250,
  Deluxe: 1850,
  Suite: 3400,
  Penthouse: 6200,
}

export const seedConfig: PropertyConfig = {
  propertyName: 'Grand Harbour Hotel',
  currency: 'ZAR',
  currencySymbol: 'R',
  taxRate: 0.15, // South African VAT
  taxInclusive: true, // SA prices are quoted VAT-inclusive
  serviceRate: 0,
  businessDate: todayISO(),
}

export const seedCategories: Category[] = [
  { id: 'cat-restaurant', name: 'Restaurant', color: '#c9781a', sortOrder: 1 },
  { id: 'cat-bar', name: 'Bar', color: '#7c3aed', sortOrder: 2 },
  { id: 'cat-roomservice', name: 'Room Service', color: '#2563eb', sortOrder: 3 },
  { id: 'cat-breakfast', name: 'Breakfast', color: '#0d9488', sortOrder: 4 },
  { id: 'cat-minibar', name: 'Minibar', color: '#be123c', sortOrder: 5 },
]

// Prices in ZAR (VAT-inclusive)
export const seedProducts: Product[] = [
  // Restaurant
  { id: 'p-club', categoryId: 'cat-restaurant', name: 'Club Sandwich', price: 95 },
  { id: 'p-caesar', categoryId: 'cat-restaurant', name: 'Caesar Salad', price: 85 },
  { id: 'p-burger', categoryId: 'cat-restaurant', name: 'Beef Burger', price: 130 },
  { id: 'p-pizza', categoryId: 'cat-restaurant', name: 'Margherita Pizza', price: 120 },
  { id: 'p-salmon', categoryId: 'cat-restaurant', name: 'Grilled Salmon', price: 210 },
  { id: 'p-pasta', categoryId: 'cat-restaurant', name: 'Pasta Alfredo', price: 110 },
  { id: 'p-steak', categoryId: 'cat-restaurant', name: 'Steak Frites', price: 285 },
  { id: 'p-fries', categoryId: 'cat-restaurant', name: 'Fries', price: 45 },
  // Bar
  { id: 'p-redwine', categoryId: 'cat-bar', name: 'House Red (Glass)', price: 75 },
  { id: 'p-whitewine', categoryId: 'cat-bar', name: 'House White (Glass)', price: 75 },
  { id: 'p-beer', categoryId: 'cat-bar', name: 'Draft Beer', price: 45 },
  { id: 'p-gt', categoryId: 'cat-bar', name: 'Gin & Tonic', price: 85 },
  { id: 'p-oldfashioned', categoryId: 'cat-bar', name: 'Old Fashioned', price: 110 },
  { id: 'p-espmartini', categoryId: 'cat-bar', name: 'Espresso Martini', price: 115 },
  { id: 'p-soft', categoryId: 'cat-bar', name: 'Soft Drink', price: 30 },
  { id: 'p-sparkling', categoryId: 'cat-bar', name: 'Sparkling Water', price: 35 },
  // Room Service
  { id: 'p-rs-break', categoryId: 'cat-roomservice', name: 'RS Breakfast', price: 165 },
  { id: 'p-rs-club', categoryId: 'cat-roomservice', name: 'RS Club Sandwich', price: 125 },
  { id: 'p-rs-burger', categoryId: 'cat-roomservice', name: 'RS Burger', price: 150 },
  { id: 'p-rs-cheese', categoryId: 'cat-roomservice', name: 'Cheese Platter', price: 175 },
  { id: 'p-rs-tea', categoryId: 'cat-roomservice', name: 'Tea Pot', price: 45 },
  { id: 'p-rs-juice', categoryId: 'cat-roomservice', name: 'Fresh Juice', price: 45 },
  // Breakfast
  { id: 'p-bf-cont', categoryId: 'cat-breakfast', name: 'Continental', price: 145 },
  { id: 'p-bf-full', categoryId: 'cat-breakfast', name: 'Full English', price: 175 },
  { id: 'p-bf-pancakes', categoryId: 'cat-breakfast', name: 'Pancakes', price: 95 },
  { id: 'p-bf-omelette', categoryId: 'cat-breakfast', name: 'Omelette', price: 90 },
  { id: 'p-bf-avo', categoryId: 'cat-breakfast', name: 'Avocado Toast', price: 110 },
  { id: 'p-bf-coffee', categoryId: 'cat-breakfast', name: 'Coffee', price: 35 },
  // Minibar
  { id: 'p-mb-water', categoryId: 'cat-minibar', name: 'Water', price: 25 },
  { id: 'p-mb-coke', categoryId: 'cat-minibar', name: 'Coke', price: 30 },
  { id: 'p-mb-beer', categoryId: 'cat-minibar', name: 'Beer (Can)', price: 45 },
  { id: 'p-mb-peanuts', categoryId: 'cat-minibar', name: 'Peanuts', price: 35 },
  { id: 'p-mb-choc', categoryId: 'cat-minibar', name: 'Chocolate Bar', price: 30 },
  { id: 'p-mb-pringles', categoryId: 'cat-minibar', name: 'Pringles', price: 45 },
  { id: 'p-mb-wine', categoryId: 'cat-minibar', name: 'Wine Split', price: 120 },
]

interface RoomSeed {
  number: string
  floor: number
  wing?: string
  roomType: string
  /** stayed = nights already in-house (audited); nights = nights remaining */
  occupied?: { guest: string; nights: number; stayed: number; nightlyRate: number }
  hk?: 'CLEAN' | 'DIRTY' | 'INSPECTED'
  ooo?: boolean
}

const roomSeeds: RoomSeed[] = [
  { number: '101', floor: 1, roomType: 'Standard', occupied: { guest: 'J. Okafor', nights: 2, stayed: 2, nightlyRate: 1250 } },
  { number: '102', floor: 1, roomType: 'Standard', hk: 'DIRTY' },
  { number: '103', floor: 1, roomType: 'Standard', occupied: { guest: 'M. Alvarez', nights: 1, stayed: 1, nightlyRate: 1250 } },
  { number: '104', floor: 1, roomType: 'Deluxe' },
  { number: '105', floor: 1, roomType: 'Deluxe', occupied: { guest: 'R. Tan', nights: 2, stayed: 3, nightlyRate: 1850 } },
  { number: '106', floor: 1, roomType: 'Standard', ooo: true },
  { number: '107', floor: 1, roomType: 'Standard', hk: 'DIRTY' },
  { number: '108', floor: 1, roomType: 'Deluxe', occupied: { guest: 'S. Petrov', nights: 2, stayed: 1, nightlyRate: 1850 } },
  { number: '201', floor: 2, roomType: 'Deluxe', occupied: { guest: 'A. Bianchi', nights: 2, stayed: 4, nightlyRate: 1850 } },
  { number: '202', floor: 2, roomType: 'Deluxe' },
  { number: '203', floor: 2, roomType: 'Suite', occupied: { guest: 'L. Nakamura', nights: 1, stayed: 2, nightlyRate: 3400 } },
  { number: '204', floor: 2, roomType: 'Standard', hk: 'INSPECTED' },
  { number: '205', floor: 2, roomType: 'Deluxe', occupied: { guest: 'C. Dupont', nights: 1, stayed: 0, nightlyRate: 1850 } },
  { number: '206', floor: 2, roomType: 'Standard' },
  { number: '207', floor: 2, roomType: 'Suite', occupied: { guest: 'H. Meyer', nights: 3, stayed: 5, nightlyRate: 3400 } },
  { number: '208', floor: 2, roomType: 'Deluxe', hk: 'DIRTY' },
  { number: '301', floor: 3, roomType: 'Suite', occupied: { guest: 'P. Larsson', nights: 2, stayed: 2, nightlyRate: 3400 } },
  { number: '302', floor: 3, roomType: 'Suite' },
  { number: '303', floor: 3, roomType: 'Penthouse', occupied: { guest: 'D. Rossi', nights: 1, stayed: 1, nightlyRate: 6200 } },
  { number: '304', floor: 3, roomType: 'Suite', hk: 'DIRTY' },
  { number: '305', floor: 3, roomType: 'Suite', occupied: { guest: 'V. Ivanova', nights: 1, stayed: 0, nightlyRate: 3400 } },
  { number: '306', floor: 3, roomType: 'Penthouse' },
]

const GUEST_INFO: Record<string, { phone: string; email: string }> = {
  'J. Okafor': { phone: '+27 82 555 0148', email: 'j.okafor@example.com' },
  'R. Tan': { phone: '+27 83 123 4567', email: 'r.tan@example.com' },
  'L. Nakamura': { phone: '+27 71 234 5678', email: 'l.nakamura@example.com' },
}

/** Stays that checked out during the past week (rooms that are vacant today). */
const pastStays: {
  room: string
  guest: string
  arriveAgo: number // days ago
  nights: number
  kind: Booking['kind']
  pay: 'CASH' | 'CARD'
}[] = [
  { room: '202', guest: 'N. van der Merwe', arriveAgo: 6, nights: 2, kind: 'BOOKING', pay: 'CARD' },
  { room: '104', guest: 'S. Khumalo', arriveAgo: 6, nights: 3, kind: 'RESERVATION', pay: 'CARD' },
  { room: '306', guest: 'F. Botha', arriveAgo: 5, nights: 2, kind: 'BOOKING', pay: 'CARD' },
  { room: '102', guest: 'E. Dlamini', arriveAgo: 4, nights: 1, kind: 'RESERVATION', pay: 'CASH' },
  { room: '302', guest: 'A. Naidoo', arriveAgo: 4, nights: 3, kind: 'BOOKING', pay: 'CARD' },
  { room: '204', guest: 'M. Pillay', arriveAgo: 3, nights: 2, kind: 'RESERVATION', pay: 'CARD' },
  { room: '206', guest: 'C. Fourie', arriveAgo: 2, nights: 1, kind: 'BOOKING', pay: 'CARD' },
  { room: '107', guest: 'L. Mokoena', arriveAgo: 2, nights: 2, kind: 'RESERVATION', pay: 'CASH' },
]

/** Deterministic PRNG so the demo history is stable across reloads. */
function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildSeed(): {
  rooms: Room[]
  folios: Record<string, Folio>
  folioLines: FolioLine[]
  clients: Client[]
  bookings: Booking[]
  tickets: Record<string, Ticket>
  payments: Payment[]
} {
  const rand = mulberry32(20260920)
  const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1))
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]

  const rooms: Room[] = []
  const folios: Record<string, Folio> = {}
  const folioLines: FolioLine[] = []
  const clients: Client[] = []
  const bookings: Booking[] = []
  const tickets: Record<string, Ticket> = {}
  const payments: Payment[] = []

  const now = new Date()
  const dstr = (daysAgo: number) => ymd(addDays(now, -daysAgo))
  const roomType = (num: string) => roomSeeds.find((r) => r.number === num)!.roomType

  // ---------- current rooms + in-house guests (arrived over the past week) ----------
  for (const rs of roomSeeds) {
    const roomId = `room-${rs.number}`
    if (rs.occupied) {
      const { guest, nights, stayed, nightlyRate } = rs.occupied
      const folioId = `folio-${rs.number}`
      const arrive = dstr(stayed)
      const co = ymd(addDays(now, nights))
      rooms.push({
        id: roomId,
        number: rs.number,
        floor: rs.floor,
        wing: rs.wing,
        roomType: rs.roomType,
        fo: 'OCCUPIED',
        hk: 'CLEAN',
        avail: 'IN_SERVICE',
        guestName: guest,
        checkoutDate: co,
        folioId,
      })
      folios[folioId] = {
        id: folioId,
        folioNumber: `F-${rs.number}`,
        roomId,
        guestName: guest,
        status: 'OPEN',
        openedAt: `${arrive}T14:00:00`,
      }
      // one room-night charge per elapsed night (as a night audit would post)
      for (let k = 0; k < stayed; k++) {
        const nightBd = dstr(stayed - k)
        folioLines.push({
          id: `fl-${rs.number}-n${k}`,
          folioId,
          type: 'CHARGE',
          description: `Room charge — ${rs.roomType}`,
          amount: nightlyRate,
          businessDate: nightBd,
          postedAt: `${nightBd}T22:00:00`,
          sourceRef: 'ROOM_NIGHT',
          idempotencyKey: `seed-rn-${rs.number}-${k}`,
          isReversed: false,
        })
      }
      const clientId = `client-${rs.number}`
      const info = GUEST_INFO[guest]
      clients.push({ id: clientId, name: guest, phone: info?.phone, email: info?.email, createdAt: `${dstr(stayed + 2)}T11:00:00` })
      bookings.push({
        id: `bk-${rs.number}`,
        ref: `IN-${rs.number}`,
        kind: 'RESERVATION',
        status: 'CHECKED_IN',
        clientId,
        roomId,
        mode: 'NIGHTLY',
        start: `${arrive}T14:00:00`,
        end: `${co}T11:00:00`,
        nights: stayed + nights,
        rate: nightlyRate,
        total: (stayed + nights) * nightlyRate,
        amountPaid: 0,
        folioId,
        createdAt: `${dstr(stayed + 2)}T11:00:00`,
      })
    } else {
      rooms.push({
        id: roomId,
        number: rs.number,
        floor: rs.floor,
        wing: rs.wing,
        roomType: rs.roomType,
        fo: 'VACANT',
        hk: rs.hk ?? 'CLEAN',
        avail: rs.ooo ? 'OOO' : 'IN_SERVICE',
      })
    }
  }

  // ---------- past stays: checked-out during the last week ----------
  for (const ps of pastStays) {
    const type = roomType(ps.room)
    const rate = DEFAULT_RATE[type]
    const arrive = dstr(ps.arriveAgo)
    const depAgo = ps.arriveAgo - ps.nights
    const depart = dstr(depAgo)
    const clientId = `client-hist-${ps.room}`
    const folioId = `folio-hist-${ps.room}`
    const total = ps.nights * rate
    const prepaid = ps.kind === 'BOOKING' ? total : 0

    clients.push({ id: clientId, name: ps.guest, createdAt: `${dstr(ps.arriveAgo + 2)}T15:00:00` })
    bookings.push({
      id: `bk-hist-${ps.room}`,
      ref: `${ps.kind === 'BOOKING' ? 'BK' : 'RS'}8${ps.room}`,
      kind: ps.kind,
      status: 'CHECKED_OUT',
      clientId,
      roomId: `room-${ps.room}`,
      mode: 'NIGHTLY',
      start: `${arrive}T14:00:00`,
      end: `${depart}T11:00:00`,
      nights: ps.nights,
      rate,
      total,
      amountPaid: prepaid,
      paymentKind: ps.kind === 'BOOKING' ? 'CARD' : undefined,
      folioId,
      createdAt: `${dstr(ps.arriveAgo + 2)}T15:00:00`,
    })
    folios[folioId] = {
      id: folioId,
      folioNumber: `F-${ps.room}-H`,
      roomId: `room-${ps.room}`,
      guestName: ps.guest,
      status: 'CLOSED',
      openedAt: `${arrive}T14:00:00`,
      closedAt: `${depart}T11:00:00`,
    }
    for (let k = 0; k < ps.nights; k++) {
      const nightBd = dstr(ps.arriveAgo - k)
      folioLines.push({
        id: `fl-hist-${ps.room}-n${k}`,
        folioId,
        type: 'CHARGE',
        description: `Room charge — ${type}`,
        amount: rate,
        businessDate: nightBd,
        postedAt: `${nightBd}T22:00:00`,
        sourceRef: 'ROOM_NIGHT',
        idempotencyKey: `seed-hist-rn-${ps.room}-${k}`,
        isReversed: false,
      })
    }
    if (prepaid > 0) {
      folioLines.push({
        id: `fl-hist-${ps.room}-prepaid`,
        folioId,
        type: 'PAYMENT',
        description: 'Prepaid (CARD)',
        amount: -prepaid,
        businessDate: arrive,
        postedAt: `${arrive}T14:05:00`,
        sourceRef: `bk-hist-${ps.room}`,
        idempotencyKey: `seed-hist-prepaid-${ps.room}`,
        isReversed: false,
      })
      payments.push({
        id: `pay-hist-dep-${ps.room}`,
        kind: 'CARD',
        amount: prepaid,
        folioId,
        createdAt: `${dstr(ps.arriveAgo + 2)}T15:10:00`,
        idempotencyKey: `seed-hist-dep-${ps.room}`,
      })
    }
  }

  // ---------- a week of POS tickets (walk-in, room-charged, the odd comp) ----------
  const extraCharges = new Map<string, number>() // folioId -> outlet extras
  for (let ago = 6; ago >= 0; ago--) {
    const dayStr = dstr(ago)
    // folios a charge could be posted to on this day
    const activeFolios: { folioId: string; roomNumber: string }[] = []
    for (const rs of roomSeeds) {
      if (rs.occupied && rs.occupied.stayed >= ago) activeFolios.push({ folioId: `folio-${rs.number}`, roomNumber: rs.number })
    }
    for (const ps of pastStays) {
      if (ps.arriveAgo >= ago && ago > ps.arriveAgo - ps.nights) activeFolios.push({ folioId: `folio-hist-${ps.room}`, roomNumber: ps.room })
    }

    const count = ago === 0 ? randInt(5, 8) : randInt(8, 13)
    for (let i = 0; i < count; i++) {
      const id = `hist-t-${ago}-${i}`
      const hour = randInt(7, 21)
      const openedAt = `${dayStr}T${String(hour).padStart(2, '0')}:${pick(['05', '15', '25', '40'])}:00`
      const closedAt = `${dayStr}T${String(Math.min(hour + 1, 22)).padStart(2, '0')}:${pick(['00', '10', '30'])}:00`

      const lines: OrderLine[] = []
      const lineCount = randInt(1, 4)
      let total = 0
      for (let L = 0; L < lineCount; L++) {
        const p = pick(seedProducts)
        const qty = p.price < 60 ? randInt(1, 3) : randInt(1, 2)
        const lineTotal = qty * p.price
        total += lineTotal
        lines.push({ id: `${id}-l${L}`, productId: p.id, name: p.name, qty, unitPrice: p.price, lineTotal, state: 'SUBMITTED' })
      }

      const roll = rand()
      const toRoom = roll < 0.35 && activeFolios.length > 0
      const comp = !toRoom && roll > 0.96
      const target = toRoom ? pick(activeFolios) : null

      tickets[id] = {
        id,
        number: `H${6 - ago}${String(i).padStart(2, '0')}`,
        roomId: target ? `room-${target.roomNumber}` : undefined,
        type: target ? 'ROOM' : 'WALK_IN',
        state: 'SETTLED',
        lines,
        discountPct: 0,
        openedAt,
        closedAt,
      }

      if (target) {
        folioLines.push({
          id: `fl-${id}`,
          folioId: target.folioId,
          type: 'CHARGE',
          description: `${tickets[id].number} — ${target.roomNumber} outlet charge`,
          amount: total,
          businessDate: dayStr,
          postedAt: closedAt,
          sourceRef: id,
          idempotencyKey: `ticket-${id}`,
          isReversed: false,
        })
        extraCharges.set(target.folioId, (extraCharges.get(target.folioId) ?? 0) + total)
        payments.push({ id: `pay-${id}`, kind: 'ROOM_CHARGE', amount: total, ticketId: id, folioId: target.folioId, createdAt: closedAt, idempotencyKey: `seed-${id}` })
      } else {
        const kind = comp ? 'COMP' : rand() < 0.55 ? 'CARD' : 'CASH'
        payments.push({ id: `pay-${id}`, kind, amount: total, ticketId: id, createdAt: closedAt, idempotencyKey: `seed-${id}` })
      }
    }
  }

  // ---------- settle past folios to zero at checkout ----------
  for (const ps of pastStays) {
    const folioId = `folio-hist-${ps.room}`
    const type = roomType(ps.room)
    const rate = DEFAULT_RATE[type]
    const total = ps.nights * rate
    const prepaid = ps.kind === 'BOOKING' ? total : 0
    const due = total - prepaid + (extraCharges.get(folioId) ?? 0)
    const depart = dstr(ps.arriveAgo - ps.nights)
    if (due > 0) {
      folioLines.push({
        id: `fl-hist-${ps.room}-settle`,
        folioId,
        type: 'PAYMENT',
        description: `Payment — ${ps.pay}`,
        amount: -due,
        businessDate: depart,
        postedAt: `${depart}T10:45:00`,
        idempotencyKey: `seed-hist-settle-${ps.room}`,
        isReversed: false,
      })
      payments.push({
        id: `pay-hist-settle-${ps.room}`,
        kind: ps.pay,
        amount: due,
        folioId,
        createdAt: `${depart}T10:45:00`,
        idempotencyKey: `seed-hist-settlep-${ps.room}`,
      })
    }
  }

  // ---------- upcoming reservations/bookings (created over the past days) ----------
  const future: {
    room: string
    name: string
    phone: string
    kind: Booking['kind']
    mode: Booking['mode']
    fromDay: number
    toDay: number
    time?: [string, string]
    rate: number
    total: number
    paid: number
    createdAgo: number
  }[] = [
    { room: '104', name: 'T. Mensah', phone: '+27 82 555 1122', kind: 'RESERVATION', mode: 'NIGHTLY', fromDay: 5, toDay: 8, rate: 1850, total: 5550, paid: 0, createdAgo: 4 },
    { room: '202', name: 'G. Rossi', phone: '+27 84 555 4433', kind: 'BOOKING', mode: 'NIGHTLY', fromDay: 2, toDay: 4, rate: 1850, total: 3700, paid: 3700, createdAgo: 6 },
    { room: '306', name: 'K. Abara', phone: '+27 83 555 7788', kind: 'BOOKING', mode: 'NIGHTLY', fromDay: 1, toDay: 3, rate: 6200, total: 12400, paid: 12400, createdAgo: 2 },
    { room: '302', name: 'Spa Day Group', phone: '+27 82 555 9090', kind: 'BOOKING', mode: 'TIMED', fromDay: 0, toDay: 0, time: ['10:00', '16:00'], rate: 2200, total: 2200, paid: 2200, createdAgo: 3 },
    { room: '206', name: 'D. Silva', phone: '+27 71 555 3456', kind: 'RESERVATION', mode: 'NIGHTLY', fromDay: 9, toDay: 11, rate: 1250, total: 2500, paid: 0, createdAgo: 1 },
  ]

  future.forEach((f, i) => {
    const clientId = `client-future-${i}`
    const createdAt = `${dstr(f.createdAgo)}T10:30:00`
    clients.push({ id: clientId, name: f.name, phone: f.phone, createdAt })
    const fromD = ymd(addDays(now, f.fromDay))
    const toD = ymd(addDays(now, f.toDay))
    const start = f.mode === 'TIMED' ? `${fromD}T${f.time![0]}:00` : `${fromD}T14:00:00`
    const end = f.mode === 'TIMED' ? `${toD}T${f.time![1]}:00` : `${toD}T11:00:00`
    bookings.push({
      id: `bk-future-${i}`,
      ref: `${f.kind === 'BOOKING' ? 'BK' : 'RS'}${900 + i}`,
      kind: f.kind,
      status: f.kind === 'BOOKING' ? 'BOOKED' : 'RESERVED',
      clientId,
      roomId: `room-${f.room}`,
      mode: f.mode,
      start,
      end,
      nights: f.mode === 'NIGHTLY' ? f.toDay - f.fromDay : undefined,
      rate: f.rate,
      total: f.total,
      amountPaid: f.paid,
      paymentKind: f.paid > 0 ? 'CARD' : undefined,
      createdAt,
    })
    if (f.paid > 0) {
      payments.push({ id: `pay-future-dep-${i}`, kind: 'CARD', amount: f.paid, createdAt, idempotencyKey: `seed-future-dep-${i}` })
    }
  })

  // ---------- a couple of cancellations during the week ----------
  const cancelled: { room: string; name: string; fromDay: number; nights: number; createdAgo: number }[] = [
    { room: '208', name: 'W. Jacobs', fromDay: 4, nights: 2, createdAgo: 5 },
    { room: '304', name: 'R. Sithole', fromDay: 2, nights: 1, createdAgo: 3 },
  ]
  cancelled.forEach((c, i) => {
    const clientId = `client-cx-${i}`
    const createdAt = `${dstr(c.createdAgo)}T13:00:00`
    const type = roomType(c.room)
    const rate = DEFAULT_RATE[type]
    clients.push({ id: clientId, name: c.name, createdAt })
    bookings.push({
      id: `bk-cx-${i}`,
      ref: `RS7${i}${c.room}`,
      kind: 'RESERVATION',
      status: 'CANCELLED',
      clientId,
      roomId: `room-${c.room}`,
      mode: 'NIGHTLY',
      start: `${ymd(addDays(now, c.fromDay))}T14:00:00`,
      end: `${ymd(addDays(now, c.fromDay + c.nights))}T11:00:00`,
      nights: c.nights,
      rate,
      total: c.nights * rate,
      amountPaid: 0,
      createdAt,
    })
  })

  return { rooms, folios, folioLines, clients, bookings, tickets, payments }
}
