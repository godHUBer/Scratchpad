import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Line, Rect, Stage } from 'react-konva';
import Konva from 'konva';
import { useCanvasSize } from '../../hooks/useCanvasSize';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useUndoStack } from '../../hooks/useUndoStack';
import { CanvasNode, CanvasCardOverlay } from './CanvasNode';
import { SelectionFrame } from './SelectionFrame';
import { SelectedCardBox, type Rect as CardRect } from './SelectedCardBox';
import type { Tool } from './FloatingToolbar';
import {
  clampScale,
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
import { fontStack } from '../../lib/fonts';
import { isShapeItem } from '../../lib/shapes';
import { visibleCentre } from './placement';

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
  /** World-space centre of what the user can currently see. */
  onViewportChange?: (centre: { x: number; y: number }) => void;
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
  onViewportChange,
  onOpenCardEditor,
  onEraseNotice = () => {},
}: WorkspaceCanvasProps) {
  const { ref: containerRef, size } = useCanvasSize();
  // Konva cannot read CSS variables; this resolves the theme to real colours.
  const themeColors = useThemeColors();
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

  // Report the centre of the pane in world coordinates. New cards are placed
  // relative to this instead of a `window.innerWidth` guess, so they land where
  // the user is actually looking (and never on top of each other).
  useEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    onViewportChange?.(visibleCentre(viewport, size));
  }, [viewport, size, onViewportChange]);

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
  /*
    Wheel over a text box resizes its type; wheel anywhere else zooms the canvas.

    Reported as a missing feature ("if I hover the mouse over it and scroll, it
    should increase font size"). The canvas already owned the wheel event, so the
    behaviour belongs here rather than on a DOM listener: this way it composes
    with zoom, ignores a trackpad pinch (ctrlKey, which is a zoom gesture and
    would otherwise fight the font resize), and needs no extra hit-testing.

    The text is found from the node under the pointer. Konva reports the hovered
    shape, and both the box's Rect and its label carry the item name, so a wheel
    over the glyph or over the padding behaves the same.
  */
  const onWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition() ?? { x: 0, y: 0 };
    const isPinch = event.evt.ctrlKey;

    if (!isPinch) {
      const hovered = stage && pointer ? stage.getIntersection(pointer) : null;
      const hoveredId = hovered ? findItemIdForNode(hovered) : null;
      const target = hoveredId ? api.items.find((item) => item.id === hoveredId) : null;
      if (hoveredId && target && (target.item_type === 'text' || target.item_type === 'note') && canWrite) {
        // One notch per wheel step, in the direction of travel. Clamped to a
        // range a canvas can actually show rather than the browser's limits.
        const step = event.evt.deltaY < 0 ? 2 : -2;
        const current = target.content?.fontSize ?? 20;
        const next = Math.round(Math.min(160, Math.max(8, current + step)));
        if (next !== current) {
          // Optimistic: patchItem updates locally before the RPC resolves, so
          // the type follows the wheel without waiting on the network.
          void api.patchItem(hoveredId, { content: { ...target.content, fontSize: next } }).catch((err: unknown) => {
            onError(err instanceof Error ? err.message : 'Could not resize the text.');
          });
        }
        return;
      }
    }

    const factor = isPinch ? 1 - event.evt.deltaY * 0.01 : 1 - event.evt.deltaY * 0.0015;
    setViewport((current) => zoomAtPoint(current, pointer, current.scale * clamp(factor, 0.5, 2)));
  };

  // ------------------------------------------------------------- touch gestures
  //
  // The canvas used to be single-pointer only: onTouchStart/Move did the same
  // thing as a mouse drag. That leaves a phone user unable to zoom at all and
  // unable to pan without picking the Pan tool, which makes the product close to
  // unusable on a tablet or phone. A two-finger gesture is handled here and
  // swallows the single-pointer path for its duration, so a pinch never also
  // drags a card or paints a stroke.
  /*
    Drag-to-erase.

    The eraser used to act only on mousedown, so the tool deleted whatever was
    directly under the first click and nothing else — hover and drag did
    nothing, which is not how an eraser is expected to behave. `erasing` marks a
    stroke in progress; `erasedThisDrag` stops the same item being deleted twice
    when the pointer crosses it repeatedly or a fast move samples it twice.
  */
  const erasing = useRef(false);
  const erasedThisDrag = useRef<Set<string>>(new Set());

  const gesture = useRef<{
    distance: number;
    center: { x: number; y: number };
    scale: number;
    /** viewport when the pinch began — every frame is computed against this */
    viewport: Viewport;
  } | null>(null);

  const touchPair = (event: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = event.evt.touches;
    if (touches.length !== 2) return null;
    const [a, b] = [touches[0]!, touches[1]!];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const toLocal = (t: Touch) => ({ x: t.clientX - rect.left, y: t.clientY - rect.top });
    const pa = toLocal(a);
    const pb = toLocal(b);
    return {
      distance: Math.hypot(pb.x - pa.x, pb.y - pa.y),
      center: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
    };
  };

  const onTouchStartGesture = (event: Konva.KonvaEventObject<TouchEvent>) => {
    const pair = touchPair(event);
    if (!pair) return false;
    // Abandon any single-pointer work in progress so a pinch cannot leave a
    // half-drawn stroke or a stuck marquee behind.
    setDraft(null);
    marqueeStart.current = null;
    setMarquee(null);
    gesture.current = { distance: pair.distance, center: pair.center, scale: viewport.scale, viewport };
    return true;
  };

  const onTouchMoveGesture = (event: Konva.KonvaEventObject<TouchEvent>): boolean => {
    const active = gesture.current;
    if (!active) return false;
    const pair = touchPair(event);
    if (!pair) return true; // a finger lifted; keep swallowing until both are gone

    event.evt.preventDefault();

    // Zoom about the midpoint of the fingers, then translate by how far that
    // midpoint travelled: pinch and two-finger drag compose into one gesture.
    //
    // Every frame is computed from the gesture's *starting* viewport, never from
    // the current one. Anchoring to the live viewport while also measuring the
    // midpoint against its start position compounds the offset each frame: after
    // a four-step pinch the content had slid ~27px away from the fingers. The
    // tests in pinchGesture.test.ts pin this down.
    const ratio = active.distance > 0 ? pair.distance / active.distance : 1;
    const nextScale = clampScale(active.scale * ratio);
    const zoomed = zoomAtPoint(active.viewport, active.center, nextScale);
    setViewport({
      ...zoomed,
      x: zoomed.x + (pair.center.x - active.center.x),
      y: zoomed.y + (pair.center.y - active.center.y),
    });
    return true;
  };

  const onTouchEndGesture = (event: Konva.KonvaEventObject<TouchEvent>): boolean => {
    if (!gesture.current) return false;
    if (event.evt.touches.length < 2) gesture.current = null;
    return true;
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
      erasing.current = true;
      erasedThisDrag.current = new Set();
      // Konva nodes report themselves as target; cards are DOM so they are
      // handled by the card shell (see eraseCard below). Empty space = hint.
      const nodeTarget = event.target as Konva.Node;
      const itemId = isStageClick ? undefined : findItemIdForNode(nodeTarget);
      if (itemId) eraseOnce(itemId);
      else onEraseNotice();
    }
  };

  /**
   * Erases an item at most once per drag.
   *
   * The guard matters: deleting is async, so without it a stroke that crosses
   * the same item twice would fire two deletes, the second of which fails
   * against an id that is already gone and surfaces a spurious error toast.
   */
  const eraseOnce = (id: string) => {
    if (erasedThisDrag.current.has(id)) return;
    erasedThisDrag.current.add(id);
    void eraseItem(id);
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

  /*
    Marquee commit.

    Two separate bugs lived in the original three lines, and the reported symptom
    — "a box appears, but it selects nothing" — was one of them masking the other.

    1. The commit read the `marquee` *state* captured by the closure that
       onMouseUp was created in. State updates are asynchronous, so if the pointer
       was released before the last setMarquee had re-rendered, that closure still
       held the box from mousedown: width 0, height 0. The `> 4` guard then
       rejected it and nothing was selected, even though a real box was on screen.

    2. onMouseUp only ever fired when the release happened *over the Stage*.
       Every card is a DOM element in an absolute overlay, and the overlay covers
       the canvas, so a drag that passed over a card released on that DOM node and
       the Stage never saw a mouseup at all.

    The box is therefore recomputed here from `marqueeStart` and the current
    pointer rather than read back from state, and `window` gets the release as
    well (see the effect below), so it commits no matter what is under the
    pointer. `marquee` is still read, but only as a last-resort fallback for the
    case where the pointer has already left the Stage.
  */
  const commitMarquee = () => {
    if (!marqueeStart.current) return;
    const start = marqueeStart.current;
    const pointer = wrapperPointer();
    const end = pointer ? screenToWorld(viewport, pointer) : null;
    const box = end ? normalizeRect(start, end) : marquee;
    marqueeStart.current = null;
    setMarquee(null);
    if (!box) return;
    // A click on empty canvas is not a selection gesture; it already cleared the
    // selection on mousedown. Anything larger sweeps.
    if (box.width <= 4 && box.height <= 4) return;
    const hits = api.items.filter(
      (item) => item.item_type !== 'draw' || isShapeItem(item),
    ).filter((item) => rectsIntersect(box, itemRect(item)));
    setSelectedIds(hits.map((item) => item.id));
  };

  /*
    The release, wherever it happens.

    The Stage's own onMouseUp covers the common case, but it cannot fire when the
    pointer is over a DOM card overlay or has left the canvas entirely — and that
    is precisely when a marquee drag ends, since the gesture exists to sweep up
    cards. Listening on window closes that hole. `onMouseUp` is idempotent here:
    the second call finds `marqueeStart` already null and does nothing, so the
    normal path is unaffected.
  */
  useEffect(() => {
    const release = () => {
      if (!marqueeStart.current) return;
      commitMarquee();
    };
    window.addEventListener('mouseup', release);
    window.addEventListener('touchend', release);
    window.addEventListener('touchcancel', release);
    return () => {
      window.removeEventListener('mouseup', release);
      window.removeEventListener('touchend', release);
      window.removeEventListener('touchcancel', release);
    };
    // commitMarquee closes over viewport and api.items; re-binding is cheap and
    // keeps it current rather than capturing the first render's values.
  });

  const onMouseMove = () => {
    if (erasing.current && canWrite) {
      // Konva reports the hovered node for the current pointer position, so a
      // drag erases every object the stroke passes over rather than only the
      // one under the initial press.
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      const hovered = stage && pointer ? stage.getIntersection(pointer) : null;
      if (hovered) {
        const id = findItemIdForNode(hovered);
        if (id) {
          eraseOnce(id);
          return;
        }
      }
    }
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
    // end an erase stroke; nothing else needs committing for it
    erasing.current = false;
    erasedThisDrag.current = new Set();

    // finish marquee selection
    commitMarquee();

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

  /*
    Where the pointer was, relative to the item's own top-left, when the drag
    began.

    Without this a node is positioned by its origin: Konva reports the node's new
    x/y, and the old code used that as the item's new position, so the shape's
    top-left corner jumped to the cursor the moment you started dragging. Grab a
    300 px card near its right edge and it teleports under the pointer — which is
    the "dragging feels wrong, not like MS Paint" complaint. MS Paint keeps the
    grab offset, so the shape stays exactly where in the shape you clicked.

    Computed from the node's own transform rather than from the pointer, because
    the node's absolute position on drag start already reflects the item's
    position in world space.
  */
  const grabOffset = useRef<{ x: number; y: number } | null>(null);

  const handleNodeDragStart = (id: string, nodeX?: number, nodeY?: number) => {
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    if (!selectedIds.includes(id)) setSelectedIds([id]);
    dragStart.current = Object.fromEntries(
      api.items.filter((item) => ids.includes(item.id)).map((item) => [item.id, { x: item.position_x, y: item.position_y }]),
    );
    /*
      The offset between the node's reported origin and the stored position. Both
      describe the same corner, so unless a renderer reports a centre (the ellipse
      case) this is zero — the subtraction keeps the ellipse from reintroducing
      its own half-width jump.
    */
    const stored = api.items.find((item) => item.id === id);
    grabOffset.current =
      stored && nodeX !== undefined && nodeY !== undefined
        ? { x: nodeX - stored.position_x, y: nodeY - stored.position_y }
        : { x: 0, y: 0 };
  };

  const handleNodeDragEnd = async (id: string, x: number, y: number) => {
    const starts = dragStart.current;
    const snapshot = { ...starts };
    /*
      Undo the offset captured on drag start so the item's position means "its
      top-left corner", not "the corner under the cursor". Guarded because a
      drag can begin without onDragStart reaching us (a programmatic start, or a
      node mounted mid-gesture) — the previous fallback dropped the grab offset
      entirely and snapped the item to the release point.
    */
    const offset = grabOffset.current ?? { x: 0, y: 0 };
    const originX = Math.round(x) - offset.x;
    const originY = Math.round(y) - offset.y;
    const anchor = starts[id] ?? { x: originX, y: originY };
    const dx = originX - anchor.x;
    const dy = originY - anchor.y;
    const moves = Object.entries(starts).map(([itemId, start]) => ({
      id: itemId,
      x: Math.round(start.x + dx),
      y: Math.round(start.y + dy),
    }));
    if (moves.length === 0) moves.push({ id, x: originX, y: originY });
    grabOffset.current = null;
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
      // `?? 0` does not protect against a null content blob, only a null z.
      const z = (a.content?.z ?? 0) - (b.content?.z ?? 0);
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
  /*
    Which tools let an existing node be grabbed.

    'text' is in this list on purpose, and its absence was a reported bug: adding
    a text box leaves the tool on 'text', so the box the user had just typed could
    not be dragged.

    Clicking an existing box with the text tool now selects and drags it rather
    than starting a second box on top of it — the behaviour a paint program has.
    Empty canvas still creates text, because the create branch is guarded by
    `isStageClick`; only a click that actually landed on a node is taken by the
    box. A user who wants a new box next to an existing one clicks beside it,
    which is what they would do anyway.
  */
  const nodeInteraction = tool === 'select' || tool === 'eraser' || tool === 'text';
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
          `radial-gradient(circle, ${themeColors.grid} 1.2px, transparent 1.2px)`,
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
        onTouchStart={(event) => {
          // Two fingers mean pinch/pan; one finger behaves exactly as before.
          if (!onTouchStartGesture(event)) onMouseDown(event);
        }}
        onMouseMove={onMouseMove}
        onMouseUp={() => void onMouseUp()}
        onTouchMove={(event) => {
          if (!onTouchMoveGesture(event)) onMouseMove();
        }}
        onTouchEnd={(event) => {
          if (!onTouchEndGesture(event)) void onMouseUp();
        }}
        onTouchCancel={(event) => {
          onTouchEndGesture(event);
          void onMouseUp();
        }}
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
                selected={selectedIds.includes(item.id)}
                canInteract={nodeInteraction}
                onSelect={selectHandler}
                onDragStart={(id, x, y) => handleNodeDragStart(id, x, y)}
                onDragEnd={(id, x, y) => void handleNodeDragEnd(id, x, y)}
                onDoubleClick={onOpenTextEditor}
                fontFamily={fontStack(item.content?.fontFamily)}
              />
            ) : item.item_type === 'text' || item.item_type === 'note' ? (
              <CanvasNode
                key={item.id}
                item={item}
                selected={selectedIds.includes(item.id)}
                // Must use the shared flag, not a local copy of the condition.
                // The duplicate here is exactly why text boxes were inert under
                // the text tool even after `nodeInteraction` was widened.
                canInteract={nodeInteraction}
                onSelect={selectHandler}
                onDragStart={(id, x, y) => handleNodeDragStart(id, x, y)}
                onDragEnd={(id, x, y) => void handleNodeDragEnd(id, x, y)}
                onDoubleClick={onOpenTextEditor}
                fontFamily={fontStack(item.content?.fontFamily)}
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
              stroke={themeColors.ink}
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
              colors={themeColors}
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
              stroke={themeColors.ink}
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
              // Double-click a card to open it: a preview for media, the editor
              // for a bookmark. Same handler the Konva text/note nodes use.
              onOpen={() => onOpenCardEditor?.(item)}
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
                  border: `${isSelected ? 3 : 2.5}px solid ${themeColors.ink}`,
                  transition: 'border-width 80ms ease-out',
                  borderRadius: 14,
                  boxShadow: `3px 3px 0 0 ${themeColors.ink}`,
                  // Image cards must be transparent here: the Konva layer below
                  // paints the bitmap, and an opaque background would hide it.
                  // (That bug is why images never showed a preview while moving
                  // and why double-clicking them appeared to do nothing.)
                  background:
                    item.item_type === 'image'
                      ? 'transparent'
                      : item.item_type === 'bookmark'
                        ? bookmarks[item.bookmark_id ?? '']?.color ?? '#f7c948'
                        : '#fffdf6',
                  pointerEvents: cardInteraction ? 'auto' : 'none',
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  // Doubling-clicking a media card opens it, always — the editor
                  // gate only applies to changing the link.
                  onOpenCardEditor?.(item);
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

      {/*
        Lifted on narrow screens so it clears the "Undo available" pill, which is
        centred at the same height and used to overlap it on a 390 px viewport.
        Both are bottom-anchored chrome; on a phone there is no room for them
        side by side, so the hint moves up rather than the pill moving off-centre.
      */}
      <div className="pointer-events-none absolute bottom-safe-3 left-safe-3 flex items-center gap-2 text-[11px] font-bold text-ink-soft max-sm:bottom-[calc(2.75rem+var(--safe-bottom))]">
        <span className="chip pointer-events-auto bg-paper">{Math.round(viewport.scale * 100)}%</span>
        <span className="hidden sm:inline">
          {tool === 'select' ? 'Drag to move · double-click to edit' : tool === 'pan' ? 'Drag to pan' : `Drawing with ${tool}`}
        </span>
      </div>

      {api.items.length === 0 ? (
        // Informational only. It must NEVER take pointer events: this panel sits
        // in the middle of a brand-new workspace, so making it interactive makes
        // the canvas unclickable exactly when the user first tries to draw.
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <div className="paper pointer-events-none max-w-sm px-5 py-4 text-center">
            <p className="text-lg font-black">Your canvas is blank</p>
            <p className="mt-1 text-sm text-ink-soft">
              Pick <strong>Text</strong>, <strong>Brush</strong>, or paste a Google Drive link
              straight onto the canvas. Everything saves automatically.
            </p>
            <p className="mt-2 text-xs font-bold text-ink-soft">Tip: double-click empty space to add a note.</p>
          </div>
        </div>
      ) : null}

      {/* hidden handles for tests/zoom buttons */}
      <div className="absolute bottom-safe-3 right-safe-3 flex gap-1">
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
