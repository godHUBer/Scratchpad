-- Assertions for truthful write conflicts (migration 0014).
--
-- The bug: `update_canvas_item` returned the current row on a stale write, and
-- the client decided whether a conflict happened by checking
-- `row.version > expected + 1`. With a local version of 5:
--
--     clean write      -> returns 6
--     one other write  -> returns 6   <- the case that matters
--
-- So the most common collision was invisible and the user's edit was silently
-- discarded while the UI reported a clean save. These tests pin the server half
-- of the fix: the flag must be true for a stale write and false for a real one,
-- including the single-hop case that version arithmetic cannot express.

-- ---------------------------------------------------------------------------
-- fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'editor-a@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'editor-b@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'viewer-v@example.com')
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Editor A'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'Editor B'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'Viewer V')
on conflict (id) do nothing;

insert into public.workspaces (id, name, type, owner_id) values
  ('33333333-3333-3333-3333-333333333333', 'Shared canvas', 'team', 'eeeeeeee-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role) values
  ('33333333-3333-3333-3333-333333333333', 'eeeeeeee-0000-0000-0000-000000000001', 'owner'),
  ('33333333-3333-3333-3333-333333333333', 'eeeeeeee-0000-0000-0000-000000000002', 'editor'),
  ('33333333-3333-3333-3333-333333333333', 'eeeeeeee-0000-0000-0000-000000000003', 'viewer')
on conflict (workspace_id, user_id) do nothing;

insert into public.canvas_items (id, workspace_id, item_type, content, created_by, version) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
   'note', '{"text":"shared"}', 'eeeeeeee-0000-0000-0000-000000000001', 5)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. A write with the current version really lands, and is not a conflict
-- ---------------------------------------------------------------------------
do $$
declare
  v_conflict boolean;
  v_version int;
  v_expected int;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);

  select conflict, (item).version, expected_version into v_conflict, v_version, v_expected
    from public.update_canvas_item('44444444-4444-4444-4444-444444444444', 5, '{"content":{"text":"from B"}}'::jsonb);

  if v_conflict is not false then
    raise exception 'a clean write was reported as a conflict';
  end if;
  if v_version <> 6 then
    raise exception 'a clean write did not increment the version (got %)', v_version;
  end if;
  if v_expected <> 5 then
    raise exception 'expected_version came back as % instead of the 5 the caller sent', v_expected;
  end if;
  if (select content->>'text' from public.canvas_items
       where id = '44444444-4444-4444-4444-444444444444') <> 'from B' then
    raise exception 'a clean write did not actually change the row';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. THE BUG: one stale write must be flagged as a conflict
--
--    This is the assertion that fails on 0010's design. The version comes back
--    as 6 -- which is exactly what a successful write returns -- so only the
--    explicit flag can tell them apart.
-- ---------------------------------------------------------------------------
do $$
declare
  v_conflict boolean;
  v_version int;
  v_expected int;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);

  -- Editor B still thinks the item is at version 5, but it is now at 6.
  select conflict, (item).version, expected_version into v_conflict, v_version, v_expected
    from public.update_canvas_item('44444444-4444-4444-4444-444444444444', 5, '{"content":{"text":"stale edit"}}'::jsonb);

  if v_conflict is not true then
    raise exception 'a stale write was NOT reported as a conflict (this is the bug)';
  end if;
  if v_version <> 6 then
    raise exception 'unexpected version on the conflict path: %', v_version;
  end if;
  -- Prove the arithmetic really cannot express this: the returned version is
  -- exactly expected + 1, same as the successful case above.
  if v_version <> v_expected + 1 then
    raise exception 'the conflict path no longer looks like a clean write; the old arithmetic would now work by accident';
  end if;
  -- And prove the stale edit did not land.
  if (select content->>'text' from public.canvas_items
       where id = '44444444-4444-4444-4444-444444444444') <> 'from B' then
    raise exception 'a stale write overwrote the row it should have lost to';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Even a two-write gap is reported (previously the only "detected" case)
-- ---------------------------------------------------------------------------
do $$
declare v_conflict boolean;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
  perform public.update_canvas_item('44444444-4444-4444-4444-444444444444', 6, '{"content":{"text":"from A"}}'::jsonb);

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
  select conflict into v_conflict
    from public.update_canvas_item('44444444-4444-4444-4444-444444444444', 5, '{"content":{"text":"very stale"}}'::jsonb);
  if v_conflict is not true then
    raise exception 'a two-version-stale write was not reported as a conflict';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. move_canvas_items: now takes an expected version per item
