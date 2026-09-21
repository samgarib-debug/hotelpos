import { useState } from 'react'
import { Modal } from './Modal'
import { supabase } from '../lib/supabase'
import { MIN_PASSWORD, USERNAME_HINT, USERNAME_RE } from '../lib/staffAuth'

/** Extracts the server's error message from a failed functions.invoke. */
export async function functionError(error: unknown): Promise<string> {
  const e = error as { message?: string; context?: Response }
  try {
    const body = await e.context?.clone().json()
    if (body?.error) return String(body.error)
  } catch {
    /* non-JSON body */
  }
  return e.message ?? 'Request failed'
}

const inputCls =
  'rounded-btn border border-line bg-panel-2 px-3 py-3 outline-none focus:border-primary'

export function AddStaffDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)

  const reset = () => {
    setUsername('')
    setFullName('')
    setPassword('')
    setConfirm('')
    setError(null)
    setCreated(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase || busy) return
    const u = username.trim().toLowerCase()
    if (!USERNAME_RE.test(u)) return setError(USERNAME_HINT)
    if (password.length < MIN_PASSWORD)
      return setError(`Password must be at least ${MIN_PASSWORD} characters`)
    if (password !== confirm) return setError('Passwords do not match')
    setBusy(true)
    setError(null)
    const { error } = await supabase.functions.invoke('create-staff', {
      body: { action: 'create', username: u, full_name: fullName.trim(), password },
    })
    if (error) setError(await functionError(error))
    else {
      setCreated(u)
      onCreated()
    }
    setBusy(false)
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Add staff member"
    >
      {created ? (
        <div className="flex flex-col gap-4 p-5">
          <div className="rounded-btn bg-success/15 px-3 py-3 text-sm text-success">
            Account <span className="font-bold">{created}</span> created. Give the
            username and password to the staff member — they can change the
            password themselves from Floor → ⚙ once signed in.
          </div>
          <button
            className="tap rounded-btn bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-2"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 p-5">
          <label className="text-sm text-muted">
            Username (what they type to sign in)
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. thandi"
              autoCapitalize="none"
              spellCheck={false}
              className={`mt-1 w-full ${inputCls}`}
            />
          </label>
          <label className="text-sm text-muted">
            Full name (shown on receipts and reports)
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Thandi Nkosi"
              className={`mt-1 w-full ${inputCls}`}
            />
          </label>
          <label className="text-sm text-muted">
            Password (min {MIN_PASSWORD} characters)
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={`mt-1 w-full ${inputCls}`}
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
              className={`mt-1 w-full ${inputCls}`}
            />
          </label>

          {error && (
            <div className="rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          <div className="text-xs text-muted">
            New accounts start as <span className="font-semibold">staff</span> —
            an admin can promote them afterwards.
          </div>

          <button
            type="submit"
            disabled={busy}
            className="tap rounded-btn bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-2 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
      )}
    </Modal>
  )
}
