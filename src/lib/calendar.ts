import type { Booking, Client, Room } from '../types'
import { addDays, lastName } from './date'

export interface CalEvent {
  booking: Booking
  label: string
  color: string
  allDay: boolean // nightly stays render as spanning bars
  coverStart: Date // midnight, inclusive
  coverEnd: Date // midnight, inclusive (last covered day)
  start: Date // datetime (timed positioning)
  end: Date // datetime
}

export function chipColor(b: Booking): string {
  if (b.status === 'CHECKED_OUT') return 'var(--color-room-dirty)'
  if (b.status === 'CHECKED_IN') return 'var(--color-success)'
  return b.kind === 'BOOKING' ? 'var(--color-primary)' : 'var(--color-warn)'
}

export function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function dayDiff(a: Date, b: Date): number {
  return Math.round((midnight(b).getTime() - midnight(a).getTime()) / 86400000)
}

export function buildEvents(
  bookings: Booking[],
  roomById: Map<string, Room>,
  clientById: Map<string, Client>,
): CalEvent[] {
  const out: CalEvent[] = []
  for (const b of bookings) {
    if (b.status === 'CANCELLED' || b.status === 'NO_SHOW') continue
    const room = roomById.get(b.roomId)
    const client = clientById.get(b.clientId)
    const label = `${room ? room.number : '—'} · ${client ? lastName(client.name) : 'Guest'}`
    const start = new Date(b.start)
    const end = new Date(b.end)
    if (b.mode === 'TIMED') {
      const day = midnight(start)
      out.push({ booking: b, label, color: chipColor(b), allDay: false, coverStart: day, coverEnd: day, start, end })
    } else {
      const cs = midnight(start)
      const ce = addDays(midnight(end), -1) // last night
      out.push({ booking: b, label, color: chipColor(b), allDay: true, coverStart: cs, coverEnd: ce < cs ? cs : ce, start, end })
    }
  }
  return out
}

export function chunkWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return weeks
}

export interface Placed {
  event: CalEvent
  colStart: number
  colEnd: number
  lane: number
}

/** Greedy lane assignment so overlapping bars stack instead of colliding. */
function assignLanes(items: { event: CalEvent; colStart: number; colEnd: number }[]): Placed[] {
  const sorted = [...items].sort(
    (a, b) => a.colStart - b.colStart || b.colEnd - b.colStart - (a.colEnd - a.colStart),
  )
  const lanes: { colStart: number; colEnd: number }[][] = []
  const res: Placed[] = []
  for (const it of sorted) {
    let lane = 0
    for (; ; lane++) {
      const laneItems = lanes[lane] ?? (lanes[lane] = [])
      const conflict = laneItems.some((x) => !(it.colEnd < x.colStart || it.colStart > x.colEnd))
      if (!conflict) {
        laneItems.push({ colStart: it.colStart, colEnd: it.colEnd })
        break
      }
    }
    res.push({ event: it.event, colStart: it.colStart, colEnd: it.colEnd, lane })
  }
  return res
}

/** Place events (all-day + single-day) within a contiguous run of `cols` days. */
export function placeSpanning(colDays: Date[], events: CalEvent[]): Placed[] {
  const first = colDays[0]
  const last = colDays[colDays.length - 1]
  const items: { event: CalEvent; colStart: number; colEnd: number }[] = []
  for (const e of events) {
    if (e.coverEnd < first || e.coverStart > last) continue
    const s = e.coverStart < first ? first : e.coverStart
    const en = e.coverEnd > last ? last : e.coverEnd
    items.push({ event: e, colStart: dayDiff(first, s), colEnd: dayDiff(first, en) })
  }
  return assignLanes(items)
}

/** Lay out timed events in one day column into side-by-side lanes. */
export function layoutDayTimed(events: CalEvent[]): { event: CalEvent; lane: number; lanes: number }[] {
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime())
  const laneEnds: number[] = []
  const placed: { event: CalEvent; lane: number }[] = []
  for (const e of sorted) {
    let lane = laneEnds.findIndex((end) => end <= e.start.getTime())
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(e.end.getTime())
    } else {
      laneEnds[lane] = e.end.getTime()
    }
    placed.push({ event: e, lane })
  }
  const lanes = Math.max(1, laneEnds.length)
  return placed.map((p) => ({ ...p, lanes }))
}
