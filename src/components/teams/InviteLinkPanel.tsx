import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../ui/Icon';
import { useToast } from '../../contexts/ToastContext';
import { useWorkspaces } from '../../contexts/WorkspaceContext';
import { humanizeError } from '../../lib/errors';
import { invitationUrl } from '../../integrations/supabase/client';
import { fullDate } from '../../lib/format';

/**
 * The shareable join link for a team.
 *
 * The old UI could only show a link in the one dialog that created it, because
 * the database stores a hash and never the token. Anyone who closed that dialog
 * had no way back to the link — which is exactly what "the link to join the team
 * is not appearing on My teams" described.
 *
 * So the link is fetched, not remembered: `get_or_create_team_invite_link` mints
 * a fresh token on demand and returns it. That means the link shown here is
 * always live and always the *only* live one — asking again changes it. The UI
 * says so plainly, and offers an explicit "New link" that does the same thing
 * deliberately, rather than silently invalidating a link someone already sent.
 */
export function InviteLinkPanel({
  workspaceId,
  canManage,
  compact = false,
}: {
  workspaceId: string;
  canManage: boolean;
  compact?: boolean;
}) {
  const toast = useToast();
  const { getTeamInviteLink } = useWorkspaces();
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A link fetched for one team must never be shown for another.
  useEffect(() => {
    setUrl(null);
    setExpiresAt(null);
    setError(null);
  }, [workspaceId]);

  const mint = useCallback(
    async (rotate: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const result = await getTeamInviteLink(workspaceId, role, rotate);
        setUrl(invitationUrl(result.token));
        setExpiresAt(result.expiresAt);
      } catch (err) {
        setError(humanizeError(err));
      } finally {
        setBusy(false);
      }
    },
    [getTeamInviteLink, workspaceId, role],
  );

  if (!canManage) {
    return (
      <p className="text-xs text-ink-soft">
        Only owners and editors can create a join link for this team.
      </p>
    );
  }

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Join link copied.');
    } catch {
      // Clipboard access is blocked outside a secure context; the field is
      // selectable, so this is a nudge rather than a failure.
      toast.info('Copying was blocked by the browser — select the link and copy it manually.');
    }
  };

  return (
    <div className="space-y-2">
      {!compact ? (
        <p className="text-xs text-ink-soft">
          Anyone with this link can join as {role === 'editor' ? 'an editor' : 'a viewer'}. Scratchpad has no mail
          server, so share it however you like.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <label className="sr-only" htmlFor={`link-role-${workspaceId}`}>
          Role offered by the link
        </label>
        <select
          id={`link-role-${workspaceId}`}
          className="input min-h-8 w-auto px-2 py-0.5 text-xs"
          value={role}
          disabled={busy}
          onChange={(event) => {
            setRole(event.target.value as 'editor' | 'viewer');
            // The issued role is baked into the token; an old link offering
            // editor must not be presented after switching to viewer.
            setUrl(null);
            setExpiresAt(null);
          }}
        >
          <option value="editor">Can edit</option>
          <option value="viewer">Can view</option>
        </select>
        <button
          type="button"
          className="btn btn-primary min-h-8 px-3 py-0.5 text-xs"
          disabled={busy}
          onClick={() => void mint(false)}
        >
          {busy ? 'Working…' : url ? 'Show a fresh link' : 'Create join link'}
        </button>
        {url ? (
          <button type="button" className="btn min-h-8 px-3 py-0.5 text-xs" onClick={() => void copy()}>
            <Icon name="copy" size={13} className="mr-1 inline" /> Copy
          </button>
        ) : null}
      </div>

      {url ? (
        <div className="space-y-1">
          <label className="sr-only" htmlFor={`link-url-${workspaceId}`}>
            Join link
          </label>
          <input
            id={`link-url-${workspaceId}`}
            readOnly
            className="input select-all font-mono text-xs"
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="text-[11px] text-ink-soft">
            {expiresAt ? <>Live until {fullDate(expiresAt)}. </> : null}
            Asking for a new link replaces this one — any link you sent earlier stops working.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-ink-soft">
          No link is shown until you ask for one. Links expire and each new one replaces the last.
        </p>
      )}

      {error ? (
        <p className="rounded-xl border-[3px] border-ink bg-coral px-2 py-1 text-xs font-bold" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
