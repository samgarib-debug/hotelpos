import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { STAFF_DOMAIN } from '../lib/staffAuth'

export function LoginScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase || busy) return
    setBusy(true)
    setError(null)
    try {
      // Staff sign in with a username; the auth identity behind it is the
      // synthetic `<username>@hotelpos.invalid` address. Typing a full
      // address still works (legacy escape hatch).
      const id = username.trim().toLowerCase()
      const email = id.includes('@') ? id : `${id}@${STAFF_DOMAIN}`
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error)
        setError(
          error.message.includes('Invalid login credentials')
            ? 'Wrong username or password'
            : error.message,
        )
      // success: AuthGate's onAuthStateChange takes over
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-xl font-black text-white">
            H
          </div>
          <div>
            <div className="text-lg font-bold">HotelPOS</div>
            <div className="text-sm text-muted">Staff sign in</div>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="rounded-btn border border-line bg-panel-2 px-3 py-3 outline-none focus:border-primary"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="rounded-btn border border-line bg-panel-2 px-3 py-3 outline-none focus:border-primary"
          />

          {error && (
            <div className="rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="tap rounded-btn bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-2 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Accounts are created by a manager on the Staff screen. Forgot your
          password? Ask a manager to reset it.
        </p>
      </div>
    </div>
  )
}
