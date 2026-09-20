import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Booking, BookingStatus } from '../types'
import { usePos, folioBalance } from '../store/pos'
import { formatMoney, round2 } from '../lib/money'
import { useManagerApproval } from './useManagerApproval'
import { fmtDate, fmtDateTime, fmtTime } from '../lib/date'
import { Modal } from './Modal'
import { FolioDialog } from './FolioDialog'

const STATUS_STYLE: Record<BookingStatus, string> = {
  RESERVED: 'bg-warn/20 text-warn',
  BOOKED: 'bg-primary/25 text-primary-2',
  CHECKED_IN: 'bg-success/20 text-success',
  CHECKED_OUT: 'bg-panel-3 text-muted',
  CANCELLED: 'bg-danger/20 text-danger',
  NO_SHOW: 'bg-danger/20 text-danger',
}

interface Props {
  open: boolean
  booking: Booking | null
  onClose: () => void
}

export function BookingDetailDialog({ open, booking, onClose }: Props) {
  const navigate = useNavigate()
  const clients = usePos((s) => s.clients)
  const rooms = usePos((s) => s.rooms)
  const config = usePos((s) => s.config)
  const folioLines = usePos((s) => s.folioLines)
  const checkInBooking = usePos((s) => s.checkInBooking)
  const checkOutBooking = usePos((s) => s.checkOutBooking)
  const cancelBooking = usePos((s) => s.cancelBooking)
  const selectRoom = usePos((s) => s.selectRoom)
  const approval = useManagerApproval()
  const [error, setError] = useState<string | null>(null)
  const [showFolio, setShowFolio] = useState(false)

  if (!booking) return null
  const client = clients.find((c) => c.id === booking.clientId)
  const room = rooms.find((r) => r.id === booking.roomId)
  const balanceToCollect = round2(booking.total - booking.amountPaid)
  const folioBal =
    booking.status === 'CHECKED_IN' && booking.folioId
      ? folioBalance(folioLines, booking.folioId)
      : undefined

  const schedule =
    booking.mode === 'NIGHTLY'
      ? `${fmtDate(booking.start)} → ${fmtDate(booking.end)} · ${booking.nights} night(s)`
      : `${fmtDate(booking.start)} · ${fmtTime(booking.start)}–${fmtTime(booking.end)}`

  const doCheckIn = async () => {
    const res = await checkInBooking(booking.id)
    if ('error' in res) setError(res.error)
    else {
      setError(null)
      onClose()
    }
  }

  const doCheckOut = async () => {
    const res = await checkOutBooking(booking.id)
    if ('error' in res) setError(res.error)
    else {
      setError(null)
      onClose()
    }
  }

  const openCharge = () => {
    if (!room) return
    selectRoom(room.id)
    onClose()
    navigate('/order')
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={`${booking.ref} · Room ${room?.number ?? '—'}`} width="min(560px, 96vw)">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${STATUS_STYLE[booking.status]}`}>
              {booking.status.replace('_', ' ')}
            </span>
            <span className="rounded-full bg-panel-2 px-3 py-1 text-sm font-semibold">
              {booking.kind === 'BOOKING' ? 'Prepaid booking' : 'Reservation (hold)'}
            </span>
            <span className="rounded-full bg-panel-2 px-3 py-1 text-sm text-muted">
              {booking.mode === 'NIGHTLY' ? 'Nightly' : 'Day-use'}
            </span>
          </div>

          <div className="rounded-btn bg-panel-2 p-4">
            <div className="text-lg font-bold">{client?.name ?? 'Guest'}</div>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted">
              {client?.phone && <div>📞 {client.phone}</div>}
              {client?.email && <div>✉ {client.email}</div>}
              {client?.idNumber && <div>ID {client.idNumber}</div>}
              {room && <div>Room {room.number} · {room.roomType}</div>}
            </div>
            {client?.notes && <div className="mt-2 text-sm">📝 {client.notes}</div>}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Schedule" value={schedule} />
            <Info label="Created" value={fmtDateTime(booking.createdAt)} />
            <Info label="Total" value={formatMoney(booking.total, config)} />
            <Info label="Prepaid" value={formatMoney(booking.amountPaid, config)} />
            {folioBal != null ? (
              <Info label="Folio balance" value={formatMoney(folioBal, config)} strong />
            ) : (
              <Info label="Collect at check-in" value={formatMoney(balanceToCollect, config)} strong />
            )}
          </div>

          {error && (
            <div className="rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          {/* Actions by status */}
          <div className="flex flex-wrap gap-2">
            {(booking.status === 'RESERVED' || booking.status === 'BOOKED') && (
              <>
                <button
                  className="tap flex-1 rounded-btn bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-2"
                  onClick={doCheckIn}
                >
                  Check in
                </button>
                <button
                  title={approval.locked('cancel_booking') ? 'Manager PIN required' : undefined}
                  className="tap rounded-btn bg-panel-2 px-4 py-3 font-semibold text-danger hover:bg-panel-3"
                  onClick={() =>
                    approval.request('cancel_booking', `Cancel ${booking.ref}`, () => {
                      cancelBooking(booking.id)
                      onClose()
                    })
                  }
                >
                  Cancel{approval.locked('cancel_booking') ? ' 🔒' : ''}
                </button>
              </>
            )}

            {booking.status === 'CHECKED_IN' && (
              <>
                <button
                  className="tap flex-1 rounded-btn bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-2"
                  onClick={openCharge}
                >
                  Open room charge
                </button>
                <button
                  className="tap rounded-btn bg-panel-2 px-4 py-3 font-semibold hover:bg-panel-3"
                  onClick={() => setShowFolio(true)}
                >
                  Folio
                </button>
                <button
                  className="tap rounded-btn bg-panel-2 px-4 py-3 font-semibold hover:bg-panel-3"
                  onClick={doCheckOut}
                >
                  Check out
                </button>
              </>
            )}
          </div>
        </div>
      </Modal>

      <FolioDialog
        open={showFolio}
        room={room ?? null}
        onClose={() => setShowFolio(false)}
        onCheckedOut={() => {
          setShowFolio(false)
          onClose()
        }}
      />

      {approval.dialog}
    </>
  )
}

function Info({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={strong ? 'text-lg font-bold' : 'font-medium'}>{value}</div>
    </div>
  )
}
