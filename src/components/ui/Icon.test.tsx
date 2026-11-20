// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Icon, type IconName } from './Icon';

/**
 * Structural checks for the icon set.
 *
 * Deliberately limited to what jsdom can answer honestly. jsdom does not
 * implement SVG geometry (no getBBox, no getBoundingClientRect for SVG), so
 * asserting "this glyph stays inside its box" here would mean hand-parsing
 * path data — and a hand-rolled parser that mishandles relative commands is a
 * test that lies. The geometric and visual rules are checked in a real browser
 * by `scripts/qa/icon-sheet.mjs`, which measures every glyph with getBBox() and
 * writes a contact sheet for eyeballing.
 */

// Explicit list: adding an icon should be deliberate, because each one is drawn
// at 14, 22 and 34 px and compared against its neighbours before it ships.
const EXPECTED: IconName[] = [
  'select', 'text', 'brush', 'eraser', 'hand',
  'image', 'audio', 'video', 'bookmark', 'link',
  'home', 'users', 'mail', 'bookmarkShelf', 'settings',
  'plus', 'clock', 'logout', 'copy', 'external',
  'check', 'close', 'trash', 'zoomIn', 'zoomOut',
  'reset', 'undo', 'back', 'font',
];

describe('Icon set', () => {
  it('covers every documented name', () => {
    expect(EXPECTED).toHaveLength(29);
    expect(new Set(EXPECTED).size).toBe(29);
  });

  it.each(EXPECTED)('%s renders one <path> with real geometry', (name) => {
    // Rule 5 in Icon.tsx: a single <path>, so the whole glyph is one element.
    const { container } = render(<Icon name={name} />);
    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    const d = paths[0]?.getAttribute('d') ?? '';
    expect(d.length).toBeGreaterThan(10);
    expect(d.startsWith('M')).toBe(true);
    expect(d).not.toMatch(/NaN|undefined|Infinity/);
    // An unclosed statement or a stray comma renders nothing at all.
    expect(d).not.toMatch(/[,]{2}/);
  });

  it('does not ship the same geometry under two names', () => {
    // `cursor` was a byte-for-byte copy of `select`, and `undo` was almost
    // `reset`. Two glyphs that look the same in one toolbar is a bug.
    const seen = new Map<string, IconName>();
    for (const name of EXPECTED) {
      const { container } = render(<Icon name={name} />);
      const d = container.querySelector('path')?.getAttribute('d') ?? '';
      const prior = seen.get(d);
      expect(prior, `${name} is identical to ${prior}`).toBeUndefined();
      seen.set(d, name);
    }
  });

  it.each([12, 14, 16, 22, 34, 56])('renders square at %ipx', (size) => {
    const { container } = render(<Icon name="brush" size={size} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe(String(size));
    expect(svg?.getAttribute('height')).toBe(String(size));
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('is decorative by default', () => {
    // The button or chip always carries the accessible label; the glyph never
    // should, or screen readers announce it twice.
    const { container } = render(<Icon name="trash" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
  });

  it('honours the strokeWidth override the toaster uses', () => {
    const { container } = render(<Icon name="check" strokeWidth={3} />);
    expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe('3');
  });

  it('inherits colour from the parent instead of hard-coding ink', () => {
    // Icons sit on mustard, mint, coral and paper; a baked-in stroke colour
    // would disappear on some of them.
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
    expect(container.querySelector('svg')?.getAttribute('fill')).toBe('none');
  });
});
