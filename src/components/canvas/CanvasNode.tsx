import { useEffect, useState } from 'react';
import { Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva';
import type { Bookmark, CanvasItem, MediaAsset } from '../../types';
import { driveDirectUrl } from '../../lib/drive';
import { BookmarkCardBody } from './BookmarkCardBody';
import { MediaCardBody } from './MediaCardBody';

/** Konva can only draw primitives; DOM content rides along in an absolutely
 *  positioned overlay that mirrors the node's screen rectangle. */
interface CanvasNodeProps {
  item: CanvasItem;
  bookmark: Bookmark | null;
  media: MediaAsset | null;
  selected: boolean;
  canInteract: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  onDoubleClick: (item: CanvasItem) => void;
}

const CARD_RADIUS = 14;

export function CanvasNode({
  item,
  bookmark,
  media,
  selected,
  canInteract,
  onSelect,
  onDoubleClick,
}: CanvasNodeProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const isDraw = item.item_type === 'draw';
  const z = item.content.z ?? 0;

  // images are loaded off-DOM so Konva can paint them (crisp at any zoom)
  const mediaUrl =
    media?.file_type === 'image'
      ? media.drive_file_id
        ? driveDirectUrl(media.drive_file_id, 'image')
        : media.original_url
      : null;
  useEffect(() => {
    setImage(null);
    setImageFailed(false);
    if (!mediaUrl) return;
    const el = new window.Image();
    el.crossOrigin = 'anonymous';
    el.referrerPolicy = 'no-referrer';
    let cancelled = false;
    el.onload = () => {
      if (!cancelled) setImage(el);
    };
    el.onerror = () => {
      if (!cancelled) setImageFailed(true);
    };
    el.src = mediaUrl;
    return () => {
      cancelled = true;
      el.onload = null;
      el.onerror = null;
    };
  }, [mediaUrl]);

  if (isDraw) {
    const points = item.content.points ?? [];
    return (
      <>
        <Line
          points={points}
          stroke={item.content.color ?? '#080808'}
          strokeWidth={item.content.strokeWidth ?? 4}
          lineCap="round"
          lineJoin="round"
          tension={0.25}
          hitStrokeWidth={Math.max(20, (item.content.strokeWidth ?? 4) + 12)}
          x={item.position_x}
          y={item.position_y}
          listening={canInteract}
          onClick={(event) => {
            event.cancelBubble = true;
            onSelect(item.id, event.evt.shiftKey);
          }}
          onTap={(event) => {
            event.cancelBubble = true;
            onSelect(item.id, false);
          }}
          zIndex={undefined}
          name={`item-${item.id}`}
        />
      </>
    );
  }

  if (item.item_type === 'text' || item.item_type === 'note') {
    return (
      <>
        <Rect
          x={item.position_x}
          y={item.position_y}
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
          x={item.position_x + 14}
          y={item.position_y + 12}
          width={Math.max(20, item.width - 28)}
          height={Math.max(20, item.height - 24)}
          text={item.content.text ?? ''}
          fontSize={item.content.fontSize ?? 20}
          fontFamily="Trebuchet MS, Segoe UI, sans-serif"
          fontStyle="bold"
          fill={item.content.color ?? '#080808'}
          align={item.content.align ?? 'left'}
          lineHeight={1.25}
          wrap="word"
          ellipsis
          listening={false}
          perfectDrawEnabled={false}
        />
        <Group y={-9999} x={-9999} name={`z-${z}`} />
      </>
    );
  }

  // cards: media, bookmark, media_link
  const fill =
    item.item_type === 'bookmark'
      ? bookmark?.color ?? item.content.color ?? '#f7c948'
      : 'rgba(255,253,246,0.96)';
  const isImageCard = item.item_type === 'image' && image && !imageFailed;

  return (
    // Cards are painted here (so images and bookmarks survive zoom) but all
    // interaction happens in the DOM shell, which can host real media players.
    <Group x={item.position_x} y={item.position_y} listening={false}>
      <Rect
        width={item.width}
        height={item.height}
        cornerRadius={CARD_RADIUS}
        fill={isImageCard ? '#fffdf6' : fill}
        stroke="#080808"
        strokeWidth={2.5}
        shadowColor="#080808"
        shadowOpacity={0.25}
        shadowBlur={0}
        shadowOffsetY={3}
        shadowOffsetX={3}
      />
      {isImageCard && image ? (
        <KonvaImage image={image} width={item.width} height={item.height} cornerRadius={CARD_RADIUS} listening={false} />
      ) : null}
      <Rect
        width={item.width}
        height={item.height}
        cornerRadius={CARD_RADIUS}
        stroke={selected ? '#080808' : 'transparent'}
        strokeWidth={3}
        dash={selected ? [10, 6] : undefined}
        listening={false}
      />
    </Group>
  );
}

/** DOM layer drawn on top of the Konva stage for rich card content. */
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
  // audio/video/link bodies are interactive; images are painted by Konva
  if (item.item_type === 'image') return null;
  return (
    <div
      className="h-full w-full"
      onPointerDown={(event) => {
        if (canInteract) event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (canInteract) onOpenEdit(item);
      }}
      data-selected={selected}
      style={{ pointerEvents: canInteract ? 'auto' : 'none' }}
      aria-hidden={false}
    >
      <MediaCardBody asset={media} interactive={canInteract} />
    </div>
  );
}

export function overlayStyle(item: CanvasItem, viewport: { x: number; y: number; scale: number }) {
  return {
    left: item.position_x * viewport.scale + viewport.x,
    top: item.position_y * viewport.scale + viewport.y,
    width: item.width * viewport.scale,
    height: item.height * viewport.scale,
    borderRadius: 14 * viewport.scale,
  };
}
