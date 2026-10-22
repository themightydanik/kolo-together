// Local, newly created accounts ONLY. Pass own disposable Supabase CLI status file.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createClient } from '@supabase/supabase-js'
import { localBrowser } from './local-browser.mjs'
const status = JSON.parse(await readFile(process.argv[2], 'utf8')),
  origin = new URL(process.argv[3] ?? 'http://127.0.0.1:4174')
for (const url of [origin, new URL(status.API_URL)])
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      url.protocol === 'http:',
    'Loopback only',
  )
const opts = { auth: { persistSession: false, autoRefreshToken: false } },
  admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, opts),
  clients = [],
  sessions = [],
  owned = [],
  browsers = [],
  run = randomUUID(),
  password = 'Kolo-' + run + 'aA1!'
const check = (r) => {
  if (r.error) throw Error('Local SDK operation failed: ' + r.error.code)
  return r.data
}
const artifacts = await mkdtemp(join(tmpdir(), 'kolo-connection-accounts-'))
try {
  for (let i = 0; i < 2; i++) {
    const email = `kolo-browser-${run}-${i}@example.test`,
      user = check(
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        }),
      ).user
    owned.push(user.id)
    const c = createClient(status.API_URL, status.ANON_KEY, opts),
      session = check(
        await c.auth.signInWithPassword({ email, password }),
      ).session
    clients.push(c)
    sessions.push(session)
  }
  check(await clients[0].rpc('create_couple_space'))
  const token = check(
    await clients[0].rpc('create_couple_invitation', {
      p_email: sessions[1].user.email,
    }),
  )
  check(
    await clients[1].rpc('resolve_couple_invitation', {
      p_token: token,
      p_accept: true,
    }),
  )
  for (let i = 0; i < 2; i++) {
    const b = await localBrowser()
    browsers.push(b)
    await b.call('Page.navigate', { url: origin.origin + '/auth/login' })
    await b.until('!!document.querySelector("main")')
    const storageKey =
      'sb-' + new URL(status.API_URL).hostname.split('.')[0] + '-auth-token'
    await b.evaluate(
      `localStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(JSON.stringify(sessions[i]))})`,
    )
    await b.call('Page.navigate', {
      url: origin.origin + '/us/connection/game',
    })
    await b.until(
      `document.querySelector('main')?.textContent.includes('Почати гру')`,
    )
    assert.ok(
      !(await b.evaluate(
        `document.querySelector('main').textContent.includes('Демонстрація')`,
      )),
      'Requires local configured build, not demo',
    )
  }
  const [a, b] = browsers
  for (const browser of browsers) {
    for (const [path, title] of [
      ['/', 'Сегодня'],
      ['/tasks', 'Дела'],
      ['/goals', 'Цели'],
      ['/rewards', 'Награды'],
      ['/us', 'Мы'],
    ]) {
      await browser.call('Page.navigate', { url: origin.origin + path })
      await browser.until(
        `document.querySelector('h1')?.textContent===${JSON.stringify(title)}`,
      )
    }
  }
  await a.call('Page.navigate', { url: origin.origin + '/us/connection/game' })
  await a.until(
    `document.querySelector('main')?.textContent.includes('Почати гру')`,
  )

  // PR10: confirmed source actions only; these are our own new local fixtures.
  for (const title of ['Прогулятися разом', 'Обрати фільм для вечора'])
    check(
      await clients[0].rpc('create_task', {
        p_request_id: randomUUID(),
        p_title: title,
        p_description: '',
        p_kind: 'joint',
        p_category: 'time',
        p_difficulty: 'normal',
        p_due_date: null,
        p_recurrence: 'once',
      }),
    )
  await a.click('Почати гру')
  await a.until(
    `Array.from(document.querySelectorAll('a')).some(a=>a.getAttribute('href')?.startsWith('/us/connection/session/'))`,
  )
  const path = await a.evaluate(
      `Array.from(document.querySelectorAll('a')).find(a=>a.getAttribute('href')?.startsWith('/us/connection/session/')).getAttribute('href')`,
    ),
    id = path.split('/').at(-1)
  await b.call('Page.navigate', { url: origin.origin + '/activity' })
  await b.until(
    `Array.from(document.querySelectorAll('button')).some(x=>x.textContent.includes('Переглянути запрошення'))`,
  )
  const received = check(
    await clients[1].rpc('list_couple_activity', { p_limit: 20 }),
  ).items
  const invitation = received.find(
    (e) => e.kind === 'connection_invite' && e.source_id === id,
  )
  assert.ok(invitation)
  await b.evaluate(
    `document.querySelector('button[aria-label="Підтримую"]').click()`,
  )
  await b.until(
    `document.querySelector('button[aria-label="Підтримую"]')?.getAttribute('aria-pressed')==='true'`,
  )
  assert.equal(
    check(
      await clients[0].rpc('list_couple_activity', { p_limit: 20 }),
    ).items.filter((e) => e.kind === 'reaction').length,
    1,
  )
  // Exercise real browser offline/reconnect; reconnect never queues a reaction.
  await b.call('Network.enable')
  await b.call('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  })
  await b.until(
    `document.querySelector('main')?.textContent.includes('Зараз немає зв’язку')`,
  )
  assert.equal(
    await b.evaluate(`!!document.querySelector('.activity-card')`),
    false,
  )
  await b.call('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  await b.until(`!!document.querySelector('.activity-card')`)
  assert.equal(
    check(
      await clients[0].rpc('list_couple_activity', { p_limit: 20 }),
    ).items.filter((e) => e.kind === 'reaction').length,
    1,
  )
  for (const width of [390, 1280])
    for (const dark of [false, true]) {
      await b.call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 960,
        deviceScaleFactor: 1,
        mobile: width < 500,
      })
      await b.evaluate(
        `localStorage.setItem('kolo-theme','${dark ? 'dark' : 'light'}')`,
      )
      await b.call('Page.reload')
      await b.until(`!!document.querySelector('.activity-card')`)
      assert.equal(
        await b.evaluate('document.documentElement.scrollWidth<=innerWidth'),
        true,
      )
      const shot = await b.call('Page.captureScreenshot', { format: 'png' })
      await writeFile(
        join(artifacts, `activity-${width}-${dark ? 'dark' : 'light'}.png`),
        Buffer.from(shot.data, 'base64'),
      )
    }
  await b.call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await b.click('Переглянути запрошення')
  assert.ok(
    check(
      await clients[1].rpc('list_couple_activity', { p_limit: 20 }),
    ).items.find((e) => e.id === invitation.id).read_at,
  )
  await b.click('Прийняти запрошення')
  await a.call('Page.navigate', { url: origin.origin + path })
  await a.click('Витягнути першу картку')
  await a.until(
    `document.querySelector('.game-counter')?.textContent.replaceAll(' ','')==='1/150'`,
  )
  await b.evaluate('sessionStorage.clear()')
  await b.call('Page.reload')
  await b.until(
    `document.querySelector('.game-counter')?.textContent.replaceAll(' ','')==='1/150'`,
  )
  assert.equal(
    await a.evaluate(
      `document.querySelector('.romantic-question').textContent`,
    ),
    await b.evaluate(
      `document.querySelector('.romantic-question').textContent`,
    ),
  )
  await b.call('Page.navigate', { url: origin.origin + '/us' })
  await b.until(`document.querySelector('h1')?.textContent==='Мы'`)
  await a.evaluate(
    `document.querySelector('button[aria-label="Надіслати партнеру"]').click()`,
  )
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      check(await clients[1].rpc('connection_read', { p_view: 'home' })).data
        .events.length
    )
      break
    await new Promise((r) => setTimeout(r, 50))
    if (attempt === 99) throw Error('View invitation not recorded')
  }
  await b.call('Page.navigate', { url: origin.origin + path + '?card=1' })
  await b.until(`!!document.querySelector('.romantic-card')`)
  await b.evaluate(
    `document.querySelector('.romantic-card').scrollIntoView({block:'center'})`,
  )
  for (let attempt = 0; attempt < 150; attempt++) {
    if (
      check(await clients[1].rpc('connection_read', { p_view: 'home' })).data
        .events.length === 0
    )
      break
    await new Promise((r) => setTimeout(r, 50))
    if (attempt === 149) throw Error('Visible invitation was not acknowledged')
  }
  assert.equal(
    await b.evaluate(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Позначити запрошення'))`,
    ),
    false,
  )
  const answer = 'Нова локальна відповідь без хмарних даних'
  const fill = async () =>
    a.evaluate(
      `(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(answer)});t.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
  await fill()
  await a.click('Зберегти чернетку')
  await a.until(
    `document.querySelector('textarea')?.value===${JSON.stringify(answer)}`,
  )
  await b.call('Page.reload')
  await b.until(
    `document.querySelector('.game-counter')?.textContent.replaceAll(' ','')==='1/150'`,
  )
  assert.equal(
    await b.evaluate(
      `document.querySelector('main').textContent.includes(${JSON.stringify(answer)})`,
    ),
    false,
  )
  await a.evaluate(`document.querySelector('input[type=checkbox]').click()`)
  await a.click('Надіслати відповідь')
  await b.call('Page.reload')
  await b.until(
    `document.querySelector('.game-counter')?.textContent.replaceAll(' ','')==='1/150'`,
  )
  assert.equal(
    await b.evaluate(
      `document.querySelector('main').textContent.includes(${JSON.stringify(answer)})`,
    ),
    false,
  )
  await b.click('Пропустити запитання')
  await b.until(
    `document.querySelector('main')?.textContent.includes(${JSON.stringify(answer)})`,
  )
  await a.call('Page.reload')
  await a.until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Наступна картка'&&!b.disabled)`,
  )
  await Promise.all([a.click('Наступна картка'), b.click('Наступна картка')])
  await a.until(
    `document.querySelector('.game-counter')?.textContent.replaceAll(' ','')==='2/150'`,
  )
  const current = check(
    await clients[0].rpc('connection_read', { p_view: 'session', p_id: id }),
  ).data
  assert.equal(current.session.position, 2)
  assert.equal(current.remaining, 148)
  for (let i = 0; i < 2; i++) {
    await browsers[i].evaluate('sessionStorage.clear()')
    // A deep link keeps showing its invited historical slot; open the live game explicitly.
    await browsers[i].call('Page.navigate', { url: origin.origin + path })
    await browsers[i].until(
      `document.querySelector('.game-counter')?.textContent.replaceAll(' ','')==='2/150'`,
    )
    const shot = await browsers[i].call('Page.captureScreenshot', {
      format: 'png',
    })
    await writeFile(
      join(artifacts, `partner-${i}.png`),
      Buffer.from(shot.data, 'base64'),
    )
  }
  await b.evaluate(
    `document.querySelector('button[aria-label="Налаштування гри"]').click()`,
  )
  await b.click('Завершити участь')
  await b.click('Підтвердити')
  await b.until(
    `!document.querySelector('main')?.textContent.includes(${JSON.stringify(answer)})`,
  )
  await a.until(
    `document.querySelector('main')?.textContent.includes('Цю гру завершено')`,
  )
  assert.ok(
    await a.evaluate(
      `document.querySelector('main').textContent.includes(${JSON.stringify(answer)})`,
    ),
    'Author own private history remains',
  )
  check(await clients[1].rpc('leave_couple_space'))
  for (const c of clients) {
    assert.equal(
      check(await c.rpc('list_couple_activity', { p_limit: 20 })).items.length,
      0,
    )
    assert.equal(
      check(await c.from('couple_activity_events').select('*')).length,
      0,
    )
  }
  for (const browser of browsers) {
    await browser.call('Page.reload')
    await browser.until(
      `document.querySelector('main')?.textContent.includes('Не вдалося зберегти')`,
    )
    assert.equal(
      await browser.evaluate(
        `document.querySelector('main').textContent.includes(${JSON.stringify(answer)})`,
      ),
      false,
    )
  }
  console.log(
    'PASS: two isolated local Auth accounts in Chromium; five main routes, real inbox/reaction/offline/reconnect/screenshots, UI invitation and visible-card receipt, same active card, private persisted draft, blind publication, skip, concurrent next, lost sessionStorage/reload, closing shared history and leave',
  )
  console.log('Screenshots:', artifacts)
} finally {
  await Promise.all(browsers.map((b) => b.close()))
  for (const id of owned) check(await admin.auth.admin.deleteUser(id))
  console.log('Cleanup: only newly created local browser accounts removed')
}
