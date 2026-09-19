import { useMemo, useState } from 'react'
import type { Booking, BookingKind, BookingStatus } from '../types'
import { usePos } from '../store/pos'
import { formatMoney, round2 } from '../lib/money'
import { fmtDate, fmtTime, ymd } from '../lib/date'
import { BookingDialog } from '../components/BookingDialog'
import { BookingDetailDialog } from '../components/BookingDetailDialog'

const STATUS_STYLE: Record<BookingStatus, string> = {
  RESERVED: 'bg-warn/20 text-warn',
  BOOKED: 'bg-primary/25 text-primary-2',
  CHECKED_IN: 'bg-success/20 text-success',
  CHECKED_OUT: 'bg-panel-3 text-muted',
  CANCELLED: 'bg-danger/20 text-danger',
  NO_SHOW: 'bg-danger/20 text-danger',
}

export function ReservationsScreen() {
  const bookings = usePos((s) => s.bookings)
  const clients = usePos((s) => s.clients)
  const rooms = usePos((s) => s.rooms)
  const config = usePos((s) => s.config)

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])

  const [q, setQ] = useState('')
  const [status, setStatus] = useState<BookingStatus | 'ALL'>('ALL')
  const [kind, setKind] = useState<BookingKind | 'ALL'>('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [detail, setDetail] = useState<Booking | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return bookings
      .filter((b) => {
        if (status !== 'ALL' && b.status !== status) return false
        if (kind !== 'ALL' && b.kind !== kind) return false
        const sd = ymd(new Date(b.start))
        if (from && sd < from) return false
        if (to && sd > to) return false
        if (ql) {
          const client = clientById.get(b.clientId)
          const room = roomById.get(b.roomId)
          const hay = `${b.ref} ${client?.name ?? ''} ${client?.phone ?? ''} ${room?.number ?? ''}`.toLowerCase()
          if (!hay.includes(ql)) return false
        }
        return true
      })
      .sort((a, b) => (a.start < b.start ? 1 : -1))
  }, [bookings, status, kind, from, to, q, clientById, roomById])

  const todayYMD = ymd(new Date())
  const arrivalsToday = bookings.filter(
    (b) => ymd(new Date(b.start)) === todayYMD && (b.status === 'RESERVED' || b.status === 'BOOKED'),
  ).length
  const inHouse = bookings.filter((b) => b.status === 'CHECKED_IN').length
  const collected = round2(rows.reduce((s, b) => s + b.amountPaid, 0))

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <h1 className="text-xl font-bold">Bookings & Reservations</h1>
        <button
          className="tap rounded-btn bg-primary px-4 py-2 font-semibold text-white hover:bg-primary-2"
          onClick={() => setShowCreate(true)}
        >
          + New booking
        </button>
      </header>

      {/* Summary */}
      <div className="flex flex-wrap gap-3 border-b border-line px-4 py-3">
        <Stat label="Showing" value={String(rows.length)} />
        <Stat label="Arrivals today" value={String(arrivalsToday)} />
        <Stat label="In-house" value={String(inHouse)} />
        <Stat label="Collected (filtered)" value={formatMoney(collected, config)} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Guest, ref, phone, room…"
            className="w-56 rounded-btn border border-line bg-panel-2 px-3 py-2 outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as BookingStatus | 'ALL')} className="rounded-btn border border-line bg-panel-2 px-3 py-2 outline-none focus:border-primary">
            {['ALL', 'RESERVED', 'BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as BookingKind | 'ALL')} className="rounded-btn border border-line bg-panel-2 px-3 py-2 outline-none focus:border-primary">
            <option value="ALL">ALL</option>
            <option value="BOOKING">Booking (prepaid)</option>
            <option value="RESERVATION">Reservation (hold)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-btn border border-line bg-panel-2 px-3 py-2 outline-none focus:border-primary" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-btn border border-line bg-panel-2 px-3 py-2 outline-none focus:border-primary" />
        </label>
        {(q || status !== 'ALL' || kind !== 'ALL' || from || to) && (
          <button
            className="tap rounded-btn bg-panel-2 px-3 py-2 text-sm text-muted hover:bg-panel-3"
            onClick={() => { setQ(''); setStatus('ALL'); setKind('ALL'); setFrom(''); setTo('') }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto" style={{ overscrollBehavior: 'contain' }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-muted">
            <tr>
              <Th>Ref</Th><Th>Guest</Th><Th>Room</Th><Th>Type</Th><Th>Schedule</Th>
              <Th right>Total</Th><Th right>Paid</Th><Th right>Balance</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const client = clientById.get(b.clientId)
              const room = roomById.get(b.roomId)
              const schedule =
                b.mode === 'NIGHTLY'
                  ? `${fmtDate(b.start)} → ${fmtDate(b.end)} · ${b.nights}n`
                  : `${fmtDate(b.start)} ${fmtTime(b.start)}–${fmtTime(b.end)}`
              const balance = round2(b.total - b.amountPaid)
              return (
                <tr
                  key={b.id}
                  onClick={() => setDetail(b)}
                  className="tap cursor-pointer border-t border-line/60 hover:bg-panel/40"
                >
                  <Td>{b.ref}</Td>
                  <Td>{client?.name ?? 'Guest'}</Td>
                  <Td>{room?.number ?? '—'}</Td>
                  <Td>{b.kind === 'BOOKING' ? 'Booking' : 'Reservation'}</Td>
                  <Td>{schedule}</Td>
                  <Td right>{formatMoney(b.total, config)}</Td>
                  <Td right>{formatMoney(b.amountPaid, config)}</Td>
                  <Td right>{formatMoney(balance, config)}</Td>
                  <Td>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[b.status]}`}>
                      {b.status.replace('_', ' ')}
                    </span>
                  </Td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-muted">
                  No bookings match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <BookingDialog open={showCreate} onClose={() => setShowCreate(false)} onCreated={(b) => setDetail(b)} />
      <BookingDetailDialog open={!!detail} booking={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-btn bg-panel-2 px-4 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  )
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-4 py-2 font-semibold ${right ? 'text-right' : ''}`}>{children}</th>
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`px-4 py-3 ${right ? 'text-right' : ''}`}>{children}</td>
}
