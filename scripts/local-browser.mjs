// Owned ephemeral Chromium only. No connector or remote browser services.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
export const pause = (ms) => new Promise((r) => setTimeout(r, ms))
export async function localBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'kolo-connection-auth-browser-'))
  const port = await new Promise((resolve) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
  const child = spawn(
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
  let error
  child.on('error', (e) => {
    error = e
  })
  let ws,
    sequence = 0
  const pending = new Map()
  async function close() {
    if (ws) ws.close()
    child.kill('SIGTERM')
    await pause(200)
    await rm(profile, { recursive: true, force: true })
  }
  try {
    let target
    for (let i = 0; i < 200; i++) {
      if (error) throw error
      try {
        target = (
          await (await fetch(`http://127.0.0.1:${port}/json`)).json()
        ).find((t) => t.type === 'page')
        if (target) break
      } catch {}
      await pause(50)
    }
    if (!target) throw Error('Chromium unavailable')
    ws = new WebSocket(target.webSocketDebuggerUrl)
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id) {
        const p = pending.get(m.id)
        pending.delete(m.id)
        if (m.error) p?.reject(Error('CDP failure'))
        else p?.resolve(m.result)
      }
    }
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    const evaluate = async (expression) => {
      const r = await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails) throw Error('Browser expression failed')
      return r.result.value
    }
    const until = async (expression) => {
      for (let i = 0; i < 600; i++) {
        if (await evaluate(expression)) return
        await pause(50)
      }
      throw Error('Browser readiness failed: ' + expression)
    }
    const click = async (text) => {
      await until(
        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`,
      )
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      )
    }
    await call('Page.enable')
    await call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    })
    return { call, evaluate, until, click, close }
  } catch (e) {
    await close()
    throw e
  }
}
