// Database types for the Supabase client. Keep in sync with /supabase/migrations.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<
        { id: string; display_name: string; avatar_url: string | null; created_at: string; updated_at: string },
        { id: string; display_name?: string; avatar_url?: string | null },
        { display_name?: string; avatar_url?: string | null }
      >;
      workspaces: Table<
        {
          id: string;
          name: string;
          description: string | null;
          type: 'personal' | 'team';
          owner_id: string;
          created_at: string;
          updated_at: string;
          retention_enabled: boolean;
        },
        { name: string; description?: string | null; type?: 'personal' | 'team'; owner_id: string; retention_enabled?: boolean },
        { name?: string; description?: string | null; owner_id?: string; retention_enabled?: boolean }
      >;
      workspace_members: Table<
        { id: string; workspace_id: string; user_id: string; role: 'owner' | 'editor' | 'viewer'; joined_at: string },
        { workspace_id: string; user_id: string; role?: 'owner' | 'editor' | 'viewer' },
        { role?: 'owner' | 'editor' | 'viewer' }
      >;
      canvas_items: Table<
        {
          id: string;
          workspace_id: string;
          item_type: string;
          position_x: number;
          position_y: number;
          width: number;
          height: number;
          content: Json;
          bookmark_id: string | null;
          media_asset_id: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
          version: number;
          deleted_at?: string | null;
          purge_after?: string | null;
        },
        {
          workspace_id: string;
          item_type: string;
          position_x?: number;
          position_y?: number;
          width?: number;
          height?: number;
          content?: Json;
          bookmark_id?: string | null;
          media_asset_id?: string | null;
          created_by: string;
        },
        { content?: Json; version?: number }
      >;
      bookmarks: Table<
        {
          id: string;
          workspace_id: string;
          title: string;
          url: string;
          description: string | null;
          category: string | null;
          color: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          workspace_id: string;
          title: string;
          url: string;
          description?: string | null;
          category?: string | null;
          color?: string;
          created_by: string;
        },
        { title?: string; url?: string; description?: string | null; category?: string | null; color?: string }
      >;
      media_assets: Table<
        {
          id: string;
          workspace_id: string;
          uploaded_by: string;
          original_url: string;
          drive_file_id: string | null;
          file_name: string | null;
          file_type: 'image' | 'audio' | 'video' | 'link';
          mime_type: string | null;
          created_at: string;
        },
        {
          workspace_id: string;
          uploaded_by: string;
          original_url: string;
          drive_file_id?: string | null;
          file_name?: string | null;
          file_type: 'image' | 'audio' | 'video' | 'link';
          mime_type?: string | null;
        },
        { original_url?: string; file_type?: 'image' | 'audio' | 'video' | 'link' }
      >;
      invitations: Table<
        {
          id: string;
          workspace_id: string;
          invited_by: string;
          token_hash: string;
          invitee_email: string | null;
          invitee_user_id: string | null;
          invitee_role: 'editor' | 'viewer';
          expires_at: string;
          status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
          accepted_by: string | null;
          accepted_at: string | null;
          created_at: string;
        },
        {
          workspace_id: string;
          invited_by: string;
          token_hash: string;
          invitee_role?: 'editor' | 'viewer';
        },
        never
      >;
    };
    Views: {
      invitations_safe: {
        Row: {
          id: string;
          workspace_id: string;
          invited_by: string;
          invitee_email: string | null;
          invitee_user_id: string | null;
          invitee_role: 'editor' | 'viewer';
          expires_at: string;
          status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
          accepted_by: string | null;
          accepted_at: string | null;
          created_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      ensure_personal_workspace: { Args: Record<string, never>; Returns: string };
      create_team: { Args: { p_name: string; p_description?: string | null }; Returns: string };
      rename_workspace: { Args: { p_workspace_id: string; p_name: string; p_description?: string | null }; Returns: undefined };
      delete_team: { Args: { p_workspace_id: string }; Returns: undefined };
      delete_workspace: { Args: { p_workspace_id: string }; Returns: undefined };
      reissue_invitation_token: {
        Args: { p_invitation_id: string };
        Returns: Array<{ token: string; expires_at: string }>;
      };
      get_or_create_team_invite_link: {
        Args: { p_workspace_id: string; p_role?: string; p_rotate?: boolean };
        Returns: Array<{
          invitation_id: string;
          token: string;
          expires_at: string;
          role_offered: string;
        }>;
      };
      heartbeat: { Args: Record<string, never>; Returns: undefined };
      admin_login: {
        Args: { p_key: string };
        Returns: Array<{ token: string | null; expires_at: string | null; reason: string | null }>;
      };
      admin_logout: { Args: { p_token: string }; Returns: undefined };
      admin_list_users: {
        Args: { p_token: string };
        Returns: Array<{
          user_id: string;
          email: string;
          display_name: string;
          created_at: string;
          last_sign_in_at: string | null;
          last_seen_at: string | null;
          is_online: boolean;
          workspace_count: number;
          item_count: number;
        }>;
      };
      admin_list_workspaces: {
        Args: { p_token: string };
        Returns: Array<{
          workspace_id: string;
          name: string;
          type: string;
          owner_email: string;
          member_count: number;
          item_count: number;
          created_at: string;
        }>;
      };
      admin_list_audit: {
        Args: { p_token: string; p_limit?: number };
        Returns: Array<{
          id: number;
          action: string;
          target_email: string | null;
          detail: Record<string, unknown>;
          created_at: string;
        }>;
      };
      admin_delete_user: { Args: { p_token: string; p_user_id: string }; Returns: undefined };
      admin_set_password: { Args: { p_token: string; p_user_id: string; p_new_password: string }; Returns: undefined };
      admin_delete_workspace: { Args: { p_token: string; p_workspace_id: string }; Returns: undefined };
      admin_revoke_sessions: { Args: { p_token: string }; Returns: number };
      get_retention_policy: {
        Args: Record<string, never>;
        Returns: {
          cold_after_days: number;
          trash_after_days: number;
          purge_after_days: number;
          enabled: boolean;
          updated_at: string;
        };
      };
      get_workspace_retention: {
        Args: { p_workspace_id: string };
        Returns: Array<{
          enabled: boolean;
          cold_after_days: number;
          trash_after_days: number;
          purge_after_days: number;
          can_manage: boolean;
        }>;
      };
      set_workspace_retention: {
        Args: { p_workspace_id: string; p_enabled: boolean };
        Returns: boolean;
      };
      admin_set_retention: {
        Args: { p_token: string; p_enabled: boolean };
        Returns: {
          cold_after_days: number;
          trash_after_days: number;
          purge_after_days: number;
          enabled: boolean;
          updated_at: string;
        };
      };
      restore_canvas_item: { Args: { p_item_id: string }; Returns: Database['public']['Tables']['canvas_items']['Row'] };
      list_trashed_items: { Args: { p_workspace_id: string }; Returns: Array<Database['public']['Tables']['canvas_items']['Row']> };
      leave_workspace: { Args: { p_workspace_id: string }; Returns: undefined };
      remove_member: { Args: { p_workspace_id: string; p_user_id: string }; Returns: undefined };
      set_member_role: { Args: { p_workspace_id: string; p_user_id: string; p_role: string }; Returns: undefined };
      transfer_ownership: { Args: { p_workspace_id: string; p_new_owner: string }; Returns: undefined };
      create_invitation: {
        Args: { p_workspace_id: string; p_role?: string; p_invitee_email?: string | null; p_expires_in_days?: number };
        Returns: Array<{ invitation_id: string; token: string; expires_at: string }>;
      };
      accept_invitation: { Args: { p_token: string }; Returns: string };
      accept_addressed_invitation: { Args: { p_invitation_id: string }; Returns: string };
      respond_to_invitation: { Args: { p_invitation_id: string; p_action: string }; Returns: boolean };
      get_invitation_preview: {
        Args: { p_token: string };
        Returns: Array<{
          status: string;
          workspace_id: string;
          workspace_name: string;
          workspace_description: string | null;
          inviter_name: string;
          role_offered: 'editor' | 'viewer';
          expires_at: string;
          email_bound: boolean;
          already_member: boolean;
        }>;
      };
      expire_stale_invitations: { Args: Record<string, never>; Returns: number };
      create_canvas_item: {
        Args: {
          p_workspace_id: string;
          p_item_type: string;
          p_position_x: number;
          p_position_y: number;
          p_width: number;
          p_height: number;
          p_content?: Json;
          p_bookmark_id?: string | null;
          p_media_asset_id?: string | null;
        };
        Returns: Database['public']['Tables']['canvas_items']['Row'];
      };
      update_canvas_item: {
        Args: { p_item_id: string; p_expected_version: number; p_patch: Json };
        Returns: Database['public']['Tables']['canvas_items']['Row'];
      };
      delete_canvas_item: { Args: { p_item_id: string }; Returns: undefined };
      duplicate_canvas_item: {
        Args: { p_item_id: string; p_offset?: number };
        Returns: Database['public']['Tables']['canvas_items']['Row'];
      };
      move_canvas_items: {
        Args: { p_item_ids: string[]; p_moves: Json };
        Returns: Array<Database['public']['Tables']['canvas_items']['Row']>;
      };
      set_canvas_item_layer: { Args: { p_item_id: string; p_direction: string }; Returns: number };
      save_bookmark: {
        Args: {
          p_workspace_id: string;
          p_title: string;
          p_url: string;
          p_description?: string | null;
          p_category?: string | null;
          p_color?: string;
          p_id?: string | null;
        };
        Returns: Database['public']['Tables']['bookmarks']['Row'];
      };
      delete_bookmark: { Args: { p_bookmark_id: string }; Returns: number };
      bookmark_card_count: { Args: { p_bookmark_id: string }; Returns: number };
      save_media_asset: {
        Args: {
          p_workspace_id: string;
          p_original_url: string;
          p_file_type: string;
          p_drive_file_id?: string | null;
          p_file_name?: string | null;
          p_mime_type?: string | null;
          p_id?: string | null;
        };
        Returns: Database['public']['Tables']['media_assets']['Row'];
      };
      delete_media_asset: { Args: { p_media_id: string }; Returns: number };
      media_card_count: { Args: { p_media_id: string }; Returns: number };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
