import { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

/**
 * The current theme's colours as literal hex/rgba strings.
 *
 * Konva draws to a canvas and cannot resolve `var(--c-ink)`: a canvas fillStyle
 * must be a concrete colour. CSS-backed chrome therefore reads its values from
 * here instead of hard-coding the light palette, so the selection frame and the
 * grid dots follow the theme like everything else.
 *
 * User content is deliberately excluded. A black brush stroke stays black in
 * dark mode — it is the user's drawing, not chrome.
 */
export interface ThemeColors {
  /** Primary ink: selection outlines, resize handles, empty-state text. */
  ink: string;
  /** Panel background, used for resize-handle fills so they sit on the canvas. */
  paper: string;
  /** Faint dot used for the canvas grid. */
  grid: string;
}

const LIGHT: ThemeColors = {
  ink: '#080808',
  paper: '#fffdf6',
  grid: 'rgba(8,8,8,0.16)',
};

const DARK: ThemeColors = {
  ink: '#fffdf8',
  paper: '#4a3c30',
  // Slightly stronger than the light value: a 16% dark dot is invisible on the
  // brown canvas background.
  grid: 'rgba(255,253,248,0.24)',
};

export function useThemeColors(): ThemeColors {
  const { theme } = useTheme();
  const [colors, setColors] = useState<ThemeColors>(theme === 'dark' ? DARK : LIGHT);

  useEffect(() => {
    // Read from the stylesheet when possible so the values cannot drift from
    // the CSS; fall back to the constants in environments without a styled
    // document (tests, or before the stylesheet loads).
    const styles = typeof window === 'undefined' ? null : window.getComputedStyle(document.documentElement);
    const ink = styles?.getPropertyValue('--c-ink').trim();
    const paper = styles?.getPropertyValue('--c-paper').trim();
    const base = theme === 'dark' ? DARK : LIGHT;
    setColors({
      ink: ink || base.ink,
      paper: paper || base.paper,
      grid: base.grid,
    });
  }, [theme]);

  return colors;
}
