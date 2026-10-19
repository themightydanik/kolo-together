import type { Session } from '@supabase/supabase-js'
import type { AppClient } from './auth-context'

export type CallbackResult =
  | { status: 'none' }
  | { status: 'error' }
  | { status: 'success'; userId: string; recovery: boolean; verifiedAt: number }

// One exchange per navigation, including Strict Mode's subscribe/cleanup/subscribe.
// Callback proofs stay in memory; Supabase manages the persistent Auth session.
// Codes/tokens never enter React Query or logs.
const claimedResults = new WeakSet<CallbackResult & object>()
export function claimCallbackResult(result: CallbackResult): boolean {
  if (claimedResults.has(result)) return false
  claimedResults.add(result)
  return true
}
const callbacks = new WeakMap<
  AppClient,
  { path: string; result: Promise<CallbackResult> }
>()
export function processPkceCallback(
  client: AppClient,
): Promise<CallbackResult> {
  const url = new URL(window.location.href)
  const path = url.pathname
  if (!['/auth/callback', '/auth/update-password'].includes(path))
    return Promise.resolve({ status: 'none' })
  const hash = new URLSearchParams(url.hash.slice(1))
  const code = url.searchParams.get('code')
  const failed = url.searchParams.has('error') || hash.has('error')
  const flowId = url.searchParams.get('sb_flow_id')
  if (!code && !failed)
    return callbacks.get(client)?.path === path
      ? callbacks.get(client)!.result
      : Promise.resolve({ status: 'none' })
  window.history.replaceState(null, '', path)
  const result = (async (): Promise<CallbackResult> => {
    if (failed || !code) return { status: 'error' }
    let recoverySession: Session | null = null
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') recoverySession = session
    })
    try {
      // The SDK validates the code against the local verifier and Auth server.
      // Preserve per-flow verifier selection even though we scrubbed the URL.
      const { data, error } = await client.auth.exchangeCodeForSession(
        code,
        flowId === null ? undefined : { flowId },
      )
      if (error || !data.session) return { status: 'error' }
      const recovered = recoverySession as Session | null
      const recovery =
        !!recovered &&
        recovered.user.id === data.session.user.id &&
        recovered.access_token === data.session.access_token
      // A confirmation/login code placed on this route is NOT a recovery link.
      if (path === '/auth/update-password' && !recovery)
        return { status: 'error' }
      return {
        status: 'success',
        userId: data.session.user.id,
        recovery,
        verifiedAt: Date.now(),
      }
    } catch {
      return { status: 'error' }
    } finally {
      subscription.unsubscribe()
    }
  })()
  callbacks.set(client, { path, result })
  return result
}
