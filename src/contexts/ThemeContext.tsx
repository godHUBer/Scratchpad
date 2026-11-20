import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
/** What is actually on screen once 'system' has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'scratchpad:theme';

interface ThemeContextValue {
  /** What the user picked — 'system' until they choose explicitly. */
  choice: ThemeChoice;
  /** What that resolves to right now. */
  theme: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
  /** Flip between light and dark, abandoning 'system'. Used by the toggle button. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Reads the stored choice.
 *
 * Deliberately tolerant: localStorage throws in private-browsing modes and when
 * storage is disabled, and a theme preference is not worth crashing the app for.
 */
function readStoredChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Ignore: fall through to the OS preference.
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function resolve(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemDark ? 'dark' : 'light';
  return choice;
}

/**
 * Applies the resolved theme to <html data-theme>.
 *
 * The attribute is the single switch: every colour in the app is a CSS variable
 * defined for `[data-theme='dark']`. Putting it on the root element rather than a
 * wrapping div means the CSS that paints the page background and sets
 * `color-scheme` (which changes native scrollbars and form controls) sees it too.
 */
function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  // Keeps the mobile browser's own chrome (address bar) in step with the page.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#8b735e' : '#ffe9b8');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() =>
    typeof window === 'undefined' ? 'system' : readStoredChoice(),
  );
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : systemPrefersDark(),
  );

  // Follow the OS while the choice is 'system', and keep following it if the
  // user changes it mid-session (e.g. an automatic night schedule).
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const theme = resolve(choice, systemDark);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is acceptable; the choice still applies this session.
    }
  }, []);

  const toggle = useCallback(() => {
    // Toggling from 'system' resolves what is on screen first, so the first
    // click always visibly changes the theme rather than only sometimes.
    setChoice(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setChoice]);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, theme, setChoice, toggle }),
    [choice, theme, setChoice, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
