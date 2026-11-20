import { Component, type ErrorInfo, type ReactNode } from 'react';

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
