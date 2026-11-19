import { useToast, type ToastKind } from '../../contexts/ToastContext';

const ICON: Record<ToastKind, string> = { success: '✓', error: '!', info: 'i' };
const BG: Record<ToastKind, string> = {
  success: 'bg-mint',
  error: 'bg-coral',
  info: 'bg-sky',
};

export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-auto sm:left-auto sm:right-5 sm:top-5 sm:items-end"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="paper-flat pointer-events-auto flex w-full max-w-sm items-start gap-3 px-4 py-3 hard-shadow-sm"
        >
          <span
            className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-ink text-xs font-black ${BG[toast.kind]}`}
            aria-hidden
          >
            {ICON[toast.kind]}
          </span>
          <p className="flex-1 text-sm font-semibold leading-snug">{toast.message}</p>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="text-sm font-black opacity-60 hover:opacity-100"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
