import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePos } from '../store/pos'
import { clientList, searchClients, type ClientEntry } from '../lib/clients'
import { formatMoney } from '../lib/money'
import { fmtDate, fmtTime } from '../lib/date'
import type { Booking, BookingStatus, PropertyConfig, Room } from '../types'

const STATUS_STYLE: Record<BookingStatus, string> = {
  RESERVED: 'bg-warn/20 text-warn',
  BOOKED: 'bg-primary/25 text-primary-2',
  CHECKED_IN: 'bg-success/20 text-success',
  CHECKED_OUT: 'bg-panel-3 text-muted',
  CANCELLED: 'bg-danger/20 text-danger',
  NO_SHOW: 'bg-danger/20 text-danger',
}

const inputCls =
  'w-full rounded-btn border border-line bg-panel-2 px-3 py-2 outline-none focus:border-primary'

type ClientPatch = { name?: string; phone?: string; email?: string; idNumber?: string; notes?: string }

export function ClientsScreen() {
  const clients = usePos((s) => s.clients)
  const bookings = usePos((s) => s.bookings)
  const rooms = usePos((s) => s.rooms)
  const config = usePos((s) => s.config)
  const updateClient = usePos((s) => s.updateClient)

  const entries = useMemo(() => clientList(clients, bookings), [clients, bookings])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const shown = query.trim() ? searchClients(entries, query, 200) : entries
  const selected = entries.find((e) => e.client.id === selectedId) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h1 className="text-xl font-bold">Clients</h1>
        <div className="text-sm text-muted">
          {entries.length} guest{entries.length === 1 ? '' : 's'} on file
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* List */}
        <div className="flex min-h-0 w-full flex-col border-b border-line md:w-96 md:border-b-0 md:border-r">
          <div className="p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, phone, email or ID…"
              autoComplete="off"
              className={inputCls}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto" style={{ overscrollBehavior: 'contain' }}>
            {shown.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted">
                {clients.length === 0
                  ? 'No clients yet — they are added the first time you book a guest.'
                  : 'No matches.'}
              </div>
            ) : (
              shown.map((e) => (
                <button
                  key={e.client.id}
                  onClick={() => setSelectedId(e.client.id)}
                  className={`tap flex w-full flex-col items-start gap-0.5 border-b border-line/60 px-4 py-3 text-left hover:bg-panel-2 ${
                    selectedId === e.client.id ? 'bg-panel-2' : ''
                  }`}
                >
                  <span className="font-semibold">{e.client.name}</span>
                  <span className="text-xs text-muted">
                    {[e.client.phone, e.client.email].filter(Boolean).join(' · ') || 'no contact on file'}
                  </span>
                  <span className="text-xs text-muted">
                    {e.bookingCount} stay{e.bookingCount === 1 ? '' : 's'}
                    {e.lastStay && ` · last ${fmtDate(e.lastStay)}`}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="min-h-0 flex-1 overflow-auto p-4" style={{ overscrollBehavior: 'contain' }}>
          {selected ? (
            <ClientDetail
              key={selected.client.id}
              entry={selected}
              bookings={bookings}
              rooms={rooms}
              config={config}
              onSave={(patch) => updateClient(selected.client.id, patch)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-center text-muted">
              Select a guest to see their details and stay history.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Module-scope component (props-driven) so store updates don't remount it and
 *  wipe an in-progress edit — a nested render-time component would. */
function ClientDetail({
  entry,
  bookings,
  rooms,
  config,
  onSave,
}: {
  entry: ClientEntry
  bookings: Booking[]
  rooms: Room[]
  config: PropertyConfig
  onSave: (patch: ClientPatch) => void
}) {
  const c = entry.client
  const navigate = useNavigate()
  const [name, setName] = useState(c.name)
  const [phone, setPhone] = useState(c.phone ?? '')
  const [email, setEmail] = useState(c.email ?? '')
  const [idNumber, setIdNumber] = useState(c.idNumber ?? '')
  const [notes, setNotes] = useState(c.notes ?? '')
  const [saved, setSaved] = useState(false)

  const history = bookings
    .filter((b) => b.clientId === c.id)
    .sort((a, b) => (a.start < b.start ? 1 : -1))

  const dirty =
    name.trim() !== c.name ||
    phone.trim() !== (c.phone ?? '') ||
    email.trim() !== (c.email ?? '') ||
    idNumber.trim() !== (c.idNumber ?? '') ||
    notes.trim() !== (c.notes ?? '')

  const save = () => {
    onSave({ name, phone, email, idNumber, notes })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">ID / passport no.</span>
          <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-sm text-muted">Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          disabled={!dirty}
          onClick={save}
          className="tap rounded-btn bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-2 disabled:opacity-40"
        >
          Save changes
        </button>
        {saved && <span className="text-sm font-semibold text-success">Saved</span>}
      </div>

      <div className="mt-2">
        <div className="mb-2 text-sm font-semibold text-muted">Stay history ({history.length})</div>
        {history.length === 0 ? (
          <div className="rounded-btn bg-panel-2 p-4 text-sm text-muted">No bookings yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((b) => {
              const room = rooms.find((r) => r.id === b.roomId)
              const sched =
                b.mode === 'NIGHTLY'
                  ? `${fmtDate(b.start)} → ${fmtDate(b.end)} · ${b.nights} night(s)`
                  : `${fmtDate(b.start)} · ${fmtTime(b.start)}–${fmtTime(b.end)}`
              return (
                <div key={b.id} className="flex items-center justify-between gap-3 rounded-btn bg-panel-2 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{b.ref}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[b.status]}`}>
                        {b.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      Room {room?.number ?? '—'} · {sched}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold">{formatMoney(b.total, config)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <button
          onClick={() => navigate('/bookings')}
          className="tap mt-3 rounded-btn bg-panel-2 px-4 py-2 text-sm font-semibold hover:bg-panel-3"
        >
          Open bookings list
        </button>
      </div>
    </div>
  )
}
