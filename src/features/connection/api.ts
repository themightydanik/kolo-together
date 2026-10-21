import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { useCouple } from '../couple/api'
import type { Json } from '../../lib/database.types'
import type { Write } from './model'
export function useConnection<T>(view: string, id: string | null = null) {
  const { client, session } = useAuth(),
    couple = useCouple()
  const context =
    couple.data?.members
      .map((m) => m.id)
      .sort()
      .join(':') ?? 'solo'
  return useQuery({
    queryKey: ['connection', session?.user.id, context, view, id],
    enabled: !!client && !!session && !couple.isPending,
    retry: false,
    staleTime: 0,
    refetchInterval: 10000,
    queryFn: async () => {
      const r = await client!.rpc('connection_read', {
        p_view: view,
        p_id: id,
        p_cursor: null,
      })
      if (r.error) throw r.error
      const envelope = r.data as unknown as { context: string; data: T }
      if (envelope.context !== context)
        throw Error('connection_context_changed')
      return envelope.data
    },
  })
}
export function useConnectionPages<T>(view: string, id: string | null = null) {
  const { client, session } = useAuth(),
    couple = useCouple(),
    context =
      couple.data?.members
        .map((m) => m.id)
        .sort()
        .join(':') ?? 'solo'
  return useInfiniteQuery({
    queryKey: ['connection-pages', session?.user.id, context, view, id],
    enabled: !!client && !!session && !couple.isPending,
    retry: false,
    refetchInterval: 10000,
    refetchOnWindowFocus: 'always',
    initialPageParam: null as Json | null,
    queryFn: async ({ pageParam }) => {
      const r = await client!.rpc('connection_read', {
        p_view: view,
        p_id: id,
        p_cursor: pageParam,
      })
      if (r.error) throw r.error
      const e = r.data as unknown as {
        context: string
        data: { items: T[]; next_cursor: Json | null }
      }
      if (e.context !== context) throw Error('connection_context_changed')
      return e.data
    },
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  })
}
export function useConnectionWrite() {
  const { client } = useAuth(),
    cache = useQueryClient()
  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (w: Write) => {
      if (!navigator.onLine) throw Error('offline')
      const r = await client!.rpc('connection_action', {
        p_action: w.action,
        p_id: w.id,
        p_expected: w.expected,
        p_payload: w.payload as Json,
        p_request: w.request,
      })
      if (r.error) throw r.error
      return r.data
    },
    onSuccess: async () => {
      await Promise.all(
        ['connection', 'connection-pages'].map((k) =>
          cache.invalidateQueries({ queryKey: [k] }),
        ),
      )
    },
  })
}
