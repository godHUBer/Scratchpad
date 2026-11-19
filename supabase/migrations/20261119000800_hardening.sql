-- Scratchpad 0008: hardening found during the security review pass.
--
-- 1. Supabase grants EXECUTE on functions to `authenticated` by default, so
--    internal trigger functions must be revoked from authenticated explicitly.
-- 2. guard_member_write() inverted pg_trigger_depth(): a direct statement fires
--    the trigger at depth 1, FK cascades arrive at depth > 1. Enforce on direct
--    writes, allow cascades, and allow the atomic ownership transfer through an
--    explicit transaction-scoped opt-in.
-- 3. invitations_safe becomes a security-definer view with an explicit row
--    predicate, so the base table no longer needs a SELECT grant and token
--    hashes are unreachable from the API entirely.

revoke all on function public.guard_member_write() from authenticated;
revoke all on function public.touch_updated_at() from authenticated;

create or replace function public.guard_member_write()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  ws uuid := coalesce(new.workspace_id, old.workspace_id);
  ws_owner uuid;
begin
  -- FK cascades (workspace deleted, profile deleted) arrive at depth > 1.
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- RPCs that legitimately rewrite owner rows opt in explicitly and only for
  -- the duration of their transaction.
  if coalesce(current_setting('scratchpad.internal_write', true), 'off') = 'on' then
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

  perform set_config('scratchpad.internal_write', 'on', true);

  update public.workspaces set owner_id = p_new_owner where id = p_workspace_id;
  update public.workspace_members set role = 'editor'
    where workspace_id = p_workspace_id and user_id = v_uid;
  update public.workspace_members set role = 'owner'
    where workspace_id = p_workspace_id and user_id = p_new_owner;

  perform set_config('scratchpad.internal_write', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- invitation projection: no SELECT grant on the base table any more
-- ---------------------------------------------------------------------------
revoke select on public.invitations from authenticated;

drop view if exists public.invitations_safe;
create view public.invitations_safe
with (security_invoker = false) as
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
from public.invitations i
where public.can_edit_workspace(i.workspace_id)
   or i.invitee_user_id = auth.uid()
   or (
     i.invitee_email is not null
     and lower(i.invitee_email) = lower(coalesce(auth.email(), ''))
   );

revoke all on public.invitations_safe from anon, authenticated;
grant select on public.invitations_safe to authenticated;

comment on view public.invitations_safe is
  'Invitations visible to the caller (workspace managers and the addressed recipient). '
  'Security-definer view with an explicit predicate; token_hash is never projected.';
