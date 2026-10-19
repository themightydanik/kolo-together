import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errors'
import {
  claimCallbackResult,
  processPkceCallback,
  type CallbackResult,
} from './pkce-callback'
import { AuthContext, type AppClient } from './auth-context'
export function AuthProvider({
  children,
  client = supabase,
}: {
  children: ReactNode
  client?: AppClient | null
}) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!!client)
  const [error, setError] = useState<string | null>(null)
  const [callback, setCallback] = useState<CallbackResult>({ status: 'none' })
  const [recovery, setRecovery] = useState<{
    userId: string
    expiresAt: number
  } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  useEffect(() => {
    if (!client) return
    let active = true
    let initializing = true
    let eventVersion = 0
    let previousUser: string | undefined
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      eventVersion++
      if (event === 'SIGNED_OUT' || previousUser !== nextSession?.user.id)
        queryClient.clear()
      previousUser = nextSession?.user.id
      if (event === 'PASSWORD_RECOVERY' && nextSession) {
        setRecovery({
          userId: nextSession.user.id,
          expiresAt: Date.now() + 10 * 60_000,
        })
      } else if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        setRecovery(null)
      } else {
        setRecovery((current) =>
          current?.userId === nextSession?.user.id ? current : null,
        )
      }
      setSession(nextSession)
      if (!initializing) {
        setLoading(false)
        setError(null)
      }
    })
    void (async () => {
      const result = await processPkceCallback(client)
      if (!active) return
      setCallback(result)
      // Consume once even if an Auth event races the subsequent session read.
      const grantFromCallback =
        result.status === 'success' && claimCallbackResult(result)
      if (result.status === 'error') setRecovery(null)
      const version = eventVersion
      try {
        const { data, error: sessionError } = await client.auth.getSession()
        if (!active) return
        if (eventVersion === version) {
          if (sessionError) setError(errorMessage(sessionError))
          previousUser = data.session?.user.id
          setSession(data.session)
          if (result.status === 'success' && grantFromCallback) {
            if (result.recovery && data.session?.user.id === result.userId) {
              setRecovery({
                userId: result.userId,
                expiresAt: result.verifiedAt + 10 * 60_000,
              })
            }
          }
        }
      } catch (e) {
        if (active && eventVersion === version) {
          setError(errorMessage(e))
          setRecovery(null)
        }
      } finally {
        initializing = false
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [client, attempt, queryClient])
  useEffect(() => {
    if (!recovery) return
    const timeout = window.setTimeout(
      () => setRecovery(null),
      Math.max(0, recovery.expiresAt - Date.now()),
    )
    return () => window.clearTimeout(timeout)
  }, [recovery])
  return (
    <AuthContext.Provider
      value={{
        client,
        session,
        loading,
        error,
        online,
        callback,
        recoveryAllowed: () =>
          !!recovery &&
          recovery.userId === session?.user.id &&
          Date.now() < recovery.expiresAt,
        finishRecovery: () => setRecovery(null),
        retry: () => {
          setError(null)
          setLoading(true)
          setAttempt((a) => a + 1)
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
