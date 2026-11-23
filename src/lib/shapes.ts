/**
 * Common shapes, drawn as canvas items.
 *
 * Why they live on the existing `draw` item type instead of a new `shape` type:
 * `canvas_items.item_type` has a CHECK constraint listing the allowed types
 * (`20261119000100_init_schema.sql`). Adding `'shape'` would need a migration,
 * and every policy and RPC that mentions item types would have to be re-read.
 * A shape is, operationally, a stroke: position, size and a `content` blob. So a
 * shape is stored as `item_type: 'draw'` with `content.shape` set, which means:
 *
 *   - existing rows keep working untouched (no backfill, no version skew)
 *   - erasing, moving, resizing, layering, undo and redo all work already
 *   - a client that predates this feature renders it as an empty stroke rather
 *     than crashing, because `points` is absent
 *
 * The cost is one branch in the renderer, which is cheaper than a migration and
 * is honest about what the data is.
 */
import type { CanvasItemType, ShapeKind } from '../types';

/**
 * Re-exported from ../types, which is where it is declared.
 *
 * The union used to be written out here as well as in the item's content type.
 * Two copies drifted the moment shapes were added: the toolbox and geometry knew
 * about a new shape, the stored-content type did not, and the compiler pointed at
 * the page rather than at the duplication.
 */
export type { ShapeKind } from '../types';

export interface ShapeSpec {
  kind: ShapeKind;
  label: string;
}

/** Offered in the toolbox, in the order they appear. */
export const SHAPES: ShapeSpec[] = [
  { kind: 'line', label: 'Line' },
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'roundedRect', label: 'Rounded rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'rightTriangle', label: 'Right triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'trapezoid', label: 'Trapezoid' },
  { kind: 'parallelogram', label: 'Parallelogram' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'octagon', label: 'Octagon' },
  { kind: 'cylinder', label: 'Cylinder' },
  { kind: 'star', label: 'Star' },
  { kind: 'arrow', label: 'Arrow' },
];

/** Stored shape: what the renderer reads back. */
export interface ShapeContent {
  shape: ShapeKind;
  color: string;
  strokeWidth: number;
  /** Outline only, versus filled with a tinted version of `color`. */
  filled: boolean;
}

/** Every shape is created at this size before the user resizes it. */
export const SHAPE_SIZE = { width: 160, height: 120 };

/**
 * Points for an arrow inside a box, as an SVG-style path command list.
 *
 * Kept separate from the polygon shapes because an arrow is a stroked line with
 * a head, not a closed path.
 */
export function arrowPoints(width: number, height: number): number[] {
  // A single horizontal shaft with a two-stroke head, drawn in local space so
  // the item's own position and size drive everything.
  const head = Math.min(width, height) * 0.28;
  const midY = height / 2;
  return [0, midY, width, midY, width - head, midY - head * 0.8, width, midY, width - head, midY + head * 0.8];
}

/**
 * Vertices for the polygon shapes, generated to fit `width` x `height`.
 *
 * Returns a closed list of [x, y] pairs in local coordinates (0..width,
 * 0..height) so the renderer only ever has to scale by the item's own size.
 */
