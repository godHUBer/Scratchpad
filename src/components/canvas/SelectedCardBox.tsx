import { useEffect, useRef, useState } from 'react';
import {
  handleCursor,
  handlePosition,
  RESIZE_HANDLES,
  resizeFromHandle,
  type ResizeHandle,
} from './canvasMath';
import type { CanvasItem } from '../../types';
import { useCoarsePointer } from '../../hooks/useCoarsePointer';

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
  /** editors and owners may move/resize; viewers may only look */
  canWrite: boolean;
  /** false while a drawing tool is active: let the pointer reach the stage */
  interactive: boolean;
  selected: boolean;
  isDragging: boolean;
  /** eraser tool: clicking the card deletes it instead of dragging it */
  eraseMode?: boolean;
  onErase?: () => void;
  onActivate: (additive: boolean) => void;
  onDragStart: () => void;
  onDragCancel: () => void;
  onDragMove: (rect: Rect) => void;
  onDragEnd: (rect: Rect) => void;
  onResizeMove: (rect: Rect) => void;
  onResizeEnd: (rect: Rect) => void;
  children: React.ReactNode;
}

// Anything the user must be able to click *without* moving the card. The media
// players, the "open" links and the preview iframe all live in here.
const NO_DRAG =
  'button, a, audio, video, iframe, input, select, textarea, label, [role="slider"], [data-no-drag]';

/**
 * The card bodies live in the DOM (so <video>/<audio>/<a> work natively), which
 * means they need their own drag + resize affordances that mirror the Konva
 * shape in screen space. This component owns that interaction.
 */
export function SelectedCardBox({
  item,
  viewport,
  canWrite,
  interactive,
  selected,
  isDragging,
  eraseMode = false,
  onErase,
  onActivate,
  onDragStart,
  onDragCancel,
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
  const movedRef = useRef(false);

  // discard any in-flight geometry when the item is replaced (realtime refresh)
  useEffect(() => {
    setLive(null);
    dragRef.current = null;
    movedRef.current = false;
  }, [item.id]);

  const rect = live ?? { x: item.position_x, y: item.position_y, width: item.width, height: item.height };
  // A 14px grab handle is usable with a mouse and not with a thumb.
  const handleSize = useCoarsePointer() ? 24 : 14;
  const style = {
    left: rect.x * viewport.scale + viewport.x,
    top: rect.y * viewport.scale + viewport.y,
    width: rect.width * viewport.scale,
    height: rect.height * viewport.scale,
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!interactive) return;
    if (eraseMode) {
      event.preventDefault();
      event.stopPropagation();
      onErase?.();
      return;
    }
    onActivate(event.shiftKey);
    if (!canWrite) return;
    const target = event.target as HTMLElement;
    if (target.closest(NO_DRAG)) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: item.position_x, y: item.position_y, width: item.width, height: item.height },
    };
    movedRef.current = false;
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
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / viewport.scale;
    const dy = (event.clientY - drag.startY) / viewport.scale;
    const next = {
      ...drag.origin,
      x: Math.round(drag.origin.x + dx),
      y: Math.round(drag.origin.y + dy),
    };
    if (!movedRef.current) {
      // threshold so a plain click never triggers a write
      if (Math.abs(event.clientX - drag.startX) < 3 && Math.abs(event.clientY - drag.startY) < 3) return;
      movedRef.current = true;
      onDragStart();
    }
    setLive(next);
    onDragMove(next);
  };

  const onPointerUp = () => {
    if (resize) {
      const finalRect = live ?? rect;
      setResize(null);
      setLive(null);
      onResizeEnd(finalRect);
      return;
    }
    if (!dragRef.current) return;
    dragRef.current = null;
    const finalRect = live ?? rect;
    setLive(null);
    if (movedRef.current) {
      movedRef.current = false;
      onDragEnd(finalRect);
    } else {
      onDragCancel();
    }
  };

  const handlePointerDown = (handle: ResizeHandle) => (event: React.PointerEvent) => {
    if (!canWrite || !interactive) return;
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
      style={{
        ...style,
        touchAction: 'none',
        pointerEvents: interactive ? 'auto' : 'none',
        cursor: eraseMode ? 'crosshair' : canWrite ? 'grab' : 'default',
      }}
      onPointerDown={onPointerDown}
      // Erasing with a drag: a card is a DOM element, so the Konva intersection
      // test in WorkspaceCanvas cannot see it. Hovering while the eraser is held
      // down erases this card, matching the stroke behaviour on the canvas.
      onPointerMove={(event) => {
        onPointerMove(event);
        if (eraseMode && event.buttons !== 0) onErase?.();
      }}
      onPointerEnter={(event) => {
        if (eraseMode && event.buttons !== 0) onErase?.();
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-card={item.id}
    >
      <div className="h-full w-full">{children}</div>
      {canWrite && selected && !eraseMode ? (
        <div className="pointer-events-none absolute -inset-[5px] rounded-[16px] border-[2.5px] border-dashed border-ink" aria-hidden>
          {RESIZE_HANDLES.map((handle) => {
            const pos = handlePosition(
              { x: 0, y: 0, width: rect.width * viewport.scale, height: rect.height * viewport.scale },
              handle,
            );
            return (
              <span
                key={handle}
                role="presentation"
                onPointerDown={handlePointerDown(handle)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                /* 14px is fine for a mouse pointer and hopeless for a thumb.
                   The handle grows to 24px under a coarse pointer, and is
                   offset by half its own size so it stays centred on the corner
                   at either size. */
                className="pointer-events-auto absolute rounded-sm border-2 border-ink bg-paper"
                style={{
                  width: handleSize,
                  height: handleSize,
                  left: pos.x - handleSize / 2,
                  top: pos.y - handleSize / 2,
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
