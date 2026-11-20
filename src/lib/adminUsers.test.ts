import { describe, expect, it } from 'vitest';
import { filterUsers, resultSummary, sortUsers, type SortableUser } from './adminUsers';

function user(overrides: Partial<SortableUser>): SortableUser {
  return {
    user_id: overrides.email ?? 'id',
    email: 'a@example.com',
    display_name: 'A',
    created_at: '2026-01-01T00:00:00.000Z',
    last_seen_at: null,
    is_online: false,
    ...overrides,
  };
}

const alice = user({ email: 'alice@x.com', display_name: 'Alice', created_at: '2026-01-05T00:00:00Z', last_seen_at: '2026-03-01T00:00:00Z' });
const bob = user({ email: 'bob@x.com', display_name: 'Bob', created_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-04-01T00:00:00Z' });
const carol = user({ email: 'carol@x.com', display_name: 'Carol', created_at: '2026-02-01T00:00:00Z', last_seen_at: null });
const all = [alice, bob, carol];

const names = (rows: SortableUser[]) => rows.map((r) => r.display_name);

describe('filterUsers', () => {
  it('matches part of an email, case-insensitively', () => {
    expect(filterUsers(all, 'BOB@')).toEqual([bob]);
  });

  it('matches part of a display name', () => {
    expect(names(filterUsers(all, 'car'))).toEqual(['Carol']);
  });

  it('ignores surrounding whitespace', () => {
    expect(filterUsers(all, '  alice  ')).toEqual([alice]);
  });

  it('returns everything for a blank query', () => {
    expect(filterUsers(all, '')).toHaveLength(3);
    expect(filterUsers(all, '   ')).toHaveLength(3);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterUsers(all, 'zzz')).toEqual([]);
  });
});

describe('sortUsers', () => {
  it('sorts by name ascending and descending without mutating the input', () => {
    const original = [...all];
    expect(names(sortUsers(all, 'name', 'asc'))).toEqual(['Alice', 'Bob', 'Carol']);
    expect(names(sortUsers(all, 'name', 'desc'))).toEqual(['Carol', 'Bob', 'Alice']);
    expect(all).toEqual(original);
  });

  it('sorts by last seen, most recent first when descending', () => {
    expect(names(sortUsers(all, 'lastSeen', 'desc')).slice(0, 2)).toEqual(['Bob', 'Alice']);
  });

  it('sorts by last seen oldest-first when ascending', () => {
    expect(names(sortUsers(all, 'lastSeen', 'asc')).slice(0, 2)).toEqual(['Alice', 'Bob']);
  });

  it('always sinks users who were never seen to the bottom, in both directions', () => {
    expect(names(sortUsers(all, 'lastSeen', 'asc')).at(-1)).toBe('Carol');
    expect(names(sortUsers(all, 'lastSeen', 'desc')).at(-1)).toBe('Carol');
  });

  it('sorts by join date in both directions', () => {
    expect(names(sortUsers(all, 'joined', 'asc'))).toEqual(['Bob', 'Alice', 'Carol']);
    expect(names(sortUsers(all, 'joined', 'desc'))).toEqual(['Carol', 'Alice', 'Bob']);
  });

  it('falls back to email when two display names are identical', () => {
    const dup1 = user({ email: 'z@x.com', display_name: 'Same' });
    const dup2 = user({ email: 'a@x.com', display_name: 'Same' });
    expect(sortUsers([dup1, dup2], 'name', 'asc').map((u) => u.email)).toEqual(['a@x.com', 'z@x.com']);
  });

  it('survives being given an empty list', () => {
    expect(sortUsers([], 'name', 'asc')).toEqual([]);
  });
});

describe('resultSummary', () => {
  it('counts everything when there is no query', () => {
    expect(resultSummary(3, 3, '')).toBe('3 accounts');
  });

  it('uses the singular for one account', () => {
    expect(resultSummary(1, 1, '')).toBe('1 account');
  });

  it('reports the match count when searching', () => {
    expect(resultSummary(1, 3, 'alice')).toBe('1 of 3 accounts match “alice”');
  });
});
