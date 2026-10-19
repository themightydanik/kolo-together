/** Schema snapshot through 20261019220000_rewards_store.sql.
 * Refresh with Supabase CLI (see docs/supabase.md) and review the diff. */
export type Profile = {
  id: string
  display_name: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}
export type CoupleSpace = {
  id: string
  created_at: string
  archived_at: string | null
}
export type CoupleMember = {
  id: string
  space_id: string
  user_id: string
  seat: number
  joined_at: string
  left_at: string | null
}
export type CoupleInvitation = {
  id: string
  space_id: string
  created_by: string | null
  recipient_email: string
  token_hash: string
  created_at: string
  expires_at: string
  consumed_at: string | null
  accepted_by: string | null
  declined_at: string | null
  revoked_at: string | null
}
export type TaskKind = 'personal' | 'proposal' | 'joint'
export type TaskStatus =
  'pending' | 'active' | 'completed' | 'declined' | 'cancelled'
export type Difficulty = 'easy' | 'normal' | 'hard'
export type Recurrence = 'once' | 'daily' | 'weekly'
export type Category =
  'care' | 'home' | 'communication' | 'time' | 'growth' | 'other'
export type Task = {
  id: string
  request_id: string
  space_id: string
  creator_id: string
  title: string
  description: string
  kind: TaskKind
  category: Category
  difficulty: Difficulty
  due_date: string | null
  anchor_date: string
  recurrence: Recurrence
  status: TaskStatus
  created_at: string
}
export type TaskParticipant = {
  task_id: string
  user_id: string
  consent: 'pending' | 'accepted' | 'declined'
  responded_at: string | null
}
export type TaskInstance = {
  id: string
  task_id: string
  period_start: string
  status: 'active' | 'completed' | 'cancelled' | 'expired'
  xp: number
  coins: number
  together_xp: number
  created_at: string
  completed_at: string | null
}
export type TaskCompletion = {
  id: string
  instance_id: string
  user_id: string
  completed_at: string
}
export type UserProgress = { user_id: string; xp: number; coins: number }
export type SpaceProgress = { space_id: string; together_xp: number }
export type RewardRule = { difficulty: Difficulty; xp: number; coins: number }
export type RewardLedger = {
  id: string
  task_id: string
  instance_id: string
  completion_id: string | null
  user_id: string | null
  space_id: string
  kind: 'personal' | 'together'
  title: string
  xp: number
  coins: number
  together_xp: number
  created_at: string
}
export type CompletionResult = {
  already_completed: boolean
  xp: number
  coins: number
  together_xp: number
}
export type RewardCategory =
  | 'care'
  | 'romance'
  | 'rest'
  | 'fun'
  | 'time'
  | 'other'
export type RewardOffer = {
  id: string
  request_id: string
  space_id: string
  creator_id: string
  partner_id: string
  title: string
  description: string
  kind: 'partner' | 'joint'
  category: RewardCategory
  emoji: string
  price: number
  single_use: boolean
  status: 'pending' | 'active' | 'paused' | 'declined' | 'closed'
  created_at: string
}
export type RewardConsent = {
  offer_id: string
  user_id: string
  consent: 'pending' | 'accepted' | 'declined'
  responded_at: string | null
}
export type RewardPurchase = {
  id: string
  request_id: string
  offer_id: string
  space_id: string
  buyer_id: string
  provider_id: string
  title: string
  description: string
  emoji: string
  kind: 'partner' | 'joint'
  price: number
  single_use: boolean
  status: 'pending' | 'ready' | 'completed' | 'cancelled'
  created_at: string
  resolved_at: string | null
}
export type CoinTransaction = {
  id: string
  user_id: string
  kind: 'earn' | 'spend' | 'refund'
  amount: number
  reward_ledger_id: string | null
  purchase_id: string | null
  created_at: string
}
export type CoinSummary = {
  balance: number
  earned: string
  spent: string
  refunded: string
}
export type PurchaseAction = 'ready' | 'refuse' | 'cancel' | 'confirm'
type Table<Row, Insert, Update> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}
export type Database = {
  public: {
    Tables: {
      reward_offers: Table<RewardOffer, never, never>
      reward_offer_consents: Table<RewardConsent, never, never>
      reward_purchases: Table<RewardPurchase, never, never>
      coin_transactions: Table<CoinTransaction, never, never>
      profiles: Table<
        Profile,
        { id: string; display_name?: string; avatar_url?: string | null },
        { display_name?: string; avatar_url?: string | null }
      >
      couple_spaces: Table<CoupleSpace, never, never>
      couple_members: Table<CoupleMember, never, never>
      couple_invitations: Table<CoupleInvitation, never, never>
      tasks: Table<Task, never, never>
      task_participants: Table<TaskParticipant, never, never>
      task_instances: Table<TaskInstance, never, never>
      task_completions: Table<TaskCompletion, never, never>
      user_progress: Table<UserProgress, never, never>
      space_progress: Table<SpaceProgress, never, never>
      reward_ledger: Table<RewardLedger, never, never>
      task_reward_rules: Table<RewardRule, never, never>
      task_economy_settings: Table<
        { id: boolean; together_xp: number },
        never,
        never
      >
    }
    Views: { [_ in never]: never }
    Functions: {
      get_coin_summary: { Args: Record<string, never>; Returns: CoinSummary }
      can_read_reward_offer: { Args: { p_offer_id: string }; Returns: boolean }
      create_reward_offer: {
        Args: {
          p_request_id: string
          p_title: string
          p_description: string
          p_kind: 'partner' | 'joint'
          p_category: RewardCategory
          p_emoji: string
          p_price: number
          p_single_use: boolean
        }
        Returns: string
      }
      respond_reward_offer: {
        Args: { p_offer_id: string; p_accept: boolean }
        Returns: undefined
      }
      set_reward_offer_published: {
        Args: { p_offer_id: string; p_published: boolean }
        Returns: undefined
      }
      buy_reward_offer: {
        Args: { p_offer_id: string; p_request_id: string }
        Returns: string
      }
      act_reward_purchase: {
        Args: { p_purchase_id: string; p_action: PurchaseAction }
        Returns: undefined
      }
      can_read_task: { Args: { p_task_id: string }; Returns: boolean }
      create_task: {
        Args: {
          p_request_id: string
          p_title: string
          p_description: string
          p_kind: TaskKind
          p_category: Category
          p_difficulty: Difficulty
          p_due_date: string | null
          p_recurrence: Recurrence
        }
        Returns: string
      }
      respond_task: {
        Args: { p_task_id: string; p_accept: boolean }
        Returns: undefined
      }
      refresh_task_instances: { Args: Record<string, never>; Returns: string }
      complete_task_instance: {
        Args: { p_instance_id: string }
        Returns: CompletionResult
      }
      cancel_task: { Args: { p_task_id: string }; Returns: undefined }
      is_space_member: { Args: { p_space_id: string }; Returns: boolean }
      is_partner: { Args: { p_user_id: string }; Returns: boolean }
      create_couple_space: { Args: Record<string, never>; Returns: string }
      create_couple_invitation: { Args: { p_email: string }; Returns: string }
      inspect_couple_invitation: {
        Args: { p_token: string }
        Returns: { space_id: string; expires_at: string }[]
      }
      resolve_couple_invitation: {
        Args: { p_token: string; p_accept: boolean }
        Returns: string
      }
      leave_couple_space: { Args: Record<string, never>; Returns: undefined }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
