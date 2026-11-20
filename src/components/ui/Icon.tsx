/**
 * Hand-drawn style SVG icon set.
 *
 * Why not emoji: the toolbar used emoji glyphs (🖱️ 🔠 🖌️ …) as icons. Those
 * only render when the OS ships a colour-emoji font. On systems without one —
 * some Linux desktops, stripped-down Windows images, many CI/kiosk browsers —
 * every glyph falls back to an empty "tofu" box, and the whole toolbar looks
 * blank. Inline SVG has no font dependency and scales with the 3px ink outline
 * design, so it renders identically everywhere.
 *
 * Drawing rules (they exist because breaking them produced bad icons):
 *
 *   1. One consistent grid. Everything lives in 0–24 with a 2.4 stroke and
 *      round caps/joins, so the set reads as one hand even at 14 px.
 *   2. Leave a 1.5 px margin. The old icons ran to the edge of the viewBox and
 *      were clipped by the button's rounded corner.
 *   3. Survive 14 px. Ten call sites render these at 14 px (chips, table rows,
 *      toasts). Detail below ~2 px vanishes, so small icons use few strokes:
 *      `zoomIn` is a ring plus a stub, never a crosshair inside a dial.
 *   4. Be distinguishable *neighbours*, not just individually legible. The
 *      whole point of an icon is to pick it out of a row at a glance, so each
 *      one is checked against the icons it can appear next to:
 *        - text (A)      vs font (T)     vs brush (angled brush)
 *        - select (arrow) vs back (flat arrow)
 *        - link (chain)   vs image (frame)
 *        - bookmark (flag) vs bookmarkShelf (three spines)
 *        - undo (straight tail) vs reset (closed circle)
 *        - close (×)      vs plus (+)
 *   5. A single <path>, because the component renders one element. Extra
 *      strokes are appended as sub-paths ("M…Z M…Z"), which also keeps the
 *      whole glyph in one place for the tests.
 *
 * `src/components/ui/Icon.test.tsx` guards the mechanical part of the rules:
 * every icon must parse, stay inside the box, and not contain NaN.
 */
import type { SVGProps } from 'react';

