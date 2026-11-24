import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useToast } from '../contexts/ToastContext';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageLoader } from '../components/ui/Spinner';
import { relativeTime, fullDate } from '../lib/format';
import { humanizeError } from '../lib/errors';
import type { Invitation, InvitationStatus } from '../types';

const STATUS_BG: Record<InvitationStatus, string> = {
  pending: 'bg-mustard',
  accepted: 'bg-mint',
  declined: 'bg-paper',
  revoked: 'bg-coral',
  expired: 'bg-cream-deep',
};

export function InvitationsPage() {
  const {
    workspaces,
    loading,
    sentInvitations,
    receivedInvitations,
    loadInvitations,
    respondToInvitation,
    acceptAddressedInvitation,
  } = useWorkspaces();
  const toast = useToast();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null);
  const [declineTarget, setDeclineTarget] = useState<Invitation | null>(null);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations, workspaces.length]);

  const workspaceName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? 'a workspace';

  const accept = async (invitation: Invitation) => {
    // Only invitations addressed to this account can be accepted without the
    // token. Shareable link invitations need the link itself, because the
    // server stores nothing but a hash of it (deliberately).
    if (!invitation.invitee_email && !invitation.invitee_user_id) {
      toast.info('This is a shareable link invite — open the link you were sent to join.');
      return;
    }
    setBusyId(invitation.id);
    try {
      const workspaceId = await acceptAddressedInvitation(invitation.id);
      toast.success('You joined the team.');
      navigate(`/workspace/${workspaceId}`);
    } catch (err) {
      toast.error(humanizeError(err));
    } finally {
      setBusyId(null);
    }
  };

  if (loading && workspaces.length === 0) return <PageLoader />;

  const pendingReceived = receivedInvitations.filter((i) => i.status === 'pending');

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-3 sm:p-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Invitations</h1>
          <p className="page-subtitle">Accept invites, track who you invited, and revoke links.</p>
        </div>
        <button type="button" className="btn" onClick={() => void loadInvitations()}>
          Refresh
        </button>
      </header>

      <section>
        <h2 className="mb-2 text-lg font-extrabold">
          Received{' '}
          <span className="chip bg-paper">{pendingReceived.length} pending</span>
        </h2>
        {receivedInvitations.length === 0 ? (
          <EmptyState icon="mail" title="No invitations yet" compact>
            When someone invites you, the invite appears here. Open the link from the message you received to join.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {receivedInvitations.map((invitation) => (
              <li key={invitation.id} className="paper-flat flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 font-extrabold">
                    {workspaceName(invitation.workspace_id)}
                    <span className={`chip ${STATUS_BG[invitation.status]}`}>{invitation.status}</span>
                  </p>
                  <p className="text-xs text-ink-soft">
                    Role offered: <strong className="capitalize">{invitation.invitee_role}</strong> ·{' '}
                    {invitation.status === 'pending'
                      ? `expires ${relativeTime(invitation.expires_at)}`
                      : fullDate(invitation.created_at)}
                    {invitation.invitee_email ? ` · for ${invitation.invitee_email}` : ' · shared link'}
                  </p>
                </div>
                {invitation.status === 'pending' ? (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="btn btn-primary min-h-8 px-3 py-0.5 text-xs"
                      disabled={busyId === invitation.id}
                      onClick={() => void accept(invitation)}
                    >
                      {busyId === invitation.id ? 'Joining…' : 'Accept'}
                    </button>
                    <button
                      type="button"
                      className="btn min-h-8 px-3 py-0.5 text-xs"
                      onClick={() => setDeclineTarget(invitation)}
                    >
                      Decline
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-extrabold">Sent by you</h2>
        {sentInvitations.length === 0 ? (
          <EmptyState icon="mail" title="You haven't invited anyone yet" compact>
            Open a team, then Invite, to create a link. You can bind it to an email or leave it shareable.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {sentInvitations.map((invitation) => (
              <li key={invitation.id} className="paper-flat flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 font-extrabold">
                    {workspaceName(invitation.workspace_id)}
                    <span className={`chip ${STATUS_BG[invitation.status]}`}>{invitation.status}</span>
                  </p>
                  <p className="text-xs text-ink-soft">
                    {invitation.invitee_email ?? 'Anyone with the link'} · as{' '}
                    <strong className="capitalize">{invitation.invitee_role}</strong> ·{' '}
                    {invitation.status === 'pending'
                      ? `expires ${relativeTime(invitation.expires_at)}`
                      : `created ${fullDate(invitation.created_at)}`}
                  </p>
                </div>
                {invitation.status === 'pending' ? (
                  <button
                    type="button"
                    className="btn btn-danger min-h-8 px-3 py-0.5 text-xs"
                    onClick={() => setRevokeTarget(invitation)}
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-soft">
          Invitation links are single-use. Copy or re-share a link from the team page; the full link is only shown once
          when it is created.
        </p>
      </section>

      <section className="paper-flat p-3 text-sm">
        <h2 className="font-extrabold">Join a team with a link</h2>
        <p className="text-ink-soft">
          Paste the invitation link you received. It opens a preview of the team before you join.
        </p>
        <Link className="btn btn-primary mt-2 min-h-9 px-3 py-1 text-sm" to="/teams">
          Go to My Teams
        </Link>
      </section>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke this invitation?"
        destructive
        confirmLabel="Revoke"
        onClose={() => setRevokeTarget(null)}
        onConfirm={async () => {
          if (!revokeTarget) return;
          try {
            await respondToInvitation(revokeTarget.id, 'revoke');
            toast.success('Invitation revoked.');
          } catch (err) {
            toast.error(humanizeError(err));
          } finally {
            setRevokeTarget(null);
          }
        }}
      >
        <p>The link stops working immediately. You can create a new invitation at any time.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={declineTarget !== null}
        title="Decline this invitation?"
        confirmLabel="Decline"
        onClose={() => setDeclineTarget(null)}
        onConfirm={async () => {
          if (!declineTarget) return;
          try {
            await respondToInvitation(declineTarget.id, 'decline');
            toast.success('Invitation declined.');
          } catch (err) {
            toast.error(humanizeError(err));
          } finally {
            setDeclineTarget(null);
          }
        }}
      >
        <p>The inviter will see that you declined. You can be invited again later.</p>
      </ConfirmDialog>
    </div>
  );
}
