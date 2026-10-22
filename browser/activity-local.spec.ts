// Opt-in own disposable local Supabase only. Real Auth sessions, never mocked users.
import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'

test('real pair: events, private answers, receipts, reactions, offline, themes and membership revocation', async ({
  browser,
}, testInfo) => {
  const path = process.env.KOLO_ACTIVITY_STATUS_FILE
  if (!path)
    throw Error('Provide only your own disposable local Supabase status file')
  const status = JSON.parse(await readFile(path, 'utf8')),
    url = new URL(status.API_URL)
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname)
  expect(url.protocol).toBe('http:')
  const opts = { auth: { persistSession: false, autoRefreshToken: false } },
    admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, opts)
  const users: string[] = [],
    clients: SupabaseClient[] = [],
    contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [],
    sessions: unknown[] = []
  const ok = (r: { data: unknown; error: { code?: string } | null }) => {
    if (r.error) throw Error('Local SDK operation failed: ' + r.error.code)
    return r.data as any
  }
  const activity = async (i: number) =>
    ok(await clients[i].rpc('list_couple_activity', { p_limit: 20 })).items as {
      id: string
      kind: string
      source_id: string
      read_at: string | null
    }[]
  const action = async (
    i: number,
    type: string,
    id: string | null = null,
    expected = 0,
    payload: object = {},
  ) =>
    ok(
      await clients[i].rpc('connection_action', {
        p_action: type,
        p_id: id,
        p_expected: expected,
        p_payload: payload,
        p_request: randomUUID(),
      }),
    )
  try {
    for (let i = 0; i < 2; i++) {
      const email = `kolo-activity-${randomUUID()}@example.test`,
        password = 'Kolo-' + randomUUID() + 'aA1!'
      const user = ok(
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        }),
      ).user
      users.push(user.id)
      const c = createClient(status.API_URL, status.ANON_KEY, opts),
        session = ok(
          await c.auth.signInWithPassword({ email, password }),
        ).session
      clients.push(c)
      sessions.push(session)
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: 'reduce',
      })
      contexts.push(context)
      await context.addInitScript(
        ({ key, session }) =>
          localStorage.setItem(key, JSON.stringify(session)),
        { key: 'sb-' + url.hostname.split('.')[0] + '-auth-token', session },
      )
    }
    ok(await clients[0].rpc('create_couple_space'))
    const token = ok(
      await clients[0].rpc('create_couple_invitation', {
        p_email: (sessions[1] as any).user.email,
      }),
    )
    ok(
      await clients[1].rpc('resolve_couple_invitation', {
        p_token: token,
        p_accept: true,
      }),
    )
    const taskPayload = {
      p_request_id: randomUUID(),
      p_title: 'Вечір для нас двох',
      p_description: 'Лише власні локальні тестові дані',
      p_kind: 'joint',
      p_category: 'time',
      p_difficulty: 'normal',
      p_due_date: null,
      p_recurrence: 'once',
    }
    const task = ok(await clients[0].rpc('create_task', taskPayload))
    const before = await activity(1)
    expect(
      (
        await clients[0].rpc('create_task', {
          ...taskPayload,
          p_request_id: randomUUID(),
          p_title: '',
        })
      ).error,
    ).toBeTruthy()
    expect(await activity(1)).toEqual(before)
    const a = await contexts[0].newPage(),
      b = await contexts[1].newPage()
    await Promise.all([
      a.goto('http://127.0.0.1:4174/activity'),
      b.goto('http://127.0.0.1:4174/activity'),
    ])
    await expect(
      b.getByText('Вечір для нас двох', { exact: true }),
    ).toBeVisible()
    await expect(a.getByText('Поки тихо й затишно')).toBeVisible()
    await expect(
      b.getByRole('link', { name: /Події пари: 1 непрочитаних/ }),
    ).toBeVisible()
    await b.getByRole('button', { name: 'Пишаюся', exact: true }).focus()
    await b.keyboard.press('Space')
    await expect(
      b.getByRole('button', { name: 'Пишаюся', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await a.reload()
    await expect(a.getByText('Трохи тепла від партнера')).toBeVisible()
    await a.getByRole('button', { name: 'Переглянути', exact: true }).click()
    await expect(a).toHaveURL(/\/tasks$/)
    expect((await activity(1))[0].read_at).toBeNull()
    await a.goto('http://127.0.0.1:4174/activity')
    await expect(
      a.getByRole('group', { name: 'Підтримати партнера' }),
    ).toHaveCount(0)
    await b.getByRole('button', { name: 'Прочитано', exact: true }).click()
    await expect
      .poll(async () => ok(await clients[1].rpc('activity_summary')).unread)
      .toBe(0)
    expect(ok(await clients[0].rpc('activity_summary')).unread).toBe(0)
    await b.getByRole('button', { name: 'Дякую', exact: true }).click()
    await expect(
      b.getByRole('button', { name: 'Дякую', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await b.getByRole('button', { name: 'Дякую', exact: true }).click()
    await expect(
      b.getByRole('button', { name: 'Дякую', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
    await a.reload()
    await expect(a.getByText('Поки тихо й затишно')).toBeVisible()
    await b.getByRole('button', { name: 'Підтримую', exact: true }).click()
    await expect(
      b.getByRole('button', { name: 'Підтримую', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await a.reload()
    const menu = a.getByRole('button', { name: 'Налаштування подій' })
    await menu.focus()
    await a.keyboard.press('Enter')
    await a
      .getByRole('button', { name: 'Вимкнути сповіщення про реакції' })
      .click()
    await a.keyboard.press('Escape')
    await expect(a.getByText('Поки тихо й затишно')).toBeVisible()
    await contexts[1].setOffline(true)
    await expect(b.getByText(/Зараз немає зв’язку/)).toBeVisible()
    await expect(b.locator('.activity-card')).toHaveCount(0)
    await contexts[1].setOffline(false)
    await expect(
      b.getByText('Вечір для нас двох', { exact: true }),
    ).toBeVisible()
    expect((await activity(0)).length).toBe(0)
    await b.getByRole('button', { name: 'Переглянути справу' }).click()
    await expect(b).toHaveURL(/\/tasks$/)
    ok(
      await clients[1].rpc('respond_task', { p_task_id: task, p_accept: true }),
    )
    const instance = ok(
      await clients[0]
        .from('task_instances')
        .select('id')
        .eq('task_id', task)
        .single(),
    ).id
    const results = await Promise.all(
      clients.map((c) =>
        c.rpc('complete_task_instance', { p_instance_id: instance }),
      ),
    )
    results.forEach(ok)
    expect(
      (await activity(0)).filter((e) => e.kind === 'task_done'),
    ).toHaveLength(1)
    expect(
      (await activity(1)).filter((e) => e.kind === 'task_done'),
    ).toHaveLength(1)
    const game = (await action(0, 'start_game')).id
    await action(1, 'accept', game)
    await action(0, 'draw', game)
    await action(0, 'submit', game, 0, {
      slot: '1',
      answers: 'Нерозкритий локальний текст',
      publish: true,
    })
    expect(
      (await activity(1)).some(
        (e) => e.kind === 'connection_ready' && e.source_id === game,
      ),
    ).toBe(false)
    await action(1, 'skip', game, 0, { slot: '1' })
    expect(
      (await activity(1)).some(
        (e) => e.kind === 'connection_ready' && e.source_id === game,
      ),
    ).toBe(true)
    await mkdir('docs/screenshots/pr10', { recursive: true })
    for (const width of [360, 390, 1280])
      for (const dark of [false, true]) {
        await b.setViewportSize({ width, height: 960 })
        await b.evaluate(
          (d) => localStorage.setItem('kolo-theme', d ? 'dark' : 'light'),
          dark,
        )
        await b.goto('http://127.0.0.1:4174/activity')
        await expect(
          b.getByText('Ваша розмова готова до перегляду'),
        ).toBeVisible()
        await expect(
          b.getByText('Нерозкритий локальний текст', { exact: true }),
        ).toHaveCount(0)
        expect(
          await b.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        expect(
          (
            await new AxeBuilder({ page: b })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze()
          ).violations,
        ).toEqual([])
        if (width !== 360)
          await b.screenshot({
            path: `docs/screenshots/pr10/inbox-${testInfo.project.name}-${width}-${dark ? 'dark' : 'light'}.png`,
          })
      }
    await action(0, 'unpublish', game, 1, { slot: '1' })
    for (const c of clients)
      expect(
        ok(
          await c
            .from('couple_activity_events')
            .select('id')
            .eq('source_id', game),
        ),
      ).toHaveLength(0)
    await b.reload()
    await expect(b.getByText('Ваша розмова готова до перегляду')).toHaveCount(0)
    ok(await clients[1].rpc('leave_couple_space'))
    for (const page of [a, b]) {
      await page.goto('http://127.0.0.1:4174/activity')
      await expect(page.getByText('Поки тихо й затишно')).toBeVisible()
      await expect(page.locator('.activity-card')).toHaveCount(0)
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
    for (const id of users) ok(await admin.auth.admin.deleteUser(id))
  }
})
