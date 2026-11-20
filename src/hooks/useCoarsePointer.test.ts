// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCoarsePointer } from './useCoarsePointer';

/** Stub matchMedia with a controllable `matches` value. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: '(pointer: coarse)',
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.delete(fn),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return { mql, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCoarsePointer', () => {
  it('is true when the primary pointer is a finger', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(true);
  });

  it('is false with a mouse, so desktop keeps the small handles', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
  });

  it('subscribes and unsubscribes, so it does not leak listeners', () => {
    const { listeners } = stubMatchMedia(true);
    const { unmount } = renderHook(() => useCoarsePointer());
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('falls back to false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
  });

  it('reacts when the pointer type changes', () => {
    const { listeners } = stubMatchMedia(false);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
    // e.g. a tablet user attaching a mouse
    act(() => {
      listeners.forEach((fn) => fn({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });
});
