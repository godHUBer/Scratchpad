import { describe, expect, it } from 'vitest';
import {
  activeTeamOf,
  canManageTeam,
  invitationsForTeam,
  isTeamOwner,
  pendingInvitationsFor,
  teammatesOf,
} from './teams';
import type { Invitation, WorkspaceWithMembership } from '../types';

function workspace(over: Partial<WorkspaceWithMembership>): WorkspaceWithMembership {
  return {
    id: 'ws-1',
    name: 'Team',
    type: 'team',
    owner_id: 'u1',
    description: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    myRole: 'owner',
    memberCount: 1,
    ...over,
  } as WorkspaceWithMembership;
}

function invitation(over: Partial<Invitation>): Invitation {
  return {
    id: 'inv-1',
    workspace_id: 'ws-1',
    email: 'a@example.com',
    role: 'editor',
    status: 'pending',
    token: 'tok',
    invited_by: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    ...over,
  } as Invitation;
}

describe('teammatesOf', () => {
  it('keeps only team workspaces', () => {
    const result = teammatesOf([
      workspace({ id: 'a', type: 'team' }),
      workspace({ id: 'b', type: 'personal' }),
      workspace({ id: 'c', type: 'team' }),
    ]);
    expect(result.map((w) => w.id)).toEqual(['a', 'c']);
  });

  it('preserves server order', () => {
    const result = teammatesOf([
      workspace({ id: 'z' }),
      workspace({ id: 'a' }),
      workspace({ id: 'm' }),
    ]);
    expect(result.map((w) => w.id)).toEqual(['z', 'a', 'm']);
  });

  it('returns an empty list when there are no teams', () => {
    expect(teammatesOf([workspace({ type: 'personal' })])).toEqual([]);
  });
});

describe('activeTeamOf', () => {
  const teams = [workspace({ id: 'a' }), workspace({ id: 'b' })];

  it('finds the team the URL points at', () => {
    expect(activeTeamOf(teams, 'b')?.id).toBe('b');
  });

  it('returns null when the URL has no team, so the caller can redirect', () => {
    // Distinct from "not found": an absent id is what triggers selecting the
    // first team on arrival.
    expect(activeTeamOf(teams, undefined)).toBeNull();
  });

  it('returns null for an id that is not in the list, without falling back', () => {
    // Falling back to the first team here would silently show the wrong team's
    // members after a delete or a stale link.
    expect(activeTeamOf(teams, 'deleted-team')).toBeNull();
  });

  it('does not match on a near-miss id', () => {
    expect(activeTeamOf(teams, 'a ')).toBeNull();
  });
});

describe('pendingInvitationsFor', () => {
  const invitations = [
    invitation({ id: '1', workspace_id: 'ws-1', status: 'pending' }),
    invitation({ id: '2', workspace_id: 'ws-1', status: 'accepted' }),
    invitation({ id: '3', workspace_id: 'ws-2', status: 'pending' }),
    invitation({ id: '4', workspace_id: 'ws-1', status: 'revoked' }),
  ];

  it('keeps only pending invitations for the given team', () => {
    expect(pendingInvitationsFor(invitations, 'ws-1').map((i) => i.id)).toEqual(['1']);
  });

  it('returns nothing for a team with no pending invites', () => {
    expect(pendingInvitationsFor(invitations, 'ws-2').map((i) => i.id)).toEqual(['3']);
    expect(pendingInvitationsFor(invitations, 'ws-9')).toEqual([]);
  });
});

describe('invitationsForTeam', () => {
  it('keeps every status, unlike the pending helper', () => {
    const invitations = [
      invitation({ id: '1', workspace_id: 'ws-1', status: 'pending' }),
      invitation({ id: '2', workspace_id: 'ws-1', status: 'accepted' }),
      invitation({ id: '3', workspace_id: 'ws-2', status: 'pending' }),
    ];
    expect(invitationsForTeam(invitations, 'ws-1').map((i) => i.id)).toEqual(['1', '2']);
  });
});

describe('role helpers', () => {
  it('lets owners and editors manage a team', () => {
    expect(canManageTeam('owner')).toBe(true);
    expect(canManageTeam('editor')).toBe(true);
  });

  it('does not let a viewer or an unknown role manage', () => {
    expect(canManageTeam('viewer')).toBe(false);
    expect(canManageTeam(null)).toBe(false);
    expect(canManageTeam(undefined)).toBe(false);
  });

  it('reserves ownership for the owner only', () => {
    expect(isTeamOwner('owner')).toBe(true);
    expect(isTeamOwner('editor')).toBe(false);
    expect(isTeamOwner(null)).toBe(false);
  });
});
