import { Spinner } from './Spinner';

/**
 * Shown while a lazily-loaded route chunk arrives.
 *
 * Deliberately tiny and dependency-free: it is rendered by the initial bundle,
 * so anything it imports would defeat the point of splitting the route. Sized
 * with the dynamic viewport so the loading state does not jump when mobile
 * browser chrome collapses.
 */
export function PageFallback() {
  return (
    <div className="h-dvh-screen grid place-items-center bg-cream" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <Spinner />
        <span className="text-sm font-bold text-ink-soft">Loading…</span>
      </div>
    </div>
  );
}
