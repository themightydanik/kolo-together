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
    if (name === '20261019220000_rewards_store.sql') {
      await pool.query('insert into auth.users values($1,$2,$3)', [
        uid(90),
        'historical@example.test',
        new Date(),
      ])
      await create(90)
      const historical = await task(90)
      await complete(90, (await instance(historical)).id)
    }
    await pool.query(await readFile('supabase/migrations/' + name, 'utf8'))
    if (name === '20261019220000_rewards_store.sql') {
      assert.deepEqual(
        await progress(90),
        { xp: 20, coins: 10 },
        'migration never credits historical earnings twice',
      )
      assert.equal(
        (
          await asUser(
            90,
            "select * from public.coin_transactions where kind='earn'",
          )
        ).length,
        1,
      )
      await assertCoinAccounting(90)
    }
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
    'select public.task_clock()',
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

test('completion authorization remains explicit even if instance visibility is widened', async () => {
  await pair()
  await create(3)
  const personal = await task(1)
  const foreign = await task(3)
  await complete(1, (await instance(personal)).id)
  await complete(3, (await instance(foreign)).id)
  const c = await pool.connect()
  try {
    await c.query('begin')
    // Defense-in-depth regression: completion privacy must not rely solely on
    // the implementation of the instance policy. This DDL is rolled back.
    await c.query('drop policy instances_read on public.task_instances')
    await c.query('create policy instances_read on public.task_instances for select to authenticated using(true)')
    await c.query('set local role authenticated')
    for (const [n, expected] of [[1, 1], [2, 0], [3, 1], [4, 0]]) {
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(n)])
      assert.equal((await c.query('select * from public.task_completions')).rowCount, expected)
    }
  } finally {
    await c.query('rollback')
    c.release()
  }
})

test('daily and weekly boundary lock waits expire partial history and materialize exactly once', async () => {
  const original = (await pool.query("select pg_get_functiondef('public.task_clock()'::regprocedure) as def")).rows[0].def
  await pool.query('create table public.review_clock(day date not null)')
  try {
    // A privileged disposable-DB fixture only; no clock parameter or EXECUTE
    // grant is added to any production/client RPC.
    await pool.query(`create or replace function public.task_clock()
      returns timestamptz language sql volatile set search_path='' as $$
      select day::timestamp at time zone 'UTC' from public.review_clock $$`)
    const space = await pair()
    for (const recurrence of ['daily', 'weekly']) {
      await pool.query("truncate public.review_clock")
      await pool.query("insert into public.review_clock values('2030-01-07')")
      const id = await task(1, {kind: 'joint', recurrence})
      await respond(2, id)
      const old = await instance(id)
      await complete(1, old.id)
      const blocker = await pool.connect()
      const waiter = await pool.connect()
      let pending
      try {
        await blocker.query('begin')
        await blocker.query('select 1 from public.couple_spaces where id=$1 for update', [space])
        await waiter.query('begin')
        await waiter.query('set local role authenticated')
        await waiter.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(2)])
        const pid = (await waiter.query('select pg_backend_pid() as id')).rows[0].id
        pending = waiter.query('select public.complete_task_instance($1)', [old.id]).then(
          () => ({ok: true}), error => ({error}),
        )
        let blocked = false
        for (let attempt=0; attempt<200; attempt++) {
          blocked = (await pool.query("select wait_event_type='Lock' as blocked from pg_stat_activity where pid=$1", [pid])).rows[0].blocked
          if (blocked) break
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        assert.equal(blocked, true, 'completion must actually wait across the boundary')
        await pool.query("update public.review_clock set day=day+$1::integer", [recurrence==='daily' ? 1 : 7])
        await blocker.query('commit')
        const result = await pending
        assert.match(result.error?.message ?? '', /task_period_expired/)
      } finally {
        await blocker.query('rollback')
        if (pending) await pending
        await waiter.query('rollback')
        blocker.release()
        waiter.release()
      }
      await Promise.all([asUser(1,'select public.refresh_task_instances()'), asUser(2,'select public.refresh_task_instances()'), asUser(1,'select public.refresh_task_instances()')])
      assert.equal((await pool.query('select status from public.task_instances where id=$1',[old.id])).rows[0].status, 'expired')
      assert.equal((await pool.query('select * from public.task_instances where task_id=$1',[id])).rowCount, 2)
      assert.equal((await pool.query('select * from public.task_completions where instance_id=$1',[old.id])).rowCount, 1)
      assert.equal((await pool.query('select * from public.reward_ledger where instance_id=$1',[old.id])).rowCount, 1)
      const current = await instance(id)
      await Promise.all([complete(1,current.id),complete(2,current.id),complete(1,current.id),complete(2,current.id)])
      assert.equal((await pool.query('select * from public.reward_ledger where instance_id=$1',[current.id])).rowCount, 3)
      assert.equal((await pool.query('select * from public.task_completions where instance_id=$1',[current.id])).rowCount, 2)
    }
  } finally {
    await pool.query(original)
    await pool.query('drop table public.review_clock')
  }
})

test('failure of the final shared award rolls back completion and personal award; retry awards once', async () => {
  const space = await pair()
  const id = await task(1,{kind:'joint'})
  await respond(2,id)
  const i = await instance(id)
  await complete(1,i.id)
  await pool.query('insert into public.space_progress values($1,9007199254740991)',[space])
  await assert.rejects(complete(2,i.id), /check constraint/)
  assert.deepEqual(await progress(2),{xp:0,coins:0})
  assert.equal((await pool.query('select * from public.task_completions where instance_id=$1',[i.id])).rowCount,1)
  assert.equal((await pool.query('select * from public.reward_ledger where instance_id=$1',[i.id])).rowCount,1)
  assert.equal((await instance(id)).status,'active')
  await pool.query('update public.space_progress set together_xp=0 where space_id=$1',[space])
  await Promise.all([complete(2,i.id),complete(2,i.id)])
  assert.deepEqual(await progress(1),{xp:20,coins:10})
  assert.deepEqual(await progress(2),{xp:20,coins:10})
  assert.equal((await pool.query('select * from public.reward_ledger where instance_id=$1',[i.id])).rowCount,3)
  assert.equal((await pool.query('select together_xp::integer as xp from public.space_progress where space_id=$1',[space])).rows[0].xp,20)
})

