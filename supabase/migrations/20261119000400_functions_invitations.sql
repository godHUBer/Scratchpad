-- Scratchpad 0004: invitation RPCs.
-- Tokens are generated here (32 random bytes), hashed with SHA-256 and only the
-- hash is stored. The raw token is returned to the inviter exactly once.
--
-- pgcrypto lives in the `extensions` schema on Supabase, so every function that
-- calls digest()/gen_random_bytes() includes it in search_path.

-- ---------------------------------------------------------------------------
-- public-safe preview (granted to anon: an invite link must be openable before login)
-- ---------------------------------------------------------------------------
create or replace function public.get_invitation_preview(p_token text)
returns table (
  status                text,
  workspace_id          uuid,
  workspace_name        text,
  workspace_description text,
  inviter_name          text,
  role_offered          text,
  expires_at            timestamptz,
  email_bound           boolean,
  already_member        boolean
)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_hash text;
  inv public.invitations;
  v_email text := lower(coalesce(auth.email(), ''))::text;
begin
  if p_token is null or char_length(p_token) < 20 then
    return;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into inv from public.invitations i where i.token_hash = v_hash;
  if not found then
    return;
  end if;

  -- Email-bound invitations are only described to the addressed recipient;
  -- anybody else gets no row at all (never leaks the workspace).
  if inv.invitee_email is not null
     and lower(inv.invitee_email) <> v_email
     and inv.invitee_user_id is distinct from auth.uid() then
    return;
  end if;

  return query
  select
    (case
       when inv.status <> 'pending' then inv.status
       when inv.expires_at <= now() then 'expired'
       else 'pending'
     end)::text,
    inv.workspace_id,
    w.name,
    w.description,
    p.display_name,
    inv.invitee_role,
    inv.expires_at,
    inv.invitee_email is not null,
    exists (select 1 from public.workspace_members m
            where m.workspace_id = inv.workspace_id and m.user_id = auth.uid())
  from public.workspaces w
  join public.profiles p on p.id = inv.invited_by
  where w.id = inv.workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_invitation
-- ---------------------------------------------------------------------------
create or replace function public.create_invitation(
  p_workspace_id uuid,
  p_role text default 'editor',
  p_invitee_email text default null,
  p_expires_in_days integer default 7
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_email text := nullif(lower(trim(p_invitee_email)), '');
  v_expires timestamptz;
  v_invitee uuid;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.can_edit_workspace(p_workspace_id) then
    raise exception 'only owners and editors can invite' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('editor','viewer') then
    raise exception 'role must be editor or viewer' using errcode = '22023';
  end if;
  if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > 30 then
    raise exception 'expiry must be between 1 and 30 days' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email address' using errcode = '22023';
  end if;

  -- bind the address to an existing profile when we already know that user
  if v_email is not null then
    select u.id into v_invitee from auth.users u where lower(u.email) = v_email;
  end if;

  if v_invitee is not null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = v_invitee
  ) then
    raise exception 'that person is already a member' using errcode = '22023';
  end if;

  -- 32 random bytes -> URL-safe token; only the hash is persisted
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
  v_expires := now() + make_interval(days => p_expires_in_days);

  insert into public.invitations
    (workspace_id, invited_by, token_hash, invitee_email, invitee_user_id, invitee_role, expires_at)
  values
    (p_workspace_id, v_uid, encode(extensions.digest(v_token, 'sha256'), 'hex'),
     v_email, v_invitee, p_role, v_expires)
  returning id into v_id;

  invitation_id := v_id;
  token := v_token;
  expires_at := v_expires;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_invitation: transactional, exactly one winner under concurrency
-- ---------------------------------------------------------------------------
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_hash text;
  inv public.invitations;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into inv from public.invitations i where i.token_hash = v_hash for update;
  if not found then raise exception 'invitation not found' using errcode = 'P0002'; end if;

  if inv.status <> 'pending' then
    raise exception 'this invitation is %', inv.status using errcode = '22023';
  end if;
  if inv.expires_at <= now() then
    update public.invitations set status = 'expired' where id = inv.id and status = 'pending';
    raise exception 'this invitation has expired' using errcode = '22023';
  end if;
  if inv.invitee_email is not null and lower(inv.invitee_email) <> coalesce(v_email, '') then
    raise exception 'this invitation was issued to a different email address' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- decline / revoke
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_invitation(p_invitation_id uuid, p_action text)
returns boolean language plpgsql security definer
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

  if p_action = 'decline' then
    if not (
      inv.invitee_user_id = v_uid
      or (inv.invitee_email is not null and lower(inv.invitee_email) = coalesce(v_email, ''))
    ) then
      raise exception 'this invitation is not addressed to you' using errcode = '42501';
    end if;
    update public.invitations set status = 'declined' where id = inv.id and status = 'pending';
  elsif p_action = 'revoke' then
    if not public.can_edit_workspace(inv.workspace_id) then
      raise exception 'not allowed to revoke this invitation' using errcode = '42501';
    end if;
    update public.invitations set status = 'revoked' where id = inv.id and status = 'pending';
  else
    raise exception 'unsupported action' using errcode = '22023';
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- close out expired invitations lazily (called by the invitations page)
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_invitations()
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.invitations i
     set status = 'expired'
   where i.status = 'pending' and i.expires_at <= now()
     and (i.invited_by = auth.uid() or public.can_edit_workspace(i.workspace_id));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
revoke all on function public.get_invitation_preview(text) from public;
revoke all on function public.create_invitation(uuid, text, text, integer) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.respond_to_invitation(uuid, text) from public, anon;
revoke all on function public.expire_stale_invitations() from public, anon;

grant execute on function public.get_invitation_preview(text) to anon, authenticated;
grant execute on function public.create_invitation(uuid, text, text, integer) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.respond_to_invitation(uuid, text) to authenticated;
grant execute on function public.expire_stale_invitations() to authenticated;
