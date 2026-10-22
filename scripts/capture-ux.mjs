// Readonly local DEMO screenshots; never opens real account routes.
import { localBrowser } from './local-browser.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const stage = process.argv[2] ?? 'after'
assert.ok(['before', 'after'].includes(stage))
const dir = `docs/screenshots/pr9/${stage}`
await mkdir(dir, { recursive: true })
const b = await localBrowser()
try {
  for (const [name, path] of [
    ['today', '/'],
    ['tasks', '/tasks'],
    ['goals', '/goals'],
    ['rewards', '/rewards'],
    ['us', '/us'],
    ['game', '/us/connection/game'],
  ]) {
    await b.call('Page.navigate', { url: 'http://127.0.0.1:4173' + path })
    await b.until(
      `!!document.querySelector('main')&&document.querySelector('main').textContent.includes('Демо')`,
    )
    await new Promise((r) => setTimeout(r, 250))
    const { cssContentSize: size } = await b.call('Page.getLayoutMetrics')
    const shot = await b.call('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: 390,
        height: Math.min(Math.ceil(size.height), 6000),
        scale: 1,
      },
    })
    await writeFile(`${dir}/${name}.png`, Buffer.from(shot.data, 'base64'))
  }
  console.log(`PASS: six ${stage} local demo screenshots saved`)
} finally {
  await b.close()
}
