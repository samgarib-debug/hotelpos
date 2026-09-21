import type { Booking, Client, PropertyConfig, Room } from '../types'
import type { ReceiptData } from '../components/ReceiptView'
import { formatMoney, round2 } from './money'
import { fmtDate, fmtDateTime } from './date'

/** Build the printable confirmation ticket for a booking/reservation. */
export function buildBookingReceipt(
  booking: Booking,
  client: Client | undefined,
  room: Room | undefined,
  config: PropertyConfig,
): ReceiptData {
  const nightly = booking.mode === 'NIGHTLY'
  const balance = round2(booking.total - booking.amountPaid)
  const base = booking.kind === 'BOOKING' ? 'BOOKING' : 'RESERVATION'
  const statusLabel = booking.status.replace('_', ' ')
  const active =
    booking.status === 'RESERVED' ||
    booking.status === 'BOOKED' ||
    booking.status === 'CHECKED_IN'
  const voided = booking.status === 'CANCELLED' || booking.status === 'NO_SHOW'

  const lines = nightly
    ? [
        {
          name: `${room?.roomType ?? 'Room'} @ ${formatMoney(booking.rate, config)}/night`,
          qty: booking.nights ?? 1,
          amount: formatMoney(booking.total, config),
        },
      ]
    : [
        {
          name: `Day-use — ${room?.roomType ?? 'Room'}`,
          amount: formatMoney(booking.total, config),
        },
      ]

  const totals = [
    { label: 'Total', value: formatMoney(booking.total, config), strong: true },
  ]
  if (booking.amountPaid > 0) {
    totals.push({
      label: `Prepaid (${booking.paymentKind ?? 'PAID'})`,
      value: `- ${formatMoney(booking.amountPaid, config)}`,
      strong: false,
    })
  }
  totals.push({
    label: balance > 0 ? 'Balance due at check-in' : 'Balance',
    value: formatMoney(balance, config),
    strong: balance > 0,
  })

  let footer: string
  if (voided) {
    footer = `${statusLabel} — this booking is not valid for stay.`
  } else if (booking.status === 'CHECKED_OUT') {
    footer = `Stay completed — ${booking.ref}.`
  } else if (booking.kind === 'BOOKING') {
    footer = `Confirmation ${booking.ref} — prepaid & guaranteed. Please present on arrival.`
  } else {
    footer = `Reservation ${booking.ref} — held, pay at check-in. Please present on arrival.`
  }

  return {
    // Non-active bookings must NOT print as a live confirmation.
    title: active ? `${base} CONFIRMATION` : `${base} — ${statusLabel}`,
    propertyName: config.propertyName,
    meta: [
      { label: 'Confirmation', value: booking.ref },
      { label: 'Status', value: statusLabel },
      { label: 'Guest', value: client?.name ?? 'Guest' },
      { label: 'Room', value: room ? `${room.number} · ${room.roomType}` : '—' },
      { label: 'Check-in', value: fmtDateTime(booking.start) },
      { label: 'Check-out', value: fmtDateTime(booking.end) },
      { label: 'Issued', value: fmtDate(booking.createdAt) },
    ],
    lines,
    totals,
    footer,
  }
}
