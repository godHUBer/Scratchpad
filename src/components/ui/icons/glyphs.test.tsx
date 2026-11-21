// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { BORROWED } from './borrowed';
import { hasAnimatedGlyph } from './useAnimatedGlyph';

/**
 * Guards the two claims the lazy animated-icon design rests on.
 *
 * 1. Nothing is downloaded until an icon is actually hovered. `motion` measured
 *    +55 kB gzip in the entry bundle; deferring it is the entire reason this
 *    design exists, so "did we really defer it" has to be a test, not a hope.
 * 2. A failed chunk load degrades to the static icon. An icon that cannot
 *    animate is a cosmetic loss; an icon that disappears, or throws into the
 *    error boundary, is a bug — and the stale-build recovery in lib/staleBuild
 *    must not be triggered by something this trivial.
 */

const importSpy = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('./AnimatedGlyph', () => {
  importSpy.calls.push('AnimatedGlyph');
  // Must be a *component*, not an element: the real module default-exports a
  // function and Icon renders it via createElement. Returning <svg/> here made
  // React treat the element itself as a component type and throw.
  function Stub({ name, onPointerEnter }: { name: string; onPointerEnter?: React.PointerEventHandler<SVGSVGElement> }) {
    // Mirrors the real component, which forwards the call site's handler so
    // hover tooltips keep working once the animated glyph has taken over.
    return <svg data-testid="animated" data-name={name} onPointerEnter={onPointerEnter} />;
  }
  return { default: Stub };
});

import { Icon } from '../Icon';

beforeEach(() => {
  importSpy.calls.length = 0;
  /*
    `useAnimatedGlyph` caches the loaded component in module scope so a second
    icon does not refetch. That is correct at runtime and wrong across tests:
    once one test loads the chunk, the next test can never observe the import.
    Resetting the registry restores the cold-start condition each test expects.
  */
  vi.resetModules();
});

afterEach(cleanup);

describe('borrowed glyph data', () => {
  it('attributes every glyph to an upstream source file', () => {
    for (const [name, glyph] of Object.entries(BORROWED)) {
      expect(glyph.source, `${name} has no source`).toMatch(/^[a-z0-9-]+\.tsx$/);
    }
  });

  it('never ships an empty glyph', () => {
    for (const [name, glyph] of Object.entries(BORROWED)) {
      expect(glyph.paths.length, `${name} has no paths`).toBeGreaterThan(0);
      for (const d of glyph.paths) {
        expect(d.startsWith('M') || d.startsWith('m'), `${name}: ${d.slice(0, 12)}`).toBe(true);
        expect(d).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('only claims names that exist in the icon set', () => {
    // A typo here would silently mean "no animation for that icon" forever.
    const names = Object.keys(BORROWED);
    expect(names).toContain('trash');
    expect(names).toContain('bookmarkShelf');
    expect(hasAnimatedGlyph('trash')).toBe(true);
    expect(hasAnimatedGlyph('zoomIn')).toBe(false);
  });

  it('covers the icons the review specifically called out as unchanged', () => {
    // These have no upstream equivalent and must keep their hand-drawn paths.
    // Listing them makes the gap explicit rather than accidental.
    const NOT_BORROWED = ['plus', 'zoomIn', 'zoomOut', 'eraser', 'hand', 'font', 'image', 'video', 'sun', 'settings'];
    for (const name of NOT_BORROWED) {
      expect(hasAnimatedGlyph(name), `${name} unexpectedly gained borrowed geometry`).toBe(false);
    }
  });
});

describe('lazy loading', () => {
  it('renders a static SVG without requesting the animated chunk', () => {
    const { container } = render(<Icon name="trash" />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('[data-testid="animated"]')).toBeNull();
    // This is the assertion that protects the bundle budget.
    expect(importSpy.calls).toHaveLength(0);
  });

  it('does not request the chunk for an icon with no borrowed geometry', () => {
    const { container } = render(<Icon name="plus" />);
    container.querySelector('svg')?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(importSpy.calls).toHaveLength(0);
  });

  it('requests the chunk on the first hover of an icon that has one', async () => {
    const { container } = render(<Icon name="trash" />);
    container.querySelector('svg')?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await waitFor(() => expect(importSpy.calls).toContain('AnimatedGlyph'));
  });

  it('swaps in the animated glyph once loaded', async () => {
    const { container } = render(<Icon name="trash" />);
    container.querySelector('svg')?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await waitFor(() => {
      const animated = container.querySelector('[data-testid="animated"]');
      expect(animated).toBeTruthy();
      expect(animated?.getAttribute('data-name')).toBe('trash');
    });
  });

  it('still calls an onPointerEnter supplied by the call site', () => {
    /*
      Icon intercepts pointer-enter to trigger the download. It must not swallow
      the caller's handler — several toolbars rely on hover for their own
      tooltips.

      Dispatched twice on purpose. The first hover is the one that starts the
      load; after that the animated glyph owns the element, so this also covers
      the forwarding path once it has taken over.
    */
    const onPointerEnter = vi.fn();
    const { container } = render(<Icon name="trash" onPointerEnter={onPointerEnter} />);
    const svg = container.querySelector('svg');
    svg?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    container.querySelector('svg')?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(onPointerEnter).toHaveBeenCalledTimes(2);
  });

});
