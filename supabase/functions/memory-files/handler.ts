// Shared web handler: Deno Edge and the real local Storage integration adapter.
// Dependencies are injected; no user input can choose a bucket, path or recipient.
const MAX = 5 * 1024 * 1024
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}
type Client = {
  auth: { getUser: () => Promise<any> }
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<any>
  storage: { from: (bucket: string) => any }
}
export function createMemoryFilesHandler(
  userClient: (jwt: string) => Client,
  service: Client,
) {
  const check = (r: any) => {
    if (r.error) throw Error('unavailable')
    return r.data
  }
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    try {
      if (req.method !== 'POST')
        return new Response(null, { status: 405, headers: cors })
      const token = req.headers.get('Authorization') ?? ''
      if (!token.startsWith('Bearer ')) throw Error('unauthorized')
      const user = userClient(token)
      check(await user.auth.getUser())
      const chunks: Uint8Array[] = []
      let size = 0
      const reader = req.body?.getReader()
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX + 65536) {
            await reader.cancel()
            throw Error('too_large')
          }
          chunks.push(value)
        }
      }
      const body = new Uint8Array(size)
      let offset = 0
      for (const part of chunks) {
        body.set(part, offset)
        offset += part.byteLength
      }
      const input = new Request(req.url, {
        method: 'POST',
        headers: req.headers,
        body,
      })
      if (req.headers.get('Content-Type')?.includes('multipart/form-data')) {
        const form = await input.formData(),
          id = String(form.get('id') ?? ''),
          file = form.get('file')
        if (!(file instanceof Blob) || file.size === 0 || file.size > MAX)
          throw Error('invalid_file')
        const data = check(
          await user.rpc('memory_file', {
            p_action: 'upload',
            p_id: id,
            p_payload: {},
          }),
        )
        if (data.state === 'ready')
          return Response.json({ id: data.id }, { headers: cors })
        const bytes = new Uint8Array(await file.arrayBuffer()),
          digest = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          )
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
        const magic =
          file.type === 'image/jpeg'
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : file.type === 'image/png'
              ? bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
              : file.type === 'image/webp'
                ? new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
                  new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
                : false
        if (
          !magic ||
          file.type !== data.mime ||
          file.size !== data.bytes ||
          digest !== data.digest
        )
          throw Error('invalid_file')
        const saved = await service.storage
          .from('couple-memories')
          .upload(data.path, file, {
            contentType: data.mime,
            upsert: false,
            cacheControl: '0',
          })
        if (
          saved.error &&
          String(saved.error.statusCode) !== '409' &&
          String(saved.error.status) !== '409'
        )
          throw Error('upload_failed')
        // Unknown commit outcome is NOT treated as a reason to delete a possibly ready file.
        check(
          await user.rpc('memory_file', {
            p_action: 'commit',
            p_id: id,
            p_payload: {},
          }),
        )
        return Response.json({ id }, { headers: cors })
      }
      const data = await input.json()
      if (data.action === 'download') {
        const photo = check(
            await user.rpc('memory_file', {
              p_action: 'read',
              p_id: data.id,
              p_payload: {},
            }),
          ),
          blob = check(
            await service.storage.from('couple-memories').download(photo.path),
          )
        return new Response(blob, {
          headers: {
            ...cors,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'inline; filename="memory-photo"',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'",
          },
        })
      }
      if (data.action === 'cleanup') {
        const photos = check(
          await user.rpc('memory_file', {
            p_action: 'cleanup',
            p_id: null,
            p_payload: {},
          }),
        )
        for (const p of photos) {
          check(await service.storage.from('couple-memories').remove([p.path]))
          check(await service.rpc('memory_prune_photo', { p_id: p.id }))
        }
        return Response.json({ removed: photos.length }, { headers: cors })
      }
      throw Error('invalid')
    } catch {
      return Response.json(
        { error: 'Не вдалося перевірити або зберегти фото. Спробуй ще раз.' },
        { status: 400, headers: cors },
      )
    }
  }
}