-- ---------------------------------------------------------------------------
do $$
declare
  v_conflict boolean;
  v_version int;
  v_x double precision;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

  -- current version is 7 after the writes above
  select conflict, (item).version into v_conflict, v_version
    from public.move_canvas_items(
      array['44444444-4444-4444-4444-444444444444']::uuid[],
      '[{"id":"44444444-4444-4444-4444-444444444444","x":120,"y":80,"version":7}]'::jsonb
    );
  if v_conflict is not false then
    raise exception 'a clean move was reported as a conflict';
  end if;
  if v_version <> 8 then
    raise exception 'a clean move did not bump the version (got %)', v_version;
  end if;
  if (select position_x from public.canvas_items where id = '44444444-4444-4444-4444-444444444444') <> 120 then
    raise exception 'a clean move did not move the row';
  end if;
end $$;

do $$
declare
  v_conflict boolean;
  v_x double precision;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);

  -- Stale move: claims version 7, row is at 8.
  select conflict into v_conflict
    from public.move_canvas_items(
      array['44444444-4444-4444-4444-444444444444']::uuid[],
      '[{"id":"44444444-4444-4444-4444-444444444444","x":999,"y":999,"version":7}]'::jsonb
    );
  if v_conflict is not true then
    raise exception 'a stale move was not reported as a conflict';
  end if;
  select position_x into v_x from public.canvas_items where id = '44444444-4444-4444-4444-444444444444';
  if v_x <> 120 then
    raise exception 'a stale move was applied anyway (x is % instead of 120)', v_x;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. A multi-item drag is all-or-nothing
-- ---------------------------------------------------------------------------
insert into public.canvas_items (id, workspace_id, item_type, content, created_by, version) values
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333',
   'note', '{"text":"second"}', 'eeeeeeee-0000-0000-0000-000000000001', 1)
on conflict (id) do nothing;

do $$
declare
  v_conflicts int;
  v_moved int;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

  -- First item is current (8), second is stale (claims 1 but has been set to 1,
  -- so bump it to make it stale).
  perform public.update_canvas_item('55555555-5555-5555-5555-555555555555', 1, '{"content":{"text":"second"}}'::jsonb);

  select count(*) filter (where conflict), count(*) filter (where not conflict)
    into v_conflicts, v_moved
    from public.move_canvas_items(
      array['44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555']::uuid[],
      '[{"id":"44444444-4444-4444-4444-444444444444","x":10,"y":10,"version":8},
        {"id":"55555555-5555-5555-5555-555555555555","x":20,"y":20,"version":1}]'::jsonb
    );

  if v_moved > 0 then
    raise exception 'a partially-stale multi-item move applied % items anyway', v_moved;
  end if;
  if v_conflicts <> 2 then
    raise exception 'expected both items reported as conflicting, got %', v_conflicts;
  end if;
  -- Neither item may have moved.
  if (select position_x from public.canvas_items where id = '44444444-4444-4444-4444-444444444444') <> 120 then
    raise exception 'the current item in a rejected batch was moved anyway';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Permissions survived the DROP FUNCTION
--    (a dropped function loses its ACL, so this is a real risk, not ceremony)
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_function_privilege('authenticated', 'public.update_canvas_item(uuid, integer, jsonb)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on update_canvas_item after the drop';
  end if;
  if not has_function_privilege('authenticated', 'public.move_canvas_items(uuid[], jsonb)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on move_canvas_items after the drop';
  end if;
  if has_function_privilege('anon', 'public.update_canvas_item(uuid, integer, jsonb)', 'EXECUTE') then
    raise exception 'anon can call update_canvas_item';
  end if;
  if has_function_privilege('anon', 'public.move_canvas_items(uuid[], jsonb)', 'EXECUTE') then
    raise exception 'anon can call move_canvas_items';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. A viewer still cannot write at all
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
  begin
    perform public.update_canvas_item('44444444-4444-4444-4444-444444444444', 8, '{"content":{"text":"nope"}}'::jsonb);
    raise exception 'a viewer was allowed to update an item';
  exception when sqlstate '42501' then null; -- expected
  end;
end $$;
