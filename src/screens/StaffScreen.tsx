import { useEffect, useState } from 'react'
import { supabase, supabaseEnabled } from '../lib/supabase'
import { useAuth } from '../lib/authContext'
import { fmtDate } from '../lib/date'
import { can, type Role } from '../lib/permissions'
import { AddStaffDialog } from '../components/AddStaffDialog'
import { ResetPasswordDialog } from '../components/ResetPasswordDialog'

interface ProfileRow {
  id: string
  username: string
  full_name: string | null
  role: Role
  created_at: string
  deactivated: boolean
}

const ROLES: Role[] = ['staff', 'manager', 'admin']

export function StaffScreen() {
  const { userId, role: myRole } = useAuth()
  const isAdmin = can(myRole, 'manage_staff')
  const [rows, setRows] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [resetTarget, setResetTarget] = useState<{ id: string; username: string } | null>(null)

  const load = async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, full_name, role, created_at, deactivated')
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

  /** Who may reset whose password (mirrors the create-staff edge function):
   *  admins → staff/manager, managers → staff. Never admins, never yourself. */
  const canResetPassword = (p: ProfileRow) =>
    p.id !== userId &&
    (isAdmin ? p.role !== 'admin' : p.role === 'staff')

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
        <div className="flex items-center gap-3">
          <div className="hidden text-sm text-muted md:block">
            staff → POS only · manager → + overrides, reports, add staff · admin → + roles &amp; deactivation
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="tap rounded-btn bg-primary px-4 py-2 font-semibold text-white hover:bg-primary-2"
          >
            + Add staff
          </button>
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
                <th className="px-3 py-2 font-semibold">Username</th>
                <th className="px-3 py-2 font-semibold">Joined</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const isMe = p.id === userId
                return (
                  <tr key={p.id} className={`border-t border-line/60 ${p.deactivated ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-3 font-medium">
                      {p.full_name ?? '—'}
                      {isMe && <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-xs text-primary-2">you</span>}
                    </td>
                    <td className="px-3 py-3 text-muted">{p.username}</td>
                    <td className="px-3 py-3 text-muted">{fmtDate(p.created_at)}</td>
                    <td className="px-3 py-3">
                      {isAdmin ? (
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
                      ) : (
                        <span className="capitalize">{p.role}</span>
                      )}
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
                        {canResetPassword(p) && (
                          <button
                            disabled={savingId === p.id}
                            onClick={() => setResetTarget({ id: p.id, username: p.username })}
                            className="tap rounded-btn bg-panel-2 px-3 py-1.5 text-xs font-semibold hover:bg-panel-3 disabled:opacity-50"
                          >
                            Reset password
                          </button>
                        )}
                        {isAdmin && !isMe && (
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
                    No staff accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <footer className="border-t border-line px-4 py-3 text-xs text-muted">
        Managers and admins create accounts here with <span className="font-semibold">+ Add staff</span> —
        staff sign in with a username only (no email). New accounts start as{' '}
        <span className="font-semibold">staff</span>; only admins change roles, and nobody
        can change their own. <span className="font-semibold">Deactivate</span> instead of
        deleting: it blocks sign-in immediately but keeps the person&apos;s name on their
        payments, ledger lines and PIN approvals. Forgotten passwords are reset here too —
        there are no reset emails.
      </footer>

      <AddStaffDialog open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => void load()} />
      <ResetPasswordDialog target={resetTarget} onClose={() => setResetTarget(null)} />
    </div>
  )
}
