import { useState } from 'react'
import type { Room } from '../types'
import { Modal } from './Modal'
import { DEFAULT_RATE } from '../data/seed'

interface CheckInDialogProps {
  open: boolean
  room: Room | null
  onClose: () => void
  onConfirm: (guestName: string, nights: number, nightlyRate: number) => void
}

export function CheckInDialog({ open, room, onClose, onConfirm }: CheckInDialogProps) {
  const [guest, setGuest] = useState('')
  const [nights, setNights] = useState(1)
  const [rate, setRate] = useState<number>(0)

  if (!room) return null
  const nightlyRate = rate || DEFAULT_RATE[room.roomType] || 120

  return (
    <Modal open={open} onClose={onClose} title={`Check in — Room ${room.number}`}>
      <div className="flex flex-col gap-4 p-5">
        <div className="text-sm text-muted">
          {room.roomType} · Floor {room.floor}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Guest name</span>
          <input
            autoFocus
            value={guest}
            onChange={(e) => setGuest(e.target.value)}
            placeholder="e.g. J. Smith"
            className="rounded-btn border border-line bg-panel-2 px-3 py-3 text-lg outline-none focus:border-primary"
          />
        </label>

        <div className="flex gap-4">
          <div className="flex-1">
            <span className="text-sm text-muted">Nights</span>
            <div className="mt-1 flex items-center gap-2">
              <button
                className="tap h-12 w-12 rounded-btn bg-panel-2 text-2xl hover:bg-panel-3"
                onClick={() => setNights((n) => Math.max(1, n - 1))}
              >
                −
              </button>
              <span className="w-10 text-center text-2xl font-bold">{nights}</span>
              <button
                className="tap h-12 w-12 rounded-btn bg-panel-2 text-2xl hover:bg-panel-3"
                onClick={() => setNights((n) => n + 1)}
              >
                +
              </button>
            </div>
          </div>

          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm text-muted">Nightly rate</span>
            <input
              type="number"
              value={rate || DEFAULT_RATE[room.roomType] || 120}
              onChange={(e) => setRate(Number(e.target.value))}
              className="rounded-btn border border-line bg-panel-2 px-3 py-3 text-lg outline-none focus:border-primary"
            />
          </label>
        </div>

        <div className="rounded-btn bg-panel-2 px-3 py-2 text-sm text-muted">
          Opens a folio and posts a room-night charge of{' '}
          <span className="font-semibold text-fg">
            R{(nights * nightlyRate).toFixed(2)}
          </span>
          .
        </div>

        <div className="flex justify-end gap-3">
          <button className="tap rounded-btn px-5 py-3 text-muted hover:bg-panel-2" onClick={onClose}>
            Cancel
          </button>
          <button
            disabled={!guest.trim()}
            className="tap rounded-btn bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-2 disabled:opacity-40"
            onClick={() => onConfirm(guest.trim(), nights, nightlyRate)}
          >
            Check in
          </button>
        </div>
      </div>
    </Modal>
  )
}
