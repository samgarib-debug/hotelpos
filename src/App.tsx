import type { ReactNode } from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthGate } from './components/AuthGate'
import { Layout } from './components/Layout'
import { CalendarScreen } from './screens/CalendarScreen'
import { RoomsBoard } from './screens/RoomsBoard'
import { ReservationsScreen } from './screens/ReservationsScreen'
import { ClientsScreen } from './screens/ClientsScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { StaffScreen } from './screens/StaffScreen'
import { OrderScreen } from './screens/OrderScreen'
import { SettleScreen } from './screens/SettleScreen'
import { useAuth } from './lib/authContext'
import { can, type Permission } from './lib/permissions'

// Hash routing for packaged/offline builds (works from file:// or any subpath);
// clean path routing for the hosted web deploy.
const Router = import.meta.env.VITE_HASH === '1' ? HashRouter : BrowserRouter

/** Renders children only when the signed-in role has the permission.
 *  (Rendered inline rather than redirecting so a late-loading role
 *  doesn't bounce the user off a deep link.) */
function Guarded({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { role } = useAuth()
  if (!can(role, perm)) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        {perm === 'manage_staff' ? 'Admin' : 'Manager'} access required.
      </div>
    )
  }
  return <>{children}</>
}

export default function App() {
  return (
    <AuthGate>
      <Router>
        <div className="h-full w-full">
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<CalendarScreen />} />
              <Route path="/floor" element={<RoomsBoard />} />
              <Route path="/bookings" element={<ReservationsScreen />} />
              <Route path="/clients" element={<ClientsScreen />} />
              <Route
                path="/reports"
                element={
                  <Guarded perm="reports">
                    <ReportsScreen />
                  </Guarded>
                }
              />
              <Route
                path="/staff"
                element={
                  <Guarded perm="add_staff">
                    <StaffScreen />
                  </Guarded>
                }
              />
            </Route>
            {/* Focused POS flows run full-screen */}
            <Route path="/order" element={<OrderScreen />} />
            <Route path="/settle" element={<SettleScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Router>
    </AuthGate>
  )
}
