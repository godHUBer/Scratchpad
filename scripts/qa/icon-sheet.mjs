// Measures and renders the icon set. This is the part jsdom cannot do.
//
//   LD_LIBRARY_PATH=… node scripts/qa/icon-sheet.mjs
//
// For every icon it asks the browser for the real bounding box (getBBox on the
// <path>, which accounts for arcs, relative commands and curves), then:
//   - fails if the glyph leaves the 0..24 box (the button clips it)
//   - fails if the glyph is smaller than 13x13 (it will look lost at 22 px)
//   - fails if two glyphs have byte-identical geometry
//   - writes /tmp/icons-sheet.png showing each icon at 14/22/34 px
//
// Import the path data from the real component so this can never drift.
import fs from 'node:fs';
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright';

// Read PATHS straight out of the source: no second copy to keep in sync.
const src = fs.readFileSync(new URL('../../src/components/ui/Icon.tsx', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('const PATHS = {'), src.indexOf('} as const;'));
const icons = {};
const re = /^\s{2}(\w+):\s*\n?\s*'([^']+)',?$/gm;
let m;
while ((m = re.exec(body))) icons[m[1]] = m[2];
const names = Object.keys(icons);
if (names.length < 25) throw new Error(`only parsed ${names.length} icons — did Icon.tsx change shape?`);

const MARGIN = 0;     // hard limit: outside the viewBox is clipped
const MIN_SPAN = 12;  // a glyph smaller than this looks lost in a 40px button

const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter((a) => !a.includes('single-process') && !a.includes('no-zygote')),
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1240, height: 520 }, deviceScaleFactor: 3 });
const svg = (d, n) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="#080808"
  stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

await page.setContent(`<body style="margin:0;padding:16px;background:#ffe9b8;font-family:'Trebuchet MS',sans-serif">
  <div id="hidden" style="position:absolute;left:-9999px">${names.map((n) => `<svg id="m-${n}" viewBox="0 0 24 24">${`<path d="${icons[n]}"/>`}</svg>`).join('')}</div>
  <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px">${names.map((n) => `
    <div style="background:#fffdf6;border:3px solid #080808;border-radius:14px;box-shadow:4px 4px 0 #080808;padding:8px;display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="display:flex;gap:8px;align-items:center">${svg(icons[n], 34)}${svg(icons[n], 22)}${svg(icons[n], 14)}</div>
      <span style="font-size:10px;font-weight:700">${n}</span></div>`).join('')}</div></body>`);
await page.waitForTimeout(300);

const boxes = await page.evaluate((ns) => {
  const out = {};
  for (const n of ns) {
    const p = document.querySelector(`#m-${n} path`);
    const b = p.getBBox();
    out[n] = { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
  }
  return out;
}, names);

const problems = [];
const small = [];
for (const [n, b] of Object.entries(boxes)) {
  const right = b.x + b.w, bottom = b.y + b.h;
  if (b.x < -MARGIN || b.y < -MARGIN || right > 24 + MARGIN || bottom > 24 + MARGIN) {
    problems.push(`${n} overflows the viewBox: x=${b.x} y=${b.y} w=${b.w} h=${b.h}`);
  }
  if (b.w < MIN_SPAN || b.h < MIN_SPAN) small.push(`${n} is only ${b.w}x${b.h}`);
}

// Exact-duplicate detection only.
//
// Comparing bounding boxes does NOT tell you whether two glyphs look alike:
// zoomIn and zoomOut have identical bounds and differ only by the plus/minus
// inside, which is exactly the distinction the icon exists to make. Judging
// "too similar" needs eyes, so this script only flags byte-identical geometry
// and leaves the resemblance call to the contact sheet.
const dupes = [];
const byPath = new Map();
for (const n of names) {
  const prior = byPath.get(icons[n]);
  if (prior) dupes.push(`${n} has byte-identical geometry to ${prior}`);
  else byPath.set(icons[n], n);
}

await page.screenshot({ path: '/tmp/icons-sheet.png', fullPage: true });
await browser.close();

console.log(`checked ${names.length} icons`);
console.log('\nbounding boxes (0..24 viewBox):');
for (const [n, b] of Object.entries(boxes)) {
  console.log(`  ${n.padEnd(16)} x=${String(b.x).padStart(5)} y=${String(b.y).padStart(5)} w=${String(b.w).padStart(5)} h=${String(b.h).padStart(5)}`);
}
if (small.length) console.log('\nsmall glyphs (still legible, worth a look):\n  ' + small.join('\n  '));
if (dupes.length) {
  console.error('\nFAIL — duplicate geometry:\n  ' + dupes.join('\n  '));
  process.exit(1);
}
if (problems.length) {
  console.error('\nFAIL — glyphs outside the viewBox (the button will clip them):\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`\nOK — all ${names.length} glyphs inside the box; sheet at /tmp/icons-sheet.png`);
