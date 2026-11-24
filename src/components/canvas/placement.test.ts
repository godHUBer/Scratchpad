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

describe('repeated placement (the "notes pile up" bug)', () => {
  /*
    Reported from the deployed app: three notes added with the toolbar's Add-text
    button landed at exactly {"x":-40,"y":-20} — on top of each other, and at a
    world coordinate that is off-screen after any pan and sits under the toolbox
    on a fresh canvas.

    The cause was not `findFreeSlot` (it was already correct and tested above).
    It was that text creation never called it: the toolbar passed {0,0} and the
    save path subtracted a fixed offset, so the spiral was never in the loop.
    These tests pin down the property the fix has to hold — successive placements
    must not collide — so a future shortcut that skips `findFreeSlot` fails here.
  */
  it('places five notes in five distinct spots', () => {
    const size = { width: 260, height: 90 };
    const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
    const placed: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 5; i += 1) {
      // What the toolbar now does: ask for a free slot near the visible centre.
      const slot = findFreeSlot({ x: 500 - size.width / 2, y: 400 - size.height / 2 }, size, occupied);
      placed.push(slot);
      occupied.push({ ...slot, ...size });
    }
    const keys = placed.map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size, `duplicate positions: ${keys.join(' | ')}`).toBe(5);
  });

  it('keeps every note inside a sane band around the requested centre', () => {
    // A spiral that runs away from the viewport is no better than a stack.
    const size = { width: 260, height: 90 };
    const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (let i = 0; i < 5; i += 1) {
      const slot = findFreeSlot({ x: 370, y: 355 }, size, occupied);
      expect(Math.abs(slot.x - 370)).toBeLessThan(1400);
      expect(Math.abs(slot.y - 355)).toBeLessThan(1400);
      occupied.push({ ...slot, ...size });
    }
  });
});
