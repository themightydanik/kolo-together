import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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
  for (const name of (await readdir('supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await pool.query(await readFile('supabase/migrations/' + name, 'utf8'))
  }
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
  assert.equal(
    (await asUser(2, 'select recipient_email from public.couple_invitations'))
      .length,
    0,
  )
  assert.equal(
    (await asUser(1, 'select recipient_email from public.couple_invitations'))
      .length,
    1,
  )
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

test('all helper/RPC privileges, PUBLIC inheritance and fixed search_path match the allowlist', async () => {
  await pool.query(await readFile('supabase/tests/privileges.sql', 'utf8'))
  for (const role of [null, 1]) {
    for (const fn of [
      'initialize_profile',
      'touch_profile',
      'require_verified_user',
    ]) {
      await assert.rejects(
        asUser(role, `select public.${fn}()`),
        (error) => error.code === '42501',
      )
    }
  }
  for (const fn of [
    'create_couple_space()',
    "create_couple_invitation('test@example.test')",
    "inspect_couple_invitation('test')",
    "resolve_couple_invitation('test',true)",
    'leave_couple_space()',
    'is_space_member(null)',
    'is_partner(null)',
  ]) {
    await assert.rejects(
      asUser(null, `select public.${fn}`),
      (error) => error.code === '42501',
    )
  }
})

const task = async (n, options = {}) =>
  (
    await asUser(
      n,
      'select public.create_task($1,$2,$3,$4,$5,$6,$7,$8) as id',
      [
        options.request ?? randomUUID(),
        options.title ?? 'Маленькая забота',
        options.description ?? '',
        options.kind ?? 'personal',
        options.category ?? 'care',
        options.difficulty ?? 'normal',
        options.due ?? null,
        options.recurrence ?? 'once',
      ],
    )
  )[0].id
const instance = async (id) =>
  (
    await pool.query(
      'select * from public.task_instances where task_id=$1 order by period_start desc',
      [id],
    )
  ).rows[0]
const complete = (n, id) =>
  asUser(n, 'select public.complete_task_instance($1) as result', [id])
const respond = (n, id, accept = true) =>
  asUser(n, 'select public.respond_task($1,$2)', [id, accept])
const progress = async (n) =>
  (
    await asUser(
      n,
      'select xp::integer,coins::integer from public.user_progress',
    )
  )[0] ?? { xp: 0, coins: 0 }
async function pair() {
  const space = await create(1)
  await resolve(2, await invite(1, 2))
  return space
}

test('personal tasks: server reward matrix, category, title validation and one-off lifecycle', async () => {
  await create(1)
  for (const [difficulty, xp, coins] of [
    ['easy', 10, 5],
    ['normal', 20, 10],
    ['hard', 35, 15],
  ]) {
    const id = await task(1, { difficulty })
    const i = await instance(id)
    assert.equal(i.xp, xp)
    assert.equal(i.coins, coins)
    await complete(1, i.id)
    assert.equal(
      (await asUser(1, 'select status from public.tasks where id=$1', [id]))[0]
        .status,
      'completed',
    )
  }
  assert.deepEqual(await progress(1), { xp: 65, coins: 30 })
  assert.equal(
    (
      await asUser(
        1,
        "select * from public.reward_ledger where kind='together'",
      )
    ).length,
    0,
  )
  await assert.rejects(task(1, { title: 'x' }), /invalid_task/)
  await assert.rejects(
    task(1, { description: 'x'.repeat(1001) }),
    /invalid_task/,
  )
  await assert.rejects(task(1, { difficulty: 'give-me-1000' }), /invalid_task/)
  await assert.rejects(task(1, { category: 'unknown' }), /invalid_task/)
  await assert.rejects(task(1, { kind: 'joint' }), /partner_required/)
})
test('creation request id is idempotent under concurrent requests and conflicts cannot change data', async () => {
  await create(1)
  const request = randomUUID()
  const ids = await Promise.all([task(1, { request }), task(1, { request })])
  assert.equal(ids[0], ids[1])
  assert.equal((await asUser(1, 'select * from public.tasks')).length, 1)
  await assert.rejects(
    task(1, { request, title: 'Другое название' }),
    /task_request_conflict/,
  )
})
test('partner proposal is inactive until recipient agrees; creator cannot act for partner', async () => {
  await pair()
  const id = await task(1, { kind: 'proposal' })
  assert.equal(await instance(id), undefined)
  await assert.rejects(respond(1, id), /task_transition_denied/)
  await respond(2, id)
  await respond(2, id)
  const i = await instance(id)
  await assert.rejects(complete(1, i.id), /task_unavailable/)
  await complete(2, i.id)
  assert.deepEqual(await progress(1), { xp: 0, coins: 0 })
  assert.deepEqual(await progress(2), { xp: 20, coins: 10 })
  assert.equal(
    (
      await pool.query(
        "select * from public.reward_ledger where kind='together'",
      )
    ).rowCount,
    0,
  )
})
test('decline is voluntary, idempotent and gives no points or penalty', async () => {
  await pair()
  const id = await task(1, { kind: 'joint' })
  await respond(2, id, false)
  await respond(2, id, false)
  await assert.rejects(respond(2, id, true), /task_transition_denied/)
  assert.equal(
    (await asUser(1, 'select status from public.tasks where id=$1', [id]))[0]
      .status,
    'declined',
  )
  assert.deepEqual(await progress(2), { xp: 0, coins: 0 })
  assert.equal(await instance(id), undefined)
})
test('joint task rewards each user only for own completion and Together XP exactly once', async () => {
  const space = await pair()
  const id = await task(1, { kind: 'joint', difficulty: 'hard' })
  await respond(2, id)
  const i = await instance(id)
  await complete(1, i.id)
  assert.deepEqual(await progress(1), { xp: 35, coins: 15 })
  assert.deepEqual(await progress(2), { xp: 0, coins: 0 })
  assert.equal(
    (await pool.query('select * from public.space_progress')).rowCount,
    0,
  )
  const result = await complete(2, i.id)
  assert.equal(result[0].result.together_xp, 20)
  assert.equal(
    (
      await pool.query(
        'select together_xp::integer from public.space_progress where space_id=$1',
        [space],
      )
    ).rows[0].together_xp,
    20,
  )
  await complete(1, i.id)
  await complete(2, i.id)
  assert.equal(
    (await pool.query('select * from public.reward_ledger')).rowCount,
    3,
  )
})
test('double submit and simultaneous partner completions do not double mint', async () => {
  await pair()
  const id = await task(1, { kind: 'joint' })
  await respond(2, id)
  const i = await instance(id)
  const results = await Promise.all([
    complete(1, i.id),
    complete(1, i.id),
    complete(2, i.id),
    complete(2, i.id),
  ])
  assert.equal(results.filter((r) => !r[0].result.already_completed).length, 2)
  assert.deepEqual(await progress(1), { xp: 20, coins: 10 })
  assert.deepEqual(await progress(2), { xp: 20, coins: 10 })
  assert.equal(
    (await pool.query('select * from public.task_completions')).rowCount,
    2,
  )
  assert.equal(
    (
      await pool.query(
        "select * from public.reward_ledger where kind='together'",
      )
    ).rowCount,
    1,
  )
})
test('recurring daily tasks generate only current UTC period and preserve past grants', async () => {
  await create(1)
  const id = await task(1, { recurrence: 'daily' })
  const yesterday = await instance(id)
  await complete(1, yesterday.id)
  // Advance logical period fixture without changing the real clock or public API.
  await pool.query(
    'update public.task_instances set period_start=period_start-1 where id=$1',
    [yesterday.id],
  )
  await pool.query(
    'update public.tasks set anchor_date=anchor_date-1 where id=$1',
    [id],
  )
  await Promise.all([
    asUser(1, 'select public.refresh_task_instances()'),
    asUser(1, 'select public.refresh_task_instances()'),
  ])
  const today = await instance(id)
  assert.notEqual(today.id, yesterday.id)
  assert.equal(
    (
      await pool.query('select * from public.task_instances where task_id=$1', [
        id,
      ])
    ).rowCount,
    2,
  )
  await complete(1, today.id)
  await complete(1, today.id)
  assert.deepEqual(await progress(1), { xp: 40, coins: 20 })
  // Retrying a historical earned result is harmless, but cannot award again.
  assert.equal(
    (await complete(1, yesterday.id))[0].result.already_completed,
    true,
  )
})
test('unearned past periods expire, cannot be completed or backfilled; weekly periods start Monday UTC', async () => {
  await create(1)
  const id = await task(1, { recurrence: 'daily' })
  const old = await instance(id)
  await pool.query(
    'update public.task_instances set period_start=period_start-3 where id=$1',
    [old.id],
  )
  await pool.query(
    'update public.tasks set anchor_date=anchor_date-20 where id=$1',
    [id],
  )
  await assert.rejects(complete(1, old.id), /task_period_expired/)
  await asUser(1, 'select public.refresh_task_instances()')
  assert.equal(
    (
      await pool.query('select status from public.task_instances where id=$1', [
        old.id,
      ])
    ).rows[0].status,
    'expired',
  )
  assert.equal(
    (
      await pool.query('select * from public.task_instances where task_id=$1', [
        id,
      ])
    ).rowCount,
    2,
  )
  await assert.rejects(complete(1, old.id), /task_unavailable/)
  const weekly = await task(1, { recurrence: 'weekly' })
  const wi = await instance(weekly)
  assert.equal(
    (
      await pool.query(
        'select extract(isodow from period_start)::integer as day from public.task_instances where id=$1',
        [wi.id],
      )
    ).rows[0].day,
    1,
  )
  await pool.query(
    'update public.task_instances set period_start=period_start-7 where id=$1',
    [wi.id],
  )
  await asUser(1, 'select public.refresh_task_instances()')
  assert.notEqual((await instance(weekly)).id, wi.id)
})
test('future start dates never create earnable instances early', async () => {
  await create(1)
  const date = (
    await pool.query(
      "select ((now() at time zone 'UTC')::date+2)::text as date",
    )
  ).rows[0].date
  const id = await task(1, { due: date, recurrence: 'daily' })
  await asUser(1, 'select public.refresh_task_instances()')
  assert.equal(await instance(id), undefined)
})
test('cancellation preserves earned history and cannot cancel partially completed joint tasks', async () => {
  await pair()
  const id = await task(1, { kind: 'joint' })
  await respond(2, id)
  const i = await instance(id)
  await complete(1, i.id)
  await assert.rejects(
    asUser(1, 'select public.cancel_task($1)', [id]),
    /task_has_completions/,
  )
  await assert.rejects(
    asUser(2, 'select public.cancel_task($1)', [id]),
    /task_unavailable/,
  )
  const other = await task(1)
  const oi = await instance(other)
  await asUser(1, 'select public.cancel_task($1)', [other])
  await asUser(1, 'select public.cancel_task($1)', [other])
  await assert.rejects(complete(1, oi.id), /task_unavailable/)
  const repeating = await task(1, { recurrence: 'daily' })
  const ri = await instance(repeating)
  await complete(1, ri.id)
  await asUser(1, 'select public.cancel_task($1)', [repeating])
  assert.equal(
    (
      await pool.query('select status from public.task_instances where id=$1', [
        ri.id,
      ])
    ).rows[0].status,
    'completed',
  )
  assert.deepEqual(await progress(1), { xp: 40, coins: 20 })
})
test('departure closes shared tasks, preserves personal rewards and historic space progress', async () => {
  const space = await pair()
  const done = await task(1, { kind: 'joint' })
  await respond(2, done)
  const di = await instance(done)
  await complete(1, di.id)
  await complete(2, di.id)
  const partial = await task(1, { kind: 'joint' })
  await respond(2, partial)
  const pi = await instance(partial)
  await complete(1, pi.id)
  const personal = await task(1)
  const own = await instance(personal)
  const pending = await task(2, { kind: 'proposal' })
  await asUser(2, 'select public.leave_couple_space()')
  assert.equal((await complete(1, pi.id))[0].result.already_completed, true)
  await assert.rejects(complete(2, pi.id), /task_unavailable/)
  await complete(1, own.id)
  assert.deepEqual(await progress(2), { xp: 20, coins: 10 })
  assert.deepEqual(await progress(1), { xp: 60, coins: 30 })
  assert.equal((await asUser(2, 'select * from public.tasks')).length, 0)
  assert.equal(
    (await asUser(2, 'select * from public.reward_ledger')).length,
    1,
  )
  assert.equal(
    (await pool.query('select status from public.tasks where id=$1', [pending]))
      .rows[0].status,
    'cancelled',
  )
  assert.equal(
    (
      await pool.query(
        'select together_xp::integer from public.space_progress where space_id=$1',
        [space],
      )
    ).rows[0].together_xp,
    20,
  )
})
test('completion and exit races serialize; no additional awards after departure commits', async () => {
  await pair()
  const id = await task(1, { kind: 'joint' })
  await respond(2, id)
  const i = await instance(id)
  await complete(1, i.id)
  await Promise.allSettled([
    complete(2, i.id),
    asUser(2, 'select public.leave_couple_space()'),
  ])
  const before = (
    await pool.query('select count(*)::integer as n from public.reward_ledger')
  ).rows[0].n
  await assert.rejects(complete(2, i.id), /task_unavailable/)
  assert.equal(
    (
      await pool.query(
        'select count(*)::integer as n from public.reward_ledger',
      )
    ).rows[0].n,
    before,
  )
  assert.ok([1, 3].includes(before))
})
test('different pairs and personal tasks are isolated; progress and journal cannot be changed directly', async () => {
  await pair()
  await create(3)
  const id = await task(1)
  const i = await instance(id)
  await complete(1, i.id)
  for (const n of [2, 3]) {
    assert.equal(
      (await asUser(n, 'select * from public.tasks where id=$1', [id])).length,
      0,
    )
    assert.equal(
      (
        await asUser(n, 'select * from public.task_instances where id=$1', [
          i.id,
        ])
      ).length,
      0,
    )
    assert.equal(
      (
        await asUser(
          n,
          'select * from public.task_completions where instance_id=$1',
          [i.id],
        )
      ).length,
      0,
    )
    assert.equal(
      (await asUser(n, 'select * from public.reward_ledger')).length,
      0,
    )
    await assert.rejects(complete(n, i.id), /task_unavailable/)
  }
  for (const table of [
    'tasks',
    'task_participants',
    'task_instances',
    'task_completions',
    'user_progress',
    'space_progress',
    'reward_ledger',
    'task_reward_rules',
    'task_economy_settings',
  ]) {
    await assert.rejects(
      asUser(null, 'select * from public.' + table),
      /permission denied/,
    )
    await assert.rejects(
      asUser(1, 'delete from public.' + table),
      /permission denied/,
    )
  }
  await assert.rejects(
    asUser(1, 'update public.user_progress set coins=999999'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, 'update public.reward_ledger set xp=999999'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, 'insert into public.user_progress values($1,999,999)', [uid(1)]),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, "update public.task_participants set consent='accepted'"),
    /permission denied/,
  )
  await assert.rejects(
    asUser(null, 'select public.refresh_task_instances()'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, 'select public.materialize_task($1)', [id]),
    /permission denied/,
  )
})
test('reward snapshots are stable and errors roll back the entire economic transaction', async () => {
  await create(1)
  const id = await task(1)
  const i = await instance(id)
  try {
    await pool.query(
      "update public.task_reward_rules set xp=100 where difficulty='normal'",
    )
    await asUser(1, 'select public.refresh_task_instances()')
    await complete(1, i.id)
    assert.deepEqual(await progress(1), { xp: 20, coins: 10 })
  } finally {
    await pool.query(
      "update public.task_reward_rules set xp=20 where difficulty='normal'",
    )
  }
  const failing = await task(1)
  const fi = await instance(failing)
  await pool.query(
    'update public.user_progress set xp=9007199254740991 where user_id=$1',
    [uid(1)],
  )
  await assert.rejects(complete(1, fi.id), /check constraint/)
  assert.equal(
    (
      await pool.query(
        'select * from public.task_completions where instance_id=$1',
        [fi.id],
      )
    ).rowCount,
    0,
  )
  assert.equal(
    (
      await pool.query(
        'select * from public.reward_ledger where instance_id=$1',
        [fi.id],
      )
    ).rowCount,
    0,
  )
})

test('task functions and tables have exact effective grants without PUBLIC or anonymous access', async () => {
  await pool.query(await readFile('supabase/tests/task-privileges.sql', 'utf8'))
  for (const sql of [
    'select public.materialize_task(null)',
    "select public.task_period('daily',current_date)",
    'select public.close_tasks_on_departure()',
  ]) {
    for (const n of [null, 1])
      await assert.rejects(asUser(n, sql), (e) => e.code === '42501')
  }
})
test('accept/decline and cancel/complete races yield a single valid transition', async () => {
  await pair()
  const id = await task(1, { kind: 'proposal' })
  const results = await Promise.allSettled([
    respond(2, id, true),
    respond(2, id, false),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const status = (
    await pool.query('select status from public.tasks where id=$1', [id])
  ).rows[0].status
  assert.ok(['active', 'declined'].includes(status))
  assert.deepEqual(await progress(2), { xp: 0, coins: 0 })
  const own = await task(1)
  const i = await instance(own)
  const race = await Promise.allSettled([
    complete(1, i.id),
    asUser(1, 'select public.cancel_task($1)', [own]),
  ])
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1)
  const final = (
    await pool.query('select status from public.tasks where id=$1', [own])
  ).rows[0].status
  assert.equal((await progress(1)).xp, final === 'completed' ? 20 : 0)
})

test('partial joint repeats never combine different periods into Together XP', async () => {
  await pair()
  const id = await task(1, { kind: 'joint', recurrence: 'daily' })
  await respond(2, id)
  const old = await instance(id)
  await complete(1, old.id)
  await pool.query(
    'update public.task_instances set period_start=period_start-1 where id=$1',
    [old.id],
  )
  await pool.query(
    'update public.tasks set anchor_date=anchor_date-1 where id=$1',
    [id],
  )
  await assert.rejects(complete(2, old.id), /task_period_expired/)
  await asUser(1, 'select public.refresh_task_instances()')
  const current = await instance(id)
  await complete(2, current.id)
  assert.equal(
    (
      await pool.query(
        "select * from public.reward_ledger where kind='together'",
      )
    ).rowCount,
    0,
  )
  await complete(1, current.id)
  assert.equal(
    (
      await pool.query(
        "select * from public.reward_ledger where kind='together'",
      )
    ).rowCount,
    1,
  )
  assert.deepEqual(await progress(1), { xp: 40, coins: 20 })
  assert.deepEqual(await progress(2), { xp: 20, coins: 10 })
})
test('a new partner inherits the space total but cannot read previous private task history', async () => {
  const space = await pair()
  const id = await task(1, { kind: 'joint' })
  await respond(2, id)
  const i = await instance(id)
  await complete(1, i.id)
  await complete(2, i.id)
  await asUser(2, 'select public.leave_couple_space()')
  await resolve(3, await invite(1, 3))
  assert.equal(
    (await asUser(3, 'select * from public.tasks where id=$1', [id])).length,
    0,
  )
  assert.equal(
    (await asUser(3, 'select * from public.reward_ledger')).length,
    0,
  )
  assert.equal(
    (
      await asUser(
        3,
        'select together_xp::integer from public.space_progress where space_id=$1',
        [space],
      )
    )[0].together_xp,
    20,
  )
  await assert.rejects(task(8), /verified_account_required/)
})

test('joint rewards require exactly two accepted current members even after privileged membership removal',async()=>{
 await pair();const id=await task(1,{kind:'joint'});await respond(2,id);const i=await instance(id)
 // A maintenance-only fixture, not an operation available to authenticated clients.
 await pool.query('delete from public.couple_members where user_id=$1',[uid(2)])
 await assert.rejects(complete(1,i.id),/task_unavailable/)
 assert.deepEqual(await progress(1),{xp:0,coins:0})
 assert.equal((await pool.query('select * from public.reward_ledger')).rowCount,0)
})