test('cancel, departure and rejoining preserve historical consent and rewards without revival', async () => {
  await pair()
  const cancelled = await task(1,{kind:'joint'})
  await respond(2,cancelled)
  await asUser(1,'select public.cancel_task($1)',[cancelled])
  const partial = await task(1,{kind:'joint',recurrence:'daily'})
  await respond(2,partial)
  const old = await instance(partial)
  await complete(1,old.id)
  const pending = await task(1,{kind:'proposal'})
  await asUser(2,'select public.leave_couple_space()')
  await resolve(2,await invite(1,2))
  for (const id of [cancelled,partial,pending]) {
    assert.equal((await pool.query('select status from public.tasks where id=$1',[id])).rows[0].status,'cancelled')
    await assert.rejects(respond(2,id),/task_transition_denied/)
    if (id!==pending) await assert.rejects(complete(2,(await instance(id)).id),/task_unavailable/)
  }
  await Promise.all([asUser(1,'select public.refresh_task_instances()'),asUser(2,'select public.refresh_task_instances()')])
  assert.equal((await pool.query('select * from public.task_instances where task_id=$1',[partial])).rowCount,1)
  assert.equal((await instance(partial)).status,'cancelled')
  assert.equal((await pool.query('select * from public.task_participants where task_id=$1 and consent=\'accepted\'',[partial])).rowCount,2)
  assert.equal((await pool.query('select * from public.task_completions')).rowCount,1)
  assert.equal((await pool.query('select * from public.reward_ledger')).rowCount,1)
  assert.deepEqual(await progress(1),{xp:20,coins:10})
  assert.equal((await complete(1,old.id))[0].result.already_completed,true)
})

// Stage 4: real PostgreSQL, actual RLS/locks/transactions; no monetary mocks.
const offer = async (n, options = {}) =>
  (
    await asUser(
      n,
      'select public.create_reward_offer($1,$2,$3,$4,$5,$6,$7,$8) as id',
      [
        options.request ?? randomUUID(),
        options.title ?? 'Вечер вместе',
        options.description ?? '',
        options.kind ?? 'partner',
        options.category ?? 'care',
        options.emoji ?? '🎁',
        options.price ?? 5,
        options.single ?? false,
      ],
    )
  )[0].id
const buy = async (n,id,key=randomUUID()) => {
  const count=(await asUser(n,'select count(*)::integer as n from public.reward_purchases where offer_id=$1 and buyer_id=$2',[id,uid(n)]))[0].n
  return (await asUser(n,'select public.buy_reward_offer($1,$2,$3) as id',[id,key,count]))[0].id
}
const consent = (n, id, accept = true) =>
  asUser(n, 'select public.respond_reward_offer($1,$2)', [id, accept])
const purchaseAction = (n, id, action) =>
  asUser(n, 'select public.act_reward_purchase($1,$2)', [id, action])
const publish = (n, id, published) =>
  asUser(n, 'select public.set_reward_offer_published($1,$2)', [id, published])
async function earn(n, count = 1) {
  for (let j = 0; j < count; j++)
    await complete(n, (await instance(await task(n))).id)
}
async function assertCoinAccounting(n) {
  const {
    rows: [r],
  } = await pool.query(
    `select coalesce(sum(case when kind='spend' then -amount else amount end),0)::integer as total from public.coin_transactions where user_id=$1`,
    [uid(n)],
  )
  assert.equal((await progress(n)).coins, r.total)
  const summary = (
    await asUser(n, 'select public.get_coin_summary() as summary')
  )[0].summary
  assert.equal(summary.balance, r.total)
  const sums = (
    await pool.query(
      'select kind,sum(amount)::text as amount from public.coin_transactions where user_id=$1 group by kind',
      [uid(n)],
    )
  ).rows
  for (const [key, kind] of [
    ['earned', 'earn'],
    ['spent', 'spend'],
    ['refunded', 'refund'],
  ])
    assert.equal(
      summary[key],
      sums.find((row) => row.kind === kind)?.amount ?? '0',
    )
}

