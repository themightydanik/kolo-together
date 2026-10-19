// Entire migrations run against new databases in the runner's own disposable
// container, never an existing project/account. Each fixture has its own DB.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
const source = process.env.KOLO_LOCAL_TEST_DB
if (
  !source ||
  new URL(source).hostname !== '127.0.0.1' ||
  new URL(source).pathname !== '/kolo_test'
)
  throw Error('Disposable local runner required')
const store = await readFile(
  'supabase/migrations/20261019220000_rewards_store.sql',
  'utf8',
)
async function fixture(run) {
  const admin = new pg.Client({ connectionString: source })
  await admin.connect()
  const name = 'kolo_migration_' + randomUUID().replaceAll('-', '')
  await admin.query('create database ' + name)
  const url = new URL(source)
  url.pathname = '/' + name
  const db = new pg.Client({ connectionString: url.href })
  await db.connect()
  try {
    // Client roles already exist in this disposable cluster after security.mjs.
    const bootstrap = (
      await readFile('supabase/tests/bootstrap.sql', 'utf8')
    ).replace(/create role (anon|authenticated) nologin;/g, '')
    await db.query(bootstrap)
    for (const name of [
      '20261019150000_auth_profiles_couples.sql',
      '20261019170000_tasks_economy.sql',
      '20261019190000_tasks_security_review.sql',
    ])
      await db.query(await readFile('supabase/migrations/' + name, 'utf8'))
    const user = randomUUID()
    await db.query('insert into auth.users values($1,$2,now())', [
      user,
      'migration@example.test',
    ])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ])
    const space = (await db.query('select public.create_couple_space() as id'))
      .rows[0].id
    const task = (
      await db.query(
        "select public.create_task($1,'Тест','','personal','care','normal',null,'once') as id",
        [randomUUID()],
      )
    ).rows[0].id
    const instance = (
      await db.query('select id from public.task_instances where task_id=$1', [
        task,
      ])
    ).rows[0].id
    await db.query('select public.complete_task_instance($1)', [instance])
    await run(db, { user, space, task, instance })
  } finally {
    await db.query('rollback').catch(() => {})
    await db.end()
    await admin.query('drop database ' + name)
    await admin.end()
  }
}
async function failedMigration(db, sql = store) {
  await assert.rejects(db.query(sql))
  await db.query('rollback')
  assert.equal(
    (
      await db.query(
        "select to_regprocedure('public.buy_reward_offer(uuid,uuid,integer)') as fn",
      )
    ).rows[0].fn,
    null,
  )
  assert.equal(
    (await db.query("select to_regclass('public.reward_offers') as name"))
      .rows[0].name,
    null,
  )
  assert.equal(
    (await db.query("select to_regclass('public.coin_transactions') as name"))
      .rows[0].name,
    null,
  )
  assert.equal(
    (
      await db.query(
        "select count(*)::integer as n from pg_trigger where tgname='coin_earning'",
      )
    ).rows[0].n,
    0,
  )
}
test('whole migration backfills historical positive Coins once without changing XP/balance', () =>
  fixture(async (db) => {
    await db.query(store)
    assert.deepEqual(
      (
        await db.query(
          'select xp::integer,coins::integer from public.user_progress',
        )
      ).rows,
      [{ xp: 20, coins: 10 }],
    )
    assert.deepEqual(
      (await db.query('select kind,amount from public.coin_transactions')).rows,
      [{ kind: 'earn', amount: 10 }],
    )
    assert.equal(
      (
        await db.query(
          'select count(*)::integer as n from public.reward_ledger',
        )
      ).rows[0].n,
      1,
    )
  }))
test('missing progress with positive history aborts all DDL and preserves earning facts', () =>
  fixture(async (db) => {
    await db.query('delete from public.user_progress')
    await failedMigration(db)
    assert.equal(
      (await db.query('select * from public.user_progress')).rowCount,
      0,
    )
    assert.equal(
      (await db.query('select * from public.reward_ledger')).rowCount,
      1,
    )
  }))
test('zero balances and zero legacy earnings are preserved without zero coin transactions', () =>
  fixture(async (db, { user }) => {
    // Current PR #3 constraints forbid zero personal grants. Simulate legacy
    // imports only inside this new disposable database; production stays strict.
    await db.query(
      'alter table public.reward_ledger drop constraint reward_ledger_check',
    )
    await db.query('update public.reward_ledger set coins=0')
    await db.query('update public.user_progress set coins=0')
    await db.query(store)
    assert.equal(
      (await db.query('select * from public.coin_transactions')).rowCount,
      0,
    )
    assert.equal(
      (await db.query('select coins from public.reward_ledger')).rows[0].coins,
      0,
    )
    assert.equal(
      (
        await db.query(
          'select coins::integer as n from public.user_progress where user_id=$1',
          [user],
        )
      ).rows[0].n,
      0,
    )
  }))
test('balance mismatch aborts migration and leaves original data intact', () =>
  fixture(async (db) => {
    await db.query('update public.user_progress set coins=11')
    await failedMigration(db)
    assert.equal(
      (await db.query('select coins::integer as n from public.user_progress'))
        .rows[0].n,
      11,
    )
    assert.equal(
      (await db.query('select coins from public.reward_ledger')).rows[0].coins,
      10,
    )
  }))
test('late migration error rolls back backfill, DDL, triggers and grants atomically', () =>
  fixture(async (db) => {
    await failedMigration(
      db,
      store.replace(/commit;\s*$/, 'select 1/0; commit;'),
    )
    assert.equal(
      (await db.query('select coins::integer as n from public.user_progress'))
        .rows[0].n,
      10,
    )
    assert.equal(
      (await db.query('select * from public.reward_ledger')).rowCount,
      1,
    )
    await db.query(store)
    assert.equal(
      (await db.query('select * from public.coin_transactions')).rowCount,
      1,
    )
  }))
test('normal Together XP zero Coins never becomes an earn transaction; newcomer without progress is valid', () =>
  fixture(async (db, { user, space }) => {
    const partner = randomUUID(),
      newcomer = randomUUID()
    await db.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [
      partner,
      'partner@example.test',
      newcomer,
      'newcomer@example.test',
    ])
    const token = (
      await db.query(
        "select public.create_couple_invitation('partner@example.test') as token",
      )
    ).rows[0].token
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      partner,
    ])
    await db.query('select public.resolve_couple_invitation($1,true)', [token])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ])
    const task = (
      await db.query(
        "select public.create_task($1,'Вместе','','joint','care','normal',null,'once') as id",
        [randomUUID()],
      )
    ).rows[0].id
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      partner,
    ])
    await db.query('select public.respond_task($1,true)', [task])
    const instance = (
      await db.query('select id from public.task_instances where task_id=$1', [
        task,
      ])
    ).rows[0].id
    await db.query('select public.complete_task_instance($1)', [instance])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ])
    await db.query('select public.complete_task_instance($1)', [instance])
    await db.query(store)
    assert.equal(
      (await db.query('select * from public.coin_transactions')).rowCount,
      3,
    )
    assert.equal(
      (
        await db.query(
          "select * from public.reward_ledger where kind='together' and coins=0",
        )
      ).rowCount,
      1,
    )
    assert.equal(
      (
        await db.query('select * from public.user_progress where user_id=$1', [
          newcomer,
        ])
      ).rowCount,
      0,
    )
    assert.equal(
      (
        await db.query(
          'select together_xp::integer as n from public.space_progress where space_id=$1',
          [space],
        )
      ).rows[0].n,
      20,
    )
  }))
