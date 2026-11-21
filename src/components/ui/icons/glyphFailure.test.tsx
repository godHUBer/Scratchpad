// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

/*
  Deliberately its own file.

  This is the one case that needs the chunk import to fail, and every way of
  forcing that — `vi.doMock` of the chunk, a throwing factory — contaminates the
  module registry for whatever runs next, so the happy-path suite next door
  started failing in sequence while passing alone. One test, one registry.
*/

vi.mock('./AnimatedGlyph', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

import { Icon } from '../Icon';

afterEach(cleanup);

describe('when the animated chunk cannot load', () => {
  it('keeps the static icon and throws nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(<Icon name="trash" />);

    const svg = container.querySelector('svg');
    expect(svg, 'static icon should paint before any hover').toBeTruthy();

    svg?.dispatchEvent(new Event('pointerover', { bubbles: true }));

    // Still there, still static, and no error boundary was needed.
    await waitFor(() => expect(container.querySelector('svg')).toBeTruthy());
    expect(container.querySelector('[data-testid="animated"]')).toBeNull();
    // The warning is logged when the rejection settles, which can be a tick
    // after the render settles, so wait for it rather than sampling once.
    await waitFor(() => expect(warn).toHaveBeenCalled());

    warn.mockRestore();
  });

  it('does not retry the failed import on every hover', async () => {
    // A permanently broken chunk should not become a request per mouse move.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(<Icon name="trash" />);
    const svg = container.querySelector('svg');
    for (let i = 0; i < 5; i += 1) {
      svg?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('svg')).toBeTruthy();
    warn.mockRestore();
  });
});
