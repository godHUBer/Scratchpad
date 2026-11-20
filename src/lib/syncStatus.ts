/**
 * What the "saved / saving / error" badge is allowed to say.
 *
 * The bug this encodes the fix for: `track` used to set 'error' on failure and
 * then, in its own `finally`, set 'saved' a line later — the same tick, because
 * settling the last pending write always followed immediately. A rejected write
 * therefore *reported success*, and the user trusted changes that never landed.
 */

export type SyncState = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

export interface SettleInput {
  /** Writes still in flight after this one settles. */
  pending: number;
  /** Writes that failed and have not yet been superseded by a success. */
  failed: number;
  online: boolean;
  /** The state before settling, which may already be 'error'. */
  previous: SyncState;
}

/**
 * The state to show when the last in-flight write settles.
 *
 * Rules, in order:
 *  - offline wins: the browser knows more than we do, and we cannot claim a save.
 *  - a pending failure keeps 'error' sticky, so one bad write cannot be papered
 *    over by the next successful one *in the same batch*.
 *  - otherwise the write really did land, so 'saved' is honest.
 * Returns null when other writes are still in flight (keep showing 'saving').
 */
export function settleSyncState({ pending, failed, online, previous }: SettleInput): SyncState | null {
  if (pending > 0) return null;
  if (!online) return 'offline';
  if (failed > 0 || previous === 'error') return 'error';
  return 'saved';
}

/**
 * Whether a rejected optimistic mutation should be undone.
 *
 * Every optimistic edit must be reversible: leaving the optimistic value on
 * screen after the RPC failed shows data the database does not have.
 */
export function shouldRollback(): boolean {
  return true;
}
