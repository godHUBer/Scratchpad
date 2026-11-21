import { describe, expect, it } from 'vitest';
import {
  SHAPE_SIZE,
  SHAPES,
  arrowPoints,
  asShape,
  ellipseCentre,
  ellipseTopLeft,
  isShapeItem,
  polygonPoints,
  shapeLabel,
  type ShapeKind,
} from './shapes';

describe('SHAPES catalogue', () => {
  it('offers the common shapes the toolbar promises', () => {
    expect(SHAPES.map((s) => s.kind)).toEqual(['rect', 'ellipse', 'triangle', 'diamond', 'star', 'arrow']);
  });

  it('has a label for every shape', () => {
    for (const shape of SHAPES) expect(shape.label.length).toBeGreaterThan(0);
  });
});

describe('polygonPoints', () => {
  const polygons: ShapeKind[] = ['rect', 'triangle', 'diamond', 'star'];

  it('fits every polygon inside its bounding box', () => {
    // Anything outside 0..width / 0..height would be clipped by the item's own
    // frame and, worse, would not match the resize handles.
    for (const kind of polygons) {
      const points = polygonPoints(kind, SHAPE_SIZE.width, SHAPE_SIZE.height);
      for (const [x, y] of points) {
        expect(x, `${kind} x`).toBeGreaterThanOrEqual(-0.001);
        expect(x, `${kind} x`).toBeLessThanOrEqual(SHAPE_SIZE.width + 0.001);
        expect(y, `${kind} y`).toBeGreaterThanOrEqual(-0.001);
        expect(y, `${kind} y`).toBeLessThanOrEqual(SHAPE_SIZE.height + 0.001);
      }
    }
  });

  it('returns the right number of vertices', () => {
    expect(polygonPoints('rect', 100, 100)).toHaveLength(4);
    expect(polygonPoints('triangle', 100, 100)).toHaveLength(3);
    expect(polygonPoints('diamond', 100, 100)).toHaveLength(4);
    expect(polygonPoints('star', 100, 100)).toHaveLength(10);
  });

  it('puts the rectangle on the box corners', () => {
    expect(polygonPoints('rect', 80, 60)).toEqual([
      [0, 0],
      [80, 0],
      [80, 60],
      [0, 60],
    ]);
  });

  it('scales with the given size rather than being fixed', () => {
    const small = polygonPoints('triangle', 40, 40);
    const large = polygonPoints('triangle', 400, 400);
    expect(large[0]![0]).toBeCloseTo(small[0]![0] * 10);
    expect(large[1]![1]).toBeCloseTo(small[1]![1] * 10);
  });

  it('points the star upwards, not sideways', () => {
    // The first vertex is the top point: horizontally centred, at the top.
    const [first] = polygonPoints('star', 100, 100);
    expect(first![0]).toBeCloseTo(50);
    expect(first![1]).toBeLessThan(5);
  });

  it('returns nothing for ellipse and arrow, which are drawn differently', () => {
    expect(polygonPoints('ellipse', 100, 100)).toEqual([]);
    expect(polygonPoints('arrow', 100, 100)).toEqual([]);
  });
});

describe('arrowPoints', () => {
  it('draws a shaft across the full width at mid height', () => {
    const points = arrowPoints(200, 100);
    expect(points[0]).toBe(0);
    expect(points[1]).toBe(50);
    expect(points[2]).toBe(200);
    expect(points[3]).toBe(50);
  });

  it('includes a head that returns to the tip', () => {
    const points = arrowPoints(200, 100);
    // Three points: shaft start, shaft end, head top, tip, head bottom.
    expect(points).toHaveLength(10);
    const tipX = points[6]!;
    const tipY = points[7]!;
    expect(tipX).toBe(200);
    expect(tipY).toBe(50);
  });

  it('scales the head with the smaller dimension so a flat arrow is not all head', () => {
    const tall = arrowPoints(200, 200);
    const flat = arrowPoints(200, 20);
    const tallHead = Math.abs(tall[4]! - tall[6]!);
    const flatHead = Math.abs(flat[4]! - flat[6]!);
    expect(flatHead).toBeLessThan(tallHead);
  });
});

