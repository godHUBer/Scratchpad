// Shared domain types. These mirror the SQL migrations in /supabase/migrations.

export type WorkspaceType = 'personal' | 'team';
export type Role = 'owner' | 'editor' | 'viewer';
export type InviteRole = 'editor' | 'viewer';
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
export type MediaKind = 'image' | 'audio' | 'video' | 'link';
export type CanvasItemType =
  | 'text'
  | 'draw'
  | 'image'
  | 'audio'
  | 'video'
  | 'bookmark'
  | 'media_link'
  | 'note';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  type: WorkspaceType;
  owner_id: string;
  created_at: string;
  updated_at: string;
  /** Owner opt-in for the 60 -> 90 -> 100 day cleanup job. Defaults to false. */
  retention_enabled: boolean;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
}

export interface MemberWithProfile extends WorkspaceMember {
  profile: Pick<Profile, 'id' | 'display_name' | 'avatar_url'>;
}

export interface Point {
  x: number;
  y: number;
}

/** Presentation-only payload. Business records live in bookmarks / media_assets. */
export interface TextContent {
  text?: string;
  fontSize?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** CSS font family/stack; absent means the historical Trebuchet default. */
  fontFamily?: string;
  z?: number;
}
export interface DrawContent {
  points?: number[];
  color?: string;
  strokeWidth?: number;
  z?: number;
  /**
   * Shapes share the `draw` item type rather than getting their own, because
   * `canvas_items.item_type` is constrained by a CHECK and adding a value means
   * a migration. See src/lib/shapes.ts. When present, `points` is absent.
   */
  shape?: 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'arrow' | 'star';
  filled?: boolean;
}
export interface CardContent {
  z?: number;
  caption?: string;
  color?: string;
}

export type CanvasContent = TextContent & DrawContent & CardContent;

export interface CanvasItem {
  id: string;
  workspace_id: string;
  item_type: CanvasItemType;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  content: CanvasContent;
  bookmark_id: string | null;
  media_asset_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
  /** Set when the row is in the Trash (retention pipeline, migration 0010). */
  deleted_at?: string | null;
  /** When the Trash is emptied for good. */
  purge_after?: string | null;
}

export interface Bookmark {
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
}

export interface MediaAsset {
  id: string;
  workspace_id: string;
  uploaded_by: string;
  original_url: string;
  drive_file_id: string | null;
  file_name: string | null;
  file_type: MediaKind;
  mime_type: string | null;
  created_at: string;
}

export interface Invitation {
  id: string;
  workspace_id: string;
  invited_by: string;
  invitee_email: string | null;
  invitee_user_id: string | null;
  invitee_role: InviteRole;
  expires_at: string;
  status: InvitationStatus;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

export interface InvitationPreview {
  status: InvitationStatus;
  workspace_id: string;
  workspace_name: string;
  workspace_description: string | null;
  inviter_name: string;
  role_offered: InviteRole;
  expires_at: string;
  email_bound: boolean;
  already_member: boolean;
}

export interface WorkspaceWithMembership extends Workspace {
  myRole: Role;
  memberCount?: number;
}
