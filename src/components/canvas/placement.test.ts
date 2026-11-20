import { describe, expect, it } from 'vitest';
import { findFreeSlot, sizeForKind, visibleCentre, worldFromScreen } from './placement';

const rect = (x: number, y: number, width = 320, height = 240) => ({ x, y, width, height });

describe('worldFromScreen', () => {
  it('inverts the viewport transform', () => {
    const viewport = { scale: 2, x: 100, y: 50 };
    expect(worldFromScreen(viewport, { x: 300, y: 250 })).toEqual({ x: 100, y: 100 });
  });
});

describe('visibleCentre', () => {
  it('uses the pane box, not the window, so panning and zoom are respected', () => {
    const viewport = { scale: 0.5, x: -200, y: -100 };
    // pane centre (400,300) -> world ((400+200)/0.5, (300+100)/0.5)
    expect(visibleCentre(viewport, { width: 800, height: 600 })).toEqual({ x: 1200, y: 800 });
  });
});

describe('findFreeSlot', () => {
  it('uses the preferred spot on an empty canvas', () => {
    expect(findFreeSlot({ x: 10, y: 20 }, { width: 320, height: 240 }, [])).toEqual({ x: 10, y: 20 });
  });

  it('never stacks two cards on the same spot', () => {
    const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
    const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (let index = 0; index < 12; index += 1) {
      const size = sizeForKind('image');
      const slot = findFreeSlot({ x: 0, y: 0 }, size, occupied);
      // the whole point: no two placements overlap
      for (const other of placed) {
        const separated =
          slot.x >= other.x + other.width || slot.x + size.width <= other.x ||
          slot.y >= other.y + other.height || slot.y + size.height <= other.y;
        expect(separated).toBe(true);
      }
      const next = { ...slot, ...size };
      placed.push(next);
      occupied.push(next);
    }
    expect(placed).toHaveLength(12);
  });

  it('is deterministic', () => {
    const occupied = [rect(0, 0)];
    const a = findFreeSlot({ x: 0, y: 0 }, sizeForKind('image'), occupied);
    const b = findFreeSlot({ x: 0, y: 0 }, sizeForKind('image'), occupied);
    expect(a).toEqual(b);
  });

  it('respects the padding when judging a collision', () => {
    const occupied = [rect(0, 0)];
    const tight = findFreeSlot({ x: 0, y: 240 }, sizeForKind('audio'), occupied, { padding: 0 });
    expect(tight).toEqual({ x: 0, y: 240 });
    const loose = findFreeSlot({ x: 0, y: 250 }, sizeForKind('audio'), occupied, { padding: 60 });
    expect(loose).not.toEqual({ x: 0, y: 250 });
  });

  it('always returns integers', () => {
    const slot = findFreeSlot({ x: 10.6, y: 20.2 }, sizeForKind('video'), []);
    expect(Number.isInteger(slot.x)).toBe(true);
    expect(Number.isInteger(slot.y)).toBe(true);
  });
});

describe('sizeForKind', () => {
  it('gives every media kind a positive size and audio a short card', () => {
    for (const kind of ['image', 'audio', 'video', 'bookmark', 'link']) {
      const size = sizeForKind(kind);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    }
    expect(sizeForKind('audio').height).toBeLessThan(sizeForKind('video').height);
  });
});
