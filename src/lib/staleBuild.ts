/**
 * Recovery from a deploy that replaced the JavaScript while a tab was open.
 *
 * What the user sees
 *   "TypeError: Failed to fetch dynamically imported module:
 *    .../assets/SignInPage-COyBPllt.js"
 *
 * Why it happens
 *   Every route is lazily imported, so the entry bundle asks the server for a
 *   chunk by a content hash. A deploy replaces the whole `assets/` directory
 *   and the new `index.html` names new hashes; the old files are gone. A tab
 *   still running the previous build — or served a stale `index.html` from the
 *   HTTP cache — then requests a chunk that no longer exists and every
 *   navigation fails. Nothing is wrong with the deployment: it is two builds of
 *   the app existing at once.
 *
 * Why the obvious button does not fix it
 *   `window.location.reload()` re-requests the document, and GitHub Pages
 *   serves `index.html` with a cache lifetime. Reloading therefore hands back
 *   the *same* stale document pointing at the *same* dead hash, and the user
 *   loops. Recovery has to bypass the HTTP cache once, not repeat the same
 *   request.
 *
 * The strategy
 *   1. Detect a chunk load failure (Vite's `preloadError`, or the message text,
 *      because a `lazy()` rejection does not always surface as an event).
 *   2. Reload once with the cache bypassed, keeping the hash so the user lands
 *      on the screen they were trying to open. `HashRouter` urls survive this.
 *   3. If the failure repeats straight after a forced reload, the deployment
 *      itself is broken. Stop reloading — a loop is worse than an explanation —
 *      and say so.
 *
 * The guard is a timestamp rather than a counter so a user who hits this twice
 * in a day still gets the automatic recovery the second time.
 */

/** Survives the reload, unlike anything in memory. */
const RELOAD_MARKER = 'scratchpad.chunkReloadAt';

/**
 * Minimum gap between automatic recoveries.
 *
 * Long enough that a second failure after a forced reload is treated as a real
 * outage; short enough that an unlucky user is not permanently stuck on the
 * manual path for the rest of the session.
 */
const COOLDOWN_MS = 30_000;

/** Vite prepends this to a failed dynamic import in some browsers. */
const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk \d+ failed/i,
  /unable to preload css/i,
];

/** True when the rejection looks like a missing/stale build artefact. */
export function isStaleChunkError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : '';
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * True when an automatic reload already happened very recently, meaning the
 * forced reload did not help and another one would loop.
 */
export function reloadRecentlyAttempted(now = Date.now()): boolean {
  try {
    const raw = window.localStorage.getItem(RELOAD_MARKER);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return now - at < COOLDOWN_MS;
  } catch {
    // No storage: assume no prior attempt. Worst case is one extra reload.
    return false;
  }
}

/**
 * Reload bypassing the HTTP cache, preserving the current route.
 *
 * GitHub Pages serves `index.html` with a cache lifetime, so a plain reload can
 * be answered from the browser cache with the same stale hash. Adding a query
 * parameter makes the request URL distinct, which forces a fresh fetch of the
 * document and therefore of the current chunk hashes.
 *
 * Returns false when it declined to reload because one was just attempted; the
 * caller should then show the manual explanation instead of looping.
 */
export function reloadForNewBuild(now = Date.now()): boolean {
  if (reloadRecentlyAttempted(now)) return false;

  try {
    const stamp = String(now);
    window.localStorage.setItem(RELOAD_MARKER, stamp);
  } catch {
    // Best effort; without it we simply lose the loop guard.
  }

  const { origin, pathname, search, hash } = window.location;
  // A cache-busting parameter in the query string. The hash (the route) is
  // preserved verbatim, so the user returns to the screen they asked for.
  const params = new URLSearchParams(search);
  params.set('v', String(now));
  window.location.replace(`${origin}${pathname}?${params.toString()}${hash}`);
  return true;
}

/** Clears the guard. Called once the app has booted, proving the build is good. */
export function markBuildHealthy(): void {
  try {
    window.localStorage.removeItem(RELOAD_MARKER);
  } catch {
    // Nothing to do.
  }
}
