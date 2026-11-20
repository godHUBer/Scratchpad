// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Regression tests for the "my teams" reports.
 *
 * The headline bug was a one-word mismatch: the route is `/teams/:workspaceId`
 * but the page read `useParams().teamId`, so `selected` was always null. The URL
 * changed on click, the panel did not, and with more than one team it looked
 * like you could only ever reach the first one. Nothing in the type system or the
 * linter can catch that — only rendering the real route can.
 */

const mocks = vi.hoisted(() => {
  const noop = vi.fn(async () => undefined);
  return {
    noop,
    navigate: vi.fn(),
    workspaces: [
      { id: 'team-a', name: 'Team Alpha', type: 'team', owner_id: 'me', description: 'First', myRole: 'owner', memberCount: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { id: 'team-b', name: 'Team Beta', type: 'team', owner_id: 'me', description: 'Second', myRole: 'owner', memberCount: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ],
  };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('../contexts/WorkspaceContext', () => ({
  useWorkspaces: () => ({
    workspaces: mocks.workspaces,
    loading: false,
    members: [{ id: 'm1', workspace_id: 'team-a', user_id: 'me', role: 'owner', joined_at: '', profile: { id: 'me', display_name: 'Me', avatar_url: null } }],
    sentInvitations: [],
    loadInvitations: mocks.noop,
    loadMembers: mocks.noop,
    respondToInvitation: mocks.noop,
    reissueInvitation: mocks.noop,
    refresh: mocks.noop,
    renameWorkspace: mocks.noop,
    deleteTeam: mocks.noop,
    leaveWorkspace: mocks.noop,
    setActiveWorkspace: vi.fn(),
    getTeamInviteLink: vi.fn(async () => ({ token: 'tok', expiresAt: new Date().toISOString(), invitationId: 'i1' })),
    changeRole: mocks.noop,
  }),
}));

import { TeamsPage } from './TeamsPage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:workspaceId" element={<TeamsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// vitest `globals` is off in this repo, so RTL cannot register its own
// auto-cleanup — without this every test sees the previous test's DOM.
afterEach(cleanup);

beforeEach(() => {
  mocks.navigate.mockClear();
});

describe('TeamsPage', () => {
  it('opens the team named in the URL, not the "Pick a team" placeholder', async () => {
    renderAt('/teams/team-b');
    // The detail panel shows the selected team's name as a heading.
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Team Beta' })).toBeTruthy());
    expect(screen.queryByText(/Pick a team/i)).toBeNull();
  });

  it('navigates to a team when its card is clicked', async () => {
    // The report in its original form: click the second team, nothing happens.
    // `useNavigate` is mocked here, so "it works" means the page asked to go to
    // that team — combined with the URL-driven test above, that is the whole
    // contract. (Before the fix the click *did* navigate and the panel still did
    // not change, which is exactly why asserting on navigation alone would have
    // missed the bug; the heading test is the one that catches it.)
    renderAt('/teams/team-a');
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Team Alpha' })).toBeTruthy());

    const betaCard = screen.getByText('Team Beta').closest('button');
    expect(betaCard, 'the Team Beta card is a button').toBeTruthy();
    fireEvent.click(betaCard as HTMLElement);

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/teams/team-b'));
  });

  it('lists every team, so a second team is reachable', () => {
    renderAt('/teams/team-a');
    // The name appears twice (list card + detail heading), so assert on the
    // list specifically rather than "the text exists somewhere".
    // Several <ul>s exist on the page (teams, members, invitations); the team
    // list is the one holding both team names.
    const lists = screen.getAllByRole('list');
    const teamList = lists.find(
      (el) => within(el).queryByText('Team Alpha') && within(el).queryByText('Team Beta'),
    );
    expect(teamList, 'a list containing both teams').toBeTruthy();
    expect(within(teamList as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
  });

  it('redirects /teams to the first team instead of showing a dead panel', async () => {
    renderAt('/teams');
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/teams/team-a', { replace: true }));
  });

  it('offers a Disband control to the owner', async () => {
    renderAt('/teams/team-a');
    // Two Disband controls exist by design: the detail panel and the card menu
    // item. Either is fine; assert the detail panel's.
    const panel = await screen.findByRole('heading', { level: 2, name: 'Team Alpha' });
    const section = panel.closest('div[class*="space-y-4"]') ?? document.body;
    await waitFor(() => expect(within(section as HTMLElement).getByRole('button', { name: /Disband team/i })).toBeTruthy());
  });

  it('offers member and permission management', async () => {
    renderAt('/teams/team-a');
    expect(await screen.findByRole('button', { name: /Manage members & permissions/i })).toBeTruthy();
  });

  it('exposes the join link on the teams page itself', async () => {
    // The whole first report was that no link existed here.
    renderAt('/teams/team-a');
    expect(await screen.findByRole('button', { name: /Create join link/i })).toBeTruthy();
  });
});
