import { useState } from 'react';
import type { Tool } from './FloatingToolbar';
import type { Bookmark, CanvasItem, MediaAsset } from '../../types';
import { roleLabel } from '../../lib/permissions';
import type { Role } from '../../types';
import { hostnameOf, pluralize } from '../../lib/format';
import { Icon } from '../ui/Icon';
import { FontPicker } from './FontPicker';
import { polygonPoints, SHAPES, type ShapeKind } from '../../lib/shapes';
import { DEFAULT_FONT } from '../../lib/fonts';

interface ContextToolboxProps {
  tool: Tool;
  brushColor: string;
  setBrushColor: (value: string) => void;
  brushSize: number;
  setBrushSize: (value: number) => void;
  textSize: number;
  setTextSize: (value: number) => void;
  textColor: string;
  setTextColor: (value: string) => void;
  selected: CanvasItem[];
  canWrite: boolean;
  role: Role | null;
  bookmarks: Record<string, Bookmark>;
  media: Record<string, MediaAsset>;
  onEditText: (item: CanvasItem) => void;
  /** Change just the font family of one text/note item. */
  onChangeFont?: (item: CanvasItem, family: string) => void;
  onEditCard: (item: CanvasItem) => void;
  onDuplicate: (item: CanvasItem) => void;
  onDelete: (item: CanvasItem) => void;
  onLayer: (item: CanvasItem, direction: 'front' | 'back' | 'forward' | 'backward') => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Drops a common shape on the canvas. Shapes live under the brush. */
  onInsertShape: (kind: ShapeKind) => void;
}

const SWATCHES = ['#080808', '#f7c948', '#ff8a80', '#7fd18b', '#8ec5ff', '#c9b6ff', '#ffffff'];

export function ContextToolbox(props: ContextToolboxProps) {
  const {
    tool,
    brushColor,
    setBrushColor,
    brushSize,
    setBrushSize,
    textSize,
    setTextSize,
    textColor,
    setTextColor,
    selected,
    canWrite,
    role,
    bookmarks,
    media,
    onEditText,
    onChangeFont,
    onEditCard,
    onDuplicate,
    onDelete,
    onLayer,
    collapsed,
    onToggleCollapsed,
    onInsertShape,
  } = props;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="absolute left-2 top-[9.5rem] z-20 grid h-10 w-10 place-items-center rounded-xl border-[3px] border-ink bg-paper hard-shadow-sm pointer-coarse:h-11 pointer-coarse:w-11 sm:top-20"
        aria-label="Show toolbox"
        title="Show toolbox"
      >
        <Icon name="settings" size={18} />
      </button>
    );
  }

  return (
    <aside
      className="app-scroll absolute left-2 top-[9.5rem] z-20 w-[232px] max-w-[calc(100%-1rem)] overflow-y-auto rounded-2xl border-[3px] border-ink bg-paper p-3 hard-shadow-sm sm:top-20 sm:w-[248px]"
      style={{ maxHeight: 'calc(100% - 10.5rem)' }}
      aria-label="Contextual toolbox"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-widest text-ink-soft">Toolbox</h2>
        <button
          type="button"
          className="grid h-7 w-7 place-items-center rounded-lg border-2 border-ink bg-paper text-xs font-black pointer-coarse:h-11 pointer-coarse:w-11"
          onClick={onToggleCollapsed}
          aria-label="Hide toolbox"
        >
          «
        </button>
      </div>

      {!canWrite ? (
        <p className="mb-3 rounded-xl border-[3px] border-ink bg-cream px-2 py-1.5 text-xs font-bold">
          You are a {role ? roleLabel(role).toLowerCase() : 'guest'} — the canvas is read-only for you.
        </p>
      ) : null}

      {selected.length === 0 ? (
        <EmptyContext tool={tool} brushColor={brushColor} setBrushColor={setBrushColor} brushSize={brushSize}
          setBrushSize={setBrushSize} textSize={textSize} setTextSize={setTextSize} textColor={textColor}
          onInsertShape={onInsertShape}
          setTextColor={setTextColor} canWrite={canWrite} />
      ) : selected.length === 1 ? (
        <SingleItem
          item={selected[0]!}
          canWrite={canWrite}
          bookmarks={bookmarks}
          media={media}
          onEditText={onEditText}
          onChangeFont={onChangeFont}
          onEditCard={onEditCard}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onLayer={onLayer}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-extrabold">
            {selected.length} {pluralize(selected.length, 'item')} selected
          </p>
          <button
            type="button"
            className="btn min-h-9 w-full px-2 py-1 text-sm"
            disabled={!canWrite}
            onClick={() => selected.forEach((item) => onDuplicate(item))}
          >
            Duplicate all
          </button>
          <button
            type="button"
            className="btn btn-danger min-h-9 w-full px-2 py-1 text-sm"
            disabled={!canWrite}
            onClick={() => selected.forEach((item) => onDelete(item))}
          >
            Delete all
          </button>
        </div>
      )}
    </aside>
  );
}

