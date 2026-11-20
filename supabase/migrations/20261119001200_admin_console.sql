-- Scratchpad 0012: server-side admin console.
--
-- Why the admin key is NOT in the client
--
-- The original request was a master key hard-coded in the admin page. That key
-- would ship inside the JavaScript bundle served from a public GitHub Pages
-- site: anyone could open the bundle, read the key, and then delete any account,
-- read every email address and set any password. Rotating it afterwards would
-- not help, because the old key stays in git history and in every cached copy.
--
-- So the key lives here instead. It is stored as a bcrypt hash in a table no
-- client can read, and it is compared inside Postgres. The browser only ever
-- sends a candidate key to `admin_login`, which is rate limited. What the client
-- keeps afterwards is a random, revocable, expiring session token — not the key.
--
-- Threat model that remains: `admin_login` is callable by `anon`, because the
-- admin page is reached before signing in. That is why every failed attempt is
-- recorded and the function refuses to work while a burst of recent failures
-- exists. bcrypt (cost 10, ~50ms) also makes offline guessing of a short key
-- expensive.

-- ---------------------------------------------------------------------------
-- 1. Storage
-- ---------------------------------------------------------------------------

-- Exactly one row. Holds only a bcrypt hash; the plaintext key exists nowhere.
create table if not exists public.admin_config (
  id           boolean primary key default true check (id),
  key_hash     text not null,
  key_hint     text not null default '••••',   -- last 4 chars, for the UI
  created_at   timestamptz not null default now(),
  rotated_at   timestamptz not null default now()
);

-- Admin sessions. The token is random and revocable; only its hash is stored.
create table if not exists public.admin_sessions (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at   timestamptz
);
create index if not exists admin_sessions_hash_idx on public.admin_sessions (token_hash);