test('store validates creation, records personal consent, publishes and keeps immutable snapshots', async () => {
  await pair()
  await earn(2)
  for (const options of [
    { price: 0 },
    { price: 100001 },
    { title: 'x' },
    { description: 'a'.repeat(1001) },
    { emoji: '<svg>' },
    { category: 'unknown' },
  ])
    await assert.rejects(offer(1, options), /invalid_reward_offer/)
  const key = randomUUID()
  const id = await offer(1, { request: key })
  assert.equal(await offer(1, { request: key }), id)
  await assert.rejects(
    offer(1, { request: key, price: 6 }),
    /reward_request_conflict/,
  )
  assert.equal(
    (
      await asUser(
        1,
        'select * from public.reward_offer_consents where offer_id=$1',
        [id],
      )
    )[0].consent,
    'accepted',
  )
  await publish(1, id, false)
  await assert.rejects(buy(2, id), /reward_unavailable/)
  await assert.rejects(publish(2, id, true), /reward_transition_denied/)
  await publish(1, id, true)
  await assert.rejects(buy(1, id), /reward_unavailable/)
  const p = await buy(2, id)
  await publish(1, id, false)
  // Maintenance-only change: no published-offer edit RPC exists.
  await pool.query(
    "update public.reward_offers set title='Изменено',price=99 where id=$1",
    [id],
  )
  const purchase = (
    await asUser(2, 'select * from public.reward_purchases where id=$1', [p])
  )[0]
  assert.equal(purchase.title, 'Вечер вместе')
  assert.equal(purchase.price, 5)
  await purchaseAction(2, p, 'cancel')
  await assertCoinAccounting(2)
})
test('joint offers need the other partner consent; rejection has no cost and cannot be forged', async () => {
  await pair()
  await earn(1)
  const id = await offer(1, { kind: 'joint' })
  await assert.rejects(buy(1, id), /reward_unavailable/)
  await assert.rejects(consent(1, id), /reward_transition_denied/)
  await consent(2, id, false)
  await consent(2, id, false)
  await assert.rejects(consent(2, id, true), /reward_transition_denied/)
  await assert.rejects(publish(1, id, true), /reward_transition_denied/)
  assert.equal((await progress(1)).coins, 10)
  const yes = await offer(1, { kind: 'joint' })
  await consent(2, yes)
  await consent(2, yes)
  const p = await buy(1, yes)
  assert.equal(
    (
      await asUser(
        1,
        'select provider_id from public.reward_purchases where id=$1',
        [p],
      )
    )[0].provider_id,
    uid(2),
  )
  assert.equal((await progress(2)).coins, 0)
  await assertCoinAccounting(1)
})
test('purchase enforces own balance, insufficient funds and exact request idempotence', async () => {
  await pair()
  const id = await offer(1, { price: 7 })
  await assert.rejects(buy(2, id), /insufficient_coins/)
  assert.equal(
    (await pool.query('select * from public.reward_purchases')).rowCount,
    0,
  )
  await earn(2)
  const key = randomUUID()
  const ids = await Promise.all([
    buy(2, id, key),
    buy(2, id, key),
    buy(2, id, key),
  ])
  assert.equal(new Set(ids).size, 1)
  assert.equal((await progress(2)).coins, 3)
  const other = await offer(1)
  await assert.rejects(buy(2, other, key), /reward_request_conflict/)
  await assert.rejects(
    asUser(2, 'select public.buy_reward_offer($1,$2,$3,$4)', [
      id,
      randomUUID(),
      uid(1),
      0,
    ]),
    /does not exist/,
  )
  await assertCoinAccounting(2)
})
test('two different simultaneous purchases cannot overspend; earning and spending serialize', async () => {
  await pair()
  await earn(2)
  const id = await offer(1, { price: 7 })
  const other = await offer(1,{price:7})
  const results = await Promise.allSettled([buy(2, id), buy(2, other)])
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1)
  assert.equal((await progress(2)).coins, 3)
  const ti = await instance(await task(2))
  const race = await Promise.allSettled([complete(2, ti.id), buy(2, id)])
  assert.equal(race[0].status, 'fulfilled')
  assert.equal(
    (await progress(2)).coins,
    race[1].status === 'fulfilled' ? 6 : 13,
  )
  await assertCoinAccounting(2)
})
test('single-use offers sell once even in parallel or after refund; repeatable offers sell again', async () => {
  await pair()
  await earn(1, 2)
  await earn(2, 2)
  const id = await offer(1, { kind: 'joint', single: true })
  await consent(2, id)
  const race = await Promise.allSettled([buy(1, id), buy(2, id)])
  assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1)
  const winner = race[0].status === 'fulfilled' ? 1 : 2
  const purchase = race[winner - 1].value
  await purchaseAction(winner, purchase, 'cancel')
  await assert.rejects(buy(1, id), /reward_sold_out/)
  const repeat = await offer(1)
  assert.notEqual(await buy(2, repeat), await buy(2, repeat))
  await assertCoinAccounting(1)
  await assertCoinAccounting(2)
})
test('provider refusal and buyer cancellation refund exactly once and cannot confirm for buyer', async () => {
  await pair()
  await earn(2, 2)
  const id = await offer(1)
  const p = await buy(2, id)
  await assert.rejects(
    purchaseAction(1, p, 'confirm'),
    /reward_transition_denied/,
  )
  await assert.rejects(
    purchaseAction(2, p, 'ready'),
    /reward_transition_denied/,
  )
  await purchaseAction(1, p, 'ready')
  assert.equal(
    (
      await asUser(
        1,
        'select status from public.reward_purchases where id=$1',
        [p],
      )
    )[0].status,
    'ready',
  )
  await Promise.all([
    purchaseAction(1, p, 'refuse'),
    purchaseAction(2, p, 'cancel'),
    purchaseAction(1, p, 'refuse'),
  ])
  assert.equal((await progress(2)).coins, 20)
  const q = await buy(2, id)
  await purchaseAction(2, q, 'cancel')
  await purchaseAction(2, q, 'cancel')
  assert.equal((await progress(2)).coins, 20)
  assert.equal(
    (
      await pool.query(
        "select * from public.coin_transactions where kind='refund'",
      )
    ).rowCount,
    2,
  )
  await assertCoinAccounting(2)
})
test('only buyer confirms actual receipt after provider readiness; completed purchases cannot refund', async () => {
  await pair()
  await earn(2)
  const p = await buy(2, await offer(1))
  await assert.rejects(
    purchaseAction(2, p, 'confirm'),
    /reward_transition_denied/,
  )
  await purchaseAction(1, p, 'ready')
  await purchaseAction(2, p, 'confirm')
  await purchaseAction(2, p, 'confirm')
  await assert.rejects(
    purchaseAction(2, p, 'cancel'),
    /reward_transition_denied/,
  )
  await assert.rejects(
    purchaseAction(1, p, 'refuse'),
    /reward_transition_denied/,
  )
  assert.equal((await progress(2)).coins, 5)
  assert.equal((await progress(2)).xp, 20)
  await assertCoinAccounting(2)
})
test('unpublish/buy and confirm/cancel races have one consistent outcome', async () => {
  await pair()
  await earn(2)
  const id = await offer(1)
  const race = await Promise.allSettled([publish(1, id, false), buy(2, id)])
  if (race[1].status === 'fulfilled') {
    const p = race[1].value
    await purchaseAction(1, p, 'ready')
    const finish = await Promise.allSettled([
      purchaseAction(2, p, 'confirm'),
      purchaseAction(2, p, 'cancel'),
    ])
    assert.equal(finish.filter((x) => x.status === 'fulfilled').length, 1)
  } else assert.match(race[1].reason.message, /reward_unavailable/)
  await assert.rejects(buy(2, id), /reward_unavailable/)
  await assertCoinAccounting(2)
})
test('departure refunds pending/ready purchases, preserves completed history and prevents reactivation', async () => {
  await pair()
  await earn(1)
  await earn(2, 3)
  const id = await offer(1)
  const pending = await buy(2, id),
    ready = await buy(2, id),
    done = await buy(2, id)
  await purchaseAction(1, ready, 'ready')
  await purchaseAction(1, done, 'ready')
  await purchaseAction(2, done, 'confirm')
  const joint = await offer(1, { kind: 'joint' })
  await consent(2, joint)
  const own = await buy(1, joint)
  const exitRace = await Promise.allSettled([
    asUser(1, 'select public.leave_couple_space()'),
    purchaseAction(2, pending, 'cancel'),
  ])
  assert.equal(exitRace[0].status, 'fulfilled')
  const rows = (
    await pool.query('select id,status from public.reward_purchases')
  ).rows
  for (const p of [pending, ready, own])
    assert.equal(rows.find((x) => x.id === p).status, 'cancelled')
  assert.equal(rows.find((x) => x.id === done).status, 'completed')
  assert.equal((await progress(2)).coins, 25)
  assert.equal((await progress(1)).coins, 10)
  assert.equal(
    (await asUser(1, 'select * from public.reward_purchases')).length,
    0,
  )
  assert.equal(
    (await asUser(1, 'select * from public.reward_offers')).length,
    0,
  )
  await resolve(1, await invite(2, 1))
  await assert.rejects(publish(1, id, true), /reward_transition_denied/)
  await assert.rejects(buy(2, id), /reward_unavailable/)
  await assertCoinAccounting(1)
  await assertCoinAccounting(2)
})
test('purchases racing departure cannot escape a single refund and new partners cannot read history', async () => {
  await pair()
  await earn(2)
  const id = await offer(1)
  const race = await Promise.allSettled([
    buy(2, id),
    asUser(1, 'select public.leave_couple_space()'),
  ])
  assert.equal(race[1].status, 'fulfilled')
  if (race[0].status === 'fulfilled')
    assert.equal(
      (
        await pool.query(
          'select status from public.reward_purchases where id=$1',
          [race[0].value],
        )
      ).rows[0].status,
      'cancelled',
    )
  assert.equal((await progress(2)).coins, 10)
  await resolve(3, await invite(2, 3))
  for (const table of [
    'reward_offers',
    'reward_offer_consents',
    'reward_purchases',
    'coin_transactions',
  ])
    assert.equal((await asUser(3, `select * from public.${table}`)).length, 0)
  await assertCoinAccounting(2)
})
test('RLS isolates pairs and own coin history; direct writes and internal RPC are denied', async () => {
  await pair()
  await create(3)
  await earn(2)
  const id = await offer(1)
  await buy(2, id)
  for (const table of [
    'reward_offers',
    'reward_offer_consents',
    'reward_purchases',
    'coin_transactions',
  ]) {
    assert.equal((await asUser(3, `select * from public.${table}`)).length, 0)
    await assert.rejects(
      asUser(2, `delete from public.${table}`),
      (e) => e.code === '42501',
    )
    await assert.rejects(
      asUser(null, `select * from public.${table}`),
      (e) => e.code === '42501',
    )
  }
  assert.equal(
    (await asUser(1, 'select * from public.coin_transactions')).length,
    0,
  )
  await assert.rejects(buy(3, id), /reward_unavailable/)
  await assert.rejects(
    asUser(2, 'update public.user_progress set coins=9999'),
    (e) => e.code === '42501',
  )
  await assert.rejects(
    asUser(2, "update public.reward_offer_consents set consent='accepted'"),
    (e) => e.code === '42501',
  )
  for (const n of [null, 1, 2])
    await assert.rejects(
      asUser(n, 'select public.refund_reward_purchase(null)'),
      (e) => e.code === '42501',
    )
  await pool.query(
    await readFile('supabase/tests/store-privileges.sql', 'utf8'),
  )
})
test('commit-time purchase/refund failures roll back balance, journal and purchase status together', async () => {
  await pair()
  await earn(2)
  const id = await offer(1)
  await pool.query(
    `create function public.review_fail_coin() returns trigger language plpgsql as $$ begin raise exception 'review_failure'; end $$`,
  )
  try {
    await pool.query(
      "create constraint trigger review_fail after update on public.user_progress deferrable initially deferred for each row execute function public.review_fail_coin()",
    )
    await assert.rejects(buy(2, id), /review_failure/)
    assert.equal(
      (await pool.query('select * from public.reward_purchases')).rowCount,
      0,
    )
    assert.equal((await progress(2)).coins, 10)
    await pool.query('drop trigger review_fail on public.user_progress')
    const p = await buy(2, id)
    await pool.query(
      "create constraint trigger review_fail after update on public.user_progress deferrable initially deferred for each row execute function public.review_fail_coin()",
    )
    await assert.rejects(purchaseAction(2, p, 'cancel'), /review_failure/)
    assert.equal(
      (
        await pool.query(
          'select status from public.reward_purchases where id=$1',
          [p],
        )
      ).rows[0].status,
      'pending',
    )
    assert.equal((await progress(2)).coins, 5)
    await pool.query('drop trigger review_fail on public.user_progress')
    await purchaseAction(2, p, 'cancel')
    await assertCoinAccounting(2)
  } finally {
    await pool.query(
      'drop trigger if exists review_fail on public.user_progress',
    )
    await pool.query('drop function public.review_fail_coin()')
  }
})
test('earn/spend/refund leave XP and Together XP unchanged and reserve safe refund capacity', async () => {
  const space = await pair()
  const ti = await task(1, { kind: 'joint' })
  await respond(2, ti)
  const i = await instance(ti)
  await complete(1, i.id)
  await complete(2, i.id)
  const p = await buy(2, await offer(1))
  await assert.rejects(
    pool.query(
      'update public.user_progress set coins=9007199254740991 where user_id=$1',
      [uid(2)],
    ),
    /coin_capacity_exceeded/,
  )
  await purchaseAction(1, p, 'refuse')
  assert.deepEqual(await progress(1), { xp: 20, coins: 10 })
  assert.deepEqual(await progress(2), { xp: 20, coins: 10 })
  assert.equal(
    (
      await pool.query(
        'select together_xp::integer as xp from public.space_progress where space_id=$1',
        [space],
      )
    ).rows[0].xp,
    20,
  )
  await assertCoinAccounting(1)
  await assertCoinAccounting(2)
})

