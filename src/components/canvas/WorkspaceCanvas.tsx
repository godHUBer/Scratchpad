import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Line, Rect, Stage } from 'react-konva';
import Konva from 'konva';
import { useCanvasSize } from '../../hooks/useCanvasSize';
import { useUndoStack } from '../../hooks/useUndoStack';
import { CanvasNode, CanvasCardOverlay } from './CanvasNode';
import { SelectionFrame } from './SelectionFrame';
import { SelectedCardBox, type Rect as CardRect } from './SelectedCardBox';
import type { Tool } from './FloatingToolbar';
import {
  fitViewport,
  itemRect,
  normalizeRect,
  rectsIntersect,
  resizeFromHandle,
  screenToWorld,
  zoomAtPoint,
  type ResizeHandle,
  type Viewport,
} from './canvasMath';
import type { Bookmark, CanvasItem, MediaAsset } from '../../types';
import type { NewCanvasItem } from '../../hooks/useCanvasItems';
import { clamp } from '../../lib/format';

const CARD_TYPES = ['image', 'audio', 'video', 'media_link', 'bookmark'] as const;
const isCardType = (type: string) => (CARD_TYPES as readonly string[]).includes(type);

export interface CanvasApi {
  items: CanvasItem[];
  createItem: (input: NewCanvasItem) => Promise<CanvasItem>;
  patchItem: (id: string, patch: Partial<CanvasItem>) => Promise<CanvasItem>;
  moveItems: (moves: Array<{ id: string; x: number; y: number; w?: number; h?: number }>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  duplicateItem: (id: string) => Promise<CanvasItem>;
  setLayer: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => Promise<void>;
}

interface WorkspaceCanvasProps {
  api: CanvasApi;
  bookmarks: Record<string, Bookmark>;
  media: Record<string, MediaAsset>;
  tool: Tool;
  setTool: (tool: Tool) => void;
  canWrite: boolean;
  brushColor: string;
  brushSize: number;
  textSize: number;
  textColor: string;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  onOpenTextEditor: (item: CanvasItem) => void;
  onCreateText: (position: { x: number; y: number }) => void;
  onError: (message: string) => void;
  onUndoAvailable: (available: boolean) => void;
  onZoomChange?: (scale: number) => void;
  onOpenCardEditor?: (item: CanvasItem) => void;
  onEraseNotice?: () => void;
}

interface DraftStroke {
  points: number[];
  color: string;
  strokeWidth: number;
}

export function WorkspaceCanvas({
  api,
  bookmarks,
  media,
  tool,
  canWrite,
  brushColor,
  brushSize,
  selectedIds,
  setSelectedIds,
  onOpenTextEditor,
  onCreateText,
  onError,
  onUndoAvailable,
  onZoomChange,
  onOpenCardEditor,
  onEraseNotice = () => {},
}: WorkspaceCanvasProps) {
  const { ref: containerRef, size } = useCanvasSize();
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 0, y: 0 });
  const [draft, setDraft] = useState<DraftStroke | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [resizing, setResizing] = useState<{
    id: string;
    handle: ResizeHandle;
    origin: { x: number; y: number; width: number; height: number };
    rect: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const dragStart = useRef<Record<string, { x: number; y: number }>>({});
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const resizedRef = useRef(false);
  const resizeBefore = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const panning = useRef<{ start: { x: number; y: number }; origin: Viewport } | null>(null);
  const hovering = useRef(false);
  const undo = useUndoStack();

  const selected = useMemo(
    () => api.items.filter((item) => selectedIds.includes(item.id)),
    [api.items, selectedIds],
  );

  useEffect(() => {
    onUndoAvailable(undo.canUndo);
  }, [undo.canUndo, onUndoAvailable]);

  useEffect(() => {
    onZoomChange?.(viewport.scale);
  }, [viewport.scale, onZoomChange]);

  // centre a fresh, empty canvas
  const centredRef = useRef(false);
  useEffect(() => {
    if (centredRef.current || size.width === 0) return;
    if (api.items.length === 0) {
      setViewport({ scale: 1, x: size.width / 2, y: size.height / 2 });
    } else {
      setViewport(fitViewport(api.items, size));
    }
    centredRef.current = true;
  }, [size, api.items]);

  const fit = useCallback(() => {
    setViewport(fitViewport(api.items, size));
  }, [api.items, size]);

  const zoomBy = useCallback(
    (factor: number) => {
      setViewport((current) =>
        zoomAtPoint(current, { x: size.width / 2, y: size.height / 2 }, current.scale * factor),
      );
    },
    [size.width, size.height],
  );

  const resetZoom = useCallback(() => {
    setViewport((current) => zoomAtPoint(current, { x: size.width / 2, y: size.height / 2 }, 1));
  }, [size.width, size.height]);

  useEffect(() => {
    // only consume shortcuts while the pointer is over the canvas, so page-level
    // actions (adding a card/text) are not undone twice
    const onUndo = () => {
      if (!hovering.current) return;
      void undo.undo();
    };
    const onRedo = () => {
      if (!hovering.current) return;
      void undo.redo();
    };
    window.addEventListener('scratchpad:undo', onUndo);
    window.addEventListener('scratchpad:redo', onRedo);
    return () => {
      window.removeEventListener('scratchpad:undo', onUndo);
      window.removeEventListener('scratchpad:redo', onRedo);
    };
  }, [undo]);

  // expose helpers to the toolbar via a custom event-free approach: ref on window
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ action: string }>).detail;
      if (detail?.action === 'zoom-in') zoomBy(1.2);
      if (detail?.action === 'zoom-out') zoomBy(1 / 1.2);
      if (detail?.action === 'zoom-reset') resetZoom();
      if (detail?.action === 'fit') fit();
    };
    window.addEventListener('scratchpad:canvas', handler);
    return () => window.removeEventListener('scratchpad:canvas', handler);
  }, [zoomBy, resetZoom, fit]);

  const stagePointer = (stage: Konva.Stage | null) => {
    const pointer = stage?.getPointerPosition();
    if (!pointer) return null;
    return screenToWorld(viewport, pointer);
  };

  // ------------------------------------------------------------- wheel/pinch
  const onWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition() ?? { x: 0, y: 0 };
    const isPinch = event.evt.ctrlKey;
    const factor = isPinch ? 1 - event.evt.deltaY * 0.01 : 1 - event.evt.deltaY * 0.0015;
    setViewport((current) => zoomAtPoint(current, pointer, current.scale * clamp(factor, 0.5, 2)));
  };

  // ------------------------------------------------------------- interactions
  const onMouseDown = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = event.target.getStage();
    const isStageClick = event.target === stage;
    const evt = event.evt as MouseEvent;
    const shift = 'shiftKey' in evt ? evt.shiftKey : false;

    // middle mouse or space-less empty click with select tool = marquee
    if (isStageClick && tool === 'select') {
      if (!shift) setSelectedIds([]);
      const pointer = stage?.getPointerPosition();
      if (pointer) {
        marqueeStart.current = screenToWorld(viewport, pointer);
        setMarquee({ ...marqueeStart.current, width: 0, height: 0 });
      }
    }
    if (isStageClick && tool === 'brush' && canWrite) {
      const world = stagePointer(stage);
      if (world) {
        setDraft({ points: [world.x, world.y], color: brushColor, strokeWidth: brushSize });
      }
    }
    if (isStageClick && tool === 'text' && canWrite) {
      const world = stagePointer(stage);
      if (world) onCreateText({ x: world.x, y: world.y });
    }
    if (tool === 'eraser' && canWrite) {
      event.evt.preventDefault();
      // Konva nodes report themselves as target; cards are DOM so they are
      // handled by the card shell (see eraseCard below). Empty space = hint.
      const nodeTarget = event.target as Konva.Node;
      const itemId = isStageClick ? undefined : findItemIdForNode(nodeTarget);
      if (itemId) void eraseItem(itemId);
      else onEraseNotice();
    }
  };

  /** walk up the Konva tree to the group we tagged with `item-<id>` */
  const findItemIdForNode = (node: Konva.Node): string | undefined => {
    let current: Konva.Node | null = node;
    while (current) {
      const name = current.name();
      if (name?.startsWith('item-')) return name.slice('item-'.length);
      current = current.getParent();
    }
    return undefined;
  };

  const eraseItem = async (id: string) => {
    const item = api.items.find((candidate) => candidate.id === id);
    if (!item) return;
    try {
      await api.deleteItem(id);
      if (selectedIds.includes(id)) setSelectedIds(selectedIds.filter((value) => value !== id));
      undo.push({
        label: 'erase',
        undo: async () => {
          await api.createItem({
            item_type: item.item_type,
            position_x: item.position_x,
            position_y: item.position_y,
            width: item.width,
            height: item.height,
            content: item.content,
            bookmark_id: item.bookmark_id,
            media_asset_id: item.media_asset_id,
          });
        },
        redo: () => api.deleteItem(id).then(() => undefined),
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not erase that object.');
    }
  };

  const onMouseMove = () => {
    if (draft) {
      const stage = stageRef.current;
      const world = stagePointer(stage);
      if (world) setDraft((current) => (current ? { ...current, points: [...current.points, world.x, world.y] } : current));
    }
    if (marqueeStart.current && wrapperPointer()) {
      const world = screenToWorld(viewport, wrapperPointer()!);
      setMarquee(normalizeRect(marqueeStart.current, world));
    }
    if (resizing) {
      const stage = stageRef.current;
      const world = stagePointer(stage);
      if (world) {
        const dx = world.x - resizing.origin.x;
        const dy = world.y - resizing.origin.y;
        const next = resizeFromHandle(resizing.origin, resizing.handle, dx, dy);
        resizedRef.current = true;
        setResizing({ ...resizing, rect: next });
      }
    }
  };

  const stageRef = useRef<Konva.Stage | null>(null);

  function wrapperPointer() {
    return stageRef.current?.getPointerPosition() ?? null;
  }

  const onMouseUp = async () => {
    // finish marquee selection
    if (marqueeStart.current && marquee) {
      const hits = api.items.filter((item) =>
        item.item_type === 'draw' ? false : rectsIntersect(marquee, itemRect(item)),
      );
      if (marquee.width > 4 || marquee.height > 4) {
        setSelectedIds(hits.map((item) => item.id));
      }
      marqueeStart.current = null;
      setMarquee(null);
    }

    // commit a brush stroke
    if (draft && draft.points.length >= 4) {
      const xs = draft.points.filter((_, index) => index % 2 === 0);
      const ys = draft.points.filter((_, index) => index % 2 === 1);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const relative = draft.points.map((value, index) => (index % 2 === 0 ? value - minX : value - minY));
      try {
        const created = await api.createItem({
          item_type: 'draw',
          position_x: minX,
          position_y: minY,
          width: Math.max(20, maxX - minX),
          height: Math.max(20, maxY - minY),
          content: { points: relative, color: draft.color, strokeWidth: draft.strokeWidth },
        });
        undo.push({
          label: 'draw',
          undo: () => api.deleteItem(created.id).then(() => undefined),
          redo: async () => {
            await api.createItem({
              item_type: 'draw',
              position_x: created.position_x,
              position_y: created.position_y,
              width: created.width,
              height: created.height,
              content: created.content,
            });
          },
        });
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Could not save the stroke.');
      }
    }
    setDraft(null);

    // commit a resize
    if (resizing && resizedRef.current) {
      const { id, rect } = resizing;
      const before = resizeBefore.current;
      try {
        await api.moveItems([{ id, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }]);
        if (before) {
          undo.push({
            label: 'resize',
            undo: () =>
              api
                .moveItems([{ id, x: before.x, y: before.y, w: before.width, h: before.height }])
                .then(() => undefined),
            redo: () =>
              api
                .moveItems([{ id, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }])
                .then(() => undefined),
          });
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Could not save the resize.');
      }
    }
    if (resizing) {
      resizedRef.current = false;
      setResizing(null);
    }
  };

  // ------------------------------------------------------------- selection ops
  const handleSelect = (id: string, additive: boolean) => {
    if (additive) {
      setSelectedIds(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
    } else {
      setSelectedIds([id]);
    }
  };

  const handleNodeDragStart = (id: string) => {
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    if (!selectedIds.includes(id)) setSelectedIds([id]);
    dragStart.current = Object.fromEntries(
      api.items.filter((item) => ids.includes(item.id)).map((item) => [item.id, { x: item.position_x, y: item.position_y }]),
    );
  };

  const handleNodeDragEnd = async (id: string, x: number, y: number) => {
    const starts = dragStart.current;
    const snapshot = { ...starts };
    const dx = Math.round(x) - (starts[id]?.x ?? x);
    const dy = Math.round(y) - (starts[id]?.y ?? y);
    const moves = Object.entries(starts).map(([itemId, start]) => ({
      id: itemId,
      x: Math.round(start.x + dx),
      y: Math.round(start.y + dy),
    }));
    if (moves.length === 0) moves.push({ id, x: Math.round(x), y: Math.round(y) });
    try {
      await api.moveItems(moves);
      undo.push({
        label: 'move',
        undo: () =>
          api
            .moveItems(Object.entries(snapshot).map(([itemId, start]) => ({ id: itemId, x: start.x, y: start.y })))
            .then(() => undefined),
        redo: () => api.moveItems(moves).then(() => undefined),
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save the move.');
    }
  };

  const onBackgroundDoubleClick = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (!canWrite) return;
    if (event.target !== event.target.getStage()) return;
    const world = stagePointer(event.target.getStage());
    if (world) onCreateText({ x: world.x, y: world.y });
  };

  const commitCardGeometry = async (item: CanvasItem, rect: CardRect) => {
    if (
      Math.round(rect.x) === Math.round(item.position_x) &&
      Math.round(rect.y) === Math.round(item.position_y) &&
      Math.round(rect.width) === Math.round(item.width) &&
      Math.round(rect.height) === Math.round(item.height)
    ) {
      return;
    }
    const before = { x: item.position_x, y: item.position_y, width: item.width, height: item.height };
    const after = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    try {
      await api.moveItems([{ id: item.id, x: after.x, y: after.y, w: after.width, h: after.height }]);
      undo.push({
        label: before.width !== after.width || before.height !== after.height ? 'resize' : 'move',
        undo: () =>
          api
            .moveItems([{ id: item.id, x: before.x, y: before.y, w: before.width, h: before.height }])
            .then(() => undefined),
        redo: () =>
          api.moveItems([{ id: item.id, x: after.x, y: after.y, w: after.width, h: after.height }]).then(() => undefined),
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save the card position.');
    }
  };

  const sorted = useMemo(() => {
    const order = { text: 3, note: 3, draw: 2, image: 1, video: 1, audio: 1, media_link: 1, bookmark: 1 } as const;
    return [...api.items].sort((a, b) => {
      const z = (a.content.z ?? 0) - (b.content.z ?? 0);
      if (z !== 0) return z;
      return order[a.item_type] - order[b.item_type];
    });
  }, [api.items]);

  const cardItems = sorted.filter((item) => isCardType(item.item_type));
  const cardInteraction = tool === 'select';   // other tools click through the DOM cards
  const cardDragEnabled = canWrite && tool === 'select';
  // eraser works on every layer (drawings, text, cards); Konva nodes stay
  // interactive so the stage sees the click even on top of a shape
  const eraseMode = tool === 'eraser' && canWrite;
  const nodeInteraction = tool === 'select' || tool === 'eraser';
  const selectHandler = (id: string, additive: boolean) => {
    if (eraseMode) return;
    handleSelect(id, additive);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-cream-deep/40"
      style={{
        backgroundImage:
          'radial-gradient(circle, rgba(8,8,8,0.16) 1.2px, transparent 1.2px)',
        backgroundSize: `${24 * viewport.scale}px ${24 * viewport.scale}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        cursor: tool === 'brush' || tool === 'eraser' ? 'crosshair' : tool === 'text' ? 'text' : 'default',
        touchAction: 'none',
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerEnter={() => {
        hovering.current = true;
      }}
      onPointerLeave={() => {
        hovering.current = false;
      }}
    >
      <Stage
        ref={(node) => {
          stageRef.current = node;
        }}
        width={size.width}
        height={size.height}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        x={viewport.x}
        y={viewport.y}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onTouchStart={onMouseDown}
        onMouseMove={onMouseMove}
        onTouchMove={onMouseMove}
        onMouseUp={() => void onMouseUp()}
        onTouchEnd={() => void onMouseUp()}
        onDblClick={onBackgroundDoubleClick}
        draggable={tool === 'pan' || panning.current !== null}
        onDragStart={() => {
          if (tool === 'pan') {
            panning.current = {
              start: { x: stageRef.current?.x() ?? 0, y: stageRef.current?.y() ?? 0 },
              origin: viewport,
            };
          }
        }}
        onDragMove={(event) => {
          if (tool !== 'pan' && !panning.current) return;
          const stage = event.target as Konva.Stage;
          setViewport((current) => ({
            ...current,
            x: clamp(stage.x(), -2000, 2000),
            y: clamp(stage.y(), -2000, 2000),
          }));
        }}
        onDragEnd={() => {
          panning.current = null;
        }}
      >
        <Layer listening>
          {sorted.map((item) =>
            item.item_type === 'draw' ? (
              <CanvasNode
                key={item.id}
                item={item}
                bookmark={null}
                media={null}
                selected={selectedIds.includes(item.id)}
                canInteract={nodeInteraction}
                onSelect={selectHandler}
                onDragStart={handleNodeDragStart}
                onDragEnd={(id, x, y) => void handleNodeDragEnd(id, x, y)}
                onDoubleClick={onOpenTextEditor}
              />
            ) : item.item_type === 'text' || item.item_type === 'note' ? (
              <CanvasNode
                key={item.id}
                item={item}
                bookmark={null}
                media={null}
                selected={selectedIds.includes(item.id)}
                canInteract={tool === 'select' || tool === 'eraser'}
                onSelect={selectHandler}
                onDragStart={handleNodeDragStart}
                onDragEnd={(id, x, y) => void handleNodeDragEnd(id, x, y)}
                onDoubleClick={onOpenTextEditor}
              />
            ) : null,
          )}

          {draft ? (
            <Line
              points={draft.points}
              stroke={draft.color}
              strokeWidth={draft.strokeWidth}
              lineCap="round"
              lineJoin="round"
              tension={0.25}
              listening={false}
            />
          ) : null}

          {marquee ? (
            <Rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.width}
              height={marquee.height}
              fill="rgba(247,201,72,0.28)"
              stroke="#080808"
              strokeWidth={2 / viewport.scale}
              dash={[8 / viewport.scale, 6 / viewport.scale]}
              listening={false}
            />
          ) : null}

          {selected.length === 1 && !resizing && !isCardType(selected[0]!.item_type) ? (
            <SelectionFrame
              item={selected[0]!}
              scale={viewport.scale}
              canWrite={canWrite}
              onStartResize={(handle) => {
                const target = selected[0]!;
                resizedRef.current = false;
                resizeBefore.current = {
                  x: target.position_x,
                  y: target.position_y,
                  width: target.width,
                  height: target.height,
                };
                setResizing({
                  id: target.id,
                  handle,
                  origin: { x: target.position_x, y: target.position_y, width: target.width, height: target.height },
                  rect: { x: target.position_x, y: target.position_y, width: target.width, height: target.height },
                });
              }}
            />
          ) : null}

          {resizing ? (
            <Rect
              x={resizing.rect.x}
              y={resizing.rect.y}
              width={resizing.rect.width}
              height={resizing.rect.height}
              stroke="#080808"
              strokeWidth={2 / viewport.scale}
              dash={[10 / viewport.scale, 6 / viewport.scale]}
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>

      {/* DOM overlay: rich card bodies + resize handles (real DOM = native players) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {cardItems.map((item) => {
          const isSelected = selectedIds.includes(item.id);
          return (
            <SelectedCardBox
              key={`overlay-${item.id}`}
              item={item}
              viewport={viewport}
              canWrite={cardDragEnabled}
              interactive={cardInteraction || eraseMode}
              selected={isSelected}
              isDragging={draggingCard === item.id}
              onActivate={(additive) => handleSelect(item.id, additive)}
              eraseMode={eraseMode}
              onErase={() => void eraseItem(item.id)}
              onDragStart={() => setDraggingCard(item.id)}
              onDragCancel={() => setDraggingCard(null)}
              onDragMove={() => {}}
              onDragEnd={(rect) => {
                setDraggingCard(null);
                void commitCardGeometry(item, rect);
              }}
              onResizeMove={() => {}}
              onResizeEnd={(rect) => void commitCardGeometry(item, rect)}
            >
              <div
                className="h-full w-full overflow-hidden"
                style={{
                  border: `${isSelected ? 3 : 2.5}px solid #080808`,
                  transition: 'border-width 80ms ease-out',
                  borderRadius: 14,
                  boxShadow: '3px 3px 0 0 #080808',
                  background: item.item_type === 'bookmark' ? bookmarks[item.bookmark_id ?? '']?.color ?? '#f7c948' : '#fffdf6',
                  pointerEvents: cardInteraction ? 'auto' : 'none',
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (canWrite) onOpenCardEditor?.(item);
                }}
              >
                <CanvasCardOverlay
                  item={item}
                  bookmark={item.bookmark_id ? bookmarks[item.bookmark_id] ?? null : null}
                  media={item.media_asset_id ? media[item.media_asset_id] ?? null : null}
                  canInteract={cardInteraction}
                  selected={isSelected}
                  onOpenEdit={(target) => onOpenCardEditor?.(target)}
                />
              </div>
            </SelectedCardBox>
          );
        })}

      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-[11px] font-bold text-ink-soft">
        <span className="chip pointer-events-auto bg-paper">{Math.round(viewport.scale * 100)}%</span>
        <span className="hidden sm:inline">
          {tool === 'select' ? 'Drag to move · double-click to edit' : tool === 'pan' ? 'Drag to pan' : `Drawing with ${tool}`}
        </span>
      </div>

      {api.items.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <div className="paper pointer-events-auto max-w-sm px-5 py-4 text-center">
            <p className="text-lg font-black">Your canvas is blank ✏️</p>
            <p className="mt-1 text-sm text-ink-soft">
              Pick <strong>Text</strong>, <strong>Brush</strong>, or paste a Google Drive link with{' '}
              <strong>Media</strong>. Everything saves automatically.
            </p>
            <p className="mt-2 text-xs font-bold text-ink-soft">Tip: double-click empty space to add a note.</p>
          </div>
        </div>
      ) : null}

      {/* hidden handles for tests/zoom buttons */}
      <div className="absolute bottom-3 right-3 flex gap-1">
        <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
          −
        </ZoomButton>
        <ZoomButton label="Reset zoom" onClick={resetZoom}>
          {Math.round(viewport.scale * 100)}%
        </ZoomButton>
        <ZoomButton label="Zoom in" onClick={() => zoomBy(1.25)}>
          +
        </ZoomButton>
        <ZoomButton label="Fit to content" onClick={fit}>
          ⤢
        </ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-9 min-w-9 place-items-center rounded-full border-[3px] border-ink bg-paper px-2 text-sm font-black hard-shadow-sm active:translate-y-[1px]"
    >
      {children}
    </button>
  );
}
