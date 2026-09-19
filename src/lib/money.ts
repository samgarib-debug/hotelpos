import type { PropertyConfig, Ticket, TicketTotals } from '../types'

/** Round to 2 decimals, banker-safe enough for a Phase-1 demo.
 *  NOTE: production should store integer minor units or use a decimal lib. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function formatMoney(n: number, cfg: Pick<PropertyConfig, 'currencySymbol'>): string {
  const neg = n < 0
  const v = Math.abs(round2(n)).toFixed(2)
  return `${neg ? '-' : ''}${cfg.currencySymbol}${v}`
}

/** Compute a ticket's rolled-up totals. Tax is exclusive by default. */
export function computeTotals(ticket: Ticket, cfg: PropertyConfig): TicketTotals {
  const subtotal = round2(
    ticket.lines
      .filter((l) => l.state !== 'VOID')
      .reduce((sum, l) => sum + l.lineTotal, 0),
  )
  const discount = round2(subtotal * (ticket.discountPct || 0))
  const net = round2(subtotal - discount)
  const service = round2(net * cfg.serviceRate)

  let tax: number
  let grandTotal: number
  if (cfg.taxInclusive) {
    // price already includes tax
    const taxable = round2(net + service)
    tax = round2(taxable - taxable / (1 + cfg.taxRate))
    grandTotal = taxable
  } else {
    tax = round2((net + service) * cfg.taxRate)
    grandTotal = round2(net + service + tax)
  }

  return { subtotal, discount, service, tax, grandTotal }
}