test('historical backfill refuses inconsistent balances without repairing or deleting data', async () => {
  await create(1)
  await earn(1)
  const source = await readFile(
    'supabase/migrations/20261019220000_rewards_store.sql',
    'utf8',
  )
  const start = source.indexOf('do $$ begin')
  const end = source.indexOf('end $$;', start) + 'end $$;'.length
  const guard = source.slice(start, end)
  await pool.query(guard)
  await pool.query(
    'update public.user_progress set coins=11 where user_id=$1',
    [uid(1)],
  )
  await assert.rejects(pool.query(guard), /coin_history_mismatch/)
  assert.equal((await progress(1)).coins, 11)
  assert.equal(
    (await pool.query('select * from public.reward_ledger')).rowCount,
    1,
  )
  assert.equal(
    (await pool.query('select * from public.coin_transactions')).rowCount,
    1,
  )
})

test('lost storage and two stale tabs with different UUIDs cannot silently charge twice, even after settlement', async () => {
  await pair()
  await earn(2, 3)
  const id = await offer(1)
  const raw = (key, count) =>
    asUser(2, 'select public.buy_reward_offer($1,$2,$3) as id', [
      id,
      key,
      count,
    ])
  const keys = [randomUUID(), randomUUID()]
  const race = await Promise.allSettled(keys.map((k) => raw(k, 0)))
  assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1)
  const win = race.findIndex((x) => x.status === 'fulfilled')
  const p = race[win].value[0].id
  assert.equal((await progress(2)).coins, 25)
  assert.match(race[1 - win].reason.message, /reward_purchase_changed/)
  assert.equal((await raw(keys[win], 0))[0].id, p)
  await purchaseAction(2, p, 'cancel')
  await assert.rejects(raw(randomUUID(), 0), /reward_purchase_changed/)
  assert.equal((await raw(keys[win], 0))[0].id, p)
  const next = (await raw(randomUUID(), 1))[0].id
  assert.notEqual(next, p)
  await assertCoinAccounting(2)
})
test('returning partner sees only their history; new partner cannot revive closed offers or cancelled purchases', async () => {
  await pair()
  await earn(2)
  const id = await offer(1, { kind: 'joint' })
  await consent(2, id)
  const p = await buy(2, id)
  await asUser(2, 'select public.leave_couple_space()')
  await resolve(2, await invite(1, 2))
  await assert.rejects(publish(1, id, true), /reward_transition_denied/)
  await assert.rejects(
    purchaseAction(1, p, 'ready'),
    /reward_transition_denied/,
  )
  await assert.rejects(
    purchaseAction(2, p, 'confirm'),
    /reward_transition_denied/,
  )
  assert.equal(
    (
      await asUser(
        2,
        'select status from public.reward_purchases where id=$1',
        [p],
      )
    )[0].status,
    'cancelled',
  )
  await asUser(2, 'select public.leave_couple_space()')
  await resolve(3, await invite(1, 3))
  for (const table of [
    'reward_offers',
    'reward_offer_consents',
    'reward_purchases',
  ])
    assert.equal((await asUser(3, `select * from public.${table}`)).length, 0)
  await assert.rejects(purchaseAction(3, p, 'ready'), /reward_unavailable/)
  await assert.rejects(consent(3, id), /reward_unavailable/)
  assert.equal((await progress(2)).coins, 10)
})
test('joint buyer/provider roles are symmetric for either purchaser and readiness never confirms receipt', async () => {
  await pair()
  await earn(1, 2)
  await earn(2, 2)
  for (const buyer of [1, 2]) {
    const provider = 3 - buyer
    const id = await offer(1, { kind: 'joint' })
    await consent(2, id)
    const p = await buy(buyer, id)
    await assert.rejects(
      purchaseAction(buyer, p, 'ready'),
      /reward_transition_denied/,
    )
    await purchaseAction(provider, p, 'ready')
    await assert.rejects(
      purchaseAction(provider, p, 'confirm'),
      /reward_transition_denied/,
    )
    assert.equal(
      (
        await pool.query(
          'select status from public.reward_purchases where id=$1',
          [p],
        )
      ).rows[0].status,
      'ready',
    )
    await purchaseAction(buyer, p, 'confirm')
    await assert.rejects(
      purchaseAction(provider, p, 'refuse'),
      /reward_transition_denied/,
    )
    const cancelled = await buy(buyer, id)
    await purchaseAction(provider, cancelled, 'refuse')
    await purchaseAction(buyer, cancelled, 'cancel')
    await assertCoinAccounting(buyer)
  }
  assert.deepEqual(await progress(1), { xp: 40, coins: 15 })
  assert.deepEqual(await progress(2), { xp: 40, coins: 15 })
})

