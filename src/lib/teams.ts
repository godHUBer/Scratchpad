import type { Invitation, WorkspaceWithMembership } from '../types';

/**
 * Pure selection rules for the teams screen.
 *
 * These were inline `useMemo` bodies and filter calls inside a 738-line page
 * component, which meant the only way to check them was to render the page.
 * Pulling them out makes the rules explicit and directly testable — and the
 * `activeTeamOf` rule in particular had a bug once already (the route used to
 * read a `teamId` parameter that is always undefined, so the detail panel never
 * left "Pick a team").
 */

/** Every workspace that is a team, in the order the server returned them. */
export function teammatesOf(workspaces: WorkspaceWithMembership[]): WorkspaceWithMembership[] {
  return workspaces.filter((workspace) => workspace.type === 'team');
}

/**
 * The team the URL points at, or null when nothing matches.
 *
 * Returns null rather than the first team so the caller can distinguish "nothing
 * selected yet" (which triggers the redirect) from "an invalid id is in the URL"
 * (which should show the empty panel rather than silently switching teams).
 */
export function activeTeamOf(
  teammates: WorkspaceWithMembership[],
  teamId: string | undefined,
): WorkspaceWithMembership | null {
  if (!teamId) return null;
  return teammates.find((team) => team.id === teamId) ?? null;
}

/** Invitations that belong to one team and are still waiting to be accepted. */
export function pendingInvitationsFor(invitations: Invitation[], workspaceId: string): Invitation[] {
  return invitations.filter(
    (invitation) => invitation.workspace_id === workspaceId && invitation.status === 'pending',
  );
}

/** Sent invitations of any status, scoped to one team. */
export function invitationsForTeam(invitations: Invitation[], workspaceId: string): Invitation[] {
  return invitations.filter((invitation) => invitation.workspace_id === workspaceId);
}

/** True when the current member may manage the team: owner or editor. */
export function canManageTeam(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'editor';
}

/** True when the current member owns the team (and so may disband it). */
export function isTeamOwner(role: string | null | undefined): boolean {
  return role === 'owner';
}
