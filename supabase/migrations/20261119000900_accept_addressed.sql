-- Scratchpad 0009: accept an invitation that is addressed to the signed-in user
-- without needing the raw token. Shareable link invitations still require the
-- token (the server only stores its hash), but email/user-bound invitations can
-- be accepted from the Invitations list.

create or replace function public.accept_addressed_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  inv public.invitations;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  select * into inv from public.invitations i where i.id = p_invitation_id for update;
  if not found then raise exception 'invitation not found' using errcode = 'P0002'; end if;
  if inv.status <> 'pending' then
    raise exception 'this invitation is %', inv.status using errcode = '22023';
  end if;
  if inv.expires_at <= now() then
    update public.invitations set status = 'expired' where id = inv.id and status = 'pending';
    raise exception 'this invitation has expired' using errcode = '22023';
  end if;

  if not (
    inv.invitee_user_id = v_uid
    or (inv.invitee_email is not null and lower(inv.invitee_email) = coalesce(v_email, ''))
  ) then
    raise exception 'this invitation is not addressed to you' using errcode = '42501';
  end if;

  if not exists (select 1 from public.workspace_members m
                 where m.workspace_id = inv.workspace_id and m.user_id = v_uid) then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (inv.workspace_id, v_uid, inv.invitee_role);
  end if;

  update public.invitations
     set status = 'accepted', accepted_by = v_uid, accepted_at = now()
   where id = inv.id and status = 'pending';
  if not found then
    raise exception 'this invitation was already used' using errcode = '22023';
  end if;

  return inv.workspace_id;
end;
$$;

revoke all on function public.accept_addressed_invitation(uuid) from public, anon;
grant execute on function public.accept_addressed_invitation(uuid) to authenticated;
