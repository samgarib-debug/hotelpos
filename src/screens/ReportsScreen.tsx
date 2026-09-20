import { useEffect, useMemo, useState } from 'react'
import { usePos } from '../store/pos'
import { buildReport, type DateRange } from '../lib/reports'
import { formatMoney } from '../lib/money'
import { addDays, fmtDate, fmtDateTime, parseYMD, ymd } from '../lib/date'
import { supabase, supabaseEnabled } from '../lib/supabase'

type Preset = 'today' | '7d' | '30d' | 'month' | 'all' | 'custom'
type Tab =
  | 'overview'
  | 'revenue'
  | 'occupancy'
  | 'pos'
  | 'bookings'
  | 'payments'
  | 'folios'
  | 'approvals'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'occupancy', label: 'Occupancy' },
  { id: 'pos', label: 'POS Sales' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'payments', label: 'Payments' },
  { id: 'folios', label: 'Folios' },
  { id: 'approvals', label: 'Approvals' },
]

function rangeFor(preset: Preset, from: string, to: string): DateRange {
  const today = new Date()
  const t = ymd(today)
  const minus = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return ymd(d)
  }
  switch (preset) {
    case 'today':
      return { from: t, to: t }
    case '7d':
      return { from: minus(6), to: t }
    case '30d':
      return { from: minus(29), to: t }
    case 'month':
      return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: t }
    case 'all':
      return { from: '2000-01-01', to: '2999-12-31' }
    case 'custom':
      return { from: from || t, to: to || t }
  }
}

