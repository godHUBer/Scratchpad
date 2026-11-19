-- Scratchpad 0005: canvas, bookmark and media RPCs.
-- All content mutations flow through these functions, so:
--   * role checks cannot be bypassed by calling the REST API directly
--   * optimistic version checks always run (client sends expected_version)
--   * conflicts return the current row so the client reconciles instead of
--     silently overwriting a newer edit

-- ---------------------------------------------------------------------------
-- canvas items
-- ---------------------------------------------------------------------------
create or replace function public.create_canvas_item(
  p_workspace_id uuid,
  p_item_type text,
  p_position_x double precision,
  p_position_y double precision,
  p_width double precision,
  p_height double precision,
  p_content jsonb default '{}'::jsonb,
  p_bookmark_id uuid default null,
  p_media_asset_id uuid default null
)
returns public.canvas_items
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.canvas_items;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.can_edit_workspace(p_workspace_id) then
    raise exception 'viewers cannot modify this workspace' using errcode = '42501';
  end if;
  if p_bookmark_id is not null and not exists (
    select 1 from public.bookmarks b
    where b.id = p_bookmark_id and b.workspace_id = p_workspace_id
  ) then
    raise exception 'bookmark does not belong to this workspace' using errcode = '22023';
  end if;
  if p_media_asset_id is not null and not exists (
    select 1 from public.media_assets a
    where a.id = p_media_asset_id and a.workspace_id = p_workspace_id
  ) then
    raise exception 'media asset does not belong to this workspace' using errcode = '22023';
  end if;

  insert into public.canvas_items
    (workspace_id, item_type, position_x, position_y, width, height, content,
     bookmark_id, media_asset_id, created_by)
  values
    (p_workspace_id, p_item_type, p_position_x, p_position_y, p_width, p_height,
     coalesce(p_content, '{}'::jsonb), p_bookmark_id, p_media_asset_id, v_uid)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.update_canvas_item(
  p_item_id uuid,
  p_expected_version integer,
  p_patch jsonb
)
returns public.canvas_items
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

  update public.canvas_items set
    position_x = coalesce((p_patch->>'position_x')::double precision, position_x),
    position_y = coalesce((p_patch->>'position_y')::double precision, position_y),
    width      = coalesce((p_patch->>'width')::double precision, width),
    height     = coalesce((p_patch->>'height')::double precision, height),
    content    = case when p_patch ? 'content' then coalesce(p_patch->'content', '{}'::jsonb) else content end,
    updated_at = now(),
    version    = version + 1
  where id = p_item_id and version = p_expected_version
  returning * into v_row;

  if v_row.id is null then
    select * into v_current from public.canvas_items c where c.id = p_item_id;
    return v_current; -- caller sees version > expected and reconciles
  end if;
  return v_row;
end;
$$;

