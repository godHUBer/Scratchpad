import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspaces } from '../../contexts/WorkspaceContext';
import { useToast } from '../../contexts/ToastContext';
import { roleDescription, roleLabel } from '../../lib/permissions';
import { humanizeError } from '../../lib/errors';
import { fullDate } from '../../lib/format';
import type { WorkspaceWithMembership } from '../../types';

interface MemberListModalProps {
  open: boolean;
  workspace: WorkspaceWithMembership | null;
  onClose: () => void;
  onInvite: () => void;
}

type PendingAction =
  | { kind: 'remove'; userId: string; name: string }
  | { kind: 'transfer'; userId: string; name: string }
  | { kind: 'leave' }
  | null;

export function MemberListModal({ open, workspace, onClose, onInvite }: MemberListModalProps) {
  const { members, removeMember, changeRole, transferOwnership, leaveWorkspace, currentRole } = useWorkspaces();
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  if (!workspace) return null;
  const isOwner = currentRole === 'owner';
  const isPersonal = workspace.type === 'personal';

  const run = async (work: () => Promise<void>, success: string, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      toast.success(success);
      after?.();
      setPending(null);
    } catch (err) {
      setError(humanizeError(err));
      toast.error(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`${workspace.name} · members`}
        description={isPersonal ? 'Your personal workspace is private to you.' : workspace.description ?? undefined}
        busy={busy}
        size="md"
        footer={
          <>
            {!isPersonal && !isOwner ? (
              <button
                type="button"
                className="btn btn-danger mr-auto"
                disabled={busy}
                onClick={() => setPending({ kind: 'leave' })}
              >
                Leave team
              </button>
            ) : null}
            {!isPersonal ? (
              <button type="button" className="btn btn-primary" onClick={onInvite} disabled={busy}>
                Invite people
              </button>
            ) : null}
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Close
            </button>
          </>
        }
      >
        {error ? (
          <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="space-y-2">
          {members.map((member) => {
            const isMe = member.user_id === user?.id;
            return (
              <li
                key={member.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border-[3px] border-ink bg-cream px-2.5 py-2"
              >
                <Avatar name={member.profile.display_name} url={member.profile.avatar_url} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">
                    {member.profile.display_name} {isMe ? <span className="chip ml-1">you</span> : null}
                  </p>
                  <p className="text-[11px] text-ink-soft" title={fullDate(member.joined_at)}>
                    Joined {fullDate(member.joined_at)} · {roleDescription(member.role)}
                  </p>
                </div>
                <span className="chip bg-paper">{roleLabel(member.role)}</span>

                {isOwner && !isMe && !isPersonal ? (
                  <span className="flex flex-wrap items-center gap-1">
                    <select
                      className="rounded-lg border-2 border-ink bg-paper px-1 py-1 text-xs font-bold"
                      value={member.role}
                      disabled={busy}
                      aria-label={`Change role for ${member.profile.display_name}`}
                      onChange={(event) => {
                        const role = event.target.value as 'editor' | 'viewer';
                        void run(
                          () => changeRole(workspace.id, member.user_id, role),
                          `${member.profile.display_name} is now a ${role}.`,
                        );
                      }}
                    >
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                    <button
                      type="button"
                      className="btn min-h-7 px-2 py-0.5 text-[11px]"
                      disabled={busy}
                      onClick={() => setPending({ kind: 'transfer', userId: member.user_id, name: member.profile.display_name })}
                    >
                      Make owner
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger min-h-7 px-2 py-0.5 text-[11px]"
                      disabled={busy}
                      onClick={() => setPending({ kind: 'remove', userId: member.user_id, name: member.profile.display_name })}
                    >
                      Remove
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-ink-soft">
          Owners can rename, invite, change roles, transfer ownership and delete the team. Editors change content.
          Viewers are read-only. These rules are enforced by database policies.
        </p>
      </Modal>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'leave' ? 'Leave this team?' : pending?.kind === 'transfer' ? 'Transfer ownership?' : 'Remove member?'}
        destructive={pending?.kind !== 'transfer'}
        busy={busy}
        confirmLabel={
          pending?.kind === 'leave' ? 'Leave team' : pending?.kind === 'transfer' ? 'Make owner' : 'Remove member'
        }
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === 'remove') {
            void run(() => removeMember(workspace.id, pending.userId), `${pending.name} was removed.`);
          } else if (pending.kind === 'transfer') {
            void run(
              () => transferOwnership(workspace.id, pending.userId),
              `${pending.name} is now the owner. You are an editor.`,
            );
          } else {
            void run(async () => {
              await leaveWorkspace(workspace.id);
              onClose();
            }, 'You left the team.');
          }
        }}
      >
        {pending?.kind === 'leave' ? (
          <p>You will lose access to this team's canvas until someone invites you again.</p>
        ) : pending?.kind === 'transfer' ? (
          <p>
            <strong>{pending.name}</strong> becomes the owner. You become an editor. Only the new owner can delete the
            team or transfer it back.
          </p>
        ) : pending ? (
          <p>
            <strong>{pending.name}</strong> loses access immediately. Their canvas objects stay in the workspace.
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
