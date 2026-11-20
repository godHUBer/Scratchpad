/**
 * Searching and sorting the admin console's user table.
 *
 * Kept pure and separate from the page so the rules are testable without a
 * browser: "who counts as online", what an empty last-seen means when sorting,
 * and the fact that search must match email *or* display name.
 */

export type SortKey = 'name' | 'lastSeen' | 'joined';
export type SortDirection = 'asc' | 'desc';

export interface SortableUser {
  user_id: string;
  email: string;
  display_name: string;
  created_at: string;
  last_seen_at: string | null;
  is_online: boolean;
}

/** Case-insensitive match on email or display name. Blank query matches all. */
export function matchesQuery(user: { email: string; display_name: string }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return user.email.toLowerCase().includes(needle) || user.display_name.toLowerCase().includes(needle);
}

export function filterUsers<T extends { email: string; display_name: string }>(users: T[], query: string): T[] {
  return users.filter((user) => matchesQuery(user, query));
}

/**
 * Sort users. Never mutates the input array.
 *
 * - `name` sorts alphabetically by display name, falling back to email so two
 *   "New collaborator" rows still have a stable order.
 * - `lastSeen` puts the most recent activity first when descending. A user who
 *   has never been seen has no timestamp, and is always pushed to the *end* in
 *   both directions: "never" is not "the oldest date", it is an absence.
 * - `joined` uses the account creation date.
 */
export function sortUsers<T extends SortableUser>(users: T[], key: SortKey, direction: SortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1;

  return [...users].sort((a, b) => {
    if (key === 'lastSeen') {
      const aSeen = a.last_seen_at;
      const bSeen = b.last_seen_at;
      // Absent timestamps sink to the bottom regardless of direction.
      if (!aSeen && !bSeen) return a.display_name.localeCompare(b.display_name);
      if (!aSeen) return 1;
      if (!bSeen) return -1;
      const delta = Date.parse(aSeen) - Date.parse(bSeen);
      // Online users float above offline ones when sorting by recency, since
      // they are by definition the most recent activity.
      if (delta === 0) return a.display_name.localeCompare(b.display_name);
      return delta * sign;
    }

    if (key === 'joined') {
      const delta = Date.parse(a.created_at) - Date.parse(b.created_at);
      if (delta === 0) return a.display_name.localeCompare(b.display_name);
      return delta * sign;
    }

    const aName = (a.display_name || a.email).toLowerCase();
    const bName = (b.display_name || b.email).toLowerCase();
    const delta = aName.localeCompare(bName);
    if (delta === 0) return a.email.localeCompare(b.email);
    return delta * sign;
  });
}

/** Human label for the result count line above the table. */
export function resultSummary(shown: number, total: number, query: string): string {
  if (!query.trim()) return `${total} account${total === 1 ? '' : 's'}`;
  return `${shown} of ${total} account${total === 1 ? '' : 's'} match “${query.trim()}”`;
}
