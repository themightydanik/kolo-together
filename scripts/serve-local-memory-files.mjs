// Own loopback stack only. Launches the actual Deno entrypoint used for deployment.
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
const s = JSON.parse(await readFile(process.argv[2], 'utf8'))
if (!['localhost', '127.0.0.1'].includes(new URL(s.API_URL).hostname))
  throw Error('Local only')
const child = spawn(
  'npm',
  [
    'exec',
    '--cache',
    '/tmp/kolo-npm',
    '--yes',
    '--package=deno',
    '--',
    'deno',
    'run',
    '--allow-env',
    '--allow-net',
    'supabase/functions/memory-files/index.ts',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DENO_DIR: '/tmp/kolo-deno',
      SUPABASE_URL: s.API_URL,
      SUPABASE_ANON_KEY: s.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY,
      MEMORY_FILES_HOST: '127.0.0.1',
      PORT: '4185',
    },
  },
)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('exit', (code) => process.exit(code ?? 0))
