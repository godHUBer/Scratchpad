import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useToast } from '../contexts/ToastContext';
import { CreateTeamModal } from '../components/teams/CreateTeamModal';
import { InviteModal } from '../components/teams/InviteModal';
import { MemberListModal } from '../components/teams/MemberListModal';
import { Avatar } from '../components/ui/Avatar';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Modal } from '../components/ui/Modal';
import { PageLoader } from '../components/ui/Spinner';
import { relativeTime } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { roleDescription, roleLabel } from '../lib/permissions';
import type { WorkspaceWithMembership } from '../types';

export function TeamsPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
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
  } = useWorkspaces();

  const [createOpen, setCreateOpen] = useState(false);
  const [inviteFor, setInviteFor] = useState<WorkspaceWithMembership | null>(null);
  const [membersFor, setMembersFor] = useState<WorkspaceWithMembership | null>(null);
  const [renameFor, setRenameFor] = useState<WorkspaceWithMembership | null>(null);
  const [deleteFor, setDeleteFor] = useState<WorkspaceWithMembership | null>(null);
  const [leaveFor, setLeaveFor] = useState<WorkspaceWithMembership | null>(null);
  const [busy, setBusy] = useState(false);

  const teammates = useMemo(() => workspaces.filter((w) => w.type === 'team'), [workspaces]);
  const selected = useMemo(
    () => teammates.find((w) => w.id === teamId) ?? null,
    [teammates, teamId],
  );

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  useEffect(() => {
    if (selected) void loadMembers(selected.id);
  }, [selected, loadMembers]);

  if (loading && workspaces.length === 0) return <PageLoader />;

  const handleDelete = async () => {
    if (!deleteFor) return;
    setBusy(true);
    try {
      await deleteTeam(deleteFor.id);
      toast.success('Team deleted.');
      setDeleteFor(null);
      if (selected?.id === deleteFor.id) navigate('/teams');
    } catch (err) {
      toast.error(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-3 sm:p-5">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">My teams</h1>
          <p className="text-sm text-ink-soft">Switch workspaces, manage members and invitations.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          + Create a team
        </button>
      </header>

      {teammates.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="No teams yet"
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              Create your first team
            </button>
          }
        >
          Teams get their own canvas, bookmark shelf and members. Create one, then invite people from the team card.
        </EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <ul className="space-y-2">
            {teammates.map((team) => (
              <li key={team.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/teams/${team.id}`)}
                  className={`paper-flat relative w-full p-3 text-left transition-transform hover:-translate-y-0.5 ${
                    selected?.id === team.id ? 'bg-mustard/40' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-extrabold">{team.name}</p>
                      <p className="line-clamp-2 text-xs text-ink-soft">
                        {team.description || 'No description yet.'}
                      </p>
                    </div>
                    <span className="chip shrink-0">{roleLabel(team.myRole)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-ink-soft">
                    <span className="chip">{team.memberCount ?? 1} member{(team.memberCount ?? 1) === 1 ? '' : 's'}</span>
                    <span>Created {relativeTime(team.created_at)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <section className="paper-flat p-4">
            {selected ? (
              <TeamDetail
                team={selected}
                isOwner={selected.myRole === 'owner'}
                isMeOwner={selected.owner_id === user?.id}
                members={members}
                sentInvitations={sentInvitations.filter((i) => i.workspace_id === selected.id)}
                onOpen={() => {
                  setActiveWorkspace(selected.id);
                  navigate(`/workspace/${selected.id}`);
                }}
                onInvite={() => setInviteFor(selected)}
                onMembers={() => setMembersFor(selected)}
                onRename={() => setRenameFor(selected)}
                onDelete={() => setDeleteFor(selected)}
                onLeave={() => setLeaveFor(selected)}
                onRevoke={async (id) => {
                  try {
                    await respondToInvitation(id, 'revoke');
                    toast.success('Invitation revoked.');
                  } catch (err) {
                    toast.error(humanizeError(err));
                  }
                }}
              />
            ) : (
              <EmptyState emoji="👈" title="Pick a team" compact>
                Select a team on the left to see its members, roles and invitations.
              </EmptyState>
            )}
          </section>
        </div>
      )}

      <CreateTeamModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          toast.success('Team created — you are the owner.');
          navigate(`/teams/${id}`);
        }}
      />

      <InviteModal open={inviteFor !== null} workspace={inviteFor} onClose={() => setInviteFor(null)} />

      <MemberListModal
        open={membersFor !== null}
        workspace={membersFor}
        onClose={() => setMembersFor(null)}
        onInvite={() => {
          setInviteFor(membersFor);
          setMembersFor(null);
        }}
      />

      <RenameTeamModal
        team={renameFor}
        onClose={() => setRenameFor(null)}
        onSave={async (name, description) => {
          if (!renameFor) return;
          await renameWorkspace(renameFor.id, name, description);
          toast.success('Team updated.');
          setRenameFor(null);
        }}
      />

      <ConfirmDialog
        open={deleteFor !== null}
        title={`Delete “${deleteFor?.name ?? ''}”?`}
        destructive
        busy={busy}
        confirmLabel="Delete team permanently"
        onClose={() => setDeleteFor(null)}
        onConfirm={() => void handleDelete()}
      >
        <p>
          This removes the team, its canvas items, bookmarks, media links and pending invitations for every member. This
          cannot be undone.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={leaveFor !== null}
        title={`Leave “${leaveFor?.name ?? ''}”?`}
        destructive
        busy={busy}
        confirmLabel="Leave team"
        onClose={() => setLeaveFor(null)}
        onConfirm={async () => {
          if (!leaveFor) return;
          setBusy(true);
          try {
            await leaveWorkspace(leaveFor.id);
            toast.success('You left the team.');
            setLeaveFor(null);
            navigate('/teams');
          } catch (err) {
            toast.error(humanizeError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>You will need a new invitation to get back in.</p>
      </ConfirmDialog>

    </div>
  );
}

function TeamDetail({
  team,
  isOwner,
  members,
  sentInvitations,
  onOpen,
  onInvite,
  onMembers,
  onRename,
  onDelete,
  onLeave,
  onRevoke,
}: {
  team: WorkspaceWithMembership;
  isOwner: boolean;
  isMeOwner: boolean;
  members: { id: string; user_id: string; role: string; profile: { display_name: string; avatar_url: string | null } }[];
  sentInvitations: { id: string; status: string; invitee_email: string | null; invitee_role: string; expires_at: string }[];
  onOpen: () => void;
  onInvite: () => void;
  onMembers: () => void;
  onRename: () => void;
  onDelete: () => void;
  onLeave: () => void;
  onRevoke: (id: string) => void;
}) {
  const pending = sentInvitations.filter((i) => i.status === 'pending');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-black">{team.name}</h2>
          <p className="text-sm text-ink-soft">{team.description || 'No description yet.'}</p>
          <p className="mt-1 text-[11px] font-bold text-ink-soft">{roleDescription(team.myRole)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-primary min-h-9 px-3 py-1 text-sm" onClick={onOpen}>
            Open canvas
          </button>
          <button type="button" className="btn min-h-9 px-3 py-1 text-sm" onClick={onInvite}>
            Invite
          </button>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-widest text-ink-soft">Members</h3>
          <button type="button" className="text-xs font-bold underline" onClick={onMembers}>
            manage
          </button>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {members.map((member) => (
            <li key={member.id} className="chip gap-1.5 bg-cream py-1 pl-1">
              <Avatar name={member.profile.display_name} url={member.profile.avatar_url} size={20} />
              <span className="max-w-[120px] truncate">{member.profile.display_name}</span>
              <span className="text-[10px] uppercase text-ink-soft">{member.role}</span>
            </li>
          ))}
          {members.length === 0 ? <li className="text-xs text-ink-soft">Loading members…</li> : null}
        </ul>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-black uppercase tracking-widest text-ink-soft">
          Pending invitations ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p className="text-xs text-ink-soft">No pending invitations.</p>
        ) : (
          <ul className="space-y-1">
            {pending.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-ink/30 bg-paper px-2 py-1 text-xs"
              >
                <span className="font-bold">
                  {invitation.invitee_email ?? 'Anyone with the link'} · {invitation.invitee_role}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-ink-soft">expires {relativeTime(invitation.expires_at)}</span>
                  <button
                    type="button"
                    className="font-bold underline decoration-coral decoration-2 underline-offset-2"
                    onClick={() => onRevoke(invitation.id)}
                  >
                    revoke
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t-[3px] border-dashed border-ink/25 pt-3">
        <Link to="/invitations" className="btn min-h-8 px-3 py-0.5 text-xs">
          All invitations
        </Link>
        {isOwner ? (
          <>
            <button type="button" className="btn min-h-8 px-3 py-0.5 text-xs" onClick={onRename}>
              Rename
            </button>
            <button type="button" className="btn btn-danger min-h-8 px-3 py-0.5 text-xs" onClick={onDelete}>
              Delete team
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-danger min-h-8 px-3 py-0.5 text-xs" onClick={onLeave}>
            Leave team
          </button>
        )}
      </div>
      {!isOwner ? (
        <p className="text-[11px] text-ink-soft">
          Only the owner can rename or delete this team — enforced by database policies, not just the buttons.
        </p>
      ) : null}
    </div>
  );
}

function RenameTeamModal({
  team,
  onClose,
  onSave,
}: {
  team: WorkspaceWithMembership | null;
  onClose: () => void;
  onSave: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(team?.name ?? '');
    setDescription(team?.description ?? '');
    setError(null);
  }, [team]);

  return (
    <Modal
      open={team !== null}
      onClose={onClose}
      title="Edit team"
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSave(name.trim(), description);
              } catch (err) {
                setError(humanizeError(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="rename-name">
            Team name
          </label>
          <input
            id="rename-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            data-autofocus
          />
        </div>
        <div>
          <label className="label" htmlFor="rename-description">
            Description
          </label>
          <textarea
            id="rename-description"
            className="input min-h-[84px]"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
          />
        </div>
        {error ? (
          <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
