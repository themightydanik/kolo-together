import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, type AppClient } from '../auth/auth-context'
import { collectRows } from '../tasks/api'
import { loadCouple } from '../couple/api'
import type { GoalDecision } from '../../lib/database.types'
import {
  goalIntent,
  clearGoalIntent,
  goalIntentScope,
  type GoalWrite,
} from './intents'
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
export function useGoalAction(workspace?: GoalsWorkspace) {
  const { client, session } = useAuth()
  const cache = useQueryClient()
  return useMutation({
    mutationKey: ['goal-action', session?.user.id],
    networkMode: 'always',
    retry: false,
    mutationFn: async (
      action:
        | GoalWrite
        | { kind: 'decide'; consent: string; decision: GoalDecision }
        | { kind: 'complete-step'; step: string },
    ) => {
      if (!navigator.onLine) throw new TypeError('offline')
      if (action.kind === 'create' || action.kind === 'propose') {
        const user = session!.user.id,
          data =
            workspace ??
            cache.getQueryData<GoalsWorkspace>(['couple-goals', user])
        if (!data || !data.couple) throw Error('goal_unavailable')
        if (action.kind === 'create' && data.couple.space.id !== action.space)
          throw Error('goal_unavailable')
        const expected =
          action.kind === 'create'
            ? data.goals.filter((g) => g.creator_id === user).length
            : data.consents.filter(
                (c) => c.goal_id === action.goal && c.requester_id === user,
              ).length
        const intent = goalIntent(user, action, expected)
        const result =
          action.kind === 'create'
            ? await client!.rpc('create_couple_goal', {
                p_request_id: intent.request,
                p_expected_goals: intent.expected,
                p_title: action.values.title,
                p_description: action.values.description,
                p_category: action.values.category,
                p_emoji: action.values.emoji,
                p_target_date: action.values.target_date || null,
              })
            : await client!.rpc('propose_goal_change', {
                p_goal_id: action.goal,
                p_request_id: intent.request,
                p_kind: action.change,
                p_payload: action.payload,
                p_expected_changes: intent.expected,
              })
        if (result.error) throw result.error
        clearGoalIntent(user, goalIntentScope(action), intent.request)
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
        cache.invalidateQueries({ queryKey: ['statistics'] }),
        cache.invalidateQueries({ queryKey: ['joint-history'] }),
        cache.invalidateQueries({ queryKey: ['task-workspace'] }),
      ]),
    onError: () => cache.invalidateQueries({ queryKey: ['couple-goals'] }),
  })
}
