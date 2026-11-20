// Reusable Supabase stub for local browser QA.
//
// The sandbox (and many CI runners) cannot reach *.supabase.co, so this module
// answers the PostgREST/Auth/Realtime requests the app makes with in-memory
// data. It is a test double for the NETWORK ONLY: every line of app code under
// test is the real code.
export const SUPABASE = 'lkxygnbvkdlwacbcbott.supabase.co';
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

/**
 * Seed rows. `?seed=cards` gives the QA harness something to drag, so the
 * image/audio card fixes can be checked in a real browser instead of only in
 * jsdom (which cannot paint a canvas).
 */
const seededItems = [
  { id: 'c0000000-0000-4000-8000-000000000001', item_type: 'image', position_x: -320, position_y: -140,
    width: 320, height: 240, content: { caption: 'cat.png' }, media_asset_id: 'a0000000-0000-4000-8000-000000000001' },
  { id: 'c0000000-0000-4000-8000-000000000002', item_type: 'audio', position_x: 40, position_y: -140,
    width: 300, height: 132, content: { caption: 'memo.mp3' }, media_asset_id: 'a0000000-0000-4000-8000-000000000002' },
  { id: 'c0000000-0000-4000-8000-000000000003', item_type: 'text', position_x: -320, position_y: 140,
    width: 260, height: 90, content: { text: 'Drag me by my text', fontSize: 20 } },
].map((row) => ({
  workspace_id: wsId, bookmark_id: null, created_by: uid,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, ...row,
}));

const seededMedia = [
  { id: 'a0000000-0000-4000-8000-000000000001', original_url: 'https://picsum.photos/640/480',
    drive_file_id: null, file_name: 'cat.png', file_type: 'image', mime_type: 'image/png' },
  { id: 'a0000000-0000-4000-8000-000000000002', original_url: 'https://drive.google.com/file/d/1AbCdEfGhIjKl/view',
    drive_file_id: '1AbCdEfGhIjKl', file_name: 'memo.mp3', file_type: 'audio', mime_type: 'audio/mpeg' },
].map((row) => ({ workspace_id: wsId, uploaded_by: uid, created_at: new Date().toISOString(), ...row }));

const retentionPolicy = { cold_after_days: 60, trash_after_days: 90, purge_after_days: 100, enabled: false, updated_at: new Date().toISOString() };

const canvasItems = [];
const store = { items: canvasItems, seed: false, retention: retentionPolicy, trash: [] };

/** Playwright route handler: (route) => void */
export async function handle(route) {
  const request = route.request();
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
    // retention pipeline (migration 0010) — ships paused
    if (fn === 'get_retention_policy' || fn === 'set_retention_enabled') {
      const body = JSON.parse(request.postData() || '{}');
      if (body.p_enabled !== undefined) store.retention = { ...retentionPolicy, enabled: body.p_enabled };
      return reply(store.retention);
    }
    if (fn === 'list_trashed_items') return reply(store.trash);
    if (fn === 'restore_canvas_item') {
      const body = JSON.parse(request.postData() || '{}');
      const idx = store.trash.findIndex((i) => i.id === body.p_item_id);
      const [row] = idx >= 0 ? store.trash.splice(idx, 1) : [];
      return reply(row ?? null);
    }
    if (fn === 'delete_workspace' || fn === 'delete_team') return reply(null);
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
  if (path === '/rest/v1/canvas_items') return reply(store.seed ? seededItems : store.items);
  if (path === '/rest/v1/bookmarks') return reply([]);
  if (path === '/rest/v1/media_assets') return reply(store.seed ? seededMedia : []);
  if (path === '/rest/v1/invitations_safe') return reply([]);
  return reply([]);
}


export { handle as route, session, canvasItems, store };
