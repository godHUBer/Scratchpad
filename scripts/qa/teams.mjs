import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright';
import * as app from './stub-supabase.mjs';
const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4180/Scratchpad/';
const b = await pw.launch({ executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('no-zygote')),'--no-sandbox','--disable-dev-shm-usage','--disable-gpu'], headless: true });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(String(e).split('\n')[0]));
const results = [];
const check = (n, ok, d='') => { results.push({n,ok}); console.log(`${ok?'PASS':'FAIL'}  ${n}${d?`  (${d})`:''}`); };
app.store.teams = true;
await page.route('https://lkxygnbvkdlwacbcbott.supabase.co/**', r => app.route(r));
await page.goto(BASE);
await page.evaluate(([s]) => localStorage.setItem('scratchpad.auth', JSON.stringify(s)), [app.session]);
await page.goto(BASE + '?qa=4#/teams', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);

let t = await page.evaluate(() => document.body.innerText);
check('both teams listed', t.includes('Team Alpha') && t.includes('Team Beta'));
check('lands on a team instead of "Pick a team"', !t.includes('Pick a team'), page.url().split('#')[1]);

// click the SECOND team and confirm the panel follows
await page.getByRole('button', { name: /Team Beta/ }).first().click();
await page.waitForTimeout(800);
t = await page.evaluate(() => document.body.innerText);
check('clicking Team Beta opens Beta', t.includes('Team Beta') && !t.includes('Pick a team'));
const heading = await page.locator('h2').first().innerText();
check('detail heading is Team Beta', heading.trim() === 'Team Beta', heading);

// jump to Alpha — the original bug in reverse
await page.getByRole('button', { name: /Team Alpha/ }).first().click();
await page.waitForTimeout(800);
const heading2 = await page.locator('h2').first().innerText();
check('switching back to Alpha works', heading2.trim() === 'Team Alpha', heading2);

// per-card actions menu
await page.getByRole('button', { name: 'Actions for Team Alpha' }).click();
await page.waitForTimeout(400);
const menu = await page.getByRole('menu').innerText();
check('card menu has Disband team', /Disband team/i.test(menu), menu.replace(/\n/g,' | '));
check('card menu has manage members', /Manage members/i.test(menu));

// disband must require typing the name
await page.getByRole('menuitem', { name: /Disband team/i }).click();
await page.waitForTimeout(500);
t = await page.evaluate(() => document.body.innerText);
check('disband dialog explains it is permanent', /no undo/i.test(t));
const confirmBtn = page.getByRole('button', { name: /Disband this team/i });
check('confirm is disabled before typing', await confirmBtn.isDisabled());
await page.locator('#confirm-typed').fill('Team Alpha');
await page.waitForTimeout(200);
check('confirm enables after typing the name', await confirmBtn.isEnabled());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// join link on the teams page
const createLink = page.getByRole('button', { name: /Create join link/i }).first();
check('join link control exists on My teams', await createLink.count() > 0);
if (await createLink.count()) {
  await createLink.click();
  await page.waitForTimeout(900);
  const val = await page.locator('input[aria-label="Join link"], input[id^="link-url-"]').first().inputValue().catch(()=> '');
  check('join link renders a real URL', val.includes('/invite/'), val.slice(0, 60));
}
console.log('page errors:', errs.length, errs.slice(0,3));
await page.screenshot({ path: '/tmp/teams-after.png', fullPage: true });
const failed = results.filter(r=>!r.ok);
console.log(`\n${results.length-failed.length}/${results.length} checks passed`);
await b.close();
process.exit(failed.length ? 1 : 0);
