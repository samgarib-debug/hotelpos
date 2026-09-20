import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseEnabled } from '../lib/supabase'
import { initSync } from '../lib/sync'
import { signOut } from '../lib/auth'
import { AuthContext } from '../lib/authContext'
import { can, type Role } from '../lib/permissions'
import { LoginScreen } from '../screens/LoginScreen'

/** Gates the app behind Supabase Auth when a backend is configured and
 *  provides the signed-in user's role to the app. In local/offline mode
 *  (no env vars) it renders the app directly with full access. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!supabaseEnabled)
  const [session, setSession] = useState<Session | null>(null)
  // Least privilege until the profile loads.
  const [role, setRole] = useState<Role>('staff')

  useEffect(() => {
    if (!supabaseEnabled || !supabase) return
    let active = true

    const loadRole = async (userId: string): Promise<Role> => {
      const { data } = await supabase!
        .from('profiles')
        .select('role, deactivated')
        .eq('id', userId)
        .maybeSingle()
      if (data?.deactivated) {
        // Account was deactivated: end the session instead of running the till.
        void signOut()
        return 'staff'
      }
      const r = (data?.role as Role | undefined) ?? 'staff'
      if (active) setRole(r)
      return r
    }

    const onSession = (s: Session | null) => {
      if (!active) return
      setSession(s)
      if (s) {
        supabase!.realtime.setAuth(s.access_token)
        // Role first: bootstrap-if-empty is only allowed for manager/admin
        // (the seed contains rows staff can't insert past the DB guards).
        void loadRole(s.user.id).then((r) => initSync({ canSeed: can(r, 'reset_data') }))
      } else {
        setRole('staff')
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
  return (
    <AuthContext.Provider value={{ email: session.user.email ?? null, role }}>
      {children}
    </AuthContext.Provider>
  )
}
