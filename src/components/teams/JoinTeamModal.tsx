import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { parseInviteLink } from '../../lib/inviteLink';

interface JoinTeamModalProps {
  open: boolean;
  onClose: () => void;
  onError: (message: string) => void;
  onGoToInvitations: () => void;
  onOpenLink: (url: string) => void;
}

/**
 * Joining happens through invitation links only (there is no public team
 * directory). This modal accepts either the full link or just the token.
 */
export function JoinTeamModal({ open, onClose, onError, onGoToInvitations, onOpenLink }: JoinTeamModalProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const token = parseInviteLink(value);
    if (!token) {
      setError('Paste the invitation link you received (it contains #/invite/…).');
      onError('That does not look like an invitation link.');
      return;
    }
    setError(null);
    setValue('');
    onOpenLink(`${window.location.origin}${import.meta.env.BASE_URL}#/invite/${token}`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Join a team"
      description="Scratchpad teams are invite-only. Paste the invitation link you were sent."
      footer={
        <>
          <button type="button" className="btn" onClick={onGoToInvitations}>
            See my invitations
          </button>
          <button type="submit" form="join-team-form" className="btn btn-primary">
            Open invitation
          </button>
        </>
      }
    >
      <form id="join-team-form" onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="invite-link">
            Invitation link or token
          </label>
          <input
            id="invite-link"
            className="input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://…/Scratchpad/#/invite/AbC123…"
            data-autofocus
          />
        </div>
        {error ? (
          <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-xs text-ink-soft">
            Invitations are addressed to a specific email, or open to anyone holding the link. You will see the team
            name before anything is joined.
          </p>
        )}
      </form>
    </Modal>
  );
}
