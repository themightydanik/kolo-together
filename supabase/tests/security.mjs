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
    if (name === '20261021120000_couple_rituals.sql') {
      assert.deepEqual(await progress(90),{xp:20,coins:10},'ritual migration preserves existing historical progress')
      assert.equal((await statistics(90)).personal.tasks,1)
    }
    if (name === '20261020120000_achievements_statistics.sql') {
      const historical = (await asUser(90,'select public.get_statistics() as data'))[0].data
      assert.equal(historical.personal.tasks,1,'pre-migration completions count without reward backfill')
      assert.equal(historical.personal.xp,20)
      assert.equal(historical.badges.find(b=>b.code==='personal_1').progress,1)
      assert.ok(historical.badges.find(b=>b.code==='personal_1').unlocked_at)
      assert.deepEqual((await asUser(90,'select public.acknowledge_statistics() as codes'))[0].codes,[])
      assert.deepEqual(await progress(90),{xp:20,coins:10})
    }
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
const goal = async(n,options={})=> {
 const expected=(await asUser(n,'select count(*)::integer as n from public.couple_goals where creator_id=$1',[uid(n)]))[0].n
 return (await asUser(n,'select public.create_couple_goal($1,$2,$3,$4,$5,$6,$7) as id',[
 options.request??randomUUID(),options.title??'Вместе в Карпаты',options.description??'',options.category??'travel',options.emoji??'🏔️',options.date??null,expected]))[0].id
}
const goalChange = async(n,id,kind,payload={},request=randomUUID())=> {
 const expected=(await asUser(n,'select count(*)::integer as n from public.goal_consents where goal_id=$1 and requester_id=$2',[id,uid(n)]))[0].n
 return (await asUser(n,'select public.propose_goal_change($1,$2,$3,$4,$5) as id',[id,request,kind,payload,expected]))[0].id
}
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

test('review: different UUIDs from stale create snapshots cannot create unnoticed duplicate goals',async()=>{
 await pair()
 const raw=()=>asUser(1,"select public.create_couple_goal($1,'Повтор мечты','','travel','🏔️',null) as id",[randomUUID()])
 const results=await Promise.allSettled([raw(),raw()])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.equal((await pool.query('select * from public.couple_goals')).rowCount,1)
})
test('review: resolved consent does not let an old snapshot submit the same change with a replacement UUID',async()=>{
 await pair();const id=await activeGoal()
 const raw=()=>asUser(2,'select public.propose_goal_change($1,$2,$3,$4) as id',[id,randomUUID(),'step_add',{title:'Один шаг',assignment:'both'}])
 const first=(await raw())[0].id;await goalDecision(1,first)
 await assert.rejects(raw(),/goal_history_changed/)
 assert.equal((await pool.query('select * from public.goal_steps')).rowCount,1)
})
test('review: journal grants prevent all client writes; immutable guard blocks direct rewrites while task +20 works',async()=>{
 const space=await pair(),id=await readyGoal();await goalDecision(2,await goalChange(1,id,'complete'))
 for(const n of [1,2,3,null])for(const sql of [
  'update public.goal_reward_ledger set together_xp=50',
  'delete from public.goal_reward_ledger',
  'truncate public.goal_reward_ledger',
  "insert into public.goal_reward_ledger(goal_id,space_id) values($1,$2)",
 ])await assert.rejects(asUser(n,sql,sql.includes('$1')?[id,space]:[]),e=>e.code==='42501')
 await assert.rejects(pool.query('update public.goal_reward_ledger set together_xp=50'),/goal_reward_immutable/)
 await assert.rejects(pool.query('delete from public.goal_reward_ledger'),/goal_reward_immutable/)
 const taskId=await task(1,{kind:'joint'});await respond(2,taskId);const i=await instance(taskId)
 await complete(1,i.id);await complete(2,i.id)
 assert.equal((await pool.query(await readFile('supabase/tests/together-xp-audit.sql','utf8'))).rowCount,0)
 assert.equal((await pool.query('select together_xp::integer as xp from public.space_progress where space_id=$1',[space])).rows[0].xp,70)
})
test('review: completion, task award and leave race preserve both journals and shared XP',async()=>{
 for(let attempt=0;attempt<5;attempt++){
  if(attempt>0)await resolve(1,await invite(2,1))
  else await pair()
  const id=await readyGoal(),c=await goalChange(1,id,'complete')
  const taskId=await task(1,{kind:'joint'});await respond(2,taskId);const i=await instance(taskId);await complete(1,i.id)
  const race=await Promise.allSettled([goalDecision(2,c),goalDecision(2,c),complete(2,i.id),asUser(1,'select public.leave_couple_space()')])
  assert.equal(race[3].status,'fulfilled')
  assert.equal((await pool.query(await readFile('supabase/tests/together-xp-audit.sql','utf8'))).rowCount,0)
  assert.equal((await pool.query('select * from public.goal_reward_ledger where goal_id=$1',[id])).rowCount,race[0].status==='fulfilled'||race[1].status==='fulfilled'?1:0)
 }
})
test('review: 100-step boundary, full reorder and same-key replay after terminal states',async()=>{
 await pair();const id=await activeGoal();let firstKey,firstPayload,firstConsent
 for(let n=0;n<100;n++){
  const key=randomUUID(),payload={title:`Шаг ${n+1}`,assignment:'both'}
  const c=await goalChange(1,id,'step_add',payload,key);await goalDecision(2,c)
  if(n===0){firstKey=key;firstPayload=payload;firstConsent=c}
 }
 assert.equal((await goalProgress(1,id)).total_steps,100)
 await assert.rejects(goalChange(1,id,'step_add',{title:'Лишний шаг',assignment:'me'}),/invalid_goal_change/)
 const steps=(await pool.query('select id from public.goal_steps where goal_id=$1 order by position',[id])).rows
 const order=await goalChange(2,id,'reorder',{step_ids:steps.map(s=>s.id).reverse()});await goalDecision(1,order)
 assert.equal((await goalProgress(1,id)).percent,0)
 const close=await goalChange(1,id,'close');await goalDecision(2,close)
 assert.equal(await goalChange(1,id,'step_add',firstPayload,firstKey),firstConsent)
 await goalDecision(2,firstConsent)
 assert.equal((await pool.query('select * from public.goal_steps where goal_id=$1',[id])).rowCount,100)
})
test('review: read-only XP audit reports legacy drift without rewriting earned history',async()=>{
 const space=await pair();await pool.query('insert into public.space_progress values($1,123)',[space])
 const id=await readyGoal();await goalDecision(2,await goalChange(1,id,'complete'))
 assert.equal((await pool.query('select together_xp::integer as n from public.space_progress where space_id=$1',[space])).rows[0].n,173)
 const result=await pool.query(await readFile('supabase/tests/together-xp-audit.sql','utf8'))
 assert.equal(result.rowCount,1);assert.equal(Number(result.rows[0].difference),123)
})
test('review: same-key replay after completion is read only, and inspection never creates a missing request',async()=>{
 await pair();const createKey=randomUUID(),id=await goal(1,{request:createKey})
 await goalDecision(2,await goalPending(id));const step=await addGoalStep(1,id)
 await goalDone(1,step);await goalDone(2,step)
 const key=randomUUID(),c=await goalChange(1,id,'complete',{},key);await goalDecision(2,c)
 const events=(await pool.query('select * from public.goal_events')).rowCount
 assert.equal(await goal(1,{request:createKey}),id)
 assert.equal(await goalChange(1,id,'complete',{},key),c)
 await goalDecision(2,c)
 assert.equal((await asUser(1,'select public.inspect_goal_request($1,$2) as result',[key,id]))[0].result.status,'accepted')
 assert.equal((await asUser(1,'select public.inspect_goal_request($1,null) as result',[createKey]))[0].result.status,'completed')
 assert.equal((await asUser(1,'select public.inspect_goal_request($1,$2) as result',[randomUUID(),id]))[0].result,null)
 assert.equal((await asUser(2,'select public.inspect_goal_request($1,$2) as result',[key,id]))[0].result,null)
 assert.equal((await pool.query('select * from public.goal_events')).rowCount,events)
 assert.equal((await pool.query('select * from public.goal_reward_ledger')).rowCount,1)
})

