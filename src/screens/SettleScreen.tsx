import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PaymentKind } from '../types'
import { usePos, folioBalance } from '../store/pos'
import { computeTotals, formatMoney, round2 } from '../lib/money'
import { TopBar } from '../components/TopBar'
import { Numpad } from '../components/Numpad'
import { Modal } from '../components/Modal'
import { ReceiptView, type ReceiptData } from '../components/ReceiptView'

export function SettleScreen() {
  const navigate = useNavigate()
  const config = usePos((s) => s.config)
  const rooms = usePos((s) => s.rooms)
  const tickets = usePos((s) => s.tickets)
  const activeRoomId = usePos((s) => s.activeRoomId)
  const activeTicketId = usePos((s) => s.activeTicketId)
  const settleTicket = usePos((s) => s.settleTicket)
  const clearActive = usePos((s) => s.clearActive)

  const [buffer, setBuffer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmRoomCharge, setConfirmRoomCharge] = useState(false)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)

  const ticket = activeTicketId ? tickets[activeTicketId] : undefined
  const room = activeRoomId ? rooms.find((r) => r.id === activeRoomId) : undefined

  useEffect(() => {
    if (!ticket) navigate('/floor', { replace: true })
  }, [ticket, navigate])

  const totals = useMemo(
    () =>
      ticket
        ? computeTotals(ticket, config)
        : { subtotal: 0, discount: 0, service: 0, tax: 0, grandTotal: 0 },
    [ticket, config],
  )

  if (!ticket) return null

  const total = totals.grandTotal
  const tendered = buffer === '' ? 0 : Number(buffer)
  const change = round2(Math.max(0, tendered - total))
  const canRoomCharge = !!room?.folioId

  const buildReceipt = (kind: PaymentKind, tend?: number, chg?: number): ReceiptData => {
    const meta = [
      { label: 'Ticket', value: ticket.number },
      { label: 'Room', value: room?.number ?? 'Walk-in' },
    ]
    if (room?.guestName) meta.push({ label: 'Guest', value: room.guestName })
    meta.push({ label: 'Date', value: config.businessDate })
    meta.push({ label: 'Tender', value: kind.replace('_', ' ') })

    const totalsRows = [
      { label: 'Subtotal', value: formatMoney(totals.subtotal, config) },
      ...(totals.discount > 0
        ? [{ label: 'Discount', value: `-${formatMoney(totals.discount, config)}` }]
        : []),
      ...(config.serviceRate > 0
        ? [{ label: 'Service', value: formatMoney(totals.service, config) }]
        : []),
      { label: 'Tax', value: formatMoney(totals.tax, config) },
      { label: 'TOTAL', value: formatMoney(total, config), strong: true },
    ]
    if (kind === 'CASH' && tend != null) {
      totalsRows.push({ label: 'Cash', value: formatMoney(tend, config) })
      totalsRows.push({ label: 'Change', value: formatMoney(chg ?? 0, config) })
    }
    if (kind === 'ROOM_CHARGE' && room?.folioId) {
      const newBal = folioBalance(usePos.getState().folioLines, room.folioId)
      totalsRows.push({ label: 'Posted to folio', value: room.number })
      totalsRows.push({ label: 'Folio balance', value: formatMoney(newBal, config) })
    }

    return {
      title:
        kind === 'ROOM_CHARGE'
          ? 'ROOM CHARGE VOUCHER'
          : kind === 'COMP'
            ? 'COMPLIMENTARY'
            : 'SALES RECEIPT',
      propertyName: config.propertyName,
      meta,
      lines: ticket.lines
        .filter((l) => l.state !== 'VOID')
        .map((l) => ({ name: l.name, qty: l.qty, amount: formatMoney(l.lineTotal, config) })),
      totals: totalsRows,
      footer: 'Thank you!',
    }
  }

  const doSettle = (kind: PaymentKind, tend?: number) => {
    const res = settleTicket(kind, tend != null ? { tendered: tend } : undefined)
    if ('error' in res) {
      setError(res.error)
      return
    }
    setError(null)
    setReceipt(buildReceipt(kind, res.tendered, res.change))
  }

  const onCash = () => {
    const tend = buffer === '' ? total : tendered
    if (tend < total) {
      setError('Cash tendered is less than the total.')
      return
    }
    doSettle('CASH', tend)
  }

  const quickCash = (amt: number) => setBuffer(String(amt))
  const nextUp = (step: number) => Math.ceil(total / step) * step

  return (
    <div className="flex h-full flex-col">
      <TopBar
        left={
          <button
            className="tap rounded-btn bg-panel-2 px-4 py-2 font-semibold hover:bg-panel-3"
            onClick={() => navigate('/order')}
          >
            ← Order
          </button>
        }
        center={
          <div className="text-lg font-bold">
            Settle · Room {room?.number ?? 'Walk-in'}
            {room?.guestName ? ` · ${room.guestName}` : ''}
          </div>
        }
      />

      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: 'minmax(280px, 30%) 1fr minmax(220px, 24%)' }}
      >
        {/* LEFT: amounts */}
        <section className="flex min-h-0 flex-col border-r border-line bg-surface">
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {ticket.lines
              .filter((l) => l.state !== 'VOID')
              .map((l) => (
                <div key={l.id} className="flex justify-between py-1 text-sm">
                  <span className="truncate pr-2">
                    {l.qty}× {l.name}
                  </span>
                  <span className="font-semibold">{formatMoney(l.lineTotal, config)}</span>
                </div>
              ))}
          </div>
          <div className="shrink-0 border-t border-line bg-panel p-4">
            <div className="flex items-center justify-between text-muted">
              <span>Amount due</span>
            </div>
            <div className="text-4xl font-extrabold">{formatMoney(total, config)}</div>
            <div className="mt-3 flex justify-between text-lg">
              <span className="text-muted">Tendered</span>
              <span className="font-semibold">{formatMoney(tendered, config)}</span>
            </div>
            <div className="flex justify-between text-lg">
              <span className="text-muted">Change</span>
              <span className="font-semibold text-success">{formatMoney(change, config)}</span>
            </div>
          </div>
        </section>

        {/* CENTER: numpad + quick cash */}
        <section className="flex min-h-0 flex-col gap-3 overflow-auto p-3">
          <div className="grid grid-cols-2 gap-2">
            <QuickCash label={`Exact · ${formatMoney(round2(total), config)}`} onClick={() => quickCash(round2(total))} />
            <QuickCash label={formatMoney(nextUp(5), config)} onClick={() => quickCash(nextUp(5))} />
            <QuickCash label={formatMoney(nextUp(10), config)} onClick={() => quickCash(nextUp(10))} />
            <QuickCash label={formatMoney(nextUp(20), config)} onClick={() => quickCash(nextUp(20))} />
          </div>
          <div className="rounded-btn bg-panel px-3 py-2 text-right text-2xl font-bold">
            {buffer === '' ? '—' : formatMoney(tendered, config)}
          </div>
          <Numpad value={buffer} onChange={setBuffer} className="flex-1" />
        </section>

        {/* RIGHT: tenders */}
        <section className="flex min-h-0 flex-col gap-3 overflow-auto border-l border-line bg-surface p-3">
          {error && (
            <div className="rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
          )}
          <Tender label="Cash" sub="Tender & change" onClick={onCash} primary />
          <Tender label="Card" sub="Semi-integrated (stub)" onClick={() => doSettle('CARD')} />
          <Tender
            label="Room Charge"
            sub={canRoomCharge ? 'Post to guest folio' : 'No open folio'}
            onClick={() => (canRoomCharge ? setConfirmRoomCharge(true) : undefined)}
            disabled={!canRoomCharge}
          />
          <Tender label="Comp" sub="Complimentary" onClick={() => doSettle('COMP')} />
        </section>
      </div>

      {/* Two-factor room charge guard */}
      <Modal
        open={confirmRoomCharge}
        onClose={() => setConfirmRoomCharge(false)}
        title="Confirm room charge"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="rounded-btn bg-panel-2 p-4">
            <div className="text-sm text-muted">Posting</div>
            <div className="text-2xl font-bold">{formatMoney(total, config)}</div>
            <div className="mt-2 text-sm text-muted">to folio of</div>
            <div className="text-lg font-semibold">
              Room {room?.number} · {room?.guestName}
            </div>
          </div>
          <div className="text-sm text-muted">
            Verify the guest name matches the room before posting.
          </div>
          <div className="flex justify-end gap-3">
            <button
              className="tap rounded-btn px-5 py-3 text-muted hover:bg-panel-2"
              onClick={() => setConfirmRoomCharge(false)}
            >
              Cancel
            </button>
            <button
              className="tap rounded-btn bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-2"
              onClick={() => {
                setConfirmRoomCharge(false)
                doSettle('ROOM_CHARGE')
              }}
            >
              Confirm & Post
            </button>
          </div>
        </div>
      </Modal>

      {/* Receipt after settlement */}
      <Modal
        open={!!receipt}
        onClose={() => {
          setReceipt(null)
          clearActive()
          navigate('/floor')
        }}
        title="Payment complete"
      >
        {receipt && <ReceiptView data={receipt} />}
        <div className="flex justify-end gap-3 border-t border-line p-4">
          <button
            className="tap rounded-btn bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-2"
            onClick={() => window.print()}
          >
            Print
          </button>
          <button
            className="tap rounded-btn bg-panel-2 px-6 py-3 font-semibold hover:bg-panel-3"
            onClick={() => {
              setReceipt(null)
              clearActive()
              navigate('/floor')
            }}
          >
            Done
          </button>
        </div>
      </Modal>
    </div>
  )
}

function QuickCash({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="tap rounded-btn bg-panel-2 py-3 text-sm font-semibold hover:bg-panel-3"
    >
      {label}
    </button>
  )
}

function Tender({
  label,
  sub,
  onClick,
  primary,
  disabled,
}: {
  label: string
  sub: string
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`tap flex flex-col items-start rounded-btn px-4 py-4 text-left font-semibold disabled:opacity-40 ${
        primary ? 'bg-primary text-white hover:bg-primary-2' : 'bg-panel-2 hover:bg-panel-3'
      }`}
    >
      <span className="text-lg">{label}</span>
      <span className={`text-sm font-normal ${primary ? 'text-white/80' : 'text-muted'}`}>
        {sub}
      </span>
    </button>
  )
}