// Stage 5 goals: all authorization, transitions and concurrency run on PostgreSQL.
const goal = async (n, options = {}) =>
  (
    await asUser(
      n,
      'select public.create_couple_goal($1,$2,$3,$4,$5,$6) as id',
      [
        options.request ?? randomUUID(),
        options.title ?? 'Вместе в Карпаты',
        options.description ?? '',
        options.category ?? 'travel',
        options.emoji ?? '🏔️',
        options.date ?? null,
      ],
    )
  )[0].id
const goalChange = async (n, id, kind, payload = {}, request = randomUUID()) =>
  (
    await asUser(n, 'select public.propose_goal_change($1,$2,$3,$4) as id', [
      id,
      request,
      kind,
      payload,
    ])
  )[0].id
const goalDecision = (n, id, decision = 'accept') =>
  asUser(n, 'select public.resolve_goal_consent($1,$2)', [id, decision])
const goalDone = (n, id) =>
  asUser(n, 'select public.complete_goal_step($1)', [id])
const goalPending = async (id) =>
  (
    await pool.query(
      "select id from public.goal_consents where goal_id=$1 and status='pending'",
      [id],
    )
  ).rows[0]?.id
async function activeGoal() {
  const id = await goal(1)
  await goalDecision(2, await goalPending(id))
  return id
}
async function addGoalStep(n, id, assignment = 'both', title = 'Выбрать даты') {
  const change = await goalChange(n, id, 'step_add', {
    title,
    description: '',
    assignment,
  })
  await goalDecision(3 - n, change)
  return (
    await pool.query(
      'select id from public.goal_steps where goal_id=$1 order by position desc limit 1',
      [id],
    )
  ).rows[0].id
}
async function goalProgress(n, id) {
  return (
    await asUser(n, 'select * from public.goal_progress where goal_id=$1', [id])
  )[0]
}
async function readyGoal() {
  const id = await activeGoal()
  const step = await addGoalStep(1, id)
  await goalDone(1, step)
  await goalDone(2, step)
  return id
}

