// Dedicated LOCAL Supabase only. Status JSON contains local keys; never print it.
// Starts no containers and never accepts a remote database/API URL.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { processPkceCallback } from '../src/features/auth/pkce-callback.ts'
const status = JSON.parse(await readFile(process.argv[2], 'utf8'))
for (const key of ['API_URL', 'DB_URL', 'MAILPIT_URL']) {
  const url = new URL(status[key])
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(url.hostname),
    'Only a dedicated loopback test stack is allowed',
  )
}
const db = new pg.Client({ connectionString: status.DB_URL })
const options = {
  auth: {
    flowType: 'pkce',
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options)
const client = () => createClient(status.API_URL, status.ANON_KEY, options)
const a = client(),
  b = client(),
  c = client(),
  anon = client(),
  d = client()
const password = `Kolo-${randomUUID()}-aA1!`
const email = (n) => `kolo-review-${run}-${n}@example.test`
const run = randomUUID().slice(0, 8)
const created = []
let step = 'initialize local test'
function check(result, label) {
  if (result.error) {
    const error = new Error(label)
    error.code = result.error.code ?? 'sdk_error'
    throw error
  }
  return result.data
}
async function knownMessages() {
  return new Set(
    (
      await (await fetch(`${status.MAILPIT_URL}/api/v1/messages`)).json()
    ).messages.map((m) => m.ID),
  )
}
async function mailLink(address, previous) {
  for (let i = 0; i < 80; i++) {
    const list = await (
      await fetch(`${status.MAILPIT_URL}/api/v1/messages`)
    ).json()
    const message = list.messages.find(
      (m) => !previous.has(m.ID) && m.To.some((to) => to.Address === address),
    )
    if (message) {
      const full = await (
        await fetch(`${status.MAILPIT_URL}/api/v1/message/${message.ID}`)
      ).json()
      const text = full.HTML.replaceAll('&amp;', '&')
      const link = text.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)
      assert.ok(
        link,
        'Confirmation/recovery email must contain local verify link',
      )
      const url = new URL(link[1])
      assert.ok(
        ['localhost', '127.0.0.1'].includes(url.hostname),
        'Mail link must stay local',
      )
      return url.href
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Local test email was not received')
}
async function callbackUrl(link) {
  const response = await fetch(link, { redirect: 'manual' })
  assert.equal(
    response.status,
    303,
    'Auth verify must redirect with a PKCE code',
  )
  const url = new URL(response.headers.get('location'))
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'Callback must stay local',
  )
  assert.ok(url.searchParams.has('code'), 'PKCE code required')
  return url
}
async function applyCallback(sdk, url) {
  // Exercise the production callback handler with real GoTrue/SDK, not a mock exchange.
  globalThis.window = {
    location: url,
    history: {
      replaceState(_state, _title, path) {
        globalThis.window.location = new URL(path, url.origin)
      },
    },
  }
  const result = await processPkceCallback(sdk)
  assert.equal(
    globalThis.window.location.search,
    '',
    'Callback credentials must be scrubbed',
  )
  return result
}
async function newUser(sdk, n) {
  const data = check(
    await admin.auth.admin.createUser({
      email: email(n),
      password,
      email_confirm: true,
    }),
    'Create confirmed local Auth user',
  )
  created.push(data.user.id)
  check(
    await sdk.auth.signInWithPassword({ email: email(n), password }),
    'Real Auth sign in',
  )
  return data.user.id
}
async function recoveryCode(sdk = a, address = email('a')) {
  // Auth timestamps have second precision; do not send multiple recovery emails in one second.
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const old = await knownMessages()
  check(
    await sdk.auth.resetPasswordForEmail(address, {
      redirectTo: 'http://127.0.0.1:5173/auth/update-password',
    }),
    'Request local recovery email',
  )
  return callbackUrl(await mailLink(address, old))
}
try {
  await db.connect()
  step = 'real Auth user before migration and backfill'
  const seeded = check(
    await admin.auth.admin.createUser({
      email: email('seed'),
      password,
      email_confirm: true,
    }),
    'Create pre-migration user',
  )
  created.push(seeded.user.id)
  const exists = await db.query("select to_regclass('public.profiles') as name")
  if (!exists.rows[0].name)
    await db.query(
      await readFile(
        'supabase/migrations/20261019150000_auth_profiles_couples.sql',
        'utf8',
      ),
    )
  else {
    // Re-running tests against this dedicated stack preserves the schema.
    await db.query(
      'insert into public.profiles(id) values($1) on conflict do nothing',
      [seeded.user.id],
    )
  }
  assert.equal(
    (
      await db.query('select id from public.profiles where id=$1', [
        seeded.user.id,
      ])
    ).rowCount,
    1,
    'Existing Auth profile backfill',
  )
  await db.query(await readFile('supabase/tests/privileges.sql', 'utf8'))
  await db.query("notify pgrst,'reload schema'")
  console.log(
    'PASS: real Supabase roles/auth.users, migration, backfill and complete privilege allowlist',
  )
  step = 'signup email PKCE callback and profile trigger'
  const old = await knownMessages()
  const signup = check(
    await a.auth.signUp({
      email: email('a'),
      password,
      options: { emailRedirectTo: 'http://127.0.0.1:5173/auth/callback' },
    }),
    'Real signup',
  )
  created.push(signup.user.id)
  assert.equal(signup.session, null, 'Confirmation must be required')
  const confirm = await callbackUrl(await mailLink(email('a'), old))
  const proof = await applyCallback(a, confirm)
  assert.equal(proof.status, 'success', 'Confirmation exchange succeeds')
  assert.equal(proof.recovery, false, 'Confirmation is not recovery')
  check(
    await a
      .from('profiles')
      .update({ display_name: 'Анна' })
      .eq('id', signup.user.id),
    'Auth trigger creates editable own profile',
  )
  console.log(
    'PASS: SMTP capture, email confirmation, production PKCE handler and profile trigger through Auth',
  )
  step = 'PostgREST JWT/RLS, RPC and permission denial'
  const bid = await newUser(b, 'b')
  await newUser(c, 'c')
  const space = check(
    await a.rpc('create_couple_space'),
    'Create space through PostgREST',
  )
  const token = check(
    await a.rpc('create_couple_invitation', { p_email: email('b') }),
    'Create invite',
  )
  check(
    await b.rpc('resolve_couple_invitation', {
      p_token: token,
      p_accept: true,
    }),
    'Accept invite',
  )
  assert.equal(
    check(await b.from('couple_members').select('*'), 'Read own pair').length,
    2,
  )
  assert.equal(
    check(await c.from('couple_spaces').select('*'), 'Other pair isolation')
      .length,
    0,
  )
  assert.equal(
    check(await c.from('profiles').select('*'), 'Profile isolation').length,
    1,
  )
  assert.ok(
    (
      await a
        .from('couple_members')
        .insert({ space_id: space, user_id: bid, seat: 2 })
    ).error,
    'Direct membership INSERT forbidden',
  )
  for (const sdk of [anon, a])
    for (const fn of [
      'initialize_profile',
      'touch_profile',
      'require_verified_user',
    ]) {
      assert.ok(
        (await sdk.rpc(fn)).error,
        'Internal helper must not be callable through REST',
      )
    }
  for (const fn of ['create_couple_space', 'leave_couple_space'])
    assert.ok((await anon.rpc(fn)).error, 'Anonymous RPC forbidden')
  assert.ok(
    (
      await c.rpc('resolve_couple_invitation', {
        p_token: token,
        p_accept: true,
      })
    ).error,
    'Invite reuse denied',
  )
  console.log(
    'PASS: actual JWT roles, REST grants, RLS isolation, RPC invite acceptance and internal helper denial',
  )
  step = 'real recovery callback with an existing ordinary session'
  const recovered = await applyCallback(a, await recoveryCode())
  assert.equal(recovered.status, 'success')
  assert.equal(
    recovered.recovery,
    true,
    'Verified PASSWORD_RECOVERY event required',
  )
  const updatedPassword = `Updated-${password}`
  check(
    await a.auth.updateUser({ password: updatedPassword }),
    'Password update after recovery',
  )
  check(
    await a.auth.signInWithPassword({
      email: email('a'),
      password: updatedPassword,
    }),
    'New password works',
  )
  console.log(
    'PASS: real recovery email, PASSWORD_RECOVERY and updated password login',
  )
  step = 'expired PKCE code must fail despite an existing session'
  const expired = await recoveryCode()
  await db.query(
    "update auth.flow_state set created_at=now()-interval '2 hours',auth_code_issued_at=now()-interval '2 hours' where auth_code=$1",
    [expired.searchParams.get('code')],
  )
  const failed = await applyCallback(a, expired)
  assert.equal(failed.status, 'error', 'Expired flow must fail closed')
  assert.ok(
    check(await a.auth.getSession(), 'Retain normal session').session,
    'Normal session exists but is not recovery proof',
  )
  console.log(
    'PASS: expired real PKCE flow is rejected even with a pre-existing session',
  )
  step = 'missing verifier and erroneous redirect'
  await newUser(d, 'd')
  const missing = await applyCallback(
    client(),
    await recoveryCode(d, email('d')),
  )
  assert.equal(missing.status, 'error', 'Other browser has no verifier')
  const bad = await applyCallback(
    a,
    new URL(
      'http://127.0.0.1:5173/auth/update-password?error=access_denied&error_code=otp_expired&error_description=private-detail',
    ),
  )
  assert.equal(bad.status, 'error')
  console.log('PASS: missing PKCE verifier and Auth error redirect fail closed')
  step = 'equal partner exit through REST'
  check(await b.rpc('leave_couple_space'), 'Partner may leave independently')
  assert.equal(
    check(
      await b.from('couple_spaces').select('*'),
      'Former space access removed',
    ).length,
    0,
  )
  console.log('PASS: independent departure removes API visibility')
} catch (error) {
  console.error(`FAIL: ${step} (${error.code ?? error.name ?? 'error'})`)
  process.exitCode = 1
} finally {
  for (const id of created)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  for (const sdk of [admin, a, b, c, anon, d]) sdk.auth.stopAutoRefresh()
  await db.end()
  delete globalThis.window
}