create or replace function public.delete_canvas_item(p_item_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_ws uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select c.workspace_id into v_ws from public.canvas_items c where c.id = p_item_id;
  if v_ws is null then return; end if;
  if not public.can_edit_workspace(v_ws) then
    raise exception 'viewers cannot modify this workspace' using errcode = '42501';
  end if;
  delete from public.canvas_items where id = p_item_id;
end;
$$;

create or replace function public.duplicate_canvas_item(p_item_id uuid, p_offset double precision default 24)
returns public.canvas_items
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  src public.canvas_items;
  v_row public.canvas_items;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into src from public.canvas_items c where c.id = p_item_id;
  if not found then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not public.can_edit_workspace(src.workspace_id) then
    raise exception 'viewers cannot modify this workspace' using errcode = '42501';
  end if;

  insert into public.canvas_items
    (workspace_id, item_type, position_x, position_y, width, height, content,
     bookmark_id, media_asset_id, created_by)
  values
    (src.workspace_id, src.item_type, src.position_x + p_offset, src.position_y + p_offset,
     src.width, src.height, src.content, src.bookmark_id, src.media_asset_id, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- moving a multi-selection is one round trip; each row still bumps its version
create or replace function public.move_canvas_items(
  p_item_ids uuid[],
  p_moves jsonb
)
returns setof public.canvas_items
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_ws uuid;
  v_ws_count int;
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

  return query
  update public.canvas_items c set
    position_x = coalesce((m->>'x')::double precision, c.position_x),
    position_y = coalesce((m->>'y')::double precision, c.position_y),
    width      = coalesce((m->>'w')::double precision, c.width),
    height     = coalesce((m->>'h')::double precision, c.height),
    updated_at = now(),
    version    = c.version + 1
  from jsonb_array_elements(p_moves) as m
  where c.id = (m->>'id')::uuid
    and c.workspace_id = v_ws
  returning c.*;
end;
$$;

-- layer order lives in content.z (integer); front/back are simple, forward/backward swap
create or replace function public.set_canvas_item_layer(p_item_id uuid, p_direction text)
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_ws uuid;
  v_z int;
  v_target int;
  v_other_id uuid;
  v_other_z int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select c.workspace_id, coalesce((c.content->>'z')::int, 0)
    into v_ws, v_z
    from public.canvas_items c where c.id = p_item_id for update;
  if v_ws is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not public.can_edit_workspace(v_ws) then
    raise exception 'viewers cannot modify this workspace' using errcode = '42501';
  end if;

  if p_direction = 'front' then
    select coalesce(max((c.content->>'z')::int), 0) + 1 into v_target
      from public.canvas_items c where c.workspace_id = v_ws;
  elsif p_direction = 'back' then
    select coalesce(min((c.content->>'z')::int), 0) - 1 into v_target
      from public.canvas_items c where c.workspace_id = v_ws;
  elsif p_direction in ('forward','backward') then
    if p_direction = 'forward' then
      select c.id, coalesce((c.content->>'z')::int, 0) into v_other_id, v_other_z
        from public.canvas_items c
       where c.workspace_id = v_ws and coalesce((c.content->>'z')::int, 0) > v_z
       order by coalesce((c.content->>'z')::int, 0) asc limit 1;
    else
      select c.id, coalesce((c.content->>'z')::int, 0) into v_other_id, v_other_z
        from public.canvas_items c
       where c.workspace_id = v_ws and coalesce((c.content->>'z')::int, 0) < v_z
       order by coalesce((c.content->>'z')::int, 0) desc limit 1;
    end if;
    if v_other_id is null then return v_z; end if;
    update public.canvas_items c
       set content = jsonb_set(c.content, '{z}', to_jsonb(v_z)), updated_at = now(), version = c.version + 1
     where c.id = v_other_id;
    v_target := v_other_z;
  else
    raise exception 'direction must be front, back, forward or backward' using errcode = '22023';
  end if;

  update public.canvas_items c
     set content = jsonb_set(c.content, '{z}', to_jsonb(v_target)), updated_at = now(), version = c.version + 1
   where c.id = p_item_id;
  return v_target;
end;
$$;

-- ---------------------------------------------------------------------------
-- bookmarks
-- ---------------------------------------------------------------------------
create or replace function public.save_bookmark(
  p_workspace_id uuid,
  p_title text,
  p_url text,
  p_description text default null,
  p_category text default null,
  p_color text default '#f7c948',
  p_id uuid default null
)
returns public.bookmarks
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.bookmarks;
  v_url text := trim(coalesce(p_url, ''));
  v_title text := trim(coalesce(p_title, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.can_edit_workspace(p_workspace_id) then
    raise exception 'viewers cannot modify this workspace' using errcode = '42501';
  end if;
  if v_title = '' then raise exception 'title required' using errcode = '22023'; end if;
  if v_url !~* '^https://[^[:space:]]+$' then
    raise exception 'only https:// links can be bookmarked' using errcode = '22023';
  end if;
  if p_color is null or p_color !~* '^#[0-9a-f]{6}$' then
    raise exception 'color must look like #rrggbb' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.bookmarks (workspace_id, title, url, description, category, color, created_by)
    values (p_workspace_id, v_title, v_url, nullif(trim(p_description), ''),
            nullif(trim(p_category), ''), p_color, auth.uid())
    returning * into v_row;
  else
    update public.bookmarks b
       set title = v_title, url = v_url,
           description = nullif(trim(p_description), ''),
           category = nullif(trim(p_category), ''), color = p_color
     where b.id = p_id and b.workspace_id = p_workspace_id
    returning * into v_row;
    if v_row.id is null then raise exception 'bookmark not found' using errcode = 'P0002'; end if;
  end if;
  return v_row;
end;
$$;

create or replace function public.delete_bookmark(p_bookmark_id uuid)
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_ws uuid; v_unlinked int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select b.workspace_id into v_ws from public.bookmarks b where b.id = p_bookmark_id;
  if v_ws is null then return 0; end if;
  if not public.can_edit_workspace(v_ws) then
    raise exception 'viewers cannot modify this workspace' using errcode = '42501';
  end if;

  select count(*)::int into v_unlinked
    from public.canvas_items c where c.bookmark_id = p_bookmark_id;

  delete from public.bookmarks where id = p_bookmark_id; -- cards unlink via FK
  return v_unlinked;
end;
$$;

create or replace function public.bookmark_card_count(p_bookmark_id uuid)
returns integer language sql stable security definer
set search_path = pg_catalog, public
as $$
  select count(*)::int from public.canvas_items c
  where c.bookmark_id = p_bookmark_id
    and public.is_workspace_member(c.workspace_id);
$$;

-- ---------------------------------------------------------------------------
-- media assets (links and metadata only)
-- ---------------------------------------------------------------------------
create or replace function public.save_media_asset(
  p_workspace_id uuid,
  p_original_url text,
  p_file_type text,
  p_drive_file_id text default null,
  p_file_name text default null,
  p_mime_type text default null,
  p_id uuid default null
)
returns public.media_assets
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.media_assets;
  v_url text := trim(coalesce(p_original_url, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.can_edit_workspace(p_workspace_id) then
    raise exception 'viewers cannot modify this workspace' using errcode = '42501';
  end if;
  if v_url !~* '^https://[^[:space:]]+$' then
    raise exception 'only https:// links are accepted' using errcode = '22023';
  end if;
  if p_file_type is null or p_file_type not in ('image','audio','video','link') then
    raise exception 'unsupported media type' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.media_assets
      (workspace_id, uploaded_by, original_url, drive_file_id, file_name, file_type, mime_type)
    values (p_workspace_id, auth.uid(), v_url, nullif(trim(p_drive_file_id), ''),
            nullif(trim(p_file_name), ''), p_file_type, nullif(trim(p_mime_type), ''))
    returning * into v_row;
  else
    update public.media_assets a
       set original_url = v_url, drive_file_id = nullif(trim(p_drive_file_id), ''),
           file_name = nullif(trim(p_file_name), ''), file_type = p_file_type,
           mime_type = nullif(trim(p_mime_type), '')
     where a.id = p_id and a.workspace_id = p_workspace_id
    returning * into v_row;
    if v_row.id is null then raise exception 'media asset not found' using errcode = 'P0002'; end if;
  end if;
  return v_row;
end;
$$;

create or replace function public.delete_media_asset(p_media_id uuid)
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_ws uuid; v_unlinked int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select a.workspace_id into v_ws from public.media_assets a where a.id = p_media_id;
  if v_ws is null then return 0; end if;
  if not public.can_edit_workspace(v_ws) then
    raise exception 'viewers cannot modify this workspace' using errcode = '42501';
  end if;

  select count(*)::int into v_unlinked
    from public.canvas_items c where c.media_asset_id = p_media_id;

  delete from public.media_assets where id = p_media_id;
  return v_unlinked;
end;
$$;

create or replace function public.media_card_count(p_media_id uuid)
returns integer language sql stable security definer
set search_path = pg_catalog, public
as $$
  select count(*)::int from public.canvas_items c
  where c.media_asset_id = p_media_id
    and public.is_workspace_member(c.workspace_id);
$$;

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
revoke all on function public.create_canvas_item(uuid, text, double precision, double precision, double precision, double precision, jsonb, uuid, uuid) from public, anon;
revoke all on function public.update_canvas_item(uuid, integer, jsonb) from public, anon;
revoke all on function public.delete_canvas_item(uuid) from public, anon;
revoke all on function public.duplicate_canvas_item(uuid, double precision) from public, anon;
revoke all on function public.move_canvas_items(uuid[], jsonb) from public, anon;
revoke all on function public.set_canvas_item_layer(uuid, text) from public, anon;
revoke all on function public.save_bookmark(uuid, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.delete_bookmark(uuid) from public, anon;
revoke all on function public.bookmark_card_count(uuid) from public, anon;
revoke all on function public.save_media_asset(uuid, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.delete_media_asset(uuid) from public, anon;
revoke all on function public.media_card_count(uuid) from public, anon;

grant execute on function public.create_canvas_item(uuid, text, double precision, double precision, double precision, double precision, jsonb, uuid, uuid) to authenticated;
grant execute on function public.update_canvas_item(uuid, integer, jsonb) to authenticated;
grant execute on function public.delete_canvas_item(uuid) to authenticated;
grant execute on function public.duplicate_canvas_item(uuid, double precision) to authenticated;
grant execute on function public.move_canvas_items(uuid[], jsonb) to authenticated;
grant execute on function public.set_canvas_item_layer(uuid, text) to authenticated;
grant execute on function public.save_bookmark(uuid, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.delete_bookmark(uuid) to authenticated;
grant execute on function public.bookmark_card_count(uuid) to authenticated;
grant execute on function public.save_media_asset(uuid, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.delete_media_asset(uuid) to authenticated;
grant execute on function public.media_card_count(uuid) to authenticated;
