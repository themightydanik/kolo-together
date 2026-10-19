import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, type AppClient } from '../auth/auth-context'
import type { Task } from '../../lib/database.types'
export async function collectRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = []
  for (let from = 0; ; from += 200) {
    const { data, error } = await page(from, from + 199)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 200) return rows
  }
}
export async function loadTaskWorkspace(client: AppClient, userId: string) {
  const clock = await client.rpc('refresh_task_instances')
  if (clock.error) throw clock.error
  const [
    tasks,
    participants,
    instances,
    completions,
    progress,
    ledger,
    rules,
    settings,
    members,
    profile,
  ] = await Promise.all([
    collectRows((from, to) =>
      client
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    collectRows((from, to) =>
      client
        .from('task_participants')
        .select('*')
        .order('task_id')
        .order('user_id')
        .range(from, to),
    ),
    collectRows((from, to) =>
      client
        .from('task_instances')
        .select('*')
        .order('period_start', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    collectRows((from, to) =>
      client
        .from('task_completions')
        .select('*')
        .order('completed_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    client
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
    client
      .from('reward_ledger')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20),
    client.from('task_reward_rules').select('*'),
    client.from('task_economy_settings').select('*').single(),
    client.from('couple_members').select('*').is('left_at', null),
    client.from('profiles').select('*').eq('id', userId).single(),
  ])
  for (const result of [progress, ledger, rules, settings, members, profile])
    if (result.error) throw result.error
  const spaceId =
    members.data?.find((member) => member.user_id === userId)?.space_id ?? null
  let togetherXp = 0
  if (spaceId) {
    const result = await client
      .from('space_progress')
      .select('*')
      .eq('space_id', spaceId)
      .maybeSingle()
    if (result.error) throw result.error
    togetherXp = result.data?.together_xp ?? 0
  }
  return {
    today: clock.data,
    tasks,
    participants,
    instances,
    completions,
    xp: progress.data?.xp ?? 0,
    coins: progress.data?.coins ?? 0,
    togetherXp,
    spaceId,
    hasPartner: (members.data?.length ?? 0) === 2,
    ledger: ledger.data ?? [],
    rules: rules.data ?? [],
    settings: settings.data!,
    profile: profile.data!,
  }
}
export type TaskWorkspace = Awaited<ReturnType<typeof loadTaskWorkspace>>
export function useTaskWorkspace() {
  const { client, session } = useAuth()
  return useQuery({
    queryKey: ['task-workspace', session?.user.id],
    queryFn: () => loadTaskWorkspace(client!, session!.user.id),
    enabled: !!client && !!session,
    staleTime: 5000,
    refetchInterval: 15000,
  })
}
export function useTaskAction() {
  const { client } = useAuth()
  const cache = useQueryClient()
  return useMutation({
    mutationFn: async (
      action:
        | { kind: 'complete'; id: string }
        | { kind: 'accept' | 'decline' | 'cancel'; id: string },
    ) => {
      if (action.kind === 'complete') {
        const result = await client!.rpc('complete_task_instance', {
          p_instance_id: action.id,
        })
        if (result.error) throw result.error
        return result.data
      }
      const result =
        action.kind === 'cancel'
          ? await client!.rpc('cancel_task', { p_task_id: action.id })
          : await client!.rpc('respond_task', {
              p_task_id: action.id,
              p_accept: action.kind === 'accept',
            })
      if (result.error) throw result.error
      return null
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ['task-workspace'] }),
  })
}
export function currentInstance(task: Task, data: TaskWorkspace) {
  return data.instances.find(
    (instance) =>
      instance.task_id === task.id &&
      (task.recurrence === 'once' ||
        instance.period_start ===
          (task.recurrence === 'daily' ? data.today : weekStart(data.today))),
  )
}
export function weekStart(date: string) {
  const day = new Date(date + 'T00:00:00Z')
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}
