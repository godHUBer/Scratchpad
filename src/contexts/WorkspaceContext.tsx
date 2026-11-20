import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../integrations/supabase/client';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { humanizeError } from '../lib/errors';
import { readJson, readString, writeJson, writeString } from '../lib/storage';
import type {
  Invitation,
  InvitationPreview,
  MemberWithProfile,
  Profile,
  Role,
  Workspace,
  WorkspaceWithMembership,
} from '../types';

const ACTIVE_KEY = 'scratchpad.activeWorkspace';
const RECENT_KEY = 'scratchpad.recentWorkspaces';

interface WorkspaceContextValue {
  workspaces: WorkspaceWithMembership[];
  members: MemberWithProfile[];
  currentWorkspace: WorkspaceWithMembership | null;
  currentRole: Role | null;
  loading: boolean;
  error: string | null;
  createTeam: (name: string, description?: string) => Promise<string>;
  renameWorkspace: (id: string, name: string, description?: string | null) => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;
  /** Delete a personal workspace (teams go through deleteTeam). */
  deleteWorkspace: (id: string) => Promise<void>;
  setActiveWorkspace: (id: string | null) => void;
  refresh: () => Promise<void>;
  loadMembers: (workspaceId: string) => Promise<void>;
  removeMember: (workspaceId: string, userId: string) => Promise<void>;
  changeRole: (workspaceId: string, userId: string, role: 'editor' | 'viewer') => Promise<void>;
  transferOwnership: (workspaceId: string, userId: string) => Promise<void>;
  leaveWorkspace: (workspaceId: string) => Promise<void>;
  createInvitation: (input: {
    workspaceId: string;
    role: 'editor' | 'viewer';
    email?: string | null;
    expiresInDays?: number;
  }) => Promise<{ token: string; expiresAt: string; invitationId: string }>;
  /** Mint (or rotate) the shareable join link for a team. Returns a live token. */
  getTeamInviteLink: (
    workspaceId: string,
    role?: 'editor' | 'viewer',
    rotate?: boolean,
  ) => Promise<{ token: string; expiresAt: string; invitationId: string }>;
  /** Rotate one pending invitation's token; the previous link stops working. */
  reissueInvitation: (invitationId: string) => Promise<{ token: string; expiresAt: string }>;
  previewInvitation: (token: string) => Promise<InvitationPreview | null>;
  acceptInvitation: (token: string) => Promise<string>;
  acceptAddressedInvitation: (id: string) => Promise<string>;
  respondToInvitation: (id: string, action: 'decline' | 'revoke') => Promise<void>;
  sentInvitations: Invitation[];
  receivedInvitations: Invitation[];
  loadInvitations: () => Promise<void>;
  recentWorkspaceIds: string[];
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readRecent(): string[] {
  // Storage can throw (private mode, blocked third-party storage, quota). The
  // recent list is a convenience, so a failure must not break the workspace.
  return readJson(RECENT_KEY, [], (v): v is string[] => Array.isArray(v)).filter(
    (x): x is string => typeof x === 'string',
  );
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<WorkspaceWithMembership[]>([]);
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sentInvitations, setSentInvitations] = useState<Invitation[]>([]);
  const [receivedInvitations, setReceivedInvitations] = useState<Invitation[]>([]);
  const [recentWorkspaceIds, setRecentWorkspaceIds] = useState<string[]>(readRecent);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Make sure a personal workspace exists before listing (idempotent RPC).
      await supabase.rpc('ensure_personal_workspace');

      const { data: membershipRows, error: membershipError } = await supabase
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('user_id', user.id);
      if (membershipError) throw new Error(humanizeError(membershipError));

      const ids = (membershipRows ?? []).map((m) => m.workspace_id);
      if (ids.length === 0) {
        setWorkspaces([]);
        return;
      }

      const { data: workspaceRows, error: workspaceError } = await supabase
        .from('workspaces')
        .select('*')
        .in('id', ids)
        .order('created_at', { ascending: true });
      if (workspaceError) throw new Error(humanizeError(workspaceError));

      const { data: allMembers } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .in('workspace_id', ids);
      const counts = new Map<string, number>();
      for (const row of allMembers ?? []) {
        counts.set(row.workspace_id, (counts.get(row.workspace_id) ?? 0) + 1);
      }

      const roles = new Map((membershipRows ?? []).map((m) => [m.workspace_id, m.role as Role]));
      const list: WorkspaceWithMembership[] = ((workspaceRows ?? []) as Workspace[]).map((w) => ({
        ...w,
        myRole: roles.get(w.id) ?? 'viewer',
        memberCount: counts.get(w.id) ?? 1,
      }));
      list.sort((a, b) => (a.type === b.type ? a.created_at.localeCompare(b.created_at) : a.type === 'personal' ? -1 : 1));
      setWorkspaces(list);