// Stage 6: read-only derived facts, UTC, pagination and acknowledgements.
const statistics = async (n) =>
  (await asUser(n, 'select public.get_statistics() as data'))[0].data
const history = async (n, cursor = null, limit = 20) =>
  (
    await asUser(n, 'select public.get_joint_history($1,$2) as data', [
      cursor,
      limit,
    ])
  )[0].data
const acknowledge = async (n) =>
  (await asUser(n, 'select public.acknowledge_statistics() as codes'))[0].codes
const badge = (data, code) => data.badges.find((b) => b.code === code)
async function jointFact() {
  const id = await task(1, { kind: 'joint' })
  await respond(2, id)
  const i = await instance(id)
  await Promise.all([complete(1, i.id), complete(2, i.id)])
  return id
}
test('statistics exact personal/joint/goal/space thresholds, repeated reads never earn or duplicate', async () => {
  await pair()
  let data = await statistics(1)
  assert.equal(data.badges.length, 13)
  assert.equal(data.personal.tasks, 0)
  assert.equal(data.shared.tasks, 0)
  assert.equal(data.calendar.length, 30)
  assert.equal((await history(1)).items.length, 0)
  assert.deepEqual(await acknowledge(1), [])
  for (let i = 1; i <= 25; i++) {
    await complete(1, (await instance(await task(1))).id)
    data = await statistics(1)
    for (const threshold of [1, 10, 25])
      assert.equal(
        badge(data, `personal_${threshold}`).progress >= threshold,
        i >= threshold,
      )
  }
  assert.deepEqual((await acknowledge(1)).sort(), [
    'personal_1',
    'personal_10',
    'personal_25',
  ])
  for (let i = 1; i <= 25; i++) {
    await jointFact()
    data = await statistics(1)
    for (const threshold of [1, 5, 10, 25])
      assert.equal(
        badge(data, `joint_${threshold}`).progress >= threshold,
        i >= threshold,
      )
    for (const threshold of [20, 100, 500])
      assert.equal(
        badge(data, `together_${threshold}`).progress >= threshold,
        i * 20 >= threshold,
      )
  }
  for (let i = 1; i <= 10; i++) {
    const id = await readyGoal()
    await goalDecision(2, await goalChange(1, id, 'complete'))
    data = await statistics(1)
    for (const threshold of [1, 3, 10])
      assert.equal(
        badge(data, `goal_${threshold}`).progress >= threshold,
        i >= threshold,
      )
  }
  assert.equal(data.shared.tasks, 25)
  assert.equal(data.shared.goals, 10)
  assert.equal(data.shared.together_xp, 1000)
  assert.equal(data.shared.achievements, 10)
  assert.equal(data.personal.tasks, 50)
  assert.equal(badge(data, 'together_20').unlocked_at, null)
  const before = await progress(1)
  const results = await Promise.all(
    Array.from({ length: 4 }, () => statistics(1)),
  )
  assert.ok(results.every((r) => r.shared.together_xp === 1000))
  assert.deepEqual(await progress(1), before)
  const notices = await Promise.all([acknowledge(1), acknowledge(1)])
  assert.equal(notices.flat().length, 10)
  assert.equal(new Set(notices.flat()).size, 10)
  assert.deepEqual(await acknowledge(1), [])
})
test('statistics personal privacy survives hidden/old tasks; new partner sees only historical space total', async () => {
  const space = await pair()
  await earn(1, 2)
  await earn(2, 1)
  await jointFact()
  const id = await readyGoal()
  await goalDecision(2, await goalChange(1, id, 'complete'))
  assert.equal((await statistics(1)).personal.tasks, 3)
  assert.equal((await statistics(2)).personal.tasks, 2)
  assert.equal((await statistics(3)).personal.tasks, 0)
  const oldPage = await history(1, null, 1)
  assert.ok(oldPage.next_cursor)
  await asUser(2, 'select public.leave_couple_space()')
  assert.equal((await statistics(1)).shared.tasks, 0)
  assert.equal((await statistics(2)).personal.tasks, 2)
  assert.equal((await history(2)).items.length, 0)
  await assert.rejects(
    history(1, oldPage.next_cursor),
    /invalid_statistics_cursor/,
  )
  await resolve(3, await invite(1, 3))
  const fresh = await statistics(3)
  assert.equal(fresh.shared.together_xp, 70)
  assert.equal(fresh.shared.tasks, 0)
  assert.equal(fresh.shared.goals, 0)
  assert.equal(fresh.shared.xp_series_complete, false)
  assert.equal((await history(3)).items.length, 0)
  assert.equal(badge(fresh, 'together_20').progress, 70)
  assert.equal(badge(fresh, 'together_20').unlocked_at, null)
  assert.deepEqual(await acknowledge(3), [])
  await assert.rejects(
    history(3, oldPage.next_cursor),
    /invalid_statistics_cursor/,
  )
  await asUser(3, 'select public.leave_couple_space()')
  await resolve(2, await invite(1, 2))
  assert.equal((await statistics(2)).shared.tasks, 1)
  assert.equal((await statistics(2)).shared.goals, 1)
  await assert.rejects(
    history(1, oldPage.next_cursor),
    /invalid_statistics_cursor/,
  )
  assert.equal((await statistics(1)).shared.together_xp, 70)
  assert.equal(
    (
      await pool.query(
        'select together_xp from public.space_progress where space_id=$1',
        [space],
      )
    ).rows[0].together_xp,
    '70',
  )
})
test('statistics reward history includes confirmed receipt only; refund never changes achievements or inflates Coins', async () => {
  await pair()
  await earn(2, 3)
  const id = await offer(1, { single: false, price: 5 })
  const p = await buy(2, id)
  await purchaseAction(1, p, 'ready')
  assert.equal(
    (await history(2)).items.filter((x) => x.kind === 'reward').length,
    0,
  )
  await purchaseAction(2, p, 'cancel')
  assert.equal((await statistics(2)).personal.coins, 30)
  const q = await buy(2, id)
  await purchaseAction(1, q, 'ready')
  await purchaseAction(2, q, 'confirm')
  await purchaseAction(2, q, 'confirm')
  const events = (await history(2)).items.filter((x) => x.kind === 'reward')
  assert.equal(events.length, 1)
  assert.equal(events[0].object_id, q)
  const data = await statistics(2)
  assert.equal(data.personal.coins, 25)
  assert.equal(data.personal.tasks, 3)
  assert.equal(data.shared.tasks, 0)
  assert.equal(data.shared.goals, 0)
  await asUser(2, 'select public.leave_couple_space()')
  await resolve(3, await invite(1, 3))
  assert.equal(
    (await history(1)).items.filter((x) => x.kind === 'reward').length,
    0,
  )
  assert.equal((await history(3)).items.length, 0)
})
test('statistics keyset orders equal timestamps, bounded pages have no overlap, rejects bad/actor/epoch cursors', async () => {
  await pair()
  for (let i = 0; i < 12; i++) await jointFact()
  // Disposable test fixture only: force tie timestamps to exercise the second sort key.
  await pool.query(
    "update public.reward_ledger set created_at=date_trunc('day',now()) where kind='together'",
  )
  const seen = [],
    pages = []
  let cursor = null
  do {
    const p = await history(1, cursor, 3)
    pages.push(p)
    seen.push(...p.items)
    cursor = p.next_cursor
  } while (cursor)
  assert.equal(seen.length, 15)
  assert.equal(new Set(seen.map((x) => x.key)).size, 15)
  const replay = await history(1, pages[0].next_cursor, 3)
  assert.deepEqual(replay.items, pages[1].items)
  for (const c of [
    {},
    [],
    { ...pages[0].next_cursor, at: 'bad' },
    { ...pages[0].next_cursor, until: 'infinity' },
    { ...pages[0].next_cursor, extra: true },
  ])
    await assert.rejects(history(1, c), /invalid_statistics_cursor/)
  await assert.rejects(
    history(2, pages[0].next_cursor),
    /invalid_statistics_cursor/,
  )
  for (const limit of [0, 51, null])
    await assert.rejects(history(1, null, limit), /invalid_statistics_cursor/)
  await jointFact()
  const continued = await history(1, pages[0].next_cursor, 50)
  assert.ok(
    continued.items.every((x) => !pages[0].items.some((y) => y.key === x.key)),
  )
  await assert.rejects(history(null), /permission denied/)
})
test('statistics UTC midnight calendar, 7/30 windows, current/best streak and gaps preserve balances', async () => {
  await create(1)
  const offsets = [0, 1, 2, 4, 5, 6, 7, 29, 30]
  for (const offset of offsets) {
    const t = await task(1)
    await complete(1, (await instance(t)).id)
    await pool.query(
      "update public.reward_ledger set created_at=(now() at time zone 'UTC')::date::timestamp at time zone 'UTC' - $2*interval '1 day' where task_id=$1",
      [t, offset],
    )
  }
  const before = await progress(1),
    data = await statistics(1)
  assert.equal(data.streak.current, 3)
  assert.equal(data.streak.best, 4)
  assert.equal(data.activity.days7, 6)
  assert.equal(data.activity.days30, 8)
  assert.equal(data.calendar.length, 30)
  assert.equal(data.calendar.at(-1).actions, 1)
  // Move today's fact to yesterday 23:59:59 UTC: yesterday streak remains current.
  await pool.query(
    "update public.reward_ledger set created_at=created_at-interval '1 second' where created_at=(now() at time zone 'UTC')::date::timestamp at time zone 'UTC'",
  )
  const yesterday = await statistics(1)
  assert.equal(yesterday.calendar.at(-1).actions, 0)
  assert.equal(yesterday.calendar.at(-2).actions, 2)
  assert.equal(yesterday.streak.current, 2)
  assert.deepEqual(await progress(1), before)
  await pool.query(
    "update public.reward_ledger set created_at=created_at-interval '40 days'",
  )
  const gap = await statistics(1)
  assert.equal(gap.streak.current, 0)
  assert.equal(gap.activity.days30, 0)
  assert.deepEqual(await progress(1), before)
})
test('statistics helper grants, caller verification, RLS and no client-controlled achievement writes', async () => {
  await pool.query(
    await readFile('supabase/tests/statistics-privileges.sql', 'utf8'),
  )
  for (const fn of ['statistics_badges()', 'statistics_context()'])
    await assert.rejects(asUser(1, `select public.${fn}`), /permission denied/)
  await assert.rejects(
    asUser(1, 'select * from public.statistics_joint_facts'),
    /permission denied/,
  )
  await assert.rejects(statistics(8), /verified_account_required/)
  for (const sql of [
    "insert into public.statistics_seen values(auth.uid(),'forged','{}',now())",
    "update public.statistics_seen set codes='{}'",
    'delete from public.statistics_seen',
    'truncate public.statistics_seen',
  ])
    await assert.rejects(asUser(1, sql), /permission denied/)
  await acknowledge(1)
  await acknowledge(2)
  assert.equal(
    (await asUser(1, 'select * from public.statistics_seen')).length,
    1,
  )
  assert.equal((await statistics(1)).personal.tasks, 0)
  await create(1)
  await earn(1)
  const concurrent = await Promise.all([
    acknowledge(1),
    acknowledge(1),
    acknowledge(1),
  ])
  assert.deepEqual(concurrent.flat(), ['personal_1'])
})
test('statistics growing history uses indexed bounded source pages and an aggregate snapshot', async (t) => {
  const space = await pair(),
    id = await task(1, { kind: 'joint', recurrence: 'daily' })
  await respond(2, id)
  // Owner-created, disposable historical fixture; never run on external accounts.
  await pool.query(
    `insert into public.task_instances(task_id,period_start,status,xp,coins,together_xp,completed_at,created_at)
 select $1,(now() at time zone 'UTC')::date-i,'completed',20,10,20,now()-i*interval '1 day',now()-i*interval '1 day' from generate_series(1,3000) i`,
    [id],
  )
  await pool.query(
    `insert into public.task_completions(instance_id,user_id,completed_at)
 select i.id,u,i.completed_at from public.task_instances i cross join unnest($2::uuid[]) u where task_id=$1 and status='completed'`,
    [id, [uid(1), uid(2)]],
  )
  await pool.query(
    `insert into public.reward_ledger(task_id,instance_id,completion_id,user_id,space_id,kind,title,xp,coins,together_xp,created_at)
 select $1,i.id,c.id,c.user_id,$2,'personal','Старая забота',20,10,0,c.completed_at
 from public.task_instances i join public.task_completions c on c.instance_id=i.id where i.task_id=$1`,
    [id, space],
  )
  await pool.query(
    `insert into public.reward_ledger(task_id,instance_id,space_id,kind,title,xp,coins,together_xp,created_at)
 select $1,id,$2,'together','Старая забота',0,0,20,completed_at from public.task_instances where task_id=$1 and status='completed'`,
    [id, space],
  )
  await pool.query('insert into public.space_progress values($1,60000)', [
    space,
  ])
  await pool.query(
    'insert into public.user_progress select u,60000,30000 from unnest($1::uuid[]) u',
    [[uid(1), uid(2)]],
  )
  await pool.query(
    'analyze public.reward_ledger; analyze public.task_instances; analyze public.task_participants',
  )
  const c = await pool.connect()
  let plan
  try {
    await c.query('begin')
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
      uid(1),
    ])
    plan = (
      await c.query(
        `explain(analyze,buffers,format json) select * from public.statistics_joint_facts where kind='task' and at<now()-interval '2900 days' order by at desc,key desc limit 21`,
      )
    ).rows[0]['QUERY PLAN'][0]
    await c.query('rollback')
  } finally {
    c.release()
  }
  const text = JSON.stringify(plan)
  assert.match(text, /statistics_joint_facts_idx/)
  assert.equal(plan.Plan['Actual Rows'], 21)
  const start = performance.now(),
    snap = await statistics(1),
    duration = performance.now() - start
  assert.equal(snap.shared.tasks, 3000)
  assert.equal(snap.personal.tasks, 3000)
  assert.equal(snap.shared.together_xp, 60000)
  assert.equal((await history(1)).items.length, 20)
  t.diagnostic(
    `3000 joint instances / 9000 ledger rows: source page ${plan['Execution Time']} ms; full snapshot ${duration.toFixed(1)} ms`,
  )
})
test('live keyset excludes already seen achievement codes after a late backdated COMMIT', async () => {
  await pair()
  const pending = await task(1, { kind: 'joint' })
  await respond(2, pending)
  const i = await instance(pending)
  await complete(1, i.id)
  const late = await pool.connect()
  try {
    await late.query('begin')
    await late.query('set local role authenticated')
    await late.query("select set_config('request.jwt.claim.sub',$1,true)", [
      uid(2),
    ])
    // Assign an xid before page one; do not take the shared business lock yet.
    await late.query('select pg_current_xact_id()')
    for (let n = 0; n < 5; n++) await jointFact()
    const first = await history(1, null, 2)
    assert.ok(first.items.some((x) => x.key === 'achievement:joint_5'))
    await late.query('select public.complete_task_instance($1)', [i.id])
    await late.query('commit')
    const all = [...first.items]
    let cursor = first.next_cursor
    while (cursor) {
      const p = await history(1, cursor, 2)
      all.push(...p.items)
      cursor = p.next_cursor
    }
    assert.equal(all.length, 8)
    assert.equal(new Set(all.map((x) => x.key)).size, 8)
    assert.equal((await history(1, null, 50)).items.length, 8)
  } finally {
    await late.query('rollback')
    late.release()
  }
})
test('history sessions are private, bounded, expiring and membership acknowledgements do not replay old celebrations', async () => {
  await pair()
  for (let i = 0; i < 2; i++) await jointFact()
  assert.deepEqual(await acknowledge(1), [])
  await asUser(2, 'select public.leave_couple_space()')
  await acknowledge(1)
  await resolve(2, await invite(1, 2))
  assert.deepEqual(await acknowledge(1), [])
  const first = await history(1, null, 1)
  assert.deepEqual(Object.keys(first.next_cursor).sort(), [
    'at',
    'badges',
    'key',
    'session',
  ])
  await assert.rejects(
    asUser(1, 'select * from public.statistics_history_sessions'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, 'delete from public.statistics_history_sessions'),
    /permission denied/,
  )
  await pool.query(
    "update public.statistics_history_sessions set expires_at=clock_timestamp()-interval '1 second' where id=$1",
    [first.next_cursor.session],
  )
  await assert.rejects(
    history(1, first.next_cursor),
    /invalid_statistics_cursor/,
  )
  await Promise.all(Array.from({ length: 12 }, () => history(1, null, 1)))
  assert.equal(
    (
      await pool.query(
        'select count(*)::integer n from public.statistics_history_sessions where user_id=$1',
        [uid(1)],
      )
    ).rows[0].n,
    10,
  )
})

