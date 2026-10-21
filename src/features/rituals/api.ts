import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { useCouple } from '../couple/api'
import type { RitualCursor, RitualHistoryCursor, RitualDecision } from './model'
import {
  ritualIntent,
  clearRitualIntent,
  ritualIntentScope,
  type RitualWrite,
} from './intents'
function useContext() {
  const couple = useCouple(),
    { client, session } = useAuth()
  return {
    client,
    session,
    couple,
    enabled: !!client && !!session && !couple.isPending,
    context:
      couple.data?.members
        .map((m) => m.id)
        .sort()
        .join(':') ?? 'solo',
  }
}
export function useRitualList(filter: string) {
  const { client, session, enabled, context, couple } = useContext(),
    cache = useQueryClient()
  return useInfiniteQuery({
    queryKey: ['rituals', session?.user.id, context, filter],
    enabled,
    initialPageParam: null as RitualCursor | null,
    staleTime: 5000,
    refetchInterval: 15000,
    retry: false,
    queryFn: async ({ pageParam }) => {
      if (couple.isError) {
        const result = await couple.refetch()
        if (result.error) throw result.error
      }
      if (!pageParam) {
        const refresh = await client!.rpc('refresh_ritual_instances')
        if (refresh.error) throw refresh.error
      }
      const result = await client!.rpc('list_couple_rituals', {
        p_filter: filter,
        p_cursor: pageParam,
        p_limit: filter === 'today' ? 50 : 20,
      })
      if (result.error) throw result.error
      if (result.data.context !== context) {
        void cache.invalidateQueries({ queryKey: ['couple'] })
        throw Error('ritual_context_changed')
      }
      return result.data
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
}
export function useRitualHistory(context: string) {
  const { client, session } = useAuth()
  return useInfiniteQuery({
    queryKey: ['ritual-history', session?.user.id, context],
    initialPageParam: null as RitualHistoryCursor | null,
    enabled: !!client && !!session,
    staleTime: 15000,
    retry: false,
    queryFn: async ({ pageParam }) => {
      const result = await client!.rpc('list_ritual_history', {
        p_cursor: pageParam,
        p_limit: 20,
      })
      if (result.error) throw result.error
      if (result.data.context !== context) throw Error('ritual_context_changed')
      return result.data
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
}
export function useRitualSummary(context: string) {
  const { client, session } = useAuth()
  return useQuery({
    queryKey: ['ritual-summary', session?.user.id, context],
    enabled: !!client && !!session,
    staleTime: 15000,
    queryFn: async () => {
      const result = await client!.rpc('get_ritual_summary')
      if (result.error) throw result.error
      if (result.data.context !== context) throw Error('ritual_context_changed')
      return result.data
    },
    retry: false,
  })
}
export function useRitualAction(expected = 0) {
  const { client, session } = useAuth(),
    cache = useQueryClient()
  return useMutation({
    mutationKey: ['ritual-action', session?.user.id],
    retry: false,
    networkMode: 'always',
    mutationFn: async (
      action:
        | RitualWrite
        | { kind: 'resolve'; consent: string; decision: RitualDecision }
        | { kind: 'complete'; instance: string }
        | { kind: 'withdraw'; ritual: string },
    ) => {
      if (!navigator.onLine) throw new TypeError('offline')
      if (action.kind === 'create' || action.kind === 'propose') {
        const intent = ritualIntent(session!.user.id, action, expected)
        const result =
          action.kind === 'create'
            ? await client!.rpc('create_couple_ritual', {
                p_request_id: intent.request,
                p_terms: action.values,
                p_expected_creations: intent.expected,
              })
            : await client!.rpc('propose_ritual_change', {
                p_ritual_id: action.ritual,
                p_request_id: intent.request,
                p_kind: action.change,
                p_terms: action.payload,
                p_expected_changes: intent.expected,
              })
        if (result.error) throw result.error
        clearRitualIntent(
          session!.user.id,
          ritualIntentScope(action),
          intent.request,
        )
        return result.data
      }
      const result =
        action.kind === 'resolve'
          ? await client!.rpc('resolve_ritual_consent', {
              p_consent_id: action.consent,
              p_decision: action.decision,
            })
          : action.kind === 'complete'
            ? await client!.rpc('complete_ritual_instance', {
                p_instance_id: action.instance,
              })
            : await client!.rpc('withdraw_couple_ritual', {
                p_ritual_id: action.ritual,
              })
      if (result.error) throw result.error
      return null
    },
    onSuccess: () =>
      Promise.all(
        ['rituals', 'ritual-history', 'ritual-summary'].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  })
}
