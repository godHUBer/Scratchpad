# Local browser QA harness

The sandbox and most CI runners cannot reach `*.supabase.co`, and Playwright's browser CDN is often
blocked too. These scripts make it possible to drive the **real built app** in a **real Chromium**
anyway:

- `stub-supabase.mjs` — a Playwright route handler that answers Auth/PostgREST/Realtime requests
  with in-memory data. It is a test double for the **network only**; every line of app code under
  test is the real code.
- `screens.mjs` — loads every route, reports empty `<main>` elements, console errors and "tofu"
  (missing-glyph) text, and writes screenshots.
- `browser-smoke.mjs` — signs in, creates text, draws a stroke, reloads, and asserts both items
  survive (persistence).
- `boot-check.mjs` — loads a URL and reports whether `#root` mounted.
- `glyph-probe.mjs` / `icon-preview.mjs` — font/icon rendering checks.

## Running

```bash
# 1. build for the Pages sub-path and serve it the way Pages would
VITE_BASE_PATH=/Scratchpad/ npm run build
python3 -m http.server 4180 --directory dist   # then visit /Scratchpad/ via a prefix server

# 2. a Chromium binary without the Playwright CDN
npm i -D playwright @sparticuz/chromium
LD_LIBRARY_PATH=<extracted al2>/lib node scripts/qa/screens.mjs
```

`@sparticuz/chromium` bundles `bin/al2.tar.br`; brotli-decompress it and point `LD_LIBRARY_PATH` at
`lib/` (it provides `libnss3.so` and friends on slim images).

These scripts are development tools: they are excluded from the production bundle and from
`npm run build`.
