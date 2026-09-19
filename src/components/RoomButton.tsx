import type { Room } from '../types'
import { roomVisual } from '../lib/roomState'
import { formatMoney } from '../lib/money'
import { cn } from '../lib/cn'

interface RoomButtonProps {
  room: Room
  balance?: number
  currencySymbol: string
  onClick: () => void
}

export function RoomButton({ room, balance, currencySymbol, onClick }: RoomButtonProps) {
  const v = roomVisual(room)
  return (
    <button
      onClick={onClick}
      className={cn(
        'tap relative flex h-32 flex-col items-start justify-between overflow-hidden rounded-btn border border-line bg-panel p-3 text-left',
        'hover:bg-panel-2',
      )}
      style={{ borderLeft: `6px solid ${v.colorVar}` }}
    >
      <div className="flex w-full items-start justify-between">
        <span className="text-2xl font-bold tracking-tight">{room.number}</span>
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: v.colorVar }}
        >
          {v.label}
        </span>
      </div>

      <div className="w-full">
        <div className="truncate text-sm text-muted">{room.roomType}</div>
        {room.fo === 'OCCUPIED' ? (
          <div className="truncate text-sm font-medium">{room.guestName}</div>
        ) : (
          <div className="text-sm text-muted">{v.status}</div>
        )}
      </div>

      {room.folioId != null && balance != null && (
        <div className="absolute bottom-2 right-3 text-sm font-semibold text-fg/90">
          {formatMoney(balance, { currencySymbol })}
        </div>
      )}
    </button>
  )
}
