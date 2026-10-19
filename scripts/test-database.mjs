// Always starts a disposable local PostgreSQL. Never reads remote DB credentials.
import { execFileSync, spawnSync } from 'node:child_process'
import pg from 'pg'
const name = `kolo-security-${process.pid}`
let started = false
try {
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-d',
      '--name',
      name,
      '-e',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      '-e',
      'POSTGRES_DB=kolo_test',
      '-p',
      '127.0.0.1::5432',
      'postgres:17-alpine',
    ],
    { stdio: 'pipe' },
  )
  started = true
  const port = execFileSync(
    'docker',
    [
      'inspect',
      '--format',
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      name,
    ],
    { encoding: 'utf8' },
  ).trim()
  const connectionString = `postgresql://postgres@127.0.0.1:${port}/kolo_test`
  let ready = false
  for (let i = 0; i < 100; i++) {
    const client = new pg.Client({ connectionString })
    try {
      await client.connect()
      await client.query('select 1')
      ready = true
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    } finally {
      await client.end().catch(() => {})
    }
  }
  if (!ready) throw new Error('Test PostgreSQL did not start')
  const result = spawnSync(
    process.execPath,
    ['--test', 'supabase/tests/security.mjs'],
    {
      stdio: 'inherit',
      env: { ...process.env, KOLO_LOCAL_TEST_DB: connectionString },
    },
  )
  process.exitCode = result.status ?? 1
} catch (error) {
  console.error(
    'Database security tests require a running Docker engine:',
    error.message,
  )
  process.exitCode = 1
} finally {
  if (started) execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' })
}
