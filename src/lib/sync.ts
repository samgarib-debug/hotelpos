import { supabase, supabaseEnabled } from './supabase'
import { usePos } from '../store/pos'
import type {
  Booking,
  Category,
  Client,
  Folio,
  FolioLine,
  Payment,
  Product,
  Room,
  Ticket,
} from '../types'

/* Suppress write-through while we apply data that CAME FROM the server. */
let suppress = 0
function withSuppress(fn: () => void) {
  suppress++
  try {
    fn()
  } finally {
    suppress--
  }
}

interface Spec {
  field: string
  table: string
  record?: boolean
  toRow: (x: any) => any
  fromRow: (r: any) => any
}

const num = (v: any) => (v == null ? v : Number(v))

const SPECS: Spec[] = [
  {
    field: 'rooms',
    table: 'rooms',
    toRow: (r: Room) => ({ id: r.id, number: r.number, floor: r.floor, wing: r.wing ?? null, room_type: r.roomType, fo: r.fo, hk: r.hk, avail: r.avail, guest_name: r.guestName ?? null, checkout_date: r.checkoutDate ?? null, folio_id: r.folioId ?? null, open_ticket_id: r.openTicketId ?? null }),
    fromRow: (row): Room => ({ id: row.id, number: row.number, floor: row.floor, wing: row.wing ?? undefined, roomType: row.room_type, fo: row.fo, hk: row.hk, avail: row.avail, guestName: row.guest_name ?? undefined, checkoutDate: row.checkout_date ?? undefined, folioId: row.folio_id ?? undefined, openTicketId: row.open_ticket_id ?? undefined }),
  },
  {
    field: 'categories',
    table: 'categories',
    toRow: (c: Category) => ({ id: c.id, name: c.name, color: c.color, sort_order: c.sortOrder }),
    fromRow: (row): Category => ({ id: row.id, name: row.name, color: row.color, sortOrder: row.sort_order }),
  },
  {
    field: 'products',
    table: 'products',
    toRow: (p: Product) => ({ id: p.id, category_id: p.categoryId, name: p.name, price: p.price, color: p.color ?? null, tax_rate: p.taxRate ?? null }),
    fromRow: (row): Product => ({ id: row.id, categoryId: row.category_id, name: row.name, price: num(row.price), color: row.color ?? undefined, taxRate: row.tax_rate != null ? num(row.tax_rate) : undefined }),
  },
  {
    field: 'clients',
    table: 'clients',
    toRow: (c: Client) => ({ id: c.id, name: c.name, phone: c.phone ?? null, email: c.email ?? null, id_number: c.idNumber ?? null, notes: c.notes ?? null, created_at: c.createdAt }),
    fromRow: (row): Client => ({ id: row.id, name: row.name, phone: row.phone ?? undefined, email: row.email ?? undefined, idNumber: row.id_number ?? undefined, notes: row.notes ?? undefined, createdAt: row.created_at }),
  },
  {
    field: 'bookings',
    table: 'bookings',
    toRow: (b: Booking) => ({ id: b.id, ref: b.ref, kind: b.kind, status: b.status, client_id: b.clientId, room_id: b.roomId, mode: b.mode, start_at: b.start, end_at: b.end, nights: b.nights ?? null, rate: b.rate, total: b.total, amount_paid: b.amountPaid, payment_kind: b.paymentKind ?? null, folio_id: b.folioId ?? null, notes: b.notes ?? null, created_at: b.createdAt }),
    fromRow: (row): Booking => ({ id: row.id, ref: row.ref, kind: row.kind, status: row.status, clientId: row.client_id, roomId: row.room_id, mode: row.mode, start: row.start_at, end: row.end_at, nights: row.nights ?? undefined, rate: num(row.rate), total: num(row.total), amountPaid: num(row.amount_paid), paymentKind: row.payment_kind ?? undefined, folioId: row.folio_id ?? undefined, notes: row.notes ?? undefined, createdAt: row.created_at }),
  },
  {
    field: 'folios',
    table: 'folios',
    record: true,
    toRow: (f: Folio) => ({ id: f.id, folio_number: f.folioNumber, room_id: f.roomId, guest_name: f.guestName, status: f.status, opened_at: f.openedAt, closed_at: f.closedAt ?? null }),
    fromRow: (row): Folio => ({ id: row.id, folioNumber: row.folio_number, roomId: row.room_id, guestName: row.guest_name, status: row.status, openedAt: row.opened_at, closedAt: row.closed_at ?? undefined }),
  },
  {
    field: 'folioLines',
    table: 'folio_lines',
    toRow: (l: FolioLine) => ({ id: l.id, folio_id: l.folioId, type: l.type, description: l.description, amount: l.amount, business_date: l.businessDate, posted_at: l.postedAt, source_ref: l.sourceRef ?? null, idempotency_key: l.idempotencyKey, is_reversed: l.isReversed, reversal_of_id: l.reversalOfId ?? null }),
    fromRow: (row): FolioLine => ({ id: row.id, folioId: row.folio_id, type: row.type, description: row.description, amount: num(row.amount), businessDate: row.business_date, postedAt: row.posted_at, sourceRef: row.source_ref ?? undefined, idempotencyKey: row.idempotency_key, isReversed: row.is_reversed, reversalOfId: row.reversal_of_id ?? undefined }),
  },
  {
    field: 'tickets',
    table: 'tickets',
    record: true,
    toRow: (t: Ticket) => ({ id: t.id, number: t.number, room_id: t.roomId ?? null, type: t.type, state: t.state, lines: t.lines, discount_pct: t.discountPct, opened_at: t.openedAt, closed_at: t.closedAt ?? null }),
    fromRow: (row): Ticket => ({ id: row.id, number: row.number, roomId: row.room_id ?? undefined, type: row.type, state: row.state, lines: row.lines ?? [], discountPct: num(row.discount_pct), openedAt: row.opened_at, closedAt: row.closed_at ?? undefined }),
  },
  {
    field: 'payments',
    table: 'payments',
    toRow: (p: Payment) => ({ id: p.id, kind: p.kind, amount: p.amount, tendered: p.tendered ?? null, change: p.change ?? null, ticket_id: p.ticketId ?? null, folio_id: p.folioId ?? null, created_at: p.createdAt, idempotency_key: p.idempotencyKey }),
    fromRow: (row): Payment => ({ id: row.id, kind: row.kind, amount: num(row.amount), tendered: row.tendered != null ? num(row.tendered) : undefined, change: row.change != null ? num(row.change) : undefined, ticketId: row.ticket_id ?? undefined, folioId: row.folio_id ?? undefined, createdAt: row.created_at, idempotencyKey: row.idempotency_key }),
  },
]

