import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright';

const SUPABASE = 'lkxygnbvkdlwacbcbott.supabase.co';
const uid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const wsId = '11111111-2222-3333-4444-555555555555';

function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
const now = Math.floor(Date.now() / 1000);
const jwt = [
  b64({ alg: 'HS256', typ: 'JWT' }),
  b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, email: 'qa@example.com' }),
  'sig',
].join('.');

const user = {
  id: uid, aud: 'authenticated', role: 'authenticated', email: 'qa@example.com',
  created_at: new Date().toISOString(), email_confirmed_at: new Date().toISOString(),
  user_metadata: { full_name: 'QA Robot' }, app_metadata: { provider: 'email' },
  identities: [],
};
const session = {
  access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
  refresh_token: 'stub-refresh', user,
};
const profile = { id: uid, display_name: 'QA Robot', avatar_url: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const workspace = { id: wsId, name: 'Personal', type: 'personal', owner_id: uid, description: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

const canvasItems = [];
const store = { items: canvasItems };

async function handle(route, request) {
  console.log('  REQ', request.method(), new URL(request.url()).pathname + new URL(request.url()).search.slice(0, 60));
  const url = new URL(request.url());
  const path = url.pathname;
  const shape = (payload) => {
    const kind = Array.isArray(payload) ? 'array' : typeof payload === 'object' && payload !== null ? 'object' : typeof payload;
    if (request.method() === 'GET' && !Array.isArray(payload)) {
      console.log('  NON-ARRAY GET ->', path + url.search, '=>', kind, JSON.stringify(payload).slice(0, 90));
    }
  };
  const reply = (body, status = 200, extra = {}) =>
    (shape(body), route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*', ...extra } }));

  if (request.method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*',
    }});
  }
  if (path === '/auth/v1/signup') return reply({ ...session, user });
  if (path === '/auth/v1/token') return reply(session);
  if (path === '/auth/v1/user') return reply(user);
  if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });

  if (path.startsWith('/rest/v1/rpc/')) {
    const fn = path.split('/').pop();
    if (fn === 'ensure_personal_workspace') return reply({});
    if (fn === 'create_canvas_item') {
      const body = JSON.parse(request.postData() || '{}');
      const item = {
        id: crypto.randomUUID(), workspace_id: wsId, created_by: uid,
        item_type: body.p_item_type, position_x: body.p_position_x, position_y: body.p_position_y,
        width: body.p_width, height: body.p_height, content: body.p_content ?? {},
        bookmark_id: null, media_asset_id: null, z_index: canvasItems.length + 1,
        version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      canvasItems.push(item);
      return reply(item);
    }
    if (fn === 'update_canvas_item') {
      const body = JSON.parse(request.postData() || '{}');
      const item = canvasItems.find((i) => i.id === body.p_item_id);
      if (!item) return reply({ message: 'not found' }, 404);
      Object.assign(item, body.p_patch ?? {}, { version: item.version + 1 });
      return reply(item);
    }
    if (fn === 'move_canvas_items') {
      const body = JSON.parse(request.postData() || '{}');
      const updated = [];
      for (const mv of body.p_moves ?? []) {
        const item = canvasItems.find((i) => i.id === mv.id);
        if (!item) continue;
        item.x = mv.x; item.y = mv.y;
        item.position_x = mv.x; item.position_y = mv.y;
        if (mv.w != null) item.width = mv.w;
        if (mv.h != null) item.height = mv.h;
        item.version += 1;
        updated.push(item);
      }
      return reply(updated);
    }
    if (fn === 'delete_canvas_item') {
      const body = JSON.parse(request.postData() || '{}');
      const i = canvasItems.findIndex((x) => x.id === body.p_item_id);
      if (i >= 0) canvasItems.splice(i, 1);
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    return reply({});
  }

  if (path === '/rest/v1/workspace_members') {
    const wantMembers = url.search.includes('select=*') || url.search.includes('select=user_id');
    if (wantMembers) {
      return reply([{ id: 'member-1', workspace_id: wsId, user_id: uid, role: 'owner', joined_at: new Date().toISOString() }]);
    }
    return reply([{ workspace_id: wsId, role: 'owner' }]);
  }
  if (path === '/rest/v1/workspaces') return reply([workspace]);
  if (path === '/rest/v1/profiles') {
    if (url.search.includes('id=in.')) return reply([profile]);
    return reply(profile);
  }
  if (path === '/rest/v1/canvas_items') return reply(store.items);
  if (path === '/rest/v1/bookmarks' || path === '/rest/v1/media_assets') return reply([]);
  if (path === '/rest/v1/invitations_safe') return reply([]);
  return reply([]);
}

const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter(a => !a.includes('single-process') && !a.includes('no-zygote')),
         '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// seed a valid session so the app boots straight into the workspace
await page.addInitScript(([sess]) => {
  window.localStorage.setItem('scratchpad.auth', JSON.stringify(sess));
}, [session]);

await page.route(`https://${SUPABASE}/**`, handle);
await page.route('**/ws/**', (r) => r.abort());

await page.goto('http://127.0.0.1:4180/Scratchpad/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
console.log('storage keys   :', await page.evaluate(() => Object.keys(localStorage)));
console.log('session parsed :', await page.evaluate(() => {
  const raw = localStorage.getItem('scratchpad.auth');
  if (!raw) return 'none';
  try { const j = JSON.parse(raw); return { hasAccessToken: !!j.access_token, userId: j.user?.id, exp: j.expires_at }; }
  catch (e) { return 'unparseable: ' + String(e); }
}));
await page.screenshot({ path: '/tmp/e2e-1-workspace.png' });
console.log('HASH           :', await page.evaluate(() => location.hash));
console.log('main innerHTML :', (await page.locator('main').innerHTML()).slice(0, 300));
console.log('main box       :', await page.locator('main').boundingBox());
console.log('canvas count   :', await page.locator('canvas').count());
console.log('all testids    :', await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map(e => e.dataset.testid).slice(0,10)));

const step = async (label, fn) => {
  try { await fn(); console.log('OK   ', label); }
  catch (e) { console.log('FAIL ', label, '->', String(e).split('\n')[0].slice(0, 160)); }
};

console.log('url after boot :', page.url());
console.log('canvas mounted :', await page.locator('canvas').count());

await step('choose text tool', async () => {
  await page.getByRole('button', { name: /^text$/i }).first().click({ timeout: 5000 });
});
await step('click canvas to create text', async () => {
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.waitForTimeout(900);
  const dialog = page.locator('[role=dialog]');
  console.log('   editor opened :', await dialog.count());
  if (await dialog.count()) {
    const ta = dialog.locator('textarea, input[type=text]').first();
    if (await ta.count()) await ta.fill('QA NOTE ALPHA');
    await dialog.getByRole('button', { name: /add to canvas|save text|save|add/i }).first().click();
    await page.waitForTimeout(1200);
  }
});
await page.screenshot({ path: '/tmp/e2e-2-texttool.png' });

await step('draw a stroke with brush', async () => {
  await page.getByRole('button', { name: /^brush$/i }).first().click({ timeout: 5000 });
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 300 + i * 12, box.y + 300 + Math.sin(i / 2) * 30);
  await page.mouse.up();
  await page.waitForTimeout(1200);
});
await page.screenshot({ path: '/tmp/e2e-3-brush.png' });

const beforeReload = canvasItems.length;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
const afterReload = canvasItems.length;
await page.screenshot({ path: '/tmp/e2e-4-after-reload.png' });
console.log('--- persistence ---');
console.log('items before reload :', beforeReload);
console.log('items after  reload :', afterReload);
console.log('canvas still mounted:', await page.locator('canvas').count());
const reText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
console.log('note text visible   :', reText.includes('QA NOTE ALPHA'));
console.log('reset: re-seed canvas', canvasItems.length);
console.log('items in stub DB:', canvasItems.length, canvasItems.map((i) => i.item_type));
console.log('page errors    :', errors.slice(0, 6));
await browser.close();