      setActiveId((current) => {
        if (current && list.some((w) => w.id === current)) return current;
        const stored = readString(ACTIVE_KEY);
        if (stored && list.some((w) => w.id === stored)) return stored;
        const personal = list.find((w) => w.type === 'personal');
        return personal?.id ?? list[0]?.id ?? null;
      });
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  const setActiveWorkspace = useCallback((id: string | null) => {
    setActiveId(id);
    if (id) {
      writeString(ACTIVE_KEY, id);
      setRecentWorkspaceIds((prev) => {
        const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8);
        writeJson(RECENT_KEY, next);
        return next;
      });
    }
  }, []);

  const loadMembers = useCallback(async (workspaceId: string) => {
    const { data: rows, error: memberError } = await supabase
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('joined_at', { ascending: true });
    if (memberError) {
      toast.error(humanizeError(memberError));
      return;
    }
    const userIds = (rows ?? []).map((r) => r.user_id);
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);
    const profiles = new Map<string, Pick<Profile, 'id' | 'display_name' | 'avatar_url'>>(
      (profileRows ?? []).map((p) => [p.id, p]),
    );
    setMembers(
      (rows ?? []).map((row) => ({
        ...row,
        role: row.role as Role,
        profile: profiles.get(row.user_id) ?? {
          id: row.user_id,
          display_name: 'Teammate',
          avatar_url: null,
        },
      })),
    );
  }, [toast]);

  const currentWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId],
  );

  useEffect(() => {
    if (currentWorkspace) void loadMembers(currentWorkspace.id);
    else setMembers([]);
  }, [currentWorkspace, loadMembers]);

  const createTeam = useCallback(
    async (name: string, description?: string) => {
      const { data, error: rpcError } = await supabase.rpc('create_team', {
        p_name: name,
        p_description: description?.trim() ? description.trim() : null,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      await refresh();
      if (data) setActiveWorkspace(data);
      return data as string;
    },
    [refresh, setActiveWorkspace],
  );

  const renameWorkspace = useCallback(
    async (id: string, name: string, description?: string | null) => {
      const { error: rpcError } = await supabase.rpc('rename_workspace', {
        p_workspace_id: id,
        p_name: name,
        p_description: description?.trim() ? description.trim() : null,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      setWorkspaces((prev) => prev.map((w) => (w.id === id ? { ...w, name, description: description ?? null } : w)));
    },
    [],
  );

  const deleteTeam = useCallback(
    async (id: string) => {
      const { error: rpcError } = await supabase.rpc('delete_team', { p_workspace_id: id });
      if (rpcError) throw new Error(humanizeError(rpcError));
      if (activeId === id) setActiveId(null);
      await refresh();
    },
    [activeId, refresh],
  );

  const deleteWorkspace = useCallback(
    async (id: string) => {
      const { error: rpcError } = await supabase.rpc('delete_workspace', { p_workspace_id: id });
      if (rpcError) throw new Error(humanizeError(rpcError));
      if (activeId === id) setActiveId(null);
      await refresh();
    },
    [activeId, refresh],
  );

  const removeMember = useCallback(
    async (workspaceId: string, userId: string) => {
      const { error: rpcError } = await supabase.rpc('remove_member', {
        p_workspace_id: workspaceId,
        p_user_id: userId,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      await loadMembers(workspaceId);
    },
    [loadMembers],
  );

  const changeRole = useCallback(
    async (workspaceId: string, userId: string, role: 'editor' | 'viewer') => {
      const { error: rpcError } = await supabase.rpc('set_member_role', {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_role: role,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      await loadMembers(workspaceId);
    },
    [loadMembers],
  );

  const transferOwnership = useCallback(
    async (workspaceId: string, userId: string) => {
      const { error: rpcError } = await supabase.rpc('transfer_ownership', {
        p_workspace_id: workspaceId,
        p_new_owner: userId,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      await Promise.all([refresh(), loadMembers(workspaceId)]);
    },
    [refresh, loadMembers],
  );

  const leaveWorkspace = useCallback(
    async (workspaceId: string) => {
      const { error: rpcError } = await supabase.rpc('leave_workspace', { p_workspace_id: workspaceId });
      if (rpcError) throw new Error(humanizeError(rpcError));
      if (activeId === workspaceId) setActiveId(null);
      await refresh();
    },
    [activeId, refresh],
  );

  const createInvitation = useCallback(
    async (input: { workspaceId: string; role: 'editor' | 'viewer'; email?: string | null; expiresInDays?: number }) => {
      const { data, error: rpcError } = await supabase.rpc('create_invitation', {
        p_workspace_id: input.workspaceId,
        p_role: input.role,
        p_invitee_email: input.email?.trim() ? input.email.trim() : null,
        p_expires_in_days: input.expiresInDays ?? 7,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('The invitation could not be created.');
      await loadInvitations();
      return { token: row.token, expiresAt: row.expires_at, invitationId: row.invitation_id };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const getTeamInviteLink = useCallback(
    async (workspaceId: string, role: 'editor' | 'viewer' = 'editor', rotate = false) => {
      const { data, error: rpcError } = await supabase.rpc('get_or_create_team_invite_link', {
        p_workspace_id: workspaceId,
        p_role: role,
        p_rotate: rotate,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.token) throw new Error('Could not create a join link for this team.');
      await loadInvitations();
      return { token: row.token, expiresAt: row.expires_at, invitationId: row.invitation_id };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const reissueInvitation = useCallback(
    async (invitationId: string) => {
      const { data, error: rpcError } = await supabase.rpc('reissue_invitation_token', {
        p_invitation_id: invitationId,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.token) throw new Error('Could not re-issue that invitation link.');
      await loadInvitations();
      return { token: row.token, expiresAt: row.expires_at };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const previewInvitation = useCallback(async (token: string) => {
    const { data, error: rpcError } = await supabase.rpc('get_invitation_preview', { p_token: token });
    if (rpcError) throw new Error(humanizeError(rpcError));
    const row = Array.isArray(data) ? data[0] : undefined;
    if (!row) return null;
    return {
      status: row.status as InvitationPreview['status'],
      workspace_id: row.workspace_id,
      workspace_name: row.workspace_name,
      workspace_description: row.workspace_description,
      inviter_name: row.inviter_name,
      role_offered: row.role_offered,
      expires_at: row.expires_at,
      email_bound: row.email_bound,
      already_member: row.already_member,
    } satisfies InvitationPreview;
  }, []);

  const acceptInvitation = useCallback(
    async (token: string) => {
      const { data, error: rpcError } = await supabase.rpc('accept_invitation', { p_token: token });
      if (rpcError) throw new Error(humanizeError(rpcError));
      await refresh();
      if (data) setActiveWorkspace(data as string);
      return data as string;
    },
    [refresh, setActiveWorkspace],
  );

  const acceptAddressedInvitation = useCallback(
    async (id: string) => {
      const { data, error: rpcError } = await supabase.rpc('accept_addressed_invitation', { p_invitation_id: id });
      if (rpcError) throw new Error(humanizeError(rpcError));
      await refresh();
      if (data) setActiveWorkspace(data as string);
      return data as string;
    },
    [refresh, setActiveWorkspace],
  );

  const loadInvitations = useCallback(async () => {
    if (!user) {
      setSentInvitations([]);
      setReceivedInvitations([]);
      return;
    }
    await supabase.rpc('expire_stale_invitations');
    const { data, error: invError } = await supabase
      .from('invitations_safe')
      .select('*')
      .order('created_at', { ascending: false });
    if (invError) {
      toast.error(humanizeError(invError));
      return;
    }
    const rows = (data ?? []) as Invitation[];
    const email = user.email?.toLowerCase() ?? '';
    const sent: Invitation[] = [];
    const received: Invitation[] = [];
    const managedWorkspaceIds = new Set(
      workspaces.filter((w) => w.myRole === 'owner' || w.myRole === 'editor').map((w) => w.id),
    );
    for (const row of rows) {
      const addressedToMe =
        row.invitee_user_id === user.id || (!!row.invitee_email && row.invitee_email.toLowerCase() === email);
      if (addressedToMe) received.push(row);
      if (managedWorkspaceIds.has(row.workspace_id) || row.invited_by === user.id) sent.push(row);
    }
    setSentInvitations(sent);
    setReceivedInvitations(received);
  }, [user, workspaces, toast]);

  const respondToInvitation = useCallback(
    async (id: string, action: 'decline' | 'revoke') => {
      const { error: rpcError } = await supabase.rpc('respond_to_invitation', {
        p_invitation_id: id,
        p_action: action,
      });
      if (rpcError) throw new Error(humanizeError(rpcError));
      await loadInvitations();
    },
    [loadInvitations],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      members,
      currentWorkspace,
      currentRole: currentWorkspace?.myRole ?? null,
      loading: loading || authLoading,
      error,
      createTeam,
      renameWorkspace,
      deleteTeam,
      deleteWorkspace,
      setActiveWorkspace,
      refresh,
      loadMembers,
      removeMember,
      changeRole,
      transferOwnership,
      leaveWorkspace,
      createInvitation,
      getTeamInviteLink,
      reissueInvitation,
      previewInvitation,
      acceptInvitation,
      acceptAddressedInvitation,
      respondToInvitation,
      sentInvitations,
      receivedInvitations,
      loadInvitations,
      recentWorkspaceIds,
    }),
    [
      workspaces,
      members,
      currentWorkspace,
      loading,
      authLoading,
      error,
      createTeam,
      renameWorkspace,
      deleteTeam,
      deleteWorkspace,
      setActiveWorkspace,
      refresh,
      loadMembers,
      removeMember,
      changeRole,
      transferOwnership,
      leaveWorkspace,
      createInvitation,
      getTeamInviteLink,
      reissueInvitation,
      previewInvitation,
      acceptInvitation,
      acceptAddressedInvitation,
      respondToInvitation,
      sentInvitations,
      receivedInvitations,
      loadInvitations,
      recentWorkspaceIds,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaces(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspaces must be used inside WorkspaceProvider');
  return ctx;
}
