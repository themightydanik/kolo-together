import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
const url = process.env.KOLO_LOCAL_TEST_DB
if (
  !url ||
  new URL(url).hostname !== '127.0.0.1' ||
  new URL(url).pathname !== '/kolo_test'
)
  throw new Error('Only disposable local kolo_test is allowed')
const pool = new pg.Pool({ connectionString: url, max: 10 })
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
async function asUser(n, sql, args = []) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(
      n === null ? 'set local role anon' : 'set local role authenticated',
    )
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [
      n === null ? '' : uid(n),
    ])
    const result = await c.query(sql, args)
    await c.query('commit')
    return result.rows
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}
const create = async (n) =>
  (await asUser(n, 'select public.create_couple_space() as id'))[0].id
const invite = async (n, to) =>
  (
    await asUser(n, 'select public.create_couple_invitation($1) as token', [
      `user${to}@example.test`,
    ])
  )[0].token
const resolve = (n, token, accept = true) =>
  asUser(n, 'select public.resolve_couple_invitation($1,$2)', [token, accept])
before(async () => {
  await pool.query(await readFile('supabase/tests/bootstrap.sql', 'utf8'))
  await pool.query(
    await readFile(
      'supabase/migrations/20261019150000_auth_profiles_couples.sql',
      'utf8',
    ),
  )
})
beforeEach(async () => {
  await pool.query(
    'truncate auth.users, public.profiles, public.couple_members, public.couple_invitations, public.couple_spaces cascade',
  )
  for (let n = 1; n <= 8; n++)
    await pool.query('insert into auth.users values($1,$2,$3)', [
      uid(n),
      `user${n}@example.test`,
      n === 8 ? null : new Date(),
    ])
})
after(() => pool.end())
test('profile trigger, own update only, immutable identity/timestamps, anonymous blocked', async () => {
  assert.equal((await asUser(1, 'select * from public.profiles')).length, 1)
  await asUser(1, "update public.profiles set display_name='Аня' where id=$1", [
    uid(1),
  ])
  assert.equal(
    (await asUser(1, 'select display_name from public.profiles'))[0]
      .display_name,
    'Аня',
  )
  assert.equal(
    (
      await asUser(
        2,
        "update public.profiles set display_name='wrong' where id=$1 returning id",
        [uid(1)],
      )
    ).length,
    0,
  )
  await assert.rejects(
    asUser(1, 'update public.profiles set id=$1', [uid(2)]),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, 'update public.profiles set created_at=now()'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(null, 'select * from public.profiles'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(8, 'select public.create_couple_space()'),
    /verified_account_required/,
  )
  await assert.rejects(
    asUser(1, 'select public.require_verified_user()'),
    /permission denied/,
  )
})
test('RLS isolates spaces, memberships, invitations and partner profiles', async () => {
  const a = await create(1)
  const b = await create(3)
  const token = await invite(1, 2)
  await resolve(2, token)
  assert.deepEqual(
    (await asUser(2, 'select id from public.couple_spaces')).map((r) => r.id),
    [a],
  )
  assert.equal(
    (await asUser(2, 'select * from public.couple_members')).length,
    2,
  )
  assert.equal((await asUser(2, 'select * from public.profiles')).length, 2)
  assert.equal((await asUser(3, 'select * from public.profiles')).length, 1)
  assert.equal(
    (await asUser(3, 'select id from public.couple_invitations')).length,
    0,
  )
  assert.equal(
    (await asUser(1, 'select id from public.couple_spaces where id=$1', [b]))
      .length,
    0,
  )
  await assert.rejects(
    asUser(1, 'select token_hash from public.couple_invitations'),
    /permission denied/,
  )
})
test('joining a space does not reveal historical invite recipient emails', async () => {
  await create(1)
  const token = await invite(1, 2)
  await resolve(2, token)
  assert.equal((await asUser(2, 'select recipient_email from public.couple_invitations')).length, 0)
  assert.equal((await asUser(1, 'select recipient_email from public.couple_invitations')).length, 1)
})
test('cannot forge membership, add others, change another membership or add a third seat', async () => {
  const space = await create(1)
  await assert.rejects(
    asUser(
      1,
      'insert into public.couple_members(space_id,user_id,seat) values($1,$2,2)',
      [space, uid(2)],
    ),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, 'update public.couple_members set user_id=$1', [uid(2)]),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, 'delete from public.couple_members'),
    /permission denied/,
  )
  await resolve(2, await invite(1, 2))
  await assert.rejects(invite(1, 3), /space_full/)
  await assert.rejects(
    pool.query(
      'insert into public.couple_members(space_id,user_id,seat) values($1,$2,3)',
      [space, uid(3)],
    ),
    /check constraint/,
  )
  await assert.rejects(
    pool.query(
      'insert into public.couple_members(space_id,user_id,seat) values($1,$2,2)',
      [space, uid(3)],
    ),
    /unique constraint/,
  )
})
test('only intended verified email may inspect, accept or decline; successful acceptance is single-use', async () => {
  await create(1)
  const token = await invite(1, 2)
  assert.equal(
    (
      await asUser(3, 'select * from public.inspect_couple_invitation($1)', [
        token,
      ])
    ).length,
    0,
  )
  await assert.rejects(resolve(3, token), /invitation_unavailable/)
  await assert.rejects(resolve(3, token, false), /invitation_unavailable/)
  await resolve(2, token)
  await assert.rejects(resolve(2, token), /invitation_unavailable/)
  const row = (
    await pool.query(
      'select token_hash,consumed_at,accepted_by from public.couple_invitations',
    )
  ).rows[0]
  assert.notEqual(row.token_hash, token)
  assert.ok(row.consumed_at)
  assert.equal(row.accepted_by, uid(2))
})
test('decline consumes invitation without creating membership', async () => {
  await create(1)
  const token = await invite(1, 2)
  await resolve(2, token, false)
  await assert.rejects(resolve(2, token), /invitation_unavailable/)
  assert.equal(
    (await asUser(2, 'select * from public.couple_members')).length,
    0,
  )
  assert.ok(
    (await pool.query('select declined_at from public.couple_invitations'))
      .rows[0].declined_at,
  )
})
test('expired and superseded invitations cannot be used', async () => {
  await create(1)
  const old = await invite(1, 2)
  const token = await invite(1, 2)
  await assert.rejects(resolve(2, old), /invitation_unavailable/)
  await pool.query(
    "update public.couple_invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where revoked_at is null",
  )
  await assert.rejects(resolve(2, token), /invitation_unavailable/)
})
test('concurrent acceptance of one invitation commits exactly once', async () => {
  await create(1)
  const token = await invite(1, 2)
  const results = await Promise.allSettled([
    resolve(2, token),
    resolve(2, token),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1)
  assert.equal(
    (
      await pool.query(
        'select * from public.couple_members where left_at is null',
      )
    ).rowCount,
    2,
  )
})
test('concurrent creates and competing spaces cannot give a user two active memberships', async () => {
  const creates = await Promise.allSettled([create(1), create(1)])
  assert.equal(creates.filter((r) => r.status === 'fulfilled').length, 1)
  await create(3)
  const a = await invite(1, 2),
    b = await invite(3, 2)
  const joins = await Promise.allSettled([resolve(2, a), resolve(2, b)])
  assert.equal(joins.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(
    (
      await pool.query(
        'select * from public.couple_members where user_id=$1 and left_at is null',
        [uid(2)],
      )
    ).rowCount,
    1,
  )
})
test('equal partners may leave without permission; visibility and pending invitations are revoked', async () => {
  const space = await create(1)
  await resolve(2, await invite(1, 2))
  await asUser(1, 'select public.leave_couple_space()')
  assert.equal(
    (await asUser(1, 'select * from public.couple_spaces')).length,
    0,
  )
  assert.equal((await asUser(1, 'select * from public.profiles')).length, 1)
  assert.equal(
    (await asUser(2, 'select * from public.couple_members')).length,
    1,
  )
  const token = await invite(2, 3)
  await asUser(2, 'select public.leave_couple_space()')
  await assert.rejects(resolve(3, token), /invitation_unavailable/)
  assert.ok(
    (
      await pool.query(
        'select archived_at from public.couple_spaces where id=$1',
        [space],
      )
    ).rows[0].archived_at,
  )
  await create(2)
})
test('concurrent departure and acceptance cannot violate capacity or retain a stale invitation', async () => {
  await create(1)
  const token = await invite(1, 2)
  await Promise.allSettled([
    asUser(1, 'select public.leave_couple_space()'),
    resolve(2, token),
  ])
  await assert.rejects(resolve(2, token), /invitation_unavailable/)
  assert.equal(
    (
      await pool.query(
        'select * from public.couple_members where left_at is null',
      )
    ).rowCount <= 1,
    true,
  )
})

test('browser roles cannot forge spaces or invitations and cannot mutate them directly', async () => {
  const space = await create(1)
  await assert.rejects(
    asUser(1, 'insert into public.couple_spaces default values'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, 'update public.couple_spaces set archived_at=now()'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(
      1,
      "insert into public.couple_invitations(space_id,recipient_email,token_hash) values($1,'user2@example.test',repeat('a',64))",
      [space],
    ),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, 'update public.couple_invitations set expires_at=now()'),
    /permission denied/,
  )
})
test('competing recipients can never fill a third seat even with two pending invitations', async () => {
  const space = await create(1)
  const a = await invite(1, 2)
  // Fixture representing a legacy second pending invitation. Browser cannot insert it.
  const b = 'f'.repeat(64)
  await pool.query(
    "insert into public.couple_invitations(space_id,created_by,recipient_email,token_hash) values($1,$2,'user3@example.test',encode(sha256(convert_to($3,'UTF8')),'hex'))",
    [space, uid(1), b],
  )
  const results = await Promise.allSettled([resolve(2, a), resolve(3, b)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(
    (
      await pool.query(
        'select * from public.couple_members where space_id=$1 and left_at is null',
        [space],
      )
    ).rowCount,
    2,
  )
})
