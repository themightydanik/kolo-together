// Service-side maintenance, explicit operator action. Never place this key in VITE.
// Physical deletion first. Batch RPC only returns revoked/expired/orphan paths.
import { createClient } from '@supabase/supabase-js'
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw Error('Server-only Supabase URL/service key required')
const c = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const candidates = await c.rpc('memory_gc_candidates')
if (candidates.error) throw Error('Could not authorize maintenance batch')
let removed = 0
for (const p of candidates.data) {
  const r = await c.storage.from('couple-memories').remove([p.path])
  if (r.error) throw Error('File deletion failed; manifest retained')
  if (p.id) {
    const finish = await c.rpc('memory_prune_photo', { p_id: p.id })
    if (finish.error) throw Error('Could not finish deletion')
  }
  removed++
}
console.log('Memory cleanup batch removed:', removed)
