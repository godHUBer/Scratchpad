import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useToast } from '../contexts/ToastContext';
import { useTeamsPage } from '../hooks/useTeamsPage';
import { CreateTeamModal } from '../components/teams/CreateTeamModal';
import { InviteModal } from '../components/teams/InviteModal';
import { MemberListModal } from '../components/teams/MemberListModal';
import { InviteLinkPanel } from '../components/teams/InviteLinkPanel';
import { Avatar } from '../components/ui/Avatar';
import { Icon } from '../components/ui/Icon';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Modal } from '../components/ui/Modal';
import { PageLoader } from '../components/ui/Spinner';
import { fullDate, relativeTime } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { roleDescription, roleLabel } from '../lib/permissions';
import type { Invitation, MemberWithProfile, Role, WorkspaceWithMembership } from '../types';

export function TeamsPage() {
  const model = useTeamsPage();
  const {
    loading,
    teammates,
    selected,
    members,
    reissued,
    busy,
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
    create,
    rename,
    confirmDelete,
    confirmLeave,
    revokeInvitation,
    reissueInvite,
    openWorkspace,
    inviteFromMembers,
    refresh,
  } = model;

  const navigate = useNavigate();
  const { sentInvitations } = useWorkspaces();

  if (loading && teammates.length === 0) return <PageLoader />;

  return (
    <div className="mx-auto w-full max-w-6xl p-3 sm:p-5">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">My teams</h1>
          <p className="page-subtitle">Switch workspaces, manage members and invitations.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          + Create a team
        </button>
      </header>

      {teammates.length === 0 ? (
        <EmptyState
          icon="users"
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
            {teammates.map((team) => {
              const isManager = team.myRole === 'owner' || team.myRole === 'editor';
              const isActive = selected?.id === team.id;
              return (
                <li key={team.id} className="relative">
                  <div
                    className={`paper-flat p-3 transition-transform ${
                      isActive ? 'bg-mustard/40' : ''
                    }`}
                  >
                    {/* Selecting and acting are separate controls. Nesting the
                        action buttons inside the select button would be invalid
                        HTML and would make keyboard navigation ambiguous. */}
                    <button
                      type="button"
                      onClick={() => navigate(`/teams/${team.id}`)}
                      className="block w-full text-left"
                      aria-current={isActive ? 'true' : undefined}
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
                        <span className="chip">
                          {team.memberCount ?? 1} member{(team.memberCount ?? 1) === 1 ? '' : 's'}
                        </span>
                        <span>Created {relativeTime(team.created_at)}</span>
                      </div>
                    </button>

                    <div className="absolute bottom-2 right-2">
                      <TeamCardMenu
                        team={team}
                        open={menuFor === team.id}
                        canManage={isManager}
                        onToggle={() => setMenuFor(menuFor === team.id ? null : team.id)}
                        onClose={() => setMenuFor(null)}
                        onInvite={() => {
                          setMenuFor(null);
                          setInviteFor(team);
                        }}
                        onMembers={() => {
                          setMenuFor(null);
                          // Select the team first: MemberListModal reads the
                          // *active* workspace's members from the context.
                          navigate(`/teams/${team.id}`);
                          setMembersFor(team);
                        }}
                        onOpen={() => {
                          setMenuFor(null);
                          openWorkspace(team.id);
                        }}
                        onDelete={() => {
                          setMenuFor(null);
                          setDeleteFor(team);
                        }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <section className="paper-flat p-4">
            {selected ? (
              <TeamDetail
                team={selected}
                members={members}
                sentInvitations={sentInvitations.filter((i) => i.workspace_id === selected.id)}
                onOpen={() => openWorkspace(selected.id)}
                onInvite={() => setMembersFor(selected)}
                onDelete={() => setDeleteFor(selected)}
                onLeave={() => setLeaveFor(selected)}
                onRevoke={revokeInvitation}
                onRename={() => setRenameFor(selected)}
                onReissue={reissueInvite}
                reissued={reissued}
                onRefresh={() => void refresh()}
              />
            ) : (
              <EmptyState icon="users" title="Pick a team" compact>
                Select a team on the left to see its members, roles and invitations.
              </EmptyState>
            )}
          </section>
        </div>
      )}

      <CreateTeamModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={create}
      />

      <InviteModal open={inviteFor !== null} workspace={inviteFor} onClose={() => setInviteFor(null)} />

      <MemberListModal
        open={membersFor !== null}
        workspace={membersFor}
        onClose={() => setMembersFor(null)}
        onInvite={inviteFromMembers}
      />

      <RenameTeamModal
        team={renameFor}
        onClose={() => setRenameFor(null)}
        onSave={rename}
      />

      <ConfirmDialog
        open={deleteFor !== null}
        title={`Disband “${deleteFor?.name ?? ''}”?`}
        destructive
        busy={busy}
        confirmLabel="Disband this team"
        requireTyped={deleteFor?.name}
        onClose={() => setDeleteFor(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p>
          This deletes the team for <strong>every member</strong> — its canvas items, bookmarks, media links, join links
          and pending invitations.
        </p>
        <p className="mt-2 font-bold">There is no undo and no export.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={leaveFor !== null}
        title={`Leave “${leaveFor?.name ?? ''}”?`}
        destructive
        busy={busy}
        confirmLabel="Leave team"
        onClose={() => setLeaveFor(null)}
        onConfirm={() => void confirmLeave()}
      >
        <p>You will need a new invitation to get back in.</p>
      </ConfirmDialog>

    </div>
  );
}

function TeamDetail({
  team,
  members,
  sentInvitations,
  onOpen,
  onInvite,
  onDelete,
  onLeave,
  onRevoke,
  onReissue,
  onRename,
  reissued,
  onRefresh,
}: {
  team: WorkspaceWithMembership;
  members: MemberWithProfile[];
  sentInvitations: Invitation[];
  onOpen: () => void;
  onInvite: () => void;
  onDelete: () => void;
  onLeave: () => void;
  onRevoke: (id: string) => void;
  onReissue: (id: string) => void;
  onRename: () => void;
  reissued: { id: string; url: string; expiresAt: string } | null;
  onRefresh: () => void;
}) {
  const isOwner = team.myRole === 'owner';
  const canManage = isOwner || team.myRole === 'editor';
  const pending = sentInvitations.filter((i) => i.status === 'pending');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl font-black">{team.name}</h2>
          <p className="text-sm text-ink-soft">{team.description || 'No description yet.'}</p>
          <p className="mt-1 text-[11px] font-bold text-ink-soft">
            You are {roleLabel(team.myRole)} · {roleDescription(team.myRole)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-primary min-h-9 px-3 py-1 text-sm" onClick={onOpen}>
            Open canvas
          </button>
          {canManage ? (
            <button type="button" className="btn min-h-9 px-3 py-1 text-sm" onClick={onInvite}>
              Invite
            </button>
          ) : null}
        </div>
      </div>

      {/* ---- members: the dedicated management surface ---- */}
      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-ink-soft">Members</h3>
          <span className="text-[11px] font-bold text-ink-soft">{members.length}</span>
        </div>
        <ul className="space-y-1">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-ink/25 bg-cream px-2 py-1"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Avatar name={member.profile?.display_name ?? 'Member'} url={member.profile?.avatar_url ?? null} size={20} />
                <span className="truncate text-sm font-bold">{member.profile?.display_name ?? 'Member'}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className={`chip text-[10px] uppercase ${member.role === 'owner' ? 'bg-mustard' : ''}`}>
                  {roleLabel(member.role as Role)}
                </span>
                {canManage ? (
                  <MemberRoleSelect
                    member={member}
                    team={team}
                    isOwner={isOwner}
                    onChanged={onRefresh}
                  />
                ) : null}
              </span>
            </li>
          ))}
          {members.length === 0 ? <li className="text-xs text-ink-soft">Loading members…</li> : null}
        </ul>
        <p className="mt-1 text-[11px] text-ink-soft">
          {canManage
            ? 'Change a role from the dropdown. Removing members and transferring ownership live in Manage members.'
            : 'Only owners and editors can change roles.'}
        </p>
        <button type="button" className="btn mt-1.5 min-h-8 px-3 py-0.5 text-xs" onClick={onInvite} hidden={!canManage}>
          Manage members &amp; permissions
        </button>
      </section>

      {/* ---- join link ---- */}
      {canManage ? (
        <section className="rounded-xl border-[3px] border-ink bg-cream p-3">
          <h3 className="mb-1 text-xs font-black uppercase tracking-widest text-ink-soft">Join link</h3>
          <InviteLinkPanel workspaceId={team.id} canManage={canManage} />
        </section>
      ) : null}

      {/* ---- pending invitations ---- */}
      <section>
        <h3 className="mb-1 text-xs font-black uppercase tracking-widest text-ink-soft">
          Pending invitations ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p className="text-xs text-ink-soft">
            No invitations yet. A join link you create above will appear here so you can re-share or revoke it.
          </p>
        ) : (
          <ul className="space-y-1">
            {pending.map((invitation) => (
              <li
                key={invitation.id}
                className="rounded-xl border-2 border-ink/30 bg-paper px-2 py-1 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">
                    {invitation.invitee_email ?? 'Join link'} · {invitation.invitee_role}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-ink-soft">expires {relativeTime(invitation.expires_at)}</span>
                    {canManage ? (
                      <button
                        type="button"
                        className="font-bold underline decoration-mint decoration-2 underline-offset-2"
                        onClick={() => onReissue(invitation.id)}
                      >
                        get link
                      </button>
                    ) : null}
                    {canManage ? (
                      <button
                        type="button"
                        className="font-bold underline decoration-coral decoration-2 underline-offset-2"
                        onClick={() => onRevoke(invitation.id)}
                      >
                        revoke
                      </button>
                    ) : null}
                  </span>
                </div>
                {reissued?.id === invitation.id ? (
                  <div className="mt-1.5 space-y-0.5">
                    <input
                      readOnly
                      className="input select-all py-0.5 font-mono text-[11px]"
                      value={reissued.url}
                      aria-label="Re-issued invitation link"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <p className="text-[11px] text-ink-soft">
                      Live until {fullDate(reissued.expiresAt)}. The previous link for this invitation stopped working.
                    </p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- destructive zone ---- */}
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
              Disband team
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
          Only the owner can rename or disband this team — enforced by database policies, not just the buttons.
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

/**
 * Per-team actions on the list itself.
 *
 * These existed only inside the detail panel, which (because of the param bug)
 * nobody could open. Even fixed, reaching "delete this team" required selecting
 * it, scrolling the panel, then finding the button — so the actions live on the
 * card too, and the destructive one is labelled in the user's words.
 */
function TeamCardMenu({
  team,
  open,
  canManage,
  onToggle,
  onClose,
  onInvite,
  onMembers,
  onOpen,
  onDelete,
}: {
  team: WorkspaceWithMembership;
  open: boolean;
  canManage: boolean;
  onToggle: () => void;
  onClose: () => void;
  onInvite: () => void;
  onMembers: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const isOwner = team.myRole === 'owner';
  return (
    <div className="flex items-center">
      <button
        type="button"
        className="grid h-7 w-7 place-items-center rounded-lg border-2 border-transparent text-ink hover:border-ink hover:bg-paper"
        aria-label={`Actions for ${team.name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
      >
        <Icon name="settings" size={15} />
      </button>
      {open ? (
        <>
          {/* click-away layer; keeps the menu dismissible without a document listener */}
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={onClose}
          />
          <div
            role="menu"
            aria-label={`Actions for ${team.name}`}
            className="absolute right-0 top-8 z-50 w-52 rounded-xl border-[3px] border-ink bg-paper p-1 hard-shadow-sm"
          >
            <MenuItem onClick={onOpen}>Open canvas</MenuItem>
            {canManage ? <MenuItem onClick={onInvite}>Invite by email or link</MenuItem> : null}
            <MenuItem onClick={onMembers}>Manage members &amp; roles</MenuItem>
            {isOwner ? (
              <MenuItem onClick={onDelete} danger>
                Disband team
              </MenuItem>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs font-bold hover:bg-cream ${
        danger ? 'text-ink hover:bg-coral' : ''
      }`}
    >
      {children}
    </button>
  );
}

/** Inline role dropdown. Owners only: editors cannot promote or demote. */
function MemberRoleSelect({
  member,
  team,
  isOwner,
  onChanged,
}: {
  member: MemberWithProfile;
  team: WorkspaceWithMembership;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const { changeRole } = useWorkspaces();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // An owner's role is changed by transferring ownership, not by a dropdown:
  // there must be exactly one owner and the server enforces that.
  if (!isOwner || member.role === 'owner') return null;

  return (
    <select
      className="input min-h-7 w-auto px-1 py-0 text-[11px]"
      aria-label={`Role for ${member.profile?.display_name ?? 'member'}`}
      value={member.role}
      disabled={busy}
      onChange={async (event) => {
        setBusy(true);
        try {
          await changeRole(team.id, member.user_id, event.target.value as 'editor' | 'viewer');
          toast.success('Role updated.');
          onChanged();
        } catch (err) {
          toast.error(humanizeError(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <option value="editor">Editor</option>
      <option value="viewer">Viewer</option>
    </select>
  );
}
