// Date helpers for the calendar + bookings. App runtime (Date is allowed here).

export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 42-day (6x7) grid starting on the Sunday on/before the 1st of the month. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = addDays(first, -first.getDay()) // back to Sunday
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** Whole nights between two YYYY-MM-DD dates. */
export function nightsBetween(startYMD: string, endYMD: string): number {
  const a = parseYMD(startYMD)
  const b = parseYMD(endYMD)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** Half-open interval overlap for ISO datetime strings: [s1,e1) ∩ [s2,e2). */
export function overlaps(s1: string, e1: string, s2: string, e2: string): boolean {
  return s1 < e2 && s2 < e1
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)} ${fmtTime(iso)}`
}

/** last name / last token for compact chips */
export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] || name
}
