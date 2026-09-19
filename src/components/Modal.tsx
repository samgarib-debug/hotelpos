import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: string
}

/** Lightweight overlay modal (backdrop click / Esc to close). */
export function Modal({ open, onClose, title, children, width = 'min(560px, 94vw)' }: ModalProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          'flex max-h-[92dvh] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl',
        )}
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              className="tap rounded-md px-3 py-1 text-muted hover:bg-panel-2"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  )
}
