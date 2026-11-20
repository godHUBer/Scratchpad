import { describe, expect, it } from 'vitest';
import { clampScale, screenToWorld, zoomAtPoint, type Viewport } from './canvasMath';

// Replicates the exact arithmetic in WorkspaceCanvas.onTouchMoveGesture so the
// pinch behaviour is pinned down by a test rather than by eye.
//
// The gesture object carries the viewport the pinch began in. Each move is
// computed from that fixed snapshot — never from the previous frame — because
// anchoring to the live viewport compounds the midpoint offset frame by frame.
interface Gesture {
  distance: number;
  center: { x: number; y: number };
  scale: number;
  viewport: Viewport;
}

function pinchAt(gesture: Gesture, current: { distance: number; center: { x: number; y: number } }): Viewport {
  const ratio = gesture.distance > 0 ? current.distance / gesture.distance : 1;
  const nextScale = clampScale(gesture.scale * ratio);
  const zoomed = zoomAtPoint(gesture.viewport, gesture.center, nextScale);
  return {
    ...zoomed,
    x: zoomed.x + (current.center.x - gesture.center.x),
    y: zoomed.y + (current.center.y - gesture.center.y),
  };
}

function begin(start: Viewport, center: { x: number; y: number }, distance: number): Gesture {
  return { distance, center, scale: start.scale, viewport: start };
}

describe('two-finger pinch', () => {
  it('zooms in when the fingers spread apart', () => {
    const start = { scale: 1, x: 0, y: 0 };
    const next = pinchAt(begin(start, { x: 50, y: 50 }, 100), { distance: 200, center: { x: 50, y: 50 } });
    expect(next.scale).toBeCloseTo(2);
  });

  it('zooms out when the fingers close', () => {
    const start = { scale: 1, x: 0, y: 0 };
    const next = pinchAt(begin(start, { x: 50, y: 50 }, 200), { distance: 100, center: { x: 50, y: 50 } });
    expect(next.scale).toBeCloseTo(0.5);
  });

  it('keeps the canvas point under the fingers fixed while zooming', () => {
    const start: Viewport = { scale: 1, x: 30, y: 40 };
    const center = { x: 200, y: 150 };
    const before = screenToWorld(start, center);
    const next = pinchAt(begin(start, center, 100), { distance: 250, center });
    const after = screenToWorld(next, center);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('pans by the midpoint travel, so pinch and two-finger drag compose', () => {
    const start: Viewport = { scale: 1, x: 0, y: 0 };
    // No spread change, midpoint moves +40/+25
    const next = pinchAt(begin(start, { x: 100, y: 100 }, 100), { distance: 100, center: { x: 140, y: 125 } });
    expect(next.scale).toBeCloseTo(1);
    expect(next.x).toBeCloseTo(40);
    expect(next.y).toBeCloseTo(25);
  });

  it('clamps at the shared scale limits instead of running away', () => {
    const start = { scale: 1, x: 0, y: 0 };
    const huge = pinchAt(begin(start, { x: 0, y: 0 }, 10), { distance: 10000, center: { x: 0, y: 0 } });
    expect(huge.scale).toBe(4); // MAX_SCALE
    const tiny = pinchAt(begin(start, { x: 0, y: 0 }, 10000), { distance: 1, center: { x: 0, y: 0 } });
    expect(tiny.scale).toBe(0.15); // MIN_SCALE
  });

  it('does not divide by zero when the two fingers start at the same point', () => {
    const start = { scale: 1, x: 0, y: 0 };
    expect(() => pinchAt(begin(start, { x: 0, y: 0 }, 0), { distance: 50, center: { x: 0, y: 0 } })).not.toThrow();
  });

  it('anchors a multi-frame pinch to the gesture start, without drift', () => {
    // Regression test. Anchoring each frame to the *live* viewport while still
    // measuring the midpoint against its start position compounds the offset:
    // after this four-step pinch the content had slid ~27px off the fingers.
    const start: Viewport = { scale: 1, x: 120, y: 80 };
    const gesture = begin(start, { x: 200, y: 200 }, 100);

    const moves = [
      { distance: 120, center: { x: 205, y: 205 } },
      { distance: 160, center: { x: 215, y: 212 } },
      { distance: 220, center: { x: 230, y: 220 } },
      { distance: 280, center: { x: 250, y: 230 } },
    ];

    let viewport = start;
    for (const move of moves) viewport = pinchAt(gesture, move);

    // The canvas point that was under the fingers when the pinch began must
    // still be under the fingers at the end.
    const endCenter = moves.at(-1)!.center;
    const before = screenToWorld(start, gesture.center);
    const after = screenToWorld(viewport, endCenter);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(viewport.scale).toBeCloseTo(2.8, 5);
  });
});
