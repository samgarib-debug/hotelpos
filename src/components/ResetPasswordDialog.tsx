import { useState } from 'react'
import { Modal } from './Modal'
import { supabase } from '../lib/supabase'
import { MIN_PASSWORD } from '../lib/staffAuth'
import { functionError } from './AddStaffDialog'

/** Manager/admin sets a new password for a staff member (accounts have no
 *  email, so there is no reset link — this is the recovery path). The server
 *  enforces who may reset whom: admins → staff/manager, managers → staff. */
export function ResetPasswordDialog({
  target,
  onClose,
}: {
  target: { id: string; username: string } | null
  onClose: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const close = () => {
    setPassword('')
    setConfirm('')
    setError(null)
    setDone(false)
    onClose()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase || busy || !target) return
    if (password.length < MIN_PASSWORD)
      return setError(`Password must be at least ${MIN_PASSWORD} characters`)
    if (password !== confirm) return setError('Passwords do not match')
    setBusy(true)
    setError(null)
    const { error } = await supabase.functions.invoke('create-staff', {
      body: { action: 'set-password', user_id: target.id, password },
    })
    if (error) setError(await functionError(error))
    else setDone(true)
    setBusy(false)
  }

  return (
    <Modal open={target != null} onClose={close} title={`Reset password — ${target?.username ?? ''}`}>
      {done ? (
        <div className="flex flex-col gap-4 p-5">
          <div className="rounded-btn bg-success/15 px-3 py-3 text-sm text-success">
            Password updated. Give it to <span className="font-bold">{target?.username}</span> —
            they can change it themselves from Floor → ⚙ after signing in.
          </div>
          <button
            className="tap rounded-btn bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-2"
            onClick={close}
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 p-5">
          <label className="text-sm text-muted">
            New password (min {MIN_PASSWORD} characters)
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-btn border border-line bg-panel-2 px-3 py-3 outline-none focus:border-primary"
            />
          </label>
          <label className="text-sm text-muted">
            Confirm password
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-btn border border-line bg-panel-2 px-3 py-3 outline-none focus:border-primary"
            />
          </label>

          {error && (
            <div className="rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="tap rounded-btn bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-2 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </form>
      )}
    </Modal>
  )
}
