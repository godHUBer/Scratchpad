-- Scratchpad 0001: schema, constraints, indexes
-- Run against Supabase (Postgres 17). Idempotent where practical.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- profiles (mirrors auth.users, populated by trigger)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default 'New collaborator'
                check (char_length(display_name) between 1 and 80),
  avatar_url    text check (avatar_url is null or avatar_url ~* '^https?://'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  type        text not null default 'personal' check (type in ('personal','team')),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- one personal workspace per user (the review's race-proof constraint)
create unique index if not exists one_personal_workspace_per_owner
  on public.workspaces (owner_id) where type = 'personal';
create index if not exists workspaces_owner_idx on public.workspaces (owner_id);
create index if not exists workspaces_type_idx on public.workspaces (type);

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'viewer' check (role in ('owner','editor','viewer')),
  joined_at    timestamptz not null default now(),
  constraint workspace_members_one_per_user unique (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members (user_id);
create index if not exists workspace_members_ws_role_idx on public.workspace_members (workspace_id, role);

-- ---------------------------------------------------------------------------
-- bookmarks (owned record; canvas cards reference it)
-- ---------------------------------------------------------------------------
create table if not exists public.bookmarks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  url          text not null check (url ~* '^https://[^\s]+$' and char_length(url) <= 2048),
  description  text check (description is null or char_length(description) <= 1000),
  category     text check (category is null or char_length(category) <= 60),
  color        text not null default '#f7c948' check (color ~* '^#[0-9a-f]{6}$'),
  created_by   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bookmarks_workspace_idx on public.bookmarks (workspace_id, created_at desc);
create index if not exists bookmarks_category_idx on public.bookmarks (workspace_id, category);

-- ---------------------------------------------------------------------------
-- media_assets (links + metadata only, never binaries)
-- ---------------------------------------------------------------------------
create table if not exists public.media_assets (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  uploaded_by     uuid not null references public.profiles(id) on delete cascade,
  original_url    text not null check (original_url ~* '^https://[^\s]+$' and char_length(original_url) <= 2048),
  drive_file_id   text check (drive_file_id is null or char_length(drive_file_id) <= 200),
  file_name       text check (file_name is null or char_length(file_name) <= 200),
  file_type       text not null check (file_type in ('image','audio','video','link')),
  mime_type       text check (mime_type is null or char_length(mime_type) <= 120),
  created_at      timestamptz not null default now()
);
create index if not exists media_assets_workspace_idx on public.media_assets (workspace_id, created_at desc);
create index if not exists media_assets_drive_idx on public.media_assets (workspace_id, drive_file_id);

-- ---------------------------------------------------------------------------
-- canvas_items (references library records, does not duplicate them)
-- ---------------------------------------------------------------------------
create table if not exists public.canvas_items (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  item_type      text not null check (item_type in ('text','draw','image','audio','video','bookmark','media_link','note')),
  position_x     double precision not null default 0 check (position_x between -1000000 and 1000000),
  position_y     double precision not null default 0 check (position_y between -1000000 and 1000000),
  width          double precision not null default 240 check (width > 0 and width <= 100000),
  height         double precision not null default 160 check (height > 0 and height <= 100000),
  content        jsonb not null default '{}'::jsonb check (pg_column_size(content) <= 262144),
  bookmark_id    uuid references public.bookmarks(id) on delete set null,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  created_by     uuid not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1 check (version > 0),
  constraint canvas_item_reference_kind check (
    (bookmark_id is null or item_type = 'bookmark') and
    (media_asset_id is null or item_type in ('image','audio','video','media_link'))
  )
);
create index if not exists canvas_items_workspace_idx on public.canvas_items (workspace_id, updated_at);
create index if not exists canvas_items_bookmark_idx on public.canvas_items (bookmark_id);
create index if not exists canvas_items_media_idx on public.canvas_items (media_asset_id);

-- ---------------------------------------------------------------------------
-- invitations (token hash only; recipient addressed explicitly)
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  invited_by      uuid not null references public.profiles(id) on delete cascade,
  token_hash      text not null unique check (char_length(token_hash) = 64),
  invitee_email   text check (invitee_email is null or char_length(invitee_email) between 3 and 254),
  invitee_user_id uuid references public.profiles(id) on delete set null,
  invitee_role    text not null default 'editor' check (invitee_role in ('editor','viewer')),
  expires_at      timestamptz not null default (now() + interval '7 days'),
  status          text not null default 'pending'
                  check (status in ('pending','accepted','declined','revoked','expired')),
  accepted_by     uuid references public.profiles(id) on delete set null,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint invitations_accepted_consistency check (
    (status = 'accepted') = (accepted_by is not null and accepted_at is not null)
  )
);
create index if not exists invitations_workspace_idx on public.invitations (workspace_id, status);
create index if not exists invitations_invitee_idx on public.invitations (invitee_user_id, status);
create index if not exists invitations_email_idx on public.invitations (lower(invitee_email), status);
create unique index if not exists invitations_one_pending_per_email
  on public.invitations (workspace_id, lower(invitee_email))
  where status = 'pending' and invitee_email is not null;

-- ---------------------------------------------------------------------------
-- comments on the shape of the model (helps future maintainers / PostgREST)
-- ---------------------------------------------------------------------------
comment on table public.canvas_items is
  'Canvas objects. bookmark_id/media_asset_id reference library rows; content holds presentation data only.';
comment on column public.invitations.token_hash is
  'SHA-256 hex of the invitation token. The raw token is returned once by create_invitation and never stored.';
