#!/usr/bin/env node
/**
 * Fails the build when the JavaScript sent to a browser grows past a budget.
 *
 * Why this exists
 * ---------------
 * Konva is the single largest dependency in this app and it is easy to add
 * "just one more" library on a canvas feature. Without a check, the bundle only
 * ever grows, and every phone user pays for it on every cold load.
 *
 * What is measured
 * ----------------
 * Gzipped bytes, because that is what actually crosses the network. Three
 * budgets are enforced:
 *
 *   entry   the chunks referenced by dist/index.html. Every visitor downloads
 *           these before anything renders, so this is the number that matters
 *           most. A route that grows should be split out, not added here.
 *   total   every emitted .js file. This catches a new lazy route that is so
 *           large it would be slow even though it loads on demand.
 *   single  the largest individual chunk. Stops one route ballooning.
 *
 * Route chunks are intentionally *not* counted against `entry`: since routes
 * are lazy (see src/App.tsx), a visitor to the sign-in page never downloads the
 * canvas engine. Folding them into one grand total would either make the budget
 * meaningless or fail the build for code most users never run.
 *
 * Usage
 * -----
 *   node scripts/check-bundle-size.mjs               # check dist/
 *   node scripts/check-bundle-size.mjs --update      # rewrite the baseline
 *   node scripts/check-bundle-size.mjs --json        # machine-readable summary
 *
 * The baseline lives in scripts/bundle-budget.json so a deliberate change is a
 * reviewable diff rather than a number buried in a workflow file.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DIST = join(ROOT, 'dist');
const BUDGET_FILE = join(HERE, 'bundle-budget.json');

const args = new Set(process.argv.slice(2));
const UPDATE = args.has('--update');
const AS_JSON = args.has('--json');

/** gzipped size of a file, which is what the browser actually receives. */
function gzipSize(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

function fail(message) {
  if (AS_JSON) {
    console.log(JSON.stringify({ ok: false, error: message }));
  } else {
    console.error(`\n::error::${message}`);
  }
  process.exit(1);
}

if (!existsSync(DIST)) {
  fail('dist/ does not exist. Run `npm run build` before checking bundle size.');
}

const htmlPath = join(DIST, 'index.html');
if (!existsSync(htmlPath)) {
  fail('dist/index.html is missing, so the entry chunks cannot be identified.');
}

/*
 * The entry chunks are whatever index.html actually references. Reading them
 * from the HTML rather than guessing by filename means this keeps working if
 * Vite changes its naming scheme or adds a preload.
 */
const html = readFileSync(htmlPath, 'utf8');
const entryFiles = new Set(
  [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => basename(m[1])),
);

if (entryFiles.size === 0) {
  fail('No JavaScript is referenced by dist/index.html; is the build configured correctly?');
}

/*
 * Every emitted chunk. CSS is deliberately excluded: it is small, tracked by
 * the design tokens rather than by dependency sprawl, and mixing two
 * compressible formats into one budget hides regressions in both.
 */
const assetsDir = join(DIST, 'assets');
const allFiles = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
  : [];

if (allFiles.length === 0) {
  fail('dist/assets contains no .js files.');
}

const chunks = allFiles.map((file) => {
  const full = join(assetsDir, file);
  return {
    file,
    raw: statSync(full).size,
    gzip: gzipSize(full),
    entry: entryFiles.has(file),
  };
});

const measured = {
  // gzipped entry payload: the cost of the first screen
  entry: chunks.filter((c) => c.entry).reduce((sum, c) => sum + c.gzip, 0),
  // gzipped total across every emitted chunk
  total: chunks.reduce((sum, c) => sum + c.gzip, 0),
  // largest single gzipped chunk
  single: Math.max(...chunks.map((c) => c.gzip)),
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

if (UPDATE) {
  const budget = Object.fromEntries(
    Object.entries(measured).map(([key, value]) => [key, Math.ceil(value / 1024)]),
  );
  writeFileSync(
    BUDGET_FILE,
    `${JSON.stringify({ $schema: 'Budget in gzipped kB. Regenerate with --update.', maxGzipKb: budget }, null, 2)}\n`,
  );
  console.log(`Baseline written to ${BUDGET_FILE}`);
  console.log(`  entry ${kb(measured.entry)}  total ${kb(measured.total)}  single ${kb(measured.single)}`);
  process.exit(0);
}

if (!existsSync(BUDGET_FILE)) {
  fail(`${BUDGET_FILE} is missing. Create it with: node scripts/check-bundle-size.mjs --update`);
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
const limits = budget?.maxGzipKb ?? {};

/*
 * Sizes are compared in bytes against a kB budget, and a small tolerance keeps
 * a one-byte fluctuation from failing an unrelated pull request.
 */
const TOLERANCE = 1;

const checks = [
  { key: 'entry', label: 'Entry chunks (what every visitor downloads)' },
  { key: 'total', label: 'All JavaScript chunks combined' },
  { key: 'single', label: 'Largest single chunk' },
];

const failures = [];
const lines = [];

for (const { key, label } of checks) {
  const limitKb = limits[key];
  if (typeof limitKb !== 'number') {
    fail(`Bundle budget is missing "${key}". Regenerate with --update.`);
  }
  const limit = limitKb * 1024;
  const actual = measured[key];
  const ok = actual <= limit + TOLERANCE;
  const pct = ((actual / limit) * 100).toFixed(0);
  lines.push(
    `  ${ok ? 'ok  ' : 'OVER'}  ${label.padEnd(46)} ${kb(actual).padStart(9)} / ${kb(limit).padStart(9)}  (${pct}%)`,
  );
  if (!ok) failures.push({ key, actual, limit, over: actual - limit });
}

if (AS_JSON) {
  console.log(
    JSON.stringify({
      ok: failures.length === 0,
      measured: {
        entryBytes: measured.entry,
        totalBytes: measured.total,
        singleBytes: measured.single,
      },
      limits,
      failures,
    }),
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

console.log(`\nBundle size (gzipped)\n${lines.join('\n')}`);

if (failures.length > 0) {
  for (const f of failures) {
    console.error(
      `\n::error::The ${f.key} bundle is ${kb(f.actual)}, ${kb(f.over)} over its ${kb(f.limit)} budget.`,
    );
  }
  console.error(
    [
      '',
      'What to do:',
      '  - Prefer removing or splitting code over raising the budget.',
      '  - Anything reachable from a lazy route should not import into the entry chunk.',
      '  - If the growth is genuinely necessary, run:',
      '        node scripts/check-bundle-size.mjs --update',
      '    and commit scripts/bundle-budget.json so the increase is visible in review.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log('\nbundle size is within budget');
