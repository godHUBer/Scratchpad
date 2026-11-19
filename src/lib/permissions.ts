import type { Role } from '../types';

export function canEdit(role: Role | null | undefined): boolean {
  return role === 'owner' || role === 'editor';
}

export function isOwner(role: Role | null | undefined): boolean {
  return role === 'owner';
}

export function canManageTeam(role: Role | null | undefined): boolean {
  return isOwner(role);
}

export function canInvite(role: Role | null | undefined): boolean {
  return canEdit(role);
}

export function roleLabel(role: Role): string {
  return role === 'owner' ? 'Owner' : role === 'editor' ? 'Editor' : 'Viewer';
}

export function roleDescription(role: Role): string {
  switch (role) {
    case 'owner':
      return 'Full control: rename, invite, change roles, transfer or delete the team.';
    case 'editor':
      return 'Can add, edit, move and delete everything on the canvas.';
    default:
      return 'Can view the workspace but cannot change anything.';
  }
}

/** Explains a write attempt that the database would reject, for nicer UI copy. */
export function writeBlockedMessage(role: Role | null | undefined): string {
  if (!role) return 'You do not have access to this workspace.';
  if (role === 'viewer') return 'Viewers can look but not change the canvas. Ask an owner for editor access.';
  return 'Your role does not allow this action.';
}
