import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errors'
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
    let eventReceived = false
    let previousUser: string | undefined
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      eventReceived = true
      if (_event === 'SIGNED_OUT' || previousUser !== nextSession?.user.id)
        queryClient.clear()
      previousUser = nextSession?.user.id
      setSession(nextSession)
      setLoading(false)
      setError(null)
    })
    client.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active || eventReceived) return
        if (sessionError) setError(errorMessage(sessionError))
        previousUser = data.session?.user.id
        setSession(data.session)
        setLoading(false)
      })
      .catch((e) => {
        if (active && !eventReceived) {
          setError(errorMessage(e))
          setLoading(false)
        }
      })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [client, attempt, queryClient])
  return (
    <AuthContext.Provider
      value={{
        client,
        session,
        loading,
        error,
        online,
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
