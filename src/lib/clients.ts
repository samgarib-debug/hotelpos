import type { Booking, Client } from '../types'

/** One client record, with its own booking stats. Each row is its own entry —
 *  we deliberately do NOT merge rows that merely share a name (two different
 *  guests can share a name), which would conflate distinct people, split a
 *  person when a key field is edited, or hide details held on a sibling row.
 *  Duplicate rows for the same returning guest are prevented at the source:
 *  picking a guest from the search reuses their existing record instead of
 *  creating a new one. */
export interface ClientEntry {
  client: Client
  bookingCount: number
  lastStay?: string // ISO of the most recent booking start for this client
}

const norm = (s: string | undefined | null) => (s ?? '').trim().toLowerCase()

/** Every client as its own entry, with booking count + last stay, name-sorted. */
export function clientList(clients: Client[], bookings: Booking[] = []): ClientEntry[] {
  const byClient = new Map<string, Booking[]>()
  for (const b of bookings) {
    const g = byClient.get(b.clientId)
    if (g) g.push(b)
    else byClient.set(b.clientId, [b])
  }
  return clients
    .filter((c) => norm(c.name))
    .map((client) => {
      const theirs = byClient.get(client.id) ?? []
      const lastStay = theirs.map((b) => b.start).sort((a, b) => (a < b ? 1 : -1))[0]
      return { client, bookingCount: theirs.length, lastStay }
    })
    .sort((a, b) => a.client.name.localeCompare(b.client.name))
}

/** Filter clients by a free-text query (name / phone / email / id). */
export function searchClients(entries: ClientEntry[], query: string, limit = 8): ClientEntry[] {
  const q = norm(query)
  if (!q) return []
  const hit = (c: Client) =>
    norm(c.name).includes(q) ||
    norm(c.phone).includes(q) ||
    norm(c.email).includes(q) ||
    norm(c.idNumber).includes(q)
  return entries.filter((e) => hit(e.client)).slice(0, limit)
}