export function polygonPoints(kind: ShapeKind, width: number, height: number): Array<[number, number]> {
  const w = width;
  const h = height;
  switch (kind) {
    case 'rect':
      return [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ];
    case 'triangle':
      return [
        [w / 2, 0],
        [w, h],
        [0, h],
      ];
    case 'diamond':
      return [
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ];
    case 'star': {
      // Five-pointed star: alternate outer and inner radii around the centre.
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.42;
      const points: Array<[number, number]> = [];
      for (let i = 0; i < 10; i += 1) {
        const radius = i % 2 === 0 ? outer : inner;
        // Start at -90° so the star points up rather than sideways.
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
      }
      return points;
    }
    case 'line':
      // A line is two points, drawn open. Sharing the polygon renderer keeps
      // one code path: the renderer skips `closed` for this kind.
      return [
        [0, 0],
        [w, h],
      ];
    case 'roundedRect':
      // The corners are rounded by the renderer's cornerRadius; the vertices are
      // the same as a rectangle so hit-testing and bounds agree.
      return [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ];
    case 'rightTriangle':
      return [
        [0, 0],
        [0, h],
        [w, h],
      ];
    case 'trapezoid': {
      // Sloped by a sixth of the width, which reads as a trapezoid at any size
      // without the top vanishing on a narrow box.
      const inset = w / 6;
      return [
        [inset, 0],
        [w - inset, 0],
        [w, h],
        [0, h],
      ];
    }
    case 'parallelogram': {
      const skew = w / 5;
      return [
        [skew, 0],
        [w, 0],
        [w - skew, h],
        [0, h],
      ];
    }
    case 'pentagon':
      return regularPolygon(5, w, h);
    case 'hexagon':
      return regularPolygon(6, w, h);
    case 'octagon':
      return regularPolygon(8, w, h);
    case 'cylinder':
      // The body is a rectangle; the renderer draws the two elliptical caps on
      // top so the shape reads as a tube rather than a box.
      return [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ];
    case 'arrow':
      // Arrows are stroked, not filled; the shaft is handled by arrowPoints.
      return [];
    case 'ellipse':
      // Ellipses are drawn with an Ellipse node, not a polygon.
      return [];
  }
}

/**
 * A regular n-gon inscribed in the item's box.
 *
 * Uses half-width and half-height as separate radii, so a shape stretched into a
 * wide rectangle becomes a stretched polygon rather than a circle-shaped one
 * floating in the middle of the box. Starts at -90° so a pentagon points up.
 */
function regularPolygon(sides: number, width: number, height: number): Array<[number, number]> {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return points;
}

/** True when the item is a shape rather than a freehand stroke. */
export function isShapeItem(item: { item_type: CanvasItemType; content?: unknown }): boolean {
  if (item.item_type !== 'draw' || typeof item.content !== 'object' || item.content === null) return false;
  return typeof (item.content as Record<string, unknown>).shape === 'string';
}

/**
 * Reads a stored shape, or null when the item is a freehand stroke.
 *
 * Takes `unknown` because the content type is a union that does not carry an
 * index signature; every field is checked before use anyway.
 */
export function asShape(content: unknown): ShapeContent | null {
  if (typeof content !== 'object' || content === null) return null;
  const record = content as Record<string, unknown>;
  if (typeof record.shape !== 'string') return null;
  return {
    shape: record.shape as ShapeKind,
    color: typeof record.color === 'string' ? record.color : '#080808',
    strokeWidth: typeof record.strokeWidth === 'number' ? record.strokeWidth : 3,
    filled: record.filled === true,
  };
}

/** Human label for the item inspector ("Rectangle", "Stroke", …). */
export function shapeLabel(content: unknown): string | null {
  const shape = asShape(content);
  if (!shape) return null;
  return SHAPES.find((s) => s.kind === shape.shape)?.label ?? 'Shape';
}

/**
 * Where an ellipse's Konva node sits, given the item's top-left position.
 *
 * Konva positions an Ellipse by its centre; every other shape in this file is
 * drawn from its top-left, and `position_x/y` is always the top-left. Keeping
 * this translation in one place is what stops the renderer and the drag handler
 * from disagreeing about which point they are talking about.
 */
export function ellipseCentre(position: { x: number; y: number }, size: { width: number; height: number }) {
  return { x: position.x + size.width / 2, y: position.y + size.height / 2 };
}

/**
 * The inverse: turn a dragged ellipse's centre back into a top-left position.
 *
 * The canvas reports drags as top-left corners -- `handleNodeDragEnd` computes
 * `reported - start.position` -- so an ellipse that reported its raw centre made
 * the drag delta too large by exactly half the ellipse. It lurched forward by
 * that amount on the first drag and the error compounded on every later one.
 */
export function ellipseTopLeft(centre: { x: number; y: number }, size: { width: number; height: number }) {
  return { x: centre.x - size.width / 2, y: centre.y - size.height / 2 };
}
