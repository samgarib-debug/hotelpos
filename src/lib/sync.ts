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

/** Only the rows whose object reference changed since the previous state.
 *  The store updates immutably, so an untouched item keeps its reference —
 *  this keeps pushes small and stops one rejected row (e.g. a stale copy of
 *  another till's ticket) from aborting unrelated writes. */
function changedRows(state: any, prev: any, spec: Spec): any[] {
  const cur = state[spec.field]
  const old = prev[spec.field] ?? (spec.record ? {} : [])
  if (spec.record) {
    return (Object.values(cur) as any[]).filter((it) => old[it.id] !== it).map(spec.toRow)
  }
  const oldById = new Map((old as any[]).map((x) => [x.id, x]))
  return (cur as any[]).filter((it) => oldById.get(it.id) !== it).map(spec.toRow)
}

/** Surface a failed push to the UI (Layout shows a banner) — a silent
 *  console.error hides real data divergence from the till. */
export function reportSyncError(table: string, message: string) {
  console.error('[sync] upsert failed:', table, message)
  window.dispatchEvent(
    new CustomEvent('hotelpos:sync-error', { detail: { table, message } }),
  )
}

/* Pushes run serialized on one promise chain so writes reach the backend in
 * the order they happened, and so RPC calls (which read server state, e.g.
 * settle_ticket pricing the ticket's lines) can await everything in flight. */
let pushChain: Promise<void> = Promise.resolve()

function enqueuePush(run: () => Promise<void>) {
  pushChain = pushChain.then(run).catch(() => undefined)
}

/** Resolves once every queued push has been sent (used before RPC calls). */
export function syncFlush(): Promise<void> {
  return pushChain
}

/** Merge a server-returned config row into the local store without pushing
 *  it back (used by run_end_of_day, which rolls the business date). */
export function applyServerConfig(row: unknown) {
  if (!row || typeof row !== 'object' || (row as { id?: string }).id !== 'default') return
  withSuppress(() => usePos.setState(configPatch(row) as any))
}

/** Merge rows returned by a settlement RPC (snake_case, keyed by table name)
 *  into the local store without pushing them back — the server already has
 *  them, and the matching realtime events will no-op against this merge. */
export function applyServerRows(result: unknown) {
  if (!result || typeof result !== 'object') return
  for (const spec of SPECS) {
    const rows = (result as Record<string, unknown>)[spec.table]
    if (!Array.isArray(rows)) continue
    for (const row of rows) mergeItem(spec, spec.fromRow(row))
  }
}

async function bootstrap() {
  const s = usePos.getState()
  const { error: cfgError } = await supabase!.from('config').upsert(configRow(s))
  if (cfgError) reportSyncError('config', cfgError.message)
  await Promise.all(
    SPECS.map(async (spec) => {
      const rows = collectionRows(s, spec)
      if (!rows.length) return
      const { error } = await supabase!.from(spec.table).upsert(rows)
      if (error) reportSyncError(spec.table, error.message)
    }),
  )
}

/** Returns false when the backend is uninitialised and this client may not
 *  seed it (staff can't insert the seed's COMP/CANCELLED rows past the DB
 *  guards — a manager/admin session must be the first to open a fresh DB). */
async function hydrate(canSeed: boolean): Promise<boolean> {
  const { data: cfg, error: cfgError } = await supabase!
    .from('config')
    .select('*')
    .eq('id', 'default')
    .maybeSingle()
  if (cfgError) {
    // A failed select is NOT an empty backend — never bootstrap over live
    // data we simply couldn't read. Stay degraded this session.
    reportSyncError('config', cfgError.message)
    return false
  }
  if (!cfg) {
    if (!canSeed) {
      reportSyncError(
        'config',
        'Backend not initialised — a manager or admin must open the app once to seed it.',
      )
      return false
    }
    await bootstrap()
    return true
  }
  const results = await Promise.all(SPECS.map((spec) => supabase!.from(spec.table).select('*')))
  const failed = SPECS.find((_, i) => results[i].error)
  if (failed) {
    // Partial state is worse than none: stay degraded rather than running
    // against a backend we only half-read.
    reportSyncError(failed.table, results[SPECS.indexOf(failed)].error!.message)
    return false
  }
  const patch: any = configPatch(cfg)
  SPECS.forEach((spec, i) => {
    const rows = results[i].data ?? []
    const items = rows.map(spec.fromRow)
    patch[spec.field] = spec.record
      ? Object.fromEntries(items.map((it: any) => [it.id, it]))
      : items
  })
  withSuppress(() => usePos.setState(patch))
  return true
}

function push(table: string, rows: any[]) {
  if (!rows.length) return
  enqueuePush(async () => {
    const { error } = await supabase!.from(table).upsert(rows)
    if (error) reportSyncError(table, error.message)
  })
}

function startWriteThrough() {
  usePos.subscribe((state: any, prev: any) => {
    if (suppress > 0) return
    if (state.config !== prev.config || state.workPeriodOpen !== prev.workPeriodOpen || state.seq !== prev.seq) {
      const row = configRow(state)
      enqueuePush(async () => {
        const { error } = await supabase!.from('config').upsert(row)
        if (error) reportSyncError('config', error.message)
      })
    }
    for (const spec of SPECS) {
      if (state[spec.field] !== prev[spec.field]) push(spec.table, changedRows(state, prev, spec))
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
    if (payload.eventType === 'DELETE') return
    const row = payload.new as { id?: string } | null
    // only the 'default' row drives the till (a DELETE payload is {} — truthy)
    if (!row || row.id !== 'default') return
    withSuppress(() => usePos.setState(configPatch(row) as any))
  })
  channel.subscribe()
}

let started = false
let active = false

/** True once hydrate succeeded and write-through/realtime are running.
 *  The settlement RPCs are only used when this is true — a degraded online
 *  session (backend unreachable/uninitialised) falls back to local mode. */
export function syncActive(): boolean {
  return active
}

/** Call once on app start (after the role is known). No-op when Supabase env
 *  vars aren't set. `canSeed` gates bootstrap-if-empty to manager/admin. */
export async function initSync(opts?: { canSeed?: boolean }) {
  if (!supabaseEnabled || !supabase || started) return
  started = true
  let hydrated = false
  try {
    hydrated = await hydrate(opts?.canSeed ?? false)
  } catch (e) {
    console.error('[sync] hydrate failed', e)
    reportSyncError('config', 'Could not load data from the backend — working locally this session.')
  }
  if (!hydrated) return // uninitialised backend: stay local-only this session
  startWriteThrough()
  startRealtime()
  active = true
}
