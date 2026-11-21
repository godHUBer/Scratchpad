/**
 * Icon geometry, borrowed from Its Hover (https://github.com/itshover/itshover).
 *
 * Its Hover is Apache-2.0, © Abhijit and contributors. Only the `d` path data
 * was taken; the animation logic is this project's own (see AnimatedGlyph).
 * Each glyph below names the upstream file it came from so a future update can
 * be diffed against the source rather than guessed at.
 *
 * Why geometry was borrowed rather than the components
 *   Upstream ships one React component per icon, each importing `motion` and
 *   building its own animation. Dropping those in would have put `motion` in the
 *   entry bundle: measured at +55 kB gzip, taking the entry from 158 to 213 kB
 *   against a 160 kB budget. The paths are the valuable part and cost nothing,
 *   so the paths are what we took.
 *
 * Coverage is deliberately partial
 *   Its Hover has no equivalent for plus, zoomIn, zoomOut, eraser, hand, font,
 *   image, video, sun or settings. Those keep their hand-drawn geometry, which
 *   is why `paths` here is optional per name rather than a total replacement.
 *   `text` is the one judgement call: upstream's letter-a-icon is a bare "A"
 *   chevron, not a typography mark, so our two-letter glyph was kept. Eleven
 *   names in total remain hand-drawn.
 *
 * Multiple paths, not one
 *   The previous set packed each glyph into a single `d` with sub-paths. These
 *   are genuinely several strokes, and keeping them separate is what lets an
 *   animation move one part (a bin lid) without redrawing the rest.
 */

/** Which motion archetype an icon plays on hover. */
export type GlyphMotion =
  /** Stroke draws itself on, like it is being written. */
  | 'draw'
  /** A small vertical lift, for actions that send something away. */
  | 'lift'
  /** Scale up slightly and settle. */
  | 'pop'
  /** A brief tilt, for objects with a lid or handle. */
  | 'wobble'
  /** A horizontal nudge, for movement. */
  | 'slide'
  /** The last stroke breathes, for sound or live data. */
  | 'pulse';

export interface Glyph {
  /** Upstream source file, for attribution and future diffing. */
  source: string;
  /** One `d` per stroke, in draw order. */
  paths: readonly string[];
  motion: GlyphMotion;
}

/**
 * Every glyph borrowed from Its Hover.
 *
 * Not all 29 names are here: see the module comment. Names absent from this map
 * fall back to the hand-drawn geometry in Icon.tsx.
 */
export const BORROWED: Record<string, Glyph> = {
  trash: {
    source: 'trash-icon.tsx',
    // Lid, two ribs, body, handle. The lid animates separately upstream; here
    // the whole glyph wobbles, which reads the same at 14 px.
    paths: [
      'M4 7l16 0',
      'M10 11l0 6',
      'M14 11l0 6',
      'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12',
      'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
    ],
    motion: 'wobble',
  },
  link: {
    source: 'link-icon.tsx',
    paths: [
      'M9 15l6 -6',
      'M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464',
      'M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463',
    ],
    motion: 'slide',
  },
  home: {
    source: 'home-icon.tsx',
    paths: ['M5 12l-2 0l9 -9l9 9l-2 0', 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7', 'M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6'],
    motion: 'lift',
  },
  bookmarkShelf: {
    source: 'library-icon.tsx',
    paths: ['m16 6 4 14', 'M12 6v14', 'M8 8v12', 'M4 4v16'],
    motion: 'pop',
  },
  users: {
    source: 'users-icon.tsx',
    paths: [
      'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
      'M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2',
      'M16 3.13a4 4 0 0 1 0 7.75',
      'M21 21v-2a4 4 0 0 0 -3 -3.85',
    ],
    motion: 'pop',
  },
  mail: {
    source: 'mail-filled-icon.tsx',
    paths: ['M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z', 'M3 7l9 6l9 -6'],
    motion: 'lift',
  },
  reset: {
    source: 'refresh-icon.tsx',
    paths: ['M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4', 'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4'],
    motion: 'draw',
  },
  undo: {
    source: 'history-circle-icon.tsx',
    paths: ['M12 8l0 4l2 2', 'M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5'],
    motion: 'draw',
  },
  close: {
    source: 'x-icon.tsx',
    paths: ['M18 6l-12 12', 'M6 6l12 12'],
    motion: 'draw',
  },
  check: {
    source: 'checked-icon.tsx',
    paths: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M9 12l2 2l4 -4'],
    motion: 'draw',
  },
  select: {
    source: 'mouse-pointer-2-icon.tsx',
    paths: ['M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z'],
    motion: 'slide',
  },
  audio: {
    source: 'volume-2-icon.tsx',
    paths: [
      'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
      'M16 9a5 5 0 0 1 0 6',
      'M19.364 18.364a9 9 0 0 0 0 -12.728',
    ],
    motion: 'pulse',
  },
  external: {
    source: 'external-link-icon.tsx',
    paths: ['M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6', 'M11 13l9 -9', 'M15 4h5v5'],
    motion: 'lift',
  },
  moon: {
    source: 'moon-icon.tsx',
    paths: ['M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z'],
    motion: 'pop',
  },
  clock: {
    source: 'clock-icon.tsx',
    paths: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 7v5l3 3'],
    motion: 'wobble',
  },
  brush: {
    source: 'paint-icon.tsx',
    // Upstream draws a paint bucket; the palette shape reads closer to "brush"
    // in this toolbar's row than the previous angled-brush idiom did, and it is
    // still distinct from text (A) beside it.
    paths: [
      'M5 3m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z',
      'M19 6h1a2 2 0 0 1 2 2a5 5 0 0 1 -5 5l-5 0v2',
      'M10 15m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z',
    ],
    motion: 'wobble',
  },
  copy: {
    source: 'copy-icon.tsx',
    paths: [
      'M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
      'M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z',
    ],
    motion: 'slide',
  },
  back: {
    source: 'arrow-back-icon.tsx',
    paths: ['M9 11l-4 4l4 4m-4 -4h11a4 4 0 0 0 0 -8h-1'],
    motion: 'slide',
  },
};
