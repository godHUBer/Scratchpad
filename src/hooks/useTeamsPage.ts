import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useToast } from '../contexts/ToastContext';
import { humanizeError } from '../lib/errors';
import { invitationUrl } from '../integrations/supabase/client';
import { activeTeamOf, teammatesOf, pendingInvitationsFor } from '../lib/teams';
import type { Invitation, WorkspaceWithMembership } from '../types';

/** The inline re-issued invite link shown after a token is rotated. */
export interface ReissuedInvite {
  id: string;
  url: string;
  expiresAt: string;
}

/**
 * All state and behaviour for the teams screen.
 *
 * The page component renders; this decides. Everything that talks to the
 * server, decides what is selected, or owns a modal lives here so the screen
 * stays a description of the UI rather than a mix of both. There was no way to
 * test any of this while it sat inside a 738-line component: the rules (which
 * team loads, when members are fetched, what happens after a delete) were only
 * observable by rendering the whole thing.
 */
export function useTeamsPage() {
  const { workspaceId: teamId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const {
    workspaces,
    loading,
    renameWorkspace,
    deleteTeam,
    leaveWorkspace,
    setActiveWorkspace,
    members,
    loadMembers,
    sentInvitations,
    loadInvitations,
    respondToInvitation,
    reissueInvitation,
    refresh,
  } = useWorkspaces();

  // ---- which modal is open ------------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteFor, setInviteFor] = useState<WorkspaceWithMembership | null>(null);
  const [membersFor, setMembersFor] = useState<WorkspaceWithMembership | null>(null);
  const [renameFor, setRenameFor] = useState<WorkspaceWithMembership | null>(null);
  const [deleteFor, setDeleteFor] = useState<WorkspaceWithMembership | null>(null);
  const [leaveFor, setLeaveFor] = useState<WorkspaceWithMembership | null>(null);

  /** Any request in flight that should block the dialogs. */
  const [busy, setBusy] = useState(false);
  /** Which team's card menu is open on the left. Only one at a time. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [reissued, setReissued] = useState<ReissuedInvite | null>(null);

  // ---- derived ------------------------------------------------------------
  const teammates = useMemo(() => teammatesOf(workspaces), [workspaces]);
  const selected = useMemo(() => activeTeamOf(teammates, teamId), [teammates, teamId]);
  const selectedInvitations = useMemo(
    () => (selected ? pendingInvitationsFor(sentInvitations, selected.id) : []),
    [sentInvitations, selected],
  );

  // ---- effects ------------------------------------------------------------

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  useEffect(() => {
    // Landing on /teams with no team in the URL used to render a dead "Pick a
    // team" panel even when teams existed. Select the first one on arrival; the
    // URL still drives everything after that.
    const first = teammates[0];
    if (!teamId && first) {
      navigate(`/teams/${first.id}`, { replace: true });
    }
  }, [teamId, teammates, navigate]);

  useEffect(() => {
    if (selected) void loadMembers(selected.id);
  }, [selected, loadMembers]);

  // ---- actions ------------------------------------------------------------

  /**
   * Runs an action with the shared busy flag and a toast on failure.
   *
   * Every handler below had the same try/catch/finally shape spelled out by
   * hand. Collapsing it removes the chance of forgetting to clear `busy`, which
   * would leave every dialog permanently disabled.
   */
  const run = useCallback(
    async (action: () => Promise<void>, failureMessage?: string) => {
      setBusy(true);
      try {
        await action();
      } catch (err) {
        toast.error(failureMessage ?? humanizeError(err));
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const create = useCallback(
    (createdId: string) => {
      setCreateOpen(false);
      toast.success('Team created — you are the owner.');
      navigate(`/teams/${createdId}`);
    },
    [navigate, toast],
  );

  const rename = useCallback(
    async (name: string, description: string) => {
      if (!renameFor) return;
      // Deliberately not wrapped in `run`: the modal shows its own inline error
      // and must stay open on failure, so it needs the rejection.
      await renameWorkspace(renameFor.id, name, description);
      toast.success('Team updated.');
      setRenameFor(null);
    },
    [renameFor, renameWorkspace, toast],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteFor) return;
    await run(async () => {
      await deleteTeam(deleteFor.id);
      toast.success('Team deleted.');
      setDeleteFor(null);
      if (selected?.id === deleteFor.id) navigate('/teams');
    });
  }, [deleteFor, deleteTeam, navigate, run, selected, toast]);

  const confirmLeave = useCallback(async () => {
    if (!leaveFor) return;
    await run(async () => {
      await leaveWorkspace(leaveFor.id);
      toast.success('You left the team.');
      setLeaveFor(null);
      navigate('/teams');
    });
  }, [leaveFor, leaveWorkspace, navigate, run, toast]);

  const revokeInvitation = useCallback(
    async (id: string) => {
      await run(async () => {
        await respondToInvitation(id, 'revoke');
        setReissued(null);
        toast.success('Invitation revoked.');
      });
    },
    [respondToInvitation, run, toast],
  );

  const reissueInvite = useCallback(
    async (id: string) => {
      await run(async () => {
        const result = await reissueInvitation(id);
        setReissued({ id, url: invitationUrl(result.token), expiresAt: result.expiresAt });
        toast.success('New link created — the old one no longer works.');
      });
    },
    [reissueInvitation, run, toast],
  );

  const openWorkspace = useCallback(
    (id: string) => {
      setActiveWorkspace(id);
      navigate(`/workspace/${id}`);
    },
    [navigate, setActiveWorkspace],
  );

  /** Open the invite dialog from the member list, closing the member list. */
  const inviteFromMembers = useCallback(() => {
    setInviteFor(membersFor);
    setMembersFor(null);
  }, [membersFor]);

  return {
    // data
    loading,
    teammates,
    selected,
    selectedInvitations,
    members,
    reissued,
    busy,
    // modal state
    createOpen,
    setCreateOpen,
    inviteFor,
    setInviteFor,
    membersFor,
    setMembersFor,
    renameFor,
    setRenameFor,
    deleteFor,
    setDeleteFor,
    leaveFor,
    setLeaveFor,
    menuFor,
    setMenuFor,
    // actions
    create,
    rename,
    confirmDelete,
    confirmLeave,
    revokeInvitation,
    reissueInvite,
    openWorkspace,
    inviteFromMembers,
    refresh,
  };
}

export type TeamsPageModel = ReturnType<typeof useTeamsPage>;

/** Narrow helper so a caller cannot accidentally pass the wrong list. */
export type TeamList = WorkspaceWithMembership[];
export type InvitationList = Invitation[];
