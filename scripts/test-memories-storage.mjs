// Real Storage/Auth/RPC + the exact shared Edge handler, fresh local accounts ONLY.
import { readFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { localMemoryHandler } from './memory-file-adapter.mjs'
const status = JSON.parse(await readFile(process.argv[2], 'utf8')),
  handler = localMemoryHandler(status),
  opts = { auth: { persistSession: false, autoRefreshToken: false } },
  admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, opts),
  clients = [],
  sessions = [],
  owned = []
const ok = (r) => {
  if (r.error) throw Error('Local operation: ' + r.error.code)
  return r.data
}
const request = async (i, body) =>
  handler(
    new Request('http://localhost/memory-files', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + sessions[i].access_token,
        ...(body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  )
const action = async (
  i,
  type,
  id = null,
  expected = 0,
  payload = {},
  key = randomUUID(),
) =>
  ok(
    await clients[i].rpc('memory_action', {
      p_action: type,
      p_id: id,
      p_expected: expected,
      p_payload: payload,
      p_request: key,
    }),
  )
const detail = async (i, id) =>
  ok(await clients[i].rpc('memory_detail', { p_id: id }))
// A tiny generated fixture, not a user photograph and never a base64 database value.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V9sAAAAASUVORK5CYII=',
  'base64',
)
let memory
try {
  for (let i = 0; i < 3; i++) {
    const email = `kolo-photo-${randomUUID()}@example.test`,
      password = 'Kolo-' + randomUUID() + 'aA1!'
    const user = ok(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    ).user
    owned.push(user.id)
    const c = createClient(status.API_URL, status.ANON_KEY, opts)
    sessions.push(
      ok(await c.auth.signInWithPassword({ email, password })).session,
    )
    clients.push(c)
  }
  ok(await clients[0].rpc('create_couple_space'))
  const token = ok(
    await clients[0].rpc('create_couple_invitation', {
      p_email: sessions[1].user.email,
    }),
  )
  ok(
    await clients[1].rpc('resolve_couple_invitation', {
      p_token: token,
      p_accept: true,
    }),
  )
  // Read-only cache readiness only. Never retry a business action automatically.
  for (let i = 0; i < 100; i++) {
    if (!(await clients[0].rpc('memory_feed')).error) break
    if (i === 99) throw Error('Memory schema readiness')
    await new Promise((r) => setTimeout(r, 100))
  }
  memory = (await action(0, 'create')).id
  const ids = []
  for (let i = 0; i < 3; i++) {
    const id = randomUUID()
    ok(
      await clients[0].rpc('memory_file', {
        p_action: 'reserve',
        p_id: memory,
        p_payload: {
          id,
          mime: 'image/png',
          bytes: png.length,
          digest: createHash('sha256').update(png).digest('hex'),
        },
      }),
    )
    const form = new FormData()
    form.set('id', id)
    form.set('file', new Blob([png], { type: 'image/png' }), 'fixture.png')
    assert.equal((await request(0, form)).status, 200)
    assert.equal(
      (await request(0, form)).status,
      200,
      'retry after lost response creates no second object',
    )
    ids.push(id)
  }
  assert.equal(
    (await request(1, { action: 'download', id: ids[0] })).status,
    400,
    'draft photo does not expose even its bytes',
  )
  assert.equal(
    (await request(2, { action: 'download', id: ids[0] })).status,
    400,
  )
  const save = {
    title: 'Наш локальний альбом',
    date: '2026-10-01',
    story: 'Тільки нові локальні дані',
    category: 'travel',
    photos: ids,
    publish: true,
    confirmed: true,
  }
  await action(0, 'save', memory, 1, save)
  const download = await request(1, { action: 'download', id: ids[0] })
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('cache-control'), 'no-store')
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), png)
  const manifest = ok(
    await admin.from('memory_photos').select('*').eq('id', ids[0]).single(),
  )
  for (const client of clients) {
    assert.ok(
      (await client.storage.from('couple-memories').download(manifest.path))
        .error,
    )
    assert.ok(
      (
        await client.storage
          .from('couple-memories')
          .createSignedUrl(manifest.path, 86400)
      ).error,
    )
    assert.equal(
      ok(
        await client.storage
          .from('couple-memories')
          .list(manifest.path.split('/')[0]),
      ).length,
      0,
    )
  }
  assert.ok(
    (
      await clients[0].storage
        .from('couple-memories')
        .upload('forged.svg', new Blob(['<svg/>'], { type: 'image/svg+xml' }))
    ).error,
  )
  assert.ok(
    (
      await clients[0].storage
        .from('couple-memories')
        .upload(
          'oversized.jpg',
          new Blob([new Uint8Array(5242881)], { type: 'image/jpeg' }),
        )
    ).error,
  )
  const malformed = randomUUID()
  ok(
    await clients[0].rpc('memory_file', {
      p_action: 'reserve',
      p_id: memory,
      p_payload: {
        id: malformed,
        mime: 'image/png',
        bytes: 3,
        digest: createHash('sha256').update('bad').digest('hex'),
      },
    }),
  )
  const bad = new FormData()
  bad.set('id', malformed)
  bad.set('file', new Blob(['bad'], { type: 'image/png' }), 'bad.png')
  assert.equal(
    (await request(0, bad)).status,
    400,
    'server checks magic before storing bytes',
  )
  await action(1, 'note', memory, 0, { body: 'Моя власна нотатка' })
  await action(0, 'withdraw', memory, 2)
  for (const i of [0, 1])
    assert.equal(
      (await request(i, { action: 'download', id: ids[0] })).status,
      400,
    )
  assert.equal((await detail(1, memory)).memory.status, 'private_note')
  assert.equal((await detail(1, memory)).memory.title, undefined)
  assert.equal((await request(0, { action: 'cleanup' })).status, 200)
  assert.ok(
    (await admin.storage.from('couple-memories').download(manifest.path)).error,
    'physical object removed before manifest pruning',
  )
  ok(await clients[1].rpc('leave_couple_space'))
  ok(
    await clients[2].rpc('resolve_couple_invitation', {
      p_token: ok(
        await clients[0].rpc('create_couple_invitation', {
          p_email: sessions[2].user.email,
        }),
      ),
      p_accept: true,
    }),
  )
  assert.equal(
    (await request(2, { action: 'download', id: ids[0] })).status,
    400,
  )
  assert.ok((await clients[2].rpc('memory_detail', { p_id: memory })).error)
  console.log(
    'PASS: real private Storage HTTP, 3 photos, exact upload replay, protected bytes, denied raw/sign/list/upload, MIME/size/magic, notes, withdrawal, physical cleanup and new epoch',
  )
} finally {
  for (let i = 0; i < clients.length; i++) {
    await request(i, { action: 'cleanup' }).catch(() => {})
  }
  for (const id of owned) ok(await admin.auth.admin.deleteUser(id))
  console.log('Cleanup: only own new local memory accounts removed')
}
