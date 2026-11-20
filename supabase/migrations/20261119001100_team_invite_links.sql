-- Scratchpad 0011: persistent team invite links.
--
-- The report: "the link to join the team is not appearing on My teams".
--
-- Root cause was a design decision, not a bug in the strict sense. 0004 stores
-- only `token_hash` and returns the raw token exactly once, at creation. The UI
-- mirrored that honestly ("the full link is only shown once"), but the effect in
-- use was that the moment the invite dialog was closed the only way to get back
-- into a team you had already invited somebody to was to create a second
-- invitation. On the page where people actually manage teams, there was no link
-- at all — just a pending row saying "Anyone with the link" that nobody could
-- produce the link for.
--
-- You cannot re-show a secret you deliberately did not store, so this migration
-- adds the two things that make the feature work without weakening the model:
--
--   1. reissue_invitation_token() — rotates the secret and returns a new raw
--      token. The old link dies at the same moment, which is the correct
--      behaviour for a re-share ("give me the link again" and "invalidate the
--      link I already sent" are the same operation).
--   2. get_or_create_team_invite_link() — the persistent-link case. One pending
--      "anyone with the link" invitation per team, rotating its token when asked
--      for. Being able to mint a link for a team you edit is equivalent in
--      privilege to creating an invitation, which editors could already do, so
--      this grants nothing new.
--
-- Nothing here can be called by a viewer: both go through can_edit_workspace().

-- ---------------------------------------------------------------------------
-- 1. Rotate an existing pending invitation's token and hand back the new one.
-- ---------------------------------------------------------------------------
create or replace function public.reissue_invitation_token(p_invitation_id uuid)
returns table (token text, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invitations;
  v_token text;
  v_expires timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_inv from public.invitations i where i.id = p_invitation_id for update;
  if not found then raise exception 'invitation not found' using errcode = 'P0002'; end if;
  if not public.can_edit_workspace(v_inv.workspace_id) then
    raise exception 'only owners and editors can re-issue invitation links' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'only a pending invitation can be re-issued (this one is %)', v_inv.status
      using errcode = '22023';
  end if;

  -- Same shape as 0004: 32 random bytes, hex encoded, only the hash stored.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := v_inv.expires_at;
  -- A link that is already past its expiry, or within a day of it, gets a fresh
  -- window; otherwise re-issuing would hand back a dead link.
  if v_expires <= now() + interval '1 day' then
    v_expires := now() + interval '7 days';
  end if;

  update public.invitations
     set token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'),
         expires_at = v_expires
   where id = v_inv.id;

  return query select v_token, v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The persistent join link for a team.
--
-- Returns a live shareable link, creating the underlying invitation row on first
-- call and rotating it on demand. Reuses an existing pending shareable invite so
-- repeatedly opening the page does not litter the table with rows.
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_team_invite_link(
  p_workspace_id uuid,
  p_role text default 'editor',
  p_rotate boolean default false
)
returns table (invitation_id uuid, token text, expires_at timestamptz, role_offered text)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_type text;
  v_inv public.invitations;
  v_token text;
  v_expires timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_role is null or p_role not in ('editor', 'viewer') then
    raise exception 'role must be editor or viewer' using errcode = '22023';
  end if;

  select type::text into v_type from public.workspaces w where w.id = p_workspace_id;
  if v_type is null then raise exception 'workspace not found' using errcode = 'P0002'; end if;
  if v_type <> 'team' then
    raise exception 'only teams have join links' using errcode = '22023';
  end if;
  if not public.can_edit_workspace(p_workspace_id) then
    raise exception 'only owners and editors can create join links' using errcode = '42501';
  end if;

  -- Reuse the newest pending shareable invitation (no email bound to it).
  select * into v_inv
    from public.invitations i
   where i.workspace_id = p_workspace_id
     and i.status = 'pending'
     and i.invitee_email is null
   order by i.created_at desc
   limit 1
   for update;

  if found then
    v_expires := v_inv.expires_at;
    if p_rotate or v_expires <= now() + interval '1 day' or v_inv.invitee_role <> p_role then
      v_token := encode(extensions.gen_random_bytes(32), 'hex');
      if v_expires <= now() + interval '1 day' then
        v_expires := now() + interval '7 days';
      end if;
      update public.invitations
         set token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'),
             expires_at = v_expires,
             invitee_role = p_role
       where id = v_inv.id;
    else
      -- The caller asked for the existing link. The raw token is not stored, so
      -- the only honest answer is another rotation: a link we cannot reproduce
      -- is a link we have to issue again.
      v_token := encode(extensions.gen_random_bytes(32), 'hex');
      update public.invitations
         set token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       where id = v_inv.id;
    end if;
    return query select v_inv.id, v_token, v_expires, p_role;
    return;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + interval '7 days';

  insert into public.invitations (workspace_id, invited_by, token_hash, invitee_role, expires_at)
  values (
    p_workspace_id,
    v_uid,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_role,
    v_expires
  )
  returning id into v_inv.id;

  return query select v_inv.id, v_token, v_expires, p_role;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants: authenticated only, and both functions check can_edit_workspace()
-- ---------------------------------------------------------------------------
revoke all on function public.reissue_invitation_token(uuid) from public, anon;
revoke all on function public.get_or_create_team_invite_link(uuid, text, boolean) from public, anon;
grant execute on function public.reissue_invitation_token(uuid) to authenticated;
grant execute on function public.get_or_create_team_invite_link(uuid, text, boolean) to authenticated;
