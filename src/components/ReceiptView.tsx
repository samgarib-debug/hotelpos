export interface ReceiptLine {
  name: string
  qty?: number
  amount: string
  muted?: boolean
}

export interface ReceiptTotal {
  label: string
  value: string
  strong?: boolean
}

export interface ReceiptData {
  title: string
  propertyName: string
  meta: { label: string; value: string }[]
  lines: ReceiptLine[]
  totals: ReceiptTotal[]
  footer?: string
}

/** White-paper receipt. Wrapped in #print-area so window.print() isolates it. */
export function ReceiptView({ data }: { data: ReceiptData }) {
  return (
    <div className="flex flex-col items-center bg-panel p-4">
      <div
        id="print-area"
        className="w-[320px] bg-white p-5 font-mono text-[13px] leading-tight text-black"
      >
        <div className="mb-2 text-center">
          <div className="text-base font-bold uppercase">{data.propertyName}</div>
          <div className="text-[12px]">{data.title}</div>
        </div>
        <div className="my-2 border-t border-dashed border-black/40" />
        {data.meta.map((m) => (
          <div key={m.label} className="flex justify-between">
            <span>{m.label}</span>
            <span className="font-semibold">{m.value}</span>
          </div>
        ))}
        <div className="my-2 border-t border-dashed border-black/40" />
        {data.lines.map((l, i) => (
          <div key={i} className={`flex justify-between ${l.muted ? 'opacity-60' : ''}`}>
            <span className="pr-2">
              {l.qty != null ? `${l.qty}× ` : ''}
              {l.name}
            </span>
            <span className="whitespace-nowrap font-semibold">{l.amount}</span>
          </div>
        ))}
        <div className="my-2 border-t border-dashed border-black/40" />
        {data.totals.map((t) => (
          <div
            key={t.label}
            className={`flex justify-between ${t.strong ? 'text-[15px] font-bold' : ''}`}
          >
            <span>{t.label}</span>
            <span>{t.value}</span>
          </div>
        ))}
        {data.footer && (
          <>
            <div className="my-2 border-t border-dashed border-black/40" />
            <div className="text-center text-[12px]">{data.footer}</div>
          </>
        )}
      </div>
    </div>
  )
}
