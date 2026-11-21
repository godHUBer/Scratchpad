// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isStaleChunkError,
  markBuildHealthy,
  reloadForNewBuild,
  reloadRecentlyAttempted,
} from './staleBuild';

/**
 * The production error this exists for:
 *
 *   TypeError: Failed to fetch dynamically imported module:
 *   .../assets/SignInPage-COyBPllt.js
 *
 * Every route is lazily imported, so a tab opened before a deploy asks for a
 * chunk hash that the new deployment no longer has. A plain reload does not
 * help, because GitHub Pages will answer it from the HTTP cache with the same
 * stale document; the recovery has to bypass the cache once.
 */

const MARKER = 'scratchpad.chunkReloadAt';

/*
 * jsdom's Location exposes `replace` as non-configurable, so it cannot be
 * spied on directly. Replace the whole `location` object for the duration of
 * the file and restore it afterwards.
 */
const realLocation = window.location;
let replaced: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
  window.localStorage.clear();
  replaced = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: 'https://godhuber.github.io',
      pathname: '/Scratchpad/',
      search: '',
      hash: '',
      replace: (url: string) => replaced.push(url),
      reload: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('isStaleChunkError', () => {
  it('recognises the exact message from the production report', () => {
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://godhuber.github.io/Scratchpad/assets/SignInPage-COyBPllt.js',
    );
    expect(isStaleChunkError(error)).toBe(true);
  });

  it('recognises the other browsers’ phrasings for the same failure', () => {
    expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Loading chunk 42 failed.'))).toBe(true);
    expect(isStaleChunkError('Failed to fetch dynamically imported module: /x.js')).toBe(true);
  });

  it('does not treat ordinary application errors as stale builds', () => {
    // These must reach the normal crash panel, not trigger a page reload --
    // reloading on a genuine bug would destroy the user's unsaved work for
    // nothing.
    expect(isStaleChunkError(new Error('viewers cannot modify this workspace'))).toBe(false);
    expect(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isStaleChunkError(new Error('Failed to fetch'))).toBe(false); // a plain network error
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError({})).toBe(false);
  });
});

describe('reloadForNewBuild', () => {
  it('bypasses the HTTP cache, because a plain reload returns the stale page', () => {
    expect(reloadForNewBuild()).toBe(true);
    const target = replaced[0]!;
    // A cache-busting query parameter is the whole point: same URL would be
    // served from cache with the same dead chunk hash.
    expect(target).toContain('v=');
    expect(target).toContain(String(Date.now()));
  });

  it('keeps the route so the user lands where they were going', () => {
    (window.location as unknown as { hash: string }).hash = '#/workspace/abc123';
    expect(reloadForNewBuild()).toBe(true);
    const target = replaced[0]!;
    expect(target).toContain('#/workspace/abc123');
    expect(target).toContain('/Scratchpad/');
  });

  it('preserves an existing query parameter instead of clobbering it', () => {
    (window.location as unknown as { search: string; hash: string }).search = '?keep=me';
    (window.location as unknown as { hash: string }).hash = '#/settings';
    expect(reloadForNewBuild()).toBe(true);
    const target = replaced[0]!;
    expect(target).toContain('keep=me');
    expect(target).toContain('#/settings');
  });

  it('records that it reloaded', () => {
    reloadForNewBuild();
    expect(window.localStorage.getItem(MARKER)).toBe(String(Date.now()));
  });
});

describe('loop prevention', () => {
  it('refuses a second automatic reload immediately after the first', () => {
    // This is the property that matters: if the forced reload does not fix it,
    // reloading again would spin forever. Better to stop and explain.
    expect(reloadForNewBuild()).toBe(true);
    expect(reloadForNewBuild()).toBe(false);
    expect(replaced).toHaveLength(1);
  });

  it('still allows a retry once the cooldown has passed', () => {
    expect(reloadForNewBuild()).toBe(true);
    // 31 seconds later: not a tight loop, so recovery is worth another go.
    vi.setSystemTime(new Date(Date.now() + 31_000));
    expect(reloadRecentlyAttempted()).toBe(false);
    expect(reloadForNewBuild()).toBe(true);
  });

  it('treats a marker near the cooldown boundary as still cooling down', () => {
    reloadForNewBuild();
    vi.setSystemTime(new Date(Date.now() + 10_000));
    expect(reloadRecentlyAttempted()).toBe(true);
    expect(reloadForNewBuild()).toBe(false);
  });

  it('ignores a corrupt marker rather than getting stuck forever', () => {
    window.localStorage.setItem(MARKER, 'not-a-number');
    expect(reloadRecentlyAttempted()).toBe(false);
    expect(reloadForNewBuild()).toBe(true);
  });

  it('clears the marker once the build is known good', () => {
    reloadForNewBuild();
    expect(reloadRecentlyAttempted()).toBe(true);
    // main.tsx calls this after React mounts: the browser clearly has the
    // current build, so a future failure should be allowed to recover again.
    markBuildHealthy();
    expect(reloadRecentlyAttempted()).toBe(false);
    expect(window.localStorage.getItem(MARKER)).toBeNull();
  });

  it('survives localStorage being unavailable', () => {
    // Safari private mode: storage access throws. Recovery must still work; the
    // only thing lost is the loop guard.
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(reloadRecentlyAttempted()).toBe(false);
    expect(reloadForNewBuild()).toBe(true);
    if (original) Object.defineProperty(window, 'localStorage', original);
  });
});
