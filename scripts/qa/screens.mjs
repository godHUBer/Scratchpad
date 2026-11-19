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
page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
await page.addInitScript(([s]) => localStorage.setItem('scratchpad.auth', JSON.stringify(s)), [app.session]);
await page.route('https://lkxygnbvkdlwacbcbott.supabase.co/**', (r) => app.route(r));
await page.goto('http://127.0.0.1:4180/Scratchpad/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const tofu = async () => page.evaluate(() => {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '16px "Trebuchet MS", sans-serif';
  const notdef = ctx.measureText('\uFFFF').width;
  const hits = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.textContent ?? '';
    for (const ch of t) {
      const cp = ch.codePointAt(0);
      if (!cp || cp < 0x2000) continue;
      const w = ctx.measureText(ch).width;
      if (w === notdef || w === 0) { hits.push(`${ch} U+${cp.toString(16)}`); }
    }
  }
  return [...new Set(hits)];
});

const shots = [
  ['workspace', '#/workspace'],
  ['teams', '#/teams'],
  ['invitations', '#/invitations'],
  ['bookmarks', '#/bookmarks'],
  ['settings', '#/settings'],
];
for (const [name, hash] of shots) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(1600);
  const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 90);
  const t = await tofu();
  console.log(`${name.padEnd(12)} main:${text.length > 0 ? 'OK ' : 'EMPTY'} tofu:${t.length ? t.join(',') : 'none'}`);
  console.log(`             text: ${JSON.stringify(text)}`);
  await page.screenshot({ path: `/tmp/screen-${name}.png` });
}
// hamburger menu
await page.evaluate(() => { location.hash = '#/workspace'; });
await page.waitForTimeout(800);
await page.getByRole('button', { name: /main navigation menu/i }).click();
await page.waitForTimeout(700);
console.log('menu        tofu:', (await tofu()).join(',') || 'none');
await page.screenshot({ path: '/tmp/screen-menu.png' });
console.log('page errors :', errors.slice(0, 4));
await browser.close();
