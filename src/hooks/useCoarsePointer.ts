import { useEffect, useState } from 'react';

const QUERY = '(pointer: coarse)';

/**
 * True when the primary input is a finger (phone, tablet) rather than a mouse.
 *
 * Used where a size has to change in JS and CSS alone cannot express it — the
 * canvas resize handles, for example, are positioned by arithmetic, so their
 * larger hit box has to be computed rather than styled.
 *
 * Defaults to `false` so the desktop rendering is what a server-side render or
 * an unsupported browser produces, and updates on change so a tablet switching
 * to a trackpad is handled.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
    setCoarse(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return coarse;
}
