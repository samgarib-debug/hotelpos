import { useMemo, useState } from 'react'
import type { Room } from '../types'
import { usePos, folioBalance } from '../store/pos'
import { formatMoney } from '../lib/money'
import { Modal } from './Modal'
import { ReceiptView, type ReceiptData } from './ReceiptView'

interface FolioDialogProps {
  open: boolean
  room: Room | null
  onClose: () => void
  onCheckedOut: () => void
}

export function FolioDialog({ open, room, onClose, onCheckedOut }: FolioDialogProps) {
  const config = usePos((s) => s.config)
  const folios = usePos((s) => s.folios)
  const folioLines = usePos((s) => s.folioLines)
  const bookings = usePos((s) => s.bookings)
  const postFolioPayment = usePos((s) => s.postFolioPayment)
  const checkOutRoom = usePos((s) => s.checkOutRoom)
  const applyPrepaidCredit = usePos((s) => s.applyPrepaidCredit)
  const [error, setError] = useState<string | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)

  const folioId = room?.folioId
  const folio = folioId ? folios[folioId] : undefined
  const lines = useMemo(
    () => (folioId ? folioLines.filter((l) => l.folioId === folioId && !l.isReversed) : []),
    [folioLines, folioId],
  )
  const balance = folioId ? folioBalance(folioLines, folioId) : 0

  // A checked-in booking whose prepaid credit never landed on this folio
  // (the credit RPC failed during check-in) — offer an idempotent retry.
  const pendingPrepaid = useMemo(
    () =>
      folioId
        ? bookings.find(
            (b) =>
              b.folioId === folioId &&
              b.amountPaid > 0 &&
              !folioLines.some((l) => l.idempotencyKey === `prepaid-${b.id}`),
          )
        : undefined,
    [bookings, folioLines, folioId],
  )

  if (!room || !folio) return null

  const receipt: ReceiptData = {
    title: 'GUEST FOLIO',
    propertyName: config.propertyName,
    meta: [
      { label: 'Folio', value: folio.folioNumber },
      { label: 'Room', value: room.number },
      { label: 'Guest', value: folio.guestName },
      { label: 'Date', value: config.businessDate },
    ],
    lines: lines.map((l) => ({
      name: l.description,
      amount: formatMoney(l.amount, config),
    })),
    totals: [{ label: 'Balance', value: formatMoney(balance, config), strong: true }],
    footer: balance <= 0.001 ? 'PAID IN FULL — Thank you!' : 'Balance due',
  }

  const settle = async (kind: 'CASH' | 'CARD') => {
    if (balance <= 0) return
    const res = await postFolioPayment(folio.id, kind, balance)
    setError('error' in res ? res.error : null)
  }

  const doCheckout = async () => {
    const res = await checkOutRoom(room.id)
    if ('error' in res) {
      setError(res.error)
    } else {
      onCheckedOut()
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={`Folio — Room ${room.number} · ${folio.guestName}`} width="min(640px, 96vw)">
        <div className="flex flex-col">
          <div className="max-h-[46dvh] overflow-auto px-5 py-3">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1">Description</th>
                  <th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-line/60">
                    <td className="py-2 pr-2">
                      <div>{l.description}</div>
                      <div className="text-xs text-muted">
                        {l.type} · {l.businessDate}
                      </div>
                    </td>
                    <td className={`py-2 text-right font-semibold ${l.amount < 0 ? 'text-success' : ''}`}>
                      {formatMoney(l.amount, config)}
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-6 text-center text-muted">
                      No charges yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            <span className="text-muted">Balance</span>
            <span className="text-2xl font-bold">{formatMoney(balance, config)}</span>
          </div>

          {error && (
            <div className="mx-5 mb-2 rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line p-4">
            {pendingPrepaid && (
              <button
                className="tap w-full rounded-btn bg-warn/20 px-4 py-3 font-semibold text-warn hover:bg-warn/30"
                onClick={async () => {
                  const res = await applyPrepaidCredit(pendingPrepaid.id, folio.id)
                  setError('error' in res ? res.error : null)
                }}
              >
                Apply prepaid credit · {formatMoney(pendingPrepaid.amountPaid, config)}
              </button>
            )}
            <button
              disabled={balance <= 0}
              className="tap flex-1 rounded-btn bg-panel-2 px-4 py-3 font-semibold hover:bg-panel-3 disabled:opacity-40"
              onClick={() => settle('CASH')}
            >
              Settle · Cash
            </button>
            <button
              disabled={balance <= 0}
              className="tap flex-1 rounded-btn bg-panel-2 px-4 py-3 font-semibold hover:bg-panel-3 disabled:opacity-40"
              onClick={() => settle('CARD')}
            >
              Settle · Card
            </button>
            <button
              className="tap flex-1 rounded-btn bg-panel-2 px-4 py-3 font-semibold hover:bg-panel-3"
              onClick={() => setShowReceipt(true)}
            >
              Print Folio
            </button>
            <button
              className="tap flex-1 rounded-btn bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-2"
              onClick={doCheckout}
            >
              Check out
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showReceipt} onClose={() => setShowReceipt(false)} title="Folio Receipt">
        <ReceiptView data={receipt} />
        <div className="flex justify-end gap-3 border-t border-line p-4">
          <button className="tap rounded-btn px-5 py-3 text-muted hover:bg-panel-2" onClick={() => setShowReceipt(false)}>
            Close
          </button>
          <button
            className="tap rounded-btn bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-2"
            onClick={() => window.print()}
          >
            Print
          </button>
        </div>
      </Modal>
    </>
  )
}
