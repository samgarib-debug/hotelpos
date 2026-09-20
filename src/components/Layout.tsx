import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  CalendarDays,
  LayoutGrid,
  ClipboardList,
  BarChart3,
  Users,
  LogOut,
  X,
} from 'lucide-react'
import { usePos } from '../store/pos'
import { signOut } from '../lib/auth'
import { useAuth } from '../lib/authContext'
import { can, type Permission } from '../lib/permissions'
import { supabaseEnabled } from '../lib/supabase'

interface NavItem {
  to: string
  label: string
  icon: typeof CalendarDays
  end: boolean
  perm?: Permission
}

const NAV: NavItem[] = [
  { to: '/', label: 'Calendar', icon: CalendarDays, end: true },
  { to: '/floor', label: 'Floor', icon: LayoutGrid, end: false },
  { to: '/bookings', label: 'Bookings', icon: ClipboardList, end: false },
  { to: '/reports', label: 'Reports', icon: BarChart3, end: false, perm: 'reports' },
  { to: '/staff', label: 'Staff', icon: Users, end: false, perm: 'manage_staff' },
]

/** Banner for failed backend writes (dispatched by src/lib/sync.ts) — a
 *  rejected push means the till and the backend have diverged. */
function SyncErrorBanner() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onError = (e: Event) => {
      const d = (e as CustomEvent).detail as { table: string; message: string }
      setError(`Sync failed (${d.table}): ${d.message}`)
    }
    window.addEventListener('hotelpos:sync-error', onError)
    return () => window.removeEventListener('hotelpos:sync-error', onError)
  }, [])

  if (!error) return null
  return (
    <div className="absolute inset-x-0 top-0 z-50 flex items-center gap-3 bg-danger px-4 py-2 text-sm font-semibold text-white shadow-lg">
      <span className="min-w-0 flex-1 truncate" title={error}>
        {error} — this change may not be saved to the backend.
      </span>
      <button
        onClick={() => setError(null)}
        className="tap flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white/15 hover:bg-white/25"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function Layout() {
  const config = usePos((s) => s.config)
  const { email, role } = useAuth()
  const items = NAV.filter((n) => !n.perm || can(role, n.perm))

  return (
    <div className="flex h-full w-full">
      <nav className="flex w-[84px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-lg font-black text-white">
          H
        </div>
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `tap flex w-[72px] flex-col items-center gap-1 rounded-btn px-1 py-2 text-[11px] font-semibold ${
                isActive ? 'bg-primary/20 text-primary-2' : 'text-muted hover:bg-panel-2'
              }`
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col items-center gap-2 px-1">
          {supabaseEnabled && email && (
            <>
              <div
                className="w-full truncate text-center text-[10px] leading-tight text-muted"
                title={email}
              >
                {email}
                <span className="block capitalize">{role}</span>
              </div>
              <button
                onClick={() => void signOut()}
                title="Sign out"
                className="tap flex h-9 w-9 items-center justify-center rounded-btn bg-panel-2 text-muted hover:bg-panel-3 hover:text-fg"
              >
                <LogOut size={16} />
              </button>
            </>
          )}
          <div className="text-center text-[10px] leading-tight text-muted">
            {config.businessDate}
          </div>
        </div>
      </nav>
      <main className="relative min-w-0 flex-1">
        <SyncErrorBanner />
        <Outlet />
      </main>
    </div>
  )
}
