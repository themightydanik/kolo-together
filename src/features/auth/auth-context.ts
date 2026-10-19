import { createContext, useContext } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../lib/database.types'
export type AppClient = SupabaseClient<Database>
interface AuthState {
  client: AppClient | null
  session: Session | null
  loading: boolean
  error: string | null
  online: boolean
  retry: () => void
}
export const AuthContext = createContext<AuthState | null>(null)
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider required')
  return value
}
