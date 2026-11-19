/**
 * Hand-drawn style SVG icon set.
 *
 * Why not emoji: the toolbar used emoji glyphs (🖱️ 🔠 🖌️ …) as icons. Those
 * only render when the OS ships a colour-emoji font. On systems without one —
 * some Linux desktops, stripped-down Windows images, many CI/kiosk browsers —
 * every glyph falls back to an empty "tofu" box, and the whole toolbar looks
 * blank. Inline SVG has no font dependency and scales with the 3px ink outline
 * design, so it renders identically everywhere.
 */
import type { SVGProps } from 'react';

const PATHS = {
  select: 'M5 3l6.5 17 2.3-6.6 6.7-2.4z',
  text: 'M5 6h14M12 6v13M8.5 19h7',
  brush:
    'M4 20c3.4.4 5-1.6 5.4-4L18 7.6a1.6 1.6 0 0 0 0-2.3l-1.3-1.3a1.6 1.6 0 0 0-2.3 0L5.6 12.6C3.2 13 2.6 17 4 20z',
  eraser: 'M8 20h11M4.5 15.5l7-7a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8l-4 4H9.4z',
  hand: 'M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15c0 3-2 5-5 5H10c-2 0-3-1-4-3l-2-3a1.6 1.6 0 0 1 2.6-1.8L8 14',
  image: 'M3 5h18v14H3zM3 15l5-4 4 3 3-2 6 5M15.5 9.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2',
  audio: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  bookmark: 'M6 3h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM6 17a2 2 0 0 0-2 2h13',
  link: 'M9.5 14.5a3.5 3.5 0 0 1 0-5l2.5-2.5a3.5 3.5 0 0 1 5 5L15.5 13M14.5 9.5a3.5 3.5 0 0 1 0 5L12 17a3.5 3.5 0 0 1-5-5L8.5 11',
  home: 'M4 11l8-7 8 7M6.5 9.5V20h11V9.5',
  users: 'M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM3.5 20v-1.6c0-2 1.8-3.4 5.5-3.4s5.5 1.4 5.5 3.4V20M16 5.2a3.2 3.2 0 0 1 0 6.2M17.5 15.2c2 .5 3 1.7 3 3.2V20',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  bookmarkShelf: 'M5 4h4v16H5zM12 4h4v16h-4zM18.5 5l3 15',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  logout: 'M9 20H5V4h4M15 8l4 4-4 4M19 12H9',
  copy: 'M9 9h10v12H9zM5 15V3h10v2',
  external: 'M14 4h6v6M20 4l-8 8M18 14v6H4V6h6',
  check: 'M4.5 12.5l5 5 10-11',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M11 8.5v5M8.5 11h5',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8.5 11h5',
  reset: 'M4 10a8 8 0 1 1 2 6M4 5v5h5',
  undo: 'M9 7L4 12l5 5M4 12h9a6 6 0 0 1 0 12h-2',
  cursor: 'M5 3l6.5 17 2.3-6.6 6.7-2.4z',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 22, strokeWidth = 2.4, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
