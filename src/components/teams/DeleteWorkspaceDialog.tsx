import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useToast } from '../../contexts/ToastContext';
import { useWorkspaces } from '../../contexts/WorkspaceContext';
import { humanizeError } from '../../lib/errors';
import type { WorkspaceWithMembership } from '../../types';

/**
 * Delete a workspace from anywhere — including the canvas itself.
 *
 * Why: deleting a team was only reachable from My teams, and a *personal*
 * workspace could not be deleted at all. Two different rules, one dialog:
 *
 *  - team   -> `delete_team` (owner only; enforced by the database, not here)
 *  - personal -> `delete_workspace`, added in migration 0010 so the canvas can
 *                offer the button too. Requires typing the workspace name.
 *
 * The confirmation deliberately asks for the name for every kind: deleting a
 * canvas is not undoable from the UI.
 */
export function DeleteWorkspaceDialog({
  open,
  workspace,
  isPersonal,
  onClose,
  onDeleted,
}: {
  open: boolean;
  workspace: WorkspaceWithMembership | null;
  isPersonal: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const { deleteTeam, deleteWorkspace } = useWorkspaces();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = workspace?.name ?? '';
  const matches = typed.trim() === name.trim() && name.trim().length > 0;

  const close = () => {
    setTyped('');
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (!workspace || !matches) return;
    setBusy(true);
    setError(null);
    try {
      if (isPersonal) await deleteWorkspace(workspace.id);
      else await deleteTeam(workspace.id);
      toast.success(isPersonal ? 'Workspace deleted.' : 'Team deleted.');
      setTyped('');
      onDeleted();
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open && Boolean(workspace)}
      onClose={close}
      title={isPersonal ? `Delete “${name}”?` : `Delete team “${name}”?`}
      description="Everything on this canvas is removed for every member. This cannot be undone."
      size="sm"
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy || !matches}>
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm font-semibold">
          Type <strong className="font-mono">{name}</strong> to confirm.
        </p>
        <input
          className="input"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={name}
          aria-label="Type the workspace name to confirm"
          data-autofocus
        />
        {isPersonal ? (
          <p className="rounded-xl border-[3px] border-ink bg-mustard/50 px-3 py-2 text-xs font-bold">
            This is your personal workspace. A fresh empty one is created automatically the next time you sign in.
          </p>
        ) : (
          <p className="text-xs text-ink-soft">
            Only the team owner can do this. Members lose access immediately.
          </p>
        )}
        {error ? (
          <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
