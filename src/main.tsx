import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider } from './contexts/ThemeContext';
import { isStaleChunkError, markBuildHealthy, reloadForNewBuild } from './lib/staleBuild';
import './styles/index.css';

/*
 * A failed lazy-chunk request is not a crash, it is a stale page.
 *
 * The entry bundle names chunks by content hash, so after a deploy an
 * already-open tab (or one holding a cached index.html) asks for a file that no
 * longer exists:
 *
 *   TypeError: Failed to fetch dynamically imported module:
 *   .../assets/SignInPage-COyBPllt.js
 *
 * Vite fires `preloadError` for its own preloads. A `lazy()` rejection does not
 * reliably fire anything, so the window-level rejection handler covers that
 * path too. Both funnel into one recovery attempt that bypasses the HTTP cache.
 */
function handleStaleChunk(error: unknown) {
  if (!isStaleChunkError(error)) return false;
  console.warn('[scratchpad] this page is from an older build; reloading to match the deployed one');
  // If this returns false a reload was already attempted moments ago, which
  // means the deployment itself is broken. The ErrorBoundary explains that
  // rather than reloading forever.
  return reloadForNewBuild();
}

window.addEventListener('vite:preloadError', (event) => {
  const error = (event as Event & { payload?: unknown }).payload;
  if (handleStaleChunk(error)) event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
  if (handleStaleChunk(event.reason)) event.preventDefault();
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

// React mounted from a build the browser actually has, so any earlier marker is
// stale and must not block the next genuine recovery.
markBuildHealthy();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      {/* Outermost, so every screen including sign-in can theme itself. */}
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
