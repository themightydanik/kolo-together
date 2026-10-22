import { test, expect } from '@playwright/test'
// Local readonly demo only. Authenticated two-account flow is a separate local Supabase runner.
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByText('Демо · знакомство с KOLO Together.'),
  ).toBeVisible()
})
test('card front/back are independent, readable and never mirrored', async ({
  page,
}) => {
  await page.goto('/us/connection/game')
  const card = page.locator('.romantic-card'),
    front = page.locator('.romantic-front'),
    back = page.locator('.romantic-back')
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await expect(front).toHaveAttribute('aria-hidden', 'false')
  await expect(back).toHaveCSS('visibility', 'hidden')
  await expect(card).toHaveScreenshot('card-front.png')
  const question = await page.locator('.romantic-question').textContent()
  await card.click()
  await expect(back).toHaveAttribute('aria-hidden', 'false')
  await expect(front).toHaveCSS('visibility', 'hidden')
  await expect(front).toHaveAttribute('aria-hidden', 'true')
  expect(await back.textContent()).not.toContain(question!)
  await expect(back.getByText('Давай, про нас')).toBeVisible()
  const rotation = await page.evaluate(() => {
    const inner = new DOMMatrix(
        getComputedStyle(document.querySelector('.romantic-card-inner')!)
          .transform,
      ),
      back = new DOMMatrix(
        getComputedStyle(document.querySelector('.romantic-back')!).transform,
      )
    return { inner: inner.a, back: back.a, visible: inner.multiply(back).a }
  })
  expect(rotation.inner).toBeCloseTo(-1)
  expect(rotation.back).toBeCloseTo(-1)
  expect(rotation.visible).toBeCloseTo(1)
  await expect(card).toHaveScreenshot('card-back.png')
  await page.locator('.romantic-flip-trigger').focus()
  await page.keyboard.press('Space')
  await expect(page.locator('.romantic-flip-trigger')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})
test('all five sections have one clear heading, five tabs and correct child navigation', async ({
  page,
}) => {
  for (const [path, title] of [
    ['/', 'Сегодня'],
    ['/tasks', 'Дела'],
    ['/goals', 'Цели'],
    ['/rewards', 'Награды'],
    ['/us', 'Мы'],
  ]) {
    await page.goto(path)
    await expect(
      page.getByRole('heading', { level: 1, name: title, exact: true }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('link'),
    ).toHaveCount(5)
  }
  for (const path of [
    '/us/history',
    '/us/traditions',
    '/us/settings',
    '/us/connection/game',
    '/us/connection/questionnaires',
    '/us/connection/mood',
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(
      page.getByRole('link', { name: 'Назад', exact: true }),
    ).toBeVisible()
  }
})
test('mobile and desktop in both themes, long question, reduced motion, no horizontal overflow', async ({
  page,
}) => {
  for (const width of [360, 390, 768, 1280])
    for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/us/connection/game')
      await page.evaluate(
        (d) => localStorage.setItem('kolo-theme', d ? 'dark' : 'light'),
        dark,
      )
      await page.reload()
      await expect(page.locator('html')).toHaveClass(dark ? 'dark' : '')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      const metrics = await page
        .locator('.romantic-question')
        .evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }))
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.client)
      expect(
        await page
          .locator('.romantic-card-inner')
          .evaluate((el) => getComputedStyle(el).transitionDuration),
      ).toBe('0s')
      for (const path of ['/', '/tasks', '/goals', '/rewards', '/us']) {
        await page.goto(path)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
      }
    }
})
test('context menu supports keyboard, Escape, focus restoration and theme', async ({
  page,
}) => {
  await page.goto('/us/connection/game')
  const trigger = page.getByRole('button', { name: 'Про гру' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Про гру' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Про гру' })).not.toBeVisible()
  await expect(trigger).toBeFocused()
})

test('screen-reader semantics and WCAG A/AA checks on all main sections', async ({
  page,
}) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  for (const path of [
    '/',
    '/tasks',
    '/goals',
    '/rewards',
    '/us',
    '/us/connection/game',
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([])
  }
})

test('ritual demo remains readonly in both themes with a dedicated traditions destination', async ({
  page,
}) => {
  for (const dark of [false, true]) {
    await page.evaluate(
      (d) => localStorage.setItem('kolo-theme', d ? 'dark' : 'light'),
      dark,
    )
    await page.goto('/us/traditions')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Наші традиції' }),
    ).toBeVisible()
    await expect(
      page.getByText(/Серверных согласий и отметок здесь нет/),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Отметить своё участие/ }),
    ).toHaveCount(0)
    await expect(
      page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('link'),
    ).toHaveCount(5)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.goto('/')
    await expect(
      page.getByRole('button', { name: /Отметить своё участие/ }),
    ).toHaveCount(0)
  }
})
