/* Dumps the app seed (incl. the week of demo history) as SQL chunk files,
 * for loading into the Supabase backend with elevated access:
 *   npx tsx scripts/dump-seed-sql.ts
 * Emits seed-dump-1.sql … seed-dump-4.sql in the repo root (gitignored).
 */
import { writeFileSync } from 'node:fs'
import { buildSeed, seedCategories, seedConfig, seedProducts, todayISO } from '../src/data/seed'

const q = (v: unknown): string => {
  if (v === undefined || v === null) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return `'${String(v).replace(/'/g, "''")}'`
}
const j = (v: unknown): string => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`

const s = buildSeed()

const ins = (table: string, cols: string[], rows: string[][]) =>
  rows.length
    ? `insert into public.${table} (${cols.join(', ')}) values\n${rows.map((r) => `(${r.join(', ')})`).join(',\n')};\n`
    : ''

// chunk 1: wipe + config, categories, products, rooms
let c1 = `truncate table public.config, public.rooms, public.categories, public.products, public.clients, public.bookings, public.folios, public.folio_lines, public.tickets, public.payments;\n`
c1 += ins(
  'config',
  ['id', 'property_name', 'currency', 'currency_symbol', 'tax_rate', 'tax_inclusive', 'service_rate', 'business_date', 'work_period_open', 'seq'],
  [[q('default'), q(seedConfig.propertyName), q(seedConfig.currency), q(seedConfig.currencySymbol), q(seedConfig.taxRate), q(seedConfig.taxInclusive), q(seedConfig.serviceRate), q(todayISO()), q(true), q(1000)]],
)
c1 += ins('categories', ['id', 'name', 'color', 'sort_order'], seedCategories.map((c) => [q(c.id), q(c.name), q(c.color), q(c.sortOrder)]))
c1 += ins('products', ['id', 'category_id', 'name', 'price', 'color', 'tax_rate'], seedProducts.map((p) => [q(p.id), q(p.categoryId), q(p.name), q(p.price), q(p.color), q(p.taxRate)]))
c1 += ins(
  'rooms',
  ['id', 'number', 'floor', 'wing', 'room_type', 'fo', 'hk', 'avail', 'guest_name', 'checkout_date', 'folio_id', 'open_ticket_id'],
  s.rooms.map((r) => [q(r.id), q(r.number), q(r.floor), q(r.wing), q(r.roomType), q(r.fo), q(r.hk), q(r.avail), q(r.guestName), q(r.checkoutDate), q(r.folioId), q(r.openTicketId)]),
)

// chunk 2: clients + bookings
let c2 = ins('clients', ['id', 'name', 'phone', 'email', 'id_number', 'notes', 'created_at'], s.clients.map((c) => [q(c.id), q(c.name), q(c.phone), q(c.email), q(c.idNumber), q(c.notes), q(c.createdAt)]))
c2 += ins(
  'bookings',
  ['id', 'ref', 'kind', 'status', 'client_id', 'room_id', 'mode', 'start_at', 'end_at', 'nights', 'rate', 'total', 'amount_paid', 'payment_kind', 'folio_id', 'notes', 'created_at'],
  s.bookings.map((b) => [q(b.id), q(b.ref), q(b.kind), q(b.status), q(b.clientId), q(b.roomId), q(b.mode), q(b.start), q(b.end), q(b.nights), q(b.rate), q(b.total), q(b.amountPaid), q(b.paymentKind), q(b.folioId), q(b.notes), q(b.createdAt)]),
)

// chunk 3: folios + folio_lines
let c3 = ins(
  'folios',
  ['id', 'folio_number', 'room_id', 'guest_name', 'status', 'opened_at', 'closed_at'],
  Object.values(s.folios).map((f) => [q(f.id), q(f.folioNumber), q(f.roomId), q(f.guestName), q(f.status), q(f.openedAt), q(f.closedAt)]),
)
c3 += ins(
  'folio_lines',
  ['id', 'folio_id', 'type', 'description', 'amount', 'business_date', 'posted_at', 'source_ref', 'idempotency_key', 'is_reversed', 'reversal_of_id'],
  s.folioLines.map((l) => [q(l.id), q(l.folioId), q(l.type), q(l.description), q(l.amount), q(l.businessDate), q(l.postedAt), q(l.sourceRef), q(l.idempotencyKey), q(l.isReversed), q(l.reversalOfId)]),
)

// chunk 4: tickets + payments
let c4 = ins(
  'tickets',
  ['id', 'number', 'room_id', 'type', 'state', 'lines', 'discount_pct', 'opened_at', 'closed_at'],
  Object.values(s.tickets).map((t) => [q(t.id), q(t.number), q(t.roomId), q(t.type), q(t.state), j(t.lines), q(t.discountPct), q(t.openedAt), q(t.closedAt)]),
)
c4 += ins(
  'payments',
  ['id', 'kind', 'amount', 'tendered', 'change', 'ticket_id', 'folio_id', 'created_at', 'idempotency_key'],
  s.payments.map((p) => [q(p.id), q(p.kind), q(p.amount), q(p.tendered), q(p.change), q(p.ticketId), q(p.folioId), q(p.createdAt), q(p.idempotencyKey)]),
)

writeFileSync('seed-dump-1.sql', c1)
writeFileSync('seed-dump-2.sql', c2)
writeFileSync('seed-dump-3.sql', c3)
writeFileSync('seed-dump-4.sql', c4)
console.log(
  `rows: rooms=${s.rooms.length} clients=${s.clients.length} bookings=${s.bookings.length} folios=${Object.keys(s.folios).length} folio_lines=${s.folioLines.length} tickets=${Object.keys(s.tickets).length} payments=${s.payments.length}`,
)
console.log(`sizes: 1=${c1.length} 2=${c2.length} 3=${c3.length} 4=${c4.length} bytes`)
