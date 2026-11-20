import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright';
const app = await import('./stub-supabase.mjs');

const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter(a => !a.includes('single-process') && !a.includes('no-zygote')),
         '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(([s]) => localStorage.setItem('scratchpad.auth', JSON.stringify(s)), [app.session]);
await page.route('https://lkxygnbvkdlwacbcbott.supabase.co/**', (r) => app.route(r));
await page.goto('http://127.0.0.1:4180/Scratchpad/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// where is the canvas and what sits on top of its centre?
const info = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const top = document.elementFromPoint(cx, cy);
  const chain = [];
  let el = top;
  while (el && chain.length < 5) { chain.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`); el = el.parentElement; }
  return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, centre: { cx, cy }, topElement: chain };
});
console.log('canvas rect   :', info.rect);
console.log('topmost at centre:', info.topElement);

// press the Text tool, then look at the pointer-events state and click
await page.getByRole('button', { name: /^text$/i }).first().click();
await page.waitForTimeout(300);
console.log('toolbar text tool pressed:', await page.getByRole('button', { name: /^text$/i }).first().getAttribute('aria-pressed'));
const overlay = await page.evaluate(() => {
  const els = [...document.querySelectorAll('div')].filter(d => d.className.includes('pointer-events-none absolute inset-0'));
  return els.length;
});
console.log('overlay layers :', overlay);
await page.mouse.click(info.centre.cx, info.centre.cy);
await page.waitForTimeout(1200);
console.log('dialog count after click:', await page.locator('[role=dialog]').count());
console.log('dialog titles          :', await page.locator('[role=dialog] h2').allInnerTexts());
await page.screenshot({ path: '/tmp/probe-text.png' });
await browser.close();
