// Opt-in local DEMO UI check with system Chromium. No cloud accounts or SDK writes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:4173')
assert.ok(
  ['127.0.0.1', 'localhost'].includes(origin.hostname) &&
    origin.protocol === 'http:',
  'Only a local demo preview is permitted',
)
const artifacts = await mkdtemp(join(tmpdir(), 'kolo-connection-browser-'))
const profile = join(artifacts, 'profile')
const port = await new Promise((resolve, reject) => {
  const s = createServer()
  s.on('error', reject)
  s.listen(0, '127.0.0.1', () => {
    const port = s.address().port
    s.close(() => resolve(port))
  })
})
const browser = spawn(
  process.env.CHROMIUM_BIN ?? 'chromium',
  [
    '--headless',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)
let spawnError,
  ws,
  seq = 0
browser.on('error', (error) => {
  spawnError = error
})
const pending = new Map()
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let target
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError
    try {
      target = await (
        await fetch(
          `http://127.0.0.1:${port}/json/new?${encodeURIComponent(origin.origin + '/us')}`,
          { method: 'PUT' },
        )
      ).json()
      break
    } catch {
      await pause(50)
    }
  }
  assert.ok(target, 'Chromium DevTools did not start')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id) {
      const p = pending.get(m.id)
      if (p) {
        pending.delete(m.id)
        if (m.error) p.reject(Error(JSON.stringify(m.error)))
        else p.resolve(m.result)
      }
    }
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async function evaluate(expression) {
    const r = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw Error('Browser expression failed')
    return r.result.value
  }
  async function until(expression) {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return
      await pause(50)
    }
    throw Error('Browser UI readiness failed')
  }
  await call('Page.enable')
  await call('Runtime.enable')
  for (const width of [360, 390, 768, 1280]) {
    await call('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 800,
    })
    for (const dark of [false, true]) {
      await call('Page.navigate', {
        url: origin.origin + '/us/connection/game',
      })
      await until("!!document.querySelector('.romantic-card')")
      assert.ok(
        await evaluate(
          "document.querySelector('main').textContent.includes('Демонстрація')",
        ),
        'Only readonly demo is allowed',
      )
      await evaluate(
        `localStorage.setItem('kolo-theme','${dark ? 'dark' : 'light'}')`,
      )
      await call('Page.reload')
      await until(
        `!!document.querySelector('.romantic-card') && !!document.querySelector('.dark') === ${dark}`,
      )
      assert.ok(
        await evaluate('document.documentElement.scrollWidth<=innerWidth'),
        `Overflow ${width}`,
      )
      assert.equal(
        await evaluate(
          `document.querySelector('nav[aria-label="Основная навигация"]').querySelectorAll('a').length`,
        ),
        5,
      )
      await evaluate(
        "document.querySelector('.romantic-card').scrollIntoView({block:'center'});document.querySelector('.romantic-card').focus()",
      )
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: ' ',
        code: 'Space',
        windowsVirtualKeyCode: 32,
      })
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: ' ',
        code: 'Space',
        windowsVirtualKeyCode: 32,
      })
      await until(
        "document.querySelector('.romantic-card').getAttribute('aria-pressed')==='true'",
      )
      await evaluate("document.querySelector('.romantic-card').click()")
      await until(
        "document.querySelector('.romantic-card').getAttribute('aria-pressed')==='false'",
      )
      await call('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      })
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('.romantic-card')).animationName",
        ),
        'none',
      )
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('.romantic-card')).transitionDuration",
        ),
        '0s',
      )
      const metrics = await evaluate(
        `(()=>{const c=document.querySelector('.romantic-question');const r=c.getBoundingClientRect();return {width:r.width,scroll:c.scrollWidth,client:c.clientWidth}})()`,
      )
      assert.ok(metrics.scroll <= metrics.client, 'Question text must wrap')
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      await writeFile(
        join(artifacts, `${width}-${dark ? 'dark' : 'light'}.png`),
        Buffer.from(shot.data, 'base64'),
      )
      await call('Emulation.setEmulatedMedia', { features: [] })
    }
  }
  console.log(
    'PASS: card game Chromium 360/390/768/1280, light/dark, native keyboard and click flip, reduced motion, wrapping, five tabs, no overflow',
  )
  console.log('Screenshots:', artifacts)
  await call('Browser.close')
} finally {
  ws?.close()
  browser.kill('SIGTERM')
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}