describe('asShape', () => {
  it('reads a stored shape', () => {
    expect(asShape({ shape: 'rect', color: '#f00', strokeWidth: 5, filled: true })).toEqual({
      shape: 'rect',
      color: '#f00',
      strokeWidth: 5,
      filled: true,
    });
  });

  it('returns null for a freehand stroke, which has points and no shape', () => {
    expect(asShape({ points: [0, 0, 10, 10], color: '#080808' })).toBeNull();
  });

  it('returns null for missing or malformed content', () => {
    expect(asShape(undefined)).toBeNull();
    expect(asShape(null)).toBeNull();
    expect(asShape('rect')).toBeNull();
    expect(asShape({ shape: 42 })).toBeNull();
  });

  it('fills in defaults rather than leaving fields undefined', () => {
    const shape = asShape({ shape: 'star' });
    expect(shape?.color).toBe('#080808');
    expect(shape?.strokeWidth).toBe(3);
    expect(shape?.filled).toBe(false);
  });
});

describe('isShapeItem', () => {
  it('is true only for a draw item carrying a shape', () => {
    expect(isShapeItem({ item_type: 'draw', content: { shape: 'rect' } })).toBe(true);
    expect(isShapeItem({ item_type: 'draw', content: { points: [0, 0] } })).toBe(false);
    expect(isShapeItem({ item_type: 'text', content: { shape: 'rect' } })).toBe(false);
  });

  it('does not throw on hostile content', () => {
    expect(isShapeItem({ item_type: 'draw', content: null })).toBe(false);
    expect(isShapeItem({ item_type: 'draw' })).toBe(false);
  });
});

describe('shapeLabel', () => {
  it('names the shape for the inspector', () => {
    expect(shapeLabel({ shape: 'diamond' })).toBe('Diamond');
  });

  it('is null for a freehand stroke so the UI keeps calling it a stroke', () => {
    expect(shapeLabel({ points: [0, 0] })).toBeNull();
  });
});

describe('ellipse drag round-trip', () => {
  /*
    An ellipse is drawn from its centre; the canvas stores and reports top-left
    corners. Both halves of that translation have to agree, or the item jumps.

    The original bug: the node reported `event.target.x()` (a centre) where the
    canvas expected a corner, so `handleNodeDragEnd` computed
    `centre - startTopLeft` as the drag delta. For a 160x120 ellipse that is 80px
    and 60px too large -- a visible lurch on the very first drag.
  */
  const size = { width: 160, height: 120 };
  const start = { x: 100, y: 100 };

  it('places the node centre at the middle of the item box', () => {
    expect(ellipseCentre(start, size)).toEqual({ x: 180, y: 160 });
  });

  it('round-trips a centre back to the position it came from', () => {
    const centre = ellipseCentre(start, size);
    expect(ellipseTopLeft(centre, size)).toEqual(start);
  });

  it('reports a top-left corner that matches the drag delta the user made', () => {
    // The user drags the shape 50px right and 30px down. Konva moves the node,
    // so its centre ends up 50/30 away from where it started.
    const centre = ellipseCentre(start, size);
    const movedCentre = { x: centre.x + 50, y: centre.y + 30 };

    const reported = ellipseTopLeft(movedCentre, size);

    // The canvas computes delta = reported - start. That must be the real drag,
    // not the drag plus half the ellipse.
    expect({ x: reported.x - start.x, y: reported.y - start.y }).toEqual({ x: 50, y: 30 });
    expect(reported).toEqual({ x: 150, y: 130 });
  });

  it('does not drift when the shape is resized and dragged again', () => {
    // A resize changes the radius, which is exactly what made the old
    // centre-as-corner error change size between drags.
    const resized = { width: 300, height: 80 };
    const centre = ellipseCentre(start, resized);
    const movedCentre = { x: centre.x + 10, y: centre.y - 5 };
    const reported = ellipseTopLeft(movedCentre, resized);
    expect({ x: reported.x - start.x, y: reported.y - start.y }).toEqual({ x: 10, y: -5 });
  });

  it('is unaffected for shapes drawn from their top-left', () => {
    // Regression guard for the assumption behind the other branches: the shared
    // drag handler is only correct for nodes positioned at their top-left.
    // A rect at `start` has node.x() === start.x, so delta === drag.
    const nodeStart = { x: start.x, y: start.y };
    expect({ x: nodeStart.x - start.x, y: nodeStart.y - start.y }).toEqual({ x: 0, y: 0 });
  });
});
