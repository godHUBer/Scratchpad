import type { ReactNode } from 'react';
import type { SyncState } from '../../hooks/useCanvasItems';

export type Tool = 'select' | 'pan' | 'text' | 'brush' | 'eraser';

export interface ToolAction {
  id: string;
  label: string;
  emoji: string;
  kind: 'tool' | 'action';
  disabled?: boolean;
  hint?: string;
}

interface FloatingToolbarProps {
  tool: Tool;
  onTool: (tool: Tool) => void;
  disabledActions: boolean;
  onText: () => void;
  onImage: () => void;
  onAudio: () => void;
  onVideo: () => void;
  onBookmark: () => void;
  onMediaLink: () => void;
  syncState: SyncState;
  lastSavedAt: Date | null;
  conflictCount: number;
  onRetrySync: () => void;
}

const TOOLS: Array<{ id: Tool; label: string; emoji: string }> = [
  { id: 'select', label: 'Select', emoji: '🖱️' },
  { id: 'text', label: 'Text', emoji: '🔠' },
  { id: 'brush', label: 'Brush', emoji: '🖌️' },
  { id: 'eraser', label: 'Eraser', emoji: '🧽' },
  { id: 'pan', label: 'Pan', emoji: '✋' },
];

export function FloatingToolbar({
  tool,
  onTool,
  disabledActions,
  onText,
  onImage,
  onAudio,
  onVideo,
  onBookmark,
  onMediaLink,
  syncState,
  lastSavedAt,
  conflictCount,
  onRetrySync,
}: FloatingToolbarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-2">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border-[3px] border-ink bg-paper p-1.5 hard-shadow-sm">
        <div className="flex items-center gap-1">
          {TOOLS.map((t) => (
            <ToolButton
              key={t.id}
              label={t.label}
              emoji={t.emoji}
              active={tool === t.id}
              onClick={() => onTool(t.id)}
              ariaPressed={tool === t.id}
            />
          ))}
        </div>
        <Divider />
        <div className="flex items-center gap-1">
          <ToolButton label="Add text" emoji="✍️" onClick={onText} disabled={disabledActions} />
          <ToolButton label="Add image" emoji="🖼️" onClick={onImage} disabled={disabledActions} />
          <ToolButton label="Add audio" emoji="🎧" onClick={onAudio} disabled={disabledActions} />
          <ToolButton label="Add video" emoji="🎬" onClick={onVideo} disabled={disabledActions} />
          <ToolButton label="Add bookmark" emoji="🔖" onClick={onBookmark} disabled={disabledActions} />
          <ToolButton label="Add media link" emoji="🔗" onClick={onMediaLink} disabled={disabledActions} />
        </div>
        <Divider />
        <SyncPill state={syncState} lastSavedAt={lastSavedAt} conflicts={conflictCount} onRetry={onRetrySync} />
      </div>
    </div>
  );
}

function ToolButton({
  label,
  emoji,
  onClick,
  active,
  disabled,
  ariaPressed,
}: {
  label: string;
  emoji: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  ariaPressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={ariaPressed}
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 place-items-center rounded-xl border-2 text-base transition-colors sm:h-10 sm:w-10 ${
        active
          ? 'border-ink bg-mustard shadow-[2px_2px_0_0_#080808]'
          : 'border-transparent hover:border-ink hover:bg-cream'
      } disabled:opacity-40`}
    >
      <span aria-hidden>{emoji}</span>
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 hidden h-7 w-[2px] rounded bg-ink/20 sm:block" aria-hidden />;
}

export function SyncPill({
  state,
  lastSavedAt,
  conflicts,
  onRetry,
}: {
  state: SyncState;
  lastSavedAt: Date | null;
  conflicts: number;
  onRetry: () => void;
}) {
  const config: Record<SyncState, { label: string; className: string; detail: string }> = {
    idle: { label: 'Ready', className: 'bg-paper', detail: 'Changes save automatically' },
    saving: { label: 'Saving…', className: 'bg-sky', detail: 'Sending changes' },
    saved: {
      label: 'Saved',
      className: 'bg-mint',
      detail: lastSavedAt ? `Last saved ${lastSavedAt.toLocaleTimeString()}` : 'All changes are stored',
    },
    error: { label: 'Save failed', className: 'bg-coral', detail: 'Tap to retry the last save' },
    offline: { label: 'Offline', className: 'bg-cream-deep', detail: 'Changes will retry when you reconnect' },
  };
  const { label, className, detail } = config[state];
  const interactive = state === 'error' || state === 'offline';

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={interactive ? onRetry : undefined}
        disabled={!interactive}
        title={`${detail}${conflicts > 0 ? ` · ${conflicts} remote update${conflicts === 1 ? '' : 's'} merged` : ''}`}
        className={`chip min-h-8 ${className} ${interactive ? 'hover:bg-paper' : ''}`}
        aria-live="polite"
      >
        <span
          className={`inline-block h-2 w-2 rounded-full border border-ink ${
            state === 'saving' ? 'animate-pulse bg-ink' : 'bg-ink/70'
          }`}
          aria-hidden
        />
        {label}
      </button>
      {conflicts > 0 ? (
        <span className="chip min-h-8 bg-lilac" title="Remote edits were merged into your canvas">
          ↗ {conflicts}
        </span>
      ) : null}
    </div>
  );
}

export function ToolbarIcon({ children }: { children: ReactNode }) {
  return <span className="grid h-9 w-9 place-items-center">{children}</span>;
}
