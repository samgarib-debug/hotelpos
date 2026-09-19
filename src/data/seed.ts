import type {
  Booking,
  Category,
  Client,
  Folio,
  FolioLine,
  Product,
  PropertyConfig,
  Room,
} from '../types'
import { ymd } from '../lib/date'

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
  occupied?: { guest: string; nights: number; nightlyRate: number }
  hk?: 'CLEAN' | 'DIRTY' | 'INSPECTED'
  ooo?: boolean
}

const roomSeeds: RoomSeed[] = [
  { number: '101', floor: 1, roomType: 'Standard', occupied: { guest: 'J. Okafor', nights: 2, nightlyRate: 1250 } },
  { number: '102', floor: 1, roomType: 'Standard', hk: 'DIRTY' },
  { number: '103', floor: 1, roomType: 'Standard', occupied: { guest: 'M. Alvarez', nights: 1, nightlyRate: 1250 } },
  { number: '104', floor: 1, roomType: 'Deluxe' },
  { number: '105', floor: 1, roomType: 'Deluxe', occupied: { guest: 'R. Tan', nights: 3, nightlyRate: 1850 } },
  { number: '106', floor: 1, roomType: 'Standard', ooo: true },
  { number: '107', floor: 1, roomType: 'Standard', hk: 'DIRTY' },
  { number: '108', floor: 1, roomType: 'Deluxe', occupied: { guest: 'S. Petrov', nights: 2, nightlyRate: 1850 } },
  { number: '201', floor: 2, roomType: 'Deluxe', occupied: { guest: 'A. Bianchi', nights: 4, nightlyRate: 1850 } },
  { number: '202', floor: 2, roomType: 'Deluxe' },
  { number: '203', floor: 2, roomType: 'Suite', occupied: { guest: 'L. Nakamura', nights: 2, nightlyRate: 3400 } },
  { number: '204', floor: 2, roomType: 'Standard', hk: 'INSPECTED' },
  { number: '205', floor: 2, roomType: 'Deluxe', occupied: { guest: 'C. Dupont', nights: 1, nightlyRate: 1850 } },
  { number: '206', floor: 2, roomType: 'Standard' },
  { number: '207', floor: 2, roomType: 'Suite', occupied: { guest: 'H. Meyer', nights: 5, nightlyRate: 3400 } },
  { number: '208', floor: 2, roomType: 'Deluxe', hk: 'DIRTY' },
  { number: '301', floor: 3, roomType: 'Suite', occupied: { guest: 'P. Larsson', nights: 3, nightlyRate: 3400 } },
  { number: '302', floor: 3, roomType: 'Suite' },
  { number: '303', floor: 3, roomType: 'Penthouse', occupied: { guest: 'D. Rossi', nights: 2, nightlyRate: 6200 } },
  { number: '304', floor: 3, roomType: 'Suite', hk: 'DIRTY' },
  { number: '305', floor: 3, roomType: 'Suite', occupied: { guest: 'V. Ivanova', nights: 1, nightlyRate: 3400 } },
  { number: '306', floor: 3, roomType: 'Penthouse' },
]

const GUEST_INFO: Record<string, { phone: string; email: string }> = {
  'J. Okafor': { phone: '+27 82 555 0148', email: 'j.okafor@example.com' },
  'R. Tan': { phone: '+27 83 123 4567', email: 'r.tan@example.com' },
  'L. Nakamura': { phone: '+27 71 234 5678', email: 'l.nakamura@example.com' },
}