test('review: live keyset survives non-ordering UPDATE and VACUUM FREEZE without xmin dependencies', async () => {
  await pair()
  for (let i = 0; i < 3; i++) await jointFact()
  const first = await history(1, null, 1)
  // Disposable owner maintenance only, not an operation available to a browser.
  await pool.query(
    "update public.reward_ledger set title=title where kind='together'",
  )
  await pool.query('vacuum (freeze,analyze) public.reward_ledger')
  const all = [...first.items]
  let cursor = first.next_cursor
  while (cursor) {
    const p = await history(1, cursor, 1)
    all.push(...p.items)
    cursor = p.next_cursor
  }
  assert.equal(
    all.length,
    4,
    'three task facts plus first joint achievement remain readable',
  )
  assert.equal(new Set(all.map((x) => x.key)).size, 4)
})
test('review: thirty-day cumulative XP includes all permitted facts before the window and hides drift', async () => {
  await pair()
  const old = await jointFact()
  await jointFact()
  await pool.query(
    "update public.reward_ledger set created_at=now()-interval '45 days' where kind='together' and task_id=$1",
    [old],
  )
  const data = await statistics(1)
  assert.equal(data.shared.xp_series_complete, true)
  assert.equal(data.calendar[0].cumulative_xp, 20)
  assert.equal(data.calendar.at(-1).cumulative_xp, 40)
  await pool.query('update public.space_progress set together_xp=together_xp+7')
  assert.equal((await statistics(1)).shared.xp_series_complete, false)
})
test('review: live keyset documents late commits above the boundary as refresh-only, not strict snapshot', async () => {
  await pair()
  const pending = await task(1, { kind: 'joint' })
  await respond(2, pending)
  const i = await instance(pending)
  await complete(1, i.id)
  for (let n = 0; n < 5; n++) await jointFact()
  const late = await pool.connect()
  try {
    await late.query('begin')
    await late.query('set local role authenticated')
    await late.query("select set_config('request.jwt.claim.sub',$1,true)", [
      uid(2),
    ])
    const first = await history(1, null, 2)
    await late.query('select public.complete_task_instance($1)', [i.id])
    await late.query('commit')
    const all = [...first.items]
    let cursor = first.next_cursor
    while (cursor) {
      const p = await history(1, cursor, 2)
      all.push(...p.items)
      cursor = p.next_cursor
    }
    assert.equal(all.length, 7)
    assert.equal(new Set(all.map((x) => x.key)).size, 7)
    assert.equal((await history(1, null, 50)).items.length, 8)
    assert.equal(
      (
        await pool.query(
          "select to_regprocedure('public.statistics_visible(xid,pg_snapshot)') as fn",
        )
      ).rows[0].fn,
      null,
    )
  } finally {
    await late.query('rollback')
    late.release()
  }
})
test('review: protected totals, raw facts, cursor filters and acknowledgement rollback preserve economy', async () => {
  await pair()
  await acknowledge(1)
  await earn(1)
  const before = await progress(1)
  await pool.query(`create function public.review_fail_seen() returns trigger language plpgsql as $$begin raise exception 'review_seen_commit_failure'; end$$;
 create constraint trigger review_fail_seen after insert or update on public.statistics_seen deferrable initially deferred for each row execute function public.review_fail_seen()`)
  try {
    await assert.rejects(acknowledge(1), /review_seen_commit_failure/)
    assert.deepEqual(await progress(1), before)
  } finally {
    await pool.query(
      'drop trigger review_fail_seen on public.statistics_seen; drop function public.review_fail_seen()',
    )
  }
  assert.deepEqual(await acknowledge(1), ['personal_1'])
  assert.deepEqual(await acknowledge(1), [])
  for (let n = 0; n < 5; n++) await jointFact()
  const p = await history(1, null, 1)
  for (const badges of [['personal_1'], ['joint_1', 'joint_1'], [{}], null])
    await assert.rejects(
      history(1, { ...p.next_cursor, badges }),
      /invalid_statistics_cursor/,
    )
  const fake = await history(1, { ...p.next_cursor, badges: [] }, 50)
  assert.ok(fake.items.every((x) => x.kind !== 'reward'))
  for (const sql of [
    'select * from public.statistics_joint_facts',
    'update public.space_progress set together_xp=999',
    'update public.user_progress set coins=999',
    'delete from public.goal_reward_ledger',
  ])
    await assert.rejects(asUser(1, sql), /permission denied/)
  await pool.query(
    await readFile('supabase/tests/statistics-privileges.sql', 'utf8'),
  )
})

