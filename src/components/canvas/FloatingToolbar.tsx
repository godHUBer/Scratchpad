
import type { SyncState } from '../../hooks/useCanvasItems';
import { Icon, type IconName } from '../ui/Icon';

export type Tool = 'select' | 'pan' | 'text' | 'brush' | 'eraser';

export interface ToolAction {
  id: string;
  label: string;
  icon: IconName;
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

const TOOLS: Array<{ id: Tool; label: string; icon: IconName }> = [
  { id: 'select', label: 'Select', icon: 'select' },
  { id: 'text', label: 'Text', icon: 'text' },
  { id: 'brush', label: 'Brush', icon: 'brush' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser' },
  { id: 'pan', label: 'Pan', icon: 'hand' },
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
    /*
      On a phone this used to wrap into three or four rows and eat the top third
      of the canvas. It is now a single row that scrolls horizontally: the tools
      stay one tap away, the canvas keeps its space, and the sync pill sits on
      its own so it never squeezes the buttons.
    */
    <div className="pointer-events-none absolute inset-x-0 top-safe-2 z-20 flex flex-col items-center gap-1 px-2">
      <div className="pointer-events-auto flex w-full max-w-full items-center gap-1 rounded-2xl border-[3px] border-ink bg-paper p-1.5 hard-shadow-sm sm:w-auto sm:justify-center">
        <div className="no-scrollbar app-scroll flex flex-1 items-center gap-1 overflow-x-auto sm:flex-none sm:overflow-visible">
          <div className="flex shrink-0 items-center gap-1">
            {TOOLS.map((t) => (
              <ToolButton
                key={t.id}
                label={t.label}
                icon={t.icon}
                active={tool === t.id}
                onClick={() => onTool(t.id)}
                ariaPressed={tool === t.id}
              />
            ))}
          </div>
          <Divider />
          <div className="flex shrink-0 items-center gap-1">
            <ToolButton label="Add text" icon="text" onClick={onText} disabled={disabledActions} />
            <ToolButton label="Add image" icon="image" onClick={onImage} disabled={disabledActions} />
            <ToolButton label="Add audio" icon="audio" onClick={onAudio} disabled={disabledActions} />
            <ToolButton label="Add video" icon="video" onClick={onVideo} disabled={disabledActions} />
            <ToolButton label="Add bookmark" icon="bookmark" onClick={onBookmark} disabled={disabledActions} />
            <ToolButton label="Add media link" icon="link" onClick={onMediaLink} disabled={disabledActions} />
          </div>
        </div>
        <div className="shrink-0 sm:hidden">
          <SyncPill state={syncState} lastSavedAt={lastSavedAt} conflicts={conflictCount} onRetry={onRetrySync} compact />
        </div>
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          <Divider />
          <SyncPill state={syncState} lastSavedAt={lastSavedAt} conflicts={conflictCount} onRetry={onRetrySync} />
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
  active,
  disabled,
  ariaPressed,
}: {
  label: string;
  icon: IconName;
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
      // 36px under a mouse, 44px under a finger. This is the most-tapped
      // control in the app and 36px is below the comfortable threshold.
      className={`grid h-9 w-9 place-items-center rounded-xl border-2 text-ink transition-colors pointer-coarse:h-11 pointer-coarse:w-11 sm:h-10 sm:w-10 ${
        active
          ? 'border-ink bg-mustard shadow-[2px_2px_0_0_#080808]'
          : 'border-transparent hover:border-ink hover:bg-cream'
      } disabled:opacity-40`}
    >
      <Icon name={icon} />
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
  compact = false,
}: {
  state: SyncState;
  lastSavedAt: Date | null;
  conflicts: number;
  onRetry: () => void;
  /** Icon-only form for narrow screens, where the label steals the toolbar. */
  compact?: boolean;
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
        className={`chip chip-accent min-h-8 ${className} ${interactive ? 'hover:bg-paper' : ''} ${
          compact ? 'tap-sm min-w-11 justify-center px-1.5' : ''
        }`}
        aria-live="polite"
        aria-label={compact ? `${label}. ${detail}` : undefined}
      >
        <span
          className={`inline-block h-2 w-2 rounded-full border border-ink ${
            state === 'saving' ? 'animate-pulse bg-ink' : 'bg-ink/70'
          }`}
          aria-hidden
        />
        {compact ? null : label}
      </button>
      {conflicts > 0 ? (
        <span className="chip chip-accent min-h-8 bg-lilac" title="Remote edits were merged into your canvas">
          {conflicts}
        </span>
      ) : null}
    </div>
  );
}

