import { useMemo, useState } from 'react'
import type { Booking, StayMode } from '../types'
import { usePos } from '../store/pos'
import { addDays, monthLabel, parseYMD, ymd } from '../lib/date'
import { buildEvents, midnight } from '../lib/calendar'
import { MonthView } from './calendar/MonthView'
import { TimeGridView } from './calendar/TimeGridView'
import { BookingDialog } from '../components/BookingDialog'
import { BookingDetailDialog } from '../components/BookingDetailDialog'
import { Modal } from '../components/Modal'

type View = 'month' | 'week' | 'day'

interface CreateReq {
  date: string
  mode?: StayMode
  start?: string
  end?: string
}

export function CalendarScreen() {
  const bookings = usePos((s) => s.bookings)
  const clients = usePos((s) => s.clients)
  const rooms = usePos((s) => s.rooms)

  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(() => new Date())
  const [create, setCreate] = useState<CreateReq | null>(null)
  const [detail, setDetail] = useState<Booking | null>(null)
  const [dayModal, setDayModal] = useState<string | null>(null)

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const events = useMemo(
    () => buildEvents(bookings, roomById, clientById),
    [bookings, roomById, clientById],
  )

  const weekDays = useMemo(() => {
    const start = addDays(midnight(cursor), -cursor.getDay())
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [cursor])
  const dayDays = useMemo(() => [midnight(cursor)], [cursor])

  const label =
    view === 'month'
      ? monthLabel(cursor.getFullYear(), cursor.getMonth())
      : view === 'week'
        ? `${weekDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
        : cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })

  const step = (dir: 1 | -1) => {
    if (view === 'month') {
      const d = new Date(cursor)
      d.setMonth(d.getMonth() + dir)
      setCursor(d)
    } else if (view === 'week') {
      setCursor(addDays(cursor, dir * 7))
    } else {
      setCursor(addDays(cursor, dir))
    }
  }

  const dayModalEvents = dayModal
    ? events.filter((e) => {
        const d = parseYMD(dayModal)
        return midnight(e.coverStart) <= d && d <= midnight(e.coverEnd)
      })
    : []

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <button className="tap rounded-btn bg-panel-2 px-3 py-2 hover:bg-panel-3" onClick={() => step(-1)}>‹</button>
          <button className="tap rounded-btn bg-panel-2 px-3 py-2 text-sm font-semibold hover:bg-panel-3" onClick={() => setCursor(new Date())}>Today</button>
          <button className="tap rounded-btn bg-panel-2 px-3 py-2 hover:bg-panel-3" onClick={() => step(1)}>›</button>
          <h1 className="ml-2 text-xl font-bold">{label}</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-btn border border-line">
            {(['month', 'week', 'day'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`tap px-4 py-2 text-sm font-semibold capitalize ${
                  view === v ? 'bg-primary text-white' : 'bg-panel-2 text-muted hover:bg-panel-3'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <Legend />
          <button
            className="tap rounded-btn bg-primary px-4 py-2 font-semibold text-white hover:bg-primary-2"
            onClick={() => setCreate({ date: ymd(new Date()) })}
          >
            + New booking
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {view === 'month' && (
          <MonthView
            year={cursor.getFullYear()}
            month={cursor.getMonth()}
            events={events}
            onCreate={(d) => setCreate({ date: d })}
            onOpen={(b) => setDetail(b)}
            onMore={(d) => setDayModal(d)}
          />
        )}
        {view !== 'month' && (
          <TimeGridView
            days={view === 'week' ? weekDays : dayDays}
            events={events}
            onCreate={(d, start, end) => setCreate({ date: d, mode: 'TIMED', start, end })}
            onOpen={(b) => setDetail(b)}
          />
        )}
      </div>

      <BookingDialog
        open={!!create}
        initialDate={create?.date}
        initialMode={create?.mode}
        initialStartTime={create?.start}
        initialEndTime={create?.end}
        onClose={() => setCreate(null)}
        onCreated={(b) => setDetail(b)}
      />

      <BookingDetailDialog open={!!detail} booking={detail} onClose={() => setDetail(null)} />

      <Modal open={!!dayModal} onClose={() => setDayModal(null)} title={dayModal ?? ''}>
        <div className="flex flex-col gap-2 p-4">
          {dayModalEvents.map((e) => (
            <button
              key={e.booking.id}
              onClick={() => {
                setDayModal(null)
                setDetail(e.booking)
              }}
              className="tap flex items-center justify-between rounded-btn px-3 py-3 text-left text-white"
              style={{ backgroundColor: e.color }}
            >
              <span className="font-semibold">{e.label}</span>
              <span className="text-sm opacity-90">{e.booking.ref}</span>
            </button>
          ))}
          {dayModalEvents.length === 0 && <div className="p-4 text-center text-muted">No bookings.</div>}
        </div>
      </Modal>
    </div>
  )
}

function Legend() {
  const items: [string, string][] = [
    ['Reservation', 'var(--color-warn)'],
    ['Booking', 'var(--color-primary)'],
    ['Checked-in', 'var(--color-success)'],
    ['Checked-out', 'var(--color-room-dirty)'],
  ]
  return (
    <div className="hidden flex-wrap gap-3 xl:flex">
      {items.map(([label, color]) => (
        <div key={label} className="flex items-center gap-1.5 text-xs text-muted">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: color }} />
          {label}
        </div>
      ))}
    </div>
  )
}
