import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { Avatar } from './ui/Avatar';
import { ThemeToggle } from './ui/ThemeToggle';
import { roleLabel } from '../lib/permissions';
import { CreateTeamModal } from './teams/CreateTeamModal';
import { Icon, type IconName } from './ui/Icon';

const ITEMS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/workspace', label: 'My Workspace', icon: 'home' },
  { to: '/teams', label: 'My Teams', icon: 'users' },
  { to: '/invitations', label: 'Invitations', icon: 'mail' },
  { to: '/bookmarks', label: 'Bookmarks', icon: 'bookmark' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

interface NavigationSidebarProps {
  open: boolean;
  onClose: () => void;
  onOpenCreateTeam: () => void;
  onJoinPrompt: () => void;
}

export function NavigationSidebar({ open, onClose, onOpenCreateTeam, onJoinPrompt }: NavigationSidebarProps) {
  const { user, profile, signOut } = useAuth();
  const { workspaces, currentWorkspace, setActiveWorkspace, receivedInvitations, loadInvitations, recentWorkspaceIds } =
    useWorkspaces();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const pendingCount = receivedInvitations.filter((invite) => invite.status === 'pending').length;

  if (!open) return null;

  const switchTo = (workspaceId: string) => {
    setActiveWorkspace(workspaceId);
    navigate('/workspace');
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/35" onClick={onClose} role="presentation" />
      <aside
        className="h-dvh-screen pt-safe pb-safe px-safe fixed right-0 top-0 z-50 flex w-[86vw] max-w-sm flex-col overflow-hidden border-l-[3px] border-ink bg-paper"
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between border-b-[3px] border-ink px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon name="bookmarkShelf" size={22} />
            <span className="text-lg font-black tracking-tight">Scratchpad</span>
          </div>
          <button type="button" className="btn tap-sm min-h-11 w-11 px-0" onClick={onClose} aria-label="Close menu">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="app-scroll flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-4 flex items-center gap-3 rounded-2xl border-[3px] border-ink bg-cream p-3">
            <Avatar name={profile?.display_name} url={profile?.avatar_url} size={40} />
            <div className="min-w-0">
              <p className="truncate font-extrabold">{profile?.display_name ?? 'Scratchpad user'}</p>
              <p className="truncate text-xs text-ink-soft" title={user?.email ?? undefined}>
                {user?.email}
              </p>
            </div>
          </div>

          <nav className="space-y-1">
            {ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center justify-between gap-2 rounded-xl border-[3px] px-3 py-2 font-bold transition-colors ${
                    isActive ? 'border-ink bg-mustard' : 'border-transparent hover:border-ink hover:bg-cream'
                  }`
                }
              >
                <span className="flex items-center gap-2">
                  <Icon name={item.icon} size={19} />
                  {item.label}
                </span>
                {item.to === '/invitations' && pendingCount > 0 ? (
                  <span className="chip chip-accent border-ink bg-coral text-ink-fixed">{pendingCount}</span>
                ) : null}
              </NavLink>
            ))}
          </nav>

          <div className="mt-5 border-t-[3px] border-dashed border-ink/30 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-widest text-ink-soft">Workspaces</h3>
              <span className="text-xs font-bold text-ink-soft">{workspaces.length}</span>
            </div>
            <ul className="space-y-1">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => switchTo(w.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-sm font-bold hover:bg-cream ${
                      currentWorkspace?.id === w.id ? 'bg-cream' : ''
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Icon name={w.type === 'personal' ? 'home' : 'users'} size={16} />
                      <span className="truncate">{w.name}</span>
                    </span>
                    <span className="chip shrink-0">{roleLabel(w.myRole)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 grid gap-1.5">
              <button type="button" className="btn min-h-9 px-3 py-1 text-sm" onClick={onOpenCreateTeam}>
                + Create a Team
              </button>
              <button type="button" className="btn min-h-9 gap-1.5 px-3 py-1 text-sm" onClick={onJoinPrompt}>
                <Icon name="link" size={16} />
                Join a Team
              </button>
            </div>
          </div>

          {recentWorkspaceIds.length > 1 ? (
            <div className="mt-5 border-t-[3px] border-dashed border-ink/30 pt-4">
              <h3 className="mb-2 text-xs font-black uppercase tracking-widest text-ink-soft">Recent workspaces</h3>
              <ul className="space-y-1 text-sm">
                {recentWorkspaceIds
                  .map((id) => workspaces.find((w) => w.id === id))
                  .filter((w): w is NonNullable<typeof w> => Boolean(w))
                  .slice(0, 5)
                  .map((w) => (
                    <li key={w.id}>
                      <button
                        type="button"
                        onClick={() => switchTo(w.id)}
                        className="w-full truncate rounded-lg px-2 py-1 text-left font-semibold hover:bg-cream"
                      >
                        {w.name}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="space-y-2 border-t-[3px] border-ink px-4 py-3">
          <Link
            to="/settings"
            onClick={onClose}
            className="block rounded-xl px-2 py-1 text-sm font-bold hover:bg-cream"
          >
            Account / Profile
          </Link>
          {/* Appearance sits with the other account-level controls. */}
          <ThemeToggle variant="row" />
          <button
            type="button"
            className="btn btn-danger min-h-9 w-full px-3 py-1 text-sm"
            onClick={async () => {
              onClose();
              await signOut();
              await loadInvitations();
              navigate('/signin');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

export function useCreateTeamModalState() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

export { CreateTeamModal };
