-- Scratchpad 0010: workspace deletion, retention (soft delete) and the
-- 60 -> 90 -> 100 day cleanup pipeline.
--
-- Goal
--   day 0    item created / last touched
--   day 60   "cold": flagged in the UI as due for review (no data change)
--   day 90   soft delete: moved to Trash. Still visible to the owner, can be
--            restored in one click.
--   day 100  permanent purge: the row is deleted for good.
--
-- Why not DELETE straight away: the client only has SELECT on content tables
-- (all writes go through SECURITY DEFINER RPCs). A retention job that bypassed
-- that would have to be a superuser DELETE with no audit trail and no undo.
-- A `deleted_at` column keeps every existing RLS policy, every RPC and every
-- realtime subscription working; the policies simply add `deleted_at is null`.

-- ---------------------------------------------------------------------------
-- 1. Soft-delete columns
-- ---------------------------------------------------------------------------
alter table public.canvas_items
  add column if not exists deleted_at timestamptz,
  add column if not exists purge_after timestamptz;

alter table public.bookmarks
  add column if not exists deleted_at timestamptz,
  add column if not exists purge_after timestamptz;

alter table public.media_assets
  add column if not exists deleted_at timestamptz,
  add column if not exists purge_after timestamptz;

comment on column public.canvas_items.deleted_at is
  'When the item entered the Trash (day 90). NULL means live.';
comment on column public.canvas_items.purge_after is
  'When the item is permanently removed (day 100). NULL means live.';

-- Partial indexes: the live rows are the hot path, trash is rare.
create index if not exists canvas_items_live_idx
  on public.canvas_items (workspace_id, updated_at)
  where deleted_at is null;
create index if not exists canvas_items_trash_idx
  on public.canvas_items (workspace_id, deleted_at)
  where deleted_at is not null;
create index if not exists canvas_items_purge_idx
  on public.canvas_items (purge_after)
  where purge_after is not null;
create index if not exists bookmarks_purge_idx
  on public.bookmarks (purge_after)
  where purge_after is not null;
create index if not exists media_assets_purge_idx
  on public.media_assets (purge_after)
  where purge_after is not null;

-- ---------------------------------------------------------------------------
-- 2. Retention policy, in one readable place
-- ---------------------------------------------------------------------------
create table if not exists public.retention_policy (
  id boolean primary key default true check (id),
  cold_after_days   integer not null default 60  check (cold_after_days between 1 and 3650),
  trash_after_days  integer not null default 90  check (trash_after_days > cold_after_days),
  purge_after_days  integer not null default 100 check (purge_after_days > trash_after_days),
  -- Off until the operator opts in. Installing a sweeper must not begin
  -- deleting content on a timer by itself.
  enabled           boolean not null default false,
  updated_at        timestamptz not null default now()
);
insert into public.retention_policy (id, enabled) values (true, false)
  on conflict (id) do nothing;

revoke all on public.retention_policy from anon, authenticated;
grant select on public.retention_policy to authenticated;

alter table public.retention_policy enable row level security;
drop policy if exists retention_policy_select on public.retention_policy;
create policy retention_policy_select on public.retention_policy
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3. RLS: trash is invisible to everyone but it stays *readable by the owner*
--    so the Trash panel can list and restore it.
--
--    Live-row reads keep their existing policy; the extra clause is added to
--    the same policy so nothing can bypass it.
-- ---------------------------------------------------------------------------
drop policy if exists canvas_items_select on public.canvas_items;
create policy canvas_items_select on public.canvas_items
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      deleted_at is null
      -- the Trash view: owners and editors may see what is queued for purge
      or public.can_edit_workspace(workspace_id)
    )
  );

drop policy if exists bookmarks_select on public.bookmarks;
create policy bookmarks_select on public.bookmarks
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (deleted_at is null or public.can_edit_workspace(workspace_id))
  );

drop policy if exists media_assets_select on public.media_assets;
create policy media_assets_select on public.media_assets
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (deleted_at is null or public.can_edit_workspace(workspace_id))
  );

