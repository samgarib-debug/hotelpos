import { useEffect, useMemo, useState } from 'react'
import type { Booking, BookingKind, PaymentKind, StayMode } from '../types'
import { usePos } from '../store/pos'
import { DEFAULT_RATE } from '../data/seed'
import { formatMoney, round2 } from '../lib/money'
import { fmtDate, nightsBetween, ymd } from '../lib/date'
import { clientList, searchClients } from '../lib/clients'
import { Modal } from './Modal'

interface BookingDialogProps {
  open: boolean
  onClose: () => void
  initialDate?: string // YYYY-MM-DD from a calendar day click
  initialMode?: StayMode // 'TIMED' when created from the time-grid
  initialStartTime?: string // 'HH:MM'
  initialEndTime?: string
  onCreated?: (b: Booking) => void
}

function nextDay(dateYMD: string): string {
  const d = new Date(dateYMD)
  d.setDate(d.getDate() + 1)
  return ymd(d)
}

export function BookingDialog({
  open,
  onClose,
  initialDate,
  initialMode,
  initialStartTime,
  initialEndTime,
  onCreated,
}: BookingDialogProps) {
  const rooms = usePos((s) => s.rooms)
  const config = usePos((s) => s.config)
  const clients = usePos((s) => s.clients)
  const bookings = usePos((s) => s.bookings)
  const createBooking = usePos((s) => s.createBooking)
  const isRoomAvailable = usePos((s) => s.isRoomAvailable)

  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => a.number.localeCompare(b.number)),
    [rooms],
  )

  const [kind, setKind] = useState<BookingKind>('RESERVATION')
  const [mode, setMode] = useState<StayMode>('NIGHTLY')
  const [roomId, setRoomId] = useState('')
  const [arrival, setArrival] = useState('')
  const [departure, setDeparture] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [checkInTime, setCheckInTime] = useState('14:00')
  const [checkOutTime, setCheckOutTime] = useState('11:00')
  const [rateStr, setRateStr] = useState('')
  const [amountStr, setAmountStr] = useState('')
  const [paymentKind, setPaymentKind] = useState<PaymentKind>('CARD')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [clientId, setClientId] = useState<string | undefined>(undefined)
  const [showSuggest, setShowSuggest] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // (Re)initialise when opened
  useEffect(() => {
    if (!open) return
    const base = initialDate ?? ymd(new Date())
    setKind('RESERVATION')
    setMode(initialMode ?? 'NIGHTLY')
    setRoomId(sortedRooms[0]?.id ?? '')
    setArrival(base)
    setDeparture(nextDay(base))
    setDate(base)
    setStartTime(initialStartTime ?? '09:00')
    setEndTime(initialEndTime ?? '17:00')
    setCheckInTime('14:00')
    setCheckOutTime('11:00')
    setAmountStr('80')
    setName('')
    setPhone('')
    setEmail('')
    setIdNumber('')
    setNotes('')
    setClientId(undefined)
    setShowSuggest(false)
    setPaymentKind('CARD')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDate])

  const room = sortedRooms.find((r) => r.id === roomId)

  // default nightly rate follows the selected room type
  useEffect(() => {
    if (room) setRateStr(String(DEFAULT_RATE[room.roomType] ?? 120))
  }, [room])

  const nights = mode === 'NIGHTLY' ? Math.max(0, nightsBetween(arrival, departure)) : 0
  const rate = Number(rateStr) || 0
  const total =
    mode === 'NIGHTLY' ? round2(rate * nights) : round2(Number(amountStr) || 0)

  const start = mode === 'NIGHTLY' ? `${arrival}T${checkInTime}:00` : `${date}T${startTime}:00`
  const end = mode === 'NIGHTLY' ? `${departure}T${checkOutTime}:00` : `${date}T${endTime}:00`

  // Returning-guest search over the client database.
  const clientEntries = useMemo(() => clientList(clients, bookings), [clients, bookings])
  const suggestions = useMemo(
    () => (clientId ? [] : searchClients(clientEntries, name)),
    [clientEntries, name, clientId],
  )

  const pickClient = (c: {
    id: string
    name: string
    phone?: string
    email?: string
    idNumber?: string
    notes?: string
  }) => {
    setClientId(c.id)
    setName(c.name)
    setPhone(c.phone ?? '')
    setEmail(c.email ?? '')
    setIdNumber(c.idNumber ?? '')
    setNotes(c.notes ?? '')
    setShowSuggest(false)
  }

  const clearClient = () => {
    // "use a new guest instead" — unlink AND clear the auto-filled details so a
    // genuinely different person (who happened to match a name) starts fresh.
    setClientId(undefined)
    setName('')
    setPhone('')
    setEmail('')
    setIdNumber('')
    setNotes('')
    setShowSuggest(false)
  }

  const available = roomId ? isRoomAvailable(roomId, start, end) : false
  const validSchedule = mode === 'NIGHTLY' ? nights >= 1 : end > start
  const canCreate = !!name.trim() && !!roomId && validSchedule && available && total > 0

  const submit = () => {
    const res = createBooking({
      kind,
      roomId,
      mode,
      start,
      end,
      nights: mode === 'NIGHTLY' ? nights : undefined,
      rate: mode === 'NIGHTLY' ? rate : total,
      total,
      client: { name, phone, email, idNumber, notes },
      clientId,
      paymentKind: kind === 'BOOKING' ? paymentKind : undefined,
    })
    if ('error' in res) {
      setError(res.error)
      return
    }
    onCreated?.(res)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="New booking / reservation" width="min(720px, 96vw)">
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {/* Kind */}
        <div className="sm:col-span-2">
          <div className="mb-1 text-sm text-muted">Type</div>
          <div className="flex gap-2">
            <Toggle active={kind === 'RESERVATION'} onClick={() => setKind('RESERVATION')}>
              Reservation
              <span className="block text-xs font-normal opacity-80">Hold · pay at check-in</span>
            </Toggle>
            <Toggle active={kind === 'BOOKING'} onClick={() => setKind('BOOKING')}>
              Booking
              <span className="block text-xs font-normal opacity-80">Prepaid · guaranteed</span>
            </Toggle>
          </div>
        </div>

        {/* Room + mode */}
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Room</span>
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="rounded-btn border border-line bg-panel-2 px-3 py-3 outline-none focus:border-primary"
          >
            {sortedRooms.map((r) => (
              <option key={r.id} value={r.id}>
                Rm {r.number} · {r.roomType}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">Stay type</span>
          <div className="flex gap-2">
            <Toggle small active={mode === 'NIGHTLY'} onClick={() => setMode('NIGHTLY')}>
              Nightly
            </Toggle>
            <Toggle small active={mode === 'TIMED'} onClick={() => setMode('TIMED')}>
              Day-use / hourly
            </Toggle>
          </div>
        </div>

        {/* Schedule */}
        {mode === 'NIGHTLY' ? (
          <>
            <Field label="Arrival (check-in)">
              <div className="flex gap-2">
                <input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} className={inputCls} />
                <input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} className={`${inputCls} w-28 shrink-0`} title="Check-in time" />
              </div>
            </Field>
            <Field label="Departure (check-out)">
              <div className="flex gap-2">
                <input type="date" value={departure} min={nextDay(arrival)} onChange={(e) => setDeparture(e.target.value)} className={inputCls} />
                <input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} className={`${inputCls} w-28 shrink-0`} title="Check-out time" />
              </div>
            </Field>
            <Field label={`Rate / night${nights ? ` · ${nights} night(s)` : ''}`}>
              <input type="number" value={rateStr} onChange={(e) => setRateStr(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Total">
              <div className="rounded-btn border border-line bg-panel px-3 py-3 text-lg font-bold">
                {formatMoney(total, config)}
              </div>
            </Field>
          </>
        ) : (
          <>
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </Field>
            <div className="flex gap-2">
              <Field label="Start">
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
              </Field>
              <Field label="End">
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
              </Field>
            </div>
            <Field label="Amount (total)">
              <input type="number" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} className={inputCls} />
            </Field>
          </>
        )}

        {/* Availability */}
        <div className="sm:col-span-2">
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${
              available ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
            }`}
          >
            {available ? 'Room available' : 'Room not available for these dates/times'}
          </span>
        </div>

        {/* Client details */}
        <div className="sm:col-span-2 mt-1 flex items-center justify-between border-t border-line pt-3">
          <span className="text-sm font-semibold text-muted">Guest / client details</span>
          {clientId && (
            <span className="flex items-center gap-2 rounded-full bg-success/20 px-3 py-1 text-xs font-semibold text-success">
              Returning guest — details filled from the database
              <button onClick={clearClient} title="Use a new guest instead" className="tap font-bold hover:text-fg">
                ✕
              </button>
            </span>
          )}
        </div>
        <Field label="Full name * — type to search returning guests">
          <div className="relative">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setClientId(undefined)
                setShowSuggest(true)
              }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              placeholder="e.g. J. Smith"
              autoComplete="off"
              className={inputCls}
            />
            {showSuggest && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-btn border border-line bg-panel shadow-lg">
                {suggestions.map((e) => (
                  <button
                    key={e.client.id}
                    // onMouseDown fires before the input's onBlur, so the pick lands
                    onMouseDown={(ev) => {
                      ev.preventDefault()
                      pickClient(e.client)
                    }}
                    className="tap flex w-full flex-col items-start gap-0.5 border-b border-line/60 px-3 py-2 text-left last:border-0 hover:bg-panel-2"
                  >
                    <span className="font-semibold">{e.client.name}</span>
                    <span className="text-xs text-muted">
                      {[e.client.phone, e.client.email].filter(Boolean).join(' · ') || 'no contact on file'}
                      {e.bookingCount > 0 && ` · ${e.bookingCount} past stay${e.bookingCount > 1 ? 's' : ''}`}
                      {e.lastStay && ` · last ${fmtDate(e.lastStay)}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Email">
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Field>
        <Field label="ID / passport no.">
          <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Notes" full>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Requests, arrival time, etc." className={inputCls} />
        </Field>

        {/* Prepaid payment */}
        {kind === 'BOOKING' && (
          <div className="sm:col-span-2 rounded-btn bg-panel-2 p-3">
            <div className="mb-2 text-sm text-muted">
              Prepaid amount: <span className="font-bold text-fg">{formatMoney(total, config)}</span> — collect now
            </div>
            <div className="flex gap-2">
              <Toggle small active={paymentKind === 'CARD'} onClick={() => setPaymentKind('CARD')}>Card</Toggle>
              <Toggle small active={paymentKind === 'CASH'} onClick={() => setPaymentKind('CASH')}>Cash</Toggle>
            </div>
          </div>
        )}

        {error && (
          <div className="sm:col-span-2 rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
        )}

        <div className="sm:col-span-2 flex justify-end gap-3">
          <button className="tap rounded-btn px-5 py-3 text-muted hover:bg-panel-2" onClick={onClose}>
            Cancel
          </button>
          <button
            disabled={!canCreate}
            className="tap rounded-btn bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-2 disabled:opacity-40"
            onClick={submit}
          >
            {kind === 'BOOKING' ? `Book & charge ${formatMoney(total, config)}` : 'Create reservation'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const inputCls =
  'w-full rounded-btn border border-line bg-panel-2 px-3 py-3 outline-none focus:border-primary'

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${full ? 'sm:col-span-2' : 'flex-1'}`}>
      <span className="text-sm text-muted">{label}</span>
      {children}
    </label>
  )
}

function Toggle({
  active,
  onClick,
  children,
  small,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  small?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`tap flex-1 rounded-btn text-center font-semibold ${small ? 'px-3 py-2' : 'px-4 py-3'} ${
        active ? 'bg-primary text-white' : 'bg-panel-2 text-muted hover:bg-panel-3'
      }`}
    >
      {children}
    </button>
  )
}
