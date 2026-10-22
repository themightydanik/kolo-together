import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { createMemoryFilesHandler } from './handler.ts'
const url = Deno.env.get('SUPABASE_URL')!,
  key = Deno.env.get('SUPABASE_ANON_KEY')!,
  secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const options = { auth: { persistSession: false, autoRefreshToken: false } }
Deno.serve(
  {
    hostname: Deno.env.get('MEMORY_FILES_HOST') ?? '0.0.0.0',
    port: Number(Deno.env.get('PORT') ?? 8000),
  },
  createMemoryFilesHandler(
    (jwt) =>
      createClient(url, key, {
        ...options,
        global: { headers: { Authorization: jwt } },
      }),
    createClient(url, secret, options),
  ),
)
