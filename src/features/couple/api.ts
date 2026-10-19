import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import type { AppClient } from '../auth/auth-context'
export async function loadCouple(client: AppClient, userId: string) {
  const own = await client
    .from('couple_members')
    .select('*')
    .eq('user_id', userId)
    .is('left_at', null)
    .maybeSingle()
  if (own.error) throw own.error
  if (!own.data) return null
  const spaceId = own.data.space_id
  const [space, members, invitations] = await Promise.all([
    client.from('couple_spaces').select('*').eq('id', spaceId).single(),
    client
      .from('couple_members')
      .select('*')
      .eq('space_id', spaceId)
      .is('left_at', null),
    client
      .from('couple_invitations')
      .select(
        'id,recipient_email,expires_at,consumed_at,declined_at,revoked_at',
      )
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(5),
  ])
  if (space.error) throw space.error
  if (members.error) throw members.error
  if (invitations.error) throw invitations.error
  const profiles = await client
    .from('profiles')
    .select('*')
    .in(
      'id',
      members.data.map((member) => member.user_id),
    )
  if (profiles.error) throw profiles.error
  return {
    space: space.data,
    members: members.data,
    profiles: profiles.data,
    invitations: invitations.data,
  }
}
export function useCouple() {
  const { client, session } = useAuth()
  return useQuery({
    queryKey: ['couple', session?.user.id],
    queryFn: () => loadCouple(client!, session!.user.id),
    enabled: !!client && !!session,
    staleTime: 10000,
    refetchInterval: 15000,
  })
}