function configRow(s: ReturnType<typeof usePos.getState>) {
  return {
    id: 'default',
    property_name: s.config.propertyName,
    currency: s.config.currency,
    currency_symbol: s.config.currencySymbol,
    tax_rate: s.config.taxRate,
    tax_inclusive: s.config.taxInclusive,
    service_rate: s.config.serviceRate,
    business_date: s.config.businessDate,
    work_period_open: s.workPeriodOpen,
    seq: s.seq,
  }
}

function configPatch(row: any) {
  return {
    config: {
      propertyName: row.property_name,
      currency: row.currency,
      currencySymbol: row.currency_symbol,
      taxRate: num(row.tax_rate),
      taxInclusive: row.tax_inclusive,
      serviceRate: num(row.service_rate),
      businessDate: row.business_date,
    },
    workPeriodOpen: row.work_period_open,
    seq: row.seq,
  }
}

function collectionRows(state: any, spec: Spec): any[] {
  const coll = state[spec.field]
  const items = spec.record ? Object.values(coll) : coll
  return (items as any[]).map(spec.toRow)
}

async function bootstrap() {
  const s = usePos.getState()
  await supabase!.from('config').upsert(configRow(s))
  await Promise.all(
    SPECS.map((spec) => {
      const rows = collectionRows(s, spec)
      return rows.length ? supabase!.from(spec.table).upsert(rows) : Promise.resolve()
    }),
  )
}

async function hydrate() {
  const { data: cfg } = await supabase!.from('config').select('*').eq('id', 'default').maybeSingle()
  if (!cfg) {
    await bootstrap()
    return
  }
  const results = await Promise.all(SPECS.map((spec) => supabase!.from(spec.table).select('*')))
  const patch: any = configPatch(cfg)
  SPECS.forEach((spec, i) => {
    const rows = results[i].data ?? []
    const items = rows.map(spec.fromRow)
    patch[spec.field] = spec.record
      ? Object.fromEntries(items.map((it: any) => [it.id, it]))
      : items
  })
  withSuppress(() => usePos.setState(patch))
}

function push(table: string, rows: any[]) {
  if (!rows.length) return
  supabase!
    .from(table)
    .upsert(rows)
    .then(({ error }) => {
      if (error) console.error('[sync] upsert failed:', table, error.message)
    })
}

function startWriteThrough() {
  usePos.subscribe((state: any, prev: any) => {
    if (suppress > 0) return
    if (state.config !== prev.config || state.workPeriodOpen !== prev.workPeriodOpen || state.seq !== prev.seq) {
      supabase!
        .from('config')
        .upsert(configRow(state))
        .then(({ error }) => error && console.error('[sync] upsert failed: config', error.message))
    }
    for (const spec of SPECS) {
      if (state[spec.field] !== prev[spec.field]) push(spec.table, collectionRows(state, spec))
    }
  })
}

function mergeItem(spec: Spec, item: any) {
  const s: any = usePos.getState()
  if (spec.record) {
    const cur = s[spec.field]
    if (cur[item.id] && JSON.stringify(cur[item.id]) === JSON.stringify(item)) return
    withSuppress(() => usePos.setState({ [spec.field]: { ...cur, [item.id]: item } } as any))
  } else {
    const cur = s[spec.field] as any[]
    const idx = cur.findIndex((x) => x.id === item.id)
    if (idx >= 0 && JSON.stringify(cur[idx]) === JSON.stringify(item)) return
    const next = idx >= 0 ? cur.map((x) => (x.id === item.id ? item : x)) : [...cur, item]
    withSuppress(() => usePos.setState({ [spec.field]: next } as any))
  }
}

function startRealtime() {
  const channel = supabase!.channel('hotelpos-sync')
  for (const spec of SPECS) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: spec.table }, (payload) => {
      if (payload.eventType === 'DELETE') return
      mergeItem(spec, spec.fromRow(payload.new))
    })
  }
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, (payload) => {
    if (payload.new) withSuppress(() => usePos.setState(configPatch(payload.new) as any))
  })
  channel.subscribe()
}

let started = false

/** Call once on app start. No-op when Supabase env vars aren't set. */
export async function initSync() {
  if (!supabaseEnabled || !supabase || started) return
  started = true
  try {
    await hydrate()
  } catch (e) {
    console.error('[sync] hydrate failed', e)
  }
  startWriteThrough()
  startRealtime()
}
