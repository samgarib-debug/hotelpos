import { useMemo } from 'react'
import type { Booking } from '../../types'
import { isSameDay, ymd } from '../../lib/date'
import { layoutDayTimed, placeSpanning, type CalEvent } from '../../lib/calendar'

const START_HOUR = 7
const END_HOUR = 23
const HOUR_H = 48
const GRID_H = (END_HOUR - START_HOUR) * HOUR_H

interface Props {
  days: Date[] // 7 for week, 1 for day
  events: CalEvent[]
  onCreate: (ymd: string, startTime?: string, endTime?: string) => void
  onOpen: (b: Booking) => void
}

const hhmm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`

export function TimeGridView({ days, events, onCreate, onOpen }: Props) {
  const today = new Date()
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

  const allDay = useMemo(() => events.filter((e) => e.allDay), [events])
  const allDayPlaced = useMemo(() => placeSpanning(days, allDay), [days, allDay])
  const allDayLanes = Math.max(1, ...allDayPlaced.map((p) => p.lane + 1), 1)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Day headers */}
      <div className="flex shrink-0 border-b border-line bg-surface">
        <div className="w-14 shrink-0" />
        {days.map((d, i) => {
          const isToday = isSameDay(d, today)
          return (
            <div key={i} className="flex-1 border-l border-line py-1 text-center">
              <div className="text-xs text-muted">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
              <div
                className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                  isToday ? 'bg-primary text-white' : ''
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* All-day / multi-night spanning bars */}
      <div className="flex shrink-0 border-b border-line bg-surface/60">
        <div className="flex w-14 shrink-0 items-center justify-end pr-2 text-[10px] uppercase text-muted">
          all-day
        </div>
        <div
          className="relative grid flex-1"
          style={{
            gridTemplateColumns: `repeat(${days.length}, 1fr)`,
            gridAutoRows: '22px',
            rowGap: 2,
            minHeight: allDayLanes * 24 + 4,
            padding: '2px 0',
          }}
        >
          {allDayPlaced.map((p, i) => (
            <div
              key={i}
              className="px-0.5"
              style={{ gridColumn: `${p.colStart + 1} / span ${p.colEnd - p.colStart + 1}`, gridRow: p.lane + 1 }}
            >
              <button
                onClick={() => onOpen(p.event.booking)}
                className={`tap flex h-[20px] w-full items-center truncate rounded px-1.5 text-xs font-semibold text-white ${
                  p.event.booking.status === 'CHECKED_OUT' ? 'line-through opacity-70' : ''
                }`}
                style={{ backgroundColor: p.event.color }}
              >
                <span className="truncate">{p.event.label}</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Scrollable time grid */}
      <div className="flex min-h-0 flex-1 overflow-auto" style={{ overscrollBehavior: 'contain' }}>
        {/* hour gutter */}
        <div className="w-14 shrink-0" style={{ height: GRID_H }}>
          {hours.map((h) => (
            <div key={h} className="relative" style={{ height: HOUR_H }}>
              <span className="absolute -top-2 right-2 text-[11px] text-muted">
                {String(h).padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* day columns */}
        {days.map((d, di) => {
          const dayKey = ymd(d)
          const timed = events.filter((e) => !e.allDay && isSameDay(e.start, d))
          const placed = layoutDayTimed(timed)
          return (
            <div key={di} className="relative flex-1 border-l border-line" style={{ height: GRID_H }}>
              {/* clickable hour cells */}
              {hours.map((h) => (
                <div
                  key={h}
                  role="button"
                  onClick={() =>
                    onCreate(dayKey, `${String(h).padStart(2, '0')}:00`, `${String(h + 1).padStart(2, '0')}:00`)
                  }
                  className="border-b border-line/40 hover:bg-panel/20"
                  style={{ height: HOUR_H }}
                />
              ))}
              {/* timed events */}
              <div className="pointer-events-none absolute inset-0">
                {placed.map(({ event, lane, lanes }, i) => {
                  const startMin = event.start.getHours() * 60 + event.start.getMinutes() - START_HOUR * 60
                  const endMin = event.end.getHours() * 60 + event.end.getMinutes() - START_HOUR * 60
                  const top = Math.max(0, (startMin / 60) * HOUR_H)
                  const bottom = Math.min(GRID_H, (endMin / 60) * HOUR_H)
                  const height = Math.max(22, bottom - top)
                  const width = 100 / lanes
                  return (
                    <button
                      key={i}
                      onClick={() => onOpen(event.booking)}
                      className="pointer-events-auto absolute overflow-hidden rounded px-1.5 py-0.5 text-left text-xs font-semibold text-white"
                      style={{
                        top,
                        height,
                        left: `calc(${lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        backgroundColor: event.color,
                      }}
                    >
                      <div className="truncate">{event.label}</div>
                      <div className="truncate text-[10px] font-normal opacity-90">
                        {hhmm(event.start)}–{hhmm(event.end)}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
