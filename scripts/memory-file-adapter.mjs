// Runs exactly the Edge web handler against an owned LOCAL Supabase, not mocks.
// The Node HTTP adapter tests web semantics; Deno entrypoint is deployed separately.
import { createServer } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { createMemoryFilesHandler } from '../supabase/functions/memory-files/handler.ts'
export function localMemoryHandler(status) {
  for (const key of ['API_URL', 'DB_URL'])
    if (!['127.0.0.1', 'localhost'].includes(new URL(status[key]).hostname))
      throw Error('Owned local stack only')
  const opts = { auth: { persistSession: false, autoRefreshToken: false } }
  return createMemoryFilesHandler(
    (jwt) =>
      createClient(status.API_URL, status.ANON_KEY, {
        ...opts,
        global: { headers: { Authorization: jwt } },
      }),
    createClient(status.API_URL, status.SERVICE_ROLE_KEY, opts),
  )
}
export async function serveMemoryHandler(status) {
  if (process.env.KOLO_MEMORY_FILES_URL) {
    const u = new URL(process.env.KOLO_MEMORY_FILES_URL)
    if (!['localhost', '127.0.0.1'].includes(u.hostname))
      throw Error('Local function only')
    return { url: u.origin, close: async () => {} }
  }
  const handler = localMemoryHandler(status)
  const server = createServer(async (req, res) => {
    try {
      const request = new Request('http://localhost/' + (req.url ?? ''), {
        method: req.method,
        headers: req.headers,
        ...(req.method !== 'GET' && req.method !== 'HEAD'
          ? { body: req, duplex: 'half' }
          : {}),
      })
      const response = await handler(request)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      res.writeHead(500)
      res.end()
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((r) => server.close(r)),
  }
}
