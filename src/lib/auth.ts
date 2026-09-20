import { supabase } from './supabase'

export async function signOut() {
  await supabase?.auth.signOut()
  // Fresh load so the store drops any in-memory state from the session.
  window.location.reload()
}
