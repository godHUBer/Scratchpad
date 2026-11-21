-- Assertions for per-workspace retention (migration 0013).
--
-- The bug this file exists for: 0010 put the on/off switch in a single global
-- row and guarded `set_retention_enabled` with nothing but "is somebody signed
-- in?". Any authenticated stranger could therefore arm a nightly job that
-- trashed and purged rows in every other tenant's workspace.
--
-- These checks are written so that reverting 0013 turns them red:
--
--   * `authenticated` must not be able to execute the old global toggle,
--   * an owner's opt-in must not imply anything for a different workspace,
--   * the sweep must leave a non-opted-in workspace completely untouched --
--     including rows whose purge date has already passed.

-- ---------------------------------------------------------------------------
-- fixtures: two workspace owners, one viewer, one stranger
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'owner-b@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'viewer-c@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'stranger-d@example.com')
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Owner A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Owner B'),
  ('cccccccc-0000-0000-0000-000000000003', 'Viewer C'),
  ('dddddddd-0000-0000-0000-000000000004', 'Stranger D')
on conflict (id) do nothing;

-- Fixed ids so the assertions can talk about specific workspaces.
insert into public.workspaces (id, name, type, owner_id) values
  ('11111111-1111-1111-1111-111111111111', 'Opted out', 'team', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'Opted in',  'team', 'bbbbbbbb-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000003', 'viewer'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000002', 'owner')
on conflict (workspace_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. New workspaces are opted out by default
-- ---------------------------------------------------------------------------
do $$
begin
  if (select retention_enabled from public.workspaces
       where id = '11111111-1111-1111-1111-111111111111') is not false then
    raise exception 'a workspace defaulted to retention_enabled <> false';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The old global toggle is no longer reachable by a client role
--    (this is the vulnerability itself, so it is the first thing to pin down)
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.set_retention_enabled(boolean)', 'EXECUTE') then
    raise exception 'authenticated can still call set_retention_enabled -- the global toggle is still exposed';
  end if;
  if has_function_privilege('anon', 'public.set_retention_enabled(boolean)', 'EXECUTE') then
    raise exception 'anon can call set_retention_enabled';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Only the owner of that workspace may arm it
-- ---------------------------------------------------------------------------
do $$
begin
  -- the owner of the *other* workspace is still a stranger here
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'bbbbbbbb-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
  begin
    perform public.set_workspace_retention('11111111-1111-1111-1111-111111111111', true);
    raise exception 'a different workspace owner was allowed to arm auto-cleanup';
  exception when sqlstate '42501' then null; -- expected
  end;

  -- a viewer cannot arm the job that will eventually delete their workspace
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'cccccccc-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
  begin
    perform public.set_workspace_retention('11111111-1111-1111-1111-111111111111', true);
    raise exception 'a viewer was allowed to arm auto-cleanup';
  exception when sqlstate '42501' then null; -- expected
  end;

  -- a non-member cannot even read the state
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'dddddddd-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
  begin
    perform count(*) from public.get_workspace_retention('11111111-1111-1111-1111-111111111111');
    raise exception 'a stranger could read a workspace retention policy';
  exception when sqlstate '42501' then null; -- expected
  end;

  -- signed out entirely
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.set_workspace_retention('11111111-1111-1111-1111-111111111111', true);
    raise exception 'an unauthenticated caller armed auto-cleanup';
  exception when sqlstate '28000' then null; -- expected
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The real owner can, and the state is reported back
-- ---------------------------------------------------------------------------
do $$
declare
  v_can_manage boolean;
  v_enabled boolean;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'bbbbbbbb-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
  perform public.set_workspace_retention('22222222-2222-2222-2222-222222222222', true);

  select can_manage, enabled into v_can_manage, v_enabled
    from public.get_workspace_retention('22222222-2222-2222-2222-222222222222');
  if not v_enabled then
    raise exception 'the owner armed auto-cleanup but it still reads as disabled';
  end if;
  if not v_can_manage then
    raise exception 'the owner is not reported as able to manage auto-cleanup';
  end if;

  -- ...and the viewer sees the same state but is told they cannot change it
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'cccccccc-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
  if (select can_manage from public.get_workspace_retention('11111111-1111-1111-1111-111111111111')) then
    raise exception 'a viewer is reported as able to manage auto-cleanup';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The sweep honours the per-workspace switch
--    This is the end-to-end check that 0010 fails: backdate a live row in each
--    workspace, run the sweep, and prove only the opted-in one lost its rows.
-- ---------------------------------------------------------------------------
insert into public.canvas_items (id, workspace_id, item_type, content, created_by, updated_at) values
  ('aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'note', '{"text":"old, opted out"}', 'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '200 days'),
  ('bbbb1111-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'note', '{"text":"old, opted in"}', 'bbbbbbbb-0000-0000-0000-000000000002', now() - interval '200 days')
on conflict (id) do nothing;

-- A row already in the trash whose purge date has long passed. It sits in the
-- opted-out workspace, so the purge step must not delete it either.
insert into public.canvas_items (id, workspace_id, item_type, content, created_by,
                                 updated_at, deleted_at, purge_after) values
  ('aaaa2222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'note', '{"text":"ripe but opted out"}', 'aaaaaaaa-0000-0000-0000-000000000001',
   now() - interval '300 days', now() - interval '120 days', now() - interval '10 days')
on conflict (id) do nothing;

-- Operator master switch must be on for the sweep to do anything at all.
do $$
begin
  if not (select enabled from public.retention_policy where id) then
    raise exception 'the operator master switch is off; migration 0013 should have turned it on';
  end if;
end $$;

do $$
declare
  v_trash integer;
  v_purge integer;
begin
  select moved_to_trash, purged into v_trash, v_purge from public.run_retention_sweep();

  -- The opted-out workspace keeps its live row...
  if not exists (select 1 from public.canvas_items
                  where id = 'aaaa1111-0000-0000-0000-000000000001' and deleted_at is null) then
    raise exception 'the sweep trashed a live row in a workspace that never opted in';
  end if;

  -- ...and its already-past-purge-date row, which is the worst version of the bug.
  if not exists (select 1 from public.canvas_items
                  where id = 'aaaa2222-0000-0000-0000-000000000002') then
    raise exception 'the sweep purged a row from a workspace that never opted in';
  end if;

  -- The opted-in workspace lost its stale live row to the trash.
  if not exists (select 1 from public.canvas_items
                  where id = 'bbbb1111-0000-0000-0000-000000000001' and deleted_at is not null) then
    raise exception 'the sweep ignored an opted-in workspace (its old row is still live)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Switching it off stops the purge, not just the arrival of new trash
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'bbbbbbbb-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
  perform public.set_workspace_retention('22222222-2222-2222-2222-222222222222', false);
end $$;

update public.canvas_items
   set purge_after = now() - interval '1 day'
 where id = 'bbbb1111-0000-0000-0000-000000000001';

do $$
begin
  perform public.run_retention_sweep();
  if not exists (select 1 from public.canvas_items where id = 'bbbb1111-0000-0000-0000-000000000001') then
    raise exception 'a workspace that opted out was still purged';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Admin control of the master switch requires a session
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform public.admin_set_retention('not-a-real-token', false);
    raise exception 'admin_set_retention accepted a bogus session';
  exception when sqlstate '28000' then null; -- expected
  end;

  if has_function_privilege('authenticated', 'public.admin_set_retention(text, boolean)', 'EXECUTE') is not true then
    raise exception 'admin_set_retention is not callable (the admin page is reached before sign-in)';
  end if;
end $$;
