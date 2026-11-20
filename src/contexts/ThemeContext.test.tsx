// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

/**
 * Dark mode is the kind of feature that looks fine and silently misbehaves:
 * the toggle appears to work but the choice is forgotten on reload, or the OS
 * preference is ignored until the user clicks twice. These tests pin the
 * contract rather than the pixels.
 */

function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.delete(fn),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return { listeners, setSystemDark: (dark: boolean) => (mql.matches = dark) };
}

function Harness() {
  const { theme, choice, toggle } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="choice">{choice}</span>
      <button type="button" onClick={toggle}>
        toggle
      </button>
    </div>
  );
}

function renderHarness() {
  return render(
    <ThemeProvider>
      <Harness />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ThemeProvider', () => {
  it('follows the OS when nothing has been chosen', () => {
    stubMatchMedia(true);
    renderHarness();
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('choice').textContent).toBe('system');
  });

  it('defaults to light when the OS has no preference', () => {
    stubMatchMedia(false);
    renderHarness();
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('writes the theme to the document root, which is what the CSS reads', () => {
    stubMatchMedia(false);
    renderHarness();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('a stored choice beats the OS preference', () => {
    window.localStorage.setItem('scratchpad:theme', 'light');
    stubMatchMedia(true); // OS says dark
    renderHarness();
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('persists an explicit choice so it survives a reload', () => {
    stubMatchMedia(false);
    renderHarness();
    act(() => {
      screen.getByText('toggle').click();
    });
    expect(window.localStorage.getItem('scratchpad:theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggling from system changes what is on screen immediately', () => {
    // The first click must visibly do something even when the resolved theme
    // came from the OS rather than from a stored choice.
    stubMatchMedia(true);
    renderHarness();
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    act(() => {
      screen.getByText('toggle').click();
    });
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('choice').textContent).toBe('light');
  });

  it('reacts to the OS changing while the choice is system', () => {
    const { listeners } = stubMatchMedia(false);
    renderHarness();
    expect(screen.getByTestId('theme').textContent).toBe('light');
    act(() => {
      listeners.forEach((fn) => fn({ matches: true } as MediaQueryListEvent));
    });
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('ignores the OS once the user has picked a theme', () => {
    const { listeners } = stubMatchMedia(false);
    renderHarness();
    act(() => {
      screen.getByText('toggle').click(); // -> dark, explicit
    });
    act(() => {
      listeners.forEach((fn) => fn({ matches: false } as MediaQueryListEvent));
    });
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('keeps the browser chrome colour in step with the theme', () => {
    stubMatchMedia(false);
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#ffe9b8');
    document.head.appendChild(meta);

    renderHarness();
    expect(meta.getAttribute('content')).toBe('#ffe9b8');
    act(() => {
      screen.getByText('toggle').click();
    });
    // The exact background the user asked for.
    expect(meta.getAttribute('content')).toBe('#8b735e');

    meta.remove();
  });

  it('survives storage being unavailable', () => {
    // Private browsing and blocked storage both throw on access.
    const original = window.localStorage.getItem;
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    stubMatchMedia(false);
    expect(() => renderHarness()).not.toThrow();
    expect(screen.getByTestId('theme').textContent).toBe('light');
    vi.mocked(window.localStorage.getItem).mockRestore?.();
    void original;
  });

  it('ignores a corrupt stored value instead of rendering an invalid theme', () => {
    window.localStorage.setItem('scratchpad:theme', 'chartreuse');
    stubMatchMedia(false);
    renderHarness();
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('choice').textContent).toBe('system');
  });
});
