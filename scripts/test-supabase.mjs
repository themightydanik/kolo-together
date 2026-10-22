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
  const tasksExist = await db.query(
    "select to_regclass('public.tasks') as name",
  )
  if (!tasksExist.rows[0].name)
    await db.query(
      await readFile(
        'supabase/migrations/20261019170000_tasks_economy.sql',
        'utf8',
      ),
    )
  await db.query(
    await readFile(
      'supabase/migrations/20261019190000_tasks_security_review.sql',
      'utf8',
    ),
  )
  await db.query(await readFile('supabase/tests/task-privileges.sql', 'utf8'))
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
  step = 'task economy through real Auth and PostgREST'
  const createTask = async (kind, difficulty = 'normal', recurrence = 'once') =>
    check(
      await a.rpc('create_task', {
        p_request_id: randomUUID(),
        p_title: 'Забота вместе',
        p_description: 'Только локальный тест',
        p_kind: kind,
        p_category: 'care',
        p_difficulty: difficulty,
        p_due_date: null,
        p_recurrence: recurrence,
      }),
      'Create task with no reward parameters',
    )
  const taskInstance = async (id) =>
    check(
      await a
        .from('task_instances')
        .select('*')
        .eq('task_id', id)
        .order('period_start', { ascending: false })
        .limit(1)
        .single(),
      'Read instance',
    )
  const personal = await createTask('personal', 'easy')
  const personalInstance = await taskInstance(personal)
  const reward = check(
    await a.rpc('complete_task_instance', {
      p_instance_id: personalInstance.id,
    }),
    'Earn personal XP/Coins',
  )
  assert.equal(reward.xp, 10)
  assert.equal(reward.coins, 5)
  assert.equal(
    check(
      await a.rpc('complete_task_instance', {
        p_instance_id: personalInstance.id,
      }),
      'Idempotent completion',
    ).already_completed,
    true,
  )
  const joint = await createTask('joint')
  check(
    await b.rpc('respond_task', { p_task_id: joint, p_accept: true }),
    'Consent to joint task',
  )
  const ji = await taskInstance(joint)
  const simultaneous = await Promise.all([
    a.rpc('complete_task_instance', { p_instance_id: ji.id }),
    b.rpc('complete_task_instance', { p_instance_id: ji.id }),
  ])
  simultaneous.forEach((result) => check(result, 'Concurrent joint completion'))
  assert.equal(
    check(
      await a.from('space_progress').select('*').eq('space_id', space).single(),
      'Read Together XP',
    ).together_xp,
    20,
  )
  assert.equal(
    check(
      await a
        .from('reward_ledger')
        .select('*')
        .eq('instance_id', ji.id)
        .eq('kind', 'together'),
      'Single together grant',
    ).length,
    1,
  )
  const proposal = await createTask('proposal')
  check(
    await b.rpc('respond_task', { p_task_id: proposal, p_accept: false }),
    'Decline without penalty',
  )
  const daily = await createTask('personal', 'normal', 'daily')
  const dailyInstance = await taskInstance(daily)
  check(
    await a.rpc('complete_task_instance', { p_instance_id: dailyInstance.id }),
    'Complete current daily instance',
  )
  await a.rpc('refresh_task_instances')
  assert.equal(
    check(
      await a.from('task_instances').select('*').eq('task_id', daily),
      'No duplicate daily instance',
    ).length,
    1,
  )
  assert.equal(
    check(await c.from('tasks').select('*'), 'Task isolation through JWT')
      .length,
    0,
  )
  assert.equal(
    check(
      await b.from('tasks').select('*').eq('id', personal),
      'Partner cannot read private task',
    ).length,
    0,
  )
  for (const [sdk, instanceId, expected] of [
    [a, personalInstance.id, 1],
    [b, personalInstance.id, 0],
    [c, personalInstance.id, 0],
    [b, ji.id, 2],
    [c, ji.id, 0],
  ]) {
    assert.equal(
      check(
        await sdk
          .from('task_completions')
          .select('*')
          .eq('instance_id', instanceId),
        'Explicit completion privacy through real JWT/RLS',
      ).length,
      expected,
    )
  }
  for (const sdk of [a, anon])
    assert.ok(
      (await sdk.rpc('task_clock')).error,
      'Internal clock is not a client RPC',
    )
  assert.ok(
    (
      await a
        .from('user_progress')
        .update({ coins: 999999 })
        .eq('user_id', signup.user.id)
    ).error,
    'Direct coin tampering denied',
  )
  assert.ok(
    (await a.from('reward_ledger').delete().eq('task_id', personal)).error,
    'Immutable journal',
  )
  assert.ok(
    (await a.rpc('materialize_task', { p_task_id: personal })).error,
    'Internal task helper unavailable',
  )
  const xpBefore = check(
    await a.from('user_progress').select('*').single(),
    'Read earned points',
  )
  assert.equal(xpBefore.xp, 50)
  assert.equal(xpBefore.coins, 25)
  console.log(
    'PASS: real task consent, personal/joint/daily grants, concurrent completion, Together XP, RLS and immutable balances/journal',
  )
  step =
    'store migration backfills real existing earnings without changing balances'
  const storeExists = await db.query(
    "select to_regclass('public.reward_offers') as name",
  )
  if (!storeExists.rows[0].name)
    await db.query(
      await readFile(
        'supabase/migrations/20261019220000_rewards_store.sql',
        'utf8',
      ),
    )
  await db.query(await readFile('supabase/tests/store-privileges.sql', 'utf8'))
  await db.query("notify pgrst,'reload schema'")
  let initialSummary
  for (let attempt = 0; attempt < 100; attempt++) {
    initialSummary = await a.rpc('get_coin_summary')
    if (!initialSummary.error) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.deepEqual(check(initialSummary, 'Historical earning mirror'), {
    balance: 25,
    earned: '25',
    spent: '0',
    refunded: '0',
  })
  const createOffer = async (kind = 'partner') =>
    check(
      await a.rpc('create_reward_offer', {
        p_request_id: randomUUID(),
        p_title: 'Вечер без спешки',
        p_description: 'Добровольный ритуал',
        p_kind: kind,
        p_category: 'time',
        p_emoji: '🎁',
        p_price: 5,
        p_single_use: false,
      }),
      'Create real offer',
    )
  const storeOffer = await createOffer()
  const request = randomUUID()
  const bought = check(
    await b.rpc('buy_reward_offer', {
      p_offer_id: storeOffer,
      p_request_id: request,
      p_expected_purchases: 0,
    }),
    'Buy with own Coins',
  )
  assert.equal(
    check(
      await b.rpc('buy_reward_offer', {
        p_offer_id: storeOffer,
        p_request_id: request,
        p_expected_purchases: 0,
      }),
      'Retry real purchase',
    ),
    bought,
  )
  assert.equal(
    check(await b.rpc('get_coin_summary'), 'Balance after purchase').balance,
    5,
  )
  assert.ok(
    (
      await a.rpc('act_reward_purchase', {
        p_purchase_id: bought,
        p_action: 'confirm',
      })
    ).error,
    'Provider cannot confirm for buyer',
  )
  check(
    await a.rpc('act_reward_purchase', {
      p_purchase_id: bought,
      p_action: 'refuse',
    }),
    'Refuse and refund',
  )
  check(
    await b.rpc('act_reward_purchase', {
      p_purchase_id: bought,
      p_action: 'cancel',
    }),
    'No double refund',
  )
  assert.equal(
    check(await b.rpc('get_coin_summary'), 'Refunded balance').balance,
    10,
  )
  const stale = await b.rpc('buy_reward_offer', {
    p_offer_id: storeOffer,
    p_request_id: randomUUID(),
    p_expected_purchases: 0,
  })
  assert.equal(
    stale.error?.message,
    'reward_purchase_changed',
    'Lost UUID/stale tab must fail even after cancellation',
  )
  assert.equal(
    check(await b.rpc('get_coin_summary'), 'No unnoticed second spend').balance,
    10,
  )
  const finished = check(
    await b.rpc('buy_reward_offer', {
      p_offer_id: storeOffer,
      p_request_id: randomUUID(),
      p_expected_purchases: 1,
    }),
    'Buy second reward',
  )
  check(
    await a.rpc('act_reward_purchase', {
      p_purchase_id: finished,
      p_action: 'ready',
    }),
    'Provider readiness',
  )
  check(
    await b.rpc('act_reward_purchase', {
      p_purchase_id: finished,
      p_action: 'confirm',
    }),
    'Buyer confirms receipt',
  )
  const jointOffer = await createOffer('joint')
  assert.ok(
    (
      await a.rpc('buy_reward_offer', {
        p_offer_id: jointOffer,
        p_expected_purchases: 0,
        p_request_id: randomUUID(),
      })
    ).error,
    'Joint requires other consent',
  )
  check(
    await b.rpc('respond_reward_offer', {
      p_offer_id: jointOffer,
      p_accept: true,
    }),
    'Joint offer consent',
  )
  const departurePurchase = check(
    await a.rpc('buy_reward_offer', {
      p_offer_id: jointOffer,
      p_expected_purchases: 0,
      p_request_id: randomUUID(),
    }),
    'Pending purchase before exit',
  )
  for (const table of [
    'reward_offers',
    'reward_offer_consents',
    'reward_purchases',
    'coin_transactions',
  ])
    assert.equal(
      check(await c.from(table).select('*'), 'Store JWT isolation').length,
      0,
    )
  assert.ok(
    (await b.from('coin_transactions').delete().eq('purchase_id', bought))
      .error,
    'Immutable coin journal',
  )
  assert.ok(
    (await b.rpc('refund_reward_purchase', { p_purchase_id: bought })).error,
    'Internal refund is denied',
  )
  console.log(
    'PASS: historical Coins backfill, real store JWT/RLS/RPC, consent, exact debit/refund, buyer receipt and journal grants',
  )
  step = 'goals schema, JWT/RLS and atomic Together XP'
  const goalsExist = await db.query(
    "select to_regclass('public.couple_goals') as name",
  )
  if (!goalsExist.rows[0].name)
    await db.query(
      await readFile(
        'supabase/migrations/20261020090000_couple_goals.sql',
        'utf8',
      ),
    )
  await db.query(await readFile('supabase/tests/goal-privileges.sql', 'utf8'))
  await db.query("notify pgrst,'reload schema'")
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await a.from('couple_goals').select('id').limit(1)).error) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const createGoal = async () =>
    check(
      await a.rpc('create_couple_goal', {
        p_request_id: randomUUID(),
        p_title: 'Вместе в Карпаты',
        p_description: 'Локальная общая мечта',
        p_category: 'travel',
        p_emoji: '🏔️',
        p_target_date: null,
        p_expected_goals: check(
          await a
            .from('couple_goals')
            .select('id')
            .eq('creator_id', signup.user.id),
          'Own creation history',
        ).length,
      }),
      'Create goal',
    )
  const pendingGoalConsent = async (id) =>
    check(
      await a
        .from('goal_consents')
        .select('*')
        .eq('goal_id', id)
        .eq('status', 'pending')
        .single(),
      'Read goal consent',
    )
  const goalId = await createGoal()
  const initialConsent = await pendingGoalConsent(goalId)
  assert.ok(
    (
      await a.rpc('resolve_goal_consent', {
        p_consent_id: initialConsent.id,
        p_decision: 'accept',
      })
    ).error,
    'Author cannot consent for partner',
  )
  check(
    await b.rpc('resolve_goal_consent', {
      p_consent_id: initialConsent.id,
      p_decision: 'accept',
    }),
    'Accept shared goal',
  )
  const stepConsent = check(
    await a.rpc('propose_goal_change', {
      p_goal_id: goalId,
      p_request_id: randomUUID(),
      p_kind: 'step_add',
      p_expected_changes: 1,
      p_payload: { title: 'Выбрать даты', description: '', assignment: 'both' },
    }),
    'Propose shared step',
  )
  assert.equal(
    check(
      await a.from('goal_progress').select('*').eq('goal_id', goalId).single(),
      'Empty server progress',
    ).percent,
    0,
  )
  check(
    await b.rpc('resolve_goal_consent', {
      p_consent_id: stepConsent,
      p_decision: 'accept',
    }),
    'Agree to step',
  )
  const goalStep = check(
    await a.from('goal_steps').select('*').eq('goal_id', goalId).single(),
    'Read agreed step',
  )
  const marks = await Promise.all([
    a.rpc('complete_goal_step', { p_step_id: goalStep.id }),
    b.rpc('complete_goal_step', { p_step_id: goalStep.id }),
    a.rpc('complete_goal_step', { p_step_id: goalStep.id }),
  ])
  marks.forEach((result) => check(result, 'Concurrent own marks'))
  assert.equal(
    check(
      await a.from('goal_progress').select('*').eq('goal_id', goalId).single(),
      'Completed server progress',
    ).percent,
    100,
  )
  const beforeGoalCoins = check(
    await a.rpc('get_coin_summary'),
    'Coins before goal bonus',
  )
  const finishGoal = check(
    await b.rpc('propose_goal_change', {
      p_goal_id: goalId,
      p_request_id: randomUUID(),
      p_kind: 'complete',
      p_expected_changes: 0,
      p_payload: {},
    }),
    'Propose mutual achievement',
  )
  const finishes = await Promise.all([
    a.rpc('resolve_goal_consent', {
      p_consent_id: finishGoal,
      p_decision: 'accept',
    }),
    a.rpc('resolve_goal_consent', {
      p_consent_id: finishGoal,
      p_decision: 'accept',
    }),
  ])
  finishes.forEach((result) => check(result, 'Idempotent mutual finish'))
  assert.equal(
    check(
      await a.from('goal_reward_ledger').select('*').eq('goal_id', goalId),
      'Single goal reward',
    ).length,
    1,
  )
  assert.equal(
    check(
      await a.from('space_progress').select('*').eq('space_id', space).single(),
      '50 goal + 20 task Together XP',
    ).together_xp,
    70,
  )
  assert.deepEqual(
    check(await a.rpc('get_coin_summary'), 'Goals do not alter Coins'),
    beforeGoalCoins,
  )
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
    assert.equal(
      check(await c.from(table).select('*'), 'Goal JWT isolation').length,
      0,
    )
  assert.ok(
    (await a.from('goal_reward_ledger').delete().eq('goal_id', goalId)).error,
    'Goal reward immutable',
  )
  assert.ok(
    (await a.rpc('lock_couple_goal', { p_goal_id: goalId })).error,
    'Internal goal helper denied',
  )
  const requestInfo = check(
    await a.from('couple_goals').select('request_id').eq('id', goalId).single(),
    'Original goal request',
  )
  assert.equal(
    check(
      await a.rpc('inspect_goal_request', {
        p_request_id: requestInfo.request_id,
        p_goal_id: null,
      }),
      'Read-only lost-response lookup',
    ).status,
    'completed',
  )
  assert.equal(
    check(
      await a.rpc('inspect_goal_request', {
        p_request_id: randomUUID(),
        p_goal_id: null,
      }),
      'Missing request lookup',
    ),
    null,
  )
  assert.ok(
    (
      await a.rpc('create_couple_goal', {
        p_request_id: randomUUID(),
        p_expected_goals: 0,
        p_title: 'Вместе в Карпаты',
        p_description: 'Локальная общая мечта',
        p_category: 'travel',
        p_emoji: '🏔️',
        p_target_date: null,
      })
    ).error,
    'Stale new UUID cannot duplicate goal',
  )
  assert.equal(
    (
      await db.query(
        await readFile('supabase/tests/together-xp-audit.sql', 'utf8'),
      )
    ).rowCount,
    0,
  )
  step = 'statistics migration, real JWT aggregates and server pagination'
  if (
    !(await db.query("select to_regclass('public.statistics_seen') as name"))
      .rows[0].name
  )
    await db.query(
      await readFile(
        'supabase/migrations/20261020120000_achievements_statistics.sql',
        'utf8',
      ),
    )
  await db.query(
    await readFile('supabase/tests/statistics-privileges.sql', 'utf8'),
  )
  await db.query("notify pgrst,'reload schema'")
  let stats
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await a.rpc('get_statistics')
    if (!result.error) {
      stats = result.data
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(stats, 'PostgREST statistics schema reload')
  assert.equal(stats.shared.together_xp, 70)
  assert.equal(stats.shared.tasks, 1)
  assert.equal(stats.shared.goals, 1)
  assert.equal(stats.personal.coins, beforeGoalCoins.balance)
  assert.equal(stats.calendar.length, 30)
  assert.equal(stats.badges.length, 13)
  assert.deepEqual(
    check(await a.rpc('acknowledge_statistics'), 'Silent historical baseline'),
    [],
  )
  assert.deepEqual(
    check(await a.rpc('acknowledge_statistics'), 'Reload acknowledgement'),
    [],
  )
  const statisticsPage = check(
    await a.rpc('get_joint_history', { p_cursor: null, p_limit: 1 }),
    'History first server page',
  )
  assert.equal(statisticsPage.items.length, 1)
  assert.ok(statisticsPage.next_cursor)
  const statisticsPage2 = check(
    await a.rpc('get_joint_history', {
      p_cursor: statisticsPage.next_cursor,
      p_limit: 20,
    }),
    'History keyset continuation',
  )
  assert.ok(
    statisticsPage2.items.every((x) => x.key !== statisticsPage.items[0].key),
  )
  assert.ok(
    (
      await b.rpc('get_joint_history', {
        p_cursor: statisticsPage.next_cursor,
        p_limit: 20,
      })
    ).error,
    'Cursor actor binding',
  )
  assert.ok(
    (
      await a
        .from('statistics_seen')
        .update({ codes: ['forged'] })
        .eq('user_id', created[1])
    ).error,
    'Seen direct writes denied',
  )
  assert.ok(
    (await a.rpc('statistics_badges')).error,
    'Internal aggregation helper denied',
  )
  assert.ok(
    (await a.from('statistics_joint_facts').select('*')).error,
    'Raw facts view denied',
  )
  const isolatedStats = check(
    await c.rpc('get_statistics'),
    'Isolated account statistics',
  )
  assert.equal(isolatedStats.shared.tasks, 0)
  assert.equal(isolatedStats.shared.goals, 0)
  console.log(
    'PASS: statistics historical facts, 13 badges, exact balances, UTC calendar, JWT privacy, keyset pagination and silent acknowledgement',
  )
  step = 'rituals schema and independent voluntary participation'
  if (
    !(await db.query("select to_regclass('public.couple_rituals') as name"))
      .rows[0].name
  )
    await db.query(
      await readFile(
        'supabase/migrations/20261021120000_couple_rituals.sql',
        'utf8',
      ),
    )
  await db.query(await readFile('supabase/tests/ritual-privileges.sql', 'utf8'))
  await db.query("notify pgrst,'reload schema'")
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await a.from('ritual_consents').select('id').limit(1)
    if (!ready.error) break
    if (attempt === 99) throw Error('Ritual schema cache unavailable')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const ritualTerms = {
    title: 'Чай без спешки',
    description: 'Только по желанию обоих',
    emoji: '☕',
    cadence: 'daily',
    days: [1, 2, 3, 4, 5, 6, 7],
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      !(
        await a.rpc('list_couple_rituals', {
          p_filter: 'active',
          p_cursor: null,
          p_limit: 20,
        })
      ).error
    )
      break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const ritualList = async (
    client,
    filter = 'active',
    cursor = null,
    limit = 20,
  ) =>
    check(
      await client.rpc('list_couple_rituals', {
        p_filter: filter,
        p_cursor: cursor,
        p_limit: limit,
      }),
      'Real ritual list',
    )
  const makeRitual = async () =>
    check(
      await a.rpc('create_couple_ritual', {
        p_request_id: randomUUID(),
        p_terms: ritualTerms,
        p_expected_creations: (await ritualList(a)).create_version,
      }),
      'Create ritual',
    )
  const acceptRitual = async (id) => {
    const consent = check(
      await a
        .from('ritual_consents')
        .select('*')
        .eq('ritual_id', id)
        .eq('status', 'pending')
        .single(),
      'Read ritual consent',
    )
    check(
      await b.rpc('resolve_ritual_consent', {
        p_consent_id: consent.id,
        p_decision: 'accept',
      }),
      'Partner accepts ritual',
    )
  }
  const ritual = await makeRitual()
  assert.equal(
    check(
      await a.from('ritual_instances').select('*').eq('ritual_id', ritual),
      'Inactive until consent',
    ).length,
    0,
  )
  await acceptRitual(ritual)
  const ritualInstance = check(
    await a
      .from('ritual_instances')
      .select('*')
      .eq('ritual_id', ritual)
      .single(),
    'Current UTC ritual instance',
  )
  const ritualCoins = check(
    await a.rpc('get_coin_summary'),
    'Coins before ritual',
  )
  const ritualStats = check(
    await a.rpc('get_statistics'),
    'Statistics before ritual',
  )
  const ritualMarks = await Promise.all([
    a.rpc('complete_ritual_instance', { p_instance_id: ritualInstance.id }),
    b.rpc('complete_ritual_instance', { p_instance_id: ritualInstance.id }),
    b.rpc('complete_ritual_instance', { p_instance_id: ritualInstance.id }),
  ])
  ritualMarks.forEach((r) => check(r, 'Own ritual mark'))
  assert.equal(
    check(await a.rpc('get_ritual_summary'), 'Completed ritual count')
      .completed,
    1,
  )
  assert.equal(
    check(
      await a.rpc('list_ritual_history', { p_cursor: null, p_limit: 20 }),
      'Ritual history',
    ).items.length,
    1,
  )
  assert.deepEqual(
    check(await a.rpc('get_coin_summary'), 'Ritual never changes Coins'),
    ritualCoins,
  )
  const statsAfterRitual = check(
    await a.rpc('get_statistics'),
    'Ritual never changes task/goal statistics',
  )
  assert.deepEqual(statsAfterRitual.personal, ritualStats.personal)
  assert.deepEqual(statsAfterRitual.shared, ritualStats.shared)
  assert.ok(
    (
      await a
        .from('ritual_completions')
        .insert({ instance_id: ritualInstance.id, user_id: created[2] })
    ).error,
    'Cannot mark for someone else',
  )
  assert.ok((await a.rpc('ritual_clock')).error, 'Internal UTC clock denied')
  assert.equal(
    check(
      await c.from('couple_rituals').select('*'),
      'Cross-space ritual isolation',
    ).length,
    0,
  )
  const unfinishedRitual = await makeRitual()
  await acceptRitual(unfinishedRitual)
  const unfinishedRitualInstance = check(
    await a
      .from('ritual_instances')
      .select('*')
      .eq('ritual_id', unfinishedRitual)
      .single(),
    'Second ritual instance',
  )
  check(
    await a.rpc('complete_ritual_instance', {
      p_instance_id: unfinishedRitualInstance.id,
    }),
    'Partial ritual before departure',
  )
  const pendingRitualChange = check(
    await a.rpc('propose_ritual_change', {
      p_ritual_id: unfinishedRitual,
      p_request_id: randomUUID(),
      p_kind: 'pause',
      p_terms: {},
      p_expected_changes: 1,
    }),
    'Ritual change requires consent',
  )
  const oldRitualCursor = (await ritualList(a, 'active', null, 1)).next_cursor
  console.log(
    'PASS: rituals real Auth/JWT/RLS, bilateral consent, two independent marks, duplicates, history, zero economy effects and private helper denial',
  )
  step = 'emotional connection schema, real Auth and private answers'
  if (
    !(
      await db.query("select to_regclass('public.connection_sessions') as name")
    ).rows[0].name
  ) {
    await db.query(
      await readFile(
        'supabase/migrations/20261022120000_emotional_connection.sql',
        'utf8',
      ),
    )
  }
  if(!(await db.query("select 1 from information_schema.columns where table_schema='public' and table_name='connection_sessions' and column_name='game_catalog_version'")).rowCount){
    await db.query(await readFile('supabase/migrations/20261023120000_product_experience_catalog.sql','utf8'))
  }
  await db.query(
    await readFile('supabase/tests/connection-privileges.sql', 'utf8'),
  )
  await db.query("notify pgrst,'reload schema'")
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await a.rpc('connection_read', { p_view: 'home' })
    if (!ready.error) break
    if (attempt === 99) throw Error('Connection schema cache unavailable')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const ecWrite = async (
    client,
    action,
    id = null,
    expected = 0,
    payload = {},
    request = randomUUID(),
  ) =>
    check(
      await client.rpc('connection_action', {
        p_action: action,
        p_id: id,
        p_expected: expected,
        p_payload: payload,
        p_request: request,
      }),
      'Connection ' + action,
    )
  const ecRead = async (client, view = 'home', id = null) =>
    check(
      await client.rpc('connection_read', {
        p_view: view,
        p_id: id,
        p_cursor: null,
      }),
      'Read connection',
    ).data
  const ecDay = (await ecRead(a)).today
  await ecWrite(a, 'mood', null, 0, {
    day: ecDay,
    mood: 'calm',
    intensity: 3,
    note: 'local fixture only',
    shared: false,
    support: true,
  })
  assert.equal((await ecRead(b)).partner_mood, null)
  assert.equal(
    check(await b.from('connection_moods').select('*'), 'Mood RLS').length,
    0,
  )
  await ecWrite(a, 'mood', null, 1, {
    day: ecDay,
    mood: 'calm',
    intensity: 3,
    note: 'shared local fixture',
    shared: true,
    support: true,
  })
  await ecWrite(b, 'react', null, 0, { day: ecDay, reaction: 'here' })
  const ecQuiz = await ecWrite(a, 'start_questionnaire', null, 0, {
    catalog: 'support',
  })
  await ecWrite(b, 'accept', ecQuiz.id)
  const ecQ = (await ecRead(a, 'session', ecQuiz.id)).questionnaire
  const ecAnswers = Object.fromEntries(
    ecQ.questions.map((q) => [q.id, q.type === 'scale' ? '4' : 'talk']),
  )
  await ecWrite(a, 'submit', ecQuiz.id, 0, {
    slot: '0',
    answers: ecAnswers,
    publish: true,
  })
  assert.equal((await ecRead(b, 'session', ecQuiz.id)).answers[0].draft, null)
  await ecWrite(b, 'submit', ecQuiz.id, 0, {
    slot: '0',
    answers: ecAnswers,
    publish: true,
  })
  assert.equal(
    (await ecRead(a, 'session', ecQuiz.id)).session.status,
    'completed',
  )
  const ecGameRequest = randomUUID()
  const ecGame = await ecWrite(a, 'start_game', null, 0, {}, ecGameRequest)
  await ecWrite(b, 'accept', ecGame.id)
  await ecWrite(a, 'draw', ecGame.id, 0)
  assert.equal(
    (await ecRead(a, 'session', ecGame.id)).card.id,
    (await ecRead(b, 'session', ecGame.id)).card.id,
  )
  await ecWrite(a, 'save', ecGame.id, 0, {
    slot: '1',
    answers: 'Private fixture',
  })
  assert.equal(
    check(
      await b
        .from('connection_answers')
        .select('*')
        .eq('session_id', ecGame.id),
      'Draft RLS',
    ).length,
    0,
  )
  await ecWrite(a, 'submit', ecGame.id, 1, {
    slot: '1',
    answers: 'Shared fixture',
    publish: true,
  })
  assert.equal((await ecRead(b, 'session', ecGame.id)).answers[0].draft, null)
  await ecWrite(b, 'skip', ecGame.id, 0, { slot: '1' })
  assert.equal(
    (await ecRead(b, 'session', ecGame.id)).answers.find(
      (x) => x.user_id === signup.user.id,
    ).draft,
    'Shared fixture',
  )
  const ecRace = await Promise.all([
    a.rpc('connection_action', {
      p_action: 'draw',
      p_id: ecGame.id,
      p_expected: 1,
      p_payload: {},
      p_request: randomUUID(),
    }),
    b.rpc('connection_action', {
      p_action: 'draw',
      p_id: ecGame.id,
      p_expected: 1,
      p_payload: {},
      p_request: randomUUID(),
    }),
  ])
  assert.equal(ecRace.filter((r) => !r.error).length, 1)
  assert.equal((await ecRead(a, 'session', ecGame.id)).session.position, 2)
  assert.equal((await ecRead(a, 'session', ecGame.id)).session.game_catalog_version,2)
  assert.ok(
    (await a.from('connection_sessions').delete().eq('id', ecGame.id)).error,
  )
  assert.ok((await a.rpc('connection_clock')).error)
  assert.ok((await anon.rpc('connection_read', { p_view: 'home' })).error)
  assert.equal(
    check(await a.rpc('get_statistics'), 'Economy preserved').shared
      .together_xp,
    70,
  )
  step = 'emotional connection withdrawal and completed questionnaire reports'
  await ecWrite(a, 'unpublish', ecQuiz.id, 1, { slot: '0' })
  for (const client of [a, b]) {
    const own = check(await client.auth.getUser(), 'Review account').user.id
    const rows = check(
      await client
        .from('connection_answers')
        .select('*')
        .eq('session_id', ecQuiz.id),
      'Revoked questionnaire RLS',
    )
    assert.ok(rows.every((row) => row.user_id === own))
    assert.ok(
      (await ecRead(client, 'session', ecQuiz.id)).answers.every(
        (row) => row.user_id === own,
      ),
    )
  }
  const gameBeforeClose = await ecRead(a, 'session', ecGame.id)
  assert.equal(gameBeforeClose.remaining, 148)
  await ecWrite(b, 'close', ecGame.id)
  for (const client of [a, b]) {
    const own = check(await client.auth.getUser(), 'Review account').user.id
    assert.ok(
      check(
        await client
          .from('connection_answers')
          .select('*')
          .eq('session_id', ecGame.id),
        'Closed game RLS',
      ).every((row) => row.user_id === own),
    )
    assert.ok(
      (await ecRead(client, 'history', ecGame.id)).items.every((card) =>
        (card.answers ?? []).every((row) => row.user_id === own),
      ),
    )
  }
  console.log(
    'PASS: completed questionnaire withdrawal and closing game history revoke partner answers through real JWT RPC and direct RLS',
  )
  console.log(
    'PASS: emotional check-in privacy, support, independent questionnaire disclosure, shared shuffled game, private drafts, concurrent transition and effective Supabase ACLs',
  )
  const unfinishedGoal = await createGoal()
  check(
    await b.rpc('resolve_goal_consent', {
      p_consent_id: (await pendingGoalConsent(unfinishedGoal)).id,
      p_decision: 'accept',
    }),
    'Activate goal before departure',
  )
  const abandoned = check(
    await a.rpc('propose_goal_change', {
      p_goal_id: unfinishedGoal,
      p_request_id: randomUUID(),
      p_kind: 'pause',
      p_expected_changes: 1,
      p_payload: {},
    }),
    'Pending pause before leave',
  )
  console.log(
    'PASS: goals real JWT/RLS, bilateral consent, shared steps, server progress, concurrent finish +50 once and unchanged Coins',
  )
  const pendingJoint = await createTask('joint')
  check(
    await b.rpc('respond_task', { p_task_id: pendingJoint, p_accept: true }),
    'Accept task before departure',
  )
  const pendingInstance = await taskInstance(pendingJoint)
  step = 'equal partner exit through REST'
  check(await b.rpc('leave_couple_space'), 'Partner may leave independently')
  assert.equal(
    check(
      await b.from('couple_spaces').select('*'),
      'Former space access removed',
    ).length,
    0,
  )
  assert.ok(
    (
      await a.rpc('complete_task_instance', {
        p_instance_id: pendingInstance.id,
      })
    ).error,
    'Departure closes unfinished shared task',
  )
  assert.equal(
    check(
      await b.from('user_progress').select('*').single(),
      'Personal XP survives departure',
    ).xp,
    20,
  )
  assert.equal(
    check(
      await a.from('space_progress').select('*').eq('space_id', space).single(),
      'Historic Together XP survives',
    ).together_xp,
    70,
  )
  assert.equal(
    check(
      await a
        .from('reward_purchases')
        .select('*')
        .eq('id', departurePurchase)
        .single(),
      'Auto refund status',
    ).status,
    'cancelled',
  )
  assert.deepEqual(
    check(await a.rpc('get_coin_summary'), 'Departure refund accounting'),
    { balance: 25, earned: '25', spent: '5', refunded: '5' },
  )
  assert.equal(
    check(
      await b.from('reward_purchases').select('*'),
      'Former purchase visibility',
    ).length,
    0,
  )
  assert.equal(
    check(await b.rpc('get_coin_summary'), 'Departed own accounting').balance,
    5,
  )
  console.log(
    'PASS: departure cancels pending purchases with exact refund, keeps completed spends and hides partner history',
  )
  assert.equal(
    check(
      await a
        .from('couple_goals')
        .select('*')
        .eq('id', unfinishedGoal)
        .single(),
      'Goal closed on exit',
    ).status,
    'closed',
  )
  assert.equal(
    check(
      await a.from('goal_consents').select('*').eq('id', abandoned).single(),
      'Consent void on exit',
    ).status,
    'void',
  )
  assert.equal(
    check(await b.from('couple_goals').select('*'), 'Former member goal access')
      .length,
    0,
  )
  assert.ok(
    (
      await a.rpc('get_joint_history', {
        p_cursor: statisticsPage.next_cursor,
        p_limit: 20,
      })
    ).error,
    'Departure invalidates old history cursor',
  )
  assert.equal(
    check(
      await b.rpc('get_joint_history', { p_cursor: null, p_limit: 20 }),
      'Departed history',
    ).items.length,
    0,
  )
  assert.equal(
    (await ritualList(a, 'closed')).rituals.length,
    0,
    'Missing original partner hides ritual history',
  )
  assert.ok(
    (
      await a.rpc('list_couple_rituals', {
        p_filter: 'active',
        p_cursor: oldRitualCursor,
        p_limit: 20,
      })
    ).error,
    'Departure invalidates ritual cursor',
  )
  assert.equal(
    (
      await db.query('select status from public.ritual_instances where id=$1', [
        unfinishedRitualInstance.id,
      ])
    ).rows[0].status,
    'missed',
  )
  assert.equal(
    (
      await db.query('select status from public.ritual_consents where id=$1', [
        pendingRitualChange,
      ])
    ).rows[0].status,
    'void',
  )
  assert.ok(
    (await a.rpc('connection_read', { p_view: 'session', p_id: ecGame.id }))
      .error,
    'Departure revokes game',
  )
  assert.equal((await ecRead(a)).moods[0].shared, false)
  assert.deepEqual(await ecRead(a, 'request', ecGameRequest), {})
  assert.equal(await ecRead(b, 'request', ecGameRequest), null)
  assert.deepEqual(
    await ecWrite(a, 'start_game', null, 0, {}, ecGameRequest),
    {},
  )
  const rejoinToken = check(
    await a.rpc('create_couple_invitation', { p_email: email('b') }),
    'Invite original partner back',
  )
  check(
    await b.rpc('resolve_couple_invitation', {
      p_token: rejoinToken,
      p_accept: true,
    }),
    'Original partner rejoins',
  )
  assert.ok(
    (
      await b.rpc('propose_goal_change', {
        p_goal_id: unfinishedGoal,
        p_request_id: randomUUID(),
        p_kind: 'resume',
        p_payload: {},
      })
    ).error,
    'Closed goal cannot revive',
  )
  assert.equal(
    check(await b.rpc('get_ritual_summary'), 'Original ritual history returns')
      .completed,
    1,
  )
  assert.ok(
    (
      await b.rpc('propose_ritual_change', {
        p_ritual_id: unfinishedRitual,
        p_request_id: randomUUID(),
        p_kind: 'resume',
        p_terms: {},
        p_expected_changes: 0,
      })
    ).error,
    'Closed ritual never resumes',
  )
  check(await b.rpc('leave_couple_space'), 'Leave disposable pair again')
  const newPartnerToken = check(
    await a.rpc('create_couple_invitation', { p_email: email('c') }),
    'Invite different temporary partner',
  )
  check(
    await c.rpc('resolve_couple_invitation', {
      p_token: newPartnerToken,
      p_accept: true,
    }),
    'New partner joins',
  )
  assert.equal(
    (await ritualList(c, 'closed')).rituals.length,
    0,
    'New partner never reads old ritual titles or UUIDs',
  )
  assert.equal(
    check(await c.rpc('get_ritual_summary'), 'New partner ritual count')
      .completed,
    0,
  )
  assert.equal(
    check(
      await c.rpc('list_ritual_history', { p_cursor: null, p_limit: 20 }),
      'New partner ritual history',
    ).items.length,
    0,
  )
  console.log(
    'PASS: ritual departure closes/voids, same-partner return preserves completed facts without revival, new partner history remains private',
  )
  assert.deepEqual((await ecRead(c, 'sessions')).items, [])
  assert.equal((await ecRead(c)).partner_mood, null)
  assert.ok(
    (await b.rpc('connection_read', { p_view: 'session', p_id: ecQuiz.id }))
      .error,
    'Old membership cannot recover sensitive report',
  )
  const replacementStats = check(
    await c.rpc('get_statistics'),
    'New partner safe statistics',
  )
  assert.equal(replacementStats.shared.together_xp, 70)
  assert.equal(replacementStats.shared.tasks, 0)
  assert.equal(replacementStats.shared.goals, 0)
  assert.equal(replacementStats.shared.xp_series_complete, false)
  assert.equal(
    check(
      await c.rpc('get_joint_history', { p_cursor: null, p_limit: 20 }),
      'New partner private history',
    ).items.length,
    0,
  )
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
    assert.equal(
      check(
        await c.from(table).select('*'),
        'No old goal history for new partner',
      ).length,
      0,
    )
  assert.equal(
    check(
      await c.from('space_progress').select('*').eq('space_id', space).single(),
      'Space keeps historic XP',
    ).together_xp,
    70,
  )
  console.log(
    'PASS: goal closure/void on departure, original rejoin remains closed, new partner sees aggregate XP without private goal history',
  )
  console.log(
    'PASS: independent departure removes API visibility, closes tasks and preserves earned progress',
  )
} catch (error) {
  console.error(`FAIL: ${step} (${error.code ?? error.name ?? 'error'})`)
  if (error.code === 'ERR_ASSERTION')
    console.error(
      error.stack
        ?.split('\n')
        .filter((line) => line.includes('test-supabase.mjs:'))
        .join('\n'),
    )
  process.exitCode = 1
} finally {
  let cleanupFailed = false
  for (const id of created) {
    try {
      if ((await admin.auth.admin.deleteUser(id)).error) cleanupFailed = true
    } catch {
      cleanupFailed = true
    }
  }
  if (cleanupFailed) {
    console.error('FAIL: cleanup of own temporary local Auth users')
    process.exitCode = 1
  } else console.log('PASS: cleanup of own temporary local Auth users')
  for (const sdk of [admin, a, b, c, anon, d]) sdk.auth.stopAutoRefresh()
  await db.end()
  delete globalThis.window
}
