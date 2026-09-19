import { useMemo } from 'react'
import type { Booking } from '../../types'
import { isSameDay, monthGrid, ymd } from '../../lib/date'
import { chunkWeeks, placeSpanning, type CalEvent } from '../../lib/calendar'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_LANES = 3
const LANE_H = 22
const TOP_OFFSET = 26

interface Props {
  year: number
  month: number
  events: CalEvent[]
  onCreate: (ymd: string) => void
  onOpen: (b: Booking) => void
  onMore: (ymd: string) => void
}

export function MonthView({ year, month, events, onCreate, onOpen, onMore }: Props) {
  const weeks = useMemo(() => chunkWeeks(monthGrid(year, month)), [year, month])
  const today = new Date()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-line bg-surface/60 text-center text-xs font-semibold text-muted">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">{d}</div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {weeks.map((week, wi) => {
          const placed = placeSpanning(week, events)
          const visible = placed.filter((p) => p.lane < MAX_LANES)
          const hidden = new Array(7).fill(0)
          for (const p of placed) {
            if (p.lane >= MAX_LANES) for (let c = p.colStart; c <= p.colEnd; c++) hidden[c]++
          }
          return (
            <div key={wi} className="relative min-h-0 flex-1 border-b border-line">
              {/* background day cells */}
              <div className="grid h-full grid-cols-7">
                {week.map((d, ci) => {
                  const inMonth = d.getMonth() === month
                  const isToday = isSameDay(d, today)
                  return (
                    <div
                      key={ci}
                      role="button"
                      onClick={() => onCreate(ymd(d))}
                      className={`flex flex-col overflow-hidden border-r border-line p-1 text-left ${
                        inMonth ? 'hover:bg-panel/30' : 'bg-bg/60 text-muted'
                      }`}
                    >
                      <span
                        className={`text-sm ${
                          isToday
                            ? 'flex h-6 w-6 items-center justify-center rounded-full bg-primary font-bold text-white'
                            : inMonth
                              ? 'font-semibold'
                              : ''
                        }`}
                      >
                        {d.getDate()}
                      </span>
                      <span className="flex-1" />
                      {hidden[ci] > 0 && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            onMore(ymd(d))
                          }}
                          className="tap text-xs font-semibold text-muted hover:text-fg"
                        >
                          +{hidden[ci]} more
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* spanning bars overlay */}
              <div
                className="pointer-events-none absolute inset-x-0 grid grid-cols-7"
                style={{ top: TOP_OFFSET, gridAutoRows: `${LANE_H}px`, rowGap: 2 }}
              >
                {visible.map((p, i) => (
                  <div
                    key={i}
                    className="pointer-events-auto px-0.5"
                    style={{ gridColumn: `${p.colStart + 1} / span ${p.colEnd - p.colStart + 1}`, gridRow: p.lane + 1 }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(p.event.booking)
                      }}
                      className={`tap flex h-[20px] w-full items-center truncate rounded px-1.5 text-xs font-semibold text-white ${
                        p.event.booking.status === 'CHECKED_OUT' ? 'line-through opacity-70' : ''
                      }`}
                      style={{ backgroundColor: p.event.color }}
                    >
                      <span className="truncate">
                        {!p.event.allDay && `${p.event.start.getHours()}:${String(p.event.start.getMinutes()).padStart(2, '0')} `}
                        {p.event.label}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
