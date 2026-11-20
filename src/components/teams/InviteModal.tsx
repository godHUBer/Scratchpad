import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useWorkspaces } from '../../contexts/WorkspaceContext';
import { humanizeError } from '../../lib/errors';
import { invitationUrl } from '../../integrations/supabase/client';
import type { InviteRole, WorkspaceWithMembership } from '../../types';

interface InviteModalProps {
  open: boolean;
  workspace: WorkspaceWithMembership | null;
  onClose: () => void;
}

export function InviteModal({ open, workspace, onClose }: InviteModalProps) {
  const { createInvitation } = useWorkspaces();
  const [role, setRole] = useState<InviteRole>('editor');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; email: string | null; role: InviteRole; expiresAt: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  if (!workspace) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createInvitation({
        workspaceId: workspace.id,
        role,
        email: email.trim() || null,
        expiresInDays: days,
      });
      setResult({
        url: invitationUrl(created.token),
        email: email.trim() || null,
        role,
        expiresAt: created.expiresAt,
      });
      setCopied(false);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard can be blocked; the field is selectable as a fallback
      setCopied(false);
    }
  };

  const reset = () => {
    setResult(null);
    setEmail('');
    setError(null);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title={result ? 'Invitation ready' : `Invite people to ${workspace.name}`}
      description={
        result
          ? 'Copy the link and send it however you like. Invitations are single-use and expire automatically.'
          : 'Anyone with the link can join with the role you pick. Add an email to bind the invitation to that person.'
      }
      busy={busy}
      footer={
        result ? (
          <>
            <button type="button" className="btn mr-auto" onClick={reset}>
              Invite someone else
            </button>
            <button type="button" className="btn btn-primary" onClick={copy}>
              {copied ? 'Copied' : 'Copy invitation link'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="invite-form" className="btn btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create invitation'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="invite-result">
              Invitation link
            </label>
            <textarea
              id="invite-result"
              readOnly
              className="input min-h-[84px] font-mono text-xs"
              value={result.url}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
          <dl className="grid gap-1 rounded-2xl border-[3px] border-ink bg-cream p-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="font-bold text-ink-soft">Role</dt>
              <dd className="font-extrabold capitalize">{result.role}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-bold text-ink-soft">Addressed to</dt>
              <dd className="font-extrabold">{result.email ?? 'anyone with the link'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-bold text-ink-soft">Expires</dt>
              <dd className="font-extrabold">{new Date(result.expiresAt).toLocaleString()}</dd>
            </div>
          </dl>
          <p className="text-xs text-ink-soft">
            Scratchpad has no email server, so it cannot send this for you — share the link directly. You can revoke it
            any time from Invitations.
          </p>
        </div>
      ) : (
        <form id="invite-form" onSubmit={submit} className="space-y-3">
          <fieldset>
            <legend className="label">Role</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['editor', 'viewer'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRole(option)}
                  aria-pressed={role === option}
                  className={`btn min-h-12 flex-col items-start gap-0 px-3 py-2 text-left ${
                    role === option ? 'bg-mustard' : 'bg-paper'
                  }`}
                >
                  <span className="font-extrabold capitalize">{option}</span>
                  <span className="text-[11px] font-semibold text-ink-soft">
                    {option === 'editor' ? 'Can change everything on the canvas' : 'Can look, cannot change anything'}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="label" htmlFor="invite-email">
              Restrict to an email <span className="font-normal text-ink-soft">(optional)</span>
            </label>
            <input
              id="invite-email"
              type="email"
              className="input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@example.com"
              data-autofocus
            />
            <p className="mt-1 text-xs text-ink-soft">
              Leave empty for a shareable link. With an email, only that signed-in address can accept.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="invite-days">
              Expires in · {days} day{days === 1 ? '' : 's'}
            </label>
            <input
              id="invite-days"
              type="range"
              min={1}
              max={30}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="w-full accent-ink"
            />
          </div>

          {error ? (
            <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
