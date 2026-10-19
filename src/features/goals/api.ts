import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, type AppClient } from '../auth/auth-context'
import { collectRows } from '../tasks/api'
import { loadCouple } from '../couple/api'
import type {
  GoalChangeKind,
  GoalDecision,
  GoalPayload,
} from '../../lib/database.types'
export async function loadGoals(client: AppClient, userId: string) {
  const [
    goals,
    consents,
    steps,
    participants,
    completions,
    events,
    progress,
    couple,
  ] = await Promise.all([
    collectRows((a, b) =>
      client
        .from('couple_goals')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id')
        .range(a, b),
    ),
    collectRows((a, b) =>
      client
        .from('goal_consents')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id')
        .range(a, b),
    ),
    collectRows((a, b) =>
      client
        .from('goal_steps')
        .select('*')
        .order('goal_id')
        .order('position')
        .range(a, b),
    ),
    collectRows((a, b) =>
      client
        .from('goal_step_participants')
        .select('*')
        .order('step_id')
        .order('user_id')
        .range(a, b),
    ),
    collectRows((a, b) =>
      client
        .from('goal_step_completions')
        .select('*')
        .order('step_id')
        .order('user_id')
        .range(a, b),
    ),
    collectRows((a, b) =>
      client
        .from('goal_events')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id')
        .range(a, b),
    ),
    collectRows((a, b) =>
      client.from('goal_progress').select('*').order('goal_id').range(a, b),
    ),
    loadCouple(client, userId),
  ])
  return {
    goals,
    consents,
    steps,
    participants,
    completions,
    events,
    progress,
    couple,
  }
}
export type GoalsWorkspace = Awaited<ReturnType<typeof loadGoals>>
export function useGoals() {
  const { client, session } = useAuth()
  return useQuery({
    queryKey: ['couple-goals', session?.user.id],
    queryFn: () => loadGoals(client!, session!.user.id),
    enabled: !!client && !!session,
    staleTime: 5000,
    refetchInterval: 15000,
  })
}
export function useGoalAction() {
  const { client } = useAuth()
  const cache = useQueryClient()
  const requests = useRef(new Map<string, string>())
  return useMutation({
    mutationFn: async (
      action:
        | {
            kind: 'propose'
            goal: string
            change: GoalChangeKind
            payload: GoalPayload
          }
        | { kind: 'decide'; consent: string; decision: GoalDecision }
        | { kind: 'complete-step'; step: string },
    ) => {
      if (action.kind === 'propose') {
        const key = JSON.stringify(action)
        const request = requests.current.get(key) ?? crypto.randomUUID()
        requests.current.set(key, request)
        const result = await client!.rpc('propose_goal_change', {
          p_goal_id: action.goal,
          p_request_id: request,
          p_kind: action.change,
          p_payload: action.payload,
        })
        if (result.error) throw result.error
        requests.current.delete(key)
        return result.data
      }
      const result =
        action.kind === 'decide'
          ? await client!.rpc('resolve_goal_consent', {
              p_consent_id: action.consent,
              p_decision: action.decision,
            })
          : await client!.rpc('complete_goal_step', { p_step_id: action.step })
      if (result.error) throw result.error
      return null
    },
    onSuccess: () =>
      Promise.all([
        cache.invalidateQueries({ queryKey: ['couple-goals'] }),
        cache.invalidateQueries({ queryKey: ['task-workspace'] }),
      ]),
    onError: () => cache.invalidateQueries({ queryKey: ['couple-goals'] }),
  })
}
