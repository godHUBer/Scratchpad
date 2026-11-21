import { useEffect, useRef, useState, type ComponentType, type PointerEventHandler } from 'react';
import { BORROWED } from './borrowed';

/**
 * Lazily loads the animated icon renderer the first time it could be needed.
 *
 * Why this exists rather than a plain `lazy()`
 *   `lazy()` would suspend the component on first hover, which means the icon
 *   disappears and is replaced by the Suspense fallback mid-interaction. That
 *   is a visible flicker on a 14 px glyph. Instead this keeps the static SVG on
 *   screen and swaps in the animated version whenever the chunk happens to
 *   arrive — the icon never blanks, and the animation simply starts working
 *   from the next hover.
 *
 * Failure is silent by design
 *   If the chunk cannot be fetched (offline, a stale deploy, a blocked
 *   request), the caller keeps its static icon forever. An icon losing its
 *   hover flourish is not worth an error boundary, let alone the stale-build
 *   recovery in lib/staleBuild — that is reserved for chunks the app cannot
 *   render without.
 */

type GlyphComponent = ComponentType<{
  name: string;
  size: number;
  strokeWidth: number;
  className?: string;
  /** Forwarded from the call site so hover tooltips keep working. */
  onPointerEnter?: PointerEventHandler<SVGSVGElement>;
}>;

let cached: GlyphComponent | null = null;
let pending: Promise<GlyphComponent | null> | null = null;

/** Names that actually have borrowed geometry. Others never trigger a load. */
export function hasAnimatedGlyph(name: string): boolean {
  return name in BORROWED;
}

/**
 * Exported for tests: the only seam that can exercise "the chunk failed" without
 * mocking the chunk module itself, which leaks across a reset module registry.
 */
export function load(): Promise<GlyphComponent | null> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = import('./AnimatedGlyph')
    .then((mod) => {
      console.log('[DBG3] mod=', Object.keys(mod), 'typeof default=', typeof mod.default, String(mod.default).slice(0,60));
      cached = mod.default;
      return cached;
    })
    .catch((error: unknown) => {
      // Debug aid only; the UI degrades to the static icon.
      console.warn('[scratchpad] animated icons unavailable; keeping static icons', error);
      pending = null; // allow a retry on the next hover
      return null;
    });
  return pending;
}

/**
 * Returns the animated component once it has loaded, or null while it has not.
 *
 * `enabled` gates the very first request: it is false until the pointer is
 * actually over an icon, so a visitor who never hovers downloads nothing.
 */
export function useAnimatedGlyph(enabled: boolean): GlyphComponent | null {
  /*
    Both of these pass the component inside a callback, and that is load-bearing,
    not style. `useState` treats a function argument as a lazy initialiser, and
    its setter treats one as an updater. Handing a React component to either
    calls it: `setComponent(Component)` invoked the glyph with no props, stored
    the JSX it returned, and the icon then crashed as "Element type is invalid".
    Wrapping in an arrow keeps the component as data.
  */
  const [component, setComponent] = useState<GlyphComponent | null>(() => cached);
  const requested = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    // Already have it from a previous hover, possibly a different icon's: adopt
    // it immediately. Without this branch a second icon stayed static forever,
    // because the guard below returned before setComponent was ever reached.
    if (cached) {
      setComponent(() => cached);
      return;
    }
    if (requested.current) return;
    requested.current = true;
    let live = true;
    void load().then((loaded) => {
      if (live && loaded) setComponent(() => loaded);
    });
    return () => {
      live = false;
    };
  }, [enabled]);

  return component;
}
