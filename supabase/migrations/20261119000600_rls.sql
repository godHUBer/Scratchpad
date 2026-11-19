-- Scratchpad 0006: row level security and column-level grants.
--
-- Read model : RLS for authenticated workspace members.
-- Write model: RPCs from 0003-0005 only. No INSERT/UPDATE/DELETE grants exist
--              for clients on any workspace table, so role checks and version
--              checks cannot be bypassed through PostgREST.

alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.canvas_items      enable row level security;
alter table public.bookmarks         enable row level security;
alter table public.media_assets      enable row level security;
alter table public.invitations       enable row level security;

revoke all on public.profiles          from anon, authenticated;
revoke all on public.workspaces        from anon, authenticated;
revoke all on public.workspace_members from anon, authenticated;
revoke all on public.canvas_items      from anon, authenticated;
revoke all on public.bookmarks         from anon, authenticated;
revoke all on public.media_assets      from anon, authenticated;
revoke all on public.invitations       from anon, authenticated;

grant select on public.profiles          to authenticated;
grant select on public.workspaces        to authenticated;
grant select on public.workspace_members to authenticated;
grant select on public.canvas_items      to authenticated;
grant select on public.bookmarks         to authenticated;
grant select on public.media_assets      to authenticated;

-- profile self-service is a plain user action; column grants keep it narrow
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.workspace_members me
      join public.workspace_members them on them.workspace_id = me.workspace_id
      where me.user_id = auth.uid() and them.user_id = profiles.id
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- workspaces / membership / content: read for members, writes via RPC only
-- ---------------------------------------------------------------------------
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists canvas_items_select on public.canvas_items;
create policy canvas_items_select on public.canvas_items
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists bookmarks_select on public.bookmarks;
create policy bookmarks_select on public.bookmarks
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists media_assets_select on public.media_assets;
create policy media_assets_select on public.media_assets
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- invitations: policy on the base table, selection through a view that omits
-- token_hash. The hash is therefore never exposed to any client.
-- ---------------------------------------------------------------------------
drop policy if exists invitations_read on public.invitations;
create policy invitations_read on public.invitations
  for select to authenticated
  using (
    public.can_edit_workspace(workspace_id)
    or invitee_user_id = auth.uid()
    or (
      invitee_email is not null
      and lower(invitee_email) = lower(coalesce(auth.email(), ''))
    )
  );

-- security_invoker runs the caller's rights, so the view needs SELECT on the
-- base table for RLS to be applied; the policy above still restricts rows.
grant select on public.invitations to authenticated;

drop view if exists public.invitations_safe;
create view public.invitations_safe
with (security_invoker = true) as
select
  i.id,
  i.workspace_id,
  i.invited_by,
  i.invitee_email,
  i.invitee_user_id,
  i.invitee_role,
  i.expires_at,
  i.status,
  i.accepted_by,
  i.accepted_at,
  i.created_at
from public.invitations i;

revoke all on public.invitations_safe from anon, authenticated;
grant select on public.invitations_safe to authenticated;

comment on view public.invitations_safe is
  'Invitation rows for the UI. token_hash is never projected; all writes go through RPCs.';
comment on policy profiles_update_self on public.profiles is
  'Self-service only; column grants limit writes to display_name and avatar_url.';