export function buildSeed(): {
  rooms: Room[]
  folios: Record<string, Folio>
  folioLines: FolioLine[]
  clients: Client[]
  bookings: Booking[]
} {
  const rooms: Room[] = []
  const folios: Record<string, Folio> = {}
  const folioLines: FolioLine[] = []
  const clients: Client[] = []
  const bookings: Booking[] = []
  const bd = todayISO()
  const nowIso = new Date().toISOString()

  const plusDays = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return d
  }

  for (const rs of roomSeeds) {
    const roomId = `room-${rs.number}`
    if (rs.occupied) {
      const folioId = `folio-${rs.number}`
      const co = plusDays(rs.occupied.nights)
      rooms.push({
        id: roomId,
        number: rs.number,
        floor: rs.floor,
        wing: rs.wing,
        roomType: rs.roomType,
        fo: 'OCCUPIED',
        hk: 'CLEAN',
        avail: 'IN_SERVICE',
        guestName: rs.occupied.guest,
        checkoutDate: ymd(co),
        folioId,
      })
      folios[folioId] = {
        id: folioId,
        folioNumber: `F-${rs.number}`,
        roomId,
        guestName: rs.occupied.guest,
        status: 'OPEN',
        openedAt: nowIso,
      }
      folioLines.push({
        id: `fl-${rs.number}-roomnight`,
        folioId,
        type: 'CHARGE',
        description: `Room charge x${rs.occupied.nights} night(s) — ${rs.roomType}`,
        amount: rs.occupied.nights * rs.occupied.nightlyRate,
        businessDate: bd,
        postedAt: nowIso,
        sourceRef: 'ROOM_NIGHT',
        idempotencyKey: `seed-roomnight-${rs.number}`,
        isReversed: false,
      })
      // in-house booking record so the guest appears on the calendar
      const clientId = `client-${rs.number}`
      const info = GUEST_INFO[rs.occupied.guest]
      clients.push({
        id: clientId,
        name: rs.occupied.guest,
        phone: info?.phone,
        email: info?.email,
        createdAt: nowIso,
      })
      bookings.push({
        id: `bk-${rs.number}`,
        ref: `IN-${rs.number}`,
        kind: 'RESERVATION',
        status: 'CHECKED_IN',
        clientId,
        roomId,
        mode: 'NIGHTLY',
        start: `${bd}T14:00:00`,
        end: `${ymd(co)}T11:00:00`,
        nights: rs.occupied.nights,
        rate: rs.occupied.nightlyRate,
        total: rs.occupied.nights * rs.occupied.nightlyRate,
        amountPaid: 0,
        folioId,
        createdAt: nowIso,
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

  // A few upcoming reservations/bookings for the calendar demo
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
  }[] = [
    { room: '104', name: 'T. Mensah', phone: '+27 82 555 1122', kind: 'RESERVATION', mode: 'NIGHTLY', fromDay: 5, toDay: 8, rate: 1850, total: 5550, paid: 0 },
    { room: '202', name: 'G. Rossi', phone: '+27 84 555 4433', kind: 'BOOKING', mode: 'NIGHTLY', fromDay: 2, toDay: 4, rate: 1850, total: 3700, paid: 3700 },
    { room: '306', name: 'K. Abara', phone: '+27 83 555 7788', kind: 'BOOKING', mode: 'NIGHTLY', fromDay: 1, toDay: 3, rate: 6200, total: 12400, paid: 12400 },
    { room: '302', name: 'Spa Day Group', phone: '+27 82 555 9090', kind: 'BOOKING', mode: 'TIMED', fromDay: 0, toDay: 0, time: ['10:00', '16:00'], rate: 2200, total: 2200, paid: 2200 },
    { room: '206', name: 'D. Silva', phone: '+27 71 555 3456', kind: 'RESERVATION', mode: 'NIGHTLY', fromDay: 9, toDay: 11, rate: 1250, total: 2500, paid: 0 },
  ]

  future.forEach((f, i) => {
    const clientId = `client-future-${i}`
    clients.push({ id: clientId, name: f.name, phone: f.phone, createdAt: nowIso })
    const fromD = plusDays(f.fromDay)
    const toD = plusDays(f.toDay)
    const start = f.mode === 'TIMED' ? `${ymd(fromD)}T${f.time![0]}:00` : `${ymd(fromD)}T14:00:00`
    const end = f.mode === 'TIMED' ? `${ymd(toD)}T${f.time![1]}:00` : `${ymd(toD)}T11:00:00`
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
      createdAt: nowIso,
    })
  })

  return { rooms, folios, folioLines, clients, bookings }
}
