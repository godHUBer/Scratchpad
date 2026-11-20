-- Assertions for the admin console RPCs.
--
-- Every check is written as `do $$ ... $$` that RAISEs on failure, because the
-- runner treats any error as a failed test file. The point is to CALL every RPC
-- at least once: a function body with a bad FROM clause compiles fine and only
-- explodes when invoked, which is exactly the bug this file was written for.

-- ---------------------------------------------------------------------------
-- fixtures: one ordinary user, one admin key
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, last_sign_in_at)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com', now() - interval '3 days')
on conflict (id) do nothing;

insert into public.profiles (id, display_name, last_seen_at)
values ('11111111-1111-1111-1111-111111111111', 'Alice', null)
on conflict (id) do nothing;

select public.admin_set_key('correct-horse-battery-staple');

do $$
declare
  v_token text;
  v_n     int;
begin
  -- a wrong key must not mint a session
  select token into v_token from public.admin_login('definitely-not-the-key');
  if v_token is not null then
    raise exception 'a wrong admin key produced a token';
  end if;
  if (select reason from public.admin_login('definitely-not-the-key')) is distinct from 'bad_key' then
    raise exception 'a wrong admin key did not report bad_key';
  end if;

  -- the right key must
  select token into v_token from public.admin_login('correct-horse-battery-staple');
  if v_token is null or length(v_token) <> 64 then
    raise exception 'admin_login did not return a 64-char token (got %)', coalesce(length(v_token), 0);
  end if;

  -- and every list RPC must actually execute
  select count(*) into v_n from public.admin_list_users(v_token);
  if v_n < 1 then
    raise exception 'admin_list_users returned no rows for a populated project';
  end if;
  if (select email from public.admin_list_users(v_token) limit 1) <> 'alice@example.com' then
    raise exception 'admin_list_users returned the wrong email';
  end if;

  -- last seen falls back to GoTrue timestamps when no heartbeat exists yet
  if (select last_seen_at from public.admin_list_users(v_token) limit 1) is null then
    raise exception 'last_seen_at is null even though the account signed in';
  end if;

  select count(*) into v_n from public.admin_list_workspaces(v_token);
  select count(*) into v_n from public.admin_list_audit(v_token, 10);
  if v_n < 1 then
    raise exception 'admin_list_audit did not record the login';
  end if;

  -- an unknown session must be rejected, not silently allowed
  begin
    perform public.admin_require_session('not-a-real-token');
    raise exception 'admin_require_session accepted a bogus token';
  exception
    when sqlstate '28000' then null; -- expected
  end;
end $$;

-- ---------------------------------------------------------------------------
-- heartbeat: must create the row when the trigger never ran
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'bob@example.com')
on conflict (id) do nothing;

do $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);
  perform public.heartbeat();

  if not exists (
    select 1 from public.profiles
     where id = '22222222-2222-2222-2222-222222222222' and last_seen_at is not null
  ) then
    raise exception 'heartbeat() did not stamp a missing profile row (it must upsert)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- the admin tables must never be reachable by a client role
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.admin_config', 'SELECT')
  or has_table_privilege('authenticated', 'public.admin_config', 'SELECT') then
    raise exception 'admin_config is readable by a client role';
  end if;
  if has_function_privilege('anon', 'public.admin_set_key(text)', 'EXECUTE') then
    raise exception 'anon can rotate the admin key';
  end if;
  if not has_function_privilege('authenticated', 'public.heartbeat()', 'EXECUTE') then
    raise exception 'authenticated cannot call heartbeat()';
  end if;
end $$;
