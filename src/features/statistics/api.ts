import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import type { HistoryCursor } from './model'
export function useStatistics(context: string) {
  const { client, session } = useAuth()
  return useQuery({
    queryKey: ['statistics', session?.user.id, context],
    enabled: !!client && !!session,
    staleTime: 60000,
    queryFn: async () => {
      const result = await client!.rpc('get_statistics')
      if (result.error) throw result.error
      return result.data
    },
  })
}
export function useJointHistory(context: string) {
  const { client, session } = useAuth()
  return useInfiniteQuery({
    queryKey: ['joint-history', session?.user.id, context],
    initialPageParam: null as HistoryCursor | null,
    enabled: !!client && !!session,
    staleTime: 60000,
    queryFn: async ({ pageParam }) => {
      const result = await client!.rpc('get_joint_history', {
        p_cursor: pageParam,
        p_limit: 20,
      })
      if (result.error) throw result.error
      return result.data
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    retry: false,
  })
}
