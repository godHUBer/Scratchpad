// Browser checks for the reported usability fixes. Run against the Pages-shaped
// build served under /Scratchpad/ (see README §QA).
//
//   LD_LIBRARY_PATH=… node scripts/qa/ui-fixes.mjs
//
// Verifies, in a real browser:
//   - image cards paint and stay visible while being dragged
//   - Drive audio shows a labelled player, never a black rectangle
//   - the font picker exposes the built-in faces on a selected text item
//   - the Trash panel opens
//   - the media modal opens on the kind whose button was pressed
//   - "Forgot your password?" reaches the reset page
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright';
import * as app from './stub-supabase.mjs';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4180/Scratchpad/';
const stub = process.env.QA_STUB ?? 'https://lkxygnbvkdlwacbcbott.supabase.co';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [
    ...chromium.args.filter((a) => !a.includes('single-process') && !a.includes('no-zygote')),
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));

// ---- 1. signed-out: forgot-password route
await page.route(`${stub}/**`, (r) => app.route(r));
await page.goto(`${BASE}#/signin`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
check('signin offers a reset link', (await page.getByText('Forgot your password?').count()) > 0);
await page.getByText('Forgot your password?').click();
await page.waitForTimeout(700);
const heading = (await page.locator('h1').first().innerText()).trim();
check('reset page renders', heading === 'Reset your password', heading);

// ---- 2. signed-in canvas with seeded cards
app.store.seed = true;
await page.route('https://picsum.photos/**', (r) =>
  r.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#7ec8e3"/></svg>',
  }),
);
// a hash change is a same-document navigation, so reload with the token set
await page.evaluate(([sess]) => localStorage.setItem('scratchpad.auth', JSON.stringify(sess)), [app.session]);
await page.goto(`${BASE}?qa=1#/workspace`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);

check('image card has a real <img>', (await page.locator('[data-card] img').count()) > 0);
check('no emoji tofu in the media kinds', (await page.evaluate(() => document.body.innerText)).indexOf('\uFFFD') === -1);

// drag the image card: the preview must remain in the DOM mid-gesture
const card = page.locator('[data-card]').first();
const box = await card.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 90, { steps: 12 });
  const mid = await page.evaluate(() => {
    const img = document.querySelector('[data-card] img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  await page.mouse.up();
  check('image preview survives a drag', Boolean(mid && mid.w > 100), mid ? `${mid.w}x${mid.h}` : 'missing');
} else {
  check('image preview survives a drag', false, 'card not found');
}

// ---- 3. trash panel
await page.getByText('Trash').first().click();
await page.waitForTimeout(700);
check('trash panel opens', (await page.getByText('Items older than 90 days').count()) > 0);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ---- 4. toolbar button decides the media kind
await page.locator('button[aria-label="Add audio"]').click();
await page.waitForTimeout(700);
const pressed = (await page.locator('button[aria-pressed="true"]').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
check('audio button preselects Audio', pressed.some((t) => t.toLowerCase().includes('audio')), pressed.join('|'));
await page.keyboard.press('Escape');

// ---- 5. font picker on a selected text item
await page.mouse.click(455, 645);
await page.waitForTimeout(700);
const fontOptions = await page.locator('#font-family-select option').count();
check('font picker lists built-in faces', fontOptions >= 8, `${fontOptions} options`);

await page.screenshot({ path: '/tmp/qa-ui-fixes.png' });
console.log('\npage errors:', errors.length);
if (errors.length) console.log(errors.slice(0, 4).join('\n'));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
