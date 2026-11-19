-- Scratchpad 0003: workspace lifecycle and membership RPCs.
-- Every function checks auth.uid() itself and never trusts a caller-supplied user id.

-- ---------------------------------------------------------------------------
-- personal workspace bootstrap (idempotent, race-safe via the partial unique index)
-- ---------------------------------------------------------------------------
create or replace function public.ensure_personal_workspace()
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_name text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select w.id into v_ws from public.workspaces w
   where w.owner_id = v_uid and w.type = 'personal';

  if v_ws is null then
    select p.display_name into v_name from public.profiles p where p.id = v_uid;
    insert into public.workspaces (name, description, type, owner_id)
    values (coalesce(v_name, 'My') || '''s scratchpad', null, 'personal', v_uid)
    on conflict (owner_id) where type = 'personal' do nothing
    returning id into v_ws;

    if v_ws is null then
      select w.id into v_ws from public.workspaces w
       where w.owner_id = v_uid and w.type = 'personal';
    end if;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, v_uid, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return v_ws;
end;
$$;

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
create or replace function public.create_team(p_name text, p_description text default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'team name must be 1-80 characters' using errcode = '22023';
  end if;
  if p_description is not null and char_length(p_description) > 500 then
    raise exception 'description too long' using errcode = '22023';
  end if;

  insert into public.workspaces (name, description, type, owner_id)
  values (v_name, nullif(trim(p_description), ''), 'team', v_uid)
  returning id into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, v_uid, 'owner');

  return v_ws;
end;
$$;

create or replace function public.rename_workspace(p_workspace_id uuid, p_name text, p_description text default null)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'only the owner can rename this workspace' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 1 then
    raise exception 'name required' using errcode = '22023';
  end if;
  update public.workspaces
     set name = trim(p_name), description = nullif(trim(p_description), '')
   where id = p_workspace_id;
end;
$$;

create or replace function public.delete_team(p_workspace_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_type text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select w.type into v_type from public.workspaces w where w.id = p_workspace_id;
  if v_type is null then raise exception 'workspace not found' using errcode = 'P0002'; end if;
  if v_type = 'personal' then
    raise exception 'personal workspaces cannot be deleted' using errcode = '42501';
  end if;
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'only the owner can delete a team' using errcode = '42501';
  end if;
  delete from public.workspaces where id = p_workspace_id;
end;
$$;

create or replace function public.leave_workspace(p_workspace_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  v_role := public.workspace_role(p_workspace_id);
  if v_role is null then raise exception 'not a member' using errcode = '42501'; end if;
  if v_role = 'owner' then
    raise exception 'owners must transfer ownership before leaving' using errcode = '42501';
  end if;
  delete from public.workspace_members
   where workspace_id = p_workspace_id and user_id = auth.uid();
end;
$$;

create or replace function public.remove_member(p_workspace_id uuid, p_user_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'only the owner can remove members' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'use leave_workspace to remove yourself' using errcode = '22023';
  end if;
  delete from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_user_id and role <> 'owner';
  if not found then raise exception 'member not found or is the owner' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.set_member_role(p_workspace_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_role not in ('editor','viewer') then
    raise exception 'role must be editor or viewer; use transfer_ownership for owner' using errcode = '22023';
  end if;
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'only the owner can change roles' using errcode = '42501';
  end if;
  update public.workspace_members set role = p_role
   where workspace_id = p_workspace_id and user_id = p_user_id and role <> 'owner';
  if not found then raise exception 'member not found or is the owner' using errcode = 'P0002'; end if;
end;
$$;

-- atomic: workspace owner_id and both membership rows change together
create or replace function public.transfer_ownership(p_workspace_id uuid, p_new_owner uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'only the owner can transfer ownership' using errcode = '42501';
  end if;
  if p_new_owner = v_uid then
    raise exception 'you already own this workspace' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspace_members
                 where workspace_id = p_workspace_id and user_id = p_new_owner) then
    raise exception 'the new owner must already be a member' using errcode = '22023';
  end if;

  update public.workspaces set owner_id = p_new_owner where id = p_workspace_id;
  update public.workspace_members set role = 'editor'
    where workspace_id = p_workspace_id and user_id = v_uid;
  update public.workspace_members set role = 'owner'
    where workspace_id = p_workspace_id and user_id = p_new_owner;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
revoke all on function public.ensure_personal_workspace() from public, anon;
revoke all on function public.create_team(text, text) from public, anon;
revoke all on function public.rename_workspace(uuid, text, text) from public, anon;
revoke all on function public.delete_team(uuid) from public, anon;
revoke all on function public.leave_workspace(uuid) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;

grant execute on function public.ensure_personal_workspace() to authenticated;
grant execute on function public.create_team(text, text) to authenticated;
grant execute on function public.rename_workspace(uuid, text, text) to authenticated;
grant execute on function public.delete_team(uuid) to authenticated;
grant execute on function public.leave_workspace(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
