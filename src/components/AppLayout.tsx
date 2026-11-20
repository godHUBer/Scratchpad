import { useState, type ReactNode } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useAuth } from '../contexts/AuthContext';
import { NavigationSidebar } from './NavigationSidebar';
import { CreateTeamModal } from './teams/CreateTeamModal';
import { JoinTeamModal } from './teams/JoinTeamModal';
import { useToast } from '../contexts/ToastContext';
import { Icon } from './ui/Icon';
import { humanizeError } from '../lib/errors';

/**
 * Shell for every signed-in page: header, slide-over navigation and the routed
 * page body.
 *
 * The page body comes from <Outlet />, NOT from a `children` prop. This element
 * is used as a pathless layout route in App.tsx, so React Router renders the
 * matched child route into the Outlet. Accepting `children` here (as an earlier
 * version did, rendered with `{null}`) silently produced an empty <main> and
 * made every page after sign-in — the canvas included — unreachable.
 */
export function AppLayout({ children }: { children?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const { currentWorkspace } = useWorkspaces();
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  return (
    <div className="flex h-dvh-screen flex-col overflow-hidden">
      {/* pt-safe/px-safe replace px-3 py-2 rather than stacking on it: they
          already include that padding plus the device inset. */}
      <header className="pt-safe px-safe sticky top-0 z-30 flex shrink-0 items-center justify-between gap-3 border-b-[3px] border-ink bg-cream/95 py-2 backdrop-blur-[2px] sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/workspace" className="flex items-center gap-2 rounded-xl px-1 py-0.5 hover:bg-paper">
            <Icon name="bookmarkShelf" size={22} />
            <span className="hidden text-lg font-black tracking-tight sm:inline">Scratchpad</span>
          </Link>
          {currentWorkspace ? (
            <span className="chip max-w-[46vw] gap-1 bg-paper" title={currentWorkspace.name}>
              <Icon name={currentWorkspace.type === 'personal' ? 'home' : 'users'} size={14} />
              <span className="truncate">{currentWorkspace.name}</span>
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs font-bold text-ink-soft md:inline" title={profile?.display_name}>
            {profile?.display_name}
          </span>
          <button
            type="button"
            className="btn h-11 min-h-11 w-11 px-0"
            aria-label="Open main navigation menu"
            aria-expanded={menuOpen}
            aria-controls="main-navigation"
            onClick={() => setMenuOpen(true)}
          >
            <span className="flex flex-col gap-[5px]" aria-hidden>
              <span className="block h-[3px] w-6 rounded bg-ink" />
              <span className="block h-[3px] w-6 rounded bg-ink" />
              <span className="block h-[3px] w-6 rounded bg-ink" />
            </span>
          </button>
        </div>
      </header>

      {/*
        min-h-0 is load-bearing: without it a flex child refuses to shrink below
        its content height, so the canvas scrolled the whole page instead of
        filling the space. This is what lets WorkspacePage use h-full instead of
        a hard-coded `calc(100vh - 61px)`.
      */}
      <main className="min-h-0 flex-1">
        <Outlet />
        {children}
      </main>

      <NavigationSidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenCreateTeam={() => {
          setMenuOpen(false);
          setCreateOpen(true);
        }}
        onJoinPrompt={() => {
          setMenuOpen(false);
          setJoinOpen(true);
        }}
      />

      <CreateTeamModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(workspaceId) => {
          setCreateOpen(false);
          toast.success('Team created — you are the owner.');
          navigate(`/workspace/${workspaceId}`);
        }}
      />

      <JoinTeamModal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onError={(message) => toast.error(message)}
        onGoToInvitations={() => {
          setJoinOpen(false);
          navigate('/invitations');
        }}
        onOpenLink={(url) => {
          // Same-document hash navigation keeps the SPA session intact.
          setJoinOpen(false);
          window.location.hash = url.slice(url.indexOf('#'));
        }}
      />
    </div>
  );
}

export function useHumanizedError() {
  return (error: unknown) => humanizeError(error);
}
