import { NavLink, Outlet } from 'react-router-dom'
import { CalendarDays, LayoutGrid, ClipboardList, BarChart3, LogOut } from 'lucide-react'
import { usePos } from '../store/pos'
import { useAuthUser, signOut } from '../lib/auth'
import { supabaseEnabled } from '../lib/supabase'

const NAV = [
  { to: '/', label: 'Calendar', icon: CalendarDays, end: true },
  { to: '/floor', label: 'Floor', icon: LayoutGrid, end: false },
  { to: '/bookings', label: 'Bookings', icon: ClipboardList, end: false },
  { to: '/reports', label: 'Reports', icon: BarChart3, end: false },
]

export function Layout() {
  const config = usePos((s) => s.config)
  const user = useAuthUser()
  return (
    <div className="flex h-full w-full">
      <nav className="flex w-[84px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-lg font-black text-white">
          H
        </div>
        {NAV.map(({ to, label, icon: Icon, end }) => (
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
          {supabaseEnabled && user && (
            <>
              <div
                className="w-full truncate text-center text-[10px] leading-tight text-muted"
                title={user.email}
              >
                {user.email}
                <span className="block capitalize">{user.role}</span>
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
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
