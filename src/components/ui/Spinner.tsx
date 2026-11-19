export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-bold" role="status" aria-live="polite">
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent"
        aria-hidden
      />
      {label}
    </span>
  );
}

export function PageLoader({ label = 'Loading Scratchpad…' }: { label?: string }) {
  return (
    <div className="grid min-h-[50vh] place-items-center p-6">
      <div className="paper flex items-center gap-3 px-5 py-4">
        <span
          className="inline-block h-5 w-5 animate-spin rounded-full border-[3px] border-ink border-t-transparent"
          aria-hidden
        />
        <span className="font-bold">{label}</span>
      </div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl border-2 border-ink/20 bg-ink/10 ${className}`} aria-hidden />;
}
