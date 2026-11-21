import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isStaleChunkError, reloadForNewBuild, reloadRecentlyAttempted } from '../lib/staleBuild';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence: a render error anywhere in the tree should show a
 * readable panel instead of a blank white page. Without this, a single throw
 * during boot looks identical to "the deployment is broken".
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // keep the console copy for debugging; the panel is for humans
    console.error('Scratchpad crashed while rendering:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    /*
     * A rejected `lazy()` import lands here as a render error. That is not a
     * bug in the page — it is a page from an older build asking for a chunk the
     * new deployment no longer has — so offer the recovery that actually works
     * and say what happened, instead of "hit a snag, try reloading".
     */
    if (isStaleChunkError(error)) {
      const stuck = reloadRecentlyAttempted();
      return (
        <div className="grid min-h-dvh place-items-center bg-cream p-4 text-ink">
          <div className="paper w-full max-w-lg space-y-3 p-5">
            <h1 className="text-xl font-black">Scratchpad was updated</h1>
            <p className="text-sm text-ink-soft">
              This page was opened before the latest version was deployed, and the part it needs has
              been replaced. {stuck ? 'Reloading automatically already failed once, so' : ''} reload
              with the new version to continue — your work is saved on the server, not in this tab.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  // A plain reload can be answered from the HTTP cache with the
                  // same stale document, which is why this must bypass it.
                  if (!reloadForNewBuild()) window.location.reload();
                }}
              >
                Load the new version
              </button>
              <a className="btn" href={import.meta.env.BASE_URL}>
                Back to start
              </a>
            </div>
            <p className="text-[11px] text-ink-soft">
              If this keeps happening, the deployment may be incomplete — the page is asking for a
              file that is not on the server.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="grid min-h-dvh place-items-center bg-cream p-4 text-ink">
        <div className="paper w-full max-w-lg space-y-3 p-5">
          <h1 className="text-xl font-black">Scratchpad hit a snag</h1>
          <p className="text-sm text-ink-soft">
            The page failed while rendering. Reloading usually helps; if it keeps happening, copy the
            details below.
          </p>
          <pre className="max-h-48 overflow-auto rounded border-2 border-ink bg-paper p-2 text-[11px] leading-snug">
            {error.name}: {error.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(`${error.name}: ${error.message}\n\n${error.stack ?? ''}`);
              }}
            >
              Copy details
            </button>
            <a className="btn" href={import.meta.env.BASE_URL}>
              Back to start
            </a>
          </div>
        </div>
      </div>
    );
  }
}
