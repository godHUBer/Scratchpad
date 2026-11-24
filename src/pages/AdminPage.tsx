import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/ui/Icon';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAdminConsole, type AdminUser, type AdminWorkspace } from '../hooks/useAdminConsole';
import { useToast } from '../contexts/ToastContext';
import { humanizeError } from '../lib/errors';
import { fullDate, relativeTime } from '../lib/format';
import {
  filterUsers,
  resultSummary,
  sortUsers,
  type SortDirection,
  type SortKey,
} from '../lib/adminUsers';

/**
 * Admin console.
 *
 * Reached from the sign-in page, and gated by a key that only exists as a
 * bcrypt hash in Postgres. Nothing here trusts the client: every action goes
 * through an RPC that re-checks the session token, and every action is written
 * to `admin_audit_log`.
 */
export function AdminPage() {
  const admin = useAdminConsole();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [tab, setTab] = useState<'users' | 'workspaces' | 'audit'>('users');
  const [passwordFor, setPasswordFor] = useState<AdminUser | null>(null);
  const [deleteUserFor, setDeleteUserFor] = useState<AdminUser | null>(null);
  const [deleteWorkspaceFor, setDeleteWorkspaceFor] = useState<AdminWorkspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('lastSeen');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  // The operator master switch gates the whole retention pipeline; per-workspace
  // opt-in (migration 0013) decides whose content it may touch.
  const { session: adminSession, loadRetention } = admin;
  useEffect(() => {
    if (adminSession) void loadRetention();
  }, [adminSession, loadRetention]);

  // Search + sort run on the rows the server already returned, so typing is
  // instant and does not hit the database on every keystroke.
  const visibleUsers = useMemo(
    () => sortUsers(filterUsers(admin.users, query), sortKey, sortDir),
    [admin.users, query, sortKey, sortDir],
  );

  /** Clicking the active column flips direction; a new column starts at its natural one. */
  const pickSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDir(key === 'lastSeen' ? 'desc' : 'asc');
  };

  // ---- gate -------------------------------------------------------------
  if (!admin.session) {
    return (
      <div className="mx-auto flex min-h-dvh-screen w-full max-w-md flex-col justify-center p-4">
        <div className="paper p-5">
          <div className="mb-3 flex items-center gap-2">
            <Icon name="settings" size={24} />
            <h1 className="text-2xl font-black">Admin access</h1>
          </div>
          <p className="mb-3 text-sm text-ink-soft">
            This page is separate from your normal account. The key is checked on the server and is not stored in the
            browser.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!key.trim()) return;
              setSigningIn(true);
              try {
                await admin.signIn(key);
                setKey('');
                toast.success('Admin session started.');
              } catch {
                // the hook surfaces the message; nothing else to do
              } finally {
                setSigningIn(false);
              }
            }}
          >
            <label className="label" htmlFor="admin-key">
              Admin key
            </label>
            <input
              id="admin-key"
              className="input font-mono text-xs"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              data-autofocus
            />
            {admin.error ? (
              <p className="mt-2 rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
                {admin.error}
              </p>
            ) : null}
            <button type="submit" className="btn btn-primary mt-3 w-full" disabled={signingIn || !key.trim()}>
              {signingIn ? 'Checking…' : 'Unlock admin console'}
            </button>
          </form>
          <p className="mt-3 text-[11px] text-ink-soft">
            Five wrong attempts in 15 minutes locks this form. Every attempt is recorded.
          </p>
          <Link to="/signin" className="tap-target mt-3 inline-flex items-center gap-1 text-xs font-bold underline">
            <Icon name="back" size={13} /> Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  // ---- console ----------------------------------------------------------
  const online = admin.users.filter((u) => u.is_online).length;
  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(success);
    } catch (err) {
      toast.error(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-3 sm:p-5">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Admin console</h1>
          <p className="page-subtitle">
            {resultSummary(visibleUsers.length, admin.users.length, query)} · {online} online now
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn min-h-9 px-3 py-1 text-sm" onClick={() => void admin.refresh()}>
            Refresh
          </button>
          <button type="button" className="btn min-h-9 px-3 py-1 text-sm" onClick={() => setRevokeOpen(true)}>
            Revoke all admin sessions
          </button>
          <button type="button" className="btn btn-danger min-h-9 px-3 py-1 text-sm" onClick={() => void admin.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['users', 'workspaces', 'audit'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`chip capitalize ${tab === t ? 'bg-mustard' : 'bg-paper'}`}
          >
            {t}
            {t === 'workspaces' ? ` (${admin.workspaces.length})` : ''}
          </button>
        ))}
      </div>

      {admin.error ? (
        <p className="mb-3 rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
          {admin.error}
        </p>
      ) : null}

      {tab === 'users' ? (
        <section className="paper p-3">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <label className="label" htmlFor="user-search">
                Search users
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="user-search"
                  className="input"
                  type="search"
                  placeholder="Email or name…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoComplete="off"
                />
                {query ? (
                  <button
                    type="button"
                    className="btn min-h-9 px-2 py-1 text-xs"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                  >
                    <Icon name="close" size={13} />
                  </button>
                ) : null}
              </div>
            </div>

            <div>
              <span className="label">Sort by</span>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['name', 'Name'],
                    ['lastSeen', 'Last online'],
                    ['joined', 'Joined'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pickSort(key)}
                    aria-pressed={sortKey === key}
                    className={`chip ${sortKey === key ? 'bg-mustard' : 'bg-paper'}`}
                  >
                    {label}
                    {sortKey === key ? (
                      <span className="ml-1 font-mono" aria-hidden>
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="btn min-h-9 px-2 py-1 text-xs"
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              title="Flip the sort direction"
            >
              {sortDir === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
            </button>
          </div>

          {/* A 44rem table cannot fit a phone. It scrolls, but a horizontal
              scroller with no cue looks like a clipped table, so the edge
              shadow and the hint line below make the overflow discoverable. */}
          <p className="mb-1 text-[11px] font-bold text-ink-soft sm:hidden">Swipe the table sideways for more →</p>
          <div
            className="app-scroll overflow-x-auto pb-1"
            style={{
              backgroundImage:
                'linear-gradient(to right, transparent 92%, rgba(8,8,8,0.12)), linear-gradient(to left, transparent 92%, rgba(8,8,8,0.12))',
              backgroundPosition: 'right center, left center',
              backgroundRepeat: 'no-repeat',
              backgroundSize: '24px 100%, 24px 100%',
            }}
            role="region"
            aria-label="Registered accounts"
            tabIndex={0}
          >
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr className="border-b-[3px] border-ink text-left text-xs uppercase tracking-wide">
                <th className="py-1.5 pr-2">Status</th>
                <th className="py-1.5 pr-2">Email</th>
                <th className="py-1.5 pr-2">Name</th>
                <th className="py-1.5 pr-2">Joined</th>
                <th className="py-1.5 pr-2">Last seen</th>
                <th className="py-1.5 pr-2">Content</th>
                <th className="py-1.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr key={user.user_id} className="border-b border-ink/15">
                  <td className="py-1.5 pr-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full border-2 border-ink ${
                          user.is_online ? 'bg-mint' : 'bg-ink/25'
                        }`}
                        aria-hidden
                      />
                      <span className="text-xs font-bold">{user.is_online ? 'Online' : 'Offline'}</span>
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{user.email}</td>
                  <td className="py-1.5 pr-2">{user.display_name}</td>
                  <td className="py-1.5 pr-2 text-xs text-ink-soft">{relativeTime(user.created_at)}</td>
                  <td className="py-1.5 pr-2 text-xs text-ink-soft">
                    {user.last_seen_at ? relativeTime(user.last_seen_at) : 'never'}
                  </td>
                  <td className="py-1.5 pr-2 text-xs text-ink-soft">
                    {user.workspace_count} ws · {user.item_count} items
                  </td>
                  <td className="py-1.5">
                    <span className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="btn min-h-7 px-2 py-0 text-xs"
                        onClick={() => setPasswordFor(user)}
                      >
                        Password
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger min-h-7 px-2 py-0 text-xs"
                        onClick={() => setDeleteUserFor(user)}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {admin.users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-sm text-ink-soft">
                    No registered accounts.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {visibleUsers.length === 0 ? (
            <p className="py-6 text-center text-sm font-bold text-ink-soft">
              {query ? `No account matches “${query.trim()}”.` : 'No accounts yet.'}
            </p>
          ) : null}
          </div>
        </section>
      ) : null}

      {tab === 'workspaces' ? (
        <section className="paper p-3">
          <div className="mb-3 rounded-xl border-2 border-ink/25 bg-cream p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-extrabold">Retention pipeline</p>
                <p className="text-xs text-ink-soft">
                  {admin.policy
                    ? admin.policy.enabled
                      ? 'Allowed to run. It still only touches workspaces whose owner switched it on.'
                      : 'Stopped for the whole deployment. No workspace is cleaned up.'
                    : 'Loading…'}
                </p>
              </div>
              <span className={`chip ${admin.policy?.enabled ? 'bg-mint' : 'bg-cream-deep'}`}>
                {admin.policy?.enabled ? 'Enabled' : 'Stopped'}
              </span>
            </div>
            {admin.policy ? (
              <button
                type="button"
                className="btn mt-2 min-h-8 px-3 py-0.5 text-xs"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await admin.setRetention(!admin.policy?.enabled);
                  } catch (err) {
                    toast.error(humanizeError(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {admin.policy.enabled ? 'Stop the pipeline' : 'Allow the pipeline to run'}
              </button>
            ) : null}
          </div>
          <p className="mb-1 text-[11px] font-bold text-ink-soft sm:hidden">Swipe the table sideways for more →</p>
          <div className="app-scroll overflow-x-auto pb-1" role="region" aria-label="Workspaces" tabIndex={0}>
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b-[3px] border-ink text-left text-xs uppercase tracking-wide">
                <th className="py-1.5 pr-2">Name</th>
                <th className="py-1.5 pr-2">Type</th>
                <th className="py-1.5 pr-2">Owner</th>
                <th className="py-1.5 pr-2">Members</th>
                <th className="py-1.5 pr-2">Items</th>
                <th className="py-1.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {admin.workspaces.map((ws) => (
                <tr key={ws.workspace_id} className="border-b border-ink/15">
                  <td className="py-1.5 pr-2 font-bold">{ws.name}</td>
                  <td className="py-1.5 pr-2 text-xs uppercase text-ink-soft">{ws.type}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{ws.owner_email}</td>
                  <td className="py-1.5 pr-2 text-xs">{ws.member_count}</td>
                  <td className="py-1.5 pr-2 text-xs">{ws.item_count}</td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      className="btn btn-danger min-h-7 px-2 py-0 text-xs"
                      onClick={() => setDeleteWorkspaceFor(ws)}
                    >
                      Delete team
                    </button>
                  </td>
                </tr>
              ))}
              {admin.workspaces.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-sm text-ink-soft">
                    No workspaces.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </section>
      ) : null}

      {tab === 'audit' ? (
        <section className="paper p-3">
          {admin.audit.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {admin.audit.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-ink/20 bg-cream px-2 py-1 text-xs"
                >
                  <span className="font-bold">{entry.action.replace(/_/g, ' ')}</span>
                  <span className="font-mono text-[11px] text-ink-soft">{entry.target_email ?? '—'}</span>
                  <span className="text-ink-soft">{fullDate(entry.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* ---- modals ---- */}
      <SetPasswordModal
        user={passwordFor}
        busy={busy}
        onClose={() => setPasswordFor(null)}
        onSave={async (value) => {
          if (!passwordFor) return;
          await run(() => admin.setPassword(passwordFor.user_id, value), 'Password changed.');
          setPasswordFor(null);
        }}
      />

      <ConfirmDialog
        open={deleteUserFor !== null}
        title={`Delete ${deleteUserFor?.email ?? ''}?`}
        destructive
        busy={busy}
        confirmLabel="Delete this account"
        requireTyped={deleteUserFor?.email}
        onClose={() => setDeleteUserFor(null)}
        onConfirm={async () => {
          if (!deleteUserFor) return;
          await run(() => admin.deleteUser(deleteUserFor.user_id), 'Account deleted.');
          setDeleteUserFor(null);
        }}
      >
        <p>
          This deletes the account and <strong>every workspace they own</strong> — canvas items, bookmarks, media links
          and invitations. Their membership in other people&apos;s teams is removed too.
        </p>
        <p className="mt-2 font-bold">There is no undo.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteWorkspaceFor !== null}
        title={`Delete “${deleteWorkspaceFor?.name ?? ''}”?`}
        destructive
        busy={busy}
        confirmLabel="Delete this team"
        onClose={() => setDeleteWorkspaceFor(null)}
        onConfirm={async () => {
          if (!deleteWorkspaceFor) return;
          await run(() => admin.deleteWorkspace(deleteWorkspaceFor.workspace_id), 'Team deleted.');
          setDeleteWorkspaceFor(null);
        }}
      >
        <p>
          {deleteWorkspaceFor?.item_count ?? 0} canvas items and {deleteWorkspaceFor?.member_count ?? 0} member
          {deleteWorkspaceFor?.member_count === 1 ? '' : 's'} will be removed. There is no undo.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={revokeOpen}
        title="Revoke every admin session?"
        destructive
        busy={busy}
        confirmLabel="Revoke all sessions"
        onClose={() => setRevokeOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await admin.revokeAdminSessions();
            toast.success('All admin sessions revoked, including this one.');
          } catch (err) {
            toast.error(humanizeError(err));
          } finally {
            setBusy(false);
            setRevokeOpen(false);
          }
        }}
      >
        <p>
          This includes <strong>your own session</strong> — you will be returned to the key screen. Use it if the key
          may have leaked.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** The only place a plaintext password exists, and only for a moment. */
function SetPasswordModal({
  user,
  busy,
  onClose,
  onSave,
}: {
  user: AdminUser | null;
  busy: boolean;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue('');
    setConfirm('');
    setError(null);
  }, [user]);

  const mismatch = value.length > 0 && confirm.length > 0 && value !== confirm;
  const tooShort = value.length > 0 && value.length < 8;

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title={`Change password for ${user?.email ?? ''}`}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || value.length < 8 || value !== confirm}
            onClick={async () => {
              setError(null);
              try {
                await onSave(value);
              } catch (err) {
                setError(humanizeError(err));
              }
            }}
          >
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm">
        The user is signed out everywhere immediately. Their existing password stops working.
      </p>
      <label className="label" htmlFor="admin-new-password">
        New password
      </label>
      <input
        id="admin-new-password"
        className="input"
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        data-autofocus
      />
      <label className="label mt-2" htmlFor="admin-confirm-password">
        Repeat it
      </label>
      <input
        id="admin-confirm-password"
        className="input"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      {tooShort ? <p className="mt-1 text-xs font-bold text-ink-soft">At least 8 characters.</p> : null}
      {mismatch ? <p className="mt-1 text-xs font-bold">The two passwords do not match.</p> : null}
      {error ? (
        <p className="mt-2 rounded-xl border-[3px] border-ink bg-coral px-3 py-2 text-sm font-bold" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
