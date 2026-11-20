/**
 * Presence bookkeeping for the per-workspace channel.
 *
 * Kept pure (no Supabase imports) so the two behaviours that actually cause
 * bugs can be unit-tested:
 *
 *  - **Key normalisation.** Every client in a workspace must derive the *same*
 *    presence key. We key by user id.
 *  - **State folding.** `presenceState()` returns `Record<key, T[]>`; different
 *    tabs of the same user each contribute an entry, so the UI needs one
 *    deterministic row per user rather than one per tab.
 */
export interface PresenceUser {
  user_id: string;
  name: string;
  avatar_url: string | null;
  online_at: string;
}

/** Presence key for a signed-in user. */
export function presenceKey(userId: string): string {
  return userId;
}

/**
 * Collapse `channel.presenceState()` into one entry per user.
 *
 * When a user has several tabs open the most recent heartbeat wins, which is
 * also what makes a renamed profile show up quickly.
 */
export function foldPresence(state: Record<string, PresenceUser[]> | undefined): PresenceUser[] {
  if (!state) return [];
  const byUser = new Map<string, PresenceUser>();
  for (const entries of Object.values(state)) {
    for (const entry of entries ?? []) {
      if (!entry || typeof entry.user_id !== 'string') continue;
      const current = byUser.get(entry.user_id);
      if (!current || (entry.online_at ?? '') >= (current.online_at ?? '')) {
        byUser.set(entry.user_id, entry);
      }
    }
  }
  return [...byUser.values()].sort((a, b) => a.user_id.localeCompare(b.user_id));
}

/**
 * Should the channel be re-created?
 *
 * Re-subscribing tears down and rebuilds the socket channel, so it must only
 * happen when it is genuinely required: a different workspace or a different
 * signed-in user. Profile renames are pushed over `track()` instead.
 */
export function shouldRebuildChannel(
  previous: { workspaceId: string | null; userId: string | null },
  next: { workspaceId: string | null; userId: string | null },
): boolean {
  return previous.workspaceId !== next.workspaceId || previous.userId !== next.userId;
}
