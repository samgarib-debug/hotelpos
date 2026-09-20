import { useState } from 'react'
import { usePos, type DayClosure } from '../store/pos'
import { formatMoney } from '../lib/money'
import { fmtDateTime } from '../lib/date'
import { Modal } from './Modal'
import { ReceiptView, type ReceiptData } from './ReceiptView'

interface CloseDayDialogProps {
  open: boolean
  onClose: () => void
}

/** End of Day: confirm → server closes the period → printable Z-report. */
export function CloseDayDialog({ open, onClose }: CloseDayDialogProps) {
  const config = usePos((s) => s.config)
  const closeDay = usePos((s) => s.closeDay)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closure, setClosure] = useState<DayClosure | null>(null)

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await closeDay()
    setBusy(false)
    if ('error' in res) setError(res.error)
    else setClosure(res.closure)
  }

  const done = () => {
    setClosure(null)
    setError(null)
    onClose()
  }

  const receipt: ReceiptData | null = closure
    ? {
        title: 'END OF DAY — Z REPORT',
        propertyName: config.propertyName,
        meta: [
          { label: 'Business date', value: closure.business_date },
          { label: 'Closed at', value: fmtDateTime(closure.closed_at) },
        ],
        lines: [
          { name: `Cash (${closure.cash_count})`, amount: formatMoney(closure.cash_total, config) },
          { name: `Card (${closure.card_count})`, amount: formatMoney(closure.card_total, config) },
          {
            name: `Room charges (${closure.room_charge_count})`,
            amount: formatMoney(closure.room_charge_total, config),
          },
          { name: `Comps (${closure.comp_count})`, amount: formatMoney(closure.comp_total, config) },
        ],
        totals: [
          {
            label: 'Collected (cash + card)',
            value: formatMoney(closure.cash_total + closure.card_total, config),
            strong: true,
          },
          { label: 'Tickets settled', value: String(closure.tickets_settled) },
          { label: 'PIN approvals', value: String(closure.approvals_count) },
          {
            label: `Open folios (${closure.open_folio_count})`,
            value: formatMoney(closure.open_folio_total, config),
          },
        ],
        footer: `Next business date: ${usePos.getState().config.businessDate}`,
      }
    : null

  return (
    <Modal
      open={open}
      onClose={done}
      title={closure ? 'Day closed' : 'End of Day'}
      width="min(460px, 94vw)"
    >
      {receipt ? (
        <>
          <ReceiptView data={receipt} />
          <div className="flex justify-end gap-3 border-t border-line p-4">
            <button
              className="tap rounded-btn px-5 py-3 text-muted hover:bg-panel-2"
              onClick={done}
            >
              Close
            </button>
            <button
              className="tap rounded-btn bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-2"
              onClick={() => window.print()}
            >
              Print
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-4 p-5">
          <div className="rounded-btn bg-panel-2 px-4 py-3 text-sm">
            Closes business date <span className="font-semibold">{config.businessDate}</span>:
            snapshots the day&apos;s takings into a locked Z-report and rolls the till to the
            next day. Every open ticket must be settled or cleared first. This cannot be
            undone.
          </div>
          {error && (
            <div className="rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
          )}
          <div className="flex gap-3">
            <button
              className="tap flex-1 rounded-btn bg-panel-2 py-3 font-semibold text-muted hover:bg-panel-3"
              onClick={done}
            >
              Cancel
            </button>
            <button
              disabled={busy}
              className="tap flex-1 rounded-btn bg-primary py-3 font-semibold text-white hover:bg-primary-2 disabled:opacity-40"
              onClick={() => void run()}
            >
              {busy ? 'Closing…' : 'Close the day'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
