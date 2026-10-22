import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { serveMemoryHandler } from '../scripts/memory-file-adapter.mjs'

test('real pair album: native file service, two photos, notes, replacement/cancel, consent, offline and epoch privacy', async ({
  browser,
}, info) => {
  const path = process.env.KOLO_MEMORY_STATUS_FILE
  if (!path) throw Error('Own local status file required')
  const s = JSON.parse(await readFile(path, 'utf8'))
  expect(['127.0.0.1', 'localhost']).toContain(new URL(s.API_URL).hostname)
  const opts = { auth: { persistSession: false, autoRefreshToken: false } },
    admin = createClient(s.API_URL, s.SERVICE_ROLE_KEY, opts),
    users: string[] = [],
    clients: any[] = [],
    contexts: any[] = [],
    session: any[] = [],
    files = await serveMemoryHandler(s)
  const ok = (r: any) => {
    if (r.error) throw Error('Local memory operation ' + r.error.code)
    return r.data
  }
  const act = async (
    i: number,
    action: string,
    id: string | null = null,
    expected = 0,
    payload: object = {},
  ) =>
    ok(
      await clients[i].rpc('memory_action', {
        p_action: action,
        p_id: id,
        p_expected: expected,
        p_payload: payload,
        p_request: randomUUID(),
      }),
    )
  try {
    for (let i = 0; i < 2; i++) {
      const email = `kolo-album-${randomUUID()}@example.test`,
        password = 'Kolo-' + randomUUID() + 'aA1!'
      users.push(
        ok(
          await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          }),
        ).user.id,
      )
      const c = createClient(s.API_URL, s.ANON_KEY, opts)
      clients.push(c)
      session.push(
        ok(await c.auth.signInWithPassword({ email, password })).session,
      )
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 960 },
        reducedMotion: 'reduce',
      })
      contexts.push(ctx)
      await ctx.addInitScript(
        ({ key, value }: any) =>
          localStorage.setItem(key, JSON.stringify(value)),
        {
          key:
            'sb-' + new URL(s.API_URL).hostname.split('.')[0] + '-auth-token',
          value: session[i],
        },
      )
      await ctx.route('**/functions/v1/memory-files', async (route: any) => {
        // Continue in the real browser: WebKit route.fetch omits multipart file bytes.
        await route.continue({ url: files.url })
      })
    }
    ok(await clients[0].rpc('create_couple_space'))
    ok(
      await clients[1].rpc('resolve_couple_invitation', {
        p_token: ok(
          await clients[0].rpc('create_couple_invitation', {
            p_email: session[1].user.email,
          }),
        ),
        p_accept: true,
      }),
    )
    const a = await contexts[0].newPage(),
      b = await contexts[1].newPage()
    await a.goto('http://127.0.0.1:4174/us/history')
    await expect(a.getByText('Ваша історія починається з малого')).toBeVisible()
    await a.getByRole('button', { name: 'Додати спогад' }).click()
    await expect(
      a.getByRole('textbox', { name: 'Назва', exact: true }),
    ).toBeVisible()
    const id = new URL(a.url()).pathname.split('/').at(-1)!
    await a
      .getByRole('textbox', { name: 'Назва', exact: true })
      .fill('Наш день біля води')
    await a.getByLabel('Дата моменту').fill('2026-06-21')
    await a
      .getByLabel(/Твоя історія/)
      .fill('Ми нікуди не поспішали. Тільки вода, небо і ми.')
    // Generate a simple non-personal camera fixture with real browser canvas, no external images.
    const png = Buffer.from(
      await a.evaluate(() => {
        const c = document.createElement('canvas')
        c.width = 800
        c.height = 600
        const x = c.getContext('2d')!
        x.fillStyle = '#d9cbc3'
        x.fillRect(0, 0, 800, 600)
        x.fillStyle = '#8ba4a2'
        x.fillRect(0, 290, 800, 310)
        x.fillStyle = '#f3dfb9'
        x.beginPath()
        x.arc(600, 140, 55, 0, Math.PI * 2)
        x.fill()
        return c.toDataURL('image/png').split(',')[1]
      }),
      'base64',
    )
    for (let i = 0; i < 2; i++) {
      await a.locator('input[type=file]').setInputFiles({
        name: 'fixture.png',
        mimeType: 'image/png',
        buffer: png,
      })
      await expect(a.locator('.memory-editor-photos img')).toHaveCount(i + 1)
    }
    await b.goto('http://127.0.0.1:4174/us/history')
    await expect(b.getByText('Ваша історія починається з малого')).toBeVisible()
    await a.getByLabel('Опублікувати для нас обох').check()
    await expect(
      a.getByRole('button', { name: 'Зберегти спогад' }),
    ).toBeDisabled()
    await a
      .getByLabel('Підтверджую публікацію мого тексту й цих фото для партнера')
      .check()
    // Real time (not a fake clock): multiple 10s detail + 15s membership polls.
    // Sample every animation frame: an attached-but-hidden editor must also fail.
    await a.getByLabel('Категорія').selectOption('travel')
    const story = a.getByLabel(/Твоя історія/)
    await story.focus()
    const counters = { detail: 0, couple: 0 }
    a.on('request', (request) => {
      if (request.url().includes('/rpc/memory_detail')) counters.detail++
      if (request.url().includes('/rest/v1/couple_members')) counters.couple++
    })
    await a.evaluate(() => {
      const editor = document.querySelector('.memory-editor')!,
        field = editor.querySelector('textarea') as HTMLTextAreaElement
      const photos = Array.from(editor.querySelectorAll('img'))
      const photoSources = photos.map((img) => img.src)
      const audit = ((window as any).memoryAudit = {
        editor,
        field,
        photos,
        frames: 0,
        failures: [] as string[],
        running: true,
      })
      const frame = () => {
        if (!audit.running) return
        audit.frames++
        const fail = (reason: string) => {
          if (audit.failures.length < 20) audit.failures.push(reason)
        }
        if (
          !editor.isConnected ||
          document.querySelector('.memory-editor') !== editor
        )
          fail('editor remounted')
        let ancestor: Element | null = field
        while (ancestor) {
          const css = getComputedStyle(ancestor)
          if (
            css.display === 'none' ||
            css.visibility === 'hidden' ||
            css.opacity === '0'
          )
            fail('editor hidden')
          ancestor = ancestor.parentElement
        }
        if (!field.getClientRects().length)
          fail('field has no visible rectangle')
        if (document.hasFocus() && document.activeElement !== field)
          fail('focus stolen')
        for (const [index, img] of photos.entries()) {
          if (!img.isConnected) fail('photo remounted')
          if (img.src !== photoSources[index]) fail('photo bytes reloaded')
        }
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    let longStory = 'Ми нікуди не поспішали. Тільки вода, небо і ми.'
    const started = Date.now()
    for (let i = 0; i < 13; i++) {
      const suffix = ' Ще одна тиха мить ' + i + '.'
      await story.press('End')
      await story.pressSequentially(suffix, { delay: 15 })
      longStory += suffix
      const caret = await story.evaluate(
        (el) => (el as HTMLTextAreaElement).selectionStart,
      )
      await a.waitForTimeout(4600)
      await expect(story).toBeVisible()
      await expect(story).toBeFocused()
      await expect(story).toHaveValue(longStory)
      expect(
        await story.evaluate(
          (el) => (el as HTMLTextAreaElement).selectionStart,
        ),
      ).toBe(caret)
      await expect(a.getByLabel('Дата моменту')).toHaveValue('2026-06-21')
      await expect(a.getByLabel('Категорія')).toHaveValue('travel')
      await expect(
        a.getByRole('textbox', { name: 'Назва', exact: true }),
      ).toHaveValue('Наш день біля води')
      await expect(
        a.getByLabel(
          'Підтверджую публікацію мого тексту й цих фото для партнера',
        ),
      ).toBeChecked()
      if (i === 5) {
        await b.bringToFront()
        await b.waitForTimeout(500)
        await a.bringToFront()
        await a.evaluate(() => window.dispatchEvent(new Event('focus')))
        await expect(story).toBeFocused()
      }
    }
    expect(Date.now() - started).toBeGreaterThan(60000)
    expect(counters.detail).toBeGreaterThanOrEqual(5)
    expect(counters.couple).toBeGreaterThanOrEqual(3)
    const audit = await a.evaluate(() => {
      const audit = (window as any).memoryAudit
      audit.running = false
      return { frames: audit.frames, failures: audit.failures }
    })
    expect(audit.frames).toBeGreaterThan(300)
    expect(audit.failures).toEqual([])
    console.log(
      info.project.name,
      'continuous editor',
      Date.now() - started,
      'ms;',
      counters,
      audit.frames,
      'visible frames; zero remounts',
    )
    await b.evaluate(() => {
      const root = document.querySelector('.memory-album')!
      const audit = ((window as any).albumAudit = {
        failures: [] as string[],
        running: true,
        frames: 0,
      })
      const frame = () => {
        if (!audit.running) return
        audit.frames++
        if (!root.isConnected || root.querySelector('[hidden]'))
          audit.failures.push('album hidden or remounted')
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    await a.getByRole('button', { name: 'Зберегти спогад' }).click()
    await expect(a.locator('.memory-gallery img')).toHaveCount(2)
    await expect(
      b.getByText('Наш день біля води', { exact: true }),
    ).toBeVisible({ timeout: 20000 })
    const albumAudit = await b.evaluate(() => {
      const audit = (window as any).albumAudit
      audit.running = false
      return { frames: audit.frames, failures: audit.failures }
    })
    expect(albumAudit.frames).toBeGreaterThan(10)
    expect(albumAudit.failures).toEqual([])
    const viewerRoot = await a.locator('.memory-full').elementHandle()
    const viewerPhotos = await a.locator('.memory-gallery img').elementHandles()

    await b.goto('http://127.0.0.1:4174/us/history/' + id)
    await expect(b.getByText(longStory, { exact: true })).toBeVisible()
    await expect(b.locator('.memory-gallery img')).toHaveCount(2)
    await expect
      .poll(() =>
        b
          .locator('.memory-gallery img')
          .evaluateAll((images) =>
            images.every((img) => (img as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true)
    await b
      .getByRole('textbox', { name: 'Твоя особиста нотатка' })
      .fill('Мій улюблений спогад цього літа')
    await b.getByRole('button', { name: 'Зберегти мою нотатку' }).click()
    await expect(
      b.getByText('Мій улюблений спогад цього літа', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      a.getByText('Мій улюблений спогад цього літа', { exact: true }),
    ).toBeVisible({ timeout: 20000 })
    expect(await viewerRoot!.evaluate((node) => node.isConnected)).toBe(true)
    for (const photo of viewerPhotos)
      expect(
        await photo.evaluate(
          (node) =>
            node.isConnected && getComputedStyle(node).visibility === 'visible',
        ),
      ).toBe(true)
    await a.getByRole('button', { name: 'Дії зі спогадом' }).click()
    await a.getByRole('button', { name: 'Редагувати мій спогад' }).click()
    await a
      .getByRole('textbox', { name: 'Назва', exact: true })
      .fill('Не зберігати цю зміну')
    await a
      .getByRole('button', { name: 'Прибрати фото зі спогаду' })
      .first()
      .click()
    const localTitle = a.getByRole('textbox', { name: 'Назва', exact: true })
    const originalTitleNode = await localTitle.elementHandle()
    await b
      .getByRole('textbox', { name: 'Твоя особиста нотатка' })
      .fill('Нова нотатка під час редагування')
    await b.getByRole('button', { name: 'Зберегти мою нотатку' }).click()
    await a.waitForResponse(
      (response) =>
        response.url().includes('/rpc/memory_detail') &&
        response.status() === 200,
    )
    await expect(localTitle).toBeVisible()
    await expect(localTitle).toHaveValue('Не зберігати цю зміну')
    expect(
      await originalTitleNode!.evaluate(
        (node) => node === document.querySelector('.memory-editor input'),
      ),
    ).toBe(true)
    await expect(a.locator('.memory-editor-photos img')).toHaveCount(1)
    const concurrent = ok(await clients[0].rpc('memory_detail', { p_id: id }))
    await act(0, 'save', id, concurrent.memory.version, {
      title: concurrent.memory.title,
      date: concurrent.memory.event_date,
      story: concurrent.memory.story,
      category: concurrent.memory.category,
      photos: concurrent.photos
        .filter((p: any) => p.position !== null)
        .map((p: any) => p.id),
      publish: true,
      confirmed: true,
    })
    await expect(a.getByText(/Спогад змінився в іншому вікні/)).toBeVisible({
      timeout: 20000,
    })
    await expect(localTitle).toHaveValue('Не зберігати цю зміну')
    expect(
      await originalTitleNode!.evaluate(
        (node) => node === document.querySelector('.memory-editor input'),
      ),
    ).toBe(true)

    await a.getByRole('button', { name: 'Скасувати зміни' }).click()
    await expect(
      a.getByRole('heading', { level: 1, name: 'Наш день біля води' }),
    ).toBeVisible()
    await expect(a.locator('.memory-gallery img')).toHaveCount(2)
    await mkdir('docs/screenshots/pr11', { recursive: true })
    for (const width of [360, 390, 1280])
      for (const dark of [false, true]) {
        await b.setViewportSize({ width, height: 960 })
        await b.evaluate(
          (d) => localStorage.setItem('kolo-theme', d ? 'dark' : 'light'),
          dark,
        )
        await b.goto('http://127.0.0.1:4174/us/history')
        await expect(b.locator('.memory-album-card img')).toHaveCount(1)
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
            path: `docs/screenshots/pr11/album-${info.project.name}-${width}-${dark ? 'dark' : 'light'}.png`,
          })
      }
    await b.goto('http://127.0.0.1:4174/us/history/' + id)
    await expect(b.locator('.memory-gallery img')).toHaveCount(2)
    await contexts[1].setOffline(true)
    await expect(b.getByText(/Зараз немає зв’язку. Збережені/)).toBeVisible()
    await expect(b.locator('.memory-gallery img')).toHaveCount(0)
    await contexts[1].setOffline(false)
    await expect(b.locator('.memory-gallery img')).toHaveCount(2)
    const d = ok(await clients[0].rpc('memory_detail', { p_id: id }))
    await act(0, 'withdraw', id, d.memory.version)
    await b.reload()
    await expect(
      b.getByText('Нова нотатка під час редагування', { exact: true }),
    ).toBeVisible()
    await expect(
      b.getByText('Наш день біля води', { exact: true }),
    ).toHaveCount(0)
    await expect(b.locator('.memory-gallery img')).toHaveCount(0)
    ok(await clients[1].rpc('leave_couple_space'))
    for (const page of [a, b]) {
      await page.goto('http://127.0.0.1:4174/us/history/' + id)
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(
        page.getByText('Нова нотатка під час редагування', { exact: true }),
      ).toHaveCount(0)
    }
  } finally {
    for (let i = 0; i < session.length; i++)
      await fetch(files.url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session[i].access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'cleanup' }),
      }).catch(() => {})
    await Promise.all(contexts.map((c) => c.close()))
    for (const id of users) ok(await admin.auth.admin.deleteUser(id))
    await files.close()
  }
})
