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
import type { CanvasItemType } from '../types';

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'arrow' | 'star';

export interface ShapeSpec {
  kind: ShapeKind;
  label: string;
}

/** Offered in the toolbox, in the order they appear. */
export const SHAPES: ShapeSpec[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
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
    case 'arrow':
      // Arrows are stroked, not filled; the shaft is handled by arrowPoints.
      return [];
    case 'ellipse':
      // Ellipses are drawn with an Ellipse node, not a polygon.
      return [];
  }
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