function EmptyContext({
  tool,
  brushColor,
  setBrushColor,
  brushSize,
  setBrushSize,
  textSize,
  setTextSize,
  textColor,
  setTextColor,
  canWrite,
  onInsertShape,
}: {
  tool: Tool;
  brushColor: string;
  setBrushColor: (value: string) => void;
  brushSize: number;
  setBrushSize: (value: number) => void;
  textSize: number;
  setTextSize: (value: number) => void;
  textColor: string;
  setTextColor: (value: string) => void;
  canWrite: boolean;
  onInsertShape: (kind: ShapeKind) => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      {tool === 'brush' && (
        <div>
          <label className="label" htmlFor="brush-size">
            Brush size · {brushSize}px
          </label>
          <input
            id="brush-size"
            type="range"
            min={2}
            max={40}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
            className="w-full accent-ink"
            disabled={!canWrite}
          />
          <p className="label mt-2">Brush colour</p>
          <Swatches value={brushColor} onChange={setBrushColor} />

          {/* Shapes sit with the brush: both create vector marks on the canvas. */}
          <p className="label mt-3">Shapes</p>
          <div className="grid grid-cols-3 gap-1.5">
            {SHAPES.map((shape) => (
              <button
                key={shape.kind}
                type="button"
                onClick={() => onInsertShape(shape.kind)}
                disabled={!canWrite}
                title={`Add a ${shape.label.toLowerCase()}`}
                aria-label={`Add a ${shape.label.toLowerCase()}`}
                className="flex flex-col items-center gap-1 rounded-xl border-2 border-ink bg-paper px-1 py-1.5 text-[10px] font-bold hover:bg-cream disabled:opacity-40 pointer-coarse:py-2"
              >
                <ShapeGlyph kind={shape.kind} />
                <span className="leading-none">{shape.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tool === 'eraser' && (
        <div className="space-y-2">
          <p className="text-sm font-extrabold">Drag to erase</p>
          <p className="text-xs text-ink-soft">
            Click or drag across any drawing, text box or card to remove it — every object the stroke
            passes over disappears. Undo with Ctrl/⌘+Z.
          </p>
        </div>
      )}

      {tool === 'text' && (
        <div>
          <label className="label" htmlFor="text-size">
            Text size · {textSize}px
          </label>
          <input
            id="text-size"
            type="range"
            min={12}
            max={72}
            value={textSize}
            onChange={(event) => setTextSize(Number(event.target.value))}
            className="w-full accent-ink"
            disabled={!canWrite}
          />
          <p className="label mt-2">Text colour</p>
          <Swatches value={textColor} onChange={setTextColor} />
        </div>
      )}

      {tool === 'select' && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-ink-soft">
            Click an object to select it. Drag on empty space to select many. Double-click empty space to add a note.
          </p>
          <ul className="space-y-1 text-[11px] font-semibold text-ink-soft">
            <li>
              <kbd className="chip">⌫</kbd> delete selection
            </li>
            <li>
              <kbd className="chip">Esc</kbd> clear selection / cancel tool
            </li>
            <li>
              <kbd className="chip">arrows</kbd> nudge selected item
            </li>
            <li>
              <kbd className="chip">Ctrl/⌘ + Z</kbd> undo
            </li>
          </ul>
        </div>
      )}

      {tool === 'pan' && <p className="text-xs font-bold text-ink-soft">Drag anywhere to pan the canvas.</p>}
    </div>
  );
}

function SingleItem({
  item,
  canWrite,
  bookmarks,
  media,
  onEditText,
  onChangeFont,
  onEditCard,
  onDuplicate,
  onDelete,
  onLayer,
}: {
  item: CanvasItem;
  canWrite: boolean;
  bookmarks: Record<string, Bookmark>;
  media: Record<string, MediaAsset>;
  onEditText: (item: CanvasItem) => void;
  /** Change just the font family of one text/note item. */
  onChangeFont?: (item: CanvasItem, family: string) => void;
  onEditCard: (item: CanvasItem) => void;
  onDuplicate: (item: CanvasItem) => void;
  onDelete: (item: CanvasItem) => void;
  onLayer: (item: CanvasItem, direction: 'front' | 'back' | 'forward' | 'backward') => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bookmark = item.bookmark_id ? bookmarks[item.bookmark_id] : null;
  const asset = item.media_asset_id ? media[item.media_asset_id] : null;

  const typeLabel =
    item.item_type === 'text'
      ? 'Text'
      : item.item_type === 'note'
        ? 'Note'
        : item.item_type === 'draw'
          ? 'Drawing'
          : item.item_type === 'bookmark'
            ? 'Bookmark card'
            : 'Media card';

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="chip chip-accent bg-mustard">{typeLabel}</span>
        <span className="text-[10px] font-bold text-ink-soft">v{item.version}</span>
      </div>

      {(item.item_type === 'text' || item.item_type === 'note') && (
        <div className="rounded-xl border-2 border-ink/30 bg-cream/60 p-2">
          <p className="line-clamp-4 text-xs font-semibold">{item.content?.text || 'Empty text'}</p>
          <button type="button" className="btn mt-2 min-h-8 w-full px-2 py-0.5 text-xs" disabled={!canWrite} onClick={() => onEditText(item)}>
            Edit text
          </button>
          {onChangeFont ? (
            <div className="mt-2">
              <FontPicker
                compact
                value={item.content?.fontFamily ?? DEFAULT_FONT}
                onChange={(family) => onChangeFont(item, family)}
              />
            </div>
          ) : null}
        </div>
      )}

      {item.item_type === 'bookmark' && (
        <div className="rounded-xl border-2 border-ink/30 bg-cream/60 p-2">
          <p className="text-xs font-extrabold">{bookmark?.title ?? 'Bookmark removed'}</p>
          {bookmark ? <p className="truncate text-[11px] text-ink-soft">{hostnameOf(bookmark.url)}</p> : null}
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button type="button" className="btn min-h-8 px-2 py-0.5 text-xs" disabled={!canWrite} onClick={() => onEditCard(item)}>
              Edit
            </button>
            {bookmark ? (
              <a href={bookmark.url} target="_blank" rel="noreferrer noopener" className="btn min-h-8 px-2 py-0.5 text-xs">
                Open
              </a>
            ) : null}
          </div>
        </div>
      )}

      {['image', 'audio', 'video', 'media_link'].includes(item.item_type) && (
        <div className="rounded-xl border-2 border-ink/30 bg-cream/60 p-2">
          <p className="truncate text-xs font-extrabold">{asset?.file_name ?? 'Media removed'}</p>
          {asset ? (
            <p className="truncate text-[11px] text-ink-soft">
              {asset.drive_file_id ? 'Google Drive · ' : ''}
              {asset.file_type}
            </p>
          ) : null}
          <div className="mt-2 grid gap-1">
            <button type="button" className="btn min-h-8 px-2 py-0.5 text-xs" disabled={!canWrite} onClick={() => onEditCard(item)}>
              Edit link
            </button>
            {asset ? (
              <a href={asset.original_url} target="_blank" rel="noreferrer noopener" className="btn min-h-8 px-2 py-0.5 text-xs">
                Open original
              </a>
            ) : null}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1">
        <button type="button" className="btn min-h-8 px-2 py-0.5 text-xs" disabled={!canWrite} onClick={() => onDuplicate(item)}>
          Duplicate
        </button>
        <button
          type="button"
          className="btn btn-danger min-h-8 px-2 py-0.5 text-xs"
          disabled={!canWrite}
          onClick={() => {
            if (confirmDelete) {
              onDelete(item);
              setConfirmDelete(false);
            } else {
              setConfirmDelete(true);
            }
          }}
          onBlur={() => setConfirmDelete(false)}
        >
          {confirmDelete ? 'Tap again' : 'Delete'}
        </button>
      </div>

      <div>
        <p className="label">Layer</p>
        <div className="grid grid-cols-4 gap-1">
          {(['back', 'backward', 'forward', 'front'] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              className="btn min-h-8 px-1 py-0.5 text-[10px] capitalize"
              disabled={!canWrite}
              onClick={() => onLayer(item, direction)}
              title={direction}
            >
              <Icon name={direction === 'back' || direction === 'backward' ? 'zoomOut' : 'zoomIn'} size={14} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={`Colour ${color}`}
          aria-pressed={value.toLowerCase() === color.toLowerCase()}
          className={`h-7 w-7 rounded-full border-2 border-ink pointer-coarse:h-10 pointer-coarse:w-10 ${
            value.toLowerCase() === color.toLowerCase() ? 'ring-2 ring-ink ring-offset-1' : ''
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Custom colour"
        className="h-7 w-8 cursor-pointer rounded border-2 border-ink bg-paper p-0 pointer-coarse:h-10 pointer-coarse:w-11"
      />
    </div>
  );
}

/**
 * A tiny SVG preview of each shape for the toolbox button.
 *
 * Drawn from the same geometry functions the canvas uses, so the preview cannot
 * drift from what actually gets inserted. SVG rather than a Konva canvas here:
 * these are 20 px icons and a second canvas per button would be wasteful.
 */
function ShapeGlyph({ kind }: { kind: ShapeKind }) {
  const size = 22;
  const w = size;
  const h = size;
  const stroke = { stroke: 'currentColor', strokeWidth: 2, fill: 'none', strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

  if (kind === 'ellipse') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 3} {...stroke} />
      </svg>
    );
  }

  if (kind === 'arrow') {
    // Built here rather than from arrowPoints: the icon needs a visible shaft
    // and head at 22 px, which is a different drawing from the canvas arrow.
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <path d={`M2 ${h / 2} H${w - 2} M${w - 7} ${h / 2 - 4} L${w - 2} ${h / 2} L${w - 7} ${h / 2 + 4}`} {...stroke} />
      </svg>
    );
  }

  if (kind === 'line') {
    // A closed polygon would draw a hairline triangle; the toolbox button for
    // "Line" has to actually look like one.
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <line x1={2} y1={h - 3} x2={w - 2} y2={3} {...stroke} />
      </svg>
    );
  }

  if (kind === 'cylinder') {
    // Two caps and a body, the same construction the canvas renderer uses.
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <path
          d={`M2 6 v${h - 12} a${w / 2 - 2} 3 0 0 0 ${w - 4} 0 v-${h - 12}`}
          {...stroke}
        />
        <ellipse cx={w / 2} cy={6} rx={w / 2 - 2} ry={3} {...stroke} />
      </svg>
    );
  }

  if (kind === 'roundedRect') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <rect x={1} y={2} width={w - 2} height={h - 4} rx={5} {...stroke} />
      </svg>
    );
  }

  const points = polygonPoints(kind, w - 2, h - 4)
    .map(([x, y]) => `${x + 1},${y + 2}`)
    .join(' ');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <polygon points={points} {...stroke} />
    </svg>
  );
}