test('goal creation validates fields, requires partner and creates one pending consent under retries', async () => {
  await create(1)
  await assert.rejects(goal(1), /partner_required/)
  await resolve(2, await invite(1, 2))
  for (const options of [
    { title: 'x' },
    { description: 'x'.repeat(1001) },
    { category: 'bad' },
    { emoji: 'bad' },
    { date: '2300-01-01' },
  ])
    await assert.rejects(goal(1, options), /invalid_goal/)
  const request = randomUUID()
  const ids = await Promise.all([goal(1, { request }), goal(1, { request })])
  assert.equal(ids[0], ids[1])
  assert.equal(
    (await pool.query('select * from public.goal_consents')).rowCount,
    1,
  )
  await assert.rejects(
    goal(1, { request, title: 'Другая цель' }),
    /goal_request_conflict/,
  )
  assert.deepEqual(await goalProgress(1, ids[0]), {
    goal_id: ids[0],
    total_steps: 0,
    completed_steps: 0,
    percent: 0,
  })
  await assert.rejects(goal(8), /verified_account_required/)
})
test('only other partner activates or declines; author may withdraw without penalties', async () => {
  await pair()
  const id = await goal(1),
    c = await goalPending(id)
  await assert.rejects(goalDecision(1, c), /goal_transition_denied/)
  await goalDecision(2, c)
  await goalDecision(2, c)
  assert.equal(
    (
      await asUser(1, 'select status from public.couple_goals where id=$1', [
        id,
      ])
    )[0].status,
    'active',
  )
  const declined = await goal(2)
  await goalDecision(1, await goalPending(declined), 'decline')
  const withdrawn = await goal(1)
  await goalDecision(1, await goalPending(withdrawn), 'withdraw')
  assert.equal(
    (
      await asUser(2, 'select status from public.couple_goals where id=$1', [
        withdrawn,
      ])
    )[0].status,
    'closed',
  )
  assert.deepEqual(await progress(1), { xp: 0, coins: 0 })
  assert.equal(
    (await pool.query('select * from public.goal_reward_ledger')).rowCount,
    0,
  )
})
test('only agreed steps count; assignment is consented and completion can mark only self', async () => {
  await pair()
  const id = await activeGoal()
  const c = await goalChange(1, id, 'step_add', {
    title: 'Собрать вещи',
    assignment: 'partner',
  })
  assert.equal((await goalProgress(1, id)).total_steps, 0)
  await assert.rejects(goalDecision(1, c), /goal_transition_denied/)
  await goalDecision(2, c)
  const single = (
    await pool.query('select id from public.goal_steps where goal_id=$1', [id])
  ).rows[0].id
  await assert.rejects(goalDone(1, single), /goal_transition_denied/)
  await goalDone(2, single)
  await goalDone(2, single)
  const joint = await addGoalStep(2, id, 'both', 'Найти жильё')
  assert.equal((await goalProgress(1, id)).percent, 50)
  await goalDone(1, joint)
  assert.equal((await goalProgress(1, id)).percent, 50)
  await goalDone(2, joint)
  assert.equal((await goalProgress(1, id)).percent, 100)
  await assert.rejects(
    asUser(1, 'select public.complete_goal_step($1,$2)', [joint, uid(2)]),
    /does not exist/,
  )
  assert.equal(
    (await pool.query('select * from public.goal_reward_ledger')).rowCount,
    0,
  )
  assert.deepEqual(await progress(1), { xp: 0, coins: 0 })
})
test('editing unstarted steps and ordering require consent; completed or partial steps cannot be rewritten', async () => {
  await pair()
  const id = await activeGoal(),
    a = await addGoalStep(1, id),
    b = await addGoalStep(2, id, 'me', 'Проложить маршрут')
  const edit = await goalChange(2, id, 'step_edit', {
    step_id: a,
    title: 'Новые даты',
    assignment: 'me',
  })
  await assert.rejects(goalDone(1, a), /goal_consent_pending/)
  await goalDecision(1, edit)
  assert.deepEqual(
    (
      await asUser(
        1,
        'select user_id from public.goal_step_participants where step_id=$1',
        [a],
      )
    ).map((x) => x.user_id),
    [uid(2)],
  )
  const reorder = await goalChange(1, id, 'reorder', { step_ids: [b, a] })
  await goalDecision(2, reorder)
  assert.deepEqual(
    (
      await asUser(
        1,
        'select id from public.goal_steps where goal_id=$1 order by position',
        [id],
      )
    ).map((x) => x.id),
    [b, a],
  )
  await assert.rejects(
    goalChange(1, id, 'reorder', { step_ids: [a, a] }),
    /invalid_goal_change/,
  )
  await goalDone(2, a)
  await assert.rejects(
    goalChange(1, id, 'step_edit', {
      step_id: a,
      title: 'Ещё раз',
      assignment: 'both',
    }),
    /goal_step_locked/,
  )
  const partial = await addGoalStep(1, id)
  await goalDone(1, partial)
  await assert.rejects(
    goalChange(2, id, 'step_edit', {
      step_id: partial,
      title: 'Повторить',
      assignment: 'both',
    }),
    /goal_step_locked/,
  )
})
test('goal proposal payload rejects foreign steps, malformed JSON, arbitrary actors and invalid content', async () => {
  await pair()
  const id = await activeGoal()
  await create(3)
  const foreign = randomUUID()
  for (const payload of [
    { title: 'ok', assignment: 'both', user_id: uid(3) },
    { title: { sql: 'bad' }, assignment: 'me' },
    { title: 'ok', assignment: 'stranger' },
    { title: 'ok', assignment: 'me', description: [] },
    { title: 'ok', assignment: 'me', step_id: foreign },
  ])
    await assert.rejects(
      goalChange(1, id, 'step_add', payload),
      /invalid_goal_change/,
    )
  await assert.rejects(
    goalChange(1, id, 'step_edit', {
      step_id: foreign,
      title: 'Правка',
      assignment: 'me',
    }),
    /goal_step_locked/,
  )
  await assert.rejects(
    goalChange(1, id, 'step_edit', {
      step_id: 'bad',
      title: 'Правка',
      assignment: 'me',
    }),
    /invalid_goal_change/,
  )
  await assert.rejects(
    goalChange(1, id, 'reorder', { step_ids: [foreign] }),
    /invalid_goal_change/,
  )
  await assert.rejects(goalChange(1,id,'step_edit',{step_id:123,title:'Правка',assignment:'me'}),/invalid_goal_change/)
  await assert.rejects(goalChange(1,id,'reorder',{step_ids:[123]}),/invalid_goal_change/)
  await assert.rejects(
    goalChange(1, id, 'complete', { xp: 999 }),
    /invalid_goal_change/,
  )
})
test('empty or unfinished goal cannot be completed; bilateral finish awards exactly 50 once', async () => {
  const space = await pair()
  const id = await activeGoal()
  await assert.rejects(goalChange(1, id, 'complete'), /goal_not_ready/)
  const step = await addGoalStep(1, id)
  await goalDone(1, step)
  await assert.rejects(goalChange(1, id, 'complete'), /goal_not_ready/)
  await goalDone(2, step)
  const c = await goalChange(2, id, 'complete')
  assert.equal(
    (await pool.query('select * from public.goal_reward_ledger')).rowCount,
    0,
  )
  await assert.rejects(goalDecision(2, c), /goal_transition_denied/)
  await Promise.all([
    goalDecision(1, c),
    goalDecision(1, c),
    goalDecision(1, c),
  ])
  assert.equal(
    (await pool.query('select * from public.goal_reward_ledger')).rowCount,
    1,
  )
  assert.equal(
    (
      await pool.query(
        'select together_xp::integer as xp from public.space_progress where space_id=$1',
        [space],
      )
    ).rows[0].xp,
    50,
  )
  for (const kind of ['step_add', 'pause', 'resume', 'close', 'complete'])
    await assert.rejects(goalChange(1, id, kind), /goal_transition_denied/)
  await goalDone(1, step)
  assert.equal(
    (await pool.query('select * from public.coin_transactions')).rowCount,
    0,
  )
  assert.deepEqual(await progress(1), { xp: 0, coins: 0 })
  assert.deepEqual(await progress(2), { xp: 0, coins: 0 })
})
test('pause/resume/close are equal bilateral decisions with withdrawals and no reward', async () => {
  await pair()
  const id = await activeGoal(),
    step = await addGoalStep(1, id)
  let c = await goalChange(2, id, 'pause')
  await goalDecision(1, c)
  await assert.rejects(goalDone(1, step), /goal_transition_denied/)
  c = await goalChange(1, id, 'resume')
  await goalDecision(2, c, 'decline')
  assert.equal(
    (
      await asUser(1, 'select status from public.couple_goals where id=$1', [
        id,
      ])
    )[0].status,
    'paused',
  )
  c = await goalChange(2, id, 'resume')
  await goalDecision(1, c)
  c = await goalChange(1, id, 'close')
  await goalDecision(1, c, 'withdraw')
  c = await goalChange(2, id, 'close')
  await goalDecision(1, c)
  await assert.rejects(goalChange(1, id, 'resume'), /goal_transition_denied/)
  assert.equal(
    (await pool.query('select * from public.goal_reward_ledger')).rowCount,
    0,
  )
})
test('concurrent proposals and decisions are serialized; request replay cannot duplicate steps or rewards', async () => {
  await pair()
  const id = await activeGoal()
  const key = randomUUID(),
    payload = { title: 'Вместе гулять', assignment: 'both' }
  const ids = await Promise.all([
    goalChange(1, id, 'step_add', payload, key),
    goalChange(1, id, 'step_add', payload, key),
  ])
  assert.equal(ids[0], ids[1])
  await assert.rejects(goalChange(1, id, 'pause'), /goal_consent_pending/)
  await assert.rejects(
    goalChange(1, id, 'step_add', { ...payload, title: 'Другое' }, key),
    /goal_request_conflict/,
  )
  const decision = await Promise.allSettled([
    goalDecision(2, ids[0]),
    goalDecision(2, ids[0], 'decline'),
  ])
  assert.equal(decision.filter((x) => x.status === 'fulfilled').length, 1)
  const steps = (await pool.query('select * from public.goal_steps')).rows
  assert.ok(steps.length <= 1)
  if (steps.length) {
    await Promise.all([
      goalDone(1, steps[0].id),
      goalDone(2, steps[0].id),
      goalDone(1, steps[0].id),
    ])
    assert.equal((await goalProgress(1, id)).percent, 100)
  }
})
test('departure voids pending consents, keeps earned XP and cannot be reversed by rejoining or a new partner', async () => {
  const space = await pair(),
    done = await readyGoal()
  await goalDecision(2, await goalChange(1, done, 'complete'))
  const pending = await goal(1),
    active = await activeGoal()
  const c = await goalChange(2, active, 'step_add', {
    title: 'Начать',
    assignment: 'me',
  })
  await asUser(2, 'select public.leave_couple_space()')
  assert.equal((await asUser(2, 'select * from public.couple_goals')).length, 0)
  assert.equal(
    (
      await pool.query('select status from public.goal_consents where id=$1', [
        c,
      ])
    ).rows[0].status,
    'void',
  )
  await resolve(2, await invite(1, 2))
  for (const id of [pending, active])
    await assert.rejects(goalChange(1, id, 'resume'), /goal_transition_denied/)
  await assert.rejects(goalDecision(1, c), /goal_transition_denied/)
  await asUser(2, 'select public.leave_couple_space()')
  await resolve(3, await invite(1, 3))
  for (const table of [
    'couple_goals',
    'goal_consents',
    'goal_steps',
    'goal_step_participants',
    'goal_step_completions',
    'goal_events',
    'goal_reward_ledger',
    'goal_progress',
  ])
    assert.equal((await asUser(3, `select * from public.${table}`)).length, 0)
  await assert.rejects(goalChange(3, active, 'resume'), /goal_unavailable/)
  assert.equal(
    (
      await asUser(
        3,
        'select together_xp::integer as xp from public.space_progress where space_id=$1',
        [space],
      )
    )[0].xp,
    50,
  )
})
test('RLS, exact grants and UUID checks isolate goals from other spaces and anonymous clients', async () => {
  await pair()
  const id = await readyGoal()
  await create(3)
  for (const table of [
    'couple_goals',
    'goal_consents',
    'goal_steps',
    'goal_step_participants',
    'goal_step_completions',
    'goal_events',
    'goal_reward_ledger',
    'goal_progress',
  ]) {
    assert.equal((await asUser(3, `select * from public.${table}`)).length, 0)
    await assert.rejects(
      asUser(null, `select * from public.${table}`),
      (e) => e.code === '42501',
    )
    await assert.rejects(
      asUser(1, `delete from public.${table}`),
      (e) => e.code === (table === 'goal_progress' ? '55000' : '42501'),
    )
  }
  await assert.rejects(goalChange(3, id, 'complete'), /goal_unavailable/)
  await assert.rejects(
    asUser(1, 'select public.lock_couple_goal($1)', [id]),
    (e) => e.code === '42501',
  )
  await pool.query(await readFile('supabase/tests/goal-privileges.sql', 'utf8'))
})
test('goal award and task Together XP serialize without touching Coins; late errors roll back all goal changes', async () => {
  const space = await pair(),
    id = await readyGoal()
  const c = await goalChange(1, id, 'complete')
  await pool.query(
    'insert into public.space_progress values($1,9007199254740991)',
    [space],
  )
  await assert.rejects(goalDecision(2, c), /check constraint/)
  assert.equal(
    (await pool.query('select * from public.goal_reward_ledger')).rowCount,
    0,
  )
  assert.equal(
    (
      await pool.query('select status from public.goal_consents where id=$1', [
        c,
      ])
    ).rows[0].status,
    'pending',
  )
  await pool.query(
    'update public.space_progress set together_xp=0 where space_id=$1',
    [space],
  )
  const taskId = await task(1, { kind: 'joint' })
  await respond(2, taskId)
  const i = await instance(taskId)
  await complete(1, i.id)
  await Promise.all([goalDecision(2, c), complete(2, i.id), goalDecision(2, c)])
  assert.equal(
    (
      await pool.query(
        'select together_xp::integer as xp from public.space_progress where space_id=$1',
        [space],
      )
    ).rows[0].xp,
    70,
  )
  assert.deepEqual(await progress(1), { xp: 20, coins: 10 })
  assert.deepEqual(await progress(2), { xp: 20, coins: 10 })
  await assertCoinAccounting(1)
  await assertCoinAccounting(2)
})
test('goal finish versus leave either commits once before exit or closes without bonus', async () => {
  const space = await pair(),
    id = await readyGoal(),
    c = await goalChange(1, id, 'complete')
  const race = await Promise.allSettled([
    goalDecision(2, c),
    asUser(1, 'select public.leave_couple_space()'),
  ])
  assert.equal(race[1].status, 'fulfilled')
  const rows = (await pool.query('select * from public.goal_reward_ledger'))
    .rows
  assert.equal(rows.length, race[0].status === 'fulfilled' ? 1 : 0)
  const total =
    (
      await pool.query(
        'select together_xp::integer as xp from public.space_progress where space_id=$1',
        [space],
      )
    ).rows[0]?.xp ?? 0
  assert.equal(total, rows.length * 50)
})
test('COMMIT-time goal failure rolls back achievement, consent, events, ledger and shared progress together', async () => {
  await pair()
  const id = await readyGoal(),
    c = await goalChange(1, id, 'complete')
  const before = (
    await pool.query('select count(*)::integer as n from public.goal_events')
  ).rows[0].n
  await pool.query(
    "create function public.review_goal_fail() returns trigger language plpgsql as $$ begin raise exception 'review_goal_failure'; end $$",
  )
  try {
    await pool.query(
      'create constraint trigger review_goal_fail after insert on public.goal_reward_ledger deferrable initially deferred for each row execute function public.review_goal_fail()',
    )
    await assert.rejects(goalDecision(2, c), /review_goal_failure/)
    assert.equal(
      (
        await pool.query('select status from public.couple_goals where id=$1', [
          id,
        ])
      ).rows[0].status,
      'active',
    )
    assert.equal(
      (
        await pool.query(
          'select status from public.goal_consents where id=$1',
          [c],
        )
      ).rows[0].status,
      'pending',
    )
    assert.equal(
      (
        await pool.query(
          'select count(*)::integer as n from public.goal_events',
        )
      ).rows[0].n,
      before,
    )
    assert.equal(
      (await pool.query('select * from public.goal_reward_ledger')).rowCount,
      0,
    )
    assert.equal(
      (await pool.query('select * from public.space_progress')).rowCount,
      0,
    )
    await pool.query(
      'drop trigger review_goal_fail on public.goal_reward_ledger',
    )
    await Promise.all([goalDecision(2, c), goalDecision(2, c)])
    assert.equal(
      (await pool.query('select * from public.goal_reward_ledger')).rowCount,
      1,
    )
  } finally {
    await pool.query(
      'drop trigger if exists review_goal_fail on public.goal_reward_ledger',
    )
    await pool.query('drop function public.review_goal_fail()')
  }
})
test('administrative cleanup of own disposable Auth fixture does not leave dangling goal marks', async () => {
  await pair()
  const id = await readyGoal()
  await goalDecision(2, await goalChange(1, id, 'complete'))
  await pool.query('delete from auth.users where id=$1', [uid(1)])
  for (const table of [
    'couple_goals',
    'goal_steps',
    'goal_step_participants',
    'goal_step_completions',
    'goal_reward_ledger',
  ])
    assert.equal(
      (await pool.query(`select * from public.${table}`)).rowCount,
      0,
    )
})
