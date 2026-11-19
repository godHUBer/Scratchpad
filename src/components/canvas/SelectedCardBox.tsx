import { useEffect, useRef, useState } from 'react';
import {
  handleCursor,
  handlePosition,
  RESIZE_HANDLES,
  resizeFromHandle,
  type ResizeHandle,
} from './canvasMath';
import type { CanvasItem } from '../../types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectedCardBoxProps {
  item: CanvasItem;
  /** screen-space position/zoom of the canvas */
  viewport: { x: number; y: number; scale: number };
  canWrite: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragMove: (rect: Rect) => void;
  onDragEnd: (rect: Rect) => void;
  onResizeMove: (rect: Rect) => void;
  onResizeEnd: (rect: Rect) => void;
  children: React.ReactNode;
}

/**
 * The card bodies live in the DOM (so <video>/<audio>/<a> work natively), which
 * means they need their own drag + resize affordances that mirror the Konva
 * node in screen space. This component owns that interaction.
 */
export function SelectedCardBox({
  item,
  viewport,
  canWrite,
  isDragging,
  onDragStart,
  onDragMove,
  onDragEnd,
  onResizeMove,
  onResizeEnd,
  children,
}: SelectedCardBoxProps) {
  const [live, setLive] = useState<Rect | null>(null);
  const [resize, setResize] = useState<{ handle: ResizeHandle; start: { x: number; y: number }; origin: Rect } | null>(
    null,
  );
  const dragRef = useRef<{ startX: number; startY: number; origin: Rect } | null>(null);

  useEffect(() => {
    setLive(null);
  }, [item.id]);

  const rect = live ?? { x: item.position_x, y: item.position_y, width: item.width, height: item.height };
  const style = {
    left: rect.x * viewport.scale + viewport.x,
    top: rect.y * viewport.scale + viewport.y,
    width: rect.width * viewport.scale,
    height: rect.height * viewport.scale,
  };

  // ---- dragging (only when not starting on an interactive control)
  const onPointerDown = (event: React.PointerEvent) => {
    if (!canWrite) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, audio, video, input, select, textarea, [data-no-drag]')) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: item.position_x, y: item.position_y, width: item.width, height: item.height },
    };
    onDragStart();
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (resize) {
      const dx = (event.clientX - resize.start.x) / viewport.scale;
      const dy = (event.clientY - resize.start.y) / viewport.scale;
      const next = resizeFromHandle(resize.origin, resize.handle, dx, dy);
      setLive(next);
      onResizeMove(next);
      return;
    }
    if (!dragRef.current) return;
    const dx = (event.clientX - dragRef.current.startX) / viewport.scale;
    const dy = (event.clientY - dragRef.current.startY) / viewport.scale;
    const next = {
      ...dragRef.current.origin,
      x: Math.round(dragRef.current.origin.x + dx),
      y: Math.round(dragRef.current.origin.y + dy),
    };
    setLive(next);
    onDragMove(next);
  };

  const onPointerUp = () => {
    if (resize) {
      const finalRect = live ?? rect;
      setResize(null);
      onResizeEnd(finalRect);
      return;
    }
    if (dragRef.current) {
      dragRef.current = null;
      const finalRect = live ?? rect;
      setLive(null);
      onDragEnd(finalRect);
    }
  };

  const handlePointerDown = (handle: ResizeHandle) => (event: React.PointerEvent) => {
    if (!canWrite) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setResize({
      handle,
      start: { x: event.clientX, y: event.clientY },
      origin: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  };

  return (
    <div
      className={`absolute select-none ${isDragging ? 'z-20' : 'z-10'}`}
      style={{ ...style, touchAction: 'none', cursor: canWrite ? 'grab' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-card={item.id}
    >
      <div className="h-full w-full">{children}</div>
      {canWrite ? (
        <div
          className="pointer-events-none absolute -inset-[5px] rounded-[16px] border-[2.5px] border-dashed border-ink"
          aria-hidden
        >
          {RESIZE_HANDLES.map((handle) => {
            const pos = handlePosition({ x: 0, y: 0, width: rect.width * viewport.scale, height: rect.height * viewport.scale }, handle);
            return (
              <span
                key={handle}
                role="presentation"
                onPointerDown={handlePointerDown(handle)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className="pointer-events-auto absolute h-3.5 w-3.5 rounded-sm border-2 border-ink bg-paper"
                style={{
                  left: pos.x - 7,
                  top: pos.y - 7,
                  cursor: handleCursor(handle),
                  touchAction: 'none',
                }}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
