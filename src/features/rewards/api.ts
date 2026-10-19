import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, type AppClient } from '../auth/auth-context'
import { collectRows } from '../tasks/api'
import { loadCouple } from '../couple/api'
import type { PurchaseAction } from '../../lib/database.types'
export async function loadRewardStore(client: AppClient, userId: string) {
  const [offers, consents, purchases, transactions, summary, couple] =
    await Promise.all([
      collectRows((from, to) =>
        client
          .from('reward_offers')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
      collectRows((from, to) =>
        client
          .from('reward_offer_consents')
          .select('*')
          .order('offer_id')
          .order('user_id')
          .range(from, to),
      ),
      collectRows((from, to) =>
        client
          .from('reward_purchases')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
      client
        .from('coin_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id')
        .limit(50),
      client.rpc('get_coin_summary'),
      loadCouple(client, userId),
    ])
  for (const result of [transactions, summary])
    if (result.error) throw result.error
  return {
    offers,
    consents,
    purchases,
    transactions: transactions.data ?? [],
    summary: summary.data!,
    couple,
  }
}
export type RewardStore = Awaited<ReturnType<typeof loadRewardStore>>
export function useRewardStore() {
  const { client, session } = useAuth()
  return useQuery({
    queryKey: ['reward-store', session?.user.id],
    queryFn: () => loadRewardStore(client!, session!.user.id),
    enabled: !!client && !!session,
    staleTime: 5000,
    refetchInterval: 15000,
  })
}
export function useRewardAction() {
  const { client } = useAuth()
  const cache = useQueryClient()
  return useMutation({
    mutationFn: async (
      action:
        | { kind: 'buy'; id: string; request: string }
        | { kind: 'accept' | 'decline' | 'publish' | 'pause'; id: string }
        | { kind: 'purchase'; id: string; action: PurchaseAction },
    ) => {
      const result =
        action.kind === 'buy'
          ? await client!.rpc('buy_reward_offer', {
              p_offer_id: action.id,
              p_request_id: action.request,
            })
          : action.kind === 'purchase'
            ? await client!.rpc('act_reward_purchase', {
                p_purchase_id: action.id,
                p_action: action.action,
              })
            : action.kind === 'accept' || action.kind === 'decline'
              ? await client!.rpc('respond_reward_offer', {
                  p_offer_id: action.id,
                  p_accept: action.kind === 'accept',
                })
              : await client!.rpc('set_reward_offer_published', {
                  p_offer_id: action.id,
                  p_published: action.kind === 'publish',
                })
      if (result.error) throw result.error
      return result.data
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['reward-store'] }),
        cache.invalidateQueries({ queryKey: ['task-workspace'] }),
      ])
    },
  })
}
