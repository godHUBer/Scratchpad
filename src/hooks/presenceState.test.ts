import { describe, expect, it } from 'vitest';
import { foldPresence, presenceKey, shouldRebuildChannel, type PresenceUser } from './presenceState';

const user = (id: string, name = 'A', onlineAt = '2026-01-01T00:00:00.000Z'): PresenceUser => ({
  user_id: id,
  name,
  avatar_url: null,
  online_at: onlineAt,
});

describe('presenceKey', () => {
  it('keys presence by user id so every tab agrees on the key', () => {
    expect(presenceKey('user-1')).toBe('user-1');
  });
});

describe('foldPresence', () => {
  it('returns nothing for an empty state', () => {
    expect(foldPresence(undefined)).toEqual([]);
    expect(foldPresence({})).toEqual([]);
  });

  it('flattens the per-key arrays into one entry per user', () => {
    const folded = foldPresence({
      'user-1': [user('user-1', 'Ada')],
      'user-2': [user('user-2', 'Grace')],
    });
    expect(folded.map((u) => u.user_id)).toEqual(['user-1', 'user-2']);
  });

  it('collapses several tabs of the same user into a single entry', () => {
    // this is the shape presenceState() returns when a user has 3 tabs open
    const folded = foldPresence({
      'user-1': [user('user-1', 'Ada', '2026-01-01T00:00:01.000Z'), user('user-1', 'Ada', '2026-01-01T00:00:03.000Z')],
    });
    expect(folded).toHaveLength(1);
    expect(folded[0]!.user_id).toBe('user-1');
  });

  it('keeps the most recent heartbeat, so a renamed profile wins', () => {
    const folded = foldPresence({
      'user-1': [
        user('user-1', 'Old name', '2026-01-01T00:00:01.000Z'),
        user('user-1', 'New name', '2026-01-01T00:00:09.000Z'),
      ],
    });
    expect(folded[0]!.name).toBe('New name');
  });

  it('ignores malformed entries instead of throwing', () => {
    const folded = foldPresence({
      'user-1': [user('user-1')],
      bad: [null as unknown as PresenceUser, { name: 'no id' } as unknown as PresenceUser],
    });
    expect(folded.map((u) => u.user_id)).toEqual(['user-1']);
  });

  it('is deterministic regardless of key order', () => {
    const a = foldPresence({ b: [user('b')], a: [user('a')] });
    const b = foldPresence({ a: [user('a')], b: [user('b')] });
    expect(a).toEqual(b);
  });
});

describe('shouldRebuildChannel', () => {
  it('keeps the channel when only the profile changed', () => {
    // The original bug: profile fields were effect dependencies, so a rename or
    // a token refresh rebuilt (and re-subscribed) the presence channel.
    expect(
      shouldRebuildChannel(
        { workspaceId: 'ws-1', userId: 'user-1' },
        { workspaceId: 'ws-1', userId: 'user-1' },
      ),
    ).toBe(false);
  });

  it('rebuilds when the workspace changes', () => {
    expect(
      shouldRebuildChannel(
        { workspaceId: 'ws-1', userId: 'user-1' },
        { workspaceId: 'ws-2', userId: 'user-1' },
      ),
    ).toBe(true);
  });

  it('rebuilds when the signed-in user changes', () => {
    expect(
      shouldRebuildChannel(
        { workspaceId: 'ws-1', userId: 'user-1' },
        { workspaceId: 'ws-1', userId: 'user-2' },
      ),
    ).toBe(true);
  });
});
