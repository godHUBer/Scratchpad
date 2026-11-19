import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth, rememberPendingPath } from '../contexts/AuthContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useToast } from '../contexts/ToastContext';
import { fullDate, relativeTime } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { Spinner } from '../components/ui/Spinner';
import type { InvitationPreview } from '../types';
import { Icon } from '../components/ui/Icon';

/**
 * Public invitation landing page. Works before sign-in: the visitor sees which
 * team they are joining, then is asked to authenticate and the token is
 * preserved through the OAuth redirect.
 */
export function JoinInvitePage() {
  const { token = '' } = useParams();
  const { session, loading: authLoading, profile } = useAuth();
  const { previewInvitation, acceptInvitation } = useWorkspaces();
  const toast = useToast();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setState('invalid');
      return;
    }
    setState('loading');
    try {
      const result = await previewInvitation(token);
      if (!result) {
        setPreview(null);
        setState('invalid');
        return;
      }
      setPreview(result);
      setState('ready');
    } catch (err) {
      setError(humanizeError(err));
      setState('error');
    }
  }, [token, previewInvitation]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // preserve where the user was heading through any auth round trip
    if (!session) rememberPendingPath(`/invite/${token}`);
  }, [session, token]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const workspaceId = await acceptInvitation(token);
      toast.success('You joined the team.');
      navigate(`/workspace/${workspaceId}`, { replace: true });
    } catch (err) {
      const message = humanizeError(err);
      setError(message);
      toast.error(message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const emailMismatch =
    !!preview &&
    preview.email_bound &&
    !!session &&
    !!profile &&
    !!preview.status &&
    state === 'ready' &&
    false; // server already hides mismatched email-bound invites; kept for clarity

  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-xl">
        <Link to="/" className="mb-4 inline-flex items-center gap-2 rounded-xl px-2 py-1 font-black hover:bg-paper">
          <Icon name="bookmarkShelf" size={20} /> Scratchpad
        </Link>

        <div className="paper relative p-6">
          <span className="tape" aria-hidden />

          {state === 'loading' || authLoading ? (
            <Spinner label="Looking up this invitation…" />
          ) : state === 'invalid' ? (
            <div className="space-y-3">
              <h1 className="text-2xl font-black">This invitation isn’t valid</h1>
              <p className="text-sm text-ink-soft">
                The link may have been revoked, already used, expired, or was issued to a different email address. Ask
                the team owner for a fresh link.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link className="btn btn-primary" to="/invitations">
                  My invitations
                </Link>
                <Link className="btn" to="/workspace">
                  Go to my workspace
                </Link>
              </div>
            </div>
          ) : state === 'error' ? (
            <div className="space-y-3">
              <h1 className="text-2xl font-black">Something went wrong</h1>
              <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold">{error}</p>
              <button type="button" className="btn" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : preview ? (
            <div className="space-y-4">
              <p className="text-xs font-black uppercase tracking-widest text-ink-soft">Team invitation</p>
              <h1 className="text-2xl font-black leading-tight">
                Join <span className="underline decoration-mustard decoration-[5px]">{preview.workspace_name}</span>
              </h1>
              {preview.workspace_description ? (
                <p className="text-sm text-ink-soft">{preview.workspace_description}</p>
              ) : null}

              <dl className="grid gap-2 rounded-2xl border-[3px] border-ink bg-cream p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-ink-soft">Invited by</dt>
                  <dd className="font-extrabold">{preview.inviter_name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-ink-soft">Your role</dt>
                  <dd className="font-extrabold capitalize">{preview.role_offered}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-ink-soft">Expires</dt>
                  <dd className="font-extrabold" title={fullDate(preview.expires_at)}>
                    {relativeTime(preview.expires_at)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-bold text-ink-soft">Addressed to</dt>
                  <dd className="font-extrabold">{preview.email_bound ? 'a specific email' : 'anyone with the link'}</dd>
                </div>
              </dl>

              {preview.status !== 'pending' ? (
                <div className="space-y-3">
                  <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold">
                    {preview.status === 'expired'
                      ? 'This invitation has expired. Ask for a new link.'
                      : preview.status === 'accepted'
                        ? 'This invitation has already been accepted.'
                        : preview.status === 'revoked'
                          ? 'This invitation was revoked by the team.'
                          : 'This invitation was declined.'}
                  </p>
                  <Link className="btn" to="/workspace">
                    Go to my workspace
                  </Link>
                </div>
              ) : preview.already_member ? (
                <div className="space-y-3">
                  <p className="rounded-xl border-[3px] border-ink bg-mint px-3 py-2 text-sm font-bold">
                    You are already a member of this team.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => navigate(`/workspace/${preview.workspace_id}`)}
                  >
                    Open team workspace
                  </button>
                </div>
              ) : !session ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold">
                    Sign in to accept. Use the same email the invitation was sent to, if it was addressed.
                  </p>
                  <Link className="btn btn-primary w-full" to={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}>
                    Sign in to join
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {emailMismatch ? null : null}
                  <button type="button" className="btn btn-primary w-full" onClick={accept} disabled={busy}>
                    {busy ? 'Joining…' : `Join as ${preview.role_offered}`}
                  </button>
                  <p className="text-xs text-ink-soft">
                    Signing in as {profile?.display_name ?? '…'}. {preview.email_bound
                      ? 'This invitation is bound to the email it was sent to.'
                      : 'Anyone holding this link can accept it once.'}
                  </p>
                </div>
              )}

              {error ? (
                <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
