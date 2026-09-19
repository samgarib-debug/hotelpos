import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { CalendarScreen } from './screens/CalendarScreen'
import { RoomsBoard } from './screens/RoomsBoard'
import { ReservationsScreen } from './screens/ReservationsScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { OrderScreen } from './screens/OrderScreen'
import { SettleScreen } from './screens/SettleScreen'

// Hash routing for packaged/offline builds (works from file:// or any subpath);
// clean path routing for the hosted web deploy.
const Router = import.meta.env.VITE_HASH === '1' ? HashRouter : BrowserRouter

export default function App() {
  return (
    <Router>
      <div className="h-full w-full">
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<CalendarScreen />} />
            <Route path="/floor" element={<RoomsBoard />} />
            <Route path="/bookings" element={<ReservationsScreen />} />
            <Route path="/reports" element={<ReportsScreen />} />
          </Route>
          {/* Focused POS flows run full-screen */}
          <Route path="/order" element={<OrderScreen />} />
          <Route path="/settle" element={<SettleScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  )
}
