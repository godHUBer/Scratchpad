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

const canvasItems = [];
const store = { items: canvasItems };

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


export { handle as route, session, canvasItems };
