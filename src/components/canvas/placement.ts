/**
 * Where a newly added card should land.
 *
 * The old code placed every new card at the same spot when nothing was
 * selected:
 *
 *   x: -window.innerWidth / (2 * zoom) + 120
 *   y: -window.innerHeight / (2 * zoom) + 140
 *
 * `window.innerWidth` is the *pane* width, not the canvas viewport, so the
 * offset was wrong at any zoom other than 1, and it ignored panning entirely.
 * Adding three files in a row stacked three cards exactly on top of each other.
 *
 * This module works in canvas (world) coordinates and asks for a free spot.
 */

export interface PlacementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacementViewport {
  scale: number;
  /** screen-space offset of the canvas origin */
  x: number;
  y: number;
}

/** Screen point -> canvas point. Mirrors canvasMath.screenToWorld. */
export function worldFromScreen(viewport: PlacementViewport, screen: { x: number; y: number }) {
  return {
    x: (screen.x - viewport.x) / viewport.scale,
    y: (screen.y - viewport.y) / viewport.scale,
  };
}

function overlaps(a: PlacementRect, b: PlacementRect, padding: number): boolean {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}

/**
 * Find a free slot near `preferred`, spiralling outwards until the card does not
 * collide with anything already on the canvas.
 *
 * Deterministic by construction: the same canvas + same input always yields the
 * same slot, which keeps this testable and keeps `undo` predictable.
 */
export function findFreeSlot(
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  occupied: ReadonlyArray<PlacementRect>,
  options: { padding?: number; maxSteps?: number } = {},
): { x: number; y: number } {
  const padding = options.padding ?? 24;
  const maxSteps = options.maxSteps ?? 120;
  const step = { x: size.width + padding, y: size.height + padding };

  const candidate = (index: number) => {
    // 0 -> the preferred spot; then right, down-right, down, down-left, left,
    // up-left, up, up-right — a square spiral that stays close to the pointer.
    const ring = Math.ceil((Math.sqrt(index + 1) - 1) / 2);
    if (index === 0) return { x: preferred.x, y: preferred.y, ring };
    const offsets = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ] as const;
    const offset = offsets[(index - 1) % 8]!;
    const lap = Math.floor((index - 1) / 8) + 1;
    return {
      x: preferred.x + offset[0] * step.x * lap,
      y: preferred.y + offset[1] * step.y * lap,
      ring,
    };
  };

  for (let index = 0; index < maxSteps; index += 1) {
    const spot = candidate(index);
    const rect = { x: spot.x, y: spot.y, width: size.width, height: size.height };
    if (!occupied.some((other) => overlaps(rect, other, padding / 2))) {
      return { x: Math.round(spot.x), y: Math.round(spot.y) };
    }
  }
  // Extremely dense canvas: fall back to a diagonal so cards are never stacked.
  return {
    x: Math.round(preferred.x + step.x * Math.ceil(maxSteps / 2)),
    y: Math.round(preferred.y + step.y * Math.ceil(maxSteps / 2)),
  };
}

/** Card size for a new asset, so placement and creation agree. */
export function sizeForKind(kind: string): { width: number; height: number } {
  if (kind === 'image') return { width: 320, height: 240 };
  // Drive's player chrome needs room; 132px showed a clipped sliver.
  if (kind === 'audio') return { width: 320, height: 200 };
  if (kind === 'video') return { width: 380, height: 240 };
  if (kind === 'bookmark') return { width: 280, height: 170 };
  return { width: 320, height: 180 };
}

/**
 * Centre of the visible canvas, in world coordinates.
 *
 * `pane` is the canvas element's bounding box (not `window.inner*`), which is
 * what actually determines what the user is looking at.
 */
export function visibleCentre(viewport: PlacementViewport, pane: { width: number; height: number }) {
  return worldFromScreen(viewport, { x: pane.width / 2, y: pane.height / 2 });
}
