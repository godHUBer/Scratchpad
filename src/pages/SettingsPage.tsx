import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useToast } from '../contexts/ToastContext';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { roleLabel } from '../lib/permissions';
import { fullDate } from '../lib/format';
import { humanizeError } from '../lib/errors';
import { readAppConfig } from '../lib/config';
import { DeleteWorkspaceDialog } from '../components/teams/DeleteWorkspaceDialog';
import { RetentionSettings } from '../components/settings/RetentionSettings';
import type { WorkspaceWithMembership } from '../types';
import { Icon } from '../components/ui/Icon';

export function SettingsPage() {
  const { user, profile, updateProfile, signOut } = useAuth();
  const { workspaces, setActiveWorkspace, refresh } = useWorkspaces();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteFor, setDeleteFor] = useState<WorkspaceWithMembership | null>(null);
  const config = readAppConfig();

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateProfile({
        display_name: displayName.trim() || 'Teammate',
        avatar_url: avatarUrl.trim() || null,
      });
      toast.success('Profile saved.');
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-3 sm:p-5">
      <header>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Settings &amp; profile</h1>
        <p className="text-sm text-ink-soft">Your name and avatar show up for teammates and on the canvas.</p>
      </header>

      <section className="paper p-4">
        <div className="flex items-center gap-3">
          <Avatar name={profile?.display_name} url={profile?.avatar_url} size={56} />
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold">{profile?.display_name ?? 'Scratchpad user'}</p>
            <p className="truncate text-sm text-ink-soft">{user?.email}</p>
            <p className="text-[11px] font-bold text-ink-soft">
              {user?.created_at ? `Member since ${fullDate(user.created_at)}` : ''}
            </p>
          </div>
        </div>

        <form onSubmit={save} className="mt-4 space-y-3">
          <div>
            <label className="label" htmlFor="display-name">
              Display name
            </label>
            <input
              id="display-name"
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
              placeholder="How should we call you?"
            />
          </div>
          <div>
            <label className="label" htmlFor="avatar-url">
              Avatar URL <span className="font-normal text-ink-soft">(https image link)</span>
            </label>
            <input
              id="avatar-url"
              className="input"
              value={avatarUrl}
              onChange={(event) => setAvatarUrl(event.target.value)}
              placeholder="https://…"
              inputMode="url"
            />
            <p className="mt-1 text-xs text-ink-soft">
              Google sign-in fills this automatically. Uploads are not supported — Scratchpad stores links only.
            </p>
          </div>
          {error ? (
            <p className="rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </section>

      <section className="paper p-4">
        <h2 className="text-lg font-extrabold">Your workspaces</h2>
        <ul className="mt-2 space-y-1.5">
          {workspaces.map((workspace) => (
            <li key={workspace.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-ink/30 bg-cream px-2.5 py-1.5">
              <span className="truncate text-sm font-bold">
                <Icon name={workspace.type === 'personal' ? 'home' : 'users'} size={14} className="inline" /> {workspace.name}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="chip">{roleLabel(workspace.myRole)}</span>
                <Link
                  className="btn min-h-7 px-2 py-0.5 text-[11px]"
                  to={`/workspace/${workspace.id}`}
                  onClick={() => setActiveWorkspace(workspace.id)}
                >
                  Open
                </Link>
                {workspace.owner_id === user?.id ? (
                  <button
                    type="button"
                    className="btn btn-danger min-h-7 px-2 py-0.5 text-[11px]"
                    onClick={() => setDeleteFor(workspace)}
                    aria-label={`Delete ${workspace.name}`}
                  >
                    Delete
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <RetentionSettings />

      <section className="paper p-4">
        <h2 className="text-lg font-extrabold">Connection</h2>
        <dl className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="font-bold text-ink-soft">Supabase project</dt>
            <dd className="truncate font-mono">{config.supabaseUrl || 'not configured'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-bold text-ink-soft">Client key</dt>
            <dd className="truncate font-mono">{config.publishableKeyPreview || '—'}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-ink-soft">
          The publishable key is public by design. Row Level Security in Postgres decides what your account can read and
          write.
        </p>
      </section>

      <section className="paper p-4">
        <h2 className="text-lg font-extrabold">Session</h2>
        <p className="text-sm text-ink-soft">Signing out clears your session on this device.</p>
        <button type="button" className="btn btn-danger mt-2" onClick={() => setSignOutOpen(true)}>
          Sign out
        </button>
      </section>

      <DeleteWorkspaceDialog
        open={deleteFor !== null}
        workspace={deleteFor}
        isPersonal={(deleteFor?.type ?? 'personal') === 'personal'}
        onClose={() => setDeleteFor(null)}
        onDeleted={() => {
          setDeleteFor(null);
          void refresh();
        }}
      />

      <ConfirmDialog
        open={signOutOpen}
        title="Sign out?"
        confirmLabel="Sign out"
        onClose={() => setSignOutOpen(false)}
        onConfirm={async () => {
          await signOut();
          setSignOutOpen(false);
        }}
      >
        <p>You can sign back in with Google or your email and password.</p>
      </ConfirmDialog>
    </div>
  );
}
