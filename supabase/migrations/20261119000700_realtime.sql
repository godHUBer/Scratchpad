-- Scratchpad 0007: realtime publication, replica identity, presence authorization.

-- Full replica identity so DELETE events carry workspace_id for client filters.
alter table public.canvas_items      replica identity full;
alter table public.bookmarks         replica identity full;
alter table public.media_assets      replica identity full;
alter table public.workspace_members replica identity full;
alter table public.workspaces        replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['canvas_items','bookmarks','media_assets','workspace_members','workspaces']
  loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Private presence channels: topic "workspace-presence:<workspace_id>".
-- Only members of that workspace may read or write presence messages.
-- ---------------------------------------------------------------------------
drop policy if exists workspace_presence_read on realtime.messages;
create policy workspace_presence_read on realtime.messages
  for select to authenticated
  using (
    extension = 'presence'
    and exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid()
        and m.workspace_id::text = split_part(realtime.topic(), ':', 2)
    )
  );

drop policy if exists workspace_presence_write on realtime.messages;
create policy workspace_presence_write on realtime.messages
  for insert to authenticated
  with check (
    extension = 'presence'
    and exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid()
        and m.workspace_id::text = split_part(realtime.topic(), ':', 2)
    )
  );

comment on policy workspace_presence_read on realtime.messages is
  'Presence on workspace-presence:<workspace_id> is limited to that workspace''s members.';
