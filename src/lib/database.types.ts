/** Schema snapshot for 20261019150000_auth_profiles_couples.sql.
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
type Table<Row, Insert, Update> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}
export type Database = {
  public: {
    Tables: {
      profiles: Table<
        Profile,
        { id: string; display_name?: string; avatar_url?: string | null },
        { display_name?: string; avatar_url?: string | null }
      >
      couple_spaces: Table<CoupleSpace, never, never>
      couple_members: Table<CoupleMember, never, never>
      couple_invitations: Table<CoupleInvitation, never, never>
    }
    Views: { [_ in never]: never }
    Functions: {
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
