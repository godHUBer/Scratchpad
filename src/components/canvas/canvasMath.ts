export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.15;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Zoom keeping the pointer anchored to the same canvas point. */
export function zoomAtPoint(viewport: Viewport, pointer: { x: number; y: number }, nextScale: number): Viewport {
  const scale = clampScale(nextScale);
  const worldX = (pointer.x - viewport.x) / viewport.scale;
  const worldY = (pointer.y - viewport.y) / viewport.scale;
  return { scale, x: pointer.x - worldX * scale, y: pointer.y - worldY * scale };
}

export function screenToWorld(viewport: Viewport, point: { x: number; y: number }): { x: number; y: number } {
  return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function normalizeRect(start: { x: number; y: number }, end: { x: number; y: number }): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function itemRect(item: { position_x: number; position_y: number; width: number; height: number }): Rect {
  return { x: item.position_x, y: item.position_y, width: item.width, height: item.height };
}

/** Resize keeping the opposite corner fixed. */
export function resizeFromHandle(
  origin: Rect,
  handle: string,
  dx: number,
  dy: number,
  minSize = 40,
): Rect {
  let { x, y, width, height } = origin;

  if (handle.includes('e')) width = Math.max(minSize, origin.width + dx);
  if (handle.includes('s')) height = Math.max(minSize, origin.height + dy);
  if (handle.includes('w')) {
    width = Math.max(minSize, origin.width - dx);
    x = origin.x + (origin.width - width);
  }
  if (handle.includes('n')) {
    height = Math.max(minSize, origin.height - dy);
    y = origin.y + (origin.height - height);
  }
  return { x, y, width, height };
}

export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export function handlePosition(rect: Rect, handle: ResizeHandle): { x: number; y: number } {
  const horizontal = handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2;
  const vertical = handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2;
  return { x: horizontal, y: vertical };
}

export function handleCursor(handle: ResizeHandle): string {
  if (handle === 'n' || handle === 's') return 'ns-resize';
  if (handle === 'e' || handle === 'w') return 'ew-resize';
  if (handle === 'nw' || handle === 'se') return 'nwse-resize';
  return 'nesw-resize';
}

/** Fit a set of items into the viewport. */
export function fitViewport(
  items: Array<{ position_x: number; position_y: number; width: number; height: number }>,
  stage: { width: number; height: number },
  padding = 80,
): Viewport {
  if (items.length === 0) {
    return { scale: 1, x: stage.width / 2, y: stage.height / 2 };
  }
  const minX = Math.min(...items.map((i) => i.position_x));
  const minY = Math.min(...items.map((i) => i.position_y));
  const maxX = Math.max(...items.map((i) => i.position_x + i.width));
  const maxY = Math.max(...items.map((i) => i.position_y + i.height));
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const scale = clampScale(
    Math.min((stage.width - padding * 2) / worldW, (stage.height - padding * 2) / worldH, 1.5),
  );
  return {
    scale,
    x: stage.width / 2 - ((minX + maxX) / 2) * scale,
    y: stage.height / 2 - ((minY + maxY) / 2) * scale,
  };
}
