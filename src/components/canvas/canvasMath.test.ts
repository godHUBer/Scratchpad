import { describe, expect, it } from 'vitest';
import {
  fitViewport,
  itemRect,
  normalizeRect,
  rectContains,
  rectsIntersect,
  resizeFromHandle,
  screenToWorld,
  zoomAtPoint,
} from './canvasMath';

describe('zoomAtPoint', () => {
  it('keeps the world point under the cursor fixed', () => {
    const viewport = { scale: 1, x: 0, y: 0 };
    const pointer = { x: 200, y: 100 };
    const before = screenToWorld(viewport, pointer);
    const next = zoomAtPoint(viewport, pointer, 2);
    const after = screenToWorld({ scale: next.scale, x: next.x, y: next.y }, pointer);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps scale to sane bounds', () => {
    expect(zoomAtPoint({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 100).scale).toBe(4);
    expect(zoomAtPoint({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 0.0001).scale).toBe(0.15);
  });
});

describe('rectangle helpers', () => {
  it('normalizes drag direction', () => {
    expect(normalizeRect({ x: 50, y: 50 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 40, height: 30 });
  });

  it('detects intersection and containment', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectsIntersect(a, { x: 90, y: 90, width: 50, height: 50 })).toBe(true);
    expect(rectsIntersect(a, { x: 200, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectContains(a, { x: 10, y: 10, width: 10, height: 10 })).toBe(true);
    expect(rectContains(a, { x: 95, y: 95, width: 10, height: 10 })).toBe(false);
    expect(itemRect({ position_x: 5, position_y: 6, width: 7, height: 8 })).toEqual({
      x: 5,
      y: 6,
      width: 7,
      height: 8,
    });
  });
});

describe('resizeFromHandle', () => {
  const origin = { x: 100, y: 100, width: 200, height: 100 };

  it('grows from the south-east corner', () => {
    expect(resizeFromHandle(origin, 'se', 20, 10)).toEqual({ x: 100, y: 100, width: 220, height: 110 });
  });

  it('keeps the opposite corner fixed when dragging the north-west handle', () => {
    const next = resizeFromHandle(origin, 'nw', -20, -10);
    expect(next.x).toBe(80);
    expect(next.y).toBe(90);
    expect(next.x + next.width).toBe(300);
    expect(next.y + next.height).toBe(200);
  });

  it('never goes below the minimum size', () => {
    const next = resizeFromHandle(origin, 'e', -1000, 0, 40);
    expect(next.width).toBe(40);
  });
});

describe('fitViewport', () => {
  it('centres an empty canvas', () => {
    expect(fitViewport([], { width: 800, height: 600 })).toEqual({ scale: 1, x: 400, y: 300 });
  });

  it('fits items inside the stage', () => {
    const view = fitViewport(
      [{ position_x: 0, position_y: 0, width: 1000, height: 1000 }],
      { width: 800, height: 600 },
      50,
    );
    expect(view.scale).toBeLessThan(1);
    const topLeft = { x: view.x, y: view.y };
    const bottomRight = { x: view.x + 1000 * view.scale, y: view.y + 1000 * view.scale };
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(800);
    expect(bottomRight.y).toBeLessThanOrEqual(600);
  });
});