export function ReportsScreen() {
  const s = usePos()
  const [tab, setTab] = useState<Tab>('overview')
  const [preset, setPreset] = useState<Preset>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const range = useMemo(() => rangeFor(preset, from, to), [preset, from, to])
  const clientById = useMemo(() => new Map(s.clients.map((c) => [c.id, c])), [s.clients])

  const r = useMemo(
    () =>
      buildReport({
        rooms: s.rooms,
        bookings: s.bookings,
        folios: s.folios,
        folioLines: s.folioLines,
        payments: s.payments,
        tickets: s.tickets,
        categories: s.categories,
        products: s.products,
        config: s.config,
        range,
      }),
    [s.rooms, s.bookings, s.folios, s.folioLines, s.payments, s.tickets, s.categories, s.products, s.config, range],
  )

  const money = (n: number) => formatMoney(n, s.config)

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <h1 className="text-xl font-bold">Reports</h1>
        <div className="flex flex-wrap items-center gap-2">
          {(['today', '7d', '30d', 'month', 'all'] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`tap rounded-btn px-3 py-2 text-sm font-semibold ${
                preset === p ? 'bg-primary text-white' : 'bg-panel-2 text-muted hover:bg-panel-3'
              }`}
            >
              {p === 'today' ? 'Today' : p === '7d' ? '7 days' : p === '30d' ? '30 days' : p === 'month' ? 'This month' : 'All'}
            </button>
          ))}
          <input
            type="date"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setPreset('custom') }}
            className="rounded-btn border border-line bg-panel-2 px-2 py-1.5 text-sm outline-none focus:border-primary"
          />
          <span className="text-muted">–</span>
          <input
            type="date"
            value={to}
            onChange={(e) => { setTo(e.target.value); setPreset('custom') }}
            className="rounded-btn border border-line bg-panel-2 px-2 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>
      </header>

      {/* Report tabs */}
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-line bg-surface/60 px-3 py-2">
        {TABS.map((tt) => (
          <button
            key={tt.id}
            onClick={() => setTab(tt.id)}
            className={`tap rounded-btn px-3 py-1.5 text-sm font-semibold ${
              tab === tt.id ? 'bg-primary/20 text-primary-2' : 'text-muted hover:bg-panel-2'
            }`}
          >
            {tt.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4" style={{ overscrollBehavior: 'contain' }}>
        {tab === 'overview' && (
          <div className="flex flex-col gap-5">
            <KpiGrid>
              <Kpi label="Occupancy" value={`${r.rooms.occupancyRate}%`} />
              <Kpi label="Rooms occupied" value={`${r.rooms.occupied}/${r.rooms.total}`} />
              <Kpi label="ADR" value={money(r.revenue.adr)} />
              <Kpi label="RevPAR" value={money(r.revenue.revpar)} />
              <Kpi label="Total revenue" value={money(r.revenue.total)} accent />
              <Kpi label="Room revenue" value={money(r.revenue.room)} />
              <Kpi label="F&B revenue" value={money(r.revenue.pos)} />
              <Kpi label="Open folios" value={`${r.folios.openCount} · ${money(r.folios.outstanding)}`} />
            </KpiGrid>
            <Card title="Revenue by source">
              <Bars items={r.revenue.bySource.map((x) => ({ label: x.name, value: x.amount }))} money={money} />
            </Card>
            <Card title="Bookings by status">
              <Bars items={r.bookings.byStatus.map((x) => ({ label: x.status.replace('_', ' '), value: x.count }))} />
            </Card>
          </div>
        )}

        {tab === 'revenue' && (
          <div className="flex flex-col gap-5">
            <KpiGrid>
              <Kpi label="Total revenue" value={money(r.revenue.total)} accent />
              <Kpi label="Room revenue" value={money(r.revenue.room)} />
              <Kpi label="F&B revenue" value={money(r.revenue.pos)} />
              <Kpi label="ADR" value={money(r.revenue.adr)} />
              <Kpi label="RevPAR" value={money(r.revenue.revpar)} />
            </KpiGrid>
            <Card title="Revenue by source">
              <Bars items={r.revenue.bySource.map((x) => ({ label: x.name, value: x.amount }))} money={money} />
            </Card>
            <Card title="F&B revenue by category">
              <Bars items={r.revenue.byCategory.map((x) => ({ label: x.name, value: x.amount, color: x.color }))} money={money} empty="No POS sales in this range yet." />
            </Card>
          </div>
        )}

        {tab === 'occupancy' && (
          <div className="flex flex-col gap-5">
            <KpiGrid>
              <Kpi label="Occupancy" value={`${r.rooms.occupancyRate}%`} accent />
              <Kpi label="Occupied" value={String(r.rooms.occupied)} />
              <Kpi label="Vacant" value={String(r.rooms.vacant)} />
              <Kpi label="Dirty" value={String(r.rooms.dirty)} />
              <Kpi label="Out of order" value={String(r.rooms.ooo)} />
            </KpiGrid>
            <Card title="Room status">
              <Bars
                items={[
                  { label: 'Occupied', value: r.rooms.occupied, color: 'var(--color-room-occupied)' },
                  { label: 'Vacant clean', value: r.rooms.vacant - r.rooms.dirty, color: 'var(--color-room-vacant)' },
                  { label: 'Vacant dirty', value: r.rooms.dirty, color: 'var(--color-room-dirty)' },
                  { label: 'Out of order', value: r.rooms.ooo, color: 'var(--color-room-ooo)' },
                ]}
              />
            </Card>
            <Card title="By room type">
              <Table
                head={['Room type', 'Total', 'Occupied', 'Occupancy']}
                rows={r.rooms.byType.map((t) => [
                  t.type,
                  String(t.total),
                  String(t.occupied),
                  `${t.total ? Math.round((t.occupied / t.total) * 100) : 0}%`,
                ])}
              />
            </Card>
          </div>
        )}

        {tab === 'pos' && (
          <div className="flex flex-col gap-5">
            <KpiGrid>
              <Kpi label="F&B revenue" value={money(r.revenue.pos)} accent />
              <Kpi label="Tickets" value={String(r.pos.ticketCount)} />
              <Kpi label="Avg ticket" value={money(r.pos.avgTicket)} />
            </KpiGrid>
            <Card title="Sales by category">
              <Bars items={r.revenue.byCategory.map((x) => ({ label: x.name, value: x.amount, color: x.color }))} money={money} empty="No POS sales in this range yet." />
            </Card>
            <Card title="Top products">
              <Table
                head={['Product', 'Qty', 'Sales']}
                rows={r.pos.topProducts.map((p) => [p.name, String(p.qty), money(p.amount)])}
                empty="No POS sales in this range yet."
              />
            </Card>
          </div>
        )}

        {tab === 'bookings' && (
          <div className="flex flex-col gap-5">
            <KpiGrid>
              <Kpi label="Total bookings" value={String(r.bookings.total)} />
              <Kpi label="Prepaid (booking)" value={String(r.bookings.booking)} />
              <Kpi label="Holds (reservation)" value={String(r.bookings.reservation)} />
              <Kpi label="New in range" value={String(r.bookings.newInRange)} />
              <Kpi label="Cancelled in range" value={String(r.bookings.cancelledInRange)} />
              <Kpi label="Prepaid value" value={money(r.bookings.prepaidValue)} />
              <Kpi label="To collect (holds)" value={money(r.bookings.holdValue)} />
            </KpiGrid>
            <Card title="Bookings by status">
              <Bars items={r.bookings.byStatus.map((x) => ({ label: x.status.replace('_', ' '), value: x.count }))} />
            </Card>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title={`Arrivals (${r.bookings.arrivals.length})`}>
                <Table
                  head={['Ref', 'Guest', 'Room', 'Date']}
                  rows={r.bookings.arrivals.map((a) => [a.booking.ref, clientById.get(a.booking.clientId)?.name ?? 'Guest', a.room, fmtDate(a.booking.start)])}
                  empty="No arrivals in this range."
                />
              </Card>
              <Card title={`Departures (${r.bookings.departures.length})`}>
                <Table
                  head={['Ref', 'Guest', 'Room', 'Date']}
                  rows={r.bookings.departures.map((a) => [a.booking.ref, clientById.get(a.booking.clientId)?.name ?? 'Guest', a.room, fmtDate(a.booking.end)])}
                  empty="No departures in this range."
                />
              </Card>
            </div>
          </div>
        )}

        {tab === 'payments' && (
          <div className="flex flex-col gap-5">
            <KpiGrid>
              <Kpi label="Cash + card collected" value={money(r.payments.total)} accent />
            </KpiGrid>
            <Card title="Tender mix">
              <Bars items={r.payments.byKind.map((k) => ({ label: k.kind.replace('_', ' '), value: k.amount }))} money={money} empty="No payments in this range." />
            </Card>
            <Card title="Payments detail">
              <Table
                head={['Tender', 'Count', 'Amount']}
                rows={r.payments.byKind.map((k) => [k.kind.replace('_', ' '), String(k.count), money(k.amount)])}
                empty="No payments in this range."
              />
            </Card>
          </div>
        )}

        {tab === 'folios' && (
          <div className="flex flex-col gap-5">
            <KpiGrid>
              <Kpi label="Open folios" value={String(r.folios.openCount)} />
              <Kpi label="Total outstanding" value={money(r.folios.outstanding)} accent />
            </KpiGrid>
            <Card title="Open guest folios">
              <Table
                head={['Folio', 'Room', 'Guest', 'Balance']}
                rows={r.folios.list.map((f) => [f.folio.folioNumber, f.room, f.guest, money(f.balance)])}
                empty="No open folios."
              />
            </Card>
          </div>
        )}

        {tab === 'approvals' && <ApprovalsReport range={range} />}
      </div>
    </div>
  )
}

/* ---- Approvals audit log (live from the backend; manager/admin readable) ---- */

interface ApprovalRow {
  id: string
  requested_by: string
  approved_by: string | null
  action: string
  success: boolean
  created_at: string
}

const APPROVALS_LIMIT = 200

/** Approval rows store the permission slug (matched by the DB guard triggers). */
const ACTION_LABELS: Record<string, string> = {
  discount: 'Apply discount',
  void_submitted: 'Void submitted line',
  comp: 'Comp ticket',
  cancel_booking: 'Cancel booking',
}
const actionLabel = (a: string) => ACTION_LABELS[a] ?? a

function ApprovalsReport({ range }: { range: DateRange }) {
  const [rows, setRows] = useState<ApprovalRow[]>([])
  const [people, setPeople] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    let active = true
    setLoading(true)
    setError(null)
    // created_at is a timestamp; use an exclusive upper bound of range.to + 1 day
    const upper = ymd(addDays(parseYMD(range.to), 1))
    Promise.all([
      supabase
        .from('manager_approvals')
        .select('*')
        .gte('created_at', range.from)
        .lt('created_at', upper)
        .order('created_at', { ascending: false })
        .limit(APPROVALS_LIMIT),
      supabase.from('profiles').select('id, full_name, email'),
    ]).then(([a, p]) => {
      if (!active) return
      if (a.error) setError(a.error.message)
      else setRows((a.data ?? []) as ApprovalRow[])
      setPeople(
        new Map(
          ((p.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map(
            (x) => [x.id, x.full_name || x.email || 'Unknown'],
          ),
        ),
      )
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [range.from, range.to])

  if (!supabaseEnabled) {
    return (
      <div className="py-10 text-center text-muted">
        The approvals audit log lives on the online backend — this build is running in
        local/offline mode.
      </div>
    )
  }
  if (loading) return <div className="py-10 text-center text-muted">Loading approvals…</div>

  const approved = rows.filter((r) => r.success)
  const failed = rows.filter((r) => !r.success)
  const staffInvolved = new Set(rows.map((r) => r.requested_by)).size
  const byAction = Array.from(
    rows.reduce(
      (m, r) => m.set(actionLabel(r.action), (m.get(actionLabel(r.action)) ?? 0) + 1),
      new Map<string, number>(),
    ),
  )
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
  const name = (id: string | null) => (id ? people.get(id) ?? 'Unknown' : '—')

  return (
    <div className="flex flex-col gap-5">
      <KpiGrid>
        <Kpi label="PIN attempts" value={String(rows.length)} />
        <Kpi label="Approved" value={String(approved.length)} />
        <Kpi label="Failed" value={String(failed.length)} accent={failed.length > 0} />
        <Kpi label="Staff involved" value={String(staffInvolved)} />
      </KpiGrid>

      {error && (
        <div className="rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <Card title="Attempts by action">
        <Bars items={byAction} empty="No PIN approvals in this range yet." />
      </Card>

      <Card title={`Audit trail${rows.length === APPROVALS_LIMIT ? ` (latest ${APPROVALS_LIMIT})` : ''}`}>
        {rows.length === 0 ? (
          <div className="py-4 text-center text-muted">No PIN approvals in this range yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 pr-3 font-semibold">When</th>
                <th className="py-1 pr-3 font-semibold">Action</th>
                <th className="py-1 pr-3 font-semibold">Requested by</th>
                <th className="py-1 pr-3 font-semibold">Approved by</th>
                <th className="py-1 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line/60">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted">{fmtDateTime(r.created_at)}</td>
                  <td className="py-2 pr-3 font-medium">{actionLabel(r.action)}</td>
                  <td className="py-2 pr-3">{name(r.requested_by)}</td>
                  <td className="py-2 pr-3">{name(r.approved_by)}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        r.success ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
                      }`}
                    >
                      {r.success ? 'Approved' : 'Failed'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

/* ---- small presentational helpers ---- */

function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>{children}</div>
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-btn border border-line p-4 ${accent ? 'bg-primary/15' : 'bg-panel'}`}>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-btn border border-line bg-panel p-4">
      <h2 className="mb-3 text-sm font-semibold text-muted">{title}</h2>
      {children}
    </section>
  )
}

function Bars({
  items,
  money,
  empty,
}: {
  items: { label: string; value: number; color?: string }[]
  money?: (n: number) => string
  empty?: string
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  const nonZero = items.some((i) => i.value > 0)
  if (!nonZero && empty) return <div className="py-4 text-center text-muted">{empty}</div>
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3">
          <div className="w-32 shrink-0 truncate text-sm text-muted">{it.label}</div>
          <div className="h-6 flex-1 overflow-hidden rounded bg-panel-2">
            <div
              className="h-full rounded"
              style={{ width: `${(it.value / max) * 100}%`, backgroundColor: it.color ?? 'var(--color-primary)', minWidth: it.value > 0 ? 4 : 0 }}
            />
          </div>
          <div className="w-28 shrink-0 text-right text-sm font-semibold">{money ? money(it.value) : it.value}</div>
        </div>
      ))}
    </div>
  )
}

function Table({ head, rows, empty }: { head: string[]; rows: string[][]; empty?: string }) {
  if (rows.length === 0 && empty) return <div className="py-4 text-center text-muted">{empty}</div>
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted">
        <tr>
          {head.map((h, i) => (
            <th key={h} className={`py-1 font-semibold ${i === 0 ? '' : 'text-right'}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="border-t border-line/60">
            {row.map((cell, ci) => (
              <td key={ci} className={`py-2 ${ci === 0 ? 'font-medium' : 'text-right'}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
