import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
export function isSupabaseConfigured(url?: string, key?: string): boolean {
  if (!url || !key?.trim()) return false
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(parsed.hostname))
    )
  } catch {
    return false
  }
}
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
// Public key only. Authorization must be enforced by RLS on every remote table.
export const supabase = isSupabaseConfigured(url, key)
  ? createClient<Database>(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null
