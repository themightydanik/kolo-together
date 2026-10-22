import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { useCouple } from '../couple/api'
import type { MemoryDetail, MemoryIntent, MemoryPage } from './model'
import type { Json } from '../../lib/database.types'
export function useMemoryContext() {
  const auth = useAuth(),
    couple = useCouple(),
    context =
      couple.data?.members
        .map((m) => m.id)
        .sort()
        .join(':') ?? 'solo'
  return {
    ...auth,
    couple,
    context,
    enabled:
      !!auth.client &&
      !!auth.session &&
      auth.online &&
      !couple.isPending &&
      !couple.isFetching &&
      !couple.isError,
  }
}
export function useMemoryFeed(category: string | null) {
  const { client, session, context, enabled } = useMemoryContext(),
    cache = useQueryClient()
  return useInfiniteQuery({
    queryKey: ['memories', session?.user.id, context, category],
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    maxPages: 5,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const r = await client!.rpc('memory_feed', {
        p_cursor: pageParam,
        p_category: category,
        p_limit: 20,
      })
      if (r.error) throw r.error
      const data = r.data as unknown as MemoryPage
      if (data.context !== context) {
        void cache.invalidateQueries({ queryKey: ['couple'] })
        throw Error('memory_context_changed')
      }
      return data
    },
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  })
}
export function useMemoryDetail(id: string) {
  const { client, session, context, enabled } = useMemoryContext(),
    cache = useQueryClient()
  return useQuery({
    queryKey: ['memory', session?.user.id, context, id],
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    queryFn: async () => {
      const r = await client!.rpc('memory_detail', { p_id: id })
      if (r.error) throw r.error
      const d = r.data as unknown as MemoryDetail
      if (d.context !== context) {
        void cache.invalidateQueries({ queryKey: ['couple'] })
        throw Error('memory_context_changed')
      }
      return d
    },
  })
}
export function useMemoryWrite() {
  const { client, online } = useMemoryContext(),
    cache = useQueryClient()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (w: MemoryIntent) => {
      if (!client || !online || !navigator.onLine) throw Error('offline')
      const r = await client.rpc('memory_action', {
        p_action: w.action,
        p_id: w.id,
        p_expected: w.expected,
        p_payload: w.payload as Json,
        p_request: w.request,
      })
      if (r.error) throw r.error
      return r.data as unknown as { id: string; version: number }
    },
    onSettled: async () => {
      await Promise.all(
        ['memory', 'memories', 'memory-sources'].map((k) =>
          cache.invalidateQueries({ queryKey: [k] }),
        ),
      )
    },
  })
}
export function useMemorySources() {
  const { client, session, context, enabled } = useMemoryContext()
  return useQuery({
    queryKey: ['memory-sources', session?.user.id, context],
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const r = await client!.rpc('memory_sources')
      if (r.error) throw r.error
      const d = r.data as unknown as {
        context: string
        items: {
          kind: string
          key: string
          source: { title: string; date: string }
        }[]
      }
      if (d.context !== context) throw Error('memory_context_changed')
      return d.items
    },
  })
}
