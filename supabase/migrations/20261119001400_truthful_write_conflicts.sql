-- Scratchpad 0014: stale writes must be *reported*, not silently dropped.
--
-- The bug
--
--   `update_canvas_item` updated only when `version = p_expected_version`, and
--   on a miss it returned the current row so the caller could "reconcile".
--   The client then tried to work out what happened with arithmetic:
--
--       if (row.version > current.version + 1) { setConflicts(n => n + 1) }
--
--   That test is false for the case it most needs to catch. With a local
--   version of 5:
--
--       clean write     update applies     returns 6   (5 + 1)
--       one other write update skipped     returns 6   (5 + 1, bumped by them)
--
--   Both come back as version 6. The single most common collision -- exactly
--   one other editor saving first -- is indistinguishable from success. The
--   user's edit is discarded, the row is replaced with the other person's, and
--   the sync pill still reads "Saved, 0 conflicts". Silent data loss presented
--   as a clean save.
--
--   Two writes of interference was detected, but by then the count is wrong and
--   the user has no way to know their change never landed.
--
-- The fix
--
--   Stop inferring. The function knows which branch it took, so it says so.
--   Both mutating RPCs now return a result row carrying the saved row, the
--   version the caller sent, and an explicit `conflict` flag. The client adds
--   one to the counter when -- and only when -- the server says conflict.
--
--   `move_canvas_items` had the same class of bug in a worse form: it took no
--   expected version at all, so a drag silently overwrote whatever another
--   editor had done, and no return value could ever have revealed it. It now
--   takes one expected version per item (the batch is rejected as a whole if
--   any item is stale, so a multi-select drag is all-or-nothing) and reports
--   the same way.
--
--   Note on why this is a *report* and not a retry: overwriting is the desired
--   outcome for a drag (last writer wins by position), but the user must learn
--   that someone else moved the card. Re-applying the write automatically would
--   just clobber the other person in turn.

-- ---------------------------------------------------------------------------
-- 1. update_canvas_item: return the outcome instead of the bare row
-- ---------------------------------------------------------------------------
-- A return-type change cannot be done with CREATE OR REPLACE, so drop first.
-- Nothing else references this function, and the grants are re-issued below.
drop function if exists public.update_canvas_item(uuid, integer, jsonb);

create function public.update_canvas_item(
  p_item_id uuid,
  p_expected_version integer,
  p_patch jsonb
)
returns table (item public.canvas_items, expected_version integer, conflict boolean)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_ws uuid;
  v_row public.canvas_items;
  v_current public.canvas_items;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select c.workspace_id into v_ws from public.canvas_items c where c.id = p_item_id;
  if v_ws is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not public.can_edit_workspace(v_ws) then
    raise exception 'viewers cannot modify this workspace' using errcode = '42501';
  end if;

  update public.canvas_items c set
    position_x = coalesce((p_patch->>'position_x')::double precision, c.position_x),
    position_y = coalesce((p_patch->>'position_y')::double precision, c.position_y),
    width      = coalesce((p_patch->>'width')::double precision, c.width),
    height     = coalesce((p_patch->>'height')::double precision, c.height),
    content    = case when p_patch ? 'content' then coalesce(p_patch->'content', '{}'::jsonb) else c.content end,
    updated_at = now(),
    version    = c.version + 1
  where c.id = p_item_id and c.version = p_expected_version
  returning c.* into v_row;

  if v_row.id is null then
    -- Someone wrote first. Hand back their row and say so; do not let the
    -- caller guess from the version number, which cannot express this.
    select * into v_current from public.canvas_items c where c.id = p_item_id;
    return query select v_current, p_expected_version, true;
    return;
  end if;

  return query select v_row, p_expected_version, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. move_canvas_items: take expected versions, report the same way
-- ---------------------------------------------------------------------------
-- p_moves entries are { id, x, y, w?, h?, version }. `version` is required:
-- a move that does not know what it is overwriting is the bug being fixed.
drop function if exists public.move_canvas_items(uuid[], jsonb);

create function public.move_canvas_items(
  p_item_ids uuid[],
  p_moves jsonb
)
returns table (item public.canvas_items, expected_version integer, conflict boolean)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_ws uuid;
  v_ws_count int;
  v_stale int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select count(distinct c.workspace_id) into v_ws_count
    from public.canvas_items c where c.id = any(p_item_ids);
  if v_ws_count = 0 then return; end if;
  if v_ws_count > 1 then
    raise exception 'items span multiple workspaces' using errcode = '22023';
  end if;
  select c.workspace_id into v_ws from public.canvas_items c where c.id = any(p_item_ids) limit 1;
  if not public.can_edit_workspace(v_ws) then
    raise exception 'viewers cannot modify this workspace' using errcode = '42501';
  end if;

  -- Reject the batch if any item moved underneath us. A multi-select drag is
  -- one gesture; applying it to half the selection would be worse than not
  -- applying it at all.
  select count(*) into v_stale
    from jsonb_array_elements(p_moves) as m
    join public.canvas_items c on c.id = (m->>'id')::uuid
   where c.workspace_id = v_ws
     and c.version <> (m->>'version')::integer;

  if v_stale > 0 then
    -- Report every item as unchanged-and-conflicting, so the caller knows to
    -- reconcile rather than assume the gesture landed.
    return query
      select c, (m->>'version')::integer, true
        from jsonb_array_elements(p_moves) as m
        join public.canvas_items c on c.id = (m->>'id')::uuid
       where c.workspace_id = v_ws;
    return;
  end if;

  -- RETURNING emits the post-update row. Two traps avoided here:
  --   * do not round-trip through a CTE and re-read the table -- a data-modifying
  --     CTE exposes the pre-update snapshot, so a re-read looks stale;
  --   * the table alias must differ from the output column name (`item`), or the
  --     RETURNING list cannot be addressed unambiguously.
  return query
  with moved as (
    update public.canvas_items ci set
      position_x = coalesce((m->>'x')::double precision, ci.position_x),
      position_y = coalesce((m->>'y')::double precision, ci.position_y),
      width      = coalesce((m->>'w')::double precision, ci.width),
      height     = coalesce((m->>'h')::double precision, ci.height),
      updated_at = now(),
      version    = ci.version + 1
    from jsonb_array_elements(p_moves) as m
    where ci.id = (m->>'id')::uuid
      and ci.workspace_id = v_ws
    returning ci, (m->>'version')::integer as exp
  )
  select moved.ci, moved.exp, false from moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants (dropping a function drops its ACL)
-- ---------------------------------------------------------------------------
revoke all on function public.update_canvas_item(uuid, integer, jsonb) from public, anon;
revoke all on function public.move_canvas_items(uuid[], jsonb) from public, anon;
grant execute on function public.update_canvas_item(uuid, integer, jsonb) to authenticated;
grant execute on function public.move_canvas_items(uuid[], jsonb) to authenticated;
