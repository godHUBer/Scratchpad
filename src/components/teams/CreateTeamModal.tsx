import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useWorkspaces } from '../../contexts/WorkspaceContext';
import { humanizeError } from '../../lib/errors';

interface CreateTeamModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (workspaceId: string) => void;
}

export function CreateTeamModal({ open, onClose, onCreated }: CreateTeamModalProps) {
  const { createTeam } = useWorkspaces();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give your team a name first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await createTeam(name.trim(), description.trim() || undefined);
      setName('');
      setDescription('');
      onCreated(id);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a team"
      description="Teams share one canvas, bookmark library and media links. You become the owner."
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="create-team-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create team'}
          </button>
        </>
      }
    >
      <form id="create-team-form" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="team-name">
            Team name
          </label>
          <input
            id="team-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="e.g. Studio Brainstorm"
            data-autofocus
            required
          />
          <p className="mt-1 text-xs text-ink-soft">{name.length}/80</p>
        </div>
        <div>
          <label className="label" htmlFor="team-description">
            Description <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <textarea
            id="team-description"
            className="input min-h-[84px]"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            placeholder="What is this team working on?"
          />
          <p className="mt-1 text-xs text-ink-soft">{description.length}/500</p>
        </div>
        {error ? (
          <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
