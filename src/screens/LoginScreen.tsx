import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setError(error.message)
        // success: AuthGate's onAuthStateChange takes over
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name || email } },
        })
        if (error) setError(error.message)
        else if (!data.session) {
          setNotice('Account created — check your email to confirm, then sign in.')
          setMode('signin')
        }
      }
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

        <div className="mb-4 flex overflow-hidden rounded-btn border border-line">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setError(null)
                setNotice(null)
              }}
              className={`tap flex-1 py-2 text-sm font-semibold ${
                mode === m ? 'bg-primary text-white' : 'bg-panel-2 text-muted hover:bg-panel-3'
              }`}
            >
              {m === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === 'signup' && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="rounded-btn border border-line bg-panel-2 px-3 py-3 outline-none focus:border-primary"
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            className="rounded-btn border border-line bg-panel-2 px-3 py-3 outline-none focus:border-primary"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className="rounded-btn border border-line bg-panel-2 px-3 py-3 outline-none focus:border-primary"
          />

          {error && (
            <div className="rounded-btn bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
          )}
          {notice && (
            <div className="rounded-btn bg-success/15 px-3 py-2 text-sm text-success">{notice}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="tap rounded-btn bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-2 disabled:opacity-50"
          >
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Staff accounts only — ask a manager to be added.
        </p>
      </div>
    </div>
  )
}
