-- A minimal stand-in for the Supabase-managed parts of a project.
--
-- The migrations under supabase/migrations only touch a small slice of what a
-- hosted Supabase project provides: the `auth` schema (uid(), users, sessions),
-- pgcrypto in `extensions`, and `realtime.messages`. This file recreates just
-- enough of each that the real migration SQL can be applied to a plain
-- PostgreSQL instance, so CI can execute it instead of only parsing it.

-- Supabase installs pgcrypto under `extensions`; the migrations call it there.
--
-- The supabase/postgres image ships pgcrypto, so this is a no-op there. A bare
-- PostgreSQL build has no contrib, and CREATE EXTENSION pgcrypto fails; in that
-- case fall back to a stand-in with the same *contract* the migrations rely on:
-- crypt(plain, crypt(plain, salt)) = crypt(plain, salt), and crypt never
-- returns its input. That keeps "right key accepted, wrong key rejected" honest.
-- It is NOT bcrypt and must not be used to protect anything real.
do $$
begin
  begin
    create extension if not exists pgcrypto with schema extensions;
  exception when others then
    create schema if not exists extensions;
    execute $f$
      create or replace function extensions.gen_salt(text) returns text
        language sql volatile as $b$
          select 'shim$' || substr(md5(random()::text || clock_timestamp()::text), 1, 32)
        $b$;
      create or replace function extensions.gen_salt(text, int) returns text
        language sql volatile as $b$
          select 'shim$' || substr(md5(random()::text || clock_timestamp()::text), 1, 32)
        $b$;
      create or replace function extensions.crypt(pw text, second text) returns text
        language sql immutable as $b$
          select case
            when second is null or second not like 'shim$%' then 'shim$invalid'
            when length(second) = 37                           -- a salt: 32 hex chars
              then 'shim$' || substr(second, 6) || md5(substr(second, 6) || pw)
            when length(second) = 69                           -- a stored hash
              then case
                     when md5(substr(second, 6, 32) || pw) = substr(second, 38)
                       then second
                     else 'shim$nomatch'
                   end
            else 'shim$invalid'
          end
        $b$;
      create or replace function extensions.digest(text, text) returns bytea
        language sql immutable as $b$ select decode(md5($1 || ':' || $2), 'hex') $b$;
      create or replace function extensions.gen_random_bytes(int) returns bytea
        language sql volatile as $b$
          select decode(substr(string_agg(md5(random()::text), ''), 1, $1 * 2), 'hex')
          from generate_series(1, ($1 + 15) / 16)
        $b$;
    $f$;
  end;
end $$;

create schema if not exists auth;
create schema if not exists realtime;
create schema if not exists storage;



-- Supabase roles. The migration suite grants/revokes against these by name, so
-- they must exist even though nothing here connects as them.
-- Role creation needs superuser; skip quietly when already present or not allowed.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      begin
        execute format('create role %I nologin', r);
      exception when insufficient_privilege then
        raise notice 'could not create role % (not superuser); grants to it will be skipped', r;
      end;
    end if;
  end loop;
end $$;

grant usage on schema extensions, auth, realtime, storage to anon, authenticated, service_role;

-- auth.uid() reads the JWT claims PostgREST sets for the request. Tests drive it
-- with set_config('request.jwt.claims', ...) exactly as the real stack does.
create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.email() returns text
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )
$$;

create or replace function auth.role() returns text
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user
  )
$$;

-- The parts of GoTrue's tables the app reads or writes.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid,
  aud                text,
  role               text,
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at         timestamptz,
  last_sign_in_at    timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists auth.identities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,
  provider_id     text,
  provider        text,
  identity_data   jsonb default '{}'::jsonb,
  last_sign_in_at timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table if not exists auth.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  factor_id    uuid,
  aal          text,
  not_after    timestamptz,
  refreshed_at timestamp,
  user_agent   text,
  ip           inet,
  tag          text
);

create table if not exists auth.refresh_tokens (
  id         bigserial primary key,
  token      varchar(255) unique,
  user_id    varchar(255),
  revoked    boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  session_id uuid
);

-- Realtime's per-message policy table. The app's migrations only put RLS
-- policies on it, so the columns just need to exist.
create table if not exists realtime.messages (
  id         uuid default gen_random_uuid(),
  topic      text,
  extension  text,
  payload    jsonb,
  event      text,
  private    boolean default false,
  inserted_at timestamptz default now()
);
alter table realtime.messages enable row level security;

-- Supabase's Realtime provides these two helpers; policies call them.
create or replace function realtime.topic() returns text
  language sql stable
  as $$ select coalesce(current_setting('realtime.topic', true), '') $$;

create or replace function realtime.messages_topic(messages realtime.messages) returns text
  language sql stable
  as $$ select messages.topic $$;

grant select on realtime.messages to authenticated;
