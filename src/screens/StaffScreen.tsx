import { useEffect, useState } from 'react'
import { supabase, supabaseEnabled } from '../lib/supabase'
import { useAuth } from '../lib/authContext'
import { fmtDate } from '../lib/date'
import type { Role } from '../lib/permissions'

interface ProfileRow {
  id: string
  email: string | null
  full_name: string | null
  role: Role
  created_at: string
  deactivated: boolean
}

const ROLES: Role[] = ['staff', 'manager', 'admin']

export function StaffScreen() {
  const { email: myEmail } = useAuth()
  const [rows, setRows] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, created_at, deactivated')
      .order('created_at', { ascending: true })
    if (error) setError(error.message)
    else setRows((data ?? []) as ProfileRow[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const setRole = async (id: string, role: Role) => {
    if (!supabase) return
    setSavingId(id)
    setError(null)
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
    if (error) setError(error.message)
    await load()
    setSavingId(null)
  }

  const setActive = async (id: string, active: boolean) => {
    if (!supabase) return
    if (
      !active &&
      !confirm(
        'Deactivate this staff member? They cannot sign in again until reactivated, and ' +
          'any open session ends within the hour. Their history (payments, approvals) ' +
          'keeps their name.',
      )
    )
      return
    setSavingId(id)
    setError(null)
    const { error } = await supabase.rpc('set_staff_active', {
      p_user_id: id,
      p_active: active,
    })
    if (error) setError(error.message)
    await load()
    setSavingId(null)
  }

  if (!supabaseEnabled) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-muted">
        Staff management needs the online backend — this build is running in
        local/offline mode.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h1 className="text-xl font-bold">Staff & Roles</h1>
        <div className="text-sm text-muted">
          staff → POS only · manager → discounts, voids, comps, reports · admin → + staff management
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4" style={{ overscrollBehavior: 'contain' }}>
        {loading ? (
          <div className="py-10 text-center text-muted">Loading staff…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Joined</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const isMe = p.email != null && p.email === myEmail
                return (
                  <tr key={p.id} className={`border-t border-line/60 ${p.deactivated ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-3 font-medium">
                      {p.full_name ?? '—'}
                      {isMe && <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-xs text-primary-2">you</span>}
                    </td>
                    <td className="px-3 py-3 text-muted">{p.email ?? '—'}</td>
                    <td className="px-3 py-3 text-muted">{fmtDate(p.created_at)}</td>
                    <td className="px-3 py-3">
                      <select
                        value={p.role}
                        disabled={isMe || p.deactivated || savingId === p.id}
                        title={isMe ? "You can't change your own role" : undefined}
                        onChange={(e) => void setRole(p.id, e.target.value as Role)}
                        className="rounded-btn border border-line bg-panel-2 px-3 py-2 capitalize outline-none focus:border-primary disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            p.deactivated ? 'bg-danger/20 text-danger' : 'bg-success/20 text-success'
                          }`}
                        >
                          {p.deactivated ? 'Deactivated' : 'Active'}
                        </span>
                        {!isMe && (
                          <button
                            disabled={savingId === p.id}
                            onClick={() => void setActive(p.id, p.deactivated)}
                            className="tap rounded-btn bg-panel-2 px-3 py-1.5 text-xs font-semibold hover:bg-panel-3 disabled:opacity-50"
                          >
                            {p.deactivated ? 'Reactivate' : 'Deactivate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-muted">
                    No staff accounts yet — the first sign-up becomes admin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <footer className="border-t border-line px-4 py-3 text-xs text-muted">
        New accounts are created from the sign-in screen (or Supabase dashboard → Authentication)
        and start as <span className="font-semibold">staff</span>. Only admins can change roles;
        nobody can change their own. <span className="font-semibold">Deactivate</span> instead of
        deleting: it blocks sign-in immediately but keeps the person&apos;s name on their payments,
        ledger lines and PIN approvals.
      </footer>
    </div>
  )
}
