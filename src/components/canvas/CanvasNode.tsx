import { Group, Line, Rect, Text } from 'react-konva';
import type { Bookmark, CanvasItem, MediaAsset } from '../../types';
import { BookmarkCardBody } from './BookmarkCardBody';
import { MediaCardBody } from './MediaCardBody';

/**
 * Konva-rendered items: brush strokes, text and notes.
 *
 * Cards (image/audio/video/bookmark/link) are NOT rendered here — they live in
 * the DOM overlay, because they need real <img>/<audio>/<video> elements. This
 * component used to also contain a "card" branch that nothing ever called, and
 * while it sat there the DOM overlay returned `null` for images, so every image
 * card was an empty white rectangle.
 */
interface CanvasNodeProps {
  item: CanvasItem;
  selected: boolean;
  canInteract: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  onDoubleClick: (item: CanvasItem) => void;
  /** CSS font stack for text/note items; mirrors the DOM editor exactly. */
  fontFamily?: string;
}

export function CanvasNode({
  item,
  selected,
  canInteract,
  onSelect,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  fontFamily,
}: CanvasNodeProps) {
  if (item.item_type === 'draw') {
    return (
      <Line
        points={item.content.points ?? []}
        stroke={item.content.color ?? '#080808'}
        strokeWidth={item.content.strokeWidth ?? 4}
        lineCap="round"
        lineJoin="round"
        tension={0.25}
        hitStrokeWidth={Math.max(20, (item.content.strokeWidth ?? 4) + 12)}
        x={item.position_x}
        y={item.position_y}
        listening={canInteract}
        draggable={canInteract}
        onDragStart={() => onDragStart?.(item.id)}
        onDragEnd={(event) => onDragEnd?.(item.id, event.target.x(), event.target.y())}
        onClick={(event) => {
          event.cancelBubble = true;
          onSelect(item.id, event.evt.shiftKey);
        }}
        onTap={(event) => {
          event.cancelBubble = true;
          onSelect(item.id, false);
        }}
        name={`item-${item.id}`}
      />
    );
  }

  if (item.item_type !== 'text' && item.item_type !== 'note') return null;

  // Wrap the note/text in a Group so the background and the label move as one
  // object. The group is what becomes draggable; `onDragEnd` reports the
  // group's absolute position, which is exactly the item's position.
  return (
    <Group
      x={item.position_x}
      y={item.position_y}
      draggable={canInteract}
      onDragStart={() => onDragStart?.(item.id)}
      onDragEnd={(event) => onDragEnd?.(item.id, event.target.x(), event.target.y())}
      name={`item-${item.id}`}
    >
      <Rect
        width={item.width}
        height={item.height}
        cornerRadius={10}
        fill={item.item_type === 'note' ? item.content.color ?? '#f7c948' : 'rgba(255,253,246,0.0)'}
        stroke={selected ? '#080808' : 'transparent'}
        strokeWidth={2.5}
        dash={selected ? [8, 6] : undefined}
        listening={canInteract}
        onClick={(event) => {
          event.cancelBubble = true;
          onSelect(item.id, event.evt.shiftKey);
        }}
        onTap={(event) => {
          event.cancelBubble = true;
          onSelect(item.id, false);
        }}
        onDblClick={() => onDoubleClick(item)}
        onDblTap={() => onDoubleClick(item)}
      />
      <Text
        x={14}
        y={12}
        width={Math.max(20, item.width - 28)}
        height={Math.max(20, item.height - 24)}
        text={item.content.text ?? ''}
        fontSize={item.content.fontSize ?? 20}
        fontStyle="bold"
        fontFamily={fontFamily}
        fill={item.content.color ?? '#080808'}
        align={item.content.align ?? 'left'}
        lineHeight={1.25}
        wrap="word"
        ellipsis
        listening={false}
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

/**
 * DOM layer drawn on top of the Konva stage for the card types.
 *
 * This is where every card actually becomes visible: Konva only paints
 * primitives, and the shell above it paints the border/shadow. Images,
 * players, iframes and bookmark text all live here.
 */
export function CanvasCardOverlay({
  item,
  bookmark,
  media,
  canInteract,
  selected,
  onOpenEdit,
}: {
  item: CanvasItem;
  bookmark: Bookmark | null;
  media: MediaAsset | null;
  canInteract: boolean;
  selected: boolean;
  onOpenEdit: (item: CanvasItem) => void;
}) {
  const isCard =
    item.item_type === 'image' ||
    item.item_type === 'audio' ||
    item.item_type === 'video' ||
    item.item_type === 'media_link' ||
    item.item_type === 'bookmark';
  if (!isCard) return null;
  if (item.item_type === 'bookmark') {
    return <BookmarkCardBody bookmark={bookmark} />;
  }
  return (
    <div
      className="h-full w-full"
      // Deliberately does NOT stop pointerdown: the card shell above needs the
      // gesture to start a drag. Native controls (audio, video, links, buttons,
      // iframes) are excluded by the shell's NO_DRAG selector instead, so
      // pressing play never moves the card.
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (canInteract) onOpenEdit(item);
      }}
      data-selected={selected}
      style={{ pointerEvents: canInteract ? 'auto' : 'none' }}
      aria-hidden={false}
    >
      <MediaCardBody asset={media} />
    </div>
  );
}
