import { useState } from 'react';
import type { Tool } from './FloatingToolbar';
import type { Bookmark, CanvasItem, MediaAsset } from '../../types';
import { roleLabel } from '../../lib/permissions';
import type { Role } from '../../types';
import { hostnameOf, pluralize } from '../../lib/format';

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
  onEditCard: (item: CanvasItem) => void;
  onDuplicate: (item: CanvasItem) => void;
  onDelete: (item: CanvasItem) => void;
  onLayer: (item: CanvasItem, direction: 'front' | 'back' | 'forward' | 'backward') => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
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
    onEditCard,
    onDuplicate,
    onDelete,
    onLayer,
    collapsed,
    onToggleCollapsed,
  } = props;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="absolute left-2 top-20 z-20 grid h-10 w-10 place-items-center rounded-xl border-[3px] border-ink bg-paper hard-shadow-sm"
        aria-label="Show toolbox"
        title="Show toolbox"
      >
        🧰
      </button>
    );
  }

  return (
    <aside
      className="absolute left-2 top-20 z-20 w-[248px] max-w-[86vw] overflow-y-auto rounded-2xl border-[3px] border-ink bg-paper p-3 hard-shadow-sm"
      style={{ maxHeight: 'calc(100% - 140px)' }}
      aria-label="Contextual toolbox"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-widest text-ink-soft">Toolbox</h2>
        <button
          type="button"
          className="grid h-7 w-7 place-items-center rounded-lg border-2 border-ink bg-paper text-xs font-black"
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
          setTextColor={setTextColor} canWrite={canWrite} />
      ) : selected.length === 1 ? (
        <SingleItem
          item={selected[0]!}
          canWrite={canWrite}
          bookmarks={bookmarks}
          media={media}
          onEditText={onEditText}
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
}) {
  return (
    <div className="space-y-3 text-sm">
      {(tool === 'brush' || tool === 'eraser') && (
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
          {tool === 'brush' ? (
            <>
              <p className="label mt-2">Brush colour</p>
              <Swatches value={brushColor} onChange={setBrushColor} />
            </>
          ) : (
            <p className="mt-2 text-xs text-ink-soft">The eraser paints with the paper colour.</p>
          )}
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
              <kbd className="chip">↑↓←→</kbd> nudge selected item
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
        <span className="chip bg-mustard">{typeLabel}</span>
        <span className="text-[10px] font-bold text-ink-soft">v{item.version}</span>
      </div>

      {(item.item_type === 'text' || item.item_type === 'note') && (
        <div className="rounded-xl border-2 border-ink/30 bg-cream/60 p-2">
          <p className="line-clamp-4 text-xs font-semibold">{item.content.text || 'Empty text'}</p>
          <button type="button" className="btn mt-2 min-h-8 w-full px-2 py-0.5 text-xs" disabled={!canWrite} onClick={() => onEditText(item)}>
            Edit text
          </button>
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
                Open ↗
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
                Open original ↗
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
              {direction === 'back' ? '⤓' : direction === 'backward' ? '↓' : direction === 'forward' ? '↑' : '⤒'}
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
          className={`h-7 w-7 rounded-full border-2 border-ink ${
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
        className="h-7 w-8 cursor-pointer rounded border-2 border-ink bg-paper p-0"
      />
    </div>
  );
}