-- ---------------------------------------------------------------------------
-- 4. Trash lifecycle
-- ---------------------------------------------------------------------------
-- Internal: move one row into the trash. Callable from the RPCs below and from
-- the retention sweep. Not exposed to clients directly.
create or replace function public.soft_delete_canvas_item(p_item_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_purge integer;
begin
  select purge_after_days into v_purge from public.retention_policy where id;
  update public.canvas_items
     set deleted_at = now(),
         purge_after = now() + make_interval(days => coalesce(v_purge, 100)),
         version = version + 1
   where id = p_item_id and deleted_at is null;
end;
$$;

create or replace function public.restore_canvas_item(p_item_id uuid)
returns public.canvas_items language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_ws uuid;
  v_row public.canvas_items;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select workspace_id into v_ws from public.canvas_items where id = p_item_id;
  if v_ws is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not public.can_edit_workspace(v_ws) then
    raise exception 'viewers cannot restore items' using errcode = '42501';
  end if;
  update public.canvas_items
     set deleted_at = null, purge_after = null, version = version + 1
   where id = p_item_id
  returning * into v_row;
  return v_row;
end;
$$;

/** Trash listing. Live items are returned by the normal select. */
create or replace function public.list_trashed_items(p_workspace_id uuid)
returns setof public.canvas_items language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
    select * from public.canvas_items
     where workspace_id = p_workspace_id and deleted_at is not null
     order by deleted_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The sweep. Runs on a schedule; each step is idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.run_retention_sweep()
returns table (moved_to_trash integer, purged integer)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_trash integer := 0;
  v_purge integer := 0;
  v_enabled boolean;
  v_trash_days integer;
  v_purge_days integer;
  v_affected integer;
begin
  select enabled, trash_after_days, purge_after_days
    into v_enabled, v_trash_days, v_purge_days
    from public.retention_policy where id;

  if not coalesce(v_enabled, false) then
    return query select 0, 0;
    return;
  end if;

  -- 90-day rule: live rows nobody has touched enter the trash.
  -- NOTE: GET DIAGNOSTICS reports only the *last* statement, so each table gets
  -- its own WITH ... RETURNING count instead of a shared variable. (Getting this
  -- wrong silently reports "0 rows" while actually moving rows.)
  with moved as (
    update public.canvas_items
       set deleted_at = now(),
           purge_after = now() + make_interval(days => v_purge_days - v_trash_days),
           version = version + 1
     where deleted_at is null
       and updated_at < now() - make_interval(days => v_trash_days)
    returning 1
  )
  select count(*) into v_affected from moved;
  v_trash := v_trash + v_affected;

  with moved as (
    update public.bookmarks
       set deleted_at = now(),
           purge_after = now() + make_interval(days => v_purge_days - v_trash_days)
     where deleted_at is null
       and updated_at < now() - make_interval(days => v_trash_days)
    returning 1
  )
  select count(*) into v_affected from moved;
  v_trash := v_trash + v_affected;

  with moved as (
    update public.media_assets
       set deleted_at = now(),
           purge_after = now() + make_interval(days => v_purge_days - v_trash_days)
     where deleted_at is null
       and created_at < now() - make_interval(days => v_trash_days)
    returning 1
  )
  select count(*) into v_affected from moved;
  v_trash := v_trash + v_affected;

  -- 100-day rule: purge whatever has ripened.
  with gone as (
    delete from public.canvas_items where purge_after is not null and purge_after <= now()
    returning 1
  )
  select count(*) into v_affected from gone;
  v_purge := v_purge + v_affected;

  with gone as (
    delete from public.bookmarks where purge_after is not null and purge_after <= now()
    returning 1
  )
  select count(*) into v_affected from gone;
  v_purge := v_purge + v_affected;

  with gone as (
    delete from public.media_assets where purge_after is not null and purge_after <= now()
    returning 1
  )
  select count(*) into v_affected from gone;
  v_purge := v_purge + v_affected;

  return query select v_trash, v_purge;
end;
$$;

revoke all on function public.run_retention_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Schedule it with pg_cron (available on Supabase; degrade gracefully)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron could not be enabled: %', sqlerrm;
    end;
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
      perform cron.unschedule('scratchpad-retention')
        where exists (select 1 from cron.job where jobname = 'scratchpad-retention');
      perform cron.schedule(
        'scratchpad-retention',
        '17 3 * * *',            -- nightly at 03:17 UTC
        $job$select public.run_retention_sweep();$job$
      );
    end if;
  else
    raise notice 'pg_cron is not available; run public.run_retention_sweep() from an external scheduler';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Deleting a personal workspace (the canvas now offers the button too)
-- ---------------------------------------------------------------------------
create or replace function public.delete_workspace(p_workspace_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select owner_id into v_owner from public.workspaces where id = p_workspace_id;
  if v_owner is null then raise exception 'workspace not found' using errcode = 'P0002'; end if;
  if v_owner <> auth.uid() then
    raise exception 'only the owner can delete a workspace' using errcode = '42501';
  end if;
  -- Personal workspaces may be deleted; teams use delete_team so the audit
  -- trail stays in one place.
  if (select type from public.workspaces where id = p_workspace_id) = 'team' then
    raise exception 'use delete_team for team workspaces' using errcode = '42501';
  end if;
  delete from public.workspaces where id = p_workspace_id;
end;
$$;

-- Read the pipeline state for the Settings screen, and opt in/out from the app.
create or replace function public.get_retention_policy()
returns public.retention_policy language sql security definer
set search_path = pg_catalog, public
as $$
  select * from public.retention_policy where id;
$$;

-- Only the workspace-owning account can change it. In a multi-tenant install
-- this would move to a platform-admin check; here every user owns their data.
create or replace function public.set_retention_enabled(p_enabled boolean)
returns public.retention_policy language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_row public.retention_policy;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.retention_policy
     set enabled = p_enabled, updated_at = now()
   where id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.delete_workspace(uuid) from public, anon;
grant execute on function public.delete_workspace(uuid) to authenticated;

revoke all on function public.restore_canvas_item(uuid) from public, anon;
revoke all on function public.list_trashed_items(uuid) from public, anon;
grant execute on function public.restore_canvas_item(uuid) to authenticated;
grant execute on function public.list_trashed_items(uuid) to authenticated;
revoke all on function public.soft_delete_canvas_item(uuid) from public, anon, authenticated;

revoke all on function public.get_retention_policy() from public, anon;
revoke all on function public.set_retention_enabled(boolean) from public, anon;
grant execute on function public.get_retention_policy() to authenticated;
grant execute on function public.set_retention_enabled(boolean) to authenticated;