// Stage 7: rituals are separate from economy and all times are server UTC.
const ritualTerms = (options = {}) => ({
  title: 'Совместный чай',
  description: 'Если хочется обоим',
  emoji: '☕',
  cadence: 'daily',
  days: [1, 2, 3, 4, 5, 6, 7],
  ...options,
})
const ritualList = async (n, filter = 'active', cursor = null, limit = 20) =>
  (
    await asUser(n, 'select public.list_couple_rituals($1,$2,$3) as data', [
      filter,
      cursor,
      limit,
    ])
  )[0].data
const ritualCreate = async (
  n,
  terms = ritualTerms(),
  key = randomUUID(),
  expected = null,
) => {
  const version = expected ?? (await ritualList(n)).create_version
  return (
    await asUser(n, 'select public.create_couple_ritual($1,$2,$3) as id', [
      key,
      terms,
      version,
    ])
  )[0].id
}
const ritualChange = async (
  n,
  id,
  kind,
  terms = {},
  key = randomUUID(),
  expected = null,
) => {
  const version =
    expected ??
    (
      await asUser(
        n,
        'select count(*)::integer n from public.ritual_consents where ritual_id=$1 and requester_id=$2',
        [id, uid(n)],
      )
    )[0].n
  return (
    await asUser(
      n,
      'select public.propose_ritual_change($1,$2,$3,$4,$5) as id',
      [id, key, kind, terms, version],
    )
  )[0].id
}
const ritualDecision = (n, id, decision = 'accept') =>
  asUser(n, 'select public.resolve_ritual_consent($1,$2)', [id, decision])
