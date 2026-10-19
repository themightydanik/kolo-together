import { createClient } from '@supabase/supabase-js'
export function isSupabaseConfigured(url?: string, key?: string): boolean {
  if (!url || !key?.trim()) return false
  try { return new URL(url).protocol === 'https:' } catch { return false }
}
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
// Public key only. Authorization must be enforced by RLS on every remote table.
export const supabase = isSupabaseConfigured(url, key) ? createClient(url!, key!) : null
