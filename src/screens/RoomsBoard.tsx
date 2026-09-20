import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Room } from '../types'
import { usePos, folioBalance } from '../store/pos'
import { useAuth } from '../lib/authContext'
import { can } from '../lib/permissions'
import { roomVisual } from '../lib/roomState'
import { RoomButton } from '../components/RoomButton'
import { TopBar } from '../components/TopBar'
import { Modal } from '../components/Modal'
import { CheckInDialog } from '../components/CheckInDialog'
import { FolioDialog } from '../components/FolioDialog'
import { SetPinDialog } from '../components/SetPinDialog'
import { CloseDayDialog } from '../components/CloseDayDialog'
import { supabaseEnabled } from '../lib/supabase'

const LEGEND: { label: string; colorVar: string }[] = [
  { label: 'Vacant · Clean', colorVar: 'var(--color-room-vacant)' },
  { label: 'Occupied', colorVar: 'var(--color-room-occupied)' },
  { label: 'Checkout Due', colorVar: 'var(--color-room-checkout)' },
  { label: 'Vacant · Dirty', colorVar: 'var(--color-room-dirty)' },
  { label: 'Out of Order', colorVar: 'var(--color-room-ooo)' },
]

export function RoomsBoard() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const rooms = usePos((s) => s.rooms)
  const config = usePos((s) => s.config)
  const folioLines = usePos((s) => s.folioLines)
  const workPeriodOpen = usePos((s) => s.workPeriodOpen)
  const selectRoom = usePos((s) => s.selectRoom)
  const checkInRoom = usePos((s) => s.checkInRoom)
  const setRoomHousekeeping = usePos((s) => s.setRoomHousekeeping)
  const reseed = usePos((s) => s.reseed)

  const [floor, setFloor] = useState<number | 'ALL'>('ALL')
  const [actionsFor, setActionsFor] = useState<Room | null>(null)
  const [checkInFor, setCheckInFor] = useState<Room | null>(null)
  const [folioFor, setFolioFor] = useState<Room | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSetPin, setShowSetPin] = useState(false)
  const [showCloseDay, setShowCloseDay] = useState(false)

  const floors = useMemo(
    () => Array.from(new Set(rooms.map((r) => r.floor))).sort((a, b) => a - b),
    [rooms],
  )
  const shown = rooms.filter((r) => floor === 'ALL' || r.floor === floor)
  const occupied = rooms.filter((r) => r.fo === 'OCCUPIED').length

  const onRoomClick = (room: Room) => {
    if (room.fo === 'OCCUPIED') {
      selectRoom(room.id)
      navigate('/order')
    } else {
      setActionsFor(room)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        left={
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">{config.propertyName}</div>
            <div className="text-xs text-muted">Business date {config.businessDate}</div>
          </div>
        }
        center={<div className="text-lg font-semibold">Rooms</div>}
        right={
          <>
            <span className="hidden rounded-full bg-panel-2 px-3 py-1 text-sm text-muted sm:inline">
              {occupied}/{rooms.length} occupied
            </span>
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${
                workPeriodOpen ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
              }`}
            >
              {workPeriodOpen ? 'Day open' : 'Day closed'}
            </span>
            <button
              className="tap rounded-btn bg-panel-2 px-3 py-2 hover:bg-panel-3"
              onClick={() => setShowSettings(true)}
            >
              ⚙
            </button>
          </>
        }
      />

      {/* Floor filter + legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface/60 px-3 py-2">
        <div className="flex gap-2">
          <FloorTab active={floor === 'ALL'} onClick={() => setFloor('ALL')}>
            All
          </FloorTab>
          {floors.map((f) => (
            <FloorTab key={f} active={floor === f} onClick={() => setFloor(f)}>
              Floor {f}
            </FloorTab>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {LEGEND.map((l) => (
            <div key={l.label} className="flex items-center gap-1.5 text-xs text-muted">
              <span className="h-3 w-3 rounded" style={{ backgroundColor: l.colorVar }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>

      {/* Room grid */}
      <div className="min-h-0 flex-1 overflow-auto p-3" style={{ overscrollBehavior: 'contain' }}>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
        >
          {shown.map((room) => (
            <RoomButton
              key={room.id}
              room={room}
              currencySymbol={config.currencySymbol}
              balance={room.folioId ? folioBalance(folioLines, room.folioId) : undefined}
              onClick={() => onRoomClick(room)}
            />
          ))}
        </div>
      </div>

      {/* Vacant/OOO room actions */}
      <Modal
        open={!!actionsFor}
        onClose={() => setActionsFor(null)}
        title={actionsFor ? `Room ${actionsFor.number} — ${roomVisual(actionsFor).status}` : ''}
      >
        {actionsFor && (
          <div className="flex flex-col gap-3 p-5">
            {actionsFor.avail !== 'OOO' && (
              <>
                <button
                  className="tap rounded-btn bg-primary px-4 py-4 text-left text-lg font-semibold text-white hover:bg-primary-2"
                  onClick={() => {
                    setCheckInFor(actionsFor)
                    setActionsFor(null)
                  }}
                >
                  Check in guest
                  <div className="text-sm font-normal text-white/80">
                    Open a folio and post the room-night charge
                  </div>
                </button>
                <button
                  className="tap rounded-btn bg-panel-2 px-4 py-4 text-left text-lg font-semibold hover:bg-panel-3"
                  onClick={() => {
                    selectRoom(actionsFor.id)
                    navigate('/order')
                  }}
                >
                  Walk-in order
                  <div className="text-sm font-normal text-muted">
                    Ring items and settle by cash/card (no folio)
                  </div>
                </button>
                {actionsFor.hk === 'DIRTY' && (
                  <button
                    className="tap rounded-btn bg-panel-2 px-4 py-4 text-left text-lg font-semibold hover:bg-panel-3"
                    onClick={() => {
                      setRoomHousekeeping(actionsFor.id, 'CLEAN')
                      setActionsFor(null)
                    }}
                  >
                    Mark clean
                    <div className="text-sm font-normal text-muted">Housekeeping status → Clean</div>
                  </button>
                )}
              </>
            )}
            {actionsFor.avail === 'OOO' && (
              <div className="text-muted">This room is out of order — no POS actions available.</div>
            )}
          </div>
        )}
      </Modal>

      <CheckInDialog
        open={!!checkInFor}
        room={checkInFor}
        onClose={() => setCheckInFor(null)}
        onConfirm={(guest, nights, rate) => {
          if (checkInFor) checkInRoom(checkInFor.id, guest, nights, rate)
          setCheckInFor(null)
        }}
      />

      <FolioDialog
        open={!!folioFor}
        room={folioFor}
        onClose={() => setFolioFor(null)}
        onCheckedOut={() => setFolioFor(null)}
      />

      {/* Settings */}
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Settings">
        <div className="flex flex-col gap-3 p-5">
          <div className="text-sm text-muted">
            Single property · {supabaseEnabled ? 'online backend' : 'local/offline mode'}
          </div>
          {supabaseEnabled && can(role, 'close_day') && (
            <button
              className="tap rounded-btn bg-panel-2 px-4 py-3 text-left font-semibold hover:bg-panel-3"
              onClick={() => {
                setShowSettings(false)
                setShowCloseDay(true)
              }}
            >
              Close day (End of Day)
              <div className="text-sm font-normal text-muted">
                Lock today&apos;s Z-report and roll to the next business date
              </div>
            </button>
          )}
          {supabaseEnabled && can(role, 'set_pin') && (
            <button
              className="tap rounded-btn bg-panel-2 px-4 py-3 text-left font-semibold hover:bg-panel-3"
              onClick={() => {
                setShowSettings(false)
                setShowSetPin(true)
              }}
            >
              Set my manager PIN
              <div className="text-sm font-normal text-muted">
                Staff enter it to get your approval at the till
              </div>
            </button>
          )}
          {can(role, 'reset_data') ? (
            <button
              className="tap rounded-btn bg-panel-2 px-4 py-3 text-left font-semibold hover:bg-panel-3"
              onClick={() => {
                if (confirm('Reset all demo data (rooms, folios, tickets)?')) {
                  reseed()
                  setShowSettings(false)
                }
              }}
            >
              Reset demo data
            </button>
          ) : (
            <div className="rounded-btn bg-panel-2 px-4 py-3 text-sm text-muted">
              Resetting demo data needs a manager.
            </div>
          )}
        </div>
      </Modal>

      <SetPinDialog open={showSetPin} onClose={() => setShowSetPin(false)} />
      <CloseDayDialog open={showCloseDay} onClose={() => setShowCloseDay(false)} />
    </div>
  )
}

function FloorTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`tap rounded-btn px-4 py-2 text-sm font-semibold ${
        active ? 'bg-primary text-white' : 'bg-panel-2 text-muted hover:bg-panel-3'
      }`}
    >
      {children}
    </button>
  )
}