const ritualPending = async (id) =>
  (
    await pool.query(
      "select id from public.ritual_consents where ritual_id=$1 and status='pending'",
      [id],
    )
  ).rows[0]?.id
const ritualInstance = async (id) =>
  (
    await pool.query(
      'select * from public.ritual_instances where ritual_id=$1 order by scheduled_on desc',
      [id],
    )
  ).rows[0]
const ritualMark = (n, id) =>
  asUser(n, 'select public.complete_ritual_instance($1)', [id])
const ritualRefresh = (n) =>
  asUser(n, 'select public.refresh_ritual_instances()')
const ritualSummary = async (n) =>
  (await asUser(n, 'select public.get_ritual_summary() as data'))[0].data
const ritualHistory = async (n, cursor = null, limit = 20) =>
  (
    await asUser(n, 'select public.list_ritual_history($1,$2) as data', [
      cursor,
      limit,
    ])
  )[0].data
async function activeRitual(terms = ritualTerms()) {
  const id = await ritualCreate(1, terms)
  await ritualDecision(2, await ritualPending(id))
  return id
}
async function ritualClock(value) {
  assert.match(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  await pool.query(
    `create or replace function public.ritual_clock() returns timestamptz language sql volatile set search_path='' as $$select '${value}'::timestamptz$$`,
  )
}
const resetRitualClock = () =>
  pool.query(
    "create or replace function public.ritual_clock() returns timestamptz language sql volatile set search_path='' as $$select clock_timestamp()$$",
  )

test('ritual creation is voluntary, validates terms, requires verified pair and exact original replay even after edits', async () => {
  await create(1)
  await assert.rejects(ritualCreate(1), /partner_required/)
  await resolve(2, await invite(1, 2))
  for (const terms of [
    null,
    [],
    {},
    ritualTerms({ title: 'x' }),
    ritualTerms({ title: 'x'.repeat(101) }),
    ritualTerms({ description: 'x'.repeat(1001) }),
    ritualTerms({ emoji: '<img>' }),
    ritualTerms({ days: [] }),
    ritualTerms({ days: [1, 1] }),
    ritualTerms({ days: ['1'] }),
    ritualTerms({ cadence: 'weekly', days: [1, 2] }),
    ritualTerms({ cadence: 'daily', days: [1] }),
    { ...ritualTerms(), user_id: uid(2) },
  ])
    await assert.rejects(ritualCreate(1, terms), /invalid_ritual/)
  const key = randomUUID(),
    terms = ritualTerms()
  const ids = await Promise.all([
    ritualCreate(1, terms, key, 0),
    ritualCreate(1, terms, key, 0),
  ])
  assert.equal(ids[0], ids[1])
  assert.equal(await ritualInstance(ids[0]), undefined)
  await assert.rejects(
    ritualDecision(1, await ritualPending(ids[0])),
    /ritual_transition_denied/,
  )
  await ritualDecision(2, await ritualPending(ids[0]))
  assert.ok(await ritualInstance(ids[0]))
  const change = await ritualChange(
    2,
    ids[0],
    'edit',
    ritualTerms({ title: 'Новый чай' }),
  )
  await ritualDecision(1, change)
  assert.equal(await ritualCreate(1, terms, key, 0), ids[0])
  await assert.rejects(
    ritualCreate(1, ritualTerms({ title: 'Другие условия' }), key),
    /ritual_request_conflict/,
  )
  await assert.rejects(
    asUser(8, 'select public.create_couple_ritual($1,$2,0)', [
      randomUUID(),
      terms,
    ]),
    /verified_account_required/,
  )
})
test('ritual decline, pending withdrawal and unilateral participation withdrawal cost nothing and preserve history', async () => {
  await pair()
  const before = await progress(1)
  const declined = await ritualCreate(1)
  await ritualDecision(2, await ritualPending(declined), 'decline')
  assert.equal((await ritualList(1, 'closed')).rituals[0].status, 'declined')
  assert.equal(await ritualInstance(declined), undefined)
  const pending = await ritualCreate(2)
  await ritualDecision(2, await ritualPending(pending), 'withdraw')
  const id = await activeRitual(),
    i = await ritualInstance(id)
  await ritualMark(1, i.id)
  await asUser(2, 'select public.withdraw_couple_ritual($1)', [id])
  await asUser(2, 'select public.withdraw_couple_ritual($1)', [id])
  assert.equal((await ritualInstance(id)).status, 'missed')
  assert.equal(
    (await asUser(1, 'select * from public.ritual_completions')).length,
    1,
  )
  await assert.rejects(ritualMark(2, i.id), /ritual_period_unavailable/)
  await assert.rejects(
    ritualChange(1, id, 'resume'),
    /ritual_transition_denied/,
  )
  assert.deepEqual(await progress(1), before)
  assert.equal(
    (await pool.query('select count(*) from public.reward_ledger')).rows[0]
      .count,
    '0',
  )
})
test('two independent ritual marks, duplicate clicks and concurrent calls complete once without XP or Coins', async () => {
  const space = await pair()
  await earn(1)
  const before = await progress(1),
    stats = await statistics(1)
  const id = await activeRitual(),
    i = await ritualInstance(id)
  await ritualMark(1, i.id)
  assert.equal((await ritualInstance(id)).status, 'partial')
  assert.equal((await ritualSummary(1)).completed, 0)
  await Promise.all([
    ritualMark(1, i.id),
    ritualMark(2, i.id),
    ritualMark(2, i.id),
  ])
  assert.equal((await ritualInstance(id)).status, 'completed')
  assert.equal((await ritualSummary(2)).completed, 1)
  assert.equal(
    (await asUser(1, 'select * from public.ritual_completions')).length,
    2,
  )
  assert.equal((await ritualHistory(1)).items.length, 1)
  assert.deepEqual(await progress(1), before)
  assert.deepEqual((await statistics(1)).personal, stats.personal)
  assert.equal(
    (
      await pool.query(
        'select count(*) from public.space_progress where space_id=$1',
        [space],
      )
    ).rows[0].count,
    '0',
  )
  assert.equal(
    (await pool.query('select count(*) from public.goal_reward_ledger')).rows[0]
      .count,
    '0',
  )
  assert.equal(
    (await pool.query('select count(*) from public.coin_transactions')).rows[0]
      .count,
    '1',
  )
})
test('ritual edit/pause/resume/close require new consent, snapshot old marks, and start next UTC day', async () => {
  await pair()
  await ritualClock('2026-10-19T12:00:00Z')
  try {
    const id = await activeRitual(),
      first = await ritualInstance(id)
    await ritualMark(1, first.id)
    const change = await ritualChange(
      1,
      id,
      'edit',
      ritualTerms({ title: 'Новый ритуал', cadence: 'weekdays', days: [2, 4] }),
    )
    await assert.rejects(ritualMark(2, first.id), /ritual_period_unavailable/)
    await assert.rejects(ritualChange(2, id, 'pause'), /ritual_consent_pending/)
    await ritualDecision(2, change)
    assert.equal((await ritualInstance(id)).terms.title, 'Совместный чай')
    assert.equal((await ritualInstance(id)).status, 'missed')
    assert.equal((await ritualList(1)).rituals[0].starts_on, '2026-10-20')
    await ritualClock('2026-10-20T10:00:00Z')
    await ritualRefresh(1)
    const second = await ritualInstance(id)
    assert.notEqual(second.id, first.id)
    assert.equal(second.terms.title, 'Новый ритуал')
    const pause = await ritualChange(2, id, 'pause')
    await ritualDecision(1, pause, 'decline')
    assert.equal((await ritualList(1)).rituals[0].status, 'active')
    await ritualDecision(1, await ritualChange(2, id, 'pause'))
    assert.equal((await ritualList(1, 'paused')).rituals.length, 1)
    await ritualDecision(2, await ritualChange(1, id, 'resume'))
    await ritualRefresh(2)
    assert.equal(
      (
        await pool.query(
          'select count(*) from public.ritual_instances where ritual_id=$1',
          [id],
        )
      ).rows[0].count,
      '2',
    )
    await ritualClock('2026-10-22T10:00:00Z')
    await ritualRefresh(1)
    const third = await ritualInstance(id)
    await Promise.all([ritualMark(1, third.id), ritualMark(2, third.id)])
    await ritualDecision(2, await ritualChange(1, id, 'close'))
    assert.equal((await ritualInstance(id)).status, 'completed')
    assert.equal((await ritualSummary(1)).completed, 1)
  } finally {
    await resetRitualClock()
  }
})
test('ritual daily and weekly UTC rollover never backfills, never combines marks or creates two weekly instances', async () => {
  await pair()
  await ritualClock('2026-10-19T23:59:59Z')
  try {
    const daily = await activeRitual()
    const yesterday = await ritualInstance(daily)
    await ritualMark(1, yesterday.id)
    await ritualClock('2026-10-20T00:00:00Z')
    await assert.rejects(
      ritualMark(2, yesterday.id),
      /ritual_period_unavailable/,
    )
    await Promise.all([ritualRefresh(1), ritualRefresh(2)])
    assert.equal(
      (
        await pool.query(
          'select status from public.ritual_instances where id=$1',
          [yesterday.id],
        )
      ).rows[0].status,
      'missed',
    )
    const today = await ritualInstance(daily)
    await ritualMark(2, today.id)
    assert.equal((await ritualInstance(daily)).status, 'partial')
    await ritualClock('2026-10-25T12:00:00Z')
    await ritualRefresh(1)
    assert.equal(
      (
        await pool.query(
          'select count(*) from public.ritual_instances where ritual_id=$1',
          [daily],
        )
      ).rows[0].count,
      '3',
    )
    await ritualClock('2026-10-19T10:00:00Z')
    const weekly = await activeRitual(
      ritualTerms({ cadence: 'weekly', days: [3] }),
    )
    assert.equal(await ritualInstance(weekly), undefined)
    await ritualClock('2026-10-21T23:59:59Z')
    await ritualRefresh(2)
    const w = await ritualInstance(weekly)
    assert.equal(w.period_key, 'w:2026-10-19')
    await ritualMark(1, w.id)
    await ritualClock('2026-10-22T00:00:00Z')
    await assert.rejects(ritualMark(2, w.id), /ritual_period_unavailable/)
    await ritualDecision(
      2,
      await ritualChange(
        1,
        weekly,
        'edit',
        ritualTerms({ cadence: 'weekly', days: [5] }),
      ),
    )
    await ritualClock('2026-10-23T12:00:00Z')
    await asUser(1,"set local datestyle = 'German, DMY'; select public.refresh_ritual_instances()")
    await ritualRefresh(1)
    assert.equal(
      (
        await pool.query(
          'select count(*) from public.ritual_instances where ritual_id=$1',
          [weekly],
        )
      ).rows[0].count,
      '1',
    )
    await ritualClock('2026-10-30T12:00:00Z')
    await ritualRefresh(1)
    assert.equal((await ritualInstance(weekly)).period_key, 'w:2026-10-26')
    await ritualClock('2026-12-31T12:00:00Z')
    const year = await activeRitual(
      ritualTerms({ cadence: 'weekly', days: [4] }),
    )
    assert.equal((await ritualInstance(year)).period_key, 'w:2026-12-28')
    await ritualClock('2027-01-07T12:00:00Z')
    await ritualRefresh(1)
    assert.equal((await ritualInstance(year)).period_key, 'w:2027-01-04')
  } finally {
    await resetRitualClock()
  }
})
test('ritual request fences preserve original intent and same-key replay never creates another change', async () => {
  await pair()
  const terms = ritualTerms(),
    key = randomUUID()
  const raw = (k) =>
    asUser(1, 'select public.create_couple_ritual($1,$2,0) as id', [k, terms])
  const creates = await Promise.allSettled([raw(key), raw(randomUUID())])
  assert.equal(creates.filter((x) => x.status === 'fulfilled').length, 1)
  const id = (await ritualList(1, 'pending')).rituals[0].id
  await ritualDecision(2, await ritualPending(id))
  const ckey = randomUUID(),
    change = await ritualChange(1, id, 'pause', {}, ckey, 1)
  await ritualDecision(2, change)
  assert.equal(await ritualChange(1, id, 'pause', {}, ckey, 1), change)
  await assert.rejects(
    ritualChange(1, id, 'pause', {}, randomUUID(), 1),
    /ritual_history_changed/,
  )
  const before = (
    await pool.query('select count(*) from public.ritual_consents')
  ).rows[0].count
  assert.equal(
    (
      await asUser(1, 'select public.inspect_ritual_request($1,$2) as data', [
        randomUUID(),
        id,
      ])
    )[0].data,
    null,
  )
  assert.equal(
    (await pool.query('select count(*) from public.ritual_consents')).rows[0]
      .count,
    before,
  )
  await asUser(2, 'select public.withdraw_couple_ritual($1)', [id])
  assert.equal(await ritualChange(1, id, 'pause', {}, ckey, 999), change)
})
test('ritual departure, old cursors and returning/new partner preserve facts but never reopen or reveal history', async () => {
  await pair()
  const done = await activeRitual()
  const i = await ritualInstance(done)
  await Promise.all([ritualMark(1, i.id), ritualMark(2, i.id)])
  const active = await activeRitual()
  await ritualMark(1, (await ritualInstance(active)).id)
  await ritualChange(1, active, 'pause')
  const page = await ritualList(1, 'active', null, 1)
  assert.ok(page.next_cursor)
  await asUser(2, 'select public.leave_couple_space()')
  assert.equal((await ritualList(1, 'closed')).rituals.length, 0)
  assert.equal((await ritualHistory(2)).items.length, 0)
  assert.equal(
    (await pool.query('select count(*) from public.ritual_completions')).rows[0]
      .count,
    '3',
  )
  await assert.rejects(
    ritualList(1, 'active', page.next_cursor),
    /invalid_ritual_cursor/,
  )
  await resolve(3, await invite(1, 3))
  for (const table of [
    'couple_rituals',
    'ritual_consents',
    'ritual_instances',
    'ritual_completions',
  ])
    assert.equal((await asUser(3, `select * from public.${table}`)).length, 0)
  assert.equal((await ritualSummary(3)).completed, 0)
  assert.equal((await ritualHistory(1)).items.length, 0)
  await assert.rejects(ritualMark(3, i.id), /ritual_unavailable/)
  await asUser(3, 'select public.leave_couple_space()')
  await resolve(2, await invite(1, 2))
  assert.equal((await ritualSummary(2)).completed, 1)
  assert.equal((await ritualList(2, 'closed')).rituals.length, 2)
  await assert.rejects(
    ritualChange(2, active, 'resume'),
    /ritual_transition_denied/,
  )
  await assert.rejects(
    ritualList(1, 'active', page.next_cursor),
    /invalid_ritual_cursor/,
  )
})
test('ritual RLS, fixed search_path and exact RPC grants forbid all direct writes and marking for another member', async () => {
  await pool.query(
    await readFile('supabase/tests/ritual-privileges.sql', 'utf8'),
  )
  await pair()
  await create(3)
  const id = await activeRitual(),
    i = await ritualInstance(id)
  for (const table of [
    'couple_rituals',
    'ritual_consents',
    'ritual_instances',
    'ritual_completions',
  ]) {
    assert.equal((await asUser(3, `select * from public.${table}`)).length, 0)
    await assert.rejects(
      asUser(null, `select * from public.${table}`),
      /permission denied/,
    )
    for (const verb of [
      `delete from public.${table}`,
      `truncate public.${table}`,
    ])
      await assert.rejects(asUser(1, verb), /permission denied/)
  }
  await assert.rejects(
    asUser(
      1,
      'insert into public.ritual_completions(instance_id,user_id) values($1,$2)',
      [i.id, uid(2)],
    ),
    /permission denied/,
  )
  await assert.rejects(
    asUser(1, "update public.couple_rituals set status='active'"),
    /permission denied/,
  )
  for (const call of [
    'ritual_clock()',
    'ritual_context()',
    "validate_ritual_terms('{}')",
    `lock_couple_ritual('${id}')`,
    `materialize_ritual('${id}')`,
  ])
    await assert.rejects(
      asUser(1, `select public.${call}`),
      /permission denied/,
    )
  await assert.rejects(ritualMark(3, i.id), /ritual_unavailable/)
  await ritualMark(1, i.id)
  assert.deepEqual(
    (await asUser(1, 'select user_id from public.ritual_completions')).map(
      (r) => r.user_id,
    ),
    [uid(1)],
  )
})
test('ritual pagination is bounded and actor/epoch bound for lists and history; summaries are UTC and own pair only', async () => {
  await pair()
  for (let i = 0; i < 5; i++) {
    const id = await activeRitual(ritualTerms({ title: `Чай ${i}` })),
      instance = await ritualInstance(id)
    await Promise.all([ritualMark(1, instance.id), ritualMark(2, instance.id)])
  }
  let cursor = null
  const seen = []
  do {
    const p = await ritualHistory(1, cursor, 2)
    seen.push(...p.items)
    cursor = p.next_cursor
  } while (cursor)
  assert.equal(seen.length, 5)
  assert.equal(new Set(seen.map((i) => i.id)).size, 5)
  const first = await ritualHistory(1, null, 2)
  await assert.rejects(
    ritualHistory(2, first.next_cursor),
    /invalid_ritual_cursor/,
  )
  const page = await ritualList(1, 'active', null, 2)
  assert.equal(page.rituals.length, 2)
  await assert.rejects(
    ritualList(2, 'active', page.next_cursor),
    /invalid_ritual_cursor/,
  )
  await assert.rejects(
    ritualList(1, 'paused', page.next_cursor),
    /invalid_ritual_cursor/,
  )
  for (const c of [
    {},
    [],
    { ...first.next_cursor, day: 'infinity' },
    { ...first.next_cursor, until: 'invalid' },
  ])
    await assert.rejects(ritualHistory(1, c), /invalid_ritual_cursor/)
  for (const limit of [0, 51, null])
    await assert.rejects(ritualHistory(1, null, limit), /invalid_ritual_cursor/)
  const summary = await ritualSummary(1)
  assert.equal(summary.completed, 5)
  assert.equal(summary.calendar.length, 30)
  assert.equal(summary.timezone, 'UTC')
  assert.equal((await ritualSummary(3)).completed, 0)
})
test('ritual completion and departure races leave only committed independent marks with no economic effects', async () => {
  for (let run = 0; run < 4; run++) {
    await pool.query('truncate auth.users cascade')
    for (const n of [1, 2])
      await pool.query('insert into auth.users values($1,$2,now())', [
        uid(n),
        `user${n}@example.test`,
      ])
    await pair()
    const id = await activeRitual(),
      i = await ritualInstance(id)
    await ritualMark(1, i.id)
    await Promise.allSettled([
      ritualMark(2, i.id),
      asUser(2, 'select public.leave_couple_space()'),
    ])
    const row = await ritualInstance(id),
      marks = (
        await pool.query(
          'select count(*) n from public.ritual_completions where instance_id=$1',
          [i.id],
        )
      ).rows[0].n
    assert.ok(
      (row.status === 'completed' && marks === '2') ||
        (row.status === 'missed' && marks === '1'),
    )
    assert.equal(
      (await pool.query('select count(*) from public.reward_ledger')).rows[0]
        .count,
      '0',
    )
  }
})
test('ritual COMMIT failure rolls back the second mark and completion, retry completes once', async () => {
  await pair()
  const id = await activeRitual(),
    i = await ritualInstance(id)
  await ritualMark(1, i.id)
  await pool.query(`create function public.review_ritual_fail() returns trigger language plpgsql as $$begin if new.status='completed' then raise exception 'ritual_commit_failure'; end if; return new; end$$;
 create constraint trigger review_ritual_fail after update on public.ritual_instances deferrable initially deferred for each row execute function public.review_ritual_fail()`)
  try {
    await assert.rejects(ritualMark(2, i.id), /ritual_commit_failure/)
    assert.equal((await ritualInstance(id)).status, 'partial')
    assert.equal(
      (await pool.query('select count(*) from public.ritual_completions'))
        .rows[0].count,
      '1',
    )
  } finally {
    await pool.query(
      'drop trigger review_ritual_fail on public.ritual_instances; drop function public.review_ritual_fail()',
    )
  }
  await ritualMark(2, i.id)
  assert.equal((await ritualInstance(id)).status, 'completed')
})
test('ritual UTC time is sampled after lock waits, not at request start', async () => {
  const space = await pair()
  await pool.query(
    "create table public.review_ritual_time(value timestamptz);insert into public.review_ritual_time values('2026-10-19T23:59:59Z');create or replace function public.ritual_clock() returns timestamptz language sql volatile set search_path='' as $$select value from public.review_ritual_time$$",
  )
  const blocker = await pool.connect()
  try {
    const id = await activeRitual(),
      i = await ritualInstance(id)
    await ritualMark(1, i.id)
    await blocker.query('begin')
    await blocker.query(
      'select id from public.couple_spaces where id=$1 for update',
      [space],
    )
    const waiting = ritualMark(2, i.id).then(
      () => false,
      (e) => e.message,
    )
    // Wait for an actual PostgreSQL lock wait, not an assumed wall-clock delay.
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (
          await pool.query(
            "select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%complete_ritual_instance%'",
          )
        ).rowCount
      )
        break
      if (attempt === 99) throw Error('ritual call did not reach lock wait')
      await new Promise((r) => setTimeout(r, 10))
    }
    await pool.query(
      "update public.review_ritual_time set value='2026-10-20T00:00:00Z'",
    )
    await blocker.query('commit')
    assert.match(await waiting, /ritual_period_unavailable/)
    await Promise.all([ritualRefresh(1), ritualRefresh(2)])
    assert.equal(
      (
        await pool.query(
          'select count(*) from public.ritual_instances where ritual_id=$1',
          [id],
        )
      ).rows[0].count,
      '2',
    )
  } finally {
    await blocker.query('rollback')
    blocker.release()
    await resetRitualClock()
    await pool.query('drop table public.review_ritual_time')
  }
})
test('ritual history index scopes a growing history to its space before paging', async (t) => {
  const space = await pair(),
    id = await activeRitual()
  await pool.query(
    `insert into public.ritual_instances(ritual_id,space_id,period_key,scheduled_on,version,terms,status,completed_at)
 select r.id,r.space_id,'d:'||((now() at time zone 'UTC')::date-i)::text,(now() at time zone 'UTC')::date-i,r.version,r.terms,'completed',now()-i*interval '1 day'
 from public.couple_rituals r cross join generate_series(1,3000) i where r.id=$1`,
    [id],
  )
  await pool.query(
    `insert into public.ritual_completions(instance_id,user_id,completed_at) select i.id,u,i.completed_at from public.ritual_instances i cross join unnest($2::uuid[]) u where ritual_id=$1 and status='completed'`,
    [id, [uid(1), uid(2)]],
  )
  await pool.query('analyze public.ritual_instances')
  const result = (
    await pool.query(
      "explain(analyze,format json) select id from public.ritual_instances where space_id=$1 and scheduled_on<(now() at time zone 'UTC')::date-2900 order by scheduled_on desc,id desc limit 21",
      [space],
    )
  ).rows[0]['QUERY PLAN'][0]
  assert.match(JSON.stringify(result), /ritual_instances_history/)
  assert.equal(result.Plan['Actual Rows'], 21)
  assert.equal((await ritualHistory(1)).items.length, 20)
  assert.equal((await ritualSummary(1)).completed, 3000)
  assert.equal((await ritualSummary(3)).completed, 0)
  t.diagnostic(
    `3000 ritual instances / 6000 marks: deep indexed history ${result['Execution Time']} ms`,
  )
})
test('ritual open limit is enforced under concurrent creation and closing frees capacity without deleting history',async()=>{
 await pair()
 let first
 for(let i=0;i<49;i++){const id=await ritualCreate(1,ritualTerms(),randomUUID(),i);if(i===0)first=id}
 const raced=await Promise.allSettled([ritualCreate(1,ritualTerms(),randomUUID(),49),ritualCreate(2,ritualTerms(),randomUUID(),0)])
 assert.equal(raced.filter(r=>r.status==='fulfilled').length,1)
 assert.match(raced.find(r=>r.status==='rejected').reason.message,/ritual_limit/)
 await asUser(2,'select public.withdraw_couple_ritual($1)',[first])
 const fresh=await ritualCreate(2)
 assert.ok(fresh)
 assert.equal((await pool.query("select count(*) from public.couple_rituals where status in ('pending','active','paused')")).rows[0].count,'50')
 assert.equal((await pool.query("select count(*) from public.couple_rituals where status='closed'")).rows[0].count,'1')
})
