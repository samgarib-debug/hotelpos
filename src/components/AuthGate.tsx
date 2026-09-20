import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseEnabled } from '../lib/supabase'
import { initSync } from '../lib/sync'
import { LoginScreen } from '../screens/LoginScreen'

/** Gates the app behind Supabase Auth when a backend is configured.
 *  In local/offline mode (no env vars) it renders the app directly. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!supabaseEnabled)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!supabaseEnabled || !supabase) return
    let active = true

    const onSession = (s: Session | null) => {
      if (!active) return
      setSession(s)
      if (s) {
        supabase!.realtime.setAuth(s.access_token)
        void initSync()
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      onSession(data.session)
      if (active) setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => onSession(s))
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  if (!supabaseEnabled) return <>{children}</>
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Connecting…
      </div>
    )
  }
  if (!session) return <LoginScreen />
  return <>{children}</>
}
