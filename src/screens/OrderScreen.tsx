import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePos, folioBalance } from '../store/pos'
import { computeTotals, formatMoney } from '../lib/money'
import { TopBar } from '../components/TopBar'
import { Modal } from '../components/Modal'
import { FolioDialog } from '../components/FolioDialog'
import { useManagerApproval } from '../components/useManagerApproval'

export function OrderScreen() {
  const navigate = useNavigate()
  const config = usePos((s) => s.config)
  const rooms = usePos((s) => s.rooms)
  const tickets = usePos((s) => s.tickets)
  const products = usePos((s) => s.products)
  const categories = usePos((s) => s.categories)
  const folioLines = usePos((s) => s.folioLines)
  const activeRoomId = usePos((s) => s.activeRoomId)
  const activeTicketId = usePos((s) => s.activeTicketId)
  const activeCategoryId = usePos((s) => s.activeCategoryId)
  const setActiveCategory = usePos((s) => s.setActiveCategory)
  const addProduct = usePos((s) => s.addProduct)
  const setLineQty = usePos((s) => s.setLineQty)
  const voidLine = usePos((s) => s.voidLine)
  const setDiscount = usePos((s) => s.setDiscount)
  const submitTicket = usePos((s) => s.submitTicket)

  const approval = useManagerApproval()
  const [showDiscount, setShowDiscount] = useState(false)
  const [showFolio, setShowFolio] = useState(false)

  const ticket = activeTicketId ? tickets[activeTicketId] : undefined
  const room = activeRoomId ? rooms.find((r) => r.id === activeRoomId) : undefined

  // Guard: no active ticket -> back to board
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

  const sortedCats = [...categories].sort((a, b) => a.sortOrder - b.sortOrder)
  const activeCat = activeCategoryId ?? sortedCats[0]?.id
  const catProducts = products.filter((p) => p.categoryId === activeCat)
  const priorFolio = room?.folioId ? folioBalance(folioLines, room.folioId) : undefined

  const visibleLines = ticket.lines
  const canSettle = totals.grandTotal > 0

  return (
    <div className="flex h-full flex-col">
      <TopBar
        left={
          <button
            className="tap rounded-btn bg-panel-2 px-4 py-2 font-semibold hover:bg-panel-3"
            onClick={() => navigate('/floor')}
          >
            ← Rooms
          </button>
        }
        center={
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">
              Room {room?.number ?? '—'}
              {room?.guestName ? ` · ${room.guestName}` : ' · Walk-in'}
            </div>
            <div className="text-xs text-muted">
              Ticket {ticket.number}
              {priorFolio != null && ` · Folio balance ${formatMoney(priorFolio, config)}`}
            </div>
          </div>
        }
        right={
          room?.folioId ? (
            <button
              className="tap rounded-btn bg-panel-2 px-4 py-2 font-semibold hover:bg-panel-3"
              onClick={() => setShowFolio(true)}
            >
              Folio
            </button>
          ) : null
        }
      />

      {/* 3-zone grid */}
      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: 'minmax(300px, 26%) minmax(140px, 170px) 1fr',
        }}
      >
        {/* LEFT: order ticket */}
        <section className="flex min-h-0 flex-col border-r border-line bg-surface">
          <div
            className="min-h-0 flex-1 overflow-auto p-2"
            style={{ overscrollBehavior: 'contain' }}
          >
            {visibleLines.length === 0 && (
              <div className="mt-10 text-center text-muted">
                Tap products to add them to the ticket
              </div>
            )}
            {visibleLines.map((l) => (
              <div
                key={l.id}
                className={`mb-1.5 rounded-btn border-l-4 bg-panel px-2 py-2 ${
                  l.state === 'VOID'
                    ? 'border-l-danger opacity-50'
                    : l.state === 'NEW'
                      ? 'border-l-accent'
                      : 'border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`truncate font-medium ${l.state === 'VOID' ? 'line-through' : ''}`}
                  >
                    {l.name}
                  </span>
                  <span className="font-semibold">{formatMoney(l.lineTotal, config)}</span>
                </div>
                {l.state !== 'VOID' && (
                  <div className="mt-1 flex items-center gap-1">
                    {l.state === 'NEW' ? (
                      <>
                        <button
                          className="tap h-8 w-8 rounded bg-panel-2 text-lg hover:bg-panel-3"
                          onClick={() => setLineQty(l.id, l.qty - 1)}
                        >
                          −
                        </button>
                        <span className="w-8 text-center font-semibold">{l.qty}</span>
                        <button
                          className="tap h-8 w-8 rounded bg-panel-2 text-lg hover:bg-panel-3"
                          onClick={() => setLineQty(l.id, l.qty + 1)}
                        >
                          +
                        </button>
                      </>
                    ) : (
                      // Submitted lines are locked: void + re-add to change qty.
                      <span className="px-1 text-sm font-semibold text-muted">× {l.qty}</span>
                    )}
                    <span className="ml-1 text-xs text-muted">
                      @ {formatMoney(l.unitPrice, config)}
                    </span>
                    <button
                      title={
                        l.state === 'SUBMITTED' && approval.locked('void_submitted')
                          ? 'Manager PIN required'
                          : undefined
                      }
                      className="tap ml-auto h-8 rounded bg-panel-2 px-2 text-sm text-danger hover:bg-panel-3"
                      onClick={() =>
                        l.state === 'SUBMITTED'
                          ? approval.request('void_submitted', `Void ${l.name}`, () => voidLine(l.id))
                          : voidLine(l.id)
                      }
                    >
                      {l.state === 'NEW'
                        ? 'Remove'
                        : `Void${approval.locked('void_submitted') ? ' 🔒' : ''}`}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* totals */}
          <div className="shrink-0 border-t border-line bg-panel p-3 text-sm">
            <Row label="Subtotal" value={formatMoney(totals.subtotal, config)} />
            {totals.discount > 0 && (
              <Row
                label={`Discount (${Math.round(ticket.discountPct * 100)}%)`}
                value={`-${formatMoney(totals.discount, config)}`}
              />
            )}
            {config.serviceRate > 0 && (
              <Row label={`Service (${Math.round(config.serviceRate * 100)}%)`} value={formatMoney(totals.service, config)} />
            )}
            <Row label={`Tax (${Math.round(config.taxRate * 100)}%)`} value={formatMoney(totals.tax, config)} />
            <div className="mt-1 flex items-center justify-between border-t border-line pt-2 text-xl font-bold">
              <span>Total</span>
              <span>{formatMoney(totals.grandTotal, config)}</span>
            </div>
          </div>
        </section>

        {/* CENTER: category rail */}
        <section className="flex min-h-0 flex-col gap-2 overflow-auto border-r border-line bg-bg p-2">
          {sortedCats.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`tap min-h-[76px] rounded-btn px-2 py-2 text-center font-semibold text-white ${
                activeCat === c.id ? 'ring-2 ring-white/80' : ''
              }`}
              style={{ backgroundColor: c.color }}
            >
              {c.name}
            </button>
          ))}
        </section>

        {/* RIGHT: product grid */}
        <section
          className="min-h-0 overflow-auto p-2"
          style={{ overscrollBehavior: 'contain' }}
        >
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
          >
            {catProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => addProduct(p.id)}
                className="tap flex min-h-[92px] flex-col items-center justify-center gap-1 rounded-btn border border-line bg-panel-2 p-2 text-center hover:bg-panel-3"
              >
                <span className="font-semibold leading-tight">{p.name}</span>
                <span className="text-sm text-muted">{formatMoney(p.price, config)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* FUNCTION BAR */}
      <footer className="flex shrink-0 gap-2 border-t border-line bg-surface p-2">
        <FuncBtn onClick={submitTicket}>Submit / KOT</FuncBtn>
        <FuncBtn
          onClick={() => setShowDiscount(true)}
          title={approval.locked('discount') ? 'Manager PIN required' : undefined}
        >
          Discount{approval.locked('discount') ? ' 🔒' : ''}
        </FuncBtn>
        {room?.folioId && <FuncBtn onClick={() => setShowFolio(true)}>Folio</FuncBtn>}
        <button
          disabled={!canSettle}
          className="tap ml-auto min-w-[180px] rounded-btn bg-primary px-6 text-lg font-bold text-white hover:bg-primary-2 disabled:opacity-40"
          onClick={() => navigate('/settle')}
        >
          Settle · {formatMoney(totals.grandTotal, config)}
        </button>
      </footer>

      {/* Discount modal */}
      <Modal open={showDiscount} onClose={() => setShowDiscount(false)} title="Ticket discount">
        <div className="grid grid-cols-3 gap-3 p-5">
          {[0, 5, 10, 15, 20, 25].map((pct) => (
            <button
              key={pct}
              className="tap rounded-btn bg-panel-2 py-6 text-xl font-bold hover:bg-panel-3"
              onClick={() => {
                // PIN at apply time so the approval is fresh when the write syncs.
                setShowDiscount(false)
                approval.request('discount', `Apply ${pct}% discount`, () =>
                  setDiscount(pct / 100),
                )
              }}
            >
              {pct}%
            </button>
          ))}
        </div>
      </Modal>

      <FolioDialog
        open={showFolio}
        room={room ?? null}
        onClose={() => setShowFolio(false)}
        onCheckedOut={() => {
          setShowFolio(false)
          navigate('/floor')
        }}
      />

      {approval.dialog}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-muted">
      <span>{label}</span>
      <span className="text-fg">{value}</span>
    </div>
  )
}

function FuncBtn({
  onClick,
  children,
  disabled,
  title,
}: {
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="tap rounded-btn bg-panel-2 px-5 py-3 font-semibold hover:bg-panel-3 disabled:opacity-40"
    >
      {children}
    </button>
  )
}