-- Every privileged action. Without this, a misused admin session leaves no trace.
create table if not exists public.admin_audit_log (
  id          bigserial primary key,
  action      text not null,
  target_user uuid,
  target_email text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

-- Failed logins, so the key cannot simply be brute forced.
create table if not exists public.admin_login_attempts (
  id         bigserial primary key,
  succeeded  boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_login_attempts_time_idx on public.admin_login_attempts (created_at desc);

-- No client may touch any of these tables directly. Everything goes through the
-- SECURITY DEFINER functions below, which check the session first.
revoke all on public.admin_config from anon, authenticated;
revoke all on public.admin_sessions from anon, authenticated;
revoke all on public.admin_audit_log from anon, authenticated;
revoke all on public.admin_login_attempts from anon, authenticated;

alter table public.admin_config         enable row level security;
alter table public.admin_sessions       enable row level security;
alter table public.admin_audit_log      enable row level security;
alter table public.admin_login_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Last-seen heartbeat (drives the online/offline dot)
--
-- Presence in this app is Realtime-only and deliberately ephemeral: nothing is
-- stored, so a user who closes the tab vanishes instantly. The admin console
-- needs history, so the app writes a coarse heartbeat instead.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.heartbeat()
returns void language sql security definer
set search_path = pg_catalog, public
as $$
  -- Upsert, not update: a missing profile row would make a plain UPDATE match
  -- nothing and still report success, leaving the user permanently "offline".
  insert into public.profiles (id, last_seen_at)
  values (auth.uid(), now())
  on conflict (id) do update set last_seen_at = now();
$$;

-- ---------------------------------------------------------------------------
-- 3. Key management (service role only — never exposed to the app)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_key(p_key text)
returns text language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_hint text;
begin
  if p_key is null or char_length(p_key) < 16 then
    raise exception 'admin key must be at least 16 characters' using errcode = '22023';
  end if;

  v_hint := '••••' || right(p_key, 4);

  insert into public.admin_config (id, key_hash, key_hint, rotated_at)
  values (true, extensions.crypt(p_key, extensions.gen_salt('bf', 10)), v_hint, now())
  on conflict (id) do update
    set key_hash = excluded.key_hash,
        key_hint = excluded.key_hint,
        rotated_at = now();

  -- Rotating the key kills every live admin session. A leaked key that is
  -- changed must not leave old sessions working.
  update public.admin_sessions set revoked_at = now() where revoked_at is null;

  insert into public.admin_audit_log (action, detail) values ('key_set', jsonb_build_object('hint', v_hint));
  return v_hint;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Login / logout
-- ---------------------------------------------------------------------------
-- Returns one row on success. On failure it returns NO rows plus a `reason`,
-- instead of raising: a raised exception would roll back the very
-- admin_login_attempts insert that the brute-force lockout depends on.
drop function if exists public.admin_login(text);

create or replace function public.admin_login(p_key text)
returns table (token text, expires_at timestamptz, reason text)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_hash text;
  v_recent_failures int;
  v_token text;
  v_expires timestamptz;
begin
  -- Brute-force guard: 5 failures in 15 minutes locks the endpoint.
  select count(*) into v_recent_failures
    from public.admin_login_attempts a
   where not a.succeeded and a.created_at > now() - interval '15 minutes';

  if v_recent_failures >= 5 then
    return query select null::text, null::timestamptz, 'locked'::text;
    return;
  end if;

  select key_hash into v_hash from public.admin_config where id;
  if v_hash is null then
    return query select null::text, null::timestamptz, 'unconfigured'::text;
    return;
  end if;

  if p_key is null or extensions.crypt(p_key, v_hash) <> v_hash then
    insert into public.admin_login_attempts (succeeded) values (false);
    return query select null::text, null::timestamptz, 'bad_key'::text;
    return;
  end if;

  insert into public.admin_login_attempts (succeeded) values (true);

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + interval '8 hours';

  insert into public.admin_sessions (token_hash, expires_at)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires);

  insert into public.admin_audit_log (action) values ('login');

  return query select v_token, v_expires, null::text;
end;
$$;

create or replace function public.admin_logout(p_token text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  update public.admin_sessions
     set revoked_at = now()
   where token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex')
     and revoked_at is null;
end;
$$;

-- Internal: every other function calls this first.
create or replace function public.admin_require_session(p_token text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_id uuid;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'admin session required' using errcode = '28000';
  end if;

  update public.admin_sessions
     set last_used_at = now()
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and revoked_at is null
     and expires_at > now()
  returning id into v_id;

  if v_id is null then
    raise exception 'admin session expired or revoked' using errcode = '28000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Read: who is registered, and are they here now
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users(p_token text)
returns table (
  user_id        uuid,
  email          text,
  display_name   text,
  created_at     timestamptz,
  last_sign_in_at timestamptz,
  last_seen_at   timestamptz,
  is_online      boolean,
  workspace_count bigint,
  item_count     bigint
)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  perform public.admin_require_session(p_token);

  return query
  select
    u.id,
    u.email::text,
    coalesce(p.display_name, '(no profile)'),
    u.created_at,
    u.last_sign_in_at,
    v.derived_seen,
    -- "online" = heartbeat inside the last 2 minutes. The app sends one every
    -- 60s while a tab is open, so this survives one missed beat.
    coalesce(v.derived_seen > now() - interval '2 minutes', false),
    (select count(*) from public.workspace_members m where m.user_id = u.id),
    (select count(*) from public.canvas_items c where c.created_by = u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  cross join lateral (
    -- Fall back to GoTrue's own timestamps, so an account never reads "never"
    -- merely because it signed in before heartbeats existed.
    select coalesce(
             p.last_seen_at,
             u.last_sign_in_at,
             (select max(s.updated_at)::timestamptz from auth.sessions s where s.user_id = u.id)
           ) as derived_seen
  ) v
  order by u.created_at;
end;
$$;

create or replace function public.admin_list_workspaces(p_token text)
returns table (
  workspace_id uuid,
  name         text,
  type         text,
  owner_email  text,
  member_count bigint,
  item_count   bigint,
  created_at   timestamptz
)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  perform public.admin_require_session(p_token);

  return query
  select w.id, w.name, w.type::text,
         coalesce(u.email::text, '(deleted)'),
         (select count(*) from public.workspace_members m where m.workspace_id = w.id),
         (select count(*) from public.canvas_items c where c.workspace_id = w.id),
         w.created_at
  from public.workspaces w
  left join auth.users u on u.id = w.owner_id
  order by w.created_at;
end;
$$;

create or replace function public.admin_list_audit(p_token text, p_limit integer default 100)
returns table (id bigint, action text, target_email text, detail jsonb, created_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  perform public.admin_require_session(p_token);
  return query
  select a.id, a.action, a.target_email, a.detail, a.created_at
  from public.admin_audit_log a
  order by a.id desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Mutations
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_user(p_token text, p_user_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_email text;
begin
  perform public.admin_require_session(p_token);

  select email::text into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  -- Owned workspaces cascade to members, items, bookmarks, media and invites.
  delete from auth.users where id = p_user_id;

  insert into public.admin_audit_log (action, target_user, target_email)
  values ('delete_user', p_user_id, v_email);
end;
$$;

create or replace function public.admin_set_password(p_token text, p_user_id uuid, p_new_password text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_email text;
begin
  perform public.admin_require_session(p_token);

  if p_new_password is null or char_length(p_new_password) < 8 then
    raise exception 'password must be at least 8 characters' using errcode = '22023';
  end if;

  select email::text into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user_id;

  -- Forcing a password reset must evict anyone holding the old one.
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;

  insert into public.admin_audit_log (action, target_user, target_email)
  values ('set_password', p_user_id, v_email);
end;
$$;

create or replace function public.admin_delete_workspace(p_token text, p_workspace_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_name text;
begin
  perform public.admin_require_session(p_token);

  select name into v_name from public.workspaces where id = p_workspace_id;
  if v_name is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;

  delete from public.workspaces where id = p_workspace_id;

  insert into public.admin_audit_log (action, detail)
  values ('delete_workspace', jsonb_build_object('workspace_id', p_workspace_id, 'name', v_name));
end;
$$;

create or replace function public.admin_revoke_sessions(p_token text)
returns integer language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_count int;
begin
  perform public.admin_require_session(p_token);
  update public.admin_sessions s
     set revoked_at = now()
   where s.revoked_at is null
     and s.expires_at > now();
  get diagnostics v_count = row_count;
  insert into public.admin_audit_log (action, detail) values ('revoke_admin_sessions', jsonb_build_object('revoked', v_count));
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
--
-- `admin_set_key` is deliberately NOT granted to anyone: the service role and
-- postgres own the function and can still call it, but there is no path from
-- the app. The key can only be set or rotated by an operator.
-- ---------------------------------------------------------------------------
revoke all on function public.admin_set_key(text) from public, anon, authenticated;

revoke all on function public.heartbeat() from public, anon;
grant execute on function public.heartbeat() to authenticated;

-- admin_login/logout are reachable before sign-in (that is the point of a
-- separate admin page) but are rate limited and bcrypt-guarded.
revoke all on function public.admin_login(text) from public;
revoke all on function public.admin_logout(text) from public;
grant execute on function public.admin_login(text) to anon, authenticated;
grant execute on function public.admin_logout(text) to anon, authenticated;

revoke all on function public.admin_require_session(text) from public, anon, authenticated;

revoke all on function public.admin_list_users(text) from public, anon;
revoke all on function public.admin_list_workspaces(text) from public, anon;
revoke all on function public.admin_list_audit(text, integer) from public, anon;
revoke all on function public.admin_delete_user(text, uuid) from public, anon;
revoke all on function public.admin_set_password(text, uuid, text) from public, anon;
revoke all on function public.admin_delete_workspace(text, uuid) from public, anon;
revoke all on function public.admin_revoke_sessions(text) from public, anon;

grant execute on function public.admin_list_users(text) to anon, authenticated;
grant execute on function public.admin_list_workspaces(text) to anon, authenticated;
grant execute on function public.admin_list_audit(text, integer) to anon, authenticated;
grant execute on function public.admin_delete_user(text, uuid) to anon, authenticated;
grant execute on function public.admin_set_password(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_delete_workspace(text, uuid) to anon, authenticated;
grant execute on function public.admin_revoke_sessions(text) to anon, authenticated;
