// Reproduces the user's scenario in a real browser: hide the tab, come back,
// and check that no "cannot add `presence` callbacks ... after `subscribe()`"
// error appears.
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright';
import * as app from './stub-supabase.mjs';

const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter(a => !a.includes('single-process') && !a.includes('no-zygote')),
         '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
const presenceErrors = [];
page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error') errors.push(text.split('\n')[0]);
  if (text.includes('cannot add') && text.includes('callbacks')) presenceErrors.push(text);
});

await page.addInitScript(([sess]) => localStorage.setItem('scratchpad.auth', JSON.stringify(sess)), [app.session]);
await page.route('https://lkxygnbvkdlwacbcbott.supabase.co/**', (r) => app.route(r));
await page.goto('http://127.0.0.1:4180/Scratchpad/#/workspace', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
console.log('loaded, presence errors so far:', presenceErrors.length);

for (let i = 1; i <= 4; i += 1) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(700);
  console.log(`cycle ${i}: presenceErrors=${presenceErrors.length} totalErrors=${errors.length}`);
}

await page.screenshot({ path: '/tmp/visibility.png' });
console.log('\n=== RESULT ===');
console.log('presence callback errors :', presenceErrors.length);
console.log('page/console errors      :', errors.length);
if (errors.length) console.log(errors.slice(0, 6));
await browser.close();
process.exit(presenceErrors.length === 0 ? 0 : 1);
