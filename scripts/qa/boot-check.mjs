import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright';

const exe = await chromium.executablePath();
console.log('chromium:', exe);
const browser = await pw.launch({
  executablePath: exe,
  args: [...chromium.args.filter(a => !a.includes('single-process') && !a.includes('no-zygote')), '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [], errors = [], failed = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => failed.push(`${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

const target = process.argv[2] ?? 'http://127.0.0.1:4173/';
await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);

const rootChildren = await page.locator('#root').evaluate((el) => el.childElementCount);
const bootPanelVisible = await page.locator('#boot-error').isVisible().catch(() => false);
const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400);

console.log('\n=== RESULT ===');
console.log('url             :', target);
console.log('#root children  :', rootChildren, rootChildren > 0 ? '(app mounted)' : '(NOTHING RENDERED)');
console.log('boot panel shown:', bootPanelVisible);
console.log('page errors     :', errors.length, errors.slice(0, 5));
console.log('failed requests :', failed.length, failed.slice(0, 5));
console.log('visible text    :', JSON.stringify(bodyText));
console.log('console (first) :', logs.slice(0, 8));

await page.screenshot({ path: process.argv[3] ?? '/tmp/shot.png', fullPage: false });
await browser.close();
