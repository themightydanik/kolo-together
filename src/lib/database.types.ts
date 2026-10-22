export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]
import type {
  Ritual,
  RitualConsent,
  RitualInstance,
  RitualTerms,
  RitualKind,
  RitualDecision,
  RitualPage,
  RitualCursor,
  RitualHistory,
  RitualHistoryCursor,
  RitualSummary,
} from '../features/rituals/model'
import type {
  Statistics,
  HistoryPage,
  HistoryCursor,
} from '../features/statistics/model'
/** Schema snapshot through 20261023120000_product_experience_catalog.sql.
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
  | 'pending'
  | 'active'
  | 'completed'
  | 'declined'
  | 'cancelled'
export type Difficulty = 'easy' | 'normal' | 'hard'
export type Recurrence = 'once' | 'daily' | 'weekly'
export type Category =
  | 'care'
  | 'home'
  | 'communication'
  | 'time'
  | 'growth'
  | 'other'
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
export type GoalCategory =
  | 'travel'
  | 'home'
  | 'relationship'
  | 'health'
  | 'learning'
  | 'other'
export type GoalStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'completed'
  | 'closed'
  | 'declined'
export type GoalChangeKind =
  | 'step_add'
  | 'step_edit'
  | 'reorder'
  | 'pause'
  | 'resume'
  | 'close'
  | 'complete'
export type GoalDecision = 'accept' | 'decline' | 'withdraw'
export type GoalPayload = {
  title?: string
  description?: string
  assignment?: 'me' | 'partner' | 'both'
  step_id?: string
  step_ids?: string[]
}
export type CoupleGoal = {
  id: string
  request_id: string
  space_id: string
  creator_id: string
  partner_id: string
  title: string
  description: string
  category: GoalCategory
  emoji: string
  target_date: string | null
  status: GoalStatus
  created_at: string
  completed_at: string | null
}
export type GoalConsent = {
  id: string
  goal_id: string
  request_id: string
  requester_id: string
  kind: GoalChangeKind | 'activate'
  payload: GoalPayload
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'void'
  created_at: string
  responded_at: string | null
}
export type GoalStep = {
  id: string
  goal_id: string
  title: string
  description: string
  position: number
  status: 'active' | 'completed'
  created_at: string
  completed_at: string | null
}
export type GoalStepParticipant = { step_id: string; user_id: string }
export type GoalStepCompletion = GoalStepParticipant & { completed_at: string }
export type GoalEvent = {
  id: string
  goal_id: string
  actor_id: string | null
  kind: string
  details: {
    kind?: GoalConsent['kind']
    consent_id?: string
    step_id?: string
    title?: string
  }
  created_at: string
}
export type GoalReward = {
  goal_id: string
  space_id: string
  together_xp: number
  created_at: string
}
export type GoalProgress = {
  goal_id: string
  total_steps: number
  completed_steps: number
  percent: number
}
type Table<Row, Insert, Update> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}
export type Database = {
  public: {
    Tables: {
      connection_catalog: Table<
        {
          kind: 'card' | 'questionnaire'
          id: string
          version: number
          content: Json
        },
        never,
        never
      >
      connection_moods: Table<
        {
          user_id: string
          day: string
          mood: string
          intensity: number
          note: string
          support: boolean
          shared: boolean
          member_id: string | null
          partner_member_id: string | null
          version: number
        },
        never,
        never
      >
      connection_reactions: Table<
        { owner_id: string; day: string; user_id: string; reaction: string },
        never,
        never
      >
      connection_sessions: Table<
        {
          id: string
          space_id: string
          a: string
          b: string
          am: string
          bm: string
          kind: 'game' | 'questionnaire'
          catalog_id: string | null
          status: string
          opt_a: boolean
          opt_b: boolean
          position: number
          game_catalog_version: number
          created_at: string
        },
        never,
        never
      >
      connection_answers: Table<
        {
          session_id: string
          user_id: string
          slot: number
          draft: Json
          submitted: boolean
          published: boolean
          skipped: boolean
          version: number
        },
        never,
        never
      >
      connection_deck: Table<
        {
          session_id: string
          position: number
          card_id: string
          drawn: boolean
        },
        never,
        never
      >
      connection_draws: Table<
        { session_id: string; slot: number; card_id: string },
        never,
        never
      >
      connection_events: Table<
        {
          session_id: string
          position: number
          sender: string
          recipient: string
          acknowledged: boolean
        },
        never,
        never
      >
      connection_requests: Table<
        { user_id: string; request_id: string; intent: Json; result: Json },
        never,
        never
      >

      couple_rituals: Table<Ritual, never, never>
      ritual_consents: Table<RitualConsent, never, never>
      ritual_instances: Table<RitualInstance, never, never>
      ritual_completions: Table<
        { instance_id: string; user_id: string; completed_at: string },
        never,
        never
      >
      statistics_history_sessions: Table<
        {
          id: string
          user_id: string
          context: string
          until_at: string
          created_at: string
          expires_at: string
        },
        never,
        never
      >
      statistics_seen: Table<
        {
          user_id: string
          context: string
          codes: string[]
          updated_at: string
        },
        never,
        never
      >
      couple_goals: Table<CoupleGoal, never, never>
      goal_consents: Table<GoalConsent, never, never>
      goal_steps: Table<GoalStep, never, never>
      goal_step_participants: Table<GoalStepParticipant, never, never>
      goal_step_completions: Table<GoalStepCompletion, never, never>
      goal_events: Table<GoalEvent, never, never>
      goal_reward_ledger: Table<GoalReward, never, never>
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
    Views: { goal_progress: { Row: GoalProgress; Relationships: [] } }
    Functions: {
      connection_access: { Args: { p_id: string }; Returns: boolean }
      connection_mood_access: {
        Args: { p_user: string; p_day: string }
        Returns: boolean
      }
      connection_answer_access: {
        Args: { p_id: string; p_user: string; p_slot: number }
        Returns: boolean
      }

      connection_action: {
        Args: {
          p_action: string
          p_id: string | null
          p_expected: number
          p_payload: Json
          p_request: string
        }
        Returns: Json
      }
      connection_read: {
        Args: { p_view: string; p_id: string | null; p_cursor: Json | null }
        Returns: Json
      }

      can_read_ritual: { Args: { p_ritual_id: string }; Returns: boolean }
      refresh_ritual_instances: { Args: Record<string, never>; Returns: string }
      create_couple_ritual: {
        Args: {
          p_request_id: string
          p_terms: RitualTerms
          p_expected_creations: number
        }
        Returns: string
      }
      propose_ritual_change: {
        Args: {
          p_ritual_id: string
          p_request_id: string
          p_kind: RitualKind
          p_terms: RitualTerms | Record<string, never>
          p_expected_changes: number
        }
        Returns: string
      }
      resolve_ritual_consent: {
        Args: { p_consent_id: string; p_decision: RitualDecision }
        Returns: undefined
      }
      complete_ritual_instance: {
        Args: { p_instance_id: string }
        Returns: undefined
      }
      withdraw_couple_ritual: {
        Args: { p_ritual_id: string }
        Returns: undefined
      }
      inspect_ritual_request: {
        Args: { p_request_id: string; p_ritual_id: string | null }
        Returns: { id: string; status: string } | null
      }
      list_couple_rituals: {
        Args: {
          p_filter: string
          p_cursor: RitualCursor | null
          p_limit: number
        }
        Returns: RitualPage
      }
      list_ritual_history: {
        Args: { p_cursor: RitualHistoryCursor | null; p_limit: number }
        Returns: RitualHistory
      }
      get_ritual_summary: {
        Args: Record<string, never>
        Returns: RitualSummary
      }
      get_statistics: { Args: Record<string, never>; Returns: Statistics }
      get_joint_history: {
        Args: { p_cursor: HistoryCursor | null; p_limit: number }
        Returns: HistoryPage
      }
      acknowledge_statistics: {
        Args: Record<string, never>
        Returns: string[]
      }
      inspect_goal_request: {
        Args: { p_request_id: string; p_goal_id: string | null }
        Returns: { id: string; status: string; kind: string } | null
      }
      can_read_goal: { Args: { p_goal_id: string }; Returns: boolean }
      can_read_goal_step: { Args: { p_step_id: string }; Returns: boolean }
      create_couple_goal: {
        Args: {
          p_request_id: string
          p_title: string
          p_description: string
          p_category: GoalCategory
          p_emoji: string
          p_target_date: string | null
          p_expected_goals: number
        }
        Returns: string
      }
      propose_goal_change: {
        Args: {
          p_goal_id: string
          p_request_id: string
          p_kind: GoalChangeKind
          p_payload: GoalPayload
          p_expected_changes: number
        }
        Returns: string
      }
      resolve_goal_consent: {
        Args: { p_consent_id: string; p_decision: GoalDecision }
        Returns: undefined
      }
      complete_goal_step: { Args: { p_step_id: string }; Returns: undefined }
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
        Args: {
          p_offer_id: string
          p_request_id: string
          p_expected_purchases: number
        }
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
