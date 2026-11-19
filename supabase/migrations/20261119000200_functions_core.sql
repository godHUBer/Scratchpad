-- Scratchpad 0002: helper functions, profile bootstrap, updated_at triggers.
-- All SECURITY DEFINER functions in this project pin search_path and are
-- revoked from PUBLIC/anon unless explicitly noted.

-- ---------------------------------------------------------------------------
-- membership helpers (used inside RLS policies and RPCs)
-- ---------------------------------------------------------------------------
create or replace function public.is_workspace_member(ws uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create or replace function public.workspace_role(ws uuid)
returns text language sql stable security definer
set search_path = pg_catalog, public
as $$
  select m.role from public.workspace_members m
  where m.workspace_id = ws and m.user_id = auth.uid();
$$;

create or replace function public.can_edit_workspace(ws uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
      and m.role in ('owner','editor')
  );
$$;

create or replace function public.is_workspace_owner(ws uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- profile bootstrap from auth.users (Google metadata when available)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  name text;
  avatar text;
begin
  name := nullif(trim(coalesce(meta->>'full_name', meta->>'name', split_part(new.email, '@', 1))), '');
  avatar := nullif(trim(coalesce(meta->>'avatar_url', meta->>'picture')), '');

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(name, 'New collaborator'),
    case when avatar ~* '^https?://' then avatar else null end
  )
  on conflict (id) do update
    set display_name = case
          when public.profiles.display_name = 'New collaborator' then excluded.display_name
          else public.profiles.display_name end,
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_profiles on public.profiles;
create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_workspaces on public.workspaces;
create trigger touch_workspaces before update on public.workspaces
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_bookmarks on public.bookmarks;
create trigger touch_bookmarks before update on public.bookmarks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- owner/role invariant guard on membership rows.
-- Cascades arrive at depth 1 and are allowed; app writes arrive at depth 2+.
-- Bypass paths outside the RPCs still cannot produce an inconsistent owner.
-- ---------------------------------------------------------------------------
create or replace function public.guard_member_write()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  ws uuid := coalesce(new.workspace_id, old.workspace_id);
  ws_owner uuid;
begin
  -- cascading deletes (workspace or profile removed) are legitimate
  if pg_trigger_depth() = 1 then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select w.owner_id into ws_owner from public.workspaces w where w.id = ws;

  if tg_op = 'DELETE' then
    if old.role = 'owner' then
      raise exception 'the owner row cannot be removed; transfer ownership first'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if new.role = 'owner' and new.user_id is distinct from ws_owner then
    raise exception 'owner role must match workspaces.owner_id' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    raise exception 'the owner row cannot be demoted; use transfer_ownership' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_member_write on public.workspace_members;
create trigger guard_member_write
  before insert or update or delete on public.workspace_members
  for each row execute function public.guard_member_write();

-- ---------------------------------------------------------------------------
-- grants for helpers
-- ---------------------------------------------------------------------------
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.workspace_role(uuid) from public, anon;
revoke all on function public.can_edit_workspace(uuid) from public, anon;
revoke all on function public.is_workspace_owner(uuid) from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon;
revoke all on function public.guard_member_write() from public, anon;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.workspace_role(uuid) to authenticated;
grant execute on function public.can_edit_workspace(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
