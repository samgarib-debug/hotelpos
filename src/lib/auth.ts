import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface AuthUser {
  email: string
  role: string
}

/** Current signed-in staff member (null when logged out or in local mode). */
export function useAuthUser(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    if (!supabase) return
    let active = true

    const load = async (email: string | undefined, id: string | undefined) => {
      if (!email || !id) {
        if (active) setUser(null)
        return
      }
      const { data } = await supabase!.from('profiles').select('role').eq('id', id).maybeSingle()
      if (active) setUser({ email, role: data?.role ?? 'staff' })
    }

    supabase.auth.getSession().then(({ data }) => {
      void load(data.session?.user.email, data.session?.user.id)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void load(session?.user.email, session?.user.id)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return user
}

export async function signOut() {
  await supabase?.auth.signOut()
  // Fresh load so the store drops any in-memory state from the session.
  window.location.reload()
}
