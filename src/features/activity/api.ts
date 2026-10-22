import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { useCouple } from '../couple/api'
import type { ActivityPage, ActivitySummary, ReactionIntent } from './model'
export function useActivityContext() {
  const { client, session, online } = useAuth(),
    couple = useCouple()
  const context =
    couple.data?.members
      .map((m) => m.id)
      .sort()
      .join(':') ?? 'solo'
  return {
    client,
    session,
    online,
    couple,
    context,
    enabled:
      !!client &&
      !!session &&
      online &&
      !couple.isPending &&
      !couple.isFetching &&
      !couple.isError,
  }
}
export function useActivitySummary() {
  const { client, session, context, enabled } = useActivityContext(),
    cache = useQueryClient()
  return useQuery({
    queryKey: ['activity', session?.user.id, context],
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    queryFn: async () => {
      const r = await client!.rpc('activity_summary')
      if (r.error) throw r.error
      const data = r.data as unknown as ActivitySummary
      if (data.context !== context) {
        void cache.invalidateQueries({ queryKey: ['couple'] })
        throw Error('activity_context_changed')
      }
      return data
    },
  })
}
export function useActivityPages() {
  const { client, session, context, enabled } = useActivityContext(),
    cache = useQueryClient()
  return useInfiniteQuery({
    queryKey: ['activity-pages', session?.user.id, context],
    maxPages: 5,
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const r = await client!.rpc('list_couple_activity', {
        p_cursor: pageParam,
        p_limit: 20,
      })
      if (r.error) throw r.error
      const data = r.data as unknown as ActivityPage
      if (data.context !== context) {
        void cache.invalidateQueries({ queryKey: ['couple'] })
        throw Error('activity_context_changed')
      }
      return data
    },
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  })
}
export function useActivityWrite() {
  const { client, online, context } = useActivityContext(),
    cache = useQueryClient()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (
      action:
        | { kind: 'read'; id: string | null }
        | { kind: 'reaction'; intent: ReactionIntent }
        | { kind: 'preferences'; enabled: boolean },
    ) => {
      if (!online || !navigator.onLine || !client) throw Error('offline')
      if (action.kind === 'read') {
        const r = await client.rpc('read_couple_activity', { p_id: action.id })
        if (r.error) throw r.error
        const data = r.data as unknown as { context: string; path?: string }
        if (data.context !== context) throw Error('activity_context_changed')
        return data
      }
      const r =
        action.kind === 'reaction'
          ? await client.rpc('set_activity_reaction', {
              p_event: action.intent.event,
              p_kind: action.intent.kind,
              p_expected: action.intent.expected,
              p_request: action.intent.request,
            })
          : await client.rpc('set_activity_preferences', {
              p_reactions_enabled: action.enabled,
            })
      if (r.error) throw r.error
      return {} as { path?: string }
    },
    onSettled: async () => {
      await Promise.all(
        ['activity', 'activity-pages', 'connection'].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      )
    },
  })
}
