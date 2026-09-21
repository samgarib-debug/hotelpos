import { createContext, useContext } from 'react'
import type { Role } from './permissions'

export interface AuthInfo {
  userId: string | null
  username: string | null
  role: Role
}

/** Default = local/offline mode (no backend): full access, no account.
 *  VITE_DEFAULT_ROLE overrides the local-mode role (handy for testing the
 *  staff experience without a backend). */
const localRole = ((import.meta.env.VITE_DEFAULT_ROLE as Role) || 'admin') as Role

export const AuthContext = createContext<AuthInfo>({ userId: null, username: null, role: localRole })

export const useAuth = () => useContext(AuthContext)
