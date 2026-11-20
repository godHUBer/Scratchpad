import { useTheme } from '../../contexts/ThemeContext';
import { Icon } from './Icon';

interface ThemeToggleProps {
  /** `icon` is a square button for the header; `row` is a full-width menu entry. */
  variant?: 'icon' | 'row';
}

/**
 * Dark mode switch.
 *
 * The icon shows the theme you would get by pressing it (a moon while light is
 * active), which is the convention users expect from a toggle button. The
 * accessible name says so in words, because an icon alone cannot.
 */
export function ThemeToggle({ variant = 'icon' }: ThemeToggleProps) {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} mode`;
  const icon = theme === 'dark' ? 'sun' : 'moon';

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 rounded-xl border-2 border-transparent px-2 py-2 text-left text-sm font-bold hover:border-ink hover:bg-cream"
        aria-label={label}
      >
        <span className="flex items-center gap-2">
          <Icon name={icon} size={16} />
          Dark mode
        </span>
        {/*
          A visual switch. aria-hidden because the button already carries the
          state through its label; announcing a second, synthetic checkbox would
          be noise for a screen reader.
        */}
        <span
          aria-hidden
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-ink transition-colors ${
            theme === 'dark' ? 'bg-mustard' : 'bg-paper'
          }`}
        >
          <span
            className={`absolute h-4 w-4 rounded-full border-2 border-ink bg-ink transition-all ${
              theme === 'dark' ? 'left-[1.4rem]' : 'left-0.5'
            }`}
          />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn h-11 min-h-11 w-11 px-0"
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}