const PATHS = {
  select: 'M6.2 3.4l3 16.1 4-6.2 7 .3-4.6-3.2 2.9-6.5z',
  text: 'M4.5 20.5L10.8 4.2M13.2 4.2L19.5 20.5M7.6 14.6h8.8',
  brush:
    'M19.6 2.9a1.9 1.9 0 0 1 2.7 2.7l-9.4 9.4-2.7-2.7zM8.5 13.9l4.4 4.4-2.1 2.1c-.8.8-2.1.8-2.9 0l-1.5-1.5c-.8-.8-.8-2.1 0-2.9z',
  eraser: 'M14.9 3.7l5.4 5.4-9.3 9.3H6.6l-2.3-2.3zM4.3 13.9l5.4 5.4M2.8 21.3h18.4',
  hand:
    'M8.2 13.4V5.6a1.55 1.55 0 0 1 3.1 0v6.1m0-6.6a1.55 1.55 0 0 1 3.1 0v6.6m0-5.4a1.55 1.55 0 0 1 3.1 0v9.4c0 3.3-2.2 5.6-5.4 5.6h-2.2c-2.1 0-3.3-1.1-4.3-3l-2-3.6a1.6 1.6 0 0 1 2.6-1.9l2.9 2.9',
  image:
    'M3.2 4.6h17.6v14.8H3.2zM3.2 15.2l5.2-4.6 4.3 3.4 3.1-2.4 5 4.2M15.6 9.8a1.15 1.15 0 1 1 0-2.3 1.15 1.15 0 0 1 0 2.3z',
  audio: 'M4 10.2v3.6M8 6.4v11.2M12 3.6v16.8M16 7.4v9.2M20 10.8v2.4',
  video: 'M2.9 6.2h11.4v11.6H2.9zM14.3 10l6.8-3.3v10.6L14.3 14',
  bookmark: 'M6.4 3.2h11.2v17.3l-5.6-4.1-5.6 4.1z',
  link:
    'M14.2 4.6a3.9 3.9 0 0 1 5.5 5.5l-2.6 2.6M9.8 19.4a3.9 3.9 0 0 1-5.5-5.5l2.6-2.6M9.3 14.7l5.4-5.4',
  home: 'M3.4 11.4L12 3.9l8.6 7.5M5.9 9.6V20.4h12.2V9.6M9.9 20.4v-5.8h4.2v5.8',
  users:
    'M9.2 11.1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.9 20.4v-1.5c0-2.3 2.5-3.9 6.3-3.9s6.3 1.6 6.3 3.9v1.5M15.7 4.5a3.5 3.5 0 0 1 0 6.9M17 15.2c2.5.5 4.1 1.9 4.1 3.8v1.4',
  mail: 'M3.1 5.4h17.8v13.2H3.1zM3.1 6.2l8.9 6.4 8.9-6.4',
  bookmarkShelf: 'M4.2 20.2V3.6h4.3v16.6zM10.4 20.2V3.6h4.3v16.6zM17.6 4.6l3.1 15.1-3.6.7-1.4-6.6',
  settings:
    'M10.36 4.89L9.08 2.44L14.92 2.44L13.64 4.89L17.34 7.02L18.82 4.69L21.74 9.75L18.98 9.87L18.98 14.13L21.74 14.25L18.82 19.31L17.34 16.98L13.64 19.11L14.92 21.56L9.08 21.56L10.36 19.11L6.66 16.98L5.18 19.31L2.26 14.25L5.02 14.13L5.02 9.87L2.26 9.75L5.18 4.69L6.66 7.02ZM8.9 12a3.1 3.1 0 1 1 6.2 0a3.1 3.1 0 1 1-6.2 0Z',
  plus: 'M12 4.4v15.2M4.4 12h15.2',
  clock: 'M12 20.9a8.9 8.9 0 1 0 0-17.8 8.9 8.9 0 0 0 0 17.8zM12 6.9v5.4l3.6 2.2',
  logout: 'M9.8 20.4H4.2V3.6h5.6M15.4 7.9l4.4 4.1-4.4 4.1M19.6 12H9.4',
  copy: 'M8.6 8.6h11v11.8h-11zM5.4 15.2V3.6h10.6',
  external: 'M13.4 3.6h7v7M20.1 3.9l-8.6 8.6M17.7 14.1v6.3H3.9V5.8h6.4',
  check: 'M4.2 12.4l5.4 5.8L20 5.9',
  close: 'M6.1 6.1l11.8 11.8M17.9 6.1L6.1 17.9',
  /*
    sun / moon for the theme toggle.

    Checked against their neighbours as the header requires: the sun is a ring
    with eight short rays (never touching the ring, so it survives 14 px), and the
    moon is a single crescent — one outer arc plus the cut-out. They are read at
    a glance as opposites, which is the whole job of a toggle icon.
  */
  sun: 'M12 16.4a4.4 4.4 0 1 0 0-8.8 4.4 4.4 0 0 0 0 8.8zM12 2.6v2.4M12 19v2.4M4.3 12H1.9M22.1 12h-2.4M6.5 6.5L4.8 4.8M19.2 19.2l-1.7-1.7M17.5 6.5l1.7-1.7M4.8 19.2l1.7-1.7',
  moon: 'M20.4 14.6A8.9 8.9 0 0 1 9.4 3.6a8.9 8.9 0 1 0 11 11z',
  trash: 'M3.8 7.1h16.4M9.2 7.1V3.8h5.6v3.3M6.1 7.1l1.1 13h9.6l1.1-13M10.2 10.6v6.6M13.8 10.6v6.6',
  zoomIn:
    'M10.7 18.4a7.7 7.7 0 1 0 0-15.4 7.7 7.7 0 0 0 0 15.4zM20.4 20.4l-4.4-4.4M10.7 7.4v6.6M7.4 10.7h6.6',
  zoomOut: 'M10.7 18.4a7.7 7.7 0 1 0 0-15.4 7.7 7.7 0 0 0 0 15.4zM20.4 20.4l-4.4-4.4M7.4 10.7h6.6',
  reset: 'M4.2 10.6a8 8 0 1 1 2.2 6.2M4 5.4v5.4h5.4',
  undo: 'M9.4 5.2L3.6 11l5.8 5.8M3.9 11h10.3a5.1 5.1 0 0 1 0 10.2h-1.6',
  back: 'M10.4 5.2L3.6 12l6.8 6.8M3.6 12h13',
  font: 'M4 6.4V4h16v2.4M12 4v15.6M8.4 19.6h7.2',
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
