import { describe, expect, it } from 'vitest';
import {
  SHAPE_SIZE,
  SHAPES,
  arrowPoints,
  asShape,
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
