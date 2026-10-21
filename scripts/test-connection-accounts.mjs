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
      `document.querySelector('main')?.textContent.includes('Запросити до нової гри')`,
    )
    assert.ok(
      !(await b.evaluate(
        `document.querySelector('main').textContent.includes('Демонстрація')`,
      )),
      'Requires local configured build, not demo',
    )
  }
  const [a, b] = browsers
  await a.click('Запросити до нової гри')
  await a.until(
    `Array.from(document.querySelectorAll('a')).some(a=>a.getAttribute('href')?.startsWith('/us/connection/session/'))`,
  )
  const path = await a.evaluate(
      `Array.from(document.querySelectorAll('a')).find(a=>a.getAttribute('href')?.startsWith('/us/connection/session/')).getAttribute('href')`,
    ),
    id = path.split('/').at(-1)
  await b.call('Page.navigate', { url: origin.origin + path })
  await b.click('Прийняти запрошення')
  await a.call('Page.navigate', { url: origin.origin + path })
  await a.click('Витягнути першу картку')
  await a.until(
    `document.querySelector('main')?.textContent.includes('Картка 1 із 150')`,
  )
  await b.call('Page.reload')
  await b.until(
    `document.querySelector('main')?.textContent.includes('Картка 1 із 150')`,
  )
  assert.equal(
    await a.evaluate(
      `document.querySelector('.romantic-question').textContent`,
    ),
    await b.evaluate(
      `document.querySelector('.romantic-question').textContent`,
    ),
  )
  const answer = 'Нова локальна відповідь без хмарних даних'
  const fill = async () =>
    a.evaluate(
      `(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(answer)});t.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
  await fill()
  await a.click('Зберегти приватний чернетковий текст')
  await a.until(
    `document.querySelector('textarea')?.value===${JSON.stringify(answer)}`,
  )
  await b.call('Page.reload')
  await b.until(
    `document.querySelector('main')?.textContent.includes('Картка 1 із 150')`,
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
    `document.querySelector('main')?.textContent.includes('Картка 1 із 150')`,
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
    `document.querySelector('main')?.textContent.includes('Картка 2 із 150')`,
  )
  const current = check(
    await clients[0].rpc('connection_read', { p_view: 'session', p_id: id }),
  ).data
  assert.equal(current.session.position, 2)
  for (let i = 0; i < 2; i++) {
    await browsers[i].call('Page.reload')
    await browsers[i].until(
      `document.querySelector('main')?.textContent.includes('Картка 2 із 150')`,
    )
    const shot = await browsers[i].call('Page.captureScreenshot', {
      format: 'png',
    })
    await writeFile(
      join(artifacts, `partner-${i}.png`),
      Buffer.from(shot.data, 'base64'),
    )
  }
  console.log(
    'PASS: two isolated local Auth accounts in Chromium; UI invitation, same active card, private persisted draft, blind publication, skip, concurrent next and reload',
  )
  console.log('Screenshots:', artifacts)
} finally {
  await Promise.all(browsers.map((b) => b.close()))
  for (const id of owned) check(await admin.auth.admin.deleteUser(id))
  console.log('Cleanup: only newly created local browser accounts removed')
}
