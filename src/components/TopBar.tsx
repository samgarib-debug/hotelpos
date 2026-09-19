import type { ReactNode } from 'react'

interface TopBarProps {
  left?: ReactNode
  center?: ReactNode
  right?: ReactNode
}

export function TopBar({ left, center, right }: TopBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3">
      <div className="flex min-w-0 items-center gap-2">{left}</div>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-center">
        {center}
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </header>
  )
}
