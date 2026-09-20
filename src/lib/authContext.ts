import { createContext, useContext } from 'react'
import type { Role } from './permissions'

export interface AuthInfo {
  email: string | null
  role: Role
}

/** Default = local/offline mode (no backend): full access, no account. */
export const AuthContext = createContext<AuthInfo>({ email: null, role: 'admin' })

export const useAuth = () => useContext(AuthContext)
