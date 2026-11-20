import { describe, expect, it } from 'vitest';
import { settleSyncState } from './syncStatus';

describe('settleSyncState', () => {
  it('claims saved only when the write landed and nothing is pending', () => {
    expect(settleSyncState({ pending: 0, failed: 0, online: true, previous: 'saving' })).toBe('saved');
  });

  it('never claims saved while another write is still in flight', () => {
    expect(settleSyncState({ pending: 2, failed: 0, online: true, previous: 'saving' })).toBeNull();
  });

  it('keeps an error when a write failed, instead of flapping to saved', () => {
    // This is the regression: the old code set error, then its finally block
    // set saved in the same tick.
    expect(settleSyncState({ pending: 0, failed: 1, online: true, previous: 'error' })).toBe('error');
  });

  it('keeps an error even if this particular write succeeded', () => {
    expect(settleSyncState({ pending: 0, failed: 2, online: true, previous: 'saving' })).toBe('error');
  });

  it('reports offline rather than saved when the browser is offline', () => {
    expect(settleSyncState({ pending: 0, failed: 0, online: false, previous: 'saving' })).toBe('offline');
  });

  it('prefers offline over a stale error', () => {
    expect(settleSyncState({ pending: 0, failed: 3, online: false, previous: 'error' })).toBe('offline');
  });

  it('recovers to saved once a later write clears the failure count', () => {
    expect(settleSyncState({ pending: 0, failed: 0, online: true, previous: 'saving' })).toBe('saved');
  });
});
