-- Scratchpad 0013: retention becomes a per-workspace decision.
--
-- What was wrong in 0010
--
--   `retention_policy` was a single global row holding both the day thresholds
--   and the on/off switch, and `set_retention_enabled` only checked that the
--   caller was signed in:
--
--       if auth.uid() is null then raise exception 'not authenticated' ...;
--       update public.retention_policy set enabled = p_enabled where id;
--
--   The comment above it claimed "Only the workspace-owning account can change
--   it", but no such check existed. Because that one row was global, the first
--   authenticated user to press the button switched the cleanup job on for
--   *every* workspace in the deployment -- and `run_retention_sweep` happily
--   trashed and purged rows across all of them, with no workspace filter.
--
--   With open sign-up, that is a stranger deleting everyone's data on a timer.
--
-- The fix
--
--   1. Day thresholds stay global (one operator-tunable config, readable by all)
--      and become admin-only to change.
--   2. The on/off switch moves onto each workspace, defaults to OFF, and only
--      that workspace's owner can flip it.
--   3. The sweep joins `workspaces` and refuses to touch any workspace that has
--      not opted in -- for both the trash step and the purge step.
--
--   `retention_policy.enabled` is retained as an operator master switch ("is the
--   pipeline allowed to run at all"), so a deployment can stop all deletion
--   centrally without editing per-workspace rows. It no longer implies consent
--   for anyone's content.

-- ---------------------------------------------------------------------------
-- 1. Per-workspace opt-in
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists retention_enabled boolean not null default false;

comment on column public.workspaces.retention_enabled is
  'Owner opt-in for the 60 -> 90 -> 100 day cleanup job. Default OFF: installing the sweeper must not start deleting anything.';

-- The sweep reads "enabled workspaces that still hold live rows", so give it an
-- index that matches the predicate rather than scanning every workspace.
create index if not exists workspaces_retention_idx
  on public.workspaces (id)
  where retention_enabled;

-- ---------------------------------------------------------------------------
-- 2. Re-scope the global row
-- ---------------------------------------------------------------------------
comment on column public.retention_policy.enabled is
  'Operator master switch. Gates the whole pipeline; it is NOT a user preference and does not consent to any workspace being cleaned. Set it with admin_set_retention().';

-- 0010 shipped the master switch OFF, which made per-workspace opt-in pointless.
-- Turning it on now deletes nothing by itself: every workspace still defaults to
-- retention_enabled = false, and the sweep checks that flag per workspace.
update public.retention_policy
   set enabled = true, updated_at = now()
 where id and not enabled;

-- ---------------------------------------------------------------------------
-- 3. Opt in / out, and read the state
-- ---------------------------------------------------------------------------
-- Only the owner of *that* workspace. Editors can delete individual items; they
-- cannot arm a job that will delete everything nobody has touched in 90 days.
create or replace function public.set_workspace_retention(p_workspace_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'only the workspace owner can change auto-cleanup' using errcode = '42501';
  end if;

  update public.workspaces
     set retention_enabled = p_enabled
   where id = p_workspace_id;

  return p_enabled;
end;
$$;

-- One call that the Settings panel needs: the workspace's own state plus the
-- global thresholds, and whether this caller is allowed to change it. Returning
-- `can_manage` keeps the authorisation decision on the server: hiding a button
-- in the client is presentation, not security.
create or replace function public.get_workspace_retention(p_workspace_id uuid)
returns table (
  enabled         boolean,
  cold_after_days integer,
  trash_after_days integer,
  purge_after_days integer,
  can_manage      boolean
)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  -- Members may look; the trash an owner can list is scoped the same way.
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  return query
    select w.retention_enabled,
           p.cold_after_days,
           p.trash_after_days,
           p.purge_after_days,
           public.is_workspace_owner(p_workspace_id)
      from public.workspaces w
      cross join public.retention_policy p
     where w.id = p_workspace_id and p.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The sweep: only workspaces that opted in
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

  -- Operator kill switch.
  if not coalesce(v_enabled, false) then
    return query select 0, 0;
    return;
  end if;

  -- 90-day rule: live rows nobody has touched enter the trash -- but only in
  -- workspaces whose owner asked for this. `join workspaces ... w.retention_enabled`
  -- is the whole fix: 0010 ran these updates unqualified, across every tenant.
  --
  -- NOTE: GET DIAGNOSTICS reports only the *last* statement, so each table gets
  -- its own WITH ... RETURNING count instead of a shared variable. (Getting this
  -- wrong silently reports "0 rows" while actually moving rows.)
  with moved as (
    update public.canvas_items c
       set deleted_at = now(),
           purge_after = now() + make_interval(days => v_purge_days - v_trash_days),
           version = version + 1
      from public.workspaces w
     where w.id = c.workspace_id
       and w.retention_enabled
       and c.deleted_at is null
       and c.updated_at < now() - make_interval(days => v_trash_days)
    returning 1
  )
  select count(*) into v_affected from moved;
  v_trash := v_trash + v_affected;

  with moved as (
    update public.bookmarks b
       set deleted_at = now(),
           purge_after = now() + make_interval(days => v_purge_days - v_trash_days)
      from public.workspaces w
     where w.id = b.workspace_id
       and w.retention_enabled
       and b.deleted_at is null
       and b.updated_at < now() - make_interval(days => v_trash_days)
    returning 1
  )
  select count(*) into v_affected from moved;
  v_trash := v_trash + v_affected;

  -- media_assets has no updated_at; created_at is the only age signal it has.
  with moved as (
    update public.media_assets m
       set deleted_at = now(),
           purge_after = now() + make_interval(days => v_purge_days - v_trash_days)
      from public.workspaces w
     where w.id = m.workspace_id
       and w.retention_enabled
       and m.deleted_at is null
       and m.created_at < now() - make_interval(days => v_trash_days)
    returning 1
  )
  select count(*) into v_affected from moved;
  v_trash := v_trash + v_affected;

  -- 100-day rule: purge whatever has ripened. Same workspace gate, so switching
  -- auto-cleanup off genuinely stops deletion instead of merely pausing new
  -- arrivals in the trash.
  with gone as (
    delete from public.canvas_items c
     using public.workspaces w
     where w.id = c.workspace_id
       and w.retention_enabled
       and c.purge_after is not null
       and c.purge_after <= now()
    returning 1
  )
  select count(*) into v_affected from gone;
  v_purge := v_purge + v_affected;

  with gone as (
    delete from public.bookmarks b
     using public.workspaces w
     where w.id = b.workspace_id
       and w.retention_enabled
       and b.purge_after is not null
       and b.purge_after <= now()
    returning 1
  )
  select count(*) into v_affected from gone;
  v_purge := v_purge + v_affected;

  with gone as (
    delete from public.media_assets m
     using public.workspaces w
     where w.id = m.workspace_id
       and w.retention_enabled
       and m.purge_after is not null
       and m.purge_after <= now()
    returning 1
  )
  select count(*) into v_affected from gone;
  v_purge := v_purge + v_affected;

  return query select v_trash, v_purge;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Operator control of the master switch
-- ---------------------------------------------------------------------------
-- Replaces the user-callable `set_retention_enabled`. Keeping the old name but
-- making it admin-only would have left a function every client still holds EXECUTE
-- on; instead it is revoked below and this session-guarded one is the only door.
create or replace function public.admin_set_retention(p_token text, p_enabled boolean)
returns public.retention_policy language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare v_row public.retention_policy;
begin
  perform public.admin_require_session(p_token);

  update public.retention_policy
     set enabled = p_enabled, updated_at = now()
   where id
  returning * into v_row;

  insert into public.admin_audit_log (action, detail)
  values ('set_retention', jsonb_build_object('enabled', p_enabled));

  return v_row;
end;
$$;

-- The old global toggle stays in place for one release so a stale client gets a
-- clean error rather than a 404-shaped "function not found", but no client role
-- may execute it any more.
revoke all on function public.set_retention_enabled(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.set_workspace_retention(uuid, boolean) from public, anon;
revoke all on function public.get_workspace_retention(uuid) from public, anon;
grant execute on function public.set_workspace_retention(uuid, boolean) to authenticated;
grant execute on function public.get_workspace_retention(uuid) to authenticated;

-- `admin_set_retention` mirrors the other admin RPCs: the admin page is reached
-- before sign-in, so anon must be able to call it with a session token.
revoke all on function public.admin_set_retention(text, boolean) from public;
grant execute on function public.admin_set_retention(text, boolean) to anon, authenticated;
